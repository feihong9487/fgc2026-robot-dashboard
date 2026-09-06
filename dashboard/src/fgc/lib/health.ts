// health：GET /dash/health 的解析。
//
// 這條路徑是整個方案裡最被低估的一個：它在 MATCH 也回 200，內容是
// mode/build/gen/threads/rec/reclines/recpending/lasterror，零比賽資料
// （DashHttp.java:87-108，註解明寫「MATCH 也可以看（不含任何比賽資料）」）。
// 所以「封鎖 vs 死亡」不需要去函 FIRST 也不需要新程式碼——輪詢這裡就分得出來。
//
// 停用（Z-DASH-OFF）時薄殼對所有註冊路徑回 404（DashBridge.java:124），
// 這正是關閉路徑三格的判定依據：可觀測狀態，而不是「我按了某個按鈕」。

export interface HealthInfo {
  build: string;
  gen: number;
  threads: number;
  mode: string;
  enabled: boolean;
  viewers: number;
  camsrc: boolean;
  rec: string;
  recLines: number;
  recPending: number;
  lastError: string;
  keys: number;
  /** 收到這份 health 的本機時刻（Date.now()）。 */
  at: number;
}

export type HealthState =
  | { kind: "ok"; info: HealthInfo }
  /** 404 = Z-DASH-OFF 已生效（橋接已停用）。 */
  | { kind: "disabled"; status: number }
  | { kind: "error"; why: string };

export function parseHealth(text: string): HealthInfo {
  const m = new Map<string, string>();
  for (const line of text.split("\n")) {
    const i = line.indexOf("=");
    if (i <= 0) continue;
    m.set(line.slice(0, i).trim(), line.slice(i + 1).trim());
  }
  const num = (k: string) => {
    const v = Number(m.get(k));
    return Number.isFinite(v) ? v : 0;
  };
  return {
    build: m.get("build") ?? "",
    gen: num("gen"),
    threads: num("threads"),
    mode: m.get("mode") ?? "",
    enabled: (m.get("enabled") ?? "") === "1",
    viewers: num("viewers"),
    camsrc: (m.get("camsrc") ?? "") === "yes",
    rec: m.get("rec") ?? "",
    recLines: num("reclines"),
    recPending: num("recpending"),
    lastError: m.get("lasterror") ?? "",
    keys: num("keys"),
    at: Date.now(),
  };
}

/** 抓一次 health。逾時 2 秒——賽場 Wi-Fi 掉封包時不該讓輪詢自己塞住。 */
export async function fetchHealth(url: string, timeoutMs = 2000): Promise<HealthState> {
  const ac = new AbortController();
  const timer = window.setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ac.signal, cache: "no-store" });
    if (res.status === 404) return { kind: "disabled", status: 404 };
    if (!res.ok) return { kind: "error", why: `HTTP ${res.status}` };
    return { kind: "ok", info: parseHealth(await res.text()) };
  } catch (e) {
    return { kind: "error", why: String(e) };
  } finally {
    window.clearTimeout(timer);
  }
}
