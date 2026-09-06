// uPlot 包裝：從 store 取指定 key 的歷史序列，10fps 重繪，自動跟隨時間窗
import { useEffect, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { store } from "../lib/store";

export interface ChartSeries {
  key: string;
  label: string;
  color: string;
  dash?: number[];
}

interface Props {
  title: string;
  series: ChartSeries[];
  windowSec: number;
  height?: number;
}

export function Chart({ title, series, windowSec, height = 220 }: Props) {
  const divRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const propsRef = useRef({ series, windowSec });
  propsRef.current = { series, windowSec };

  useEffect(() => {
    const el = divRef.current!;
    const opts: uPlot.Options = {
      width: el.clientWidth || 400,
      height,
      title,
      cursor: { drag: { x: false, y: false } },
      legend: { live: true },
      scales: { x: { time: false } },
      axes: [
        {
          stroke: "#8b95a7",
          grid: { stroke: "#2a3040" },
          ticks: { stroke: "#2a3040" },
          values: (_u, vs) => vs.map((v) => `${v.toFixed(0)}s`),
        },
        {
          stroke: "#8b95a7",
          grid: { stroke: "#2a3040" },
          ticks: { stroke: "#2a3040" },
          size: 56,
        },
      ],
      series: [
        {},
        ...series.map((s) => ({
          label: s.label,
          stroke: s.color,
          width: 1.5,
          dash: s.dash,
          points: { show: false },
        })),
      ],
    };
    const plot = new uPlot(opts, [[], ...series.map(() => [])], el);
    plotRef.current = plot;

    const ro = new ResizeObserver(() => {
      plot.setSize({ width: el.clientWidth, height });
    });
    ro.observe(el);

    const timer = window.setInterval(() => {
      const { series: ss, windowSec: win } = propsRef.current;
      const now = store.now();
      const tMin = now - win;

      // 合併所有序列的時間軸：取第一條有資料的序列當 x 軸基準，
      // 其他序列以最近值對齊（各序列同批到達，時間戳一致，直接用聯集即可）
      // 頭尾固定加入 tMin/now：不常變動的值（調參常數等）也會畫成
      // 延伸到現在的水平線，而不是一個看不見的孤點
      const xsSet = new Set<number>([tMin, now]);
      for (const s of ss) {
        const h = store.history.get(s.key);
        if (!h) continue;
        for (let i = h.t.length - 1; i >= 0 && h.t[i] >= tMin; i--)
          xsSet.add(h.t[i]);
      }
      const xs = Array.from(xsSet).sort((a, b) => a - b);
      const data: uPlot.AlignedData = [
        xs,
        ...ss.map((s) => {
          const h = store.history.get(s.key);
          if (!h) return xs.map(() => null);
          // 雙指標對齊
          const out: (number | null)[] = [];
          let j = 0;
          for (const x of xs) {
            while (j < h.t.length - 1 && h.t[j + 1] <= x) j++;
            out.push(h.t[j] <= x && j < h.v.length ? h.v[j] : null);
          }
          return out;
        }),
      ] as uPlot.AlignedData;

      plot.setData(data, false);
      plot.setScale("x", { min: tMin, max: now });
    }, 100);

    return () => {
      clearInterval(timer);
      ro.disconnect();
      plot.destroy();
      plotRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height, title]); // series/windowSec 變化經由 propsRef 熱更新

  return <div className="chart-box" ref={divRef} />;
}
