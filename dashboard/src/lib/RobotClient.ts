// 機器人連線：FTC SDK 的 namespace WebSocket（8081）+ /dash/* HTTP（8080）。
//
// 協定形狀（DashWs.java / DashHub.java，已用 fake-hub 對過）：
//   握手  {"namespace":"system","type":"subscribeToNamespace","payload":"dash"}
//   下行  {"namespace":"dash","type":"hello|nt|err|notify","payload":"<JSON 字串>"}
//   上行  {"namespace":"dash","type":"set","payload":"{\"k\":...,\"v\":...}"}
// payload 永遠是**字串**，所以要 JSON.parse 兩次。這一點做錯的症狀是
// 「連上了但收不到資料」，也是規格附錄 A 列的第 2 個未證實項。
//
// 規則防線（§8 M01/M09，最高 RED CARD）：
//   1. set() 全域硬閘：mode !== PIT / 未連線 / 不在白名單 一律拒絕**並回饋**
//   2. sendPath() 已整支刪除——那是 VMX 專用的下行指令，留著就是一條控制路徑
//   3. 樂觀更新只准套 /FGC/Tune/*，絕不可套 /FGC/Param/*（否則對帳變自欺）
//   4. /dash/rec.jsonl?name=live 一律不呼叫（那條路徑會回整場遙測）

import { store, NtValue } from "./store";
import { FGC, PATHS, httpUrl, wsUrl } from "../fgc/lib/profile";
import { K, MODE_PIT, isTunableKey, bareName, paramKey } from "../fgc/lib/fgcKeys";
import { liveLog, LogStore } from "../fgc/lib/LogStore";
import { cursor } from "../fgc/lib/cursorStore";
import { fetchHealth, type HealthState } from "../fgc/lib/health";
import { loadIntoLog } from "../fgc/lib/jsonl";

const MAX_RECORD_BATCHES = 30_000; // 50 ms 一批 ≈ 25 分鐘，超過丟最舊的

export type LinkState =
  | "offline"
  | "connecting"
  /** 已連上 ws，送出 subscribeToNamespace，等 hello。 */
  | "handshaking"
  | "live"
  /** 握手三次失敗，退到 /dash/state.json 輪詢。 */
  | "polling"
  /** 規則性靜默：MATCH 不推播、state.json 503。不是壞了。 */
  | "lockdown"
  | "replay";

export interface LinkInfo {
  state: LinkState;
  host: string;
  /** 第幾次重連（決定退避階梯）。 */
  attempt: number;
  /** 下一次重連的時刻（Date.now()）；0 = 沒有排程。 */
  nextRetryAt: number;
  /** 握手重送次數。 */
  handshakeTries: number;
  lastError: string;
  /** 最後一則 hello 的本機時刻。 */
  helloAt: number;
  health: HealthState | null;
  healthAt: number;
}

export interface SetResult {
  ok: boolean;
  why: string;
}

/** 寫回帳本的一筆（SetLedger）。 */
export interface SetRecord {
  at: number;
  key: string;
  name: string;
  from: NtValue | null;
  to: NtValue;
  ok: boolean;
  why: string;
  /** 回讀延遲毫秒；null = 還沒回讀 / 被拒。 */
  echoMs: number | null;
}

export interface NotifyMsg {
  level: string;
  title: string;
  desc: string;
  ttl: number;
  at: number;
}

interface RecordedBatch {
  t: number;
  d: Record<string, NtValue>;
}

interface Pending {
  key: string;
  name: string;
  from: NtValue | null;
  to: NtValue;
  sentAt: number;
}

class RobotClient {
  private ws: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private handshakeTimer: number | null = null;
  private healthTimer: number | null = null;
  private pollTimer: number | null = null;
  private wantHost: string | null = null;

  // 記錄 / 回放
  private recording: RecordedBatch[] = [];
  /** 載入的回放檔；不為 null 時整個 App 走 REPLAY 路由，物理上不建立 ws。 */
  replayLog: LogStore | null = null;
  replayName = "";

  // 寫回對帳
  private pending = new Map<string, Pending>();
  private throttlePending = new Map<string, NtValue>();
  private throttleTimer: number | null = null;

  link: LinkInfo = {
    state: "offline",
    host: "",
    attempt: 0,
    nextRetryAt: 0,
    handshakeTries: 0,
    lastError: "",
    helloAt: 0,
    health: null,
    healthAt: 0,
  };

  private linkVersion = 0;
  private linkListeners = new Set<() => void>();
  private setListeners = new Set<(r: SetRecord) => void>();
  private notifyListeners = new Set<(n: NotifyMsg) => void>();

  // ── 連線 ───────────────────────────────────────────────────────────

  connect(host: string) {
    this.disconnect();
    this.wantHost = host;
    this.link.host = host;
    this.link.attempt = 0;
    this.startHealthPoll();
    this.open();
  }

  private open() {
    if (!this.wantHost) return;
    store.setConnState("connecting");
    this.patchLink({ state: "connecting", nextRetryAt: 0, handshakeTries: 0 });

    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl(this.wantHost));
    } catch (e) {
      this.patchLink({ lastError: String(e) });
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.startRecording();
      this.patchLink({ state: "handshaking", handshakeTries: 0, lastError: "" });
      this.sendHandshake();
    };

    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      if (typeof ev.data !== "string") return; // FGC 沒有二進位通道
      this.onEnvelope(ev.data);
    };

    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.clearHandshakeTimer();
      // 斷線 = 模式未知 = 鎖住。這一行寫錯，其他全部是裝飾。
      store.setMode("UNKNOWN");
      if (this.wantHost) {
        store.setConnState("connecting");
        this.scheduleReconnect();
      } else {
        store.setConnState("disconnected");
        this.patchLink({ state: "offline" });
      }
    };

    ws.onerror = () => {
      this.patchLink({ lastError: "WebSocket 錯誤" });
      try {
        ws.close();
      } catch {
        /* 已經關了 */
      }
    };
  }

  /**
   * SDK 握手。2 秒沒收到 hello 就重送，三次失敗改走 /dash/state.json 輪詢。
   * 「連上了但收不到資料」最常見的原因就是這一步沒成功，所以它有自己的狀態與燈。
   */
  private sendHandshake() {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ namespace: "system", type: "subscribeToNamespace", payload: FGC.namespace }));
    this.clearHandshakeTimer();
    this.handshakeTimer = window.setTimeout(() => {
      if (this.link.state !== "handshaking") return;
      const tries = this.link.handshakeTries + 1;
      this.patchLink({ handshakeTries: tries });
      if (tries < FGC.handshakeTries) {
        this.sendHandshake();
      } else {
        this.patchLink({ lastError: `subscribeToNamespace 三次無 hello（namespace=${FGC.namespace}）` });
        this.startPolling();
      }
    }, FGC.handshakeMs);
  }

  private clearHandshakeTimer() {
    if (this.handshakeTimer !== null) {
      window.clearTimeout(this.handshakeTimer);
      this.handshakeTimer = null;
    }
  }

  private scheduleReconnect() {
    if (!this.wantHost) return;
    if (this.reconnectTimer !== null) return;
    const attempt = this.link.attempt + 1;
    // 規則性靜默不該製造重連風暴：任何人瞄一眼螢幕都不該覺得這台筆電正在試著連機器人
    const lockdown = this.link.state === "lockdown" || store.mode === "MATCH";
    const delay = lockdown
      ? FGC.lockdownBackoffMs
      : FGC.backoffMs[Math.min(attempt - 1, FGC.backoffMs.length - 1)];
    this.patchLink({ attempt, nextRetryAt: Date.now() + delay });
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
  }

  // ── 下行訊息（兩層解包）─────────────────────────────────────────────

  private onEnvelope(raw: string) {
    let env: { namespace?: unknown; type?: unknown; payload?: unknown };
    try {
      env = JSON.parse(raw);
    } catch (e) {
      this.patchLink({ lastError: `外層封包不是 JSON：${String(e).slice(0, 80)}` });
      return;
    }
    if (env.namespace !== FGC.namespace) return; // system 的回應不關我們的事
    const type = typeof env.type === "string" ? env.type : "";
    // type 白名單：對端不得靠一則訊息直接改前端 store（FTC socketMiddleware 的教訓）
    if (type !== "hello" && type !== "nt" && type !== "err" && type !== "notify") return;

    let payload: unknown = env.payload;
    if (typeof payload === "string") {
      if (payload.length === 0) return;
      try {
        payload = JSON.parse(payload);
      } catch (e) {
        this.patchLink({ lastError: `${type} payload 不是 JSON：${String(e).slice(0, 80)}` });
        return;
      }
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return;

    if (type === "hello" || type === "nt") {
      if (type === "hello") this.patchLink({ state: "live", helloAt: Date.now(), lastError: "" });
      else if (this.link.state === "handshaking") this.patchLink({ state: "live" });
      this.clearHandshakeTimer();
      this.stopPolling();
      store.setConnState("connected");
      this.applyBatch(payload as Record<string, NtValue>);
    } else if (type === "err") {
      this.onErr(payload as { k?: unknown; why?: unknown });
    } else {
      this.onNotify(payload as Record<string, unknown>);
    }
  }

  /** 一批遙測：餵 LogStore（時間序列）、store（最新值鏡射）、錄影，並更新模式。 */
  private applyBatch(d: Record<string, NtValue>) {
    const t = liveLog.applyBatch(d);
    cursor.followTail(t);
    this.record(t, d);
    store.applyBatch(d);

    // 模式真相只有這一個來源。前端沒有任何切換它的 UI。
    const m = d[K.mode];
    if (typeof m === "string") {
      const next = m === MODE_PIT ? "PIT" : "MATCH";
      store.setMode(next);
      if (next === "MATCH" && this.link.state !== "lockdown") this.patchLink({ state: "lockdown" });
      else if (next === "PIT" && this.link.state === "lockdown") this.patchLink({ state: "live" });
    }

    // 回讀對帳：/FGC/Param/<NAME> 出現就結掉對應的 pending
    if (this.pending.size > 0) {
      for (const key in d) {
        if (!key.startsWith("/FGC/Param/")) continue;
        const p = this.pending.get(bareName(key));
        if (!p) continue;
        this.pending.delete(p.name);
        this.emitSet({
          at: Date.now(),
          key: p.key,
          name: p.name,
          from: p.from,
          to: d[key],
          ok: true,
          why: "",
          echoMs: Date.now() - p.sentAt,
        });
      }
    }
  }

  /**
   * err 一定要處理：payload 是 {k, why}（DashHub.errJson）。
   * 現況協定不合時靜默無資料，極難 debug——被擋下要有回饋，不是靜默丟棄。
   */
  private onErr(payload: { k?: unknown; why?: unknown }) {
    const k = typeof payload.k === "string" ? payload.k : "";
    const why = typeof payload.why === "string" ? payload.why : "unknown";
    const name = bareName(k);
    const p = this.pending.get(name);
    if (p) this.pending.delete(name);
    this.emitSet({
      at: Date.now(),
      key: k || (p ? p.key : ""),
      name,
      from: p ? p.from : null,
      to: p ? p.to : "",
      ok: false,
      why,
      echoMs: null,
    });
  }

  private onNotify(payload: Record<string, unknown>) {
    const n: NotifyMsg = {
      level: String(payload.level ?? "INFO"),
      title: String(payload.title ?? ""),
      desc: String(payload.desc ?? ""),
      ttl: typeof payload.ttl === "number" ? payload.ttl : 0,
      at: Date.now(),
    };
    this.notifyListeners.forEach((fn) => fn(n));
  }

  // ── 寫回 ───────────────────────────────────────────────────────────

  /**
   * 調參寫回。三行硬閘 + 白名單 + 只對 /FGC/Tune/* 樂觀更新。
   * 回傳被拒的原因給呼叫端顯示——絕不靜默丟棄。
   */
  set(key: string, value: NtValue): SetResult {
    if (this.replayLog) return this.reject(key, value, "回放模式：物理上不可寫回");
    if (store.mode !== "PIT") return this.reject(key, value, "MATCH／未知模式：寫回已鎖定");
    if (store.connState !== "connected") return this.reject(key, value, "未連線：指令未送出");
    if (!isTunableKey(key)) return this.reject(key, value, "不在白名單：只有 /FGC/Tune/ 的 21 項可寫");

    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return this.reject(key, value, "連線未就緒：指令未送出");
    }

    const name = bareName(key);
    const from = liveLog.latest.get(paramKey(name)) ?? null;
    ws.send(
      JSON.stringify({
        namespace: FGC.namespace,
        type: "set",
        payload: JSON.stringify({ k: key, v: value }),
      }),
    );
    this.pending.set(name, { key, name, from, to: value, sentAt: Date.now() });

    // 樂觀更新只寫左欄。/FGC/Param/* 是機器人的回讀，套上去對帳就變自欺。
    // forcedT 是為了不讓這一筆本機時戳把整份 log 的 tSource 汙染成 client。
    const patch: Record<string, NtValue> = { [key]: value };
    liveLog.applyBatch(patch, liveLog.tMax);
    store.applyBatch(patch);
    return { ok: true, why: "" };
  }

  /** 滑桿拖動期間 50 ms 節流合併（pending Map 去重 + 尾端補送）。 */
  setThrottled(key: string, value: NtValue) {
    this.throttlePending.set(key, value);
    if (this.throttleTimer !== null) return;
    this.throttleTimer = window.setTimeout(() => {
      this.throttleTimer = null;
      const batch = Array.from(this.throttlePending.entries());
      this.throttlePending.clear();
      for (const [k, v] of batch) this.set(k, v);
    }, FGC.setThrottleMs);
  }

  private reject(key: string, value: NtValue, why: string): SetResult {
    this.emitSet({
      at: Date.now(),
      key,
      name: bareName(key),
      from: null,
      to: value,
      ok: false,
      why,
      echoMs: null,
    });
    return { ok: false, why };
  }

  private emitSet(r: SetRecord) {
    this.setListeners.forEach((fn) => fn(r));
  }

  /** 送出後還沒回讀的 key（TuneTable 的橘框 / 旋轉點）。 */
  pendingSince(name: string): number | null {
    const p = this.pending.get(name);
    return p ? Date.now() - p.sentAt : null;
  }

  // ── /dash/health 輪詢（8080 燈）────────────────────────────────────

  private startHealthPoll() {
    this.stopHealthPoll();
    const run = async () => {
      if (!this.wantHost) return;
      const st = await fetchHealth(httpUrl(this.wantHost, PATHS.health));
      this.patchLink({ health: st, healthAt: Date.now() });
      // health 的 mode 只用來「降級成鎖住」，永遠不用來授予 PIT：
      // 授權一律走 ws 的 /FGC/Bridge/Mode，多一條授權來源就多一個出錯的地方。
      if (st.kind === "ok" && st.info.mode === "MATCH" && store.mode !== "MATCH") {
        store.setMode("MATCH");
      }
    };
    void run();
    this.healthTimer = window.setInterval(() => void run(), FGC.healthMs);
  }

  private stopHealthPoll() {
    if (this.healthTimer !== null) {
      window.clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
  }

  // ── /dash/state.json 輪詢（握手失敗時的備援）──────────────────────

  private startPolling() {
    if (this.pollTimer !== null) return;
    this.patchLink({ state: "polling" });
    const run = async () => {
      if (!this.wantHost) return;
      try {
        const res = await fetch(httpUrl(this.wantHost, PATHS.state), { cache: "no-store" });
        if (res.status === 503) {
          // 規則性靜默：MATCH 期間 state.json 一律 503。灰徽章，不是紅色錯誤。
          store.setMode("MATCH");
          this.patchLink({ state: "lockdown", lastError: "" });
          return;
        }
        if (!res.ok) {
          this.patchLink({ lastError: `state.json HTTP ${res.status}` });
          return;
        }
        const d = (await res.json()) as Record<string, NtValue>;
        store.setConnState("connected");
        this.applyBatch(d);
      } catch (e) {
        this.patchLink({ lastError: String(e).slice(0, 120) });
      }
    };
    void run();
    this.pollTimer = window.setInterval(() => void run(), FGC.pollMs);
  }

  private stopPolling() {
    if (this.pollTimer !== null) {
      window.clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  // ── 錄影 ───────────────────────────────────────────────────────────

  private startRecording() {
    this.recording = [];
  }

  /** t 用機器人時戳（LogStore 已經決定好了），不再用本機時鐘量化一次。 */
  private record(t: number, d: Record<string, NtValue>) {
    this.recording.push({ t, d });
    if (this.recording.length > MAX_RECORD_BATCHES) {
      this.recording.splice(0, this.recording.length - MAX_RECORD_BATCHES);
    }
  }

  get recordedBatches() {
    return this.recording.length;
  }

  /** 匯出 JSONL（格式與機器人端 DashRec.addLine 一致）。 */
  exportRecording(): boolean {
    if (!this.recording.length) return false;
    const text = this.recording.map((b) => JSON.stringify(b)).join("\n") + "\n";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "application/x-ndjson" }));
    const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
    a.download = `fgc-rec-${stamp}.jsonl`;
    a.click();
    URL.revokeObjectURL(a.href);
    return true;
  }

  // ── 回放 ───────────────────────────────────────────────────────────

  /**
   * 全載入進一個獨立的 LogStore 實例，由 cursorT 驅動。
   * 不是「用 setInterval 直線播到底、播畢自動 disconnect」——那會被 120 s 的
   * 歷史上限截斷（比賽是 150 s），而且會把檔案裡的機器人時戳丟掉重量化一次。
   */
  async startReplay(source: string | ReadableStream<Uint8Array>, name = "replay"): Promise<boolean> {
    this.disconnect();
    const log = new LogStore(name);
    const res = await loadIntoLog(log, source);
    if (res.batches === 0) return false;
    this.replayLog = log;
    this.replayName = name;
    store.setConnState("replay");
    store.setMode("UNKNOWN");
    cursor.setLiveLock(false);
    cursor.reset(log.tMin);
    this.patchLink({ state: "replay", lastError: "" });
    return true;
  }

  exitReplay() {
    this.replayLog = null;
    this.replayName = "";
    cursor.setLiveLock(true);
    store.setConnState("disconnected");
    this.patchLink({ state: "offline" });
  }

  // ── 訂閱 ───────────────────────────────────────────────────────────

  getLinkVersion = (): number => this.linkVersion;

  subscribeLink = (fn: () => void): (() => void) => {
    this.linkListeners.add(fn);
    return () => {
      this.linkListeners.delete(fn);
    };
  };

  onSetResult(fn: (r: SetRecord) => void): () => void {
    this.setListeners.add(fn);
    return () => {
      this.setListeners.delete(fn);
    };
  }

  onNotifyMsg(fn: (n: NotifyMsg) => void): () => void {
    this.notifyListeners.add(fn);
    return () => {
      this.notifyListeners.delete(fn);
    };
  }

  private patchLink(patch: Partial<LinkInfo>) {
    this.link = { ...this.link, ...patch };
    this.linkVersion++;
    this.linkListeners.forEach((fn) => fn());
  }

  // ── 關閉 ───────────────────────────────────────────────────────────

  disconnect() {
    this.wantHost = null;
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.clearHandshakeTimer();
    this.stopPolling();
    this.stopHealthPoll();
    if (this.throttleTimer !== null) {
      window.clearTimeout(this.throttleTimer);
      this.throttleTimer = null;
    }
    this.throttlePending.clear();
    this.pending.clear();
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      ws.onclose = null;
      try {
        ws.close();
      } catch {
        /* 已經關了 */
      }
    }
    store.setConnState("disconnected");
    store.setMode("UNKNOWN");
    this.patchLink({ state: "offline", nextRetryAt: 0, handshakeTries: 0 });
  }
}

export const client = new RobotClient();
