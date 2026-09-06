// DiscreteBand（§3.3 #19）：離散色帶。Canvas run-length，六列，與 LineGraph 共用 x 範圍。
//
// 為什麼這是 FRC 側最值得抄的單一元件：「前射後吸的瀑布流」本質是
// intake → hopper → way → shooter 一條時序管線，而這四段分別由狀態機、bumper、
// atSpeed 閘、trigger 控制，**彼此沒有互鎖**。折線圖畫不出「按了 R2 但 hopper 還關著」，
// 色帶會讓它變成肉眼可見的錯開色塊。
//
// 對齊是這個元件的正確性條件：x 範圍取自同一個 viewWindow，左右內距取自 LineGraph
// 回報的 padLeft / padRight。差 10 px 就會讓「錯開」變成一個看不出來的假象。

import { useEffect, useRef } from "react";
import { LogStore, liveLog, type Run } from "../../lib/LogStore";
import { cursor } from "../../lib/cursorStore";
import { palette } from "../../lib/theme";
import { K, shortName } from "../../lib/fgcKeys";
import { view } from "./viewWindow";
import { attachPanZoom, fitCanvas, hatchPattern, observeSize, tToX, withAlpha } from "./timeAxis";
import { DRAG_MIME } from "./LineGraph";

/**
 * state 三態色 / bool 開關 / sign 取號 +0− / level 類比深淺 / auto 自己猜。
 * level 是給 RT、LT 這種類比 trigger 用的——「按到一半」必須看得出來，
 * 那正是判斷「機器人壞了 vs 駕駛沒按」的分界。
 */
export type BandMode = "auto" | "state" | "bool" | "sign" | "level";

export interface BandRow {
  key: string;
  label?: string;
  mode?: BandMode;
}

interface Props {
  log?: LogStore;
  rows: readonly BandRow[];
  /** 每列高度；§3.3 #19 規定 22 px。 */
  rowH?: number;
  padLeft?: number;
  padRight?: number;
  onDropKey?: (key: string) => void;
}

/** §3.3 #19 的六列預設組合。 */
export const DEFAULT_BAND_ROWS: readonly BandRow[] = [
  { key: K.driveState, label: "State", mode: "state" },
  { key: K.atSpeed, label: "AtSpeed", mode: "bool" },
  { key: K.way, label: "Way", mode: "sign" },
  { key: K.hopperCmd, label: "Hopper", mode: "auto" }, // CRServo 指令值，機器人端是字串
  { key: K.gpRT, label: "RT", mode: "level" },
  { key: K.driveReversed, label: "車頭", mode: "bool" },
];

const GAP_SEC = 1.0;

interface Colors {
  fill: string;
  label: string | null;
}

function runColor(
  mode: BandMode,
  run: Run,
  kind: "num" | "bool" | "str" | null,
  p: ReturnType<typeof palette>,
): Colors {
  // 字串欄位一律走 state：字串沒有「大小」，把字典索引當成類比深淺是把
  // 「OPEN 排在 STOP 後面」誤讀成「OPEN 比 STOP 大」。呼叫端指定 level 也不接受。
  const m: BandMode =
    kind === "str" ? "state" : mode !== "auto" ? mode : kind === "bool" ? "bool" : "sign";
  if (m === "state") {
    const s = run.s ?? "";
    if (s === "COLLECT") return { fill: p.stateCollect, label: s };
    if (s === "SHOOT") return { fill: p.stateShoot, label: s };
    if (s === "EJECT") return { fill: p.stateEject, label: s };
    return { fill: p.bandOff, label: s || null };
  }
  if (m === "bool") {
    const on = run.v > 0.5;
    return { fill: on ? p.bandOn : p.bandOff, label: on ? "on" : null };
  }
  if (m === "sign") {
    if (run.v > 1e-6) return { fill: p.bandOn, label: "pos" };
    if (run.v < -1e-6) return { fill: p.bandNeg, label: "neg" };
    return { fill: p.bandOff, label: "0" };
  }
  // level：0 → 底色；1 → 滿色。中間值用透明度表示「按到一半」。
  const a = Math.min(1, Math.abs(run.v));
  if (a < 0.02) return { fill: p.bandOff, label: null };
  const base = run.v < 0 ? p.bandNeg : p.bandOn;
  return { fill: withAlpha(base, 0.28 + 0.72 * a), label: a >= 0.98 ? null : a.toFixed(2) };
}

export function DiscreteBand({
  log = liveLog,
  rows,
  rowH = 22,
  padLeft = 54,
  padRight = 12,
  onDropKey,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const cvRef = useRef<HTMLCanvasElement>(null);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const padRef = useRef({ padLeft, padRight });
  padRef.current = { padLeft, padRight };

  const height = Math.max(rowH, rows.length * rowH) + 2;

  useEffect(() => {
    const cv = cvRef.current;
    const wrap = wrapRef.current;
    if (!cv || !wrap) return;

    let raf = 0;
    let hatch: CanvasPattern | string | null = null;

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
      const rs = rowsRef.current;
      if (!hatch) hatch = hatchPattern(ctx, p.gap);

      ctx.font = "10px ui-monospace, Consolas, monospace";
      ctx.textBaseline = "middle";

      for (let i = 0; i < rs.length; i++) {
        const row = rs[i];
        const y = i * rowH + 1;
        const h = rowH - 2;

        // 列底：沒有資料的地方是斜線紋，不是黑色——「沒有這個 key」與「值是 0」不同
        ctx.fillStyle = p.surface1;
        ctx.fillRect(x0, y, plotW, h);

        // 列標籤（畫在 LineGraph 讓出來的左內距裡，所以兩者的繪圖區完全對齊）
        ctx.fillStyle = p.textDim;
        ctx.textAlign = "right";
        ctx.fillText(row.label ?? shortName(row.key), x0 - 5, y + h / 2, x0 - 8);

        const kind = log.kindOf(row.key);
        if (!log.has(row.key)) {
          ctx.save();
          ctx.fillStyle = hatch as string;
          ctx.fillRect(x0, y, plotW, h);
          ctx.restore();
          ctx.fillStyle = p.stale;
          ctx.textAlign = "left";
          ctx.fillText("無此埋點", x0 + 6, y + h / 2);
          continue;
        }

        // 先把「畫出來會同色」的相鄰 run 合併再畫。
        // 不合併的話 Way 這種每個樣本都在變的連續量會產生上千個 1 px 的矩形，
        // 相鄰同色矩形的次像素接縫會把一整段實心色塊畫成一片條紋——那是渲染假象，
        // 會被讀成「way 在抖」。順便把 fillRect 的次數從上千降到個位數。
        const runs = log.runs(row.key, t0, t1, 4000);
        const merged: { x0: number; x1: number; c: Colors }[] = [];
        for (const r of runs) {
          const rx0 = tToX(r.t0, t0, t1, x0, plotW);
          const rx1 = tToX(r.t1, t0, t1, x0, plotW);
          const c = runColor(row.mode ?? "auto", r, kind, p);
          const last = merged[merged.length - 1];
          if (last && last.c.fill === c.fill && last.c.label === c.label) last.x1 = rx1;
          else merged.push({ x0: rx0, x1: rx1, c });
        }
        for (const m of merged) {
          const wpx = Math.max(1, m.x1 - m.x0);
          ctx.fillStyle = m.c.fill;
          ctx.fillRect(m.x0, y, wpx, h);
          if (m.c.label && wpx > 46) {
            // 深色塊上用亮字、亮色塊上用暗字；固定用其中一種一定會有一半讀不到
            ctx.fillStyle = m.c.fill === p.bandOff ? p.textDim : p.surface1;
            ctx.textAlign = "center";
            ctx.fillText(m.c.label, m.x0 + wpx / 2, y + h / 2, wpx - 6);
          }
        }

        ctx.strokeStyle = withAlpha(p.border, 0.7);
        ctx.lineWidth = 1;
        ctx.strokeRect(x0 + 0.5, y + 0.5, plotW - 1, h - 1);
      }

      // 資料缺口：整條貫穿所有列的斜線紋（絕不內插）
      ctx.save();
      ctx.fillStyle = hatch as string;
      for (const g of log.gaps(GAP_SEC)) {
        if (g.t1 <= t0 || g.t0 >= t1) continue;
        const gx0 = tToX(Math.max(t0, g.t0), t0, t1, x0, plotW);
        const gx1 = tToX(Math.min(t1, g.t1), t0, t1, x0, plotW);
        ctx.fillRect(gx0, 0, Math.max(1, gx1 - gx0), height);
      }
      ctx.restore();

      // 選區
      const sel = cursor.selection;
      if (sel && sel.t1 > sel.t0) {
        ctx.fillStyle = withAlpha(p.focusRing, 0.12);
        const sx0 = tToX(Math.max(t0, sel.t0), t0, t1, x0, plotW);
        const sx1 = tToX(Math.min(t1, sel.t1), t0, t1, x0, plotW);
        if (sx1 > sx0) ctx.fillRect(sx0, 0, sx1 - sx0, height);
      }

      // hover（虛線）與 cursorT（實線）：兩條線是兩件事，不可合成一條
      const hv = cursor.hoverT;
      if (hv !== null && hv >= t0 && hv <= t1) {
        ctx.save();
        ctx.strokeStyle = p.textDim;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        const hx = Math.round(tToX(hv, t0, t1, x0, plotW)) + 0.5;
        ctx.moveTo(hx, 0);
        ctx.lineTo(hx, height);
        ctx.stroke();
        ctx.restore();
      }
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
    let lastHover: number | null = null;
    let lastW = -1;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const lv = log.getVersion();
      const vv = view.getVersion();
      const cv2 = cursor.getVersion();
      const hv = cursor.hoverT;
      const w = cv.clientWidth;
      if (lv === lastLog && vv === lastView && cv2 === lastCur && hv === lastHover && w === lastW) return;
      lastLog = lv;
      lastView = vv;
      lastCur = cv2;
      lastHover = hv;
      lastW = w;
      draw();
    };
    raf = requestAnimationFrame(tick);

    const stopSize = observeSize(wrap, draw);
    const detach = attachPanZoom(cv, { geom, wheelZoom: true, dragPan: true, shiftSelect: true, clickSeek: true, hover: true });

    return () => {
      cancelAnimationFrame(raf);
      stopSize();
      detach();
    };
  }, [log, height, rowH]);

  return (
    <div
      className="db-wrap"
      ref={wrapRef}
      style={{ height }}
      onDragOver={(e) => {
        if (!onDropKey) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDrop={(e) => {
        if (!onDropKey) return;
        e.preventDefault();
        const key = e.dataTransfer.getData(DRAG_MIME) || e.dataTransfer.getData("text/plain");
        if (key) onDropKey(key);
      }}
    >
      <canvas ref={cvRef} style={{ width: "100%", height }} />
    </div>
  );
}
