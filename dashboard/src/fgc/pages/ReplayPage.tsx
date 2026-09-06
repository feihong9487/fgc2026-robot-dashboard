// REPLAY · 分析（§4.6 線框）。
//
// 這一頁證明本專案的核心主張：**同一套面板程式碼在 PIT 即時與 REPLAY 回放兩種情境下
// 都正確，不需要寫兩套**。LineGraph / DiscreteBand / TimeBar / Inspector / SignalTree
// 全部收 `log` 這個 prop，這裡把它換成 client.replayLog 就結束了；沒有一行「回放專用」
// 的繪圖程式碼。新增的只有事件清單、書籤與匯出——那三個本來就是回放才有的事。
//
// REPLAY 不建立 ws（App.tsx 的路由與 RobotClient.startReplay 都會 disconnect），
// 所以這一頁物理上不可寫回機器人；set() 還有一道「回放模式：物理上不可寫回」的硬閘。
//
// M11 的時間閘（§8）：log 末批距現在 > 5 分鐘才顯示 coachRisk 欄位
// （/FGC/Vision/*、/FGC/Aim/*、TargetL/TargetR）。判定依據是檔名時戳 + log 長度，
// 判斷不出來就預設鎖住。閘沒開時那些欄位是**不 render**，不是 disabled。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { client } from "../../lib/RobotClient";
import { cursor } from "../lib/cursorStore";
import type { LogStore } from "../lib/LogStore";
import { K, shortName } from "../lib/fgcKeys";
import { detect, nextChange, nextEvent, runInterval, type EventKind, type LogEvent } from "../lib/eventDetect";
import { useCursor, useLogVersion, usePalette, useTick } from "../lib/hooks";
import { percentiles } from "../lib/stats";
import * as persist from "../lib/persist";
import { PanelShell } from "../components/shell/PanelShell";
import { DiscreteBand, DEFAULT_BAND_ROWS, type BandRow } from "../components/graph/DiscreteBand";
import { Inspector } from "../components/graph/Inspector";
import { LineGraph, colorForKey, type AxisSide, type GraphGeom, type GraphSeries } from "../components/graph/LineGraph";
import { SignalTree } from "../components/graph/SignalTree";
import { TimeBar, type TimeEvent, type TimeMark } from "../components/graph/TimeBar";
import { SPAN_CHOICES, view } from "../components/graph/viewWindow";
import { observeSize } from "../components/graph/timeAxis";
import { EventList } from "../components/replay/EventList";
import { BookmarkPrompt } from "../components/replay/BookmarkPrompt";
import { ExportMenu } from "../components/replay/ExportMenu";
import { addBookmark, loadBookmarks, logFingerprint, removeBookmark, type Bookmark } from "../components/replay/bookmarks";
import { coachGate, fmtAge, gateAllows, projectLog } from "../components/replay/coachGate";
import "../styles/graph.css";
import "../styles/replay.css";

const PK_LEFT = "replay.left";
const PK_RIGHT = "replay.right";
const PK_BAND = "replay.band";

const DEFAULT_LEFT = [K.sl, K.sr, K.way];
/** 取樣率 < 10 Hz 的量：畫散點、掛 chip，不畫平滑曲線（§3.3 #22）。 */
const SPARSE = new Set<string>([K.currentL, K.currentR, K.currentWay, K.climbCurrent]);

/** 時間軸的來源說明。robot / client 是機器的字面值，所以值本身走等寬。 */
const T_SOURCE_TITLE: Record<string, string> = {
  robot: "/FGC/Status/Match s —— 機器人自己的時鐘",
  client: "本機時鐘（收到那一批的時刻）",
  none: "這份 log 裡沒有任何批次",
};

/** 底部狀態列的一格：標籤在上（--fs-xs dim），值在下（等寬）。 */
function Stat({
  k,
  v,
  unit,
  bad,
  title,
}: {
  k: string;
  v: string;
  unit?: string;
  bad?: boolean;
  title?: string;
}) {
  return (
    <div className="rp-stat" title={title || undefined}>
      <span className="k">{k}</span>
      <span className={bad ? "v fgc-num bad" : "v fgc-num"}>
        {v}
        {unit && <span className="fgc-unit">{unit}</span>}
      </span>
    </div>
  );
}

export function ReplayPage() {
  const log = client.replayLog;
  useCursor();
  useLogVersion(log ?? undefined);
  useTick(1000); // M11 閘的倒數與「距現在」要自己變舊
  // 主題色要進 memo 的相依：這一頁是「載入完成的那一瞬間」才掛上來的，
  // 而 App 在那之前一路是 MATCH 路由（lockdown 灰階主題）。第一次 render 取到的
  // series 色會是 lockdown 的 #8a8d93，若不跟著主題重算，三條線就永遠是灰的
  // （LineGraph 自己會在 subscribeTheme 時重建，但它用的是我們傳進去的 color）。
  const pal = usePalette();

  const name = client.replayName || "（未命名）";
  const [left, setLeft] = useState<string[]>(() => persist.get<string[]>(PK_LEFT, [...DEFAULT_LEFT]));
  const [right, setRight] = useState<string[]>(() => persist.get<string[]>(PK_RIGHT, []));
  const [bandKeys, setBandKeys] = useState<string[]>(() =>
    persist.get<string[]>(PK_BAND, DEFAULT_BAND_ROWS.map((r) => r.key)),
  );
  const [geom, setGeom] = useState<GraphGeom>({ padLeft: 54, padRight: 12, width: 0 });
  const [treeOpen, setTreeOpen] = useState(true);
  const [focusKey, setFocusKey] = useState<string>(K.driveState);
  const [marks, setMarks] = useState<Bookmark[]>([]);
  const [prompt, setPrompt] = useState<{ t: number; initial: string } | null>(null);
  const [note, setNote] = useState("");
  // 事件類別的篩選由這一頁持有：事件清單的 chip 與時間軸的刻痕吃的必須是同一份，
  // 否則 chip 說「只看退球」而軌上還畫著全部 582 筆，兩個地方在講不同的事。
  const [offKinds, setOffKinds] = useState<ReadonlySet<EventKind>>(() => new Set());
  const toggleKind = useCallback((k: EventKind) => {
    setOffKinds((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }, []);
  const seeded = useRef<LogStore | null>(null);
  const plotBoxRef = useRef<HTMLDivElement>(null);
  const [graphH, setGraphH] = useState(300);

  useEffect(() => persist.set(PK_LEFT, left), [left]);
  useEffect(() => persist.set(PK_RIGHT, right), [right]);
  useEffect(() => persist.set(PK_BAND, bandKeys), [bandKeys]);

  const padLeft = Math.max(54, geom.padLeft);
  const fp = useMemo(() => (log ? logFingerprint(name, log) : ""), [log, name]);

  // 折線圖的高度 = 可用高度 − 色帶（每列 22 px + 2）− uPlot 圖例那一列（約 24 px）。
  // 圖例是 uPlot 自己畫在 canvas 下面的 DOM，不扣掉的話它會蓋到色帶第一列的列名。
  const bandH = Math.max(22, bandKeys.length * 22) + 2;
  useEffect(() => {
    const el = plotBoxRef.current;
    if (!el) return;
    const fit = () => setGraphH(Math.max(200, el.clientHeight - bandH - 30));
    fit();
    return observeSize(el, fit);
  }, [bandH, treeOpen]);

  // 事件：純函式全掃，log 版本變了才重算（REPLAY 載完就不再變，所以實際只算一次）。
  const events = useMemo<LogEvent[]>(() => (log ? detect(log) : []), [log, log?.getVersion()]);

  // M11 時間閘
  const gate = useMemo(
    () => (log ? coachGate(name, log, Date.now()) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [log, name, Math.floor(Date.now() / 1000)],
  );
  const gateOpen = gate?.open ?? false;

  // 書籤：以檔案指紋為 key 存 localStorage
  useEffect(() => {
    if (!fp) return;
    setMarks(loadBookmarks(fp));
  }, [fp]);

  // 載入一份新的 log：視窗鋪滿整份，然後跳到第一個 SHOOT（§5.5 的流程終點）
  useEffect(() => {
    if (!log || log.batchCount === 0) return;
    if (seeded.current === log) return;
    seeded.current = log;
    const [t0, t1] = log.tRange;
    view.reset(t0, t1, false);
    view.setWindow(t0, Math.min(t1, t0 + 20));
    cursor.setLiveLock(false);
    const first = detect(log, { t1: t1 }).find((e) => e.kind === "shoot");
    if (first) {
      cursor.setCursor(first.t, true);
      view.zoomTo(Math.max(t0, first.t - 4), Math.min(t1, first.t + 16), 0);
      setNote("已跳到第一個 SHOOT（" + first.t.toFixed(2) + " s）");
    } else {
      cursor.setCursor(t0, true);
      setNote("");
    }
  }, [log, name]);

  // ── 序列與色帶 ──────────────────────────────────────────────────────
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

  const visLeft = useMemo(() => left.filter((k) => gateAllows(k, gateOpen)), [left, gateOpen]);
  const visRight = useMemo(() => right.filter((k) => gateAllows(k, gateOpen)), [right, gateOpen]);
  const visBand = useMemo(() => bandKeys.filter((k) => gateAllows(k, gateOpen)), [bandKeys, gateOpen]);

  const series: GraphSeries[] = useMemo(() => {
    const mk = (key: string, scale: AxisSide, i: number): GraphSeries => ({
      key,
      scale,
      label: shortName(key),
      color: colorForKey(key, i),
      points: SPARSE.has(key),
      unit: key.includes("Current") ? "A" : undefined,
    });
    return [
      ...visLeft.map((k, i) => mk(k, "left", i)),
      ...visRight.map((k, i) => mk(k, "right", visLeft.length + i)),
    ];
  }, [visLeft, visRight, pal]);

  const colorOf = useCallback(
    (key: string) => {
      const i = visLeft.indexOf(key);
      if (i >= 0) return colorForKey(key, i);
      const j = visRight.indexOf(key);
      if (j >= 0) return colorForKey(key, visLeft.length + j);
      return null;
    },
    [visLeft, visRight, pal],
  );

  const bandRows: BandRow[] = useMemo(
    () =>
      visBand.map((key) => {
        const def = DEFAULT_BAND_ROWS.find((r) => r.key === key);
        return def ?? { key, label: shortName(key), mode: "auto" as const };
      }),
    [visBand],
  );

  const pinned = useMemo(() => [...visLeft, ...visRight], [visLeft, visRight]);
  const inspectKeys = useMemo(
    () => Array.from(new Set([...visLeft, ...visRight, ...visBand])),
    [visLeft, visRight, visBand],
  );

  const timeEvents = useMemo<TimeEvent[]>(
    () => events.map((e) => ({ t: e.t, level: e.level, label: e.label })),
    [events],
  );
  /** 時間軸下半的刻痕只畫篩選中的類別；上半的密度直方圖永遠畫全集。 */
  const timeSelected = useMemo<TimeEvent[]>(
    () => (offKinds.size === 0 ? timeEvents : events.filter((e) => !offKinds.has(e.kind)).map((e) => ({ t: e.t, level: e.level, label: e.label }))),
    [events, timeEvents, offKinds],
  );
  const timeMarks = useMemo<TimeMark[]>(() => marks.map((b) => ({ t: b.t, label: b.label })), [marks]);

  // ── seek：點事件時若跳出可見視窗，把視窗搬過去（而不是把游標藏起來）──
  const seek = useCallback(
    (t: number) => {
      cursor.setCursor(t, true);
      if (t < view.t0 || t > view.t1) view.setWindow(t - view.span * 0.35, t + view.span * 0.65);
    },
    [],
  );

  // ── 快捷鍵（§5.1 屬於回放的那一半）────────────────────────────────
  // 掛在 capture 階段：TimeBar 也在 document 上掛了 bubble 監聽，而它對 `\` 的處理是
  // 「清除選區」——Ctrl+\ 若讓事件傳下去，縮放到 RUN 區間的同時選區會被清掉。
  useEffect(() => {
    if (!log) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable) return;
      const ctrl = e.ctrlKey || e.metaKey;
      const stop = () => {
        e.preventDefault();
        e.stopPropagation();
      };

      if (ctrl && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
        stop();
        const ev = nextEvent(events, cursor.cursorT, e.key === "ArrowDown" ? 1 : -1);
        if (ev) {
          seek(ev.t);
          setNote(ev.label);
        } else setNote(e.key === "ArrowDown" ? "已經是最後一個事件" : "已經是第一個事件");
        return;
      }
      if (e.altKey && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
        stop();
        const t = nextChange(log, focusKey, cursor.cursorT, e.key === "ArrowDown" ? 1 : -1);
        if (t !== null) {
          seek(t);
          setNote(shortName(focusKey) + " 變化 @ " + t.toFixed(3) + " s");
        } else setNote(shortName(focusKey) + "：這個方向沒有變化點了");
        return;
      }
      if (ctrl && e.key === "\\") {
        stop();
        const r = runInterval(log);
        if (r) {
          view.zoomTo(r.t0, r.t1);
          setNote("縮放到 OpMode RUN 區間 " + r.t0.toFixed(1) + " → " + r.t1.toFixed(1) + " s");
        } else {
          setNote("這份 log 沒有 /FGC/Status/Phase 埋點，無法認出 RUN 區間");
        }
        return;
      }
      if (ctrl && (e.key === "b" || e.key === "B")) {
        stop();
        const t = cursor.cursorT;
        const old = marks.find((b) => Math.abs(b.t - t) <= 0.001);
        setPrompt({ t, initial: old?.label ?? "" });
        return;
      }
      if (ctrl && e.key === ".") {
        stop();
        setTreeOpen((v) => !v);
        return;
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [log, events, focusKey, marks, seek]);

  if (!log) {
    return <div className="rp-none">沒有載入任何回放檔。按 R 到「錄影」分頁選一份，或用 ?mode=replay&file=…</div>;
  }

  const [t0, t1] = log.tRange;
  // 這一整組都是 O(batchN) 的掃描，而這一頁掛了 useCursor()：TimeBar 的播放迴圈
  // 用 rAF 每幀 setCursor，所以不 memo 的話它們每秒跑 60 次——7,770 批就是每幀
  // 兩次 Float64Array(7769) 的配置加一次 7,769 元素的排序，約每秒 7 MB 垃圾與
  // 600 萬次比較，而回放檔載入後就永遠不變。卡頓正好發生在使用者最需要看清楚
  // 細節的時候（播放中）。
  const stats = useMemo(() => {
    const iv = log.batchIntervals();
    const [a, b] = iv.length > 0 ? percentiles(iv, [0.5, 0.95]) : [NaN, NaN];
    return { p50: a, p95: b, gaps: log.gaps(1.0), mb: log.bytes() / (1024 * 1024) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [log, log.getVersion()]);
  const { p50, p95, gaps, mb } = stats;
  // 投影一份 log 是 O(key 數) 的配置，同樣不該每幀做一次
  const treeLog = useMemo(() => (gateOpen ? log : projectLog(log, false)), [log, gateOpen]);
  const hiddenByGate = left.length + right.length + bandKeys.length - (visLeft.length + visRight.length + visBand.length);

  return (
    <div className="rp">
      {/* ── 動作列（§4.6 第一行的右半）─────────────────────────────
          左半（▣REPLAY · 檔名 · 長度 · 批數 · t=robot）由 ConnectionBar 畫，
          那是頂欄（§2.3）的職責。這裡只放動作，不重複同一份事實——
          同一個數字出現在畫面上兩次，讀的人就得先確認它們一不一樣。 */}
      <div className="rp-top">
        {note && <span className="rp-note">{note}</span>}
        <span className="spacer" />
        <button className="tb-btn" title="在游標位置打一顆書籤（Ctrl+B）" onClick={() => setPrompt({ t: cursor.cursorT, initial: "" })}>
          打書籤
        </button>
        <ExportMenu log={log} name={name} events={events} bookmarks={marks} keys={inspectKeys} gateOpen={gateOpen} />
        <button
          className="tb-btn"
          title="回到即時（會重新建立 ws）"
          onClick={() => {
            client.exitReplay();
            const u = new URL(window.location.href);
            u.searchParams.delete("mode");
            u.searchParams.delete("file");
            window.location.replace(u.toString());
          }}
        >
          離開回放
        </button>
      </div>

      {/* M11 時間閘：關著的時候說清楚是誰關的、什麼時候開 */}
      {gate && !gate.open && (
        <div className="rp-gate">
          <b>M11 時間閘：coachRisk 欄位未顯示</b>
          <span>
            　/FGC/Vision/*、/FGC/Aim/*、TargetL/TargetR 在「log 末批距現在 &gt; 5 分鐘」之前不 render
            {hiddenByGate > 0 && "（目前擋掉 " + hiddenByGate + " 條）"}。
            {gate.waitMs !== null && " 還要 " + fmtAge(gate.waitMs) + "。"}
          </span>
          <span className="basis">判定依據：{gate.basis}</span>
        </div>
      )}

      {/* ── 播放控制 + 三層時間軸（§4.6 第二～四行）─────────────── */}
      <TimeBar
        log={log}
        events={timeEvents}
        selected={timeSelected}
        bookmarks={timeMarks}
        padLeft={padLeft}
        padRight={geom.padRight}
        overviewKey={K.sl}
      />

      {/* ── 三欄主區 ────────────────────────────────────────────── */}
      <div className={treeOpen ? "rp-main" : "rp-main no-tree"}>
        {treeOpen && (
          <div className="rp-side">
            <PanelShell title="訊號樹" note="拖到圖上　Ctrl+. 收合" flush className="fill">
              <SignalTree
                log={treeLog}
                pinned={pinned}
                onTogglePin={togglePin}
                colorOf={colorOf}
                allowInputs
              />
            </PanelShell>
          </div>
        )}

        <div className="rp-center">
          <PanelShell
            title="回放折線"
            note={gateOpen ? "目標與實測同色（虛線）" : "目標階梯被 M11 閘擋下"}
            rate={series.some((s) => s.points) ? "含 ~2 Hz 散點" : undefined}
            flush
            tools={
              <span className="rp-tools">
                <span>窗</span>
                {SPAN_CHOICES.map((s) => (
                  <button key={s} className="tb-btn" onClick={() => view.setSpan(s)}>
                    {s}s
                  </button>
                ))}
                <span className="sep" />
                <span title="Alt+↓ / Alt+↑ 跳這個欄位的值變化點">Alt 焦點</span>
                <select
                  className="rp-sel"
                  value={focusKey}
                  onChange={(e) => setFocusKey(e.target.value)}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  {Array.from(new Set([K.driveState, K.atSpeed, K.driveReversed, ...inspectKeys])).map((k) => (
                    <option key={k} value={k}>
                      {shortName(k)}
                    </option>
                  ))}
                </select>
              </span>
            }
          >
            {/* uPlot 要的是明確的像素高度，而色帶是「幾列就多高」。
                所以這裡量一次可用高度再扣掉色帶，圖才會真的填滿面板
                （不量的話中間會留一塊白，看起來像資料到這裡就沒了）。 */}
            <div className="rp-plotbox" ref={plotBoxRef}>
              <LineGraph
                log={log}
                series={series}
                height={graphH}
                showTargets={gateOpen}
                onGeom={setGeom}
                onDropKey={addKey}
                emptyHint="從左邊的訊號樹拖一條數值訊號進來（或按釘選）"
              />
              <DiscreteBand
                log={log}
                rows={bandRows}
                padLeft={padLeft}
                padRight={geom.padRight}
                onDropKey={addBand}
              />
            </div>
          </PanelShell>
        </div>

        <div className="rp-right">
          <PanelShell title="游標讀值" note="Ctrl+C 複製成 Markdown" flush className="rp-insp">
            <Inspector log={log} keys={inspectKeys} onRemoveKey={removeKey} />
          </PanelShell>
          <PanelShell
            title={"事件（" + events.length + "）"}
            note="點一列把游標跳過去。Ctrl+F 篩選、Ctrl+B 打書籤。"
            flush
            className="fill"
          >
            <EventList
              events={events}
              bookmarks={marks}
              off={offKinds}
              onToggleKind={toggleKind}
              onSeek={seek}
              onRemoveBookmark={(t) => setMarks(removeBookmark(fp, t))}
            />
          </PanelShell>
        </div>
      </div>

      {/* ── 底部狀態列：誠實原則（§4.6）────────────────────────────
          原本是七段用「·」串起來的 meta 字串（`t=robot · 7,770 批 · 間隔 p50 62.0 ms · …`）。
          中點串的問題不是醜，是**每一段都要先讀完標籤才知道那個數字是什麼**。
          改成標籤在上、值在下的兩行對照表之後，眼睛掃的是下面那一排數字。 */}
      <div className="rp-status">
        <Stat k="時間軸" v={log.tSource} title={T_SOURCE_TITLE[log.tSource] ?? ""} />
        <Stat k="批" v={log.batchCount.toLocaleString("en-US")} />
        <Stat k="間隔 p50" v={Number.isFinite(p50) ? (p50 * 1000).toFixed(1) : "—"} unit="ms" />
        <Stat k="間隔 p95" v={Number.isFinite(p95) ? (p95 * 1000).toFixed(1) : "—"} unit="ms" />
        <Stat
          k="缺口"
          v={String(gaps.length)}
          unit="處"
          bad={gaps.length > 0}
          title={gaps
            .slice(0, 6)
            .map((g) => g.t0.toFixed(1) + "–" + g.t1.toFixed(1) + " s")
            .join("、")}
        />
        <Stat k="樣本" v={log.samples.toLocaleString("en-US")} />
        <Stat k="大小" v={mb.toFixed(1)} unit="MB" />
        <Stat k="欄位" v={String(log.keys().length)} />
        <Stat k="書籤" v={String(marks.length)} />
        <Stat k="指紋" v={fp} title="檔名 + 長度 + 首末時戳；書籤以它為 key 存在這台筆電" />
        {log.resets > 0 && (
          <Stat k="時戳倒退" v={String(log.resets)} unit="次" bad title="換場或重開 OpMode" />
        )}
        <span className="spacer" />
        <div className="rp-status-note">
          {log.tSource === "client" && (
            <p className="warn">
              <span className="fgc-glyph">▲</span>
              本機時鐘只有 ±50 ms 精度，不要拿去比較 FEED_THRESHOLD 1200 與 1300
            </p>
          )}
          <p>不建立 ws，物理上不可寫回</p>
        </div>
      </div>

      {prompt && (
        <BookmarkPrompt
          t={prompt.t}
          initial={prompt.initial}
          onSubmit={(label) => {
            setMarks(addBookmark(fp, prompt.t, label));
            setPrompt(null);
            setNote("書籤 @ " + prompt.t.toFixed(3) + " s");
          }}
          onCancel={() => setPrompt(null)}
        />
      )}
    </div>
  );
}
