// 全部訊號：橋接器鏡射過來的所有 NT entry 自動列出、自動配對元件 —
// 機器人端 tab.Add(...) 加什麼，這裡立刻出現什麼，App 端零修改。
// 數字可編輯（Enter/失焦寫回）、布林是開關、字串可編輯、陣列唯讀；
// 數字訊號可釘選成波形圖（釘選清單記在 localStorage，重開 App 仍在）。
//
// 重繪節奏（§7.5）：這一頁的用途是「找一個我沒想到的 key」，不是盯波形，所以
// **不跟著 20 Hz 的推播重繪**。key 集合（store.latest.size）變了才重排分組，
// 值本身每 250 ms 刷新一次。以前是 store.subscribe + useState(0) 強制重繪，
// 每秒 20 次重建 Map、兩層 localeCompare 排序、reconcile 126 列 DOM——
// 在 1366x768 的舊筆電上只要開著這一頁，主執行緒就被它吃掉，而頂欄的 ws age
// 與所有 Canvas 面板都在同一條執行緒上（症狀是「儀表板看起來卡住了」）。
import { useMemo, useState, useSyncExternalStore } from "react";
import { store, NtValue } from "../lib/store";
import { client } from "../lib/RobotClient";
import { isTunableKey } from "../fgc/lib/fgcKeys";
import { useAppMode, useTick } from "../fgc/lib/hooks";
import * as persist from "../fgc/lib/persist";
import { LineGraph, type GraphSeries } from "../fgc/components/graph/LineGraph";
import { SPAN_CHOICES, view } from "../fgc/components/graph/viewWindow";

// §3.35 改造 (2)：釘選上限原本是「色盤長度 6」，現在無上限——
// 超過 8 條時色序循環，並用線型（實線 / 長虛 / 短虛）區分，
// 所以第 9 條與第 1 條同色但不同線型，仍分得出來。
const DASHES: (number[] | undefined)[] = [undefined, [8, 4], [2, 3]];

function loadPinned(): string[] {
  const v = persist.get<unknown>(persist.KEYS.pinned, []);
  return Array.isArray(v) ? v.filter((k): k is string => typeof k === "string") : [];
}

/** NT 慣例：以 . 開頭的段落是隱藏項（.metadata、.type 等） */
const isHidden = (key: string) => key.split("/").some((seg) => seg.startsWith("."));

/** 去掉尾端多餘零的數字格式 */
const fmtNum = (v: number) => String(parseFloat(v.toPrecision(6)));

function NumberRow({ ntKey, value }: { ntKey: string; value: number }) {
  const [draft, setDraft] = useState<string | null>(null);
  const editing = draft !== null;

  const commit = () => {
    if (draft === null) return;
    const v = parseFloat(draft);
    if (!Number.isNaN(v)) client.set(ntKey, v);
    setDraft(null);
  };

  return (
    <input
      type="number"
      className={editing ? "sig-input editing" : "sig-input"}
      value={editing ? draft : fmtNum(value)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setDraft(null);
      }}
    />
  );
}

function StringRow({ ntKey, value }: { ntKey: string; value: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const editing = draft !== null;

  const commit = () => {
    if (draft !== null) client.set(ntKey, draft);
    setDraft(null);
  };

  return (
    <input
      type="text"
      className={editing ? "sig-input text editing" : "sig-input text"}
      value={editing ? draft : value}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setDraft(null);
      }}
    />
  );
}

/**
 * §8 M01 措施 4（最大漏洞）：這個面板原本對**任何** key 都直接呼叫 client.set。
 * 現在唯一會 render 輸入元件的情況是「PIT 模式 + key 在 21 項白名單內」；
 * 其餘一律純文字（不是 disabled input）——唯讀就該長得像唯讀。
 */
function ValueCell({ ntKey, value, pit }: { ntKey: string; value: NtValue; pit: boolean }) {
  const writable = pit && isTunableKey(ntKey);
  if (!writable) {
    const text =
      typeof value === "number"
        ? fmtNum(value)
        : typeof value === "boolean"
          ? value
            ? "true"
            : "false"
          : typeof value === "string"
            ? value
            : `[${value.length} 項]`;
    return (
      <span className="ro-value" title={Array.isArray(value) ? value.join("\n") : text}>
        {text}
      </span>
    );
  }
  if (typeof value === "number") return <NumberRow ntKey={ntKey} value={value} />;
  if (typeof value === "boolean")
    return (
      <button
        className={value ? "sig-bool on" : "sig-bool"}
        onClick={() => client.set(ntKey, !value)}
      >
        {value ? "true" : "false"}
      </button>
    );
  if (typeof value === "string") return <StringRow ntKey={ntKey} value={value} />;
  return <span className="sig-array" title={value.join("\n")}>[{value.length} 項]</span>;
}

export function AllSignalsPanel() {
  // key 集合變了才重排（snapshot 一律回 primitive）；值刷新交給 250 ms 的 tick。
  const keyCount = useSyncExternalStore(
    store.subscribe,
    () => store.latest.size,
    () => store.latest.size,
  );
  useTick(250);
  // 寫回閘走 useAppMode()，不在 render 期間讀模組變數：那個值目前只因為父層
  // 20 Hz 重繪才「碰巧」新鮮，任何一次 memo 化都會讓它變成陳舊值。
  const pit = useAppMode() === "PIT";

  const [filter, setFilter] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const [pinned, setPinned] = useState<string[]>(loadPinned);

  const togglePin = (key: string) => {
    const next = pinned.includes(key) ? pinned.filter((k) => k !== key) : [...pinned, key];
    setPinned(next);
    persist.set(persist.KEYS.pinned, next);
  };

  // 蒐集 + 過濾 + 依上層路徑分組。相依只有「key 集合的指紋」——值變動不重排，
  // 126 個 key 的兩層 localeCompare 不該每秒跑 20 次（SignalTree.tsx:78-99 同樣寫法）。
  const sortedGroups = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const groups = new Map<string, string[]>();
    for (const key of store.latest.keys()) {
      if (!showHidden && isHidden(key)) continue;
      if (needle && !key.toLowerCase().includes(needle)) continue;
      const slash = key.lastIndexOf("/");
      const group = slash > 0 ? key.slice(0, slash) : "/";
      let list = groups.get(group);
      if (!list) {
        list = [];
        groups.set(group, list);
      }
      list.push(key);
    }
    const out = Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
    for (const [, list] of out) list.sort((a, b) => a.localeCompare(b));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyCount, filter, showHidden]);

  const pinnedSeries = useMemo<GraphSeries[]>(
    () =>
      pinned.map((k, i) => ({
        key: k,
        label: k.split("/").slice(-2).join("/"),
        dash: DASHES[Math.floor(i / 8) % DASHES.length],
      })),
    [pinned],
  );

  const total = store.latest.size;
  const disconnected = store.connState === "disconnected" || store.connState === "connecting";

  return (
    <div className="signals-panel">
      <div className="panel-toolbar">
        <input
          className="sig-filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="過濾訊號（如 Chassis、Vision、Distance…）"
        />
        <button
          className={showHidden ? "seg active" : "seg"}
          onClick={() => setShowHidden(!showHidden)}
        >
          隱藏項
        </button>
        {pinned.length > 0 && (
          <>
            <span className="spacer" />
            {SPAN_CHOICES.map((w) => (
              <button
                key={w}
                className={view.span === w ? "seg active" : "seg"}
                onClick={() => view.setSpan(w)}
              >
                {w}s
              </button>
            ))}
            <button className="seg" onClick={() => { setPinned([]); persist.set(persist.KEYS.pinned, []); }}>
              清除釘選
            </button>
          </>
        )}
      </div>

      {/* 釘選圖用的是 LineGraph（左右軸、主題感知、min/max decimation、缺口斷開），
          不是已刪除的 Chart.tsx——同一份遙測只有 LogStore 一條時間序列。 */}
      {pinned.length > 0 && (
        <div className="chart-box">
          <LineGraph series={pinnedSeries} height={240} showTargets={false} showThreshold={false} />
        </div>
      )}

      <div className="sig-list">
        {disconnected ? (
          <div className="cam-placeholder">
            未連線。連上 Control Hub 後，/FGC/** 的所有訊號會自動列在這裡。
            MATCH 期間 8081 不推播是規則性靜默，不是壞了。
          </div>
        ) : sortedGroups.length === 0 ? (
          <div className="cam-placeholder">
            {total === 0 ? "等待訊號中…" : "沒有符合過濾條件的訊號。"}
          </div>
        ) : (
          sortedGroups.map(([group, list]) => (
            <section key={group}>
              <h3>{group}</h3>
              {list.map((key) => {
                const value = store.latest.get(key);
                if (value === undefined) return null;
                return (
                <div className="sig-row" key={key}>
                  {typeof value === "number" ? (
                    <button
                      className={pinned.includes(key) ? "sig-pin on" : "sig-pin"}
                      title="釘選到波形圖"
                      onClick={() => togglePin(key)}
                    >
                      圖
                    </button>
                  ) : (
                    <span className="sig-pin-slot" />
                  )}
                  <span className="sig-name" title={key}>
                    {key.slice(group.length + 1)}
                  </span>
                  <ValueCell ntKey={key} value={value} pit={pit} />
                </div>
                );
              })}
            </section>
          ))
        )}
      </div>
    </div>
  );
}
