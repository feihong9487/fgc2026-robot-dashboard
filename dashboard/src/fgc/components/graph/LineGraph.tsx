// LineGraph（§3.3 #18）：三區軸折線。既有 Chart.tsx（116 行）的重寫版。
//
// 相對於 Chart.tsx 改掉的六件事：
//   1. 只有一個 y 軸  → 左軸 / 右軸兩個 scale，序列自己宣告要掛哪一個
//   2. 硬編 #8b95a7 / #2a3040 → 一律走 theme.ts（換主題時圖表跟著換）
//   3. cursor.drag 被主動關掉 → drag:{x:true,setScale:false} + setSelect 寫進 cursorStore
//   4. 沒有 cursor.sync → sync.key "fgc"，但 cursorStore 才是真相、uPlot 是被驅動方
//   5. 每 100 ms 用 Set 收時戳再 sort → LogStore.sampleWindow 已排序，改 k-way merge
//   6. 目標值畫成折線 → uPlot.paths.stepped（COLLECT 時目標是 IDLE_TPS、way 是負值，
//      用線性內插畫會把「way 反轉」誤讀成「送料壞掉」）
//
// 暫停的語意（刻意與 FTC GraphCanvas.jsx:48-50 相反）：暫停只跳過 setScale("x")，
// setData 繼續跑。所以「暫停 → 放大看剛剛那一下 → 恢復」不掉任何歷史。

import { useEffect, useRef, useState } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { LogStore, liveLog } from "../../lib/LogStore";
import { cursor } from "../../lib/cursorStore";
import { palette, seriesColor, subscribeTheme } from "../../lib/theme";
import { K, paramKey, shortName } from "../../lib/fgcKeys";
import { view } from "./viewWindow";
import { attachPanZoom, fmtT, observeSize, withAlpha } from "./timeAxis";

export type AxisSide = "left" | "right";

export interface GraphSeries {
  /** LogStore 的完整 key。 */
  key: string;
  label?: string;
  scale?: AxisSide;
  /** 不給就依索引取 series-1..8（SL / SR / Way 有固定綁定）。 */
  color?: string;
  unit?: string;
  /** 狀態機跳階值（目標、模式）一律階梯，不可線性內插。 */
  stepped?: boolean;
  /** 取樣率 < 10 Hz 的量（電流 ~2 Hz）畫散點，不畫平滑曲線。 */
  points?: boolean;
  dash?: number[];
}

/** 繪圖區的左右內距（CSS px）；色帶與時間軸靠它對齊同一條 x 軸。 */
export interface GraphGeom {
  padLeft: number;
  padRight: number;
  width: number;
}

interface Props {
  log?: LogStore;
  series: readonly GraphSeries[];
  height?: number;
  /** 暫停：跳過 setScale("x")，但 setData 不停。 */
  paused?: boolean;
  /** 目標階梯（TargetL / TargetR）＋ ±3% 容差帶。 */
  showTargets?: boolean;
  /** FEED_THRESHOLD 橫線；值讀 /FGC/Param/FEED_THRESHOLD 回讀值，不可寫死 1200。 */
  showThreshold?: boolean;
  syncKey?: string;
  onGeom?: (g: GraphGeom) => void;
  onDropKey?: (key: string, side: AxisSide) => void;
  emptyHint?: string;
}

interface Resolved extends GraphSeries {
  color: string;
  scale: AxisSide;
  isTarget: boolean;
}

export const DRAG_MIME = "application/x-fgc-key";
/** 缺口門檻：超過這麼久沒有任何一批推播就是斷流，波形必須斷開。 */
const GAP_SEC = 1.0;

/** SL / SR / Way 在每一張圖、每一次回放、每一份匯出都是同一組顏色（§6.5）。 */
const FIXED_COLOR: Record<string, number> = {
  [K.sl]: 0,
  [K.sr]: 1,
  [K.way]: 3,
};

export function colorForKey(key: string, fallbackIdx: number): string {
  const fixed = FIXED_COLOR[key];
  return seriesColor(fixed !== undefined ? fixed : fallbackIdx);
}

function resolve(series: readonly GraphSeries[], showTargets: boolean, log: LogStore): Resolved[] {
  const out: Resolved[] = series.map((s, i) => ({
    ...s,
    color: s.color ?? colorForKey(s.key, i),
    scale: s.scale ?? "left",
    isTarget: false,
  }));
  if (!showTargets) return out;
  // 目標與實測同色（+透明+虛線）：誤差 = 兩條同色線的距離，一眼就讀得出來。
  const pairs: [string, string][] = [
    [K.sl, K.targetL],
    [K.sr, K.targetR],
  ];
  for (const [measured, target] of pairs) {
    const m = out.find((s) => s.key === measured && !s.isTarget);
    if (!m || !log.has(target)) continue;
    if (out.some((s) => s.key === target)) continue;
    out.push({
      key: target,
      label: (m.label ?? shortName(measured)) + " 目標",
      color: withAlpha(m.color, 0.6),
      scale: m.scale,
      stepped: true,
      dash: [6, 4],
      isTarget: true,
    });
  }
  return out;
}

/**
 * 把 N 條各自稀疏的序列併成 uPlot 要的 AlignedData。
 *
 * 每條的 xs 已經是排序好的（LogStore 保證單調），所以這裡是 k-way merge 而不是
 * Set + sort —— diff 推播下這個差別是必須的：穩態 1900 tps 一秒可能只有兩個點，
 * 用 Set 收集出來的 x 軸既稀疏又要為每個序列補 null。
 *
 * 三種必須手工插入的 x：
 *   t0 / t1  端點，讓不常變動的值畫成延伸到視窗兩端的水平線而不是孤點
 *   缺口中點 值為 null，波形在資料缺口處斷開（絕不內插）
 */
function buildData(
  log: LogStore,
  res: readonly Resolved[],
  t0: number,
  t1: number,
  maxPts: number,
): { data: uPlot.AlignedData; decimated: boolean } {
  const wins = res.map((s) => log.sampleWindow(s.key, t0, t1, maxPts));
  const decimated = wins.some((w) => w.decimated);

  const gapMids: number[] = [];
  for (const g of log.gaps(GAP_SEC)) {
    if (g.t1 <= t0 || g.t0 >= t1) continue;
    gapMids.push((Math.max(t0, g.t0) + Math.min(t1, g.t1)) / 2);
  }

  let total = 2 + gapMids.length;
  for (const w of wins) total += w.n;
  const xs = new Float64Array(total);
  const isGap = new Uint8Array(total);

  const ptr = new Int32Array(wins.length);
  const extras = t1 > t0 ? [t0, t1] : [t0];
  let ei = 0;
  let gi = 0;
  let n = 0;
  let prev = NaN;

  // 合併：每一步取所有游標裡最小的 x（含端點與缺口中點），相同的 x 只留一份。
  for (;;) {
    let best = Infinity;
    for (let i = 0; i < wins.length; i++) {
      const w = wins[i];
      if (ptr[i] < w.n && w.xs[ptr[i]] < best) best = w.xs[ptr[i]];
    }
    if (ei < extras.length && extras[ei] < best) best = extras[ei];
    let bestGap = false;
    if (gi < gapMids.length && gapMids[gi] < best) {
      best = gapMids[gi];
      bestGap = true;
    }
    if (!Number.isFinite(best)) break;
    for (let i = 0; i < wins.length; i++) {
      const w = wins[i];
      while (ptr[i] < w.n && w.xs[ptr[i]] === best) ptr[i]++;
    }
    while (ei < extras.length && extras[ei] === best) ei++;
    while (gi < gapMids.length && gapMids[gi] === best) gi++;
    if (best !== prev && best >= t0 && best <= t1 && n < total) {
      xs[n] = best;
      isGap[n] = bestGap ? 1 : 0;
      n++;
      prev = best;
    }
  }

  const x: number[] = new Array(n);
  for (let i = 0; i < n; i++) x[i] = xs[i];

  const cols: (number | null)[][] = [];
  for (let i = 0; i < wins.length; i++) {
    const w = wins[i];
    const col: (number | null)[] = new Array(n);
    let j = 0;
    for (let k = 0; k < n; k++) {
      if (isGap[k]) {
        col[k] = null;
        continue;
      }
      const t = x[k];
      while (j < w.n - 1 && w.xs[j + 1] <= t) j++;
      // zero-order hold：t 之前沒有任何樣本就是 null（不是 0，也不內插）
      col[k] = w.n > 0 && w.xs[j] <= t ? w.ys[j] : null;
    }
    cols.push(col);
  }
  return { data: [x, ...cols] as unknown as uPlot.AlignedData, decimated };
}

export function LineGraph({
  log = liveLog,
  series,
  height = 260,
  paused = false,
  showTargets = true,
  showThreshold = true,
  syncKey = "fgc",
  onGeom,
  onDropKey,
  emptyHint = "從左邊的訊號樹拖一條數值訊號進來",
}: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const resRef = useRef<Resolved[]>([]);
  const decRef = useRef(false);
  const thrRef = useRef(showThreshold);
  thrRef.current = showThreshold;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const [dragSide, setDragSide] = useState<AxisSide | null>(null);

  // uPlot 的線色/軸色是**建立時就烤進去的**，而主題在開機時必然會翻一次：
  // App 在 mode 還是 UNKNOWN 的那幾百毫秒是 lockdown（預設鎖住），收到 hello 才翻回
  // dark。任何在那個瞬間掛載的圖會永遠停在 lockdown 的灰階 series 色（實測：射手頁
  // 三條線全部畫成 #8a8d93）。Canvas 面板每一幀重讀 palette() 所以沒事，只有 uPlot 要重建。
  const [themeV, setThemeV] = useState(0);
  useEffect(() => subscribeTheme(() => setThemeV((n) => n + 1)), []);

  // 序列組成變了才重建 uPlot；值變動走 setData，不重建。
  const sig = series
    .map((s) => s.key + "~" + (s.scale ?? "left") + "~" + (s.stepped ? 1 : 0) + "~" + (s.points ? 1 : 0))
    .join(",");
  const targetSig = showTargets ? (log.has(K.targetL) ? "L" : "") + (log.has(K.targetR) ? "R" : "") : "";

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const p = palette();
    const res = resolve(series, showTargets, log);
    resRef.current = res;

    const usesLeft = res.some((s) => s.scale === "left") || res.length === 0;
    const usesRight = res.some((s) => s.scale === "right");

    const axisBase = {
      stroke: p.textDim,
      grid: { stroke: withAlpha(p.border, 0.85), width: 1 },
      ticks: { stroke: p.border, width: 1 },
      font: "11px ui-monospace, Consolas, monospace",
    };

    const axes: uPlot.Axis[] = [
      {
        ...axisBase,
        // 小數位跟著「看得見的視窗長度」走而不是跟著絕對值走：
        // t 已經跑到 298 s、視窗只有 0.2 s 時，toFixed(0) 會讓每一格都寫「298s」。
        values: (u, vs) => {
          const lo = u.scales.x.min ?? 0;
          const hi = u.scales.x.max ?? 1;
          return vs.map((v) => fmtT(v, hi - lo) + "s");
        },
      },
    ];
    if (usesLeft) axes.push({ ...axisBase, scale: "left", side: 3, size: 54 });
    if (usesRight) axes.push({ ...axisBase, scale: "right", side: 1, size: 54, grid: { show: false } });

    const opts: uPlot.Options = {
      width: el.clientWidth || 600,
      height,
      padding: [10, usesRight ? 4 : 12, 0, 4],
      cursor: {
        x: true,
        y: false,
        points: { show: false },
        // cursorStore 才是真相，uPlot 只是同一個 sync key 底下的一員（§5.2）
        sync: { key: syncKey, scales: ["x", null] },
        drag: { x: true, y: false, setScale: false },
      },
      legend: { show: true, live: false },
      scales: {
        x: { time: false, auto: false },
        left: { auto: true },
        right: { auto: true },
      },
      axes,
      series: [
        {},
        ...res.map((s) => ({
          label: (s.label ?? shortName(s.key)) + (s.unit ? " (" + s.unit + ")" : ""),
          scale: s.scale,
          stroke: s.color,
          width: s.isTarget ? 1.5 : 1.6,
          dash: s.dash,
          spanGaps: false,
          points: s.points
            ? { show: true, size: 4, stroke: s.color, fill: s.color }
            : { show: false },
          paths: s.stepped && uPlot.paths.stepped ? uPlot.paths.stepped({ align: 1 }) : undefined,
        })),
      ],
      hooks: {
        setCursor: [
          (u: uPlot) => {
            const left = u.cursor.left ?? -10;
            cursor.setHover(left < 0 ? null : u.posToVal(left, "x"));
          },
        ],
        setSelect: [
          (u: uPlot) => {
            if (u.select.width > 2) {
              cursor.setSelection({
                t0: u.posToVal(u.select.left, "x"),
                t1: u.posToVal(u.select.left + u.select.width, "x"),
              });
            }
          },
        ],
        setSize: [
          (u: uPlot) => {
            onGeom?.({
              padLeft: u.over.offsetLeft,
              padRight: u.width - u.over.offsetLeft - u.over.clientWidth,
              width: u.width,
            });
          },
        ],
        draw: [(u: uPlot) => drawOverlays(u, log, resRef.current, decRef.current, thrRef.current)],
      },
    };

    const plot = new uPlot(opts, [[], ...res.map(() => [])] as unknown as uPlot.AlignedData, el);
    onGeom?.({
      padLeft: plot.over.offsetLeft,
      padRight: plot.width - plot.over.offsetLeft - plot.over.clientWidth,
      width: plot.width,
    });

    // 滾輪縮放與色帶／時間軸完全一致；拖曳留給 uPlot 做框選（§7.4）。
    const detach = attachPanZoom(plot.over, {
      geom: () => ({ x0: 0, w: plot.over.clientWidth, t0: view.t0, t1: view.t1 }),
      dragPan: false,
      shiftSelect: false,
      clickSeek: false,
      hover: false,
    });
    const onClick = (e: MouseEvent) => {
      if (plot.select && plot.select.width > 3) return; // 剛剛是框選不是點擊
      const r = plot.over.getBoundingClientRect();
      const w = plot.over.clientWidth || 1;
      cursor.setCursor(view.t0 + ((e.clientX - r.left) / w) * (view.t1 - view.t0), true);
    };
    plot.over.addEventListener("click", onClick);

    const stopSize = observeSize(el, () => {
      if (el.clientWidth > 0) plot.setSize({ width: el.clientWidth, height });
    });

    let raf = 0;
    let lastLog = -1;
    let lastView = -1;
    let lastCur = -1;
    let lastW = -1;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const lv = log.getVersion();
      const vv = view.getVersion();
      const cv = cursor.getVersion();
      const w = plot.over.clientWidth;
      if (lv !== lastLog || vv !== lastView || w !== lastW) {
        lastLog = lv;
        lastView = vv;
        lastW = w;
        lastCur = cv;
        const t0 = view.t0;
        const t1 = view.t1;
        const built = buildData(log, resRef.current, t0, t1, Math.max(200, w * 2));
        decRef.current = built.decimated;
        plot.setData(built.data, false);
        // 暫停時只跳過這一行，資料照樣進來
        // （FTC GraphCanvas.jsx:48-50 在恢復時 graph.reset() 會清光歷史，那是缺陷不是特性）
        if (!pausedRef.current) plot.setScale("x", { min: t0, max: t1 });
      } else if (cv !== lastCur) {
        // 游標／選區動了但資料沒動：只重畫 overlay，不重建路徑
        lastCur = cv;
        plot.redraw(false);
      }
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      plot.over.removeEventListener("click", onClick);
      detach();
      stopSize();
      plot.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, height, syncKey, showTargets, targetSig, log, themeV]);

  const onDrop = (e: React.DragEvent, side: AxisSide) => {
    e.preventDefault();
    setDragSide(null);
    const key = e.dataTransfer.getData(DRAG_MIME) || e.dataTransfer.getData("text/plain");
    if (key) onDropKey?.(key, side);
  };

  return (
    <div className={series.length === 0 ? "lg-wrap empty" : "lg-wrap"}>
      <div className="lg-plot" ref={boxRef} />
      {series.length === 0 && <div className="lg-empty">{emptyHint}</div>}
      {onDropKey && (
        <div className="lg-zones" onDragLeave={() => setDragSide(null)}>
          {(["left", "right"] as AxisSide[]).map((side) => (
            <div
              key={side}
              className={dragSide === side ? "lg-zone over" : "lg-zone"}
              onDragEnter={() => setDragSide(side)}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "copy";
                if (dragSide !== side) setDragSide(side);
              }}
              onDrop={(e) => onDrop(e, side)}
            >
              <span>{side === "left" ? "← 拖到這裡：左軸" : "拖到這裡：右軸 →"}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * 資料層之上的五樣東西：目標 ±3% 容差帶、FEED_THRESHOLD 橫線、選區、cursorT、抽點標示。
 * 一律半透明或細虛線，不蓋住波形本身。
 */
function drawOverlays(
  u: uPlot,
  log: LogStore,
  res: readonly Resolved[],
  decimated: boolean,
  showThreshold: boolean,
): void {
  const p = palette();
  const ctx = u.ctx;
  const { left, top, width, height } = u.bbox;
  ctx.save();
  ctx.beginPath();
  ctx.rect(left, top, width, height);
  ctx.clip();

  const hasLeft = res.some((s) => s.scale === "left");
  const xsd = u.data[0] as unknown as number[];

  // ① 目標 ±3% 容差帶（跟著階梯目標走，不是一條直線）
  for (let i = 0; i < res.length; i++) {
    const s = res[i];
    if (!s.isTarget) continue;
    const col = u.data[i + 1] as unknown as (number | null)[] | undefined;
    if (!col || !xsd) continue;
    ctx.fillStyle = withAlpha(p.ok, 0.12);
    for (let k = 0; k + 1 < xsd.length; k++) {
      const v = col[k];
      if (v === null || v === undefined || v === 0) continue;
      const x0 = u.valToPos(xsd[k], "x", true);
      const x1 = u.valToPos(xsd[k + 1], "x", true);
      const yHi = u.valToPos(v * 1.03, s.scale, true);
      const yLo = u.valToPos(v * 0.97, s.scale, true);
      ctx.fillRect(x0, Math.min(yHi, yLo), Math.max(1, x1 - x0), Math.abs(yLo - yHi));
    }
  }

  // ② FEED_THRESHOLD：讀 /FGC/Param/ 回讀值，不可寫死 1200
  if (showThreshold && hasLeft) {
    const pk = paramKey("FEED_THRESHOLD");
    const held = log.valueAt(pk, cursor.cursorT);
    const latest = log.latest.get(pk);
    const thr = held !== null ? held : typeof latest === "number" ? latest : null;
    if (thr !== null && Number.isFinite(thr)) {
      const y = u.valToPos(thr, "left", true);
      if (y >= top && y <= top + height) {
        ctx.save();
        ctx.strokeStyle = p.thresh;
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 4]);
        ctx.beginPath();
        ctx.moveTo(left, y);
        ctx.lineTo(left + width, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = p.thresh;
        ctx.font = "10px ui-monospace, Consolas, monospace";
        ctx.textAlign = "left";
        ctx.textBaseline = "bottom";
        ctx.fillText("FEED_THRESHOLD " + thr.toFixed(0), left + 4, y - 2);
        ctx.restore();
      }
    }
  }

  // ③ 選區
  const sel = cursor.selection;
  if (sel && sel.t1 > sel.t0) {
    const x0 = u.valToPos(sel.t0, "x", true);
    const x1 = u.valToPos(sel.t1, "x", true);
    ctx.fillStyle = withAlpha(p.focusRing, 0.12);
    ctx.fillRect(x0, top, x1 - x0, height);
  }

  // ④ cursorT（uPlot 的十字線是 hover，這一條是使用者「選定的時刻」）
  const cx = u.valToPos(cursor.cursorT, "x", true);
  if (cx >= left && cx <= left + width) {
    ctx.strokeStyle = p.focusRing;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, top);
    ctx.lineTo(cx, top + height);
    ctx.stroke();
  }

  // ⑤ 誠實標示：這張圖被抽點過，不可拿去目測極值
  if (decimated) {
    ctx.fillStyle = p.textDim;
    ctx.font = "10px ui-monospace, Consolas, monospace";
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    ctx.fillText("已抽點（min/max）", left + width - 4, top + 2);
  }
  ctx.restore();
}
