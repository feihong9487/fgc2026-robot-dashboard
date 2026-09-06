// Bookmarks（§3.4 #34）：人打的標記，存 localStorage，以「檔案指紋」為 key。
//
// 事件是機器算的、書籤是人看到的。匯出 Markdown 時兩者交錯排在同一張時間表，
// 那就是賽後檢討記錄的初稿——全目錄成本最低的高價值元件。
//
// 「檔案 hash」在這裡是**內容指紋**而不是位元組雜湊：位元組在 streaming 解析時
// 已經被丟掉了（jsonl.ts 是逐行解析不留原文），而重新讀一次 2–20 MB 只為了算 hash
// 是拿使用者的三秒鐘換一個沒人看得到的數字。指紋取
// 「檔名 + 批數 + 樣本數 + 欄位數 + tMin/tMax」，同一份檔案重開必然一致，
// 不同檔案碰撞的機率低到可以忽略；真的碰撞了也只是書籤跑到另一份 log 上，不會壞資料。

import type { LogStore } from "../../lib/LogStore";
import * as persist from "../../lib/persist";

export interface Bookmark {
  /** log 時間軸上的秒（機器人時戳）。 */
  t: number;
  label: string;
  /** 打書籤的牆鐘時間，用來在儲存空間滿的時候淘汰最舊的檔案。 */
  at: number;
}

/** 一份 log 最多存這麼多顆；超過就丟最舊的（打了 200 顆的人不會回頭看第 201 顆）。 */
const MAX_PER_LOG = 200;
/** 最多記住這麼多份 log 的書籤；超過就淘汰「最後一次打書籤」最舊的那一份。 */
const MAX_LOGS = 40;

type Store = Record<string, Bookmark[]>;

function readAll(): Store {
  const raw = persist.get<Store>(persist.KEYS.bookmarks, {});
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
}

function writeAll(all: Store): void {
  const keys = Object.keys(all);
  if (keys.length > MAX_LOGS) {
    const newest = (fp: string) => all[fp].reduce((m, b) => Math.max(m, b.at), 0);
    keys
      .sort((a, b) => newest(b) - newest(a))
      .slice(MAX_LOGS)
      .forEach((fp) => delete all[fp]);
  }
  persist.set(persist.KEYS.bookmarks, all);
}

/** FNV-1a 32 位元，輸出 8 碼十六進位。夠短可以顯示在畫面上，方便人工比對是不是同一份。 */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export function logFingerprint(name: string, log: LogStore): string {
  const [a, b] = log.tRange;
  return fnv1a(
    [name, log.batchCount, log.samples, log.keys().length, a.toFixed(3), b.toFixed(3)].join("|"),
  );
}

export function loadBookmarks(fp: string): Bookmark[] {
  const list = readAll()[fp];
  if (!Array.isArray(list)) return [];
  return list
    .filter((b) => b && typeof b.t === "number" && Number.isFinite(b.t) && typeof b.label === "string")
    .map((b) => ({ t: b.t, label: b.label, at: typeof b.at === "number" ? b.at : 0 }))
    .sort((x, y) => x.t - y.t);
}

export function saveBookmarks(fp: string, list: readonly Bookmark[]): Bookmark[] {
  const all = readAll();
  const trimmed = [...list].sort((x, y) => x.t - y.t).slice(-MAX_PER_LOG);
  if (trimmed.length === 0) delete all[fp];
  else all[fp] = trimmed;
  writeAll(all);
  return trimmed;
}

/** 同一個時刻（±1 ms）只留一顆：Ctrl+B 按兩下是改標籤，不是疊兩顆。 */
export function addBookmark(fp: string, t: number, label: string, now = Date.now()): Bookmark[] {
  const list = loadBookmarks(fp).filter((b) => Math.abs(b.t - t) > 0.001);
  list.push({ t, label: label.trim() || "書籤", at: now });
  return saveBookmarks(fp, list);
}

export function removeBookmark(fp: string, t: number): Bookmark[] {
  return saveBookmarks(
    fp,
    loadBookmarks(fp).filter((b) => Math.abs(b.t - t) > 0.001),
  );
}

export function clearBookmarks(fp: string): Bookmark[] {
  return saveBookmarks(fp, []);
}
