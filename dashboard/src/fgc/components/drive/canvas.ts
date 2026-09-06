// DRIVE 高頻視覺的繪圖底座：AutoFitCanvas + rAF，完全繞過 React。
//
// 為什麼不用 React 畫：巨燈、雙環、爬升柱、按鍵燈條全部是 20 Hz 資料的即時投影，
// 走 state 就是每秒 20 次 × 5 棵子樹的 reconcile。這裡的 draw 每幀直接讀 LogStore，
// React 只負責「這個面板存不存在」。這是 VMX 既有 Chart.tsx:69-104 的做法，保留並擴大。
//
// ResizeObserver + devicePixelRatio 抄 FTC AutoFitCanvas.jsx:11-39，加 100 ms debounce：
// 拖視窗邊框時每一幀都重配 backing store 會讓整頁掉幀。
//
// 分頁隱藏（document.hidden）時整條 rAF 停掉——比賽日筆電常常開著別的視窗，
// 這是「DRIVE idle CPU < 3%」最便宜的一刀。

import { useEffect, useRef, type RefObject } from "react";

export interface Frame {
  ctx: CanvasRenderingContext2D;
  /** CSS 像素（已經套好 dpr transform，畫圖一律用這組數字）。 */
  w: number;
  h: number;
  dpr: number;
  /** performance.now() 毫秒。 */
  t: number;
  /** 距上一幀的秒數，已夾限在 0..0.1（分頁切回來時不會爆衝）。 */
  dt: number;
}

const RESIZE_DEBOUNCE_MS = 100;

/**
 * 綁一個自適應 canvas 並每幀呼叫 draw。
 * canvas 自己要有 CSS 尺寸（width:100%;height:100%;display:block）。
 */
export function useCanvasFrame(draw: (f: Frame) => void): RefObject<HTMLCanvasElement> {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef(draw);
  drawRef.current = draw;

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;

    let w = 0;
    let h = 0;
    let dpr = 1;
    let raf = 0;
    let last = performance.now();
    let resizeTimer = 0;
    let alive = true;

    const applySize = () => {
      const rect = cv.getBoundingClientRect();
      const nw = Math.max(1, Math.round(rect.width));
      const nh = Math.max(1, Math.round(rect.height));
      const ndpr = Math.min(window.devicePixelRatio || 1, 3);
      if (nw === w && nh === h && ndpr === dpr) return;
      w = nw;
      h = nh;
      dpr = ndpr;
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    };

    applySize();

    const ro = new ResizeObserver(() => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(applySize, RESIZE_DEBOUNCE_MS);
    });
    ro.observe(cv);

    const loop = (t: number) => {
      if (!alive) return;
      raf = requestAnimationFrame(loop);
      if (document.hidden || w === 0 || h === 0) {
        last = t;
        return;
      }
      const dt = Math.min(0.1, Math.max(0, (t - last) / 1000));
      last = t;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      drawRef.current({ ctx, w, h, dpr, t, dt });
    };
    raf = requestAnimationFrame(loop);

    const onVis = () => {
      last = performance.now();
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      window.clearTimeout(resizeTimer);
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return ref;
}

/**
 * 沒有 canvas 的 rAF 迴圈：給「只要改一個 DOM 節點的 textContent」的元件用
 * （MatchClock 的秒數、球節奏的間隔）。同樣不進 React state。
 * hz 用來降頻——時鐘沒必要一秒跑 60 次。
 */
export function useFrame(cb: (t: number, dt: number) => void, hz = 60): void {
  const cbRef = useRef(cb);
  cbRef.current = cb;
  useEffect(() => {
    let raf = 0;
    let alive = true;
    let last = performance.now();
    let acc = 0;
    const period = 1000 / hz;
    const loop = (t: number) => {
      if (!alive) return;
      raf = requestAnimationFrame(loop);
      const dtMs = t - last;
      last = t;
      if (document.hidden) return;
      acc += dtMs;
      if (acc < period) return;
      const dt = Math.min(0.5, acc / 1000);
      acc = 0;
      cbRef.current(t, dt);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, [hz]);
}

/**
 * 0.15 s 線性緩動（§6.7）。刻意不用 ease 曲線：ease 會讓人誤判「到位時間」，
 * 而線性只是把 20 Hz 的抖動抹平，不製造不存在的動態。
 * range = 這個量的滿刻度，決定「跑完全程要 0.15 s」的速度。
 */
export function approach(cur: number, target: number, dt: number, range: number): number {
  if (!Number.isFinite(cur)) return target;
  const step = (range / 0.15) * dt;
  const d = target - cur;
  if (Math.abs(d) <= step) return target;
  return cur + Math.sign(d) * step;
}

/** 圓角矩形（Path2D 版本在 Chromium 以外還不穩，自己畫）。 */
export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

/** 介面字體堆疊（Canvas 吃不到 CSS 變數，這裡是唯一的字體真相）。 */
export const UI_FONT = '"Noto Sans TC", "Microsoft JhengHei", "PingFang TC", system-ui, sans-serif';
/** 所有數值一律等寬：比例字體會讓數字在更新時橫向跳動。 */
export const MONO_FONT = 'ui-monospace, "Cascadia Mono", Consolas, monospace';

/** 帶 alpha 的顏色（token 是 hex，Canvas 需要 rgba 才畫得出容差帶）。 */
export function alpha(hex: string, a: number): string {
  const h = hex.trim();
  if (!h.startsWith("#")) return h;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h.length === 4) {
    r = parseInt(h[1] + h[1], 16);
    g = parseInt(h[2] + h[2], 16);
    b = parseInt(h[3] + h[3], 16);
  } else if (h.length >= 7) {
    r = parseInt(h.slice(1, 3), 16);
    g = parseInt(h.slice(3, 5), 16);
    b = parseInt(h.slice(5, 7), 16);
  } else {
    return h;
  }
  return `rgba(${r},${g},${b},${a})`;
}
