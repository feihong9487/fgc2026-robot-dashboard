// 全部訊號：橋接器鏡射過來的所有 NT entry 自動列出、自動配對元件 —
// 機器人端 tab.Add(...) 加什麼，這裡立刻出現什麼，App 端零修改。
// 數字可編輯（Enter/失焦寫回）、布林是開關、字串可編輯、陣列唯讀；
// 數字訊號可釘選成波形圖（釘選清單記在 localStorage，重開 App 仍在）。
import { useEffect, useState } from "react";
import { store, NtValue } from "../lib/store";
import { client } from "../lib/RobotClient";
import { Chart } from "./Chart";

const LS_PINNED = "vmx-dashboard.pinnedSignals";
const PIN_COLORS = ["#4fc3f7", "#ffb74d", "#81c784", "#e57373", "#ba68c8", "#4db6ac"];

function loadPinned(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(LS_PINNED) ?? "[]");
    return Array.isArray(v) ? v.filter((k) => typeof k === "string") : [];
  } catch {
    return [];
  }
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

function ValueCell({ ntKey, value }: { ntKey: string; value: NtValue }) {
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
  const [, force] = useState(0);
  useEffect(() => store.subscribe(() => force((n) => n + 1)), []);

  const [filter, setFilter] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const [pinned, setPinned] = useState<string[]>(loadPinned);
  const [windowSec, setWindowSec] = useState(30);

  const togglePin = (key: string) => {
    const next = pinned.includes(key)
      ? pinned.filter((k) => k !== key)
      : [...pinned, key].slice(-PIN_COLORS.length); // 上限 = 色盤數
    setPinned(next);
    localStorage.setItem(LS_PINNED, JSON.stringify(next));
  };

  // 蒐集 + 過濾 + 依上層路徑分組
  const needle = filter.trim().toLowerCase();
  const groups = new Map<string, { key: string; value: NtValue }[]>();
  let total = 0;
  for (const [key, value] of store.latest) {
    total++;
    if (!showHidden && isHidden(key)) continue;
    if (needle && !key.toLowerCase().includes(needle)) continue;
    const slash = key.lastIndexOf("/");
    const group = slash > 0 ? key.slice(0, slash) : "/";
    let list = groups.get(group);
    if (!list) {
      list = [];
      groups.set(group, list);
    }
    list.push({ key, value });
  }
  const sortedGroups = Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  for (const [, list] of sortedGroups) list.sort((a, b) => a.key.localeCompare(b.key));

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
            {[10, 30, 120].map((w) => (
              <button
                key={w}
                className={windowSec === w ? "seg active" : "seg"}
                onClick={() => setWindowSec(w)}
              >
                {w}s
              </button>
            ))}
            <button className="seg" onClick={() => { setPinned([]); localStorage.setItem(LS_PINNED, "[]"); }}>
              清除釘選
            </button>
          </>
        )}
      </div>

      {pinned.length > 0 && (
        <Chart
          key={pinned.join("|")} // 釘選變動時重建 uPlot 序列
          title="釘選訊號"
          series={pinned.map((k, i) => ({
            key: k,
            label: k.split("/").slice(-2).join("/"),
            color: PIN_COLORS[i % PIN_COLORS.length],
          }))}
          windowSec={windowSec}
          height={240}
        />
      )}

      <div className="sig-list">
        {disconnected ? (
          <div className="cam-placeholder">
            未連線。連上機器人（或按「模擬」）後，橋接器鏡射的所有 NT 訊號會自動列在這裡 ——
            機器人端 tab.Add(...) 加什麼就出現什麼。
          </div>
        ) : sortedGroups.length === 0 ? (
          <div className="cam-placeholder">
            {total === 0 ? "等待訊號中…" : "沒有符合過濾條件的訊號。"}
          </div>
        ) : (
          sortedGroups.map(([group, list]) => (
            <section key={group}>
              <h3>{group}</h3>
              {list.map(({ key, value }) => (
                <div className="sig-row" key={key}>
                  {typeof value === "number" ? (
                    <button
                      className={pinned.includes(key) ? "sig-pin on" : "sig-pin"}
                      title="釘選到波形圖"
                      onClick={() => togglePin(key)}
                    >
                      📈
                    </button>
                  ) : (
                    <span className="sig-pin-slot" />
                  )}
                  <span className="sig-name" title={key}>
                    {key.slice(group.length + 1)}
                  </span>
                  <ValueCell ntKey={key} value={value} />
                </div>
              ))}
            </section>
          ))
        )}
      </div>
    </div>
  );
}
