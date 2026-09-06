// FGC 2026 profile：埠、協定常數、時間門檻、URL 參數。
//
// 只有這個檔案知道「8080 / 8081」這兩個數字與 /dash/* 那八條寫死的路徑
// （DashHub.java:72-78）。RobotClient 與所有頁面一律從這裡拿，不得自己拼字串。
//
// 埠可被覆寫（§7.7 / README「經 Driver Hub 中繼」）：Driver Hub 的 adb reverse 中繼
// 會把 Control Hub 的 8080/8081 映到手機本機的 18080/18081，這時 host 是 127.0.0.1
// 而埠不是原廠值。覆寫來源的優先序是 URL 參數 > localStorage > FGC 預設，
// 讓「用一條網址就能把隊友導到正確的位址」這件事成立。

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

/** Driver Hub 經 adb reverse 中繼時的慣用埠（見 README §連真機）。 */
export const RELAY_PORTS = { http: 18080, ws: 18081 } as const;

// ── 埠覆寫 ────────────────────────────────────────────────────────────
// 存成模組層級變數而不是 React state：RobotClient 不是 React，
// 而「現在到底連的是哪個埠」必須只有一份真相。

const PORT_KEYS = { http: "fgc.httpPort", ws: "fgc.wsPort" } as const;

let httpPortOverride: number | null = null;
let wsPortOverride: number | null = null;

function readPort(raw: string | null): number | null {
  if (raw == null) return null;
  const n = Number(String(raw).replace(/^"|"$/g, ""));
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : null;
}

export function httpPort(): number {
  return httpPortOverride ?? FGC.httpPort;
}

export function wsPort(): number {
  return wsPortOverride ?? FGC.wsPort;
}

/** 兩個埠是否已被改離原廠值（UI 要據此警示，不然「連不上」會查錯方向）。 */
export function portsOverridden(): boolean {
  return httpPort() !== FGC.httpPort || wsPort() !== FGC.wsPort;
}

/** 設定埠。傳 null 代表回到原廠值。呼叫端負責重連。 */
export function setPorts(http: number | null, ws: number | null, remember = true): void {
  httpPortOverride = http && http > 0 && http < 65536 ? Math.trunc(http) : null;
  wsPortOverride = ws && ws > 0 && ws < 65536 ? Math.trunc(ws) : null;
  if (!remember) return;
  try {
    if (httpPortOverride === null) localStorage.removeItem(PORT_KEYS.http);
    else localStorage.setItem(PORT_KEYS.http, String(httpPortOverride));
    if (wsPortOverride === null) localStorage.removeItem(PORT_KEYS.ws);
    else localStorage.setItem(PORT_KEYS.ws, String(wsPortOverride));
  } catch {
    /* 無痕模式 / 磁碟滿：埠仍在這一次 session 內生效 */
  }
}

/** 開機呼叫一次：URL 參數 > localStorage > FGC 預設。 */
export function initPorts(p?: UrlParams): void {
  let http: number | null = null;
  let ws: number | null = null;
  try {
    http = readPort(localStorage.getItem(PORT_KEYS.http));
    ws = readPort(localStorage.getItem(PORT_KEYS.ws));
  } catch {
    /* 讀不到就當沒設過 */
  }
  if (p?.relay) {
    http = RELAY_PORTS.http;
    ws = RELAY_PORTS.ws;
  }
  if (p?.httpPort != null) http = p.httpPort;
  if (p?.wsPort != null) ws = p.wsPort;
  // URL 帶來的埠不寫進 localStorage：一條臨時的分享連結不該改掉這台筆電的設定
  const fromUrl = p?.relay || p?.httpPort != null || p?.wsPort != null;
  setPorts(http, ws, !fromUrl);
}

export function wsUrl(host: string): string {
  return `ws://${host}:${wsPort()}`;
}

export function httpBase(host: string): string {
  return `http://${host}:${httpPort()}`;
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
  /** ?httpPort= / ?wsPort=：Driver Hub 中繼或改過埠的 Hub。 */
  httpPort: number | null;
  wsPort: number | null;
  /** ?relay=1：等同 httpPort=18080&wsPort=18081（打字比較短，賽場上會用到）。 */
  relay: boolean;
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
    httpPort: readPort(p.get("httpPort")),
    wsPort: readPort(p.get("wsPort")),
    relay: p.get("relay") === "1" || p.get("relay") === "true",
  };
}
