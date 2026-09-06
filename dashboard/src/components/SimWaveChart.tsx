// 離線模擬用的波形圖：直接吃陣列，不經 store.history。
//
// 為什麼不共用 Chart.tsx：那支是「訂閱 NT key、跟著時間往前滾」的即時圖，
// 沒接機器時根本沒有資料流。模擬出來的 v(t)/ω(t) 是一次算完的完整曲線，
// 需要的是固定 x 軸（0 → 總時間）而不是滑動視窗。
import { useEffect, useRef } from "react";

export interface WaveSeries {
  label: string;
  color: string;
  dash?: boolean;
  values: number[]; // 與 t 等長
}

interface Props {
  title: string;
  t: number[]; // 秒
  series: WaveSeries[];
  height?: number;
  /** 游標位置（秒）；用來把波形與 XY 軌跡上的位置對起來 */
  cursorT?: number;
}

export function SimWaveChart({ title, t, series, height = 190, cursorT }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef({ t, series, cursorT, title });
  propsRef.current = { t, series, cursorT, title };
  // 讓「重畫」這件事可以從 render 觸發，而不是掛一個永遠在跑的計時器：
  // 模擬波形是一次算完的靜態曲線，只有輸入變了才需要重畫。掛計時器不只浪費，
  // 還會讓畫面永遠沒有靜止幀（截圖/錄影工具會一直等不到穩定畫面）。
  const drawRef = useRef<() => void>(() => {});

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;

    const draw = () => {
      const { t, series, cursorT, title } = propsRef.current;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (!w || !h) return;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const padL = 46, padR = 10, padT = 22, padB = 34;
      const plotW = w - padL - padR;
      const plotH = h - padT - padB;

      ctx.fillStyle = "#dfe6f0";
      ctx.font = "12px sans-serif";
      ctx.fillText(title, padL, 14);

      if (!t.length || plotW <= 0 || plotH <= 0) {
        ctx.fillStyle = "#8b95a7";
        ctx.font = "11px sans-serif";
        ctx.fillText("（無資料）", padL, padT + plotH / 2);
        return;
      }

      // y 範圍取所有序列的包絡，且一定含 0（看得出正負與零速）
      let lo = 0, hi = 0;
      for (const s of series)
        for (const v of s.values) {
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      if (hi - lo < 1e-9) hi = lo + 1;
      const pad = (hi - lo) * 0.08;
      lo -= pad;
      hi += pad;

      const tMax = t[t.length - 1] || 1;
      const toX = (v: number) => padL + (v / tMax) * plotW;
      const toY = (v: number) => padT + plotH - ((v - lo) / (hi - lo)) * plotH;

      // 格線 + 座標軸標示
      ctx.strokeStyle = "#2a3040";
      ctx.lineWidth = 1;
      ctx.fillStyle = "#8b95a7";
      ctx.font = "10px sans-serif";
      for (let i = 0; i <= 4; i++) {
        const yv = lo + ((hi - lo) * i) / 4;
        const y = toY(yv);
        ctx.beginPath();
        ctx.moveTo(padL, y);
        ctx.lineTo(padL + plotW, y);
        ctx.stroke();
        ctx.textAlign = "right";
        ctx.fillText(yv.toFixed(0), padL - 5, y + 3);
      }
      ctx.textAlign = "center";
      for (let i = 0; i <= 4; i++) {
        const tv = (tMax * i) / 4;
        const x = toX(tv);
        ctx.beginPath();
        ctx.moveTo(x, padT);
        ctx.lineTo(x, padT + plotH);
        ctx.stroke();
        ctx.fillText(`${tv.toFixed(1)}s`, x, h - 20);
      }
      ctx.textAlign = "start";

      // 零線畫粗一點（ω 會轉負，看得出過零點）
      if (lo < 0 && hi > 0) {
        ctx.strokeStyle = "#3a4152";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(padL, toY(0));
        ctx.lineTo(padL + plotW, toY(0));
        ctx.stroke();
      }

      for (const s of series) {
        ctx.strokeStyle = s.color;
        ctx.lineWidth = 1.8;
        ctx.setLineDash(s.dash ? [5, 4] : []);
        ctx.beginPath();
        for (let i = 0; i < t.length && i < s.values.length; i++) {
          const x = toX(t[i]);
          const y = toY(s.values[i]);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // 游標線：與 XY 軌跡圖的紅點同一個 t
      if (cursorT !== undefined && cursorT >= 0 && cursorT <= tMax) {
        ctx.strokeStyle = "#e57373";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(toX(cursorT), padT);
        ctx.lineTo(toX(cursorT), padT + plotH);
        ctx.stroke();
      }

      // 圖例
      let lx = padL;
      ctx.font = "10px sans-serif";
      for (const s of series) {
        ctx.fillStyle = s.color;
        ctx.fillRect(lx, h - 10, 10, 3);
        ctx.fillStyle = "#8b95a7";
        ctx.fillText(s.label, lx + 14, h - 6);
        lx += 16 + ctx.measureText(s.label).width + 12;
      }
    };

    drawRef.current = draw;
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [height]);

  // 每次 render 重畫一次（輸入變了才會 render），取代常駐計時器
  useEffect(() => {
    drawRef.current();
  });

  return (
    <div className="sim-wave" style={{ height }}>
      <canvas ref={ref} />
    </div>
  );
}
