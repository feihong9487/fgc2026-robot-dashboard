// FGC 2026 profile：埠、協定常數、時間門檻、URL 參數。
//
// 只有這個檔案知道「8080 / 8081」這兩個數字與 /dash/* 那八條寫死的路徑
// （DashHub.java:72-78）。RobotClient 與所有頁面一律從這裡拿，不得自己拼字串。

/** 機器人回報的模式；UNKNOWN = 尚未收到 hello / 已斷線 → 一律當鎖住。 */
export type AppMode = "PIT" | "MATCH" | "UNKNOWN";

/** App 實際路由到的頁面群組。UNKNOWN 併進 MATCH（預設鎖住，不是預設開放）。 */
export type RouteMode = "PIT" | "MATCH" | "REPLAY";

export interface Profile {
  readonly id: "fgc";
  readonly label: string;
  /** 遙測 WebSocket（FTC SDK 的 namespace 通道）。 */
  readonly wsPort: number;
  /** /dash/* 這八條 HTTP 路徑。 */
  readonly httpPort: number;
  /** SDK namespace，握手與每一則訊息的信封都用它。 */
  readonly namespace: string;
  /** 送出 subscribeToNamespace 後等 hello 的時間，逾時重送。 */
  readonly handshakeMs: number;
  /** 重送幾次還沒 hello 就改走 /dash/state.json 輪詢。 */
  readonly handshakeTries: number;
  /** 重連退避階梯（毫秒）。 */
  readonly backoffMs: readonly number[];
  /** 判定為 lockdown（規則性靜默）時的退避：不製造重連風暴。 */
  readonly lockdownBackoffMs: number;
  /** 頂欄 ws age 的 stale 門檻；推播週期 PERIOD_MS=50。 */
  readonly staleMs: number;
  /** /dash/health 輪詢週期（8080 燈）。 */
  readonly healthMs: number;
  /** 退回 /dash/state.json 時的輪詢週期。 */
  readonly pollMs: number;
  /** 送出後多久沒回讀就轉橘 / 轉紅（§5.6）。 */
  readonly echoWarnMs: number;
  readonly echoFailMs: number;
  /** 可調參數寫回節流（VisionPanel.tsx:25-38 的 pending Map 去重 + 尾端補送）。 */
  readonly setThrottleMs: number;
}

export const FGC: Profile = {
  id: "fgc",
  label: "FGC 2026",
  wsPort: 8081,
  httpPort: 8080,
  namespace: "dash",
  handshakeMs: 2000,
  handshakeTries: 3,
  backoffMs: [1000, 2000, 5000, 10000],
  lockdownBackoffMs: 15000,
  staleMs: 250,
  healthMs: 3000,
  pollMs: 500,
  echoWarnMs: 300,
  echoFailMs: 1000,
  setThrottleMs: 50,
};

/** /dash/* 八條路徑（DashHub.java:72-78）；沒有 /dash/ping，那是 OpMode 不是端點。 */
export const PATHS = {
  health: "/dash/health",
  state: "/dash/state.json",
  set: "/dash/set",
  recList: "/dash/rec.json",
  recFile: "/dash/rec.jsonl",
  stream: "/dash/stream.mjpg",
  snapshot: "/dash/snapshot.jpg",
} as const;

/** Control Hub 的原廠位址。志工可能在檢錄時改名或改 5 GHz，所以 host 一律可輸入。 */
export const DEFAULT_HOST = "192.168.43.1";

export function wsUrl(host: string): string {
  return `ws://${host}:${FGC.wsPort}`;
}

export function httpBase(host: string): string {
  return `http://${host}:${FGC.httpPort}`;
}

export function httpUrl(host: string, path: string, query?: Record<string, string | number>): string {
  const q = query
    ? "?" +
      Object.entries(query)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join("&")
    : "";
  return `${httpBase(host)}${path}${q}`;
}

// ── URL 參數（無頭截圖與隊友分享連結用）────────────────────────────────

export interface UrlParams {
  host: string | null;
  tab: string | null;
  /** 只認 replay：模式真相只來自 /FGC/Bridge/Mode，網址不得把前端切成 PIT。 */
  replay: boolean;
  /** ?mode=replay&file=<rec.json 裡的檔名> */
  file: string | null;
  theme: string | null;
}

export function readUrlParams(search = window.location.search): UrlParams {
  const p = new URLSearchParams(search);
  const mode = (p.get("mode") ?? "").toLowerCase();
  return {
    host: p.get("host"),
    tab: p.get("tab"),
    replay: mode === "replay",
    file: p.get("file"),
    theme: p.get("theme"),
  };
}
