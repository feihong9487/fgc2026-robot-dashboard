// eventDetect（§3.1 #5）：八類事件 + 通知第九類。純函式，回放全掃與即時增量走同一支。
//
// 為什麼這支存在：一場 2:30 有約 3000 批，用眼睛找「第三次射擊為什麼卡住」要五分鐘，
// 有標記是五秒。而規則全部從 FGC2026_TeleOp_Match.java:169-176 的狀態機推導——
// 它夠簡單，所以偵測器可以是純函式而不是一堆啟發式。
//
// 「全掃」而不是「只掃新的那一段」是刻意的：detect() 一律掃整份 log，t0/t1 只過濾輸出。
// 這樣事件 id 與序號（SHOOT #4）在即時每秒重算時是穩定的——若改成只掃增量，
// 「這是第幾次射擊」就得靠呼叫端維護狀態，而那個狀態一定會在某次重連後對不上。
// 成本實測：15,364 批 / 121 欄位的檔案全掃 < 20 ms（tools/fgc-check-3e.ts 會印出來）。
//
// 三個誠實原則寫在資料裡而不是註解裡：
//   · dip 的恢復時間帶 ±50 ms 解析度（推播週期 PERIOD_MS=50L），寫進 detail
//   · dip 的「跌破門檻」比的是**當時的** /FGC/Param/FEED_THRESHOLD 回讀值，不是寫死 1200
//   · 缺口是事件不是插值：gaps() 找到的洞會變成一顆 ■，波形那邊照樣斷開

import type { LogStore } from "./LogStore";
import { GLYPHS, type Tone } from "./tone";
import { K, paramKey, tuneKey } from "./fgcKeys";

export type EventKind =
  | "shoot" // ① 進入 SHOOT
  | "spinup" // ② spin-up 完成（SpinupMs latch）
  | "dip" // ③ 每球 dip
  | "climb" // ④ 爬升段（Climb/Holding 邊緣）
  | "eject" // ⑤ EJECT
  | "flip" // ⑥ 車頭反轉
  | "batt" // ⑦ 電壓局部谷
  | "fault" // ⑧ 故障
  | "notify"; // ⑨ 機器人主動通知

/**
 * §6.3 形狀語彙：綠●／黃▲／紅■／灰○，四個字元全專案共用（lib/tone.ts）。
 * info 是 stale 在「這只是一則訊息」情境下的別名——事件清單裡的通知沒有好壞。
 */
export type EventLevel = "ok" | "warn" | "err" | "info";

export const LEVEL_GLYPH: Record<EventLevel, string> = { ...GLYPHS, info: GLYPHS.stale };

/** 事件層級 → 全域四態（顏色與燈牆同一套）。 */
export function levelTone(l: EventLevel): Tone {
  return l === "info" ? "stale" : l;
}

export interface LogEvent {
  /** 穩定 id：同一份 log 重算多少次都一樣（即時增量靠這個去重）。 */
  id: string;
  t: number;
  kind: EventKind;
  level: EventLevel;
  /** 一行中文標籤，事件清單與時間軸 tooltip 共用。 */
  label: string;
  /** 次要說明；沒有就是空字串（不是 undefined，省掉呼叫端的判斷）。 */
  detail: string;
  /** 結構化屬性，匯出 Markdown 直接讀。 */
  data?: Readonly<Record<string, number | string | boolean>>;
}

/** ws 的 notify 訊息（DashWs.broadcast("notify", …)）；t 是 log 時間軸上的秒。 */
export interface NotifyEvent {
  t: number;
  level: string;
  title: string;
  desc?: string;
}

export interface DetectOptions {
  /** 輸出過濾（不影響掃描範圍，所以序號永遠穩定）。 */
  t0?: number;
  t1?: number;
  notifies?: readonly NotifyEvent[];
  /** dip 深度門檻（tps）。§3.1：> 150 才算一顆球。 */
  dipDepth?: number;
  /** 電壓局部谷門檻。 */
  battLow?: number;
  /** 電壓 err 門檻（§6.6：< 11.5 是超出）。 */
  battErr?: number;
  /** loop ms 上限（§6.6：> 25 是超出）。 */
  loopMax?: number;
  /** 資料缺口門檻（秒）。 */
  gapSec?: number;
  /** 保險絲：超過就截斷並附一筆「已截斷」事件，不靜默丟。 */
  maxEvents?: number;
}

const DEF = {
  dipDepth: 150,
  battLow: 12.0,
  battErr: 11.5,
  loopMax: 25,
  gapSec: 1.0,
  maxEvents: 4000,
};

/** 推播週期 PERIOD_MS=50L —— 所有以毫秒為單位的量測都只有這個解析度。 */
export const SAMPLE_RES_MS = 50;

export const EVENT_KINDS: readonly EventKind[] = [
  "shoot",
  "spinup",
  "dip",
  "climb",
  "eject",
  "flip",
  "batt",
  "fault",
  "notify",
];

export const KIND_LABEL: Record<EventKind, string> = {
  shoot: "射擊",
  spinup: "達速",
  dip: "球 dip",
  climb: "爬升",
  eject: "退球",
  flip: "車頭",
  batt: "電壓",
  fault: "故障",
  notify: "通知",
};

const BIG = Number.MAX_SAFE_INTEGER;

interface Samples {
  xs: Float64Array;
  ys: Float64Array;
  n: number;
}

/** 整份 log 的原始樣本（絕不 decimate——極值被抽掉的話 dip 就不見了）。 */
function samples(log: LogStore, key: string): Samples {
  const [a, b] = log.tRange;
  const w = log.sampleWindow(key, a, b, BIG);
  return { xs: w.xs, ys: w.ys, n: w.n };
}

interface Seg {
  t0: number;
  t1: number;
  state: string;
  /** 同一個 state 的第幾段（SHOOT #4 的那個 4）。 */
  seq: number;
  /** 第一段是被 log 起點裁掉的，不是真的「進入」。 */
  clipped: boolean;
}

/** 狀態機分段。runs() 已經把同值合併好了，這裡只補序號。 */
function stateSegments(log: LogStore): Seg[] {
  const [a, b] = log.tRange;
  if (!(b > a)) return [];
  const runs = log.runs(K.driveState, a, b, 100000);
  const count = new Map<string, number>();
  return runs.map((r, i) => {
    const state = r.s ?? "";
    const seq = (count.get(state) ?? 0) + 1;
    count.set(state, seq);
    return { t0: r.t0, t1: r.t1, state, seq, clipped: i === 0 };
  });
}

/** 最大的 i 使 xs[i] <= t；沒有就 -1。 */
function seek(xs: Float64Array, n: number, t: number): number {
  let lo = 0;
  let hi = n - 1;
  let res = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= t) {
      res = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return res;
}

function fixed(v: number, d = 0): string {
  return Number.isFinite(v) ? v.toFixed(d) : "—";
}

/**
 * FEED_THRESHOLD 的「當時值」。優先 /FGC/Param/（回讀值），退而求其次 /FGC/Tune/（送出值），
 * 都沒有才用 Constants 編譯預設，並把來源寫進事件——不可寫死 1200 而不說。
 */
function feedThresholdAt(log: LogStore, t: number): { v: number; src: string } {
  const ro = log.valueAt(paramKey("FEED_THRESHOLD"), t);
  if (ro !== null) return { v: ro, src: "/FGC/Param 回讀" };
  const tu = log.valueAt(tuneKey("FEED_THRESHOLD"), t);
  if (tu !== null) return { v: tu, src: "/FGC/Tune 送出值" };
  return { v: 1200, src: "Constants 編譯預設（log 裡沒有這個埋點）" };
}

/** 八類 + 通知第九類。永遠掃整份 log；t0/t1 只過濾輸出。 */
export function detect(log: LogStore, opts: DetectOptions = {}): LogEvent[] {
  const o = { ...DEF, ...opts };
  const out: LogEvent[] = [];
  const [tMin, tMax] = log.tRange;
  if (log.batchCount === 0) return out;

  const push = (
    kind: EventKind,
    t: number,
    level: EventLevel,
    label: string,
    detail = "",
    data?: Record<string, number | string | boolean>,
    tag = "",
  ) => {
    out.push({ id: kind + ":" + t.toFixed(3) + (tag ? ":" + tag : ""), t, kind, level, label, detail, data });
  };

  const segs = stateSegments(log);

  // ── ① 進入 SHOOT ／ ⑤ EJECT ────────────────────────────────────────
  for (const s of segs) {
    if (s.state === "SHOOT") {
      push(
        "shoot",
        s.t0,
        "ok",
        "進入 SHOOT #" + s.seq,
        (s.clipped ? "log 起點就在這個狀態裡，不是真的切換 · " : "") + "持續 " + (s.t1 - s.t0).toFixed(2) + " s",
        { seq: s.seq, dur: s.t1 - s.t0 },
      );
    } else if (s.state === "EJECT") {
      push(
        "eject",
        s.t0,
        "warn",
        "EJECT #" + s.seq,
        (s.clipped ? "log 起點就在這個狀態裡 · " : "") + "持續 " + (s.t1 - s.t0).toFixed(2) + " s",
        { seq: s.seq, dur: s.t1 - s.t0 },
      );
    }
  }

  // ── ② spin-up 完成（SpinupMs latch）────────────────────────────────
  // IDLE_TPS = 0 表示每次 COLLECT 都把飛輪停死，spin-up 就是「按下 R2 到第一顆球出膛」
  // 的死時間，是 500 顆球吞吐量遊戲裡最貴的固定成本。
  const readyAt = new Map<number, number>(); // segIndex -> 達速時刻
  const atSpeedCp = log.has(K.atSpeed) ? log.changePoints(K.atSpeed) : new Float64Array(0);
  const spin = samples(log, K.spinupMs);
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (s.state !== "SHOOT") continue;
    let tReady: number | null = null;
    let ms: number | null = null;

    for (let j = 0; j < atSpeedCp.length; j++) {
      const t = atSpeedCp[j];
      if (t < s.t0) continue;
      if (t > s.t1) break;
      if ((log.valueAt(K.atSpeed, t) ?? 0) > 0.5) {
        tReady = t;
        break;
      }
    }
    if (tReady === null && spin.n > 0) {
      // 沒有 atSpeed 埋點（舊格式）時的退路：SpinupMs 在段內停止增長的那一刻就是 latch
      const a = seek(spin.xs, spin.n, s.t0);
      const b = seek(spin.xs, spin.n, s.t1);
      let best = -1;
      for (let j = Math.max(0, a); j <= b; j++) {
        if (spin.xs[j] < s.t0) continue;
        if (best < 0 || spin.ys[j] > spin.ys[best]) best = j;
      }
      if (best >= 0 && spin.ys[best] > 0) {
        tReady = spin.xs[best];
        ms = spin.ys[best];
      }
    }
    if (tReady === null) continue;
    if (ms === null) ms = log.valueAt(K.spinupMs, tReady);
    readyAt.set(i, tReady);
    push(
      "spinup",
      tReady,
      "ok",
      "spin-up 完成 " + (ms === null ? "—" : fixed(ms, 0)) + " ms",
      "SHOOT #" + s.seq + " · 進 SHOOT 到雙輪達速 · 解析度 ±" + SAMPLE_RES_MS + " ms",
      { seq: s.seq, ms: ms ?? NaN, since: tReady - s.t0 },
    );
  }

  // ── ③ 每球 dip（SHOOT 期間 SL 的局部極小）──────────────────────────
  // 這是唯一能把 FEED_THRESHOLD 從猜測變成量測的東西：目標 1900、門檻 1200 表示
  // 要掉到 63% 才停止送料。恢復時間若只有 150–250 ms，±50 ms 就是 20–33% 的誤差。
  const sl = samples(log, K.sl);
  if (sl.n > 2 && segs.length > 0) {
    let si = 0;
    let inShoot = false;
    let armed = false; // 達速之後才開始找 dip（否則進 SHOOT 的爬升段會被當成一顆球）
    let peak = -Infinity;
    let dipping = false;
    let bottom = Infinity;
    let tBottom = 0;
    let seq = 0;

    const closeDip = (tRecover: number) => {
      const depth = peak - bottom;
      const th = feedThresholdAt(log, tBottom);
      const below = bottom < th.v;
      seq++;
      push(
        "dip",
        tBottom,
        below ? "err" : "warn",
        "球 #" + seq + " dip −" + fixed(depth, 0) + " 底值 " + fixed(bottom, 0),
        "恢復 " +
          fixed((tRecover - tBottom) * 1000, 0) +
          " ms（±" +
          SAMPLE_RES_MS +
          " ms）· " +
          (below ? "跌破" : "未跌破") +
          " FEED_THRESHOLD " +
          fixed(th.v, 0) +
          "（" +
          th.src +
          "）",
        {
          seq,
          bottom,
          depth,
          recoverMs: (tRecover - tBottom) * 1000,
          threshold: th.v,
          thresholdSrc: th.src,
          below,
        },
        String(seq),
      );
      dipping = false;
      peak = -Infinity;
    };

    for (let i = 0; i < sl.n; i++) {
      const t = sl.xs[i];
      const v = sl.ys[i];
      while (si < segs.length - 1 && t >= segs[si].t1) si++;
      const seg = segs[si];
      const nowShoot = seg.state === "SHOOT" && t >= seg.t0 && t <= seg.t1;
      if (nowShoot !== inShoot) {
        // 換段：沒有恢復的 dip 直接丟掉（SHOOT 結束時飛輪降速不是一顆球）
        inShoot = nowShoot;
        dipping = false;
        peak = -Infinity;
        armed = false;
      }
      if (!inShoot) continue;
      if (!armed) {
        const r = readyAt.get(si);
        if (r === undefined || t >= r) armed = true;
        else continue;
      }
      if (!dipping) {
        if (v > peak) peak = v;
        if (peak - v > o.dipDepth) {
          dipping = true;
          bottom = v;
          tBottom = t;
        }
      } else {
        if (v < bottom) {
          bottom = v;
          tBottom = t;
        }
        // 回到「深度的 40% 以內」就算恢復：等回到峰值才算的話，最後一顆球永遠不會結案
        if (v >= peak - (peak - bottom) * 0.4) closeDip(t);
      }
    }
  }

  // ── ④ 爬升段（Climb/Holding 邊緣）──────────────────────────────────
  // 不做「HOLD 已改需重新進入保持」的黃燈：ClimbSystem.java:30-33 已即時重套，那顆燈會發假警報。
  {
    const cp = log.changePoints(K.climbHolding);
    for (let i = 1; i < cp.length; i++) {
      const t = cp[i];
      const on = (log.valueAt(K.climbHolding, t) ?? 0) > 0.5;
      const pos = log.valueAt(K.climbPos, t);
      push(
        "climb",
        t,
        on ? "ok" : "info",
        on ? "爬升保持啟動" : "離開保持",
        "Pos " + (pos === null ? "—" : fixed(pos, 0)),
        { holding: on, pos: pos ?? NaN },
      );
    }
  }

  // ── ⑥ 車頭反轉 ─────────────────────────────────────────────────────
  // reversed 開局預設 true（FGC2026_TeleOp_Match.java:130），□ 只反前後不反轉向，
  // 這是新駕駛撞牆的頭號原因。
  {
    const cp = log.changePoints(K.driveReversed);
    for (let i = 1; i < cp.length; i++) {
      const t = cp[i];
      const rev = (log.valueAt(K.driveReversed, t) ?? 0) > 0.5;
      push("flip", t, "info", rev ? "車頭反轉 → intake 端為前" : "車頭反轉 → shooter 端為前", "", { reversed: rev });
    }
  }

  // ── ⑦ 電壓局部谷（< 12.0）──────────────────────────────────────────
  {
    const b = samples(log, K.battery);
    let lastValley = -Infinity;
    let recovered = true;
    for (let i = 1; i < b.n - 1; i++) {
      const v = b.ys[i];
      if (v > lastValley + 0.15) recovered = true;
      if (v >= o.battLow) continue;
      if (!(v <= b.ys[i - 1] && v <= b.ys[i + 1])) continue;
      if (!recovered) continue;
      lastValley = v;
      recovered = false;
      push(
        "batt",
        b.xs[i],
        v < o.battErr ? "err" : "warn",
        "電壓谷 " + v.toFixed(2) + " V",
        v < o.battErr ? "低於 " + o.battErr + " V 驗收線" : "接近 " + o.battErr + " V 驗收線",
        { v },
      );
    }
  }

  // ── ⑧ 故障：OverCurrent 上升緣 / loop > 25 / 缺口 / Last Error ──────
  {
    const OC: [string, string][] = [
      [K.overCurrentL, "SL 過電流"],
      [K.overCurrentR, "SR 過電流"],
      [K.overCurrentWay, "way 過電流"],
      [K.climbOverCurrent, "爬升過電流"],
    ];
    for (const [key, label] of OC) {
      if (!log.has(key)) continue;
      const cp = log.changePoints(key);
      for (let i = 1; i < cp.length; i++) {
        const t = cp[i];
        if ((log.valueAt(key, t) ?? 0) <= 0.5) continue;
        push("fault", t, "err", label, "OverCurrent 上升緣", { key }, key);
      }
    }

    // loop 尖峰：連續超標合併成一筆（放在 argmax 上），低於門檻超過 0.5 s 才算新的一筆
    const lp = samples(log, K.loopMs);
    let open = false;
    let gMax = -Infinity;
    let gT = 0;
    let gN = 0;
    let lastAbove = -Infinity;
    const flushLoop = () => {
      if (!open) return;
      push(
        "fault",
        gT,
        "err",
        "loop " + fixed(gMax, 1) + " ms",
        "超過 " + o.loopMax + " ms 驗收線 · 這一段共 " + gN + " 圈超標",
        { peak: gMax, n: gN },
        "loop",
      );
      open = false;
      gMax = -Infinity;
      gN = 0;
    };
    for (let i = 0; i < lp.n; i++) {
      const t = lp.xs[i];
      const v = lp.ys[i];
      if (v > o.loopMax) {
        if (open && t - lastAbove > 0.5) flushLoop();
        open = true;
        gN++;
        if (v > gMax) {
          gMax = v;
          gT = t;
        }
        lastAbove = t;
      } else if (open && t - lastAbove > 0.5) {
        flushLoop();
      }
    }
    flushLoop();

    // 資料缺口：波形那邊畫斜線紋不內插，這裡也要有一顆看得見的標記
    for (const g of log.gaps(o.gapSec)) {
      push(
        "fault",
        g.t0,
        "err",
        "資料缺口 " + (g.t1 - g.t0).toFixed(2) + " s",
        g.t0.toFixed(2) + " → " + g.t1.toFixed(2) + " s · 這段沒有任何一批推播，波形不連線",
        { dur: g.t1 - g.t0 },
        "gap",
      );
    }

    // Last Error 變動
    if (log.has(K.lastError)) {
      const runs = log.runs(K.lastError, tMin, tMax, 10000);
      for (let i = 1; i < runs.length; i++) {
        const s = (runs[i].s ?? "").trim();
        if (!s) continue;
        push("fault", runs[i].t0, "err", "Last Error", s.slice(0, 160), { text: s }, "lasterr");
      }
    }
  }

  // ── ⑨ 通知（ws notify → log 的第九類事件）──────────────────────────
  for (const n of opts.notifies ?? []) {
    const lv = n.level.toUpperCase();
    const level: EventLevel = lv.startsWith("ERR") ? "err" : lv.startsWith("WARN") ? "warn" : "info";
    push("notify", n.t, level, "通知 " + n.title, n.desc ?? "", { level: n.level }, n.title.slice(0, 24));
  }

  out.sort((a, b) => a.t - b.t || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));

  const lo = opts.t0 ?? -Infinity;
  const hi = opts.t1 ?? Infinity;
  const win = lo === -Infinity && hi === Infinity ? out : out.filter((e) => e.t >= lo && e.t <= hi);

  if (win.length > o.maxEvents) {
    const cut = win.slice(0, o.maxEvents);
    cut.push({
      id: "fault:truncated",
      t: win[o.maxEvents].t,
      kind: "fault",
      level: "warn",
      label: "事件過多，已截斷（共 " + win.length + " 筆，只列前 " + o.maxEvents + " 筆）",
      detail: "縮小時間範圍或用篩選（! 開頭為排除）再看一次",
      data: { total: win.length },
    });
    return cut;
  }
  return win;
}

/** 即時增量：把新算出來的一批併進舊的，以 id 去重（同一份 log 的 id 永遠一致）。 */
export function mergeEvents(prev: readonly LogEvent[], next: readonly LogEvent[]): LogEvent[] {
  const by = new Map<string, LogEvent>();
  for (const e of prev) by.set(e.id, e);
  for (const e of next) by.set(e.id, e);
  return Array.from(by.values()).sort((a, b) => a.t - b.t || a.id.localeCompare(b.id));
}

/**
 * 篩選：空白分隔，`!` 前綴為排除。
 * 實務上更常需要的是「濾掉那個洗版的」，所以排除詞優先——中一個排除詞就出局。
 * 多個包含詞是 AND（可預期）；比對對象是標籤 + 說明 + 類別中文名 + 類別代碼。
 */
export function filterEvents(
  events: readonly LogEvent[],
  query: string,
  kinds?: ReadonlySet<EventKind>,
): LogEvent[] {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((s) => s.length > 0);
  const inc = terms.filter((s) => !s.startsWith("!"));
  const exc = terms
    .filter((s) => s.startsWith("!"))
    .map((s) => s.slice(1))
    .filter((s) => s.length > 0);
  return events.filter((e) => {
    if (kinds && !kinds.has(e.kind)) return false;
    if (inc.length === 0 && exc.length === 0) return true;
    const hay = (e.label + " " + e.detail + " " + KIND_LABEL[e.kind] + " " + e.kind).toLowerCase();
    for (const x of exc) if (hay.includes(x)) return false;
    for (const s of inc) if (!hay.includes(s)) return false;
    return true;
  });
}

/** Ctrl+↓ / Ctrl+↑：下一個 / 上一個事件。找不到回 null（不是回原地）。 */
export function nextEvent(
  events: readonly LogEvent[],
  t: number,
  dir: 1 | -1,
  eps = 1e-4,
): LogEvent | null {
  if (dir > 0) {
    for (let i = 0; i < events.length; i++) if (events[i].t > t + eps) return events[i];
    return null;
  }
  for (let i = events.length - 1; i >= 0; i--) if (events[i].t < t - eps) return events[i];
  return null;
}

/** Alt+↓ / Alt+↑：下一個 / 上一個「選定欄位的值變化點」（稀疏布林可能 500 幀不變）。 */
export function nextChange(
  log: LogStore,
  key: string,
  t: number,
  dir: 1 | -1,
  eps = 1e-4,
): number | null {
  const cp = log.changePoints(key);
  if (cp.length === 0) return null;
  if (dir > 0) {
    for (let i = 0; i < cp.length; i++) if (cp[i] > t + eps) return cp[i];
    return null;
  }
  for (let i = cp.length - 1; i >= 0; i--) if (cp[i] < t - eps) return cp[i];
  return null;
}

/**
 * OpMode RUN 區間（Ctrl+\ 縮放到這一段）。
 * 依據 /FGC/Status/Phase（FGC2026_TeleOp_Match.java:218 寫 INIT/RUN/STOPPED）；
 * 沒有這個埋點就回 null，呼叫端要顯示「這份 log 沒有 Phase 埋點」而不是假裝縮到某處。
 */
export function runInterval(log: LogStore): { t0: number; t1: number } | null {
  const key = "/FGC/Status/Phase";
  if (!log.has(key)) return null;
  const [a, b] = log.tRange;
  const runs = log.runs(key, a, b, 10000);
  const run = runs.filter((r) => (r.s ?? "") === "RUN");
  if (run.length === 0) return null;
  return { t0: run[0].t0, t1: run[run.length - 1].t1 };
}
