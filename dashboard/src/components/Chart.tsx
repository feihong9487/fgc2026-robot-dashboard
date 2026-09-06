// uPlot 包裝：從 store 取指定 key 的歷史序列，10fps 重繪，自動跟隨時間窗。
//
// 軸色與格線走 theme.ts（§6.1）而不是硬編 hex —— Canvas 吃不到 CSS 變數，
// 而 uPlot 的 stroke 是「建立時就決定」的，所以主題換了必須重建一次圖，
// 否則切到 field 主題時整張圖還是暗色的軸（第三階段 D/E 都踩過這顆地雷）。
import { useEffect, useRef, useState } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { store } from "../lib/store";
import { palette, subscribeTheme } from "../fgc/lib/theme";

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

  // 主題版本：換主題時整張圖重建（uPlot 的 stroke 不是每幀重讀的）
  const [themeV, setThemeV] = useState(0);
  useEffect(() => subscribeTheme(() => setThemeV((v) => v + 1)), []);

  useEffect(() => {
    const el = divRef.current!;
    const pal = palette();
    const opts: uPlot.Options = {
      width: el.clientWidth || 400,
      height,
      title,
      cursor: { drag: { x: false, y: false } },
      legend: { live: true },
      scales: { x: { time: false } },
      axes: [
        {
          stroke: pal.textDim,
          grid: { stroke: pal.border },
          ticks: { stroke: pal.border },
          values: (_u, vs) => vs.map((v) => `${v.toFixed(0)}s`),
        },
        {
          stroke: pal.textDim,
          grid: { stroke: pal.border },
          ticks: { stroke: pal.border },
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
  }, [height, title, themeV]); // series/windowSec 變化經由 propsRef 熱更新

  return <div className="chart-box" ref={divRef} />;
}
