// 時間軸的共用零件：Canvas 高解析設定、x ↔ t 換算、滾輪縮放／拖曳平移／Shift 選區。
//
// DiscreteBand 與 TimeBar 都是手繪 Canvas（不是 uPlot），LineGraph 的 .u-over 也要
// 同一套滾輪行為，否則「在色帶上滾輪會縮放、在折線上滾輪會捲頁」這種不一致會直接
// 毀掉「三者共用一條 x 軸」的錯覺。所以互動邏輯抽在這裡，三個元件掛同一支。
//
// AutoFitCanvas 模式抄 FTC AutoFitCanvas.jsx:11-39：ResizeObserver + devicePixelRatio，
// 只多加 100 ms debounce（賽場上有人在拖視窗邊界時不該每 1 px 重配一次 backing store）。

import { cursor } from "../../lib/cursorStore";
import { view } from "./viewWindow";

/** 繪圖區左右內縮（給 uPlot 的軸讓位，色帶與時間軸才會與折線對齊）。 */
export interface Pads {
  left: number;
  right: number;
}

export const NO_PADS: Pads = { left: 0, right: 0 };

/** 值 → x 像素（CSS px）。 */
export function tToX(t: number, t0: number, t1: number, x0: number, w: number): number {
  const span = t1 - t0;
  if (!(span > 0)) return x0;
  return x0 + ((t - t0) / span) * w;
}

/** x 像素 → 值。 */
export function xToT(x: number, t0: number, t1: number, x0: number, w: number): number {
  if (!(w > 0)) return t0;
  return t0 + ((x - x0) / w) * (t1 - t0);
}

/**
 * 高解析 Canvas：回傳 CSS 尺寸，並把 ctx 縮放成「1 單位 = 1 CSS px」。
 * 回傳 null 代表元素還沒有尺寸（第一幀很常見），呼叫端直接跳過這一幀。
 */
export function fitCanvas(
  cv: HTMLCanvasElement,
  cssH: number,
): { ctx: CanvasRenderingContext2D; w: number; h: number } | null {
  const w = cv.clientWidth;
  if (!(w > 0) || !(cssH > 0)) return null;
  const dpr = window.devicePixelRatio || 1;
  const needW = Math.round(w * dpr);
  const needH = Math.round(cssH * dpr);
  if (cv.width !== needW || cv.height !== needH) {
    cv.width = needW;
    cv.height = needH;
  }
  const ctx = cv.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, cssH);
  return { ctx, w, h: cssH };
}

/** 100 ms debounce 的 ResizeObserver。 */
export function observeSize(el: Element, fn: () => void, debounceMs = 100): () => void {
  let timer = 0;
  const ro = new ResizeObserver(() => {
    window.clearTimeout(timer);
    timer = window.setTimeout(fn, debounceMs);
  });
  ro.observe(el);
  return () => {
    window.clearTimeout(timer);
    ro.disconnect();
  };
}

/** 斜線紋：資料缺口專用。實色會被讀成「這段是 0」，斜線才讀得出「這段沒有資料」。 */
export function hatchPattern(ctx: CanvasRenderingContext2D, color: string): CanvasPattern | string {
  const tile = document.createElement("canvas");
  tile.width = 8;
  tile.height = 8;
  const c = tile.getContext("2d");
  if (!c) return color;
  c.strokeStyle = color;
  c.lineWidth = 1.5;
  c.beginPath();
  c.moveTo(-2, 10);
  c.lineTo(10, -2);
  c.moveTo(2, 14);
  c.lineTo(14, 2);
  c.stroke();
  return ctx.createPattern(tile, "repeat") ?? color;
}

export interface PanZoomOpts {
  /** 目前的繪圖幾何（每次事件都重讀，因為視窗與 padding 隨時在變）。 */
  geom: () => { x0: number; w: number; t0: number; t1: number };
  /** 滾輪縮放（以指標為中心）。 */
  wheelZoom?: boolean;
  /** 按住拖曳平移。 */
  dragPan?: boolean;
  /** Shift + 拖曳框選區間。 */
  shiftSelect?: boolean;
  /** 點擊設定 cursorT（拖曳超過 3 px 就不算點擊）。 */
  clickSeek?: boolean;
  /** 覆寫點擊行為（TimeBar 點在視窗外時要順便把視窗搬過去）。 */
  onClick?: (t: number, e: MouseEvent) => void;
  /** 滑鼠移動時更新 hoverT（60 Hz，不進 React state）。 */
  hover?: boolean;
  /** 拖曳平移的方向：TimeBar 的視窗條拖右邊 = 視窗往右，折線圖拖右邊 = 內容往右。 */
  panInvert?: boolean;
}

/**
 * 掛上滾輪縮放 / 拖曳平移 / Shift 選區 / 點擊 seek。
 * wheel 必須 passive:false，否則 preventDefault 無效、整頁會跟著捲。
 */
export function attachPanZoom(el: HTMLElement, opts: PanZoomOpts): () => void {
  const { geom } = opts;
  let dragging = false;
  let selecting = false;
  let moved = 0;
  let lastX = 0;
  let selT0 = 0;

  const tAt = (e: MouseEvent | WheelEvent): number => {
    const r = el.getBoundingClientRect();
    const g = geom();
    return xToT(e.clientX - r.left, g.t0, g.t1, g.x0, g.w);
  };

  const onWheel = (e: WheelEvent) => {
    if (opts.wheelZoom === false) return;
    e.preventDefault();
    // 一格滾輪 = 1.2 倍；trackpad 的細碎 delta 用 sign 收斂成同一步長，
    // 否則兩指捏合會把視窗縮到 0.25 s 再彈回來。
    view.zoomAt(tAt(e), e.deltaY > 0 ? 1.2 : 1 / 1.2);
  };

  const onDown = (e: MouseEvent) => {
    if (e.button !== 0) return;
    moved = 0;
    lastX = e.clientX;
    if (e.shiftKey && opts.shiftSelect) {
      selecting = true;
      selT0 = tAt(e);
      cursor.setSelection({ t0: selT0, t1: selT0 });
    } else if (opts.dragPan) {
      dragging = true;
    }
    if (dragging || selecting) {
      // 用 window 監聽而不是 pointer capture：拖到畫面外再放開也要收得到 mouseup，
      // 否則視窗會黏在滑鼠上跟著走。
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
      e.preventDefault();
    }
  };

  const onMove = (e: MouseEvent) => {
    moved += Math.abs(e.clientX - lastX);
    if (selecting) {
      cursor.setSelection({ t0: selT0, t1: tAt(e) });
    } else if (dragging) {
      const g = geom();
      const perPx = g.w > 0 ? (g.t1 - g.t0) / g.w : 0;
      const dx = e.clientX - lastX;
      view.panBy(opts.panInvert ? dx * perPx : -dx * perPx);
    }
    lastX = e.clientX;
  };

  const onUp = (e: MouseEvent) => {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
    if (moved < 3) {
      if (selecting) cursor.setSelection(null);
      if (opts.onClick) opts.onClick(tAt(e), e);
      else if (opts.clickSeek !== false) cursor.setCursor(tAt(e), true);
    }
    dragging = false;
    selecting = false;
  };

  const onHover = (e: MouseEvent) => {
    if (opts.hover === false) return;
    cursor.setHover(tAt(e));
  };

  const onLeave = () => {
    if (opts.hover === false) return;
    cursor.setHover(null);
  };

  el.addEventListener("wheel", onWheel, { passive: false });
  el.addEventListener("mousedown", onDown);
  el.addEventListener("mousemove", onHover);
  el.addEventListener("mouseleave", onLeave);
  return () => {
    el.removeEventListener("wheel", onWheel);
    el.removeEventListener("mousedown", onDown);
    el.removeEventListener("mousemove", onHover);
    el.removeEventListener("mouseleave", onLeave);
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
  };
}

/** #rrggbb → rgba()。目標線與實測線必須同色，差別只在透明度與虛線。 */
export function withAlpha(color: string, alpha: number): string {
  const c = color.trim();
  if (c.startsWith("#")) {
    const hex = c.slice(1);
    const full =
      hex.length === 3
        ? hex
            .split("")
            .map((h) => h + h)
            .join("")
        : hex;
    if (full.length >= 6) {
      const r = parseInt(full.slice(0, 2), 16);
      const g = parseInt(full.slice(2, 4), 16);
      const b = parseInt(full.slice(4, 6), 16);
      return `rgba(${r},${g},${b},${alpha})`;
    }
  }
  if (c.startsWith("rgb(")) return c.replace("rgb(", "rgba(").replace(")", `,${alpha})`);
  return c;
}

/** 時間軸刻度：挑一個 1/2/5 × 10^n 的間隔，讓標籤數落在 4–10 之間。 */
export function niceStep(span: number, targetTicks = 6): number {
  if (!(span > 0)) return 1;
  const raw = span / targetTicks;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = norm >= 5 ? 5 : norm >= 2 ? 2 : 1;
  return step * mag;
}

/** 秒 → 顯示字串；視窗越短小數位越多（20 s 視窗看 0.1 s、1 s 視窗看 0.01 s）。 */
export function fmtT(t: number, span: number): string {
  const d = span < 2 ? 3 : span < 20 ? 2 : span < 200 ? 1 : 0;
  return t.toFixed(d);
}
