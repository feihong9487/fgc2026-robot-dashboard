// jsonl：錄影檔的逐行解析與序列化。
//
// 檔案格式與機器人端 DashRec.addLine 一致，一行一批：
//   {"t":12.480,"d":{"/FGC/Shooter/SL":1904, ...}}
// t 的原點是 OpMode start（DashHub.t0()），與 /FGC/Status/Match s 同一條時間軸。
//
// 一律 streaming 解析：一份 150 s 的檔案是 2–20 MB，先 text() 再 split("\n")
// 會在字串層再複製一份整檔，舊筆電上那一下就是好幾百毫秒的卡頓。

import type { NtValue } from "../../lib/store";
import type { LogStore } from "./LogStore";

export interface Batch {
  t: number;
  d: Record<string, NtValue>;
}

export interface ParseResult {
  batches: number;
  bad: number;
  tMin: number;
  tMax: number;
}

function parseLine(line: string): Batch | null {
  const s = line.trim();
  if (!s || s.charCodeAt(0) !== 123 /* { */) return null;
  try {
    const o = JSON.parse(s) as { t?: unknown; d?: unknown };
    if (typeof o.t !== "number" || !Number.isFinite(o.t)) return null;
    if (!o.d || typeof o.d !== "object" || Array.isArray(o.d)) return null;
    return { t: o.t, d: o.d as Record<string, NtValue> };
  } catch {
    return null;
  }
}

/** 一行一行餵給 onBatch；回傳統計。text 版給小檔案與測試用。 */
export function parseJsonlText(text: string, onBatch: (b: Batch) => void): ParseResult {
  const res: ParseResult = { batches: 0, bad: 0, tMin: Infinity, tMax: -Infinity };
  let start = 0;
  while (start <= text.length) {
    let nl = text.indexOf("\n", start);
    if (nl < 0) nl = text.length;
    const line = text.slice(start, nl);
    start = nl + 1;
    if (!line.trim()) {
      if (nl >= text.length) break;
      continue;
    }
    const b = parseLine(line);
    if (!b) {
      res.bad++;
    } else {
      res.batches++;
      if (b.t < res.tMin) res.tMin = b.t;
      if (b.t > res.tMax) res.tMax = b.t;
      onBatch(b);
    }
    if (nl >= text.length) break;
  }
  if (res.batches === 0) {
    res.tMin = 0;
    res.tMax = 0;
  }
  return res;
}

/**
 * ReadableStream 逐行解析（RecBrowser 的 fetch 與拖放檔案共用）。
 * onProgress 拿到的是已讀位元組數，用來畫載入進度。
 */
export async function parseJsonlStream(
  stream: ReadableStream<Uint8Array>,
  onBatch: (b: Batch) => void,
  onProgress?: (bytes: number) => void,
): Promise<ParseResult> {
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8");
  const res: ParseResult = { batches: 0, bad: 0, tMin: Infinity, tMax: -Infinity };
  let carry = "";
  let bytes = 0;

  const take = (chunk: string, last: boolean) => {
    carry += chunk;
    let start = 0;
    for (;;) {
      const nl = carry.indexOf("\n", start);
      if (nl < 0) break;
      const line = carry.slice(start, nl);
      start = nl + 1;
      const b = parseLine(line);
      if (!b) {
        if (line.trim()) res.bad++;
      } else {
        res.batches++;
        if (b.t < res.tMin) res.tMin = b.t;
        if (b.t > res.tMax) res.tMax = b.t;
        onBatch(b);
      }
    }
    carry = carry.slice(start);
    if (last && carry.trim()) {
      const b = parseLine(carry);
      if (!b) res.bad++;
      else {
        res.batches++;
        if (b.t < res.tMin) res.tMin = b.t;
        if (b.t > res.tMax) res.tMax = b.t;
        onBatch(b);
      }
      carry = "";
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    take(decoder.decode(value, { stream: true }), false);
    onProgress?.(bytes);
  }
  take(decoder.decode(), true);
  if (res.batches === 0) {
    res.tMin = 0;
    res.tMax = 0;
  }
  return res;
}

/**
 * 直接灌進一個 LogStore 實例（回放與 A/B 都走這條）。
 *
 * 逐批寫進去，不先堆成陣列。堆成陣列會讓「全部批次的 JS 物件」同時活在記憶體裡
 * （一份 20 MB 的錄影檔是幾十萬個 batch 物件 + 每個 key 一個字串參照，解析後的
 * 物件表示遠比原文肥），換來的只是省下「原始字串的第二份拷貝」——很可能比直接
 * text() 更糟。這樣峰值就只有 LogStore 自己的 Float64Array，而且 onProgress
 * 走完之後不必再等一次全量 applyBatches。
 */
export async function loadIntoLog(
  log: LogStore,
  source: ReadableStream<Uint8Array> | string,
  onProgress?: (bytes: number) => void,
): Promise<ParseResult> {
  log.beginBulk();
  try {
    const feed = (b: Batch) => {
      log.applyBatch(b.d, b.t);
    };
    return typeof source === "string"
      ? parseJsonlText(source, feed)
      : await parseJsonlStream(source, feed, onProgress);
  } finally {
    log.endBulk();
  }
}

/** 序列化回 jsonl（匯出選區剪輯用）。 */
export function serializeJsonl(batches: readonly Batch[]): string {
  let out = "";
  for (const b of batches) out += JSON.stringify(b) + "\n";
  return out;
}
