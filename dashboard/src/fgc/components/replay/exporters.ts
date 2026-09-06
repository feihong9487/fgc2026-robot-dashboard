// ExportMenu 的四種輸出（§3.4 #36），全部是純函式，好測也好在 node 裡驗。
//
//   CSV            tick 對齊，每列一 tick，ZOH 取值 —— 貼進試算表用
//   Markdown       事件 + 書籤交錯的時間表 + 區間統計 —— 賽後檢討記錄的初稿
//   JSONL 剪輯     只留選區（2 MB → 200 KB，方便貼給隊友）
//   Constants 片段 貼回 OnBotJava 用
//
// 「tick」是查詢時的投影，不是儲存格式：LogStore 是每個 key 各自的稀疏序列，
// 匯出 CSV 時才把它們投影到同一組時刻上（§3.1 #1）。tick 一律取**批次時戳**，
// 不自己造等間隔網格——造網格等於在資料裡插入機器人從來沒送過的時刻。

import type { LogStore } from "../../lib/LogStore";
import { K, TUNABLES, paramKey, shortName } from "../../lib/fgcKeys";
import { summarize } from "../../lib/stats";
import { copyText } from "../health/clipboard";
import type { LogEvent } from "../../lib/eventDetect";
import { KIND_LABEL, LEVEL_GLYPH } from "../../lib/eventDetect";
import type { Bookmark } from "./bookmarks";
import type { NtValue } from "../../../lib/store";

const BIG = Number.MAX_SAFE_INTEGER;

export interface Range {
  t0: number;
  t1: number;
  /** 「選取區間」「可見視窗」「整份 log」…，直接寫進匯出的標頭。 */
  label: string;
}

/**
 * 批次時戳。優先用 /FGC/Status/Match s 的變化點（機器人每圈重算，必然每批都變），
 * 沒有這個埋點才用「tMin + 逐段累加 batchIntervals()」重建。
 */
export function tickTimes(log: LogStore, t0: number, t1: number): Float64Array {
  let all: Float64Array;
  if (log.has(K.matchS)) {
    all = log.changePoints(K.matchS);
  } else {
    const iv = log.batchIntervals();
    all = new Float64Array(iv.length + 1);
    all[0] = log.tMin;
    for (let i = 0; i < iv.length; i++) all[i + 1] = all[i] + iv[i];
  }
  const out = new Float64Array(all.length);
  let n = 0;
  for (let i = 0; i < all.length; i++) if (all[i] >= t0 && all[i] <= t1) out[n++] = all[i];
  return out.slice(0, n);
}

function csvCell(s: string): string {
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function valueText(log: LogStore, key: string, t: number): string {
  const kind = log.kindOf(key);
  if (kind === "str") {
    const s = log.stringAt(key, t);
    return s === null ? "" : s;
  }
  const v = log.valueAt(key, t);
  if (v === null) return "";
  if (kind === "bool") return v > 0.5 ? "true" : "false";
  return String(parseFloat(v.toPrecision(10)));
}

/** CSV：每列一 tick，欄位值用 zero-order hold。空字串代表「這一刻之前機器人還沒送過這個 key」。 */
export function toCSV(log: LogStore, keys: readonly string[], r: Range): string {
  const ts = tickTimes(log, r.t0, r.t1);
  const lines: string[] = [];
  lines.push(["t", ...keys].map(csvCell).join(","));
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i];
    const row = [t.toFixed(3)];
    for (const k of keys) row.push(csvCell(valueText(log, k, t)));
    lines.push(row.join(","));
  }
  return lines.join("\n") + "\n";
}

interface TimedValue {
  t: number;
  v: NtValue;
}

/** 某個 key 在 [t0,t1] 內的原始樣本（不含 t0 之前的錨點）。 */
function keySamples(log: LogStore, key: string, t0: number, t1: number): TimedValue[] {
  const kind = log.kindOf(key);
  const out: TimedValue[] = [];
  if (kind === "str") {
    const runs = log.runs(key, t0, t1, 1000000);
    for (let i = 0; i < runs.length; i++) {
      if (runs[i].t0 <= t0) continue; // 第一段是被裁到 t0 的錨點，已經在快照裡了
      out.push({ t: runs[i].t0, v: runs[i].s ?? "" });
    }
    return out;
  }
  const w = log.sampleWindow(key, t0, t1, BIG);
  for (let i = 0; i < w.n; i++) {
    if (w.xs[i] < t0) continue;
    out.push({ t: w.xs[i], v: kind === "bool" ? w.ys[i] > 0.5 : w.ys[i] });
  }
  return out;
}

/**
 * JSONL 剪輯。格式與機器人端 DashRec.addLine 一致（一行一批 {"t":…,"d":{…}}）。
 *
 * 第一行刻意是**整份快照**（選區起點的所有 ZOH 值），之後才是 diff：
 * 原始串流是 diff，直接剪一段出來的話，剪點之前就沒變過的 key 在新檔案裡永遠不存在，
 * 收到檔案的隊友會看到一堆「無此埋點」。多這一行，剪輯就是自給自足的一份 log。
 */
export function toJsonlClip(log: LogStore, r: Range): string {
  const keys = log.keys();
  const snap: Record<string, NtValue> = {};
  for (const k of keys) {
    const kind = log.kindOf(k);
    if (kind === "str") {
      const s = log.stringAt(k, r.t0);
      if (s !== null) snap[k] = s;
    } else {
      const v = log.valueAt(k, r.t0);
      if (v !== null) snap[k] = kind === "bool" ? v > 0.5 : v;
    }
  }
  const byT = new Map<number, Record<string, NtValue>>();
  for (const k of keys) {
    for (const s of keySamples(log, k, r.t0, r.t1)) {
      let d = byT.get(s.t);
      if (!d) {
        d = {};
        byT.set(s.t, d);
      }
      d[k] = s.v;
    }
  }
  const times = Array.from(byT.keys()).sort((a, b) => a - b);
  const lines: string[] = [];
  lines.push(JSON.stringify({ t: round3(r.t0), d: snap }));
  for (const t of times) {
    if (t <= r.t0) continue;
    lines.push(JSON.stringify({ t: round3(t), d: byT.get(t) }));
  }
  return lines.join("\n") + "\n";
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

export interface MarkdownInput {
  name: string;
  log: LogStore;
  range: Range;
  events: readonly LogEvent[];
  bookmarks: readonly Bookmark[];
  /** 要做區間統計的欄位（通常就是圖上那幾條）。 */
  statKeys: readonly string[];
}

/** Markdown：事件與書籤交錯排在同一張時間表，下面接區間統計與誠實欄（時戳來源、缺口）。 */
export function toMarkdown(inp: MarkdownInput): string {
  const { name, log, range, statKeys } = inp;
  const events = inp.events.filter((e) => e.t >= range.t0 && e.t <= range.t1);
  const marks = inp.bookmarks.filter((b) => b.t >= range.t0 && b.t <= range.t1);
  const L: string[] = [];

  L.push("# 回放檢討 · " + name);
  L.push("");
  L.push(
    "- 範圍：**" +
      range.label +
      "** " +
      range.t0.toFixed(3) +
      " → " +
      range.t1.toFixed(3) +
      " s（" +
      (range.t1 - range.t0).toFixed(3) +
      " s）",
  );
  L.push(
    "- 時戳來源：**t=" +
      log.tSource +
      "**" +
      (log.tSource === "client" ? "（本機時鐘，精度只有 ±50 ms，不要拿去比較 1200 與 1300）" : "（/FGC/Status/Match s）"),
  );
  L.push("- 批數：" + log.batchCount + " · 欄位：" + log.keys().length + " · 樣本：" + log.samples);
  const gaps = log.gaps(1.0).filter((g) => g.t1 >= range.t0 && g.t0 <= range.t1);
  L.push(
    "- 資料缺口：" +
      (gaps.length === 0
        ? "0 處"
        : gaps.length + " 處（" + gaps.map((g) => g.t0.toFixed(1) + "–" + g.t1.toFixed(1) + "s").join("、") + "）"),
  );
  L.push("");

  L.push("## 時間表");
  L.push("");
  L.push("| t (s) | | 類別 | 內容 |");
  L.push("|---:|:-:|---|---|");
  const rows: { t: number; glyph: string; kind: string; text: string }[] = [];
  for (const e of events) {
    rows.push({
      t: e.t,
      glyph: LEVEL_GLYPH[e.level],
      kind: KIND_LABEL[e.kind],
      text: e.label + (e.detail ? " — " + e.detail : ""),
    });
  }
  for (const b of marks) rows.push({ t: b.t, glyph: "⚑", kind: "書籤", text: b.label });
  rows.sort((a, b) => a.t - b.t);
  if (rows.length === 0) L.push("| — | | | 這個範圍裡沒有事件或書籤 |");
  for (const r of rows) {
    L.push("| " + r.t.toFixed(3) + " | " + r.glyph + " | " + r.kind + " | " + r.text.replace(/\|/g, "\\|") + " |");
  }
  L.push("");

  if (statKeys.length > 0) {
    L.push("## 區間統計");
    L.push("");
    L.push("| 欄位 | n | min | max | mean | σ |");
    L.push("|---|---:|---:|---:|---:|---:|");
    for (const k of statKeys) {
      if (log.kindOf(k) === "str") continue;
      const s = summarize(log.valuesInWindow(k, range.t0, range.t1));
      if (s.count === 0) {
        L.push("| `" + k + "` | 0 | — | — | — | — |");
        continue;
      }
      L.push(
        "| `" +
          k +
          "` | " +
          s.count +
          " | " +
          num(s.min) +
          " | " +
          num(s.max) +
          " | " +
          num(s.mean) +
          " | " +
          num(s.sigma) +
          " |",
      );
    }
    L.push("");
    L.push("> σ 是母體標準差。調參的正確問題不是「轉速多少」而是「轉速多穩」。");
    L.push("");
  }

  const dips = events.filter((e) => e.kind === "dip");
  if (dips.length > 0) {
    L.push("## 每球 dip（解析度 ±50 ms）");
    L.push("");
    L.push("| # | t (s) | 底值 | 深度 | 恢復 ms | 跌破門檻 |");
    L.push("|---:|---:|---:|---:|---:|:-:|");
    for (const e of dips) {
      const d = e.data ?? {};
      L.push(
        "| " +
          String(d.seq ?? "") +
          " | " +
          e.t.toFixed(3) +
          " | " +
          num(Number(d.bottom)) +
          " | " +
          num(Number(d.depth)) +
          " | " +
          num(Number(d.recoverMs)) +
          " | " +
          (d.below ? "是 ⚠" : "否") +
          " |",
      );
    }
    L.push("");
  }
  return L.join("\n") + "\n";
}

function num(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  return a >= 100 ? v.toFixed(0) : a >= 1 ? v.toFixed(2) : v.toFixed(4);
}

/**
 * Constants 片段。機器人端已經把片段組好放在 /FGC/Param/_Snippet（DashParams.java:229），
 * 有就直接用它——那是機器人自己說的話，比前端拼的可信。
 * 沒有（舊 build / 這份 log 沒錄到）才依 21 項白名單的 /FGC/Param/* 回讀值重組，並標明來源。
 */
export function toConstantsSnippet(log: LogStore, t: number): string {
  const snip = log.stringAt(K.snippet, t);
  if (snip && snip.trim()) {
    return "// 來源：/FGC/Param/_Snippet @ " + t.toFixed(3) + " s（機器人端組好的）\n" + snip.trim() + "\n";
  }
  const L: string[] = [];
  L.push("// 來源：儀表板依 /FGC/Param/* 回讀值重組 @ " + t.toFixed(3) + " s");
  L.push("// （這份 log 裡沒有 /FGC/Param/_Snippet；貼回去之前請逐行核對）");
  let missing = 0;
  for (const tn of TUNABLES) {
    const v = log.valueAt(paramKey(tn.name), t);
    if (v === null) {
      missing++;
      L.push("// " + tn.name + " —— log 裡沒有回讀值");
      continue;
    }
    if (tn.kind === "bool") {
      L.push("public static volatile boolean " + tn.name + " = " + (v > 0.5 ? "true" : "false") + ";");
    } else {
      L.push("public static volatile double " + tn.name + " = " + trimNum(v) + ";");
    }
  }
  if (missing > 0) L.push("// 共 " + missing + " 項沒有回讀值");
  return L.join("\n") + "\n";
}

function trimNum(v: number): string {
  const s = String(parseFloat(v.toPrecision(10)));
  return s.includes(".") || s.includes("e") ? s : s;
}

/** 檔名：<log 名>-<種類>-<起>-<迄>.<副檔名>。 */
export function suggestName(base: string, kind: string, r: Range, ext: string): string {
  const stem = base.replace(/\.jsonl$/i, "").replace(/[^A-Za-z0-9_.-]+/g, "_") || "replay";
  return stem + "-" + kind + "-" + r.t0.toFixed(1) + "-" + r.t1.toFixed(1) + "." + ext;
}

export type Delivery = "tauri" | "download" | "clipboard" | "execCommand" | "failed";

export const DELIVERY_LABEL: Record<Delivery, string> = {
  tauri: "已存成檔案（Tauri 存檔對話框）",
  download: "已下載到瀏覽器的下載資料夾",
  clipboard: "已複製到剪貼簿",
  execCommand: "已複製到剪貼簿（execCommand 後路）",
  failed: "三條路都失敗了，請手動選取下面的預覽文字",
};

interface TauriFs {
  save?: (opts: unknown) => Promise<string | null>;
  writeTextFile?: (path: string, contents: string) => Promise<void>;
}

/**
 * 三層下載路徑（§3.4 #36）：Tauri 存檔對話框 → Blob + a.click() → 剪貼簿。
 *
 * prefer="clipboard" 的（Markdown、Constants 片段）把剪貼簿排到最前面：
 * 那兩種東西的下一步一定是貼進聊天室或 OnBotJava，不是躺在下載資料夾裡。
 * 每一層都回報**實際成功的是哪一層**——「按了沒反應」與「存到別的地方」在賽場上
 * 是完全不同的兩件事，不可以混成一句「已匯出」。
 */
export async function deliver(
  text: string,
  filename: string,
  mime: string,
  prefer: "file" | "clipboard" = "file",
): Promise<Delivery> {
  const tryClipboard = async (): Promise<Delivery | null> => {
    const r = await copyText(text);
    return r === "failed" ? null : r;
  };
  const tryTauri = async (): Promise<Delivery | null> => {
    try {
      const g = window as unknown as { __TAURI__?: { dialog?: TauriFs; fs?: TauriFs } };
      const dialog = g.__TAURI__?.dialog;
      const fs = g.__TAURI__?.fs;
      if (!dialog?.save || !fs?.writeTextFile) return null;
      const path = await dialog.save({ defaultPath: filename });
      if (!path) return null;
      await fs.writeTextFile(path, text);
      return "tauri";
    } catch {
      return null;
    }
  };
  const tryDownload = async (): Promise<Delivery | null> => {
    try {
      const url = URL.createObjectURL(new Blob([text], { type: mime }));
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      return "download";
    } catch {
      return null;
    }
  };

  const order =
    prefer === "clipboard" ? [tryClipboard, tryTauri, tryDownload] : [tryTauri, tryDownload, tryClipboard];
  for (const step of order) {
    const r = await step();
    if (r) return r;
  }
  return "failed";
}

/** 匯出選單上顯示的欄位短名（給人看的）。 */
export function keyLabel(key: string): string {
  return shortName(key);
}
