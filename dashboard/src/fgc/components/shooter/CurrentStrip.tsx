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
import { PanelShell } from "../shell/PanelShell";
import { LogStore, liveLog } from "../../lib/LogStore";
import { cursor } from "../../lib/cursorStore";
import { K } from "../../lib/fgcKeys";
import { palette } from "../../lib/theme";
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

      ctx.font = "10px ui-monospace, Consolas, monospace";
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

        ctx.fillStyle = p.surface1;
        ctx.fillRect(x0, y, plotW, h);
        ctx.strokeStyle = withAlpha(p.border, 0.7);
        ctx.strokeRect(x0 + 0.5, y + 0.5, plotW - 1, h - 1);

        // 列名 + 最新值畫在左內距裡，與 LineGraph / DiscreteBand 的繪圖區對齊
        const latest = log.latestNum(row.key, NaN);
        ctx.textAlign = "right";
        ctx.fillStyle = p.textDim;
        ctx.fillText(row.label, x0 - 26, y + h / 2);
        ctx.fillStyle = log.latestBool(row.over, false) ? p.err : p.text;
        ctx.fillText(Number.isFinite(latest) ? latest.toFixed(1) + "A" : "—", x0 - 3, y + h / 2);

        const s = samples[i];
        if (s.n === 0) continue;
        const col = p.series[i % p.series.length];

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
      ctx.textAlign = "right";
      ctx.fillStyle = p.stale;
      ctx.fillText(fs.toFixed(0) + "A 滿刻度", x0 + plotW - 3, 8);

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
                {on ? "●" : has ? "○" : "○"} {r.label}
              </span>
            );
          })}
          <span className="cs-hint">
            {ROWS.some((r) => log.latestBool(r.over, false)) ? "OverCurrent：可能卡球" : "OverCurrent 全滅"}
          </span>
        </div>
        <div ref={wrapRef} style={{ height }}>
          <canvas ref={cvRef} style={{ width: "100%", height }} />
        </div>
      </div>
    </PanelShell>
  );
}
