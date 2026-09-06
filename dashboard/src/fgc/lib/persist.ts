// persist：統一前綴 + schema 版本 + migration + 匯出/匯入全部設定。
//
// 現況是 9 個 localStorage 鍵散在 7 個檔案、兩套命名、無版本。這裡收攏成一套：
//   · 前綴一律 fgc.
//   · 版本存在 fgc.__schema，升版時跑 migration
//   · 匯出/匯入整包 JSON —— 換筆電不用重設，也順便解掉 Tauri 與瀏覽器兩個 origin
//     的 localStorage 不互通（§7.7）

const PREFIX = "fgc.";
const SCHEMA_KEY = PREFIX + "__schema";
export const SCHEMA_VERSION = 1;

type Migration = (all: Record<string, string>) => Record<string, string>;

/** 由 v(n-1) 升到 v(n)。第一版沒有前身，留空陣列。 */
const MIGRATIONS: Record<number, Migration> = {};

function safeGetRaw(key: string): string | null {
  try {
    return localStorage.getItem(PREFIX + key);
  } catch {
    return null; // 無痕模式 / 磁碟滿 / 被政策擋掉
  }
}

function safeSetRaw(key: string, value: string): void {
  try {
    localStorage.setItem(PREFIX + key, value);
  } catch {
    /* 存不進去不該讓 UI 掛掉 */
  }
}

export function get<T>(key: string, def: T): T {
  const raw = safeGetRaw(key);
  if (raw == null) return def;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return def;
  }
}

export function set(key: string, value: unknown): void {
  safeSetRaw(key, JSON.stringify(value));
}

export function remove(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* 同上 */
  }
}

/** 字串專用（host 這類值不必包一層 JSON 引號也能讀）。 */
export function getStr(key: string, def: string): string {
  const raw = safeGetRaw(key);
  if (raw == null) return def;
  if (raw.length >= 2 && raw[0] === '"') {
    try {
      const v = JSON.parse(raw);
      return typeof v === "string" ? v : def;
    } catch {
      return raw;
    }
  }
  return raw;
}

export function setStr(key: string, value: string): void {
  safeSetRaw(key, JSON.stringify(value));
}

// ── 全部設定的匯出 / 匯入 ─────────────────────────────────────────────

function allEntries(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(PREFIX) || k === SCHEMA_KEY) continue;
      const v = localStorage.getItem(k);
      if (v != null) out[k.slice(PREFIX.length)] = v;
    }
  } catch {
    /* 讀不到就當空的 */
  }
  return out;
}

export interface SettingsBundle {
  schema: number;
  exportedAt: string;
  entries: Record<string, string>;
}

export function exportAll(): SettingsBundle {
  return { schema: SCHEMA_VERSION, exportedAt: new Date().toISOString(), entries: allEntries() };
}

/** 回傳寫入筆數；格式不對回 -1。 */
export function importAll(bundle: unknown): number {
  if (!bundle || typeof bundle !== "object") return -1;
  const b = bundle as Partial<SettingsBundle>;
  if (typeof b.schema !== "number" || !b.entries || typeof b.entries !== "object") return -1;
  let entries = b.entries as Record<string, string>;
  entries = runMigrations(entries, b.schema);
  let n = 0;
  for (const [k, v] of Object.entries(entries)) {
    if (typeof v !== "string") continue;
    safeSetRaw(k, v);
    n++;
  }
  try {
    localStorage.setItem(SCHEMA_KEY, String(SCHEMA_VERSION));
  } catch {
    /* 同上 */
  }
  return n;
}

function runMigrations(entries: Record<string, string>, from: number): Record<string, string> {
  let cur = entries;
  for (let v = from + 1; v <= SCHEMA_VERSION; v++) {
    const m = MIGRATIONS[v];
    if (m) cur = m(cur);
  }
  return cur;
}

/** 開機呼叫一次：把舊 schema 的資料升上來。 */
export function migrate(): void {
  let stored = 0;
  try {
    stored = Number(localStorage.getItem(SCHEMA_KEY) ?? 0) || 0;
  } catch {
    return;
  }
  if (stored === SCHEMA_VERSION) return;
  if (stored < SCHEMA_VERSION && stored > 0) {
    const next = runMigrations(allEntries(), stored);
    for (const [k, v] of Object.entries(next)) safeSetRaw(k, v);
  }
  try {
    localStorage.setItem(SCHEMA_KEY, String(SCHEMA_VERSION));
  } catch {
    /* 同上 */
  }
}

/** 已知鍵名集中在這裡，避免又散回七個檔案。 */
export const KEYS = {
  host: "host",
  tab: "tab",
  theme: "theme",
  density: "density",
  pinned: "pinned",
  matchClock: "matchClock",
  bookmarks: "bookmarks",
  lastBackup: "lastBackup",
  loopSnapshots: "loopSnapshots",
  camMode: "camMode",
} as const;
