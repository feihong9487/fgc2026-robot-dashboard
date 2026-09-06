// EventList（§3.4 #33）：可篩選、可點擊 seek 的事件清單。
//
// 一場 2:30 有約 3000 批，用眼睛找「第三次射擊為什麼卡住」要五分鐘，有標記是五秒。
//
// 篩選的 `!` 前綴是排除——實務上更常需要的不是「只看 dip」而是「濾掉那個洗版的」
// （loop 尖峰在一台熱機的 Control Hub 上一分鐘可以刷出四十筆）。
//
// 書籤與事件排在同一份清單裡：事件是機器算的、書籤是人看到的，
// 檢討的時候要看的是它們交錯出來的那條時間線，不是兩張各自的表。

import { useEffect, useMemo, useRef, useState } from "react";
import { cursor } from "../../lib/cursorStore";
import { useCursor } from "../../lib/hooks";
import {
  EVENT_KINDS,
  KIND_LABEL,
  LEVEL_GLYPH,
  filterEvents,
  type EventKind,
  type LogEvent,
} from "../../lib/eventDetect";
import type { Bookmark } from "./bookmarks";

interface Props {
  events: readonly LogEvent[];
  bookmarks?: readonly Bookmark[];
  /**
   * 被關掉的類別。**由呼叫端持有**：時間軸的篩選刻痕要吃同一份篩選，
   * 否則 chip 說「只看退球」而軌上還畫著全部 582 筆，兩個地方在講不同的事。
   */
  off: ReadonlySet<EventKind>;
  onToggleKind: (k: EventKind) => void;
  /** 點一列要做的事；預設是把游標搬過去（並脫離 live lock）。 */
  onSeek?: (t: number) => void;
  onRemoveBookmark?: (t: number) => void;
  /** 掛 Ctrl+F 聚焦篩選框（§5.1）。 */
  hotkeys?: boolean;
}

interface Row {
  id: string;
  t: number;
  glyph: string;
  level: string;
  kind: string;
  label: string;
  detail: string;
  bookmark: boolean;
}

export function EventList({
  events,
  bookmarks = [],
  off,
  onToggleKind,
  onSeek,
  onRemoveBookmark,
  hotkeys = true,
}: Props) {
  useCursor();
  const [query, setQuery] = useState("");
  const [follow, setFollow] = useState(true);
  const boxRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const activeRef = useRef<HTMLButtonElement | null>(null);

  // Ctrl+F 聚焦篩選（§5.1）。要 preventDefault，否則會開瀏覽器的尋找列。
  useEffect(() => {
    if (!hotkeys) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || (e.key !== "f" && e.key !== "F")) return;
      e.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [hotkeys]);

  const kinds = useMemo(() => {
    const s = new Set<EventKind>(EVENT_KINDS);
    off.forEach((k) => s.delete(k));
    return s;
  }, [off]);

  const counts = useMemo(() => {
    const m = new Map<EventKind, number>();
    for (const e of events) m.set(e.kind, (m.get(e.kind) ?? 0) + 1);
    return m;
  }, [events]);

  const rows = useMemo<Row[]>(() => {
    const evs = filterEvents(events, query, kinds).map((e) => ({
      id: e.id,
      t: e.t,
      glyph: LEVEL_GLYPH[e.level],
      level: e.level,
      kind: KIND_LABEL[e.kind],
      label: e.label,
      detail: e.detail,
      bookmark: false,
    }));
    const q = query.trim().toLowerCase();
    const exc = q.startsWith("!");
    const marks = bookmarks
      .filter((b) => {
        if (!q) return true;
        const hit = ("書籤 " + b.label).toLowerCase().includes(exc ? q.slice(1) : q);
        return exc ? !hit : hit;
      })
      .map((b) => ({
        id: "bm:" + b.t.toFixed(3),
        t: b.t,
        glyph: "▼",
        level: "mark",
        kind: "書籤",
        label: b.label,
        detail: "",
        bookmark: true,
      }));
    return [...evs, ...marks].sort((a, b) => a.t - b.t);
  }, [events, bookmarks, query, kinds]);

  // 目前落在哪一列：最後一個 t <= cursorT 的
  const activeIdx = useMemo(() => {
    let idx = -1;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].t <= cursor.cursorT + 1e-6) idx = i;
      else break;
    }
    return idx;
  }, [rows, cursor.cursorT]);

  const activeId = activeIdx >= 0 ? rows[activeIdx].id : "";
  useEffect(() => {
    if (!follow) return;
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeId, follow]);

  const seek = (t: number) => {
    if (onSeek) onSeek(t);
    else cursor.setCursor(t, true);
  };

  return (
    <div className="ev">
      <div className="ev-tools">
        <input
          ref={searchRef}
          className="ev-search"
          value={query}
          placeholder="篩選（! 開頭為排除，如 !loop）"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setQuery("");
              e.currentTarget.blur();
            }
            e.stopPropagation(); // 打字時不要觸發 Space / 1 / 2 / 4 那些全域鍵
          }}
        />
        <button
          className={follow ? "tb-btn on" : "tb-btn"}
          title="游標移動時自動捲到對應的那一列"
          onClick={() => setFollow(!follow)}
        >
          跟隨
        </button>
      </div>

      {/* 九個 chip 一套系統：未選無框、已選橘框、這份 log 裡沒有的那幾類再降一階。
          原本九種顏色是獨立於 series-* 與 tone 之外的第三套色彩系統——
          類別的輕重由旁邊的形狀字元與數字承擔，不由 chip 底色承擔。 */}
      <div className="ev-kinds">
        {EVENT_KINDS.map((k) => {
          const n = counts.get(k) ?? 0;
          const on = !off.has(k);
          return (
            <button
              key={k}
              className={"ev-chip" + (on ? " on" : "") + (n === 0 ? " empty" : "")}
              title={
                n === 0
                  ? KIND_LABEL[k] + "：這份 log 裡沒有這一類"
                  : KIND_LABEL[k] + " " + n + " 筆" + (on ? "（點一下收起來）" : "（點一下顯示）")
              }
              onClick={() => onToggleKind(k)}
            >
              {KIND_LABEL[k]}
              <span className="n fgc-num">{n}</span>
            </button>
          );
        })}
      </div>

      <div className="ev-count">
        <span className="fgc-num">{rows.length}</span> / <span className="fgc-num">
          {events.length + bookmarks.length}
        </span>{" "}
        筆
      </div>

      <div className="ev-rows" ref={boxRef}>
        {rows.length === 0 && (
          <div className="ev-empty">
            {events.length + bookmarks.length === 0
              ? "這份 log 裡沒有偵測到事件（八類 + 通知）。"
              : `這個篩選條件下沒有事件。清掉上面的篩選字串、或把類別重新打開，看全部 ${events.length + bookmarks.length} 筆。`}
          </div>
        )}
        {rows.map((r, i) => (
          <button
            key={r.id}
            ref={i === activeIdx ? activeRef : undefined}
            className={"ev-row " + r.level + (i === activeIdx ? " active" : "")}
            onClick={() => seek(r.t)}
            title={r.detail || r.label}
          >
            <span className="g">{r.glyph}</span>
            <span className="t fgc-num">{r.t.toFixed(2)}</span>
            <span className="k">{r.kind}</span>
            <span className="l">
              {r.label}
              {r.detail && <span className="d">{r.detail}</span>}
            </span>
            {r.bookmark && onRemoveBookmark && (
              <span
                className="ev-x"
                title="刪掉這顆書籤"
                role="button"
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveBookmark(r.t);
                }}
              >
                ×
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
