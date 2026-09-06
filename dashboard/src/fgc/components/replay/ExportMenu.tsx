// ExportMenu（§3.4 #36）：四種輸出 + 三層下載路徑。
//
// 每一次匯出都做三件事：產生文字、送出去、**說出實際成功的是哪一層**。
// 「按了沒反應」與「存到別的地方去了」在賽場上是完全不同的兩件事，不可以混成
// 一句「已匯出」——所以結果列會寫「已下載到瀏覽器的下載資料夾」而不是一顆綠勾。
//
// 預覽區永遠留著：三條路都失敗時（無痕視窗 + 非安全內容 + 不是 Tauri），
// 使用者至少還能用滑鼠把文字選起來。

import { useMemo, useState } from "react";
import type { LogStore } from "../../lib/LogStore";
import { cursor } from "../../lib/cursorStore";
import { useCursor } from "../../lib/hooks";
import { view } from "../graph/viewWindow";
import type { LogEvent } from "../../lib/eventDetect";
import type { Bookmark } from "./bookmarks";
import {
  DELIVERY_LABEL,
  deliver,
  suggestName,
  toCSV,
  toConstantsSnippet,
  toJsonlClip,
  toMarkdown,
  type Delivery,
  type Range,
} from "./exporters";

interface Props {
  log: LogStore;
  name: string;
  events: readonly LogEvent[];
  bookmarks: readonly Bookmark[];
  /** CSV 欄位與區間統計的對象（通常就是圖上那幾條 + 色帶那幾列）。 */
  keys: readonly string[];
}

type RangeId = "sel" | "view" | "all";
type Kind = "csv" | "md" | "jsonl" | "java";

const KIND_LABEL: Record<Kind, string> = {
  csv: "CSV（tick 對齊）",
  md: "Markdown（事件 + 書籤 + 統計）",
  jsonl: "JSONL 剪輯（只留選區）",
  java: "Constants 片段",
};

export function ExportMenu({ log, name, events, bookmarks, keys }: Props) {
  useCursor();
  const [open, setOpen] = useState(false);
  const [rangeId, setRangeId] = useState<RangeId>("sel");
  const [result, setResult] = useState<{ kind: Kind; bytes: number; how: Delivery; file: string } | null>(null);
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);

  const sel = cursor.selection;
  const ranges = useMemo<Record<RangeId, Range | null>>(() => {
    const [a, b] = log.tRange;
    return {
      sel: sel && sel.t1 > sel.t0 ? { t0: sel.t0, t1: sel.t1, label: "選取區間" } : null,
      view: { t0: Math.max(a, view.t0), t1: Math.min(b, view.t1), label: "可見視窗" },
      all: { t0: a, t1: b, label: "整份 log" },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [log, sel?.t0, sel?.t1, view.t0, view.t1]);

  const active: Range = ranges[rangeId] ?? ranges.all!;

  const run = async (kind: Kind) => {
    setBusy(true);
    try {
      let text = "";
      let file = "";
      let mime = "text/plain";
      let prefer: "file" | "clipboard" = "file";
      if (kind === "csv") {
        text = toCSV(log, keys, active);
        file = suggestName(name, "csv", active, "csv");
        mime = "text/csv";
      } else if (kind === "md") {
        text = toMarkdown({ name, log, range: active, events, bookmarks, statKeys: keys });
        file = suggestName(name, "notes", active, "md");
        mime = "text/markdown";
        prefer = "clipboard";
      } else if (kind === "jsonl") {
        text = toJsonlClip(log, active);
        file = suggestName(name, "clip", active, "jsonl");
        mime = "application/x-ndjson";
      } else {
        text = toConstantsSnippet(log, cursor.cursorT);
        file = suggestName(name, "constants", active, "java");
        mime = "text/x-java-source";
        prefer = "clipboard";
      }
      const how = await deliver(text, file, mime, prefer);
      setPreview(text.length > 1200 ? text.slice(0, 1200) + "\n…（預覽截斷，實際內容完整）" : text);
      setResult({ kind, bytes: new Blob([text]).size, how, file });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ex">
      <button className={open ? "tb-btn on" : "tb-btn"} onClick={() => setOpen(!open)}>
        匯出 ▾
      </button>
      {open && (
        <div className="ex-pop">
          <div className="ex-row">
            <span className="ex-lbl">範圍</span>
            {(["sel", "view", "all"] as RangeId[]).map((id) => {
              const r = ranges[id];
              return (
                <button
                  key={id}
                  className={rangeId === id ? "tb-btn on" : "tb-btn"}
                  disabled={!r}
                  title={r ? r.t0.toFixed(2) + " → " + r.t1.toFixed(2) + " s" : "還沒框選（在時間軸上 Shift+拖曳，或按 [ 與 ]）"}
                  onClick={() => setRangeId(id)}
                >
                  {id === "sel" ? "選取區間" : id === "view" ? "可見視窗" : "整份 log"}
                </button>
              );
            })}
            <span className="ex-span fgc-num">
              {active.t0.toFixed(2)} → {active.t1.toFixed(2)} s（{(active.t1 - active.t0).toFixed(2)} s）
            </span>
          </div>

          <div className="ex-row">
            <span className="ex-lbl">輸出</span>
            {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
              <button key={k} className="tb-btn" disabled={busy} onClick={() => void run(k)}>
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>

          <div className="ex-note">
            CSV / JSONL 走「Tauri 存檔 → 瀏覽器下載 → 剪貼簿」；Markdown / Constants 片段把剪貼簿排第一
            （下一步是貼進聊天室或 OnBotJava，不是躺在下載資料夾）。CSV 欄位取圖上與色帶上的 {keys.length} 條。
          </div>

          {result && (
            <div className={"ex-result " + (result.how === "failed" ? "bad" : "ok")}>
              <b>{KIND_LABEL[result.kind]}</b>　{fmtBytes(result.bytes)}　·　{result.file}
              <br />
              {DELIVERY_LABEL[result.how]}
            </div>
          )}
          {preview && <pre className="ex-prev">{preview}</pre>}
        </div>
      )}
    </div>
  );
}

function fmtBytes(n: number): string {
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / 1024 / 1024).toFixed(2) + " MB";
}
