// 圖表核心的組裝頁（第二階段 C 的驗收頁）。
//
// 這一頁本身不是規格裡的分頁——它是把 #18 LineGraph、#19 DiscreteBand、#31 TimeBar、
// #32 Inspector、#35 SignalTree 五個元件放在同一條 x 軸上的證明。§4.2 射手工作台與
// §4.6 REPLAY 分析頁都會直接沿用這個組裝方式（同一組元件、換一組預設序列），
// 所以先在這裡把「五者共用同一個 viewWindow 與同一個 cursorStore」跑通。
//
// URL 參數（無頭截圖與隊友分享連結用，全部走與拖放完全相同的那支 addKey）：
//   ?tab=graphdemo&left=/FGC/Shooter/SL,SR&right=CurrentL&band=RT&span=20
//   &drop=/FGC/Climb/Pos:right   ← 直接呼叫 onDropKey 的處理函式，驗證拖放路徑

import { useCallback, useEffect, useMemo, useState } from "react";
import { PanelShell } from "../components/shell/PanelShell";
import { DiscreteBand, DEFAULT_BAND_ROWS, type BandRow } from "../components/graph/DiscreteBand";
import { Inspector } from "../components/graph/Inspector";
import { LineGraph, colorForKey, type AxisSide, type GraphGeom, type GraphSeries } from "../components/graph/LineGraph";
import { SignalTree } from "../components/graph/SignalTree";
import { TimeBar, type TimeEvent } from "../components/graph/TimeBar";
import { SPAN_CHOICES, view } from "../components/graph/viewWindow";
import { K, shortName } from "../lib/fgcKeys";
import { liveLog } from "../lib/LogStore";
import { cursor } from "../lib/cursorStore";
import { client } from "../../lib/RobotClient";
import { useAppMode } from "../lib/hooks";
import * as persist from "../lib/persist";
import type { PageDef } from "./registry";
import "../styles/graph.css";

const PK_LEFT = "graph.left";
const PK_RIGHT = "graph.right";
const PK_BAND = "graph.band";
const PK_SPAN = "graph.span";

/** 預設左軸：射手三軌。SL/SR/Way 的顏色在 LineGraph 裡是固定綁定的。 */
const DEFAULT_LEFT = [K.sl, K.sr, K.way];

/** 取樣率 < 10 Hz 的量：畫散點、掛 chip，不畫平滑曲線（§3.3 #22）。 */
const SPARSE_KEYS = new Set<string>([K.currentL, K.currentR, K.currentWay, K.climbCurrent]);

/** 允許用短名寫在網址裡（SL → /FGC/Shooter/SL）。 */
function resolveKey(s: string): string | null {
  const t = s.trim();
  if (!t) return null;
  if (t.startsWith("/")) return t;
  const all = Object.values(K) as string[];
  return all.find((k) => k.endsWith("/" + t)) ?? null;
}

function parseList(raw: string | null): string[] | null {
  if (raw === null) return null;
  return raw
    .split(",")
    .map(resolveKey)
    .filter((k): k is string => !!k);
}

function initial(param: string | null, storeKey: string, fallback: readonly string[]): string[] {
  const fromUrl = parseList(param);
  if (fromUrl) return fromUrl;
  const saved = persist.get<string[]>(storeKey, []);
  return Array.isArray(saved) && saved.length ? saved : [...fallback];
}

function GraphDemo() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const mode = useAppMode();
  const replay = client.replayLog !== null;
  const log = client.replayLog ?? liveLog;

  const [left, setLeft] = useState<string[]>(() =>
    initial(params.has("left") ? params.get("left") : null, PK_LEFT, DEFAULT_LEFT),
  );
  const [right, setRight] = useState<string[]>(() =>
    initial(params.has("right") ? params.get("right") : null, PK_RIGHT, []),
  );
  const [bandKeys, setBandKeys] = useState<string[]>(() =>
    initial(
      params.has("band") ? params.get("band") : null,
      PK_BAND,
      DEFAULT_BAND_ROWS.map((r) => r.key),
    ),
  );
  const [paused, setPaused] = useState(false);
  const [geom, setGeom] = useState<GraphGeom>({ padLeft: 54, padRight: 12, width: 0 });
  // 圖上一條線都沒有時 uPlot 會把左軸收掉（沒有刻度可畫），padLeft 掉到接近 0，
  // 色帶的列名就被推出畫布。地板值只在「沒東西可對齊」時生效，有序列時軸本來就 >= 54。
  const padLeft = Math.max(54, geom.padLeft);
  const [span, setSpan] = useState<number>(() => {
    const fromUrl = Number(params.get("span"));
    if (Number.isFinite(fromUrl) && fromUrl > 0) return fromUrl;
    return persist.get<number>(PK_SPAN, 20);
  });

  useEffect(() => {
    view.setSpan(span);
    persist.set(PK_SPAN, span);
  }, [span]);

  useEffect(() => persist.set(PK_LEFT, left), [left]);
  useEffect(() => persist.set(PK_RIGHT, right), [right]);
  useEffect(() => persist.set(PK_BAND, bandKeys), [bandKeys]);

  // 一條 key 只能待在一個地方：拖到右軸就從左軸移走，不然同一條線會畫兩次。
  const addKey = useCallback((key: string, side: AxisSide) => {
    if (side === "left") {
      setRight((r) => r.filter((k) => k !== key));
      setLeft((l) => (l.includes(key) ? l : [...l, key]));
    } else {
      setLeft((l) => l.filter((k) => k !== key));
      setRight((r) => (r.includes(key) ? r : [...r, key]));
    }
  }, []);

  const addBand = useCallback((key: string) => {
    setBandKeys((b) => (b.includes(key) ? b : [...b, key]));
  }, []);

  const removeKey = useCallback((key: string) => {
    setLeft((l) => l.filter((k) => k !== key));
    setRight((r) => r.filter((k) => k !== key));
    setBandKeys((b) => b.filter((k) => k !== key));
  }, []);

  const togglePin = useCallback(
    (key: string) => {
      if (left.includes(key) || right.includes(key)) removeKey(key);
      else addKey(key, "left");
    },
    [left, right, addKey, removeKey],
  );

  // ?drop=<key>:<zone> —— 走的是與 DOM drop 完全相同的那支處理函式。
  // 無頭 Edge 沒辦法產生真的 dragstart/drop 事件，這是驗證同一條程式碼路徑的方法。
  useEffect(() => {
    const raw = params.get("drop");
    if (!raw) return;
    for (const item of raw.split(";")) {
      const [k, zone] = item.split(":");
      const key = resolveKey(k ?? "");
      if (!key) continue;
      if (zone === "band") addBand(key);
      else addKey(key, zone === "right" ? "right" : "left");
    }
  }, [params, addKey, addBand]);

  const series: GraphSeries[] = useMemo(() => {
    const mk = (key: string, scale: AxisSide, i: number): GraphSeries => ({
      key,
      scale,
      label: shortName(key),
      color: colorForKey(key, i),
      points: SPARSE_KEYS.has(key),
      unit: key.includes("Current") ? "A" : undefined,
    });
    return [...left.map((k, i) => mk(k, "left", i)), ...right.map((k, i) => mk(k, "right", left.length + i))];
  }, [left, right]);

  const colorOf = useCallback(
    (key: string) => {
      const i = left.indexOf(key);
      if (i >= 0) return colorForKey(key, i);
      const j = right.indexOf(key);
      if (j >= 0) return colorForKey(key, left.length + j);
      return null;
    },
    [left, right],
  );

  const bandRows: BandRow[] = useMemo(
    () =>
      bandKeys.map((key) => {
        const def = DEFAULT_BAND_ROWS.find((r) => r.key === key);
        return def ?? { key, label: shortName(key), mode: "auto" as const };
      }),
    [bandKeys],
  );

  const pinned = useMemo(() => [...left, ...right], [left, right]);
  const inspectKeys = useMemo(() => {
    const set = new Set<string>([...left, ...right, ...bandKeys]);
    return Array.from(set);
  }, [left, right, bandKeys]);

  // 事件軌的暫代內容：/FGC/Drive/State 的變化點。
  // 這**不是** eventDetect（§3.1 #5，第三階段）——只是把 LogStore 已經有的
  // changePoints 畫上去，證明事件軌與時間軸對得上。標題有寫清楚。
  const [evTick, setEvTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setEvTick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, []);
  const events: TimeEvent[] = useMemo(() => {
    const cp = log.changePoints(K.driveState);
    const out: TimeEvent[] = [];
    const start = Math.max(0, cp.length - 200);
    for (let i = start; i < cp.length; i++) {
      const s = log.stringAt(K.driveState, cp[i]) ?? "";
      out.push({
        t: cp[i],
        level: s === "SHOOT" ? "ok" : s === "EJECT" ? "err" : "info",
        label: "進入 " + s,
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [log, evTick]);

  const inputsOk = mode === "PIT" || replay;
  const tSource = log.tSource;

  return (
    <div className="gd">
      <div className="gd-tools">
        <span>窗</span>
        {SPAN_CHOICES.map((s) => (
          <button key={s} className={span === s ? "tb-btn on" : "tb-btn"} onClick={() => setSpan(s)}>
            {s}s
          </button>
        ))}
        <span className="sep" />
        <button
          className={paused ? "tb-btn on" : "tb-btn"}
          title="暫停只跳過 setScale('x')，setData 不停：放大看剛剛那一下不會掉歷史"
          onClick={() => {
            const next = !paused;
            setPaused(next);
            if (next) view.setFollow(false);
          }}
        >
          {paused ? "⏸ 已凍結視窗" : "凍結視窗"}
        </button>
        <button
          className="tb-btn"
          title="清掉選區（\\）"
          onClick={() => cursor.setSelection(null)}
        >
          清除選區
        </button>
        <span className="spacer" />
        <span>
          t={tSource === "robot" ? "robot（/FGC/Status/Match s）" : tSource === "client" ? "client（±50 ms）" : "尚無資料"} ·{" "}
          {log.batchCount} 批 · {log.keys().length} 欄位
        </span>
      </div>

      <div className="gd-main">
        <div className="gd-side">
          <PanelShell title="訊號樹" note="拖到圖上" flush className="fill">
            <SignalTree
              log={log}
              pinned={pinned}
              onTogglePin={togglePin}
              colorOf={colorOf}
              allowInputs={inputsOk}
            />
          </PanelShell>
        </div>

        <div className="gd-center">
          <PanelShell
            title="射手三軌 + 階梯目標"
            note="目標與實測同色（虛線）· FEED_THRESHOLD 讀 /FGC/Param 回讀值"
            rate={series.some((s) => s.points) ? "含 ~2 Hz 散點" : undefined}
            flush
          >
            <LineGraph
              log={log}
              series={series}
              height={300}
              paused={paused}
              onGeom={setGeom}
              onDropKey={addKey}
            />
            <DiscreteBand
              log={log}
              rows={bandRows}
              padLeft={padLeft}
              padRight={geom.padRight}
              onDropKey={addBand}
            />
            <div className="gd-note">
              離散區：同值合併色塊，與上圖共用同一條 x 軸與同一個游標。拖一條訊號進來會多一列。
            </div>
          </PanelShell>
        </div>

        <div className="gd-side">
          <PanelShell title="游標讀值" note="Ctrl+C 複製成 Markdown" flush className="fill">
            <Inspector log={log} keys={inspectKeys} onRemoveKey={inputsOk ? removeKey : undefined} />
          </PanelShell>
        </div>
      </div>

      <TimeBar log={log} events={events} padLeft={padLeft} padRight={geom.padRight} overviewKey={K.sl} />
    </div>
  );
}

export const GraphDemoPage: PageDef = {
  id: "graphdemo",
  label: "圖表",
  hotkey: "G",
  hint: "折線 + 離散色帶 + 時間軸 + 游標讀值（第二階段 C 的組裝驗收頁）",
  minWidth: 1024,
  hidden: true, // 驗收頁：?tab=graphdemo 或 G 鍵才進得去，不佔分頁列
  Component: GraphDemo,
};
