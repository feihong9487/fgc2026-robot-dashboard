// SignalTree（§3.3 #35）：AllSignalsPanel 的改造版。四處改動，第四處是規則防線。
//
//   (1) 依 /FGC/<子系統>/<名稱> 建兩層樹、可摺疊（原本是每批重算的平坦分組）
//   (2) 釘選上限從 6 條（PIN_COLORS.length 的 slice）改成無上限，自動配色 + 線型區分
//   (3) 分組排序原本每批 O(n log n)（AllSignalsPanel.tsx:110-128）
//       → 只在 key 集合變動時重算；值的更新走 4 Hz 的輕量重繪
//   (4) **非 PIT 時整條工具列（搜尋框、按鈕）不 render**，值一律純文字。
//       AllSignalsPanel:35 與 :59 對任何 key 都直接呼叫 client.set，那是規則防線最大的漏洞；
//       這個元件從頭到尾沒有 import client，物理上寫不回去。
//
// 值的重繪頻率刻意是 4 Hz 而不是跟著 log 版本走：訊號樹是「找 key」用的，
// 120 列以 60 Hz 重繪只是把 CPU 燒在沒有人在讀的數字上（§7.5 目標 idle CPU < 3%）。

import { useEffect, useMemo, useRef, useState } from "react";
import { LogStore, liveLog } from "../../lib/LogStore";
import { groupOf, isTunableKey, shortName } from "../../lib/fgcKeys";
import { useAppMode } from "../../lib/hooks";
import { seriesColor } from "../../lib/theme";
import { DRAG_MIME } from "./LineGraph";

interface Props {
  log?: LogStore;
  /** 已釘選（= 已經在圖上）的 key，用來顯示配色與勾選狀態。 */
  pinned?: readonly string[];
  onTogglePin?: (key: string) => void;
  /** 這個 key 在圖上的顏色（由呼叫端決定，才能與 LineGraph 完全一致）。 */
  colorOf?: (key: string) => string | null;
  /** 只顯示最近 N 秒有更新的 key；null = 全部。 */
  recentSec?: number | null;
  /** REPLAY 也允許輸入元件（物理上不可寫，不是規則問題）。 */
  allowInputs?: boolean;
}

/** NT 慣例：以 . 開頭的段落是隱藏項（.metadata、.type）。 */
const isHidden = (key: string) => key.split("/").some((seg) => seg.startsWith("."));

interface Node {
  group: string;
  keys: string[];
}

function fmtValue(log: LogStore, key: string): string {
  const v = log.latest.get(key);
  if (v === undefined) return "—";
  if (typeof v === "number") return String(parseFloat(v.toPrecision(6)));
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "string") return v;
  return "[" + v.length + " 項]";
}

export function SignalTree({
  log = liveLog,
  pinned = [],
  onTogglePin,
  colorOf,
  recentSec = null,
  allowInputs,
}: Props) {
  const mode = useAppMode();
  // §8：MATCH／未知模式下輸入元件不 render（不是 disabled）。這一頁在 MATCH 根本
  // 不會被路由到，但這個判斷寫在元件裡而不是靠「它不會被掛載」這個假設。
  const inputsOk = allowInputs ?? mode === "PIT";

  const [filter, setFilter] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const [recent, setRecent] = useState(recentSec);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [, force] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);

  // 值以 4 Hz 重繪；key 集合的變動由下面的 keySig 偵測
  useEffect(() => {
    const t = window.setInterval(() => force((n) => n + 1), 250);
    return () => window.clearInterval(t);
  }, []);

  // key 集合的指紋：只有集合變了才重建樹與重新排序
  const allKeys = log.keys();
  const keySig = allKeys.length + "|" + (allKeys.length ? allKeys[allKeys.length - 1] : "");

  const tree = useMemo<Node[]>(() => {
    const groups = new Map<string, string[]>();
    for (const key of log.keys()) {
      const g = groupOf(key);
      let list = groups.get(g);
      if (!list) {
        list = [];
        groups.set(g, list);
      }
      list.push(key);
    }
    const out: Node[] = [];
    for (const [group, keys] of groups) {
      keys.sort((a, b) => a.localeCompare(b));
      out.push({ group, keys });
    }
    out.sort((a, b) => a.group.localeCompare(b.group));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keySig, log]);

  // 搜尋：`!` 前綴為排除（實務上更常需要的是「濾掉那個洗版的」）
  const raw = filter.trim().toLowerCase();
  const exclude = raw.startsWith("!");
  const needle = exclude ? raw.slice(1) : raw;
  const now = log.tMax;

  const matches = (key: string): boolean => {
    if (!showHidden && isHidden(key)) return false;
    if (needle) {
      const hit = key.toLowerCase().includes(needle);
      if (exclude ? hit : !hit) return false;
    }
    if (recent !== null) {
      const upd = log.updatedAt(key, now);
      if (upd === null || now - upd > recent) return false;
    }
    return true;
  };

  const visible = tree
    .map((n) => ({ group: n.group, keys: n.keys.filter(matches) }))
    .filter((n) => n.keys.length > 0);

  const shown = visible.reduce((a, n) => a + n.keys.length, 0);

  const toggleGroup = (g: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });
  };

  // `/` 聚焦搜尋（§5.1）
  useEffect(() => {
    if (!inputsOk) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable) return;
      e.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [inputsOk]);

  return (
    <div className="st">
      {inputsOk ? (
        <div className="st-tools">
          <input
            ref={searchRef}
            className="st-search"
            value={filter}
            placeholder="搜尋 key（! 開頭為排除）"
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setFilter("");
                e.currentTarget.blur();
              }
            }}
          />
          <button
            className={recent !== null ? "st-seg on" : "st-seg"}
            title="只顯示最近 10 秒有更新的 key（diff 推播下，久沒更新的 key 通常是死埋點）"
            onClick={() => setRecent(recent === null ? 10 : null)}
          >
            10s 內
          </button>
          <button
            className={showHidden ? "st-seg on" : "st-seg"}
            title="NT 慣例：以 . 開頭的段落是隱藏項"
            onClick={() => setShowHidden(!showHidden)}
          >
            隱藏項
          </button>
        </div>
      ) : (
        <div className="st-ro">非 PIT 模式：唯讀清單，無搜尋框與按鈕</div>
      )}

      <div className="st-count">
        {shown} / {allKeys.length} 個 key
        {pinned.length > 0 && <span className="pinned">· 已釘選 {pinned.length}</span>}
      </div>

      <div className="st-body">
        {visible.length === 0 && <div className="st-empty">{allKeys.length === 0 ? "等待訊號中…" : "沒有符合條件的 key。"}</div>}
        {visible.map((n) => {
          const open = !collapsed.has(n.group);
          return (
            <section className="st-group" key={n.group}>
              <button className="st-ghead" onClick={() => toggleGroup(n.group)}>
                <span className="tri">{open ? "▾" : "▸"}</span>
                {n.group}
                <span className="n">{n.keys.length}</span>
              </button>
              {open &&
                n.keys.map((key) => {
                  const kind = log.kindOf(key);
                  const isPinned = pinned.includes(key);
                  const color = isPinned ? (colorOf?.(key) ?? seriesColor(pinned.indexOf(key))) : null;
                  return (
                    <div
                      className={isPinned ? "st-row pinned" : "st-row"}
                      key={key}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData(DRAG_MIME, key);
                        e.dataTransfer.setData("text/plain", key);
                        e.dataTransfer.effectAllowed = "copy";
                      }}
                      title={key + "（可拖到圖表或離散區）"}
                    >
                      {onTogglePin && inputsOk ? (
                        <button
                          className={isPinned ? "st-pin on" : "st-pin"}
                          style={color ? { background: color, borderColor: color } : undefined}
                          title={isPinned ? "取消釘選" : "釘選到圖表"}
                          onClick={() => onTogglePin(key)}
                        >
                          {isPinned ? "●" : "○"}
                        </button>
                      ) : (
                        <span className="st-pin slot" style={color ? { background: color } : undefined} />
                      )}
                      <span className="st-name">{shortName(key)}</span>
                      {/* 唯讀渲染：純文字，無邊框無背景。不是 disabled input。 */}
                      <span className="st-val fgc-num">{fmtValue(log, key)}</span>
                      <span className={"st-kind " + (kind ?? "none")}>
                        {kind === "num" ? "#" : kind === "bool" ? "◧" : kind === "str" ? "A" : "?"}
                      </span>
                      {isTunableKey(key) && (
                        <span className="st-tune" title="21 項白名單之一（可寫回的只有 /FGC/Tune/*）">
                          T
                        </span>
                      )}
                    </div>
                  );
                })}
            </section>
          );
        })}
      </div>
    </div>
  );
}
