// LoopHistogram（§3.3 #23）：/FGC/Status/Loop ms 的直方圖，不是折線。
//
// 為什麼不畫折線：平均 12 ms 但 p95 40 ms 的機器人，手感是頓的，而頂欄那個
// 一直在跳的即時數字會被平均值騙過去。分佈的形狀（是不是雙峰、尾巴多長）
// 才是「這一版有沒有變卡」的答案。
//
// 「存快照對照」把 p50/p95/max + Build 存成一列——那正是 README 要的對照表，
// 不用另外手抄。快照存 localStorage（persist.KEYS.loopSnapshots）。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PanelShell } from "../shell/PanelShell";
import { LogStore, liveLog } from "../../lib/LogStore";
import { K } from "../../lib/fgcKeys";
import { histogram, percentiles } from "../../lib/stats";
import { palette } from "../../lib/theme";
import * as persist from "../../lib/persist";
import { fitCanvas, observeSize } from "../graph/timeAxis";
import { view } from "../graph/viewWindow";
import { copyText } from "../graph/Inspector";

interface Props {
  log?: LogStore;
  allowInputs?: boolean;
  height?: number;
}

export interface LoopSnapshot {
  at: number;
  build: string;
  n: number;
  p50: number;
  p95: number;
  max: number;
}

type Range = "all" | "win";

const BIN_MS = 2;
/** 驗收線：loop p95 > 25 ms 就是超出（§6.6）。 */
const RED_MS = 25;
const RECALC_MS = 1000;
const MAX_SNAPSHOTS = 12;

function fmt1(v: number): string {
  return Number.isFinite(v) ? v.toFixed(1) : "—";
}

function loadSnapshots(): LoopSnapshot[] {
  const raw = persist.get<LoopSnapshot[]>(persist.KEYS.loopSnapshots, []);
  return Array.isArray(raw) ? raw.filter((s) => s && typeof s.p95 === "number") : [];
}

export function LoopHistogram({ log = liveLog, allowInputs, height = 116 }: Props) {
  const cvRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState<Range>("all");
  const [tick, setTick] = useState(0);
  const [snaps, setSnaps] = useState<LoopSnapshot[]>(loadSnapshots);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), RECALC_MS);
    return () => window.clearInterval(t);
  }, []);

  const data = useMemo(() => {
    const [lo, hi] = range === "all" ? log.tRange : [view.t0, view.t1];
    const v = log.valuesInWindow(K.loopMs, lo, hi);
    const [p50, p95] = percentiles(v, [0.5, 0.95]);
    let max = NaN;
    for (let i = 0; i < v.length; i++) if (!(v[i] <= max)) max = v[i];
    return { v, p50, p95, max, hist: histogram(v, 20, undefined, BIN_MS) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [log, range, tick]);

  const draw = useCallback(() => {
    const cv = cvRef.current;
    if (!cv) return;
    const fit = fitCanvas(cv, height);
    if (!fit) return;
    const { ctx, w, h } = fit;
    const p = palette();
    const { hist, p50, p95 } = data;
    const padB = 14;
    const plotH = h - padB - 2;

    ctx.font = "10px ui-monospace, Consolas, monospace";
    ctx.textBaseline = "top";

    if (data.v.length === 0) {
      ctx.fillStyle = p.stale;
      ctx.textAlign = "center";
      ctx.fillText("尚無 /FGC/Status/Loop ms 樣本", w / 2, h / 2 - 5);
      return;
    }

    const lo = hist.edges[0];
    const hi = hist.edges[hist.edges.length - 1];
    const span = Math.max(1e-6, hi - lo);
    const xOf = (ms: number) => ((ms - lo) / span) * w;

    // 長條
    const n = hist.counts.length;
    const bw = w / n;
    for (let i = 0; i < n; i++) {
      const c = hist.counts[i];
      const bh = hist.max ? (c / hist.max) * plotH : 0;
      // 超過驗收線的那幾格用紅色：形狀之外還要一眼看到「尾巴在紅區」
      ctx.fillStyle = hist.edges[i] >= RED_MS ? p.err : p.series[0];
      ctx.fillRect(i * bw + 0.5, 2 + plotH - bh, Math.max(1, bw - 1), bh);
    }

    // 25 ms 驗收線
    if (RED_MS >= lo && RED_MS <= hi) {
      ctx.save();
      ctx.strokeStyle = p.err;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      const x = Math.round(xOf(RED_MS)) + 0.5;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 2 + plotH);
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = p.err;
      ctx.textAlign = "left";
      ctx.fillText("25", Math.min(w - 14, xOf(RED_MS) + 3), 1);
    }

    // p50 / p95 標記
    const marks: [number, string, string][] = [
      [p50, p.textDim, "p50"],
      [p95, p.warn, "p95"],
    ];
    for (const [val, col, label] of marks) {
      if (!Number.isFinite(val) || val < lo || val > hi) continue;
      ctx.strokeStyle = col;
      ctx.beginPath();
      const x = Math.round(xOf(val)) + 0.5;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 2 + plotH);
      ctx.stroke();
      ctx.fillStyle = col;
      ctx.textAlign = "right";
      ctx.fillText(label, Math.max(20, x - 2), 1);
    }

    // x 軸刻度（每 5 個 bin 一個）
    ctx.fillStyle = p.textDim;
    ctx.textAlign = "center";
    for (let i = 0; i <= n; i += 5) {
      const ms = hist.edges[Math.min(i, n)];
      ctx.fillText(String(Math.round(ms)), Math.min(w - 8, Math.max(8, xOf(ms))), plotH + 5);
    }
    ctx.textAlign = "right";
    ctx.fillText("ms", w - 2, plotH + 5);
  }, [data, height]);

  useEffect(() => {
    draw();
    const wrap = wrapRef.current;
    if (!wrap) return;
    return observeSize(wrap, draw);
  }, [draw]);

  const saveSnapshot = () => {
    const s: LoopSnapshot = {
      at: Date.now(),
      build: log.latestStr(K.build, "—"),
      n: data.v.length,
      p50: data.p50,
      p95: data.p95,
      max: data.max,
    };
    const next = [s, ...snaps].slice(0, MAX_SNAPSHOTS);
    setSnaps(next);
    persist.set(persist.KEYS.loopSnapshots, next);
    setMsg("已存快照");
    window.setTimeout(() => setMsg(""), 1500);
  };

  const copyTable = async () => {
    const head = "| 時間 | Build | n | p50 | p95 | max |\n|---|---|---|---|---|---|\n";
    const body = snaps
      .map(
        (s) =>
          "| " +
          new Date(s.at).toLocaleTimeString("zh-TW", { hour12: false }) +
          " | " + s.build +
          " | " + s.n +
          " | " + fmt1(s.p50) +
          " | " + fmt1(s.p95) +
          " | " + fmt1(s.max) + " |",
      )
      .join("\n");
    const ok = await copyText(head + body + "\n");
    setMsg(ok ? "已複製 Markdown 表格" : "複製失敗（可手動選取）");
    window.setTimeout(() => setMsg(""), 2000);
  };

  const p95level = data.p95 > RED_MS ? "err" : data.p95 > 20 ? "warn" : "ok";

  return (
    <PanelShell
      title="loop ms 直方圖"
      note={BIN_MS + " ms 一格 · 驗收線 " + RED_MS + " ms"}
      tools={
        allowInputs ? (
          <>
            <button className={range === "all" ? "tb-btn on" : "tb-btn"} onClick={() => setRange("all")} title="整份 log">
              整份
            </button>
            <button className={range === "win" ? "tb-btn on" : "tb-btn"} onClick={() => setRange("win")} title="目前可見視窗">
              視窗
            </button>
          </>
        ) : undefined
      }
      flush
    >
      <div className="lh" ref={wrapRef}>
        <canvas ref={cvRef} style={{ width: "100%", height }} />
        <div className="lh-stat">
          <span>
            p50 <b>{fmt1(data.p50)}</b>
          </span>
          <span>
            p95 <b className={p95level}>{fmt1(data.p95)}</b>
          </span>
          <span>
            max <b>{fmt1(data.max)}</b>
          </span>
          <span className="n">n {data.v.length}</span>
        </div>

        {allowInputs && (
          <div className="lh-tools">
            <button className="tb-btn" onClick={saveSnapshot} title="存成一列，直接貼進 README 的對照表">
              存快照對照
            </button>
            {snaps.length > 0 && (
              <>
                <button className="tb-btn" onClick={copyTable}>
                  複製表格
                </button>
                <button
                  className="tb-btn"
                  onClick={() => {
                    setSnaps([]);
                    persist.set(persist.KEYS.loopSnapshots, []);
                  }}
                >
                  清除
                </button>
              </>
            )}
            {msg && <span className="lh-msg">{msg}</span>}
          </div>
        )}

        {snaps.length > 0 && (
          <table className="fgc-table lh-snap">
            <thead>
              <tr>
                <th>時間</th>
                <th>Build</th>
                <th>p50</th>
                <th>p95</th>
                <th>max</th>
              </tr>
            </thead>
            <tbody>
              {snaps.map((s) => (
                <tr key={s.at}>
                  <td>{new Date(s.at).toLocaleTimeString("zh-TW", { hour12: false })}</td>
                  <td className="build">{s.build}</td>
                  <td className="num">{fmt1(s.p50)}</td>
                  <td className={s.p95 > RED_MS ? "num err" : "num"}>{fmt1(s.p95)}</td>
                  <td className="num">{fmt1(s.max)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </PanelShell>
  );
}
