// CurrentStrip（§3.3 #22）：電流稀疏帶。**散點，不是曲線。**
//
// FGC2026_TeleOp_Match.java:307-320 每圈只讀十分之一輪流（getCurrent 不在 bulk
// cache，是獨立的 Lynx 往返），所以每個電流欄位的取樣率大約是 loop/10 ≈ 2 Hz。
// 一張畫成平滑曲線的 2 Hz 電流圖比沒有這張圖更糟——它會誘導使用者去推論
// 「卡球發生在第 3.2 秒」這種取樣率根本撐不住的結論。
//
// 所以這裡：畫點、點與點之間只畫很淡的階梯連線（表示「這段期間我們不知道」）、
// 標題掛灰色 ~2 Hz chip、面板刻意做小。上方那排 OverCurrent 布林燈才是高頻的、
// 有用的那一半（它們走一般的 20 Hz 推播）。

import { useEffect, useRef } from "react";
import { GLYPHS } from "../../lib/tone";
import { PanelShell } from "../shell/PanelShell";
import { LogStore, liveLog } from "../../lib/LogStore";
import { cursor } from "../../lib/cursorStore";
import { K } from "../../lib/fgcKeys";
import { numFont, palette, uiFont } from "../../lib/theme";
import { useLogKeys } from "../../lib/hooks";
import { attachPanZoom, fitCanvas, observeSize, tToX, withAlpha } from "../graph/timeAxis";
import { view } from "../graph/viewWindow";

interface Row {
  key: string;
  label: string;
  over: string;
}

interface Props {
  log?: LogStore;
  padLeft?: number;
  padRight?: number;
  rowH?: number;
}

const ROWS: readonly Row[] = [
  { key: K.currentL, label: "L", over: K.overCurrentL },
  { key: K.currentR, label: "R", over: K.overCurrentR },
  { key: K.currentWay, label: "W", over: K.overCurrentWay },
  { key: K.climbCurrent, label: "爬", over: K.climbOverCurrent },
];

const LAMP_KEYS = ROWS.flatMap((r) => [r.key, r.over]);
/** y 軸最小滿刻度（A）：沒負載時不要把 0.3 A 的雜訊畫成滿格。 */
const MIN_FS = 5;
/**
 * 四列共用 --series-3（松青）。**不可以照 i 取 series-1/2/4**：
 * 那三個是 SL / SR / Way 的固定綁定（§6.5），拿同一個顏色畫另一個訊號，
 * 使用者在主圖與這裡看到的青色就不是同一件事了。
 * 四列本來就各自在自己的軌道上、左邊有列名，顏色不需要再分一次。
 */
const CURRENT_SERIES = 2;

export function CurrentStrip({ log = liveLog, padLeft = 54, padRight = 12, rowH = 26 }: Props) {
  useLogKeys(LAMP_KEYS, log);
  const wrapRef = useRef<HTMLDivElement>(null);
  const cvRef = useRef<HTMLCanvasElement>(null);
  const padRef = useRef({ padLeft, padRight });
  padRef.current = { padLeft, padRight };

  const height = ROWS.length * rowH + 2;

  useEffect(() => {
    const cv = cvRef.current;
    const wrap = wrapRef.current;
    if (!cv || !wrap) return;
    let raf = 0;

    const geom = () => {
      const pad = padRef.current;
      const w = cv.clientWidth;
      return { x0: pad.padLeft, w: Math.max(1, w - pad.padLeft - pad.padRight), t0: view.t0, t1: view.t1 };
    };

    const draw = () => {
      const fit = fitCanvas(cv, height);
      if (!fit) return;
      const { ctx, w } = fit;
      const p = palette();
      const pad = padRef.current;
      const x0 = pad.padLeft;
      const plotW = Math.max(1, w - pad.padLeft - pad.padRight);
      const t0 = view.t0;
      const t1 = view.t1;

      ctx.textBaseline = "middle";

      // 四列共用同一個滿刻度：比較 L / R / Way 誰比較吃電，各自縮放就比不了了
      let fs = MIN_FS;
      const samples = ROWS.map((r) => log.sampleWindow(r.key, t0, t1, 20_000));
      for (const s of samples) for (let i = 0; i < s.n; i++) if (s.ys[i] > fs) fs = s.ys[i];
      fs = Math.ceil(fs * 1.1);

      for (let i = 0; i < ROWS.length; i++) {
        const row = ROWS[i];
        const y = i * rowH + 1;
        const h = rowH - 2;
        const base = y + h - 2;
        const usable = h - 5;

        // 軌道靠比卡片深一階的底色界定，不畫框：框只表示「可寫」
        ctx.fillStyle = p.surface1;
        ctx.fillRect(x0, y, plotW, h);

        // 列名 + 最新值畫在左內距裡，與 LineGraph / DiscreteBand 的繪圖區對齊
        const latest = log.latestNum(row.key, NaN);
        ctx.textAlign = "right";
        ctx.fillStyle = p.textDim;
        // 列名與讀值都靠右排進左內距：值貼齊繪圖區左緣，列名再往左讓一個值的寬度。
        // 兩者的距離必須以 --fs-xs 的實際字寬算，不能寫死——field 主題下字會變大。
        // 列名與讀值都靠右排進 54 px 的左內距：值貼齊繪圖區左緣，列名再往左一格。
        // 單位不逐列重複——右上角的「滿刻度 6 A」已經說了這四列的單位是安培，
        // 逐列再寫一次 A 只會把 12 px 字級下的列名擠掉。
        ctx.font = uiFont();
        ctx.fillText(row.label, x0 - 30, y + h / 2, 16);
        ctx.font = numFont();
        ctx.fillStyle = log.latestBool(row.over, false) ? p.err : p.text;
        ctx.fillText(Number.isFinite(latest) ? latest.toFixed(1) : "—", x0 - 4, y + h / 2, 24);

        const s = samples[i];
        if (s.n === 0) continue;
        const col = log.latestBool(row.over, false) ? p.err : p.series[CURRENT_SERIES];

        // 極淡的階梯連線：只是「上一次量到的值持續到這裡」，不是量到的曲線
        ctx.strokeStyle = withAlpha(col, 0.14);
        ctx.lineWidth = 1;
        ctx.beginPath();
        let started = false;
        let px = 0;
        let py = 0;
        for (let j = 0; j < s.n; j++) {
          const x = tToX(s.xs[j], t0, t1, x0, plotW);
          const yy = base - Math.max(0, Math.min(1, s.ys[j] / fs)) * usable;
          if (!started) {
            ctx.moveTo(x, yy);
            started = true;
          } else {
            ctx.lineTo(x, py);
            ctx.lineTo(x, yy);
          }
          px = x;
          py = yy;
        }
        if (started) ctx.lineTo(Math.min(x0 + plotW, px + 2), py);
        ctx.stroke();

        // 散點本體
        ctx.fillStyle = col;
        for (let j = 0; j < s.n; j++) {
          const x = tToX(s.xs[j], t0, t1, x0, plotW);
          if (x < x0 - 2 || x > x0 + plotW + 2) continue;
          const yy = base - Math.max(0, Math.min(1, s.ys[j] / fs)) * usable;
          ctx.fillRect(x - 1.5, yy - 1.5, 3, 3);
        }
      }

      // 滿刻度標在右上角：沒有這個數字，散點的高度沒有意義
      // 滿刻度壓在第一列的散點上會兩邊都讀不到：先鋪一塊軌道底色再寫字。
      ctx.textAlign = "right";
      ctx.font = uiFont();
      const fsTxt = "滿刻度 " + fs.toFixed(0) + " A";
      const fsW = ctx.measureText(fsTxt).width;
      ctx.fillStyle = p.surface1;
      ctx.fillRect(x0 + plotW - 5 - fsW, 2, fsW + 4, 15);
      ctx.fillStyle = p.stale;
      ctx.fillText(fsTxt, x0 + plotW - 3, 9);

      const ct = cursor.cursorT;
      if (ct >= t0 && ct <= t1) {
        ctx.strokeStyle = p.focusRing;
        ctx.lineWidth = 1;
        ctx.beginPath();
        const cx = Math.round(tToX(ct, t0, t1, x0, plotW)) + 0.5;
        ctx.moveTo(cx, 0);
        ctx.lineTo(cx, height);
        ctx.stroke();
      }
    };

    let lastLog = -1;
    let lastView = -1;
    let lastCur = -1;
    let lastW = -1;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const lv = log.getVersion();
      const vv = view.getVersion();
      const cv2 = cursor.getVersion();
      const w = cv.clientWidth;
      if (lv === lastLog && vv === lastView && cv2 === lastCur && w === lastW) return;
      lastLog = lv;
      lastView = vv;
      lastCur = cv2;
      lastW = w;
      draw();
    };
    raf = requestAnimationFrame(tick);
    const stopSize = observeSize(wrap, draw);
    const detach = attachPanZoom(cv, { geom, wheelZoom: true, dragPan: true, clickSeek: true, hover: true });

    return () => {
      cancelAnimationFrame(raf);
      stopSize();
      detach();
    };
  }, [log, height, rowH]);

  return (
    <PanelShell title="電流" rate="~2 Hz" note="每圈只讀十分之一輪流；散點不是曲線" flush>
      <div className="cs">
        <div className="cs-lamps">
          {ROWS.map((r) => {
            const on = log.latestBool(r.over, false);
            const has = log.has(r.over);
            return (
              <span key={r.over} className={on ? "lamp on" : has ? "lamp" : "lamp none"} title={r.over}>
                {/* OverCurrent 亮起來是「壞消息」，所以形狀要是 ■ 不是 ●。
                    顏色已經是 --err，但形狀是第二條通道——只有顏色對的話，
                    色覺辨異的使用者看到的是一顆跟「一切正常」同形狀的燈。
                    字元走 .fgc-glyph（--font-ui + 固定 1.25em）：等寬字體多半沒有
                    ■ ○ 這兩個 CJK 符號，fallback 後四顆燈的間距會對不齊。 */}
                <span className={"fgc-glyph " + (on ? "err" : "stale")}>{on ? GLYPHS.err : GLYPHS.stale}</span>
                {r.label}
              </span>
            );
          })}
          <span className="cs-hint">
            {ROWS.some((r) => log.latestBool(r.over, false)) ? "過流中，可能卡球" : "無過流"}
          </span>
        </div>
        <div ref={wrapRef} style={{ height }}>
          <canvas ref={cvRef} style={{ width: "100%", height }} />
        </div>
      </div>
    </PanelShell>
  );
}
