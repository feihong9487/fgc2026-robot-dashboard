// TimeBar（§3.3 #31）：全域時間軸。三層 + 播放控制。
//
//   ① 總覽波形（16 px）—— 整場縮圖，**永遠全長，不隨縮放改變**。這是「我在哪裡」的地圖，
//      跟著縮放一起變的話它就不再是地圖，而是第二張一模一樣的折線圖。
//   ② 事件軌（20 px）—— 上半是**事件密度直方圖**、下半是**篩選中類別的刻痕**，
//      外加書籤與 **資料缺口斜線紋**（絕不內插成一條直線）
//   ③ 視窗條（22 px）+ 播放控制 —— 現在看的是整場的哪一段
//
// live lock 的設計：往左捲脫離即時（燈熄），捲到最右或按 L 自動接回。
// 這省掉一顆「回到即時」按鈕和一次分心——賽場上每一次「我剛剛按到什麼」都是成本。

import { useEffect, useRef } from "react";
import { LogStore, liveLog } from "../../lib/LogStore";
import { cursor } from "../../lib/cursorStore";
import { numFont, palette } from "../../lib/theme";
import { K } from "../../lib/fgcKeys";
import { useCursor } from "../../lib/hooks";
import { view } from "./viewWindow";
import {
  attachPanZoom,
  fitCanvas,
  fmtT,
  hatchPattern,
  niceStep,
  observeSize,
  tToX,
  withAlpha,
  xToT,
} from "./timeAxis";

/** 事件軌上的一個標記。第三階段的 eventDetect 會餵這個型別進來。 */
export interface TimeEvent {
  t: number;
  /** 形狀語彙（§6.3）：ok=● warn=▲ err=■ info=○ */
  level?: "ok" | "warn" | "err" | "info";
  label: string;
}

export interface TimeMark {
  t: number;
  label: string;
}

interface Props {
  log?: LogStore;
  events?: readonly TimeEvent[];
  /**
   * 目前**篩選中**的事件（事件軌下半的刻痕只畫這些）。
   * 不給就等於沒有篩選，畫全部。密度直方圖永遠畫 `events` 全集——
   * 「事件集中在哪」與「我篩的那一類在哪」是兩個不同的問題，各佔一半軌高。
   */
  selected?: readonly TimeEvent[];
  bookmarks?: readonly TimeMark[];
  /** 總覽層畫哪一條；預設 SL（shooter 三軌裡最能一眼認出「這一場長什麼樣」的那條）。 */
  overviewKey?: string;
  padLeft?: number;
  padRight?: number;
  /** 掛全域快捷鍵（§5.1 的時間子集）。MATCH 下整組不掛。 */
  hotkeys?: boolean;
}

const H_OVER = 16;
const H_EVENT = 20;
const H_WINDOW = 22;
/** 12 px 刻度 + 4 px 呼吸。本設計沒有 11px，所以軸列高度跟著字級走。 */
const H_AXIS = 16;
const GAP = 2;
const TOTAL_H = H_OVER + GAP + H_EVENT + GAP + H_WINDOW + H_AXIS;

const Y_OVER = 0;
const Y_EVENT = H_OVER + GAP;
const Y_WINDOW = Y_EVENT + H_EVENT + GAP;
const Y_AXIS = Y_WINDOW + H_WINDOW;

const GAP_SEC = 1.0;
const RATES = [0.25, 1, 2, 4];

/** 事件軌上下兩半：密度直方圖 11 px、篩選刻痕 7 px、中間 2 px 縫。 */
const H_HIST = 11;
const H_TICK = 7;
/**
 * 直方圖與刻痕共用同一組桶（5 px，實畫 4 px → 永遠留得下 1 px 縫，不會糊成一條帶）。
 * 兩層必須同桶：不同桶寬會讓某一根灰柱底下剛好沒有刻痕，看起來像「這一顆被篩掉了」，
 * 而其實只是量化誤差。同桶之後，灰柱底下沒有刻痕就真的只有一個意思——被篩掉了。
 */
const BUCKET = 5;
const BAR_W = BUCKET - 1;

/** 嚴重度：同一格只留最嚴重的那一顆，低階被高階蓋掉，不會反過來。 */
const RANK: Record<string, number> = { info: 1, ok: 2, warn: 3, err: 4 };

/**
 * 列名（總覽 / 事件）是中文，必須走介面字體：等寬字沒有這些漢字，
 * fallback 之後兩個列名的字寬對不齊，而它們是靠右對齊到同一條線上的。
 * 數字與時間刻度才走 numFont()。
 */
function uiFont(fsXs: string, fontUi: string): string {
  return (parseFloat(fsXs) || 12) + "px " + fontUi;
}

export function TimeBar({
  log = liveLog,
  events = [],
  selected,
  bookmarks = [],
  overviewKey = K.sl,
  padLeft = 54,
  padRight = 12,
  hotkeys = true,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const cvRef = useRef<HTMLCanvasElement>(null);
  const evRef = useRef({ events, selected: selected ?? events, bookmarks });
  evRef.current = { events, selected: selected ?? events, bookmarks };
  const padRef = useRef({ padLeft, padRight });
  padRef.current = { padLeft, padRight };

  useCursor(); // 播放狀態 / 速率 / live 燈是 React 這一層在顯示

  // ── Canvas：三層 ────────────────────────────────────────────────────
  useEffect(() => {
    const cv = cvRef.current;
    const wrap = wrapRef.current;
    if (!cv || !wrap) return;
    let hatch: CanvasPattern | string | null = null;

    const bounds = () => {
      const [a, b] = log.tRange;
      // 空 log 時給一個 1 秒的假範圍，免得 x 換算除以 0
      return b > a ? [a, b] : [a, a + 1];
    };

    const geom = () => {
      const [a, b] = bounds();
      const pad = padRef.current;
      return {
        x0: pad.padLeft,
        w: Math.max(1, cv.clientWidth - pad.padLeft - pad.padRight),
        t0: a,
        t1: b,
      };
    };

    const draw = () => {
      const fit = fitCanvas(cv, TOTAL_H);
      if (!fit) return;
      const { ctx } = fit;
      const p = palette();
      const fUi = uiFont(p.fsXs, p.fontUi);
      const g = geom();
      const { x0, w, t0: tMin, t1: tMax } = g;
      if (!hatch) hatch = hatchPattern(ctx, p.gap);

      const X = (t: number) => tToX(t, tMin, tMax, x0, w);

      // ── ① 總覽波形：整場縮圖，永遠全長 ──
      ctx.fillStyle = p.surface1;
      ctx.fillRect(x0, Y_OVER, w, H_OVER);
      const ws = log.sampleWindow(overviewKey, tMin, tMax, Math.max(200, w * 2));
      if (ws.n > 1) {
        let lo = Infinity;
        let hi = -Infinity;
        for (let i = 0; i < ws.n; i++) {
          if (ws.ys[i] < lo) lo = ws.ys[i];
          if (ws.ys[i] > hi) hi = ws.ys[i];
        }
        const span = hi - lo || 1;
        ctx.beginPath();
        ctx.moveTo(X(ws.xs[0]), Y_OVER + H_OVER);
        for (let i = 0; i < ws.n; i++) {
          ctx.lineTo(X(ws.xs[i]), Y_OVER + H_OVER - ((ws.ys[i] - lo) / span) * (H_OVER - 2) - 1);
        }
        ctx.lineTo(X(ws.xs[ws.n - 1]), Y_OVER + H_OVER);
        ctx.closePath();
        // 總覽是「我在哪裡」的地圖，不是第七條資料線：單色，
        // 用任何一個 series 色都會讓它被讀成一條訊號。
        // 但也不能用 --border-c（1.6:1）——那在頁底上幾乎看不見，地圖就空了。
        ctx.fillStyle = withAlpha(p.textDim, 0.22);
        ctx.fill();
        ctx.strokeStyle = withAlpha(p.textDim, 0.55);
        ctx.lineWidth = 1;
        ctx.stroke();
      } else {
        ctx.fillStyle = p.stale;
        ctx.font = fUi;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText("尚無資料", x0 + 4, Y_OVER + H_OVER / 2);
      }
      ctx.fillStyle = p.textDim;
      ctx.font = fUi;
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillText("總覽", x0 - 5, Y_OVER + H_OVER / 2, x0 - 8);

      // ── ② 事件軌：缺口 → 書籤 → 事件（後畫的蓋在上面）──
      ctx.fillStyle = p.surface1;
      ctx.fillRect(x0, Y_EVENT, w, H_EVENT);
      ctx.save();
      ctx.fillStyle = hatch as string;
      for (const gp of log.gaps(GAP_SEC)) {
        const gx0 = X(gp.t0);
        const gx1 = X(gp.t1);
        ctx.fillRect(gx0, Y_EVENT, Math.max(2, gx1 - gx0), H_EVENT);
      }
      ctx.restore();

      // 一場 484 秒的 PIT 練習有 580 個事件；畫在 1300 px 上是每 2 px 一顆 ▲■●○，
      // 疊出來是一條糊掉的彩帶——看起來像「整場都在出事」，其實什麼都沒說。
      // 改成回答使用者真正的那兩個問題，上下各佔一半軌高：
      //   上半（密度直方圖）：事件集中在哪一段？
      //   下半（篩選刻痕）  ：我現在篩的那一類，落在哪幾個時刻？
      const yHist = Y_EVENT;
      const yTick = Y_EVENT + H_HIST + 2;

      const nb = Math.max(1, Math.ceil(w / BUCKET));
      const counts = new Int32Array(nb);
      let peak = 0;
      for (const ev of evRef.current.events) {
        if (ev.t < tMin || ev.t > tMax) continue;
        const i = Math.min(nb - 1, Math.max(0, Math.floor((X(ev.t) - x0) / BUCKET)));
        const c = ++counts[i];
        if (c > peak) peak = c;
      }
      if (peak > 0) {
        // 一顆事件畫 30% 高、峰值畫滿。純比例（c / peak）在 peak = 1 的 log 上會
        // 讓每一顆都畫成滿高，於是「密度圖」退化成一排等高的柵欄——那正是要修掉的東西。
        ctx.fillStyle = p.textDim;
        const span = peak > 1 ? peak - 1 : 1;
        for (let i = 0; i < nb; i++) {
          const c = counts[i];
          if (c === 0) continue;
          const h = Math.max(2, Math.round(H_HIST * (0.3 + 0.7 * ((c - 1) / span))));
          ctx.fillRect(x0 + i * BUCKET, yHist + H_HIST - h, BAR_W, h);
        }
      }

      // 刻痕：與直方圖同桶，一格只留最嚴重的那一顆（低階被高階蓋掉，不會反過來）。
      const ticks = new Uint8Array(nb);
      for (const ev of evRef.current.selected) {
        if (ev.t < tMin || ev.t > tMax) continue;
        const i = Math.min(nb - 1, Math.max(0, Math.floor((X(ev.t) - x0) / BUCKET)));
        const r = RANK[ev.level ?? "info"] ?? 1;
        if (r > ticks[i]) ticks[i] = r;
      }
      const TONE = [p.textDim, p.stale, p.ok, p.warn, p.err];
      for (let i = 0; i < nb; i++) {
        const r = ticks[i];
        if (r === 0) continue;
        ctx.fillStyle = TONE[r];
        ctx.fillRect(x0 + i * BUCKET, yTick, BAR_W, H_TICK);
      }
      // 書籤是使用者自己放的記號（＝這裡連著人的操作）→ 橘，且永遠畫在最上層。
      // 用倒三角不用 ⚑：字形字體一換就變寬，畫布上的字元寬度不能靠字體運氣。
      for (const bm of evRef.current.bookmarks) {
        if (bm.t < tMin || bm.t > tMax) continue;
        const bx = Math.round(X(bm.t));
        ctx.fillStyle = p.focusRing;
        ctx.beginPath();
        ctx.moveTo(bx - 3.5, Y_EVENT);
        ctx.lineTo(bx + 3.5, Y_EVENT);
        ctx.lineTo(bx, Y_EVENT + 6);
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillStyle = p.textDim;
      ctx.font = fUi;
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillText("事件", x0 - 5, Y_EVENT + H_EVENT / 2, x0 - 8);

      // ── ③ 視窗條 ──
      ctx.fillStyle = p.surface1;
      ctx.fillRect(x0, Y_WINDOW, w, H_WINDOW);
      ctx.strokeStyle = p.border;
      ctx.lineWidth = 1;
      ctx.strokeRect(x0 + 0.5, Y_WINDOW + 0.5, w - 1, H_WINDOW - 1);
      const wx0 = Math.max(x0, X(view.t0));
      const wx1 = Math.min(x0 + w, X(view.t1));
      // 8% / 12%：這是一個橫貫全寬的矩形，0.18 乘上這個面積就是一整片橘，
      // 直接吃掉「全頁橘色像素預算 < 2%」。邊界由 1px 的框線負責，不是由底色。
      ctx.fillStyle = withAlpha(p.focusRing, view.follow ? 0.12 : 0.08);
      ctx.fillRect(wx0, Y_WINDOW + 1, Math.max(2, wx1 - wx0), H_WINDOW - 2);
      ctx.strokeStyle = view.follow ? p.ok : p.focusRing;
      ctx.strokeRect(Math.round(wx0) + 0.5, Y_WINDOW + 1.5, Math.max(2, Math.round(wx1 - wx0)) - 1, H_WINDOW - 3);

      // 選區（三層貫穿，因為統計與匯出都吃它）
      const sel = cursor.selection;
      if (sel && sel.t1 > sel.t0) {
        ctx.fillStyle = withAlpha(p.focusRing, 0.14);
        const sx0 = X(Math.max(tMin, sel.t0));
        const sx1 = X(Math.min(tMax, sel.t1));
        if (sx1 > sx0) ctx.fillRect(sx0, Y_OVER, sx1 - sx0, Y_AXIS - Y_OVER);
      }

      // cursorT 貫穿三層 + 三角形把手
      const ct = cursor.cursorT;
      if (ct >= tMin && ct <= tMax) {
        const cx = Math.round(X(ct)) + 0.5;
        ctx.strokeStyle = p.focusRing;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx, Y_OVER);
        ctx.lineTo(cx, Y_AXIS);
        ctx.stroke();
        ctx.fillStyle = p.focusRing;
        ctx.beginPath();
        ctx.moveTo(cx - 4, Y_AXIS);
        ctx.lineTo(cx + 4, Y_AXIS);
        ctx.lineTo(cx, Y_AXIS - 5);
        ctx.closePath();
        ctx.fill();
      }
      const hv = cursor.hoverT;
      if (hv !== null && hv >= tMin && hv <= tMax) {
        ctx.save();
        ctx.strokeStyle = p.textDim;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        const hx = Math.round(X(hv)) + 0.5;
        ctx.moveTo(hx, Y_OVER);
        ctx.lineTo(hx, Y_AXIS);
        ctx.stroke();
        ctx.restore();
      }

      // ── 時間刻度 ──
      const span = tMax - tMin;
      const step = niceStep(span, Math.max(3, Math.floor(w / 90)));
      ctx.fillStyle = p.textDim;
      ctx.font = numFont();
      ctx.textBaseline = "top";
      ctx.textAlign = "center";
      let lastTickX = -Infinity;
      // 最小間距以「最長的一個標籤」為準：t 跑到 9048.520 時一個標籤就 58 px，
      // 只靠 niceStep 的格數推估會在很短的全長（例如剛開機的 1 秒）下疊成一條黑線。
      const minGap = ctx.measureText(fmtT(tMax, span)).width + 14;
      // 右端那顆標籤是右對齊的，所以它真正吃掉的寬度要量，不能寫死 46——
      // 全長跑到四位數時 `2386.274 s` 是 66 px，寫死 46 會讓最後一格刻度
      // 直接疊在它身上（實測右下角是 `2386.240` 與 `2386.274 s` 糊成一團）。
      const endLabel = fmtT(tMax, span) + " s";
      const endW = ctx.measureText(endLabel).width;
      // 刻度是置中對齊的，所以要擋的是它的**右緣**，不是它的中心：
      // 中心離右端 78 px 看起來很安全，但標籤本身有 58 px 寬，右緣其實已經
      // 壓進總長標籤裡了（實測 `3341.060` 與 `3341.082 s` 疊在一起）。
      const halfTick = minGap / 2;
      for (let t = Math.ceil(tMin / step) * step; t <= tMax; t += step) {
        const x = X(t);
        if (x + halfTick > x0 + w - endW - 8) break;
        if (x - lastTickX < minGap) continue;
        ctx.fillText(fmtT(t, span), x, Y_AXIS + 1);
        lastTickX = x;
      }
      ctx.textAlign = "right";
      ctx.fillText(endLabel, x0 + w, Y_AXIS + 1);
    };

    let raf = 0;
    let lastLog = -1;
    let lastView = -1;
    let lastCur = -1;
    let lastHover: number | null = null;
    let lastW = -1;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      // 資料尾端推著視窗與 live 游標走（follow 為 false 時 syncTail 不動視窗）
      const [a, b] = bounds();
      view.setBounds(a, b);
      if (cursor.liveLock) cursor.followTail(b);

      const lv = log.getVersion();
      const vv = view.getVersion();
      const cvv = cursor.getVersion();
      const hv = cursor.hoverT;
      const w = cv.clientWidth;
      if (lv === lastLog && vv === lastView && cvv === lastCur && hv === lastHover && w === lastW) return;
      lastLog = lv;
      lastView = vv;
      lastCur = cvv;
      lastHover = hv;
      lastW = w;
      draw();
    };
    raf = requestAnimationFrame(tick);

    const stopSize = observeSize(wrap, draw);
    const detach = attachPanZoom(cv, {
      geom,
      wheelZoom: true,
      dragPan: true,
      panInvert: true, // 這裡拖的是「視窗」不是「內容」：往右拖 = 視窗往右
      shiftSelect: true,
      hover: true,
      onClick: (t) => {
        cursor.setCursor(t, true);
        // 點在視窗外 = 「我要去那裡」，把視窗搬過去而不是只移游標
        if (t < view.t0 || t > view.t1) view.setWindow(t - view.span / 2, t + view.span / 2);
      },
    });

    return () => {
      cancelAnimationFrame(raf);
      stopSize();
      detach();
    };
  }, [log, overviewKey]);

  // ── 播放：rAF 推進 cursorT，不是 setInterval ────────────────────────
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      raf = requestAnimationFrame(step);
      const dt = (now - last) / 1000;
      last = now;
      if (!cursor.playing) return;
      const [, tMax] = log.tRange;
      const next = cursor.cursorT + dt * cursor.playRate;
      if (next >= tMax) {
        cursor.setCursor(tMax, true);
        cursor.setPlaying(false);
        return;
      }
      cursor.setCursor(next, true);
      // 播到視窗右緣就把視窗往前推，游標不會跑出畫面
      if (next > view.t1 - view.span * 0.1) view.setWindow(next - view.span * 0.9, next + view.span * 0.1);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [log]);

  // ── 快捷鍵（§5.1 的時間子集）────────────────────────────────────────
  useEffect(() => {
    if (!hotkeys) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable) return;
      // Ctrl 組合鍵是別人的（Ctrl+\ 縮放到 RUN 區間、Ctrl+B 書籤、Ctrl+F 篩選）：
      // 在這裡就讓開，而不是指望呼叫端記得 stopPropagation。
      if (e.metaKey || e.altKey || e.ctrlKey) return;
      const [tMin, tMax] = log.tRange;
      switch (e.key) {
        case " ":
          e.preventDefault();
          cursor.setPlaying(!cursor.playing);
          break;
        case "ArrowLeft":
        case "ArrowRight": {
          e.preventDefault();
          const dir = e.key === "ArrowRight" ? 1 : -1;
          const t = e.shiftKey ? cursor.cursorT + dir : stepSample(log, cursor.cursorT, dir);
          cursor.setCursor(Math.min(tMax, Math.max(tMin, t)), true);
          break;
        }
        case "Home":
          e.preventDefault();
          cursor.setCursor(tMin, true);
          view.setWindow(tMin, tMin + view.span);
          break;
        case "End":
          e.preventDefault();
          cursor.setCursor(tMax, true);
          view.setFollow(true);
          break;
        case "l":
        case "L":
          e.preventDefault();
          view.setFollow(true);
          cursor.setCursor(tMax, false);
          break;
        case "[":
          e.preventDefault();
          cursor.setSelectionStart(cursor.cursorT);
          break;
        case "]":
          e.preventDefault();
          cursor.setSelectionEnd(cursor.cursorT);
          break;
        case "\\":
          e.preventDefault();
          cursor.setSelection(null);
          break;
        case "1":
          cursor.setPlayRate(0.25);
          break;
        case "2":
          cursor.setPlayRate(1);
          break;
        case "4":
          cursor.setPlayRate(4);
          break;
        default:
          return;
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [hotkeys, log]);

  const sel = cursor.selection;
  const span = Math.max(1e-6, log.tRange[1] - log.tRange[0]);
  const hover = cursor.hoverT;

  return (
    <div className="tb-wrap" ref={wrapRef}>
      <div className="tb-controls" style={{ paddingLeft: padLeft }}>
        <button className="tb-btn" title="後退 1 秒（←）" onClick={() => cursor.setCursor(cursor.cursorT - 1, true)}>
          {"◀◀"}
        </button>
        <button
          className={cursor.playing ? "tb-btn on" : "tb-btn"}
          title="播放 / 暫停（Space）"
          onClick={() => cursor.setPlaying(!cursor.playing)}
        >
          {cursor.playing ? "⏸" : "▶"}
        </button>
        <button className="tb-btn" title="前進 1 秒（→）" onClick={() => cursor.setCursor(cursor.cursorT + 1, true)}>
          {"▶▶"}
        </button>
        <span className="tb-rates">
          {RATES.map((r) => (
            <button
              key={r}
              className={cursor.playRate === r ? "tb-btn rate on" : "tb-btn rate"}
              onClick={() => cursor.setPlayRate(r)}
            >
              {r}x
            </button>
          ))}
        </span>
        <span className="tb-read">
          <span className="k">t</span>
          <span className="fgc-num">{fmtT(cursor.cursorT, view.span)}</span>
          <span className="fgc-unit">s</span>
        </span>
        <span className="tb-read">
          <span className="k">{"Δ"}</span>
          <span className="fgc-num">{hover === null ? "—" : (hover - cursor.cursorT >= 0 ? "+" : "") + fmtT(hover - cursor.cursorT, view.span)}</span>
        </span>
        <span className="tb-read">
          <span className="k">選取</span>
          <span className="fgc-num">
            {sel && sel.t1 > sel.t0 ? `${fmtT(sel.t0, view.span)}→${fmtT(sel.t1, view.span)}（${(sel.t1 - sel.t0).toFixed(2)} s）` : "—"}
          </span>
        </span>
        <span className="spacer" />
        <span className="tb-read">
          <span className="k">窗</span>
          <span className="fgc-num">{view.span.toFixed(view.span < 10 ? 1 : 0)}</span>
          <span className="fgc-unit">s / 全長 {span.toFixed(0)} s</span>
        </span>
        <button
          className={view.follow ? "tb-live on" : "tb-live"}
          title="往左捲會脫離即時；捲到最右或按 L 自動接回"
          onClick={() => view.setFollow(!view.follow)}
        >
          <span className={view.follow ? "fgc-dot ok" : "fgc-dot"} />
          {view.follow ? "live" : "已脫離即時 · L"}
        </button>
      </div>
      <canvas ref={cvRef} style={{ width: "100%", height: TOTAL_H }} />
    </div>
  );
}

/**
 * 單步一個「樣本」= 一批推播。
 * 批次時戳就是 /FGC/Status/Match s 的變化點——它每圈重算且必然變動，
 * 所以每一批 nt 都帶著它（§0）。沒有這個 key（舊格式）就退回視窗的 1/200。
 */
function stepSample(log: LogStore, t: number, dir: 1 | -1): number {
  const cp = log.changePoints(K.matchS);
  if (cp.length < 2) return t + dir * (view.span / 200);
  let lo = 0;
  let hi = cp.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cp[mid] <= t) {
      idx = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (dir > 0) {
    // 落在樣本上就往後一格；落在兩點之間就跳到下一個樣本
    const next = idx < 0 ? 0 : cp[idx] === t ? idx + 1 : idx + 1;
    return cp[Math.min(cp.length - 1, next)];
  }
  const prev = idx <= 0 ? 0 : cp[idx] === t ? idx - 1 : idx;
  return cp[Math.max(0, prev)];
}

/** 給呼叫端把畫布上的 x 換回時間（例如自訂的右鍵選單）。 */
export function timeAtX(log: LogStore, x: number, x0: number, w: number): number {
  const [a, b] = log.tRange;
  return xToT(x, a, b > a ? b : a + 1, x0, w);
}
