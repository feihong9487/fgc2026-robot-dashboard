// PIT · 射手工作台（§4.2）。
//
// 版面的主張：上下分割，連續訊號畫曲線、離散訊號畫色帶，共用同一條 x 軸與同一個
// 游標。診斷「射不出去」的第一步永遠是分辨『沒到速 / way 沒開 / way 方向反了』，
// 而這三者只有把速度曲線與離散狀態疊在同一條時間軸上才分得出來。
//
// 右側四張卡刻意是「數字卡」不是「圖」：每一張都要能產出一個拿去跟另一組參數
// 比較的數字（dip 底值、失衡 RMS、loop p95、電流峰值）。電流卡刻意做小並標
// ~2 Hz——它的取樣率撐不起大面積帶來的權威感。
//
// URL 參數（無頭截圖用）：?tab=shooter&span=20&left=SL,SR&right=CurrentL&drop=Way:left

import { useCallback, useEffect, useMemo, useState } from "react";
import { PanelShell } from "../components/shell/PanelShell";
import { DiscreteBand, DEFAULT_BAND_ROWS, type BandRow } from "../components/graph/DiscreteBand";
import {
  LineGraph,
  colorForKey,
  type AxisSide,
  type GraphGeom,
  type GraphSeries,
} from "../components/graph/LineGraph";
import { SignalTree } from "../components/graph/SignalTree";
import { TimeBar, type TimeEvent } from "../components/graph/TimeBar";
import { SPAN_CHOICES, view } from "../components/graph/viewWindow";
import { BalanceBar } from "../components/shooter/BalanceBar";
import { CurrentStrip } from "../components/shooter/CurrentStrip";
import { DipAnalyzer } from "../components/shooter/DipAnalyzer";
import { LoopHistogram } from "../components/shooter/LoopHistogram";
import { detectDips } from "../components/shooter/dipDetect";
import { K, shortName } from "../lib/fgcKeys";
import { liveLog } from "../lib/LogStore";
import { cursor } from "../lib/cursorStore";
import { client } from "../../lib/RobotClient";
import { useAppMode, useCursor, usePalette } from "../lib/hooks";
import * as persist from "../lib/persist";
import type { PageDef } from "./registry";
import "../styles/graph.css";
import "../styles/shooter.css";

const PK_LEFT = "shooter.left";
const PK_RIGHT = "shooter.right";
const PK_SPAN = "shooter.span";

/** 射手三軌。顏色在 LineGraph 裡固定綁定：SL 青 / SR 橙 / Way 紫。 */
const DEFAULT_LEFT = [K.sl, K.sr, K.way];
const SPARSE_KEYS = new Set<string>([K.currentL, K.currentR, K.currentWay, K.climbCurrent]);

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

function Shooter() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const mode = useAppMode();
  useCursor();
  // 主題翻動時（開機的 lockdown → dark）要重算線色：colorForKey 讀的是 theme 的快取
  const pal = usePalette();
  const replay = client.replayLog !== null;
  const log = client.replayLog ?? liveLog;
  const allowInputs = mode === "PIT" || replay;

  const [left, setLeft] = useState<string[]>(() =>
    initial(params.has("left") ? params.get("left") : null, PK_LEFT, DEFAULT_LEFT),
  );
  const [right, setRight] = useState<string[]>(() =>
    initial(params.has("right") ? params.get("right") : null, PK_RIGHT, []),
  );
  const [paused, setPaused] = useState(false);
  const [geom, setGeom] = useState<GraphGeom>({ padLeft: 54, padRight: 12, width: 0 });
  // 一條線都沒有時 uPlot 會把左軸收掉，padLeft 掉到接近 0，色帶列名就被推出畫布
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

  const addKey = useCallback((key: string, side: AxisSide) => {
    if (side === "left") {
      setRight((r) => r.filter((k) => k !== key));
      setLeft((l) => (l.includes(key) ? l : [...l, key]));
    } else {
      setLeft((l) => l.filter((k) => k !== key));
      setRight((r) => (r.includes(key) ? r : [...r, key]));
    }
  }, []);

  const removeKey = useCallback((key: string) => {
    setLeft((l) => l.filter((k) => k !== key));
    setRight((r) => r.filter((k) => k !== key));
  }, []);

  const togglePin = useCallback(
    (key: string) => {
      if (left.includes(key) || right.includes(key)) removeKey(key);
      else addKey(key, "left");
    },
    [left, right, addKey, removeKey],
  );

  // ?drop=<key>:<zone> —— 與 DOM drop 走完全相同的那支處理函式
  useEffect(() => {
    const raw = params.get("drop");
    if (!raw) return;
    for (const item of raw.split(";")) {
      const [k, zone] = item.split(":");
      const key = resolveKey(k ?? "");
      if (key) addKey(key, zone === "right" ? "right" : "left");
    }
  }, [params, addKey]);

  const series: GraphSeries[] = useMemo(() => {
    const mk = (key: string, scale: AxisSide, i: number): GraphSeries => ({
      key,
      scale,
      label: shortName(key),
      color: colorForKey(key, i),
      points: SPARSE_KEYS.has(key),
      unit: key.includes("Current") ? "A" : key.includes("Battery") ? "V" : "tps",
    });
    return [
      ...left.map((k, i) => mk(k, "left", i)),
      ...right.map((k, i) => mk(k, "right", left.length + i)),
    ];
  }, [left, right, pal]);

  const colorOf = useCallback(
    (key: string) => {
      const i = left.indexOf(key);
      if (i >= 0) return colorForKey(key, i);
      const j = right.indexOf(key);
      if (j >= 0) return colorForKey(key, left.length + j);
      return null;
    },
    [left, right, pal],
  );

  const bandRows: BandRow[] = useMemo(() => [...DEFAULT_BAND_ROWS], []);

  // 事件軌：進入 SHOOT + 每球 dip。第三階段 E 的 eventDetect 會取代這一段，
  // 屆時只要換掉 events 這個 prop，TimeBar 一行都不用改。
  const [evTick, setEvTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setEvTick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, []);
  const events: TimeEvent[] = useMemo(() => {
    const out: TimeEvent[] = [];
    const cp = log.changePoints(K.driveState);
    for (let i = Math.max(0, cp.length - 120); i < cp.length; i++) {
      const s = log.stringAt(K.driveState, cp[i]) ?? "";
      if (s !== "SHOOT") continue;
      out.push({ t: cp[i], level: "ok", label: "進入 SHOOT" });
    }
    for (const d of detectDips(log, K.sl, { maxRuns: 12 })) {
      out.push({
        t: d.tBottom,
        level: d.broke ? "err" : "warn",
        label: "球#" + d.index + " dip −" + Math.round(d.depth) + (d.broke ? "（跌破門檻）" : ""),
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [log, evTick]);

  const hoverT = cursor.hoverT;

  return (
    <div className="sp">
      <div className="sp-narrow">射手工作台需要 1200 px 以上的視窗。把視窗拉寬，或改用「訊號」分頁。</div>

      <div className="gd-tools sp-tools">
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
          {paused ? "已凍結視窗" : "凍結視窗"}
        </button>
        <button className="tb-btn" title="清掉選區" onClick={() => cursor.setSelection(null)}>
          清除選區
        </button>
        <span className="spacer" />
        {/* 中點串的 meta 改成標籤／值：三段各有各的標籤，不是同級並列 */}
        <span className="sp-cursor">
          <span className="tb-read">
            <span className="k">游標</span>
            <span className="fgc-num">{cursor.cursorT.toFixed(3)}</span>
            <span className="fgc-unit">s</span>
          </span>
          {hoverT !== null && (
            <span className="tb-read">
              <span className="k">Δ</span>
              <span className="fgc-num">
                {(hoverT - cursor.cursorT >= 0 ? "+" : "") + (hoverT - cursor.cursorT).toFixed(3)}
              </span>
              <span className="fgc-unit">s</span>
            </span>
          )}
          <span className="tb-read">
            <span className="k">時基</span>
            <span className="fgc-num">
              {log.tSource === "robot" ? "robot" : log.tSource === "client" ? "client ±50 ms" : "尚無資料"}
            </span>
          </span>
        </span>
      </div>

      <div className="sp-main">
        <div className="sp-tree">
          <PanelShell title="訊號樹" note="拖到圖上" flush className="fill">
            <SignalTree
              log={log}
              pinned={[...left, ...right]}
              onTogglePin={togglePin}
              colorOf={colorOf}
              allowInputs={allowInputs}
            />
          </PanelShell>
        </div>

        <div className="sp-center">
          <PanelShell
            title="射手三軌 + 階梯目標"
            note="離散六列彼此沒有互鎖：「按了 RT 但 hopper 還關著」只有在這裡看得出錯開。"
            rate={series.some((s) => s.points) ? "含 ~2 Hz 散點" : undefined}
            flush
          >
            <LineGraph
              log={log}
              series={series}
              height={300}
              paused={paused}
              // showTargets 的預設是 false（fail-closed）：TargetL/R 是 coachRisk 欄位。
              // 這一頁只登記在 PIT_PAGES，MATCH 路由下不存在，所以這裡明示打開。
              showTargets
              onGeom={setGeom}
              onDropKey={addKey}
              emptyHint="還沒選訊號。從左邊的訊號樹拖 SL / SR / Way 進來。"
            />
            <DiscreteBand log={log} rows={bandRows} padLeft={padLeft} padRight={geom.padRight} />
          </PanelShell>
        </div>

        <div className="sp-col">
          <BalanceBar log={log} />
          <LoopHistogram log={log} allowInputs={allowInputs} />
        </div>

        <div className="sp-col">
          <DipAnalyzer log={log} allowInputs={allowInputs} />
          <CurrentStrip log={log} padLeft={padLeft} padRight={geom.padRight} />
        </div>
      </div>

      <TimeBar log={log} events={events} padLeft={padLeft} padRight={geom.padRight} overviewKey={K.sl} />
    </div>
  );
}

export const ShooterPage: PageDef = {
  id: "shooter",
  label: "射手",
  hotkey: "S",
  hint: "調 VEL / FEED_THRESHOLD / IDLE_TPS：三軌曲線 + 離散色帶 + 每球 dip + 失衡 + loop 分佈",
  minWidth: 1200,
  Component: Shooter,
};
