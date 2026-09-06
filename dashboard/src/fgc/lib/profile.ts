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
  /**
   * 模式保鮮期：推播靜默超過這麼久就主動送一次 ws `sync`（DashWs.java:56）。
   * 真機 PIT→MATCH 在**已開的 socket 上是靜默的**：DashPublisher.java:46 的廣播被
   * `pit()` 擋掉，而剛變成 MATCH 的那筆已經被同一圈的 drainDirty() 取走餵給 DashRec，
   * 下一圈 DashHub.put 值沒變直接 return —— 那個 key 再也不會進 dirty。
   * 所以「模式」必須是有保鮮期的事實，不能是鎖存。推播週期 50 ms 的 20 倍。
   */
  readonly modeStaleMs: number;
  /** sync 送出後還是沒有任何下行：模式視為過期 → UNKNOWN（未知即鎖）。 */
  readonly modeGraceMs: number;
  /** 模式看門狗的取樣週期。 */
  readonly modeWatchMs: number;
  /** /dash/health 輪詢週期（8080 燈）。 */
  readonly healthMs: number;
  /** lockdown（規則性靜默）時的 health 輪詢週期：唯一還在打的端點，放寬。 */
  readonly lockdownHealthMs: number;
  /** 退回 /dash/state.json 時的輪詢週期。 */
  readonly pollMs: number;
  /** /dash/state.json 單次請求的逾時（賽場 Wi-Fi 掉封包時不可以無限掛著）。 */
  readonly pollTimeoutMs: number;
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
  modeStaleMs: 1000,
  modeGraceMs: 2500,
  modeWatchMs: 250,
  healthMs: 3000,
  lockdownHealthMs: 15000,
  pollMs: 500,
  pollTimeoutMs: 4000,
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
  stream: "/dash/stream.mjpg",
  snapshot: "/dash/snapshot.jpg",
} as const;

/**
 * 錄影檔下載路徑。**刻意不放在 PATHS 裡**：`?name=live` 會回這一場的即時遙測
 * （§8 M01 措施 6「永不呼叫」），而那條自律如果只寫在呼叫點的 if 裡，第三個呼叫端
 * 不會被任何東西擋。收口成一支函式，違規在這裡就 throw，不必靠人記得複製那個 if。
 */
const REC_FILE_PATH = "/dash/rec.jsonl";

/** 只給「畫在畫面上告訴使用者路徑長什麼樣」用的字串，不可拿去組請求。 */
export const REC_FILE_LABEL = REC_FILE_PATH;

export function recFileUrl(host: string, name: string): string {
  if (name === "live") {
    throw new Error("?name=live 是即時遙測旁路（§8 M01 措施 6），前端永不呼叫");
  }
  return httpUrl(host, REC_FILE_PATH, { name });
}

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
