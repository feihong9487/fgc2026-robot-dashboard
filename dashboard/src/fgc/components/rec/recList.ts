// /dash/rec.json 的解析與檔名規則（純函式；表格在 RecBrowser.tsx）。

export interface RecFileRow {
  name: string;
  size: number;
  mtime: number;
}

export interface RecList {
  dir: string;
  current: string;
  files: RecFileRow[];
  error?: string;
}

/**
 * 真機回 `{dir, current, files:[{name,size,mtime}]}`（DashHttp.java RecList）。
 * 防禦性解析：欄位缺了、型別不對、甚至整包是舊版的裸陣列，都只是少幾列，
 * 不可以讓賽後取檔這件事因為一個 JSON 欄位而整支炸掉。
 */
export function parseRecList(raw: unknown): RecList {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const files: RecFileRow[] = [];
  // 註解說「甚至整包是舊版的裸陣列，都只是少幾列」，那就真的要解得出來：
  // 以前這裡對裸陣列會整包退成 {}，files 變空——「機器人根本沒錄到」是賽後取檔
  // 最糟的失敗模式，因為它看起來完全不像故障。
  const arr = Array.isArray(raw) ? raw : Array.isArray(o.files) ? o.files : [];
  for (const f of arr) {
    if (!f || typeof f !== "object") continue;
    const r = f as Record<string, unknown>;
    const name = typeof r.name === "string" ? r.name : "";
    if (!name) continue;
    files.push({
      name,
      size: typeof r.size === "number" ? r.size : 0,
      mtime: typeof r.mtime === "number" ? r.mtime : 0,
    });
  }
  // 由新到舊：賽後要拿的永遠是剛剛那一場
  files.sort((a, b) => b.mtime - a.mtime);
  return {
    dir: typeof o.dir === "string" ? o.dir : "",
    current: typeof o.current === "string" ? o.current : "",
    files,
    error: typeof o.error === "string" ? o.error : undefined,
  };
}

/**
 * 機器人端的 `DashRec.safeName` 只收 `rec-*.jsonl`，但 `DashRec.listFiles` 列的是
 * **所有** `*.jsonl`（DashRec.java:265）。所以手動丟進 /sdcard/FIRST/fgc-rec 的檔案
 * （例如從別台機器拷過去的 `real-B1PIT-*.jsonl`）**會出現在清單上，點下去卻回 400**。
 *
 * 這是機器人端的一個小落差（一行可修：listFiles 也加 `startsWith("rec-")`）。
 * 在它被修掉之前，前端先把這件事講清楚——一個沒有解釋的 400 在賽場上會被當成
 * 「儀表板壞了」，然後有人開始重開機。
 */
export function robotAcceptsName(name: string): boolean {
  if (!name || name.length > 64) return false;
  if (name.includes("/") || name.includes("\\") || name.includes("..")) return false;
  return name.startsWith("rec-") && name.endsWith(".jsonl");
}

export function fmtSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

export function fmtTime(ms: number): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString("zh-TW", { hour12: false });
}
