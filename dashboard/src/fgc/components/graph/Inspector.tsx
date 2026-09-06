// Inspector（§3.3 #32）：游標讀值。三欄 —— 欄位 / cursorT 的值 / hoverT 的值與差。
//
// 三條不可退讓的規則：
//   1. zero-order hold 二分查值：t 這一刻機器人上的值，不是「最近的樣本」也不是內插。
//   2. **過期值顯示灰色 + age，永遠不顯示空白。**
//      把「數值消失」誤讀成「距離 0」是視覺調校最常見的災難——螢幕上什麼都沒有，
//      人腦會自動填一個 0 進去，然後對著一個不存在的 0 調三十分鐘參數。
//   3. hoverT 欄不進 React state。滑鼠 60 Hz，這一欄直接寫 textContent，
//      否則整張表每秒重繪 60 次（§7.5 第 1 點：兩個 store 分離就是為了這個）。

import { useEffect, useMemo, useRef, useState } from "react";
import { copyOk } from "../../lib/clipboard";
import { LogStore, liveLog } from "../../lib/LogStore";
import { cursor } from "../../lib/cursorStore";
import { shortName, groupOf } from "../../lib/fgcKeys";
import { useCursor, useLogVersion, useFlash } from "../../lib/hooks";
import { fmtT } from "./timeAxis";
import { view } from "./viewWindow";

interface Props {
  log?: LogStore;
  keys: readonly string[];
  /** 允許移除一列（PIT / REPLAY 才給；MATCH 不會走到這一頁）。 */
  onRemoveKey?: (key: string) => void;
  /** 值距 cursorT 超過這麼久沒更新就標成過期。 */
  staleSec?: number;
}

/** 去掉尾端多餘零；tabular-nums 之下寬度仍然固定。 */
function fmtVal(v: number): string {
  if (!Number.isFinite(v)) return "—";
  if (Number.isInteger(v)) return String(v);
  return String(parseFloat(v.toPrecision(6)));
}

function readAt(log: LogStore, key: string, t: number): { text: string; num: number | null } {
  const kind = log.kindOf(key);
  if (kind === "str") {
    const s = log.stringAt(key, t);
    return { text: s === null ? "—" : s, num: null };
  }
  const v = log.valueAt(key, t);
  if (v === null) return { text: "—", num: null };
  if (kind === "bool") return { text: v > 0.5 ? "true" : "false", num: v };
  return { text: fmtVal(v), num: v };
}

export function Inspector({ log = liveLog, keys, onRemoveKey, staleSec = 2 }: Props) {
  useCursor();
  useLogVersion(log);
  const rootRef = useRef<HTMLDivElement>(null);
  const hoverCells = useRef(new Map<string, HTMLSpanElement>());
  const hoverHead = useRef<HTMLSpanElement>(null);
  const [copied, flashCopied] = useFlash(1600);

  const t = cursor.cursorT;

  const rows = useMemo(
    () =>
      keys.map((key) => {
        const cur = readAt(log, key, t);
        const upd = log.updatedAt(key, t);
        const age = upd === null ? null : t - upd;
        return { key, cur, age, missing: !log.has(key) };
      }),
    // t 與 log 版本都在外面訂閱了，這裡用 keys.join 讓陣列身分改變不觸發重算
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [keys.join("|"), t, log, log.getVersion()],
  );

  // hover 欄：60 Hz，直接寫 textContent，不進 React state
  useEffect(() => {
    const paint = (h: number | null) => {
      const head = hoverHead.current;
      if (head) head.textContent = h === null ? "懸停 —" : "懸停 " + fmtT(h, view.span) + " s";
      hoverCells.current.forEach((el, key) => {
        if (h === null) {
          el.textContent = "—";
          el.title = "";
          return;
        }
        const r = readAt(log, key, h);
        const c = readAt(log, key, cursor.cursorT);
        let extra = "";
        if (r.num !== null && c.num !== null && log.kindOf(key) === "num") {
          const d = r.num - c.num;
          extra = "  " + (d >= 0 ? "+" : "") + fmtVal(parseFloat(d.toPrecision(4)));
        }
        el.textContent = r.text + extra;
      });
    };
    paint(cursor.hoverT);
    return cursor.onHover(paint);
    // rows 不進 deps：它每次 render 都是新陣列，會讓 60 Hz 的 hover 訂閱一直重掛。
    // paint 每次呼叫都現讀 log 與 cursor，所以不需要閉包裡的舊值。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [log, keys.join("|")]);

  const markdown = () => {
    const lines: string[] = [];
    lines.push("| 欄位 | @ " + t.toFixed(3) + " s | 年齡 |");
    lines.push("|---|---|---|");
    for (const r of rows) {
      const age = r.age === null ? "—" : r.age.toFixed(2) + " s";
      lines.push("| `" + r.key + "` | " + r.cur.text + " | " + age + " |");
    }
    const sel = cursor.selection;
    if (sel && sel.t1 > sel.t0) {
      lines.push("");
      lines.push("選區 " + sel.t0.toFixed(3) + " → " + sel.t1.toFixed(3) + " s（" + (sel.t1 - sel.t0).toFixed(3) + " s）");
    }
    return lines.join("\n");
  };

  const copy = () => {
    void copyText(markdown()).then((ok) => {
      flashCopied(ok ? "已複製成 Markdown" : "複製失敗，請手動選取");
    });
  };

  return (
    <div
      className="insp"
      ref={rootRef}
      tabIndex={0}
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && (e.key === "c" || e.key === "C")) {
          e.preventDefault();
          copy();
        }
      }}
    >
      <div className="insp-head">
        <span className="at">
          {"@ "}
          <span className="fgc-num">{fmtT(t, view.span)}</span>
          <span className="fgc-unit">s</span>
        </span>
        <span className="hov" ref={hoverHead}>
          懸停 —
        </span>
        <button className="tb-btn" title="Ctrl+C：複製游標時刻所有值成 Markdown" onClick={copy}>
          複製
        </button>
      </div>
      {copied && <div className="insp-toast">{copied}</div>}
      <div className="insp-rows">
        {rows.length === 0 && <div className="insp-empty">還沒有訂閱任何欄位。釘選或拖曳訊號進圖表就會出現在這裡。</div>}
        {rows.map((r) => {
          const stale = r.age !== null && r.age > staleSec;
          return (
            <div className={r.missing ? "insp-row missing" : stale ? "insp-row stale" : "insp-row"} key={r.key}>
              <span className="nm" title={r.key}>
                <span className="grp">{groupOf(r.key)}</span>
                {shortName(r.key)}
              </span>
              <span className="cur fgc-num">
                {r.missing ? "無此埋點" : r.cur.text}
                {/* 過期永遠顯示年齡而不是空白：值沒更新 ≠ 值是 0 */}
                {stale && <span className="age">{r.age!.toFixed(1)}s</span>}
              </span>
              <span
                className="hv fgc-num"
                ref={(el) => {
                  if (el) hoverCells.current.set(r.key, el);
                  else hoverCells.current.delete(r.key);
                }}
              >
                —
              </span>
              {/* × 只在滑到那一列時出現：一欄常駐的灰色 × 是第三套圖示語彙，
                  而移除是每小時零次的動作。欄寬照樣留著，所以滑過去不會位移。 */}
              {onRemoveKey && (
                <button className="insp-x" title={"移除 " + shortName(r.key)} onClick={() => onRemoveKey(r.key)}>
                  ×
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * 三層剪貼簿的唯一實作在 lib/clipboard.ts（Control Hub 是 http，
 * `navigator.clipboard` 在非安全內容底下是 undefined —— FTC CustomVariable.tsx:79-87
 * 的教訓）。這裡只 re-export 成布林版，既有呼叫端只在意成敗。
 */
export async function copyText(text: string): Promise<boolean> {
  return copyOk(text);
}
