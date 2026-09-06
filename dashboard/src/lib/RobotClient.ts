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
//   1. set() 與 command() 共用同一組全域硬閘：mode !== PIT / 未連線 / 不在白名單
//      一律拒絕**並回饋**。前端通往 /dash/set 的出口只有這兩支，各自的第一行都是
//      同一個 gate()——「我方只有一條寫回路徑」這句話要在程式碼層面成立。
//   2. sendPath() 已整支刪除——那是 VMX 專用的下行指令，留著就是一條控制路徑
//   3. 樂觀更新只准套 /FGC/Tune/*，絕不可套 /FGC/Param/*（否則對帳變自欺）
//   4. /dash/rec.jsonl?name=live 一律不呼叫（收口在 profile.recFileUrl，違規就 throw）
//
// 模式（§8 M01 (a)，「這一行寫錯，其他全部是裝飾」）：
//   · 授權：**只有 ws 的 hello / nt** 裡的 /FGC/Bridge/Mode 能把前端切成 PIT。
//     /dash/state.json 的輪詢與 /dash/health 都只准降級，不准授予。
//   · 保鮮期：模式不是鎖存，是有期限的事實。真機 PIT→MATCH 在已開的 socket 上是
//     **靜默的**（DashPublisher.java:46 的廣播被 pit() 擋掉，而剛變成 MATCH 的那筆
//     已被同一圈的 drainDirty() 取走餵給 DashRec，下一圈值沒變就再也不進 dirty），
//     所以「ws 開著但不推播」正是 MATCH 的常態。推播靜默超過 modeStaleMs 就主動送
//     ws `sync`（DashWs.java:56 支援；MATCH 的 hello 白名單一定帶 Mode），
//     再過 modeGraceMs 還是沒有任何下行就降成 UNKNOWN——未知即鎖。
//   · matchLatch：/dash/health 說 MATCH 之後，ws 說 PIT 也不算數。兩條通道都同意
//     才授權，任一條說封鎖就封鎖（Thr != 1 的殭屍推播執行緒正是這個症狀）。

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
  private modeTimer: number | null = null;
  private pollAbort: AbortController | null = null;
  private wantHost: string | null = null;
  /** health 輪詢的對象。與 wantHost 分開：?mode=replay 不建 ws 但頂欄仍要有 8080 燈。 */
  private healthHost: string | null = null;
  private lastSyncAt = 0;

  /**
   * MATCH 閂。/dash/health 回 mode=MATCH 就閂上，回 mode=PIT 才解開。
   * 閂上期間 ws 的 Mode="PIT" 不授權——那是「8080 說 MATCH、8081 說 PIT」的分腦，
   * 症狀就是 Thr != 1 的殭屍推播執行緒推著上一場的遙測。
   */
  private matchLatch = false;

  // 記錄 / 回放（環狀緩衝：滿了之後 splice(0,1) 是每批 30,000 個指標的搬移）
  private recording: (RecordedBatch | undefined)[] = [];
  private recHead = 0;
  private recCount = 0;
  /** 載入的回放檔；不為 null 時整個 App 走 REPLAY 路由，物理上不建立 ws。 */
  replayLog: LogStore | null = null;
  replayName = "";
  /** 換過幾次回放（路由靠它訂閱，不再依賴 patchLink 剛好排在後面的副作用）。 */
  private replayVersion = 0;
  private replayListeners = new Set<() => void>();

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
    this.healthHost = host;
    this.link.host = host;
    this.link.attempt = 0;
    this.startHealthPoll();
    this.startModeWatch();
    this.open();
  }

  /**
   * 只輪詢 /dash/health，不建立 ws。?mode=replay 用：回放物理上不可寫，但頂欄
   * 還是該講得出「這台筆電到底有沒有在跟機器人講話」（8080 燈 / 錄影行數 / Thr），
   * 而且 health 的 mode=MATCH 會把整頁降級成 Lockdown——網址參數蓋不過模式。
   */
  watchHealthOnly(host: string) {
    this.disconnect();
    this.healthHost = host;
    this.link.host = host;
    this.startHealthPoll();
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
      store.setRobotMode("UNKNOWN");
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
      // ws 是唯一的授權通道（grantPit = true）
      this.applyBatch(payload as Record<string, NtValue>, true);
    } else if (type === "err") {
      this.onErr(payload as { k?: unknown; why?: unknown });
    } else {
      this.onNotify(payload as Record<string, unknown>);
    }
  }

  /**
   * 一批遙測：餵 LogStore（時間序列）、store（最新值鏡射）、錄影，並更新模式。
   *
   * @param grantPit 這條通道有沒有資格把前端切成 PIT。只有 ws 的 hello / nt 有
   *   （見檔頭）。/dash/state.json 的輪詢傳 false：它會回全量內容因此含
   *   /FGC/Bridge/Mode，但「多一條授權來源就多一個出錯的地方」。false 時這一批
   *   只能把模式往鎖住的方向推，不能往開放的方向推。
   */
  private applyBatch(d: Record<string, NtValue>, grantPit: boolean) {
    const t = liveLog.applyBatch(d);
    cursor.followTail(t);
    this.record(t, d);
    store.applyBatch(d);

    // 模式真相只有這一個來源。前端沒有任何切換它的 UI。
    const m = d[K.mode];
    if (typeof m === "string") {
      const next = m === MODE_PIT ? "PIT" : "MATCH";
      if (next === "MATCH") {
        store.setRobotMode("MATCH");
        if (this.link.state !== "lockdown") this.patchLink({ state: "lockdown" });
      } else if (!grantPit) {
        // 降級專用通道說 PIT：不理會（它沒有授權資格），但也不因此降級。
      } else if (this.matchLatch) {
        // 8080 說 MATCH、8081 說 PIT：授權要兩條通道都同意。
        this.patchLink({
          lastError: "ws 說 PIT 但 /dash/health 說 MATCH —— 殭屍推播執行緒（Thr != 1）？以 MATCH 為準",
        });
      } else {
        store.setRobotMode("PIT");
        if (this.link.state === "lockdown") this.patchLink({ state: "live" });
      }
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
    const blocked = this.gate();
    if (blocked) return this.reject(key, value, blocked);
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
    store.applyBatch(patch, false);
    return { ok: true, why: "" };
  }

  /**
   * 全域硬閘。set() 與 command() 的第一行都是它——通往機器人的每一條出口共用
   * 同一組條件，才有資格對檢錄志工說「我方只有一條寫回路徑」。
   * 回傳被拒的原因（字串）或 null（放行）。
   */
  private gate(): string | null {
    if (this.replayLog) return "回放模式：物理上不可寫回";
    if (store.mode !== "PIT") return "MATCH／未知模式：寫回已鎖定";
    if (store.connState !== "connected") return "未連線：指令未送出";
    return null;
  }

  /**
   * _save / _load 這兩個指令（DashHttp.java:142 的 /dash/set?k=_save|_load）。
   *
   * 它們以前是元件自己 fetch 的第二條寫回路徑，繞過整組硬閘也不進寫回帳本。
   * 存回 fgc-tune.json / 從檔案讀回，影響比調一個滑桿更大：成功與失敗都必須留下
   * 一筆帳——「我送出去的東西後來怎麼了」正是帳本存在的理由。
   */
  async command(k: "_save" | "_load"): Promise<SetResult> {
    const label = k === "_save" ? "存到機器人" : "從機器人讀回";
    const blocked = this.gate();
    if (blocked) return this.reject(k, label, blocked);
    const host = this.link.host;
    if (!host) return this.reject(k, label, "沒有 host：指令未送出");

    const sentAt = Date.now();
    try {
      const res = await fetch(httpUrl(host, PATHS.set, { k }), { cache: "no-store" });
      const txt = await res.text();
      let ok = res.ok;
      let why = "";
      try {
        const j = JSON.parse(txt) as { ok?: boolean; why?: string };
        if (typeof j.ok === "boolean") ok = j.ok;
        why = typeof j.why === "string" ? j.why : "";
      } catch {
        why = res.ok ? "" : `HTTP ${res.status}`;
      }
      this.emitSet({
        at: Date.now(),
        key: k,
        name: label,
        from: null,
        to: label,
        ok,
        why: ok ? why : why || `HTTP ${res.status}`,
        echoMs: Date.now() - sentAt,
      });
      return { ok, why };
    } catch (e) {
      const why = String(e).slice(0, 120);
      this.emitSet({ at: Date.now(), key: k, name: label, from: null, to: label, ok: false, why, echoMs: null });
      return { ok: false, why };
    }
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

  /**
   * 自適應計時器而不是固定 interval：lockdown（規則性靜默）時放寬到 15 秒。
   * 那是這個狀態下唯一還在打的端點，3 秒一次只是無謂的 Wi-Fi 流量。
   */
  private healthMs = FGC.healthMs;

  private startHealthPoll() {
    this.stopHealthPoll();
    void this.healthTick();
  }

  private async healthTick() {
    const host = this.healthHost;
    if (!host) return;
    const st = await fetchHealth(httpUrl(host, PATHS.health));
    // await 期間換了 host / 進了回放：這份結果已經過期，不准動 store
    if (this.healthHost !== host) return;
    this.patchLink({ health: st, healthAt: Date.now() });

    // health 的 mode 只用來「降級成鎖住」，永遠不用來授予 PIT：
    // 授權一律走 ws 的 /FGC/Bridge/Mode，多一條授權來源就多一個出錯的地方。
    // 而且降級是**黏著的**（matchLatch）：不黏著的話任何一則後續帶 Mode:"PIT"
    // 的 ws 批次都會把它蓋回去，效果只剩「延後一輪再鎖一次」。
    if (st.kind === "ok" && st.info.mode === "MATCH") {
      this.matchLatch = true;
      store.setRobotMode("MATCH");
      if (this.link.state !== "lockdown") this.patchLink({ state: "lockdown" });
    } else if (st.kind === "ok" && st.info.mode === MODE_PIT) {
      this.matchLatch = false;
    }

    if (this.healthHost === null) return;
    const lock = this.link.state === "lockdown" || store.mode === "MATCH";
    this.healthMs = lock ? FGC.lockdownHealthMs : FGC.healthMs;
    this.healthTimer = window.setTimeout(() => void this.healthTick(), this.healthMs);
  }

  private stopHealthPoll() {
    if (this.healthTimer !== null) {
      window.clearTimeout(this.healthTimer);
      this.healthTimer = null;
    }
  }

  // ── 模式看門狗（保鮮期）──────────────────────────────────────────────

  /**
   * 「推播停了」在 MATCH 下就是常態，所以它不能只被當成「連線還在」。
   * 靜默超過 modeStaleMs 就主動送一次 sync（DashWs.java:56 支援；PIT 回全量快照、
   * MATCH 回 /FGC/Bridge/* 白名單，兩者都一定帶 /FGC/Bridge/Mode），
   * 再過 modeGraceMs 仍沒有任何下行就把模式降成 UNKNOWN——未知即鎖。
   */
  private startModeWatch() {
    this.stopModeWatch();
    this.modeTimer = window.setInterval(() => this.modeWatch(), FGC.modeWatchMs);
  }

  private stopModeWatch() {
    if (this.modeTimer !== null) {
      window.clearInterval(this.modeTimer);
      this.modeTimer = null;
    }
  }

  private modeWatch() {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return; // 斷線由 onclose 負責鎖
    const ageMs = store.lastBatchAt >= 0 ? (store.now() - store.lastBatchAt) * 1000 : Infinity;
    if (ageMs <= FGC.modeStaleMs) return;

    const now = Date.now();
    if (now - this.lastSyncAt >= FGC.modeStaleMs) {
      this.lastSyncAt = now;
      try {
        ws.send(JSON.stringify({ namespace: FGC.namespace, type: "sync", payload: "" }));
      } catch {
        /* 送不出去下一輪再試；真的斷了會走 onclose */
      }
    }
    if (ageMs > FGC.modeGraceMs && store.mode !== "UNKNOWN") {
      store.setRobotMode("UNKNOWN");
      this.patchLink({
        lastError: `推播靜默 ${Math.round(ageMs)} ms 且 sync 無回應：模式已過期 → 未知即鎖`,
      });
    }
  }

  // ── /dash/state.json 輪詢（握手失敗時的備援）──────────────────────

  private startPolling() {
    if (this.pollTimer !== null) return;
    this.patchLink({ state: "polling" });
    void this.pollTick();
  }

  private async pollTick() {
    const host = this.wantHost;
    if (!host) return;
    // state.json 沒有逾時的話，賽場 Wi-Fi 掉封包時這個 fetch 會一直掛著。
    const ac = new AbortController();
    this.pollAbort = ac;
    const timer = window.setTimeout(() => ac.abort(), FGC.pollTimeoutMs);
    let delay = FGC.pollMs;
    try {
      const res = await fetch(httpUrl(host, PATHS.state), { cache: "no-store", signal: ac.signal });
      // await 之後一定要再檢查一次：disconnect() 清得掉計時器，清不掉已經飛出去的 fetch。
      // 「輪詢中點一個錄影檔進 REPLAY」的序列會讓一份即時遙測在回放期間被寫進 liveLog。
      if (this.wantHost !== host || this.replayLog !== null) return;
      if (res.status === 503) {
        // 規則性靜默：MATCH 期間 state.json 一律 503。灰徽章，不是紅色錯誤。
        // 退避到 15 秒：一場 150 秒本來會是 300 次請求，那既製造無謂的 Wi-Fi 流量，
        // 也讓任何人瞄一眼螢幕都會覺得這台筆電正在試圖連機器人（§8）。
        store.setRobotMode("MATCH");
        this.matchLatch = true;
        this.patchLink({ state: "lockdown", lastError: "" });
        delay = FGC.lockdownBackoffMs;
      } else if (!res.ok) {
        this.patchLink({ lastError: `state.json HTTP ${res.status}` });
      } else {
        const d = (await res.json()) as Record<string, NtValue>;
        if (this.wantHost !== host || this.replayLog !== null) return;
        store.setConnState("connected");
        // grantPit = false：這條備援通道不是授權來源（見 applyBatch 的說明）。
        this.applyBatch(d, false);
        if (this.link.state === "lockdown") this.patchLink({ state: "polling" });
      }
    } catch (e) {
      if (this.wantHost !== host) return;
      this.patchLink({ lastError: String(e).slice(0, 120) });
    } finally {
      window.clearTimeout(timer);
      if (this.pollAbort === ac) this.pollAbort = null;
    }
    if (this.wantHost !== host || this.replayLog !== null) return;
    this.pollTimer = window.setTimeout(() => void this.pollTick(), delay);
  }

  private stopPolling() {
    if (this.pollTimer !== null) {
      window.clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.pollAbort) {
      this.pollAbort.abort();
      this.pollAbort = null;
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
    store.setRobotMode("UNKNOWN");
    cursor.setLiveLock(false);
    cursor.reset(log.tMin);
    this.bumpReplay();
    this.patchLink({ state: "replay", lastError: "" });
    return true;
  }

  exitReplay() {
    this.replayLog = null;
    this.replayName = "";
    cursor.setLiveLock(true);
    store.setConnState("disconnected");
    this.bumpReplay();
    this.patchLink({ state: "offline" });
  }

  // 路由讀的是 client.replayLog。以前它是個裸欄位，能正確更新只是因為
  // startReplay / exitReplay 尾端剛好都有 patchLink()——路由的正確性依賴
  // 「另一件事的副作用剛好排在後面」。現在它有自己的版本號與訂閱。
  private bumpReplay() {
    this.replayVersion++;
    this.replayListeners.forEach((fn) => fn());
  }

  getReplayVersion = (): number => this.replayVersion;

  subscribeReplay = (fn: () => void): (() => void) => {
    this.replayListeners.add(fn);
    return () => {
      this.replayListeners.delete(fn);
    };
  };

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
    this.healthHost = null;
    this.stopModeWatch();
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
    store.setRobotMode("UNKNOWN");
    this.matchLatch = false;
    this.patchLink({ state: "offline", nextRetryAt: 0, handshakeTries: 0 });
  }
}

export const client = new RobotClient();
