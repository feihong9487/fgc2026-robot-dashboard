// LogStore：一份帶機器人時戳、可任意 seek 的稀疏 log。
//
// 為什麼是稀疏而不是等間隔取樣表：機器人端的推播本來就是 diff
// （DashHub.java:242 值相同直接 return、DashPublisher.java:41 只送 drainDirty()），
// 所以資料的原生形態就是「每個 key 各自的事件序列」。穩態的 1900 tps 一秒可能只有
// 兩個點，硬要對齊 50 ms 網格等於為每個 key 在每個 tick 補值，製造空洞矩陣。
// tick 對齊是「查詢時的投影」，不是「儲存的格式」。
//
// 效能約束（§7.5）：
//   · Float64Array 手動 2 倍成長，永不 splice（既有 store.ts:70-73 每批 O(n) 搬移）
//   · 整場全留不截斷：150 s × 20 Hz × 60 key ≈ 18 萬樣本 ≈ 2.9 MB，不需要 ring buffer
//   · per-key 訂閱 + rAF 合批，20 Hz 的推播不會變成每秒 20 次全樹重繪
//
// 可實例化：live / A / B 三份共存，A/B 疊比與回放共用同一套面板程式碼。

import type { NtValue } from "../../lib/store";
import { K } from "./fgcKeys";

export type FieldKind = "num" | "bool" | "str";

/** 時戳來源。robot = /FGC/Status/Match s；client = 本機時鐘（精度只有 ±50 ms）。 */
export type TSource = "robot" | "client" | "none";

export interface WindowSamples {
  /** 長度 n 的時間陣列（秒，機器人時戳）。 */
  xs: Float64Array;
  /** 長度 n 的值陣列（bool 為 0/1，str 為字典索引）。 */
  ys: Float64Array;
  n: number;
  /** 是否經過 min/max decimation（true 時不可拿去做統計）。 */
  decimated: boolean;
}

export interface Run {
  t0: number;
  t1: number;
  /** 數值（bool 為 0/1；字串欄位看 s）。 */
  v: number;
  s: string | null;
}

export interface Gap {
  t0: number;
  t1: number;
}

const INIT_CAP = 64;
/** 保險絲：總樣本超過這個數就停止累積並警告（§7.5 第 8 點）。 */
const MAX_SAMPLES = 5_000_000;

interface Field {
  key: string;
  kind: FieldKind;
  t: Float64Array;
  v: Float64Array;
  n: number;
  /** str 欄位的字典；同一個字串只存一次，v 存索引。 */
  dict: string[] | null;
  dictIndex: Map<string, number> | null;
  min: number;
  max: number;
  version: number;
}

function grow(a: Float64Array, need: number): Float64Array {
  let cap = a.length || INIT_CAP;
  while (cap < need) cap *= 2;
  const out = new Float64Array(cap);
  out.set(a);
  return out;
}

/** 最大的 i 使 t[i] <= x；沒有就 -1。 */
function seek(t: Float64Array, n: number, x: number): number {
  let lo = 0;
  let hi = n - 1;
  let res = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (t[mid] <= x) {
      res = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return res;
}

export class LogStore {
  readonly name: string;

  private fields = new Map<string, Field>();
  /** 每一批的時戳（缺口偵測、批數統計）。 */
  private batchT: Float64Array = new Float64Array(INIT_CAP);
  private batchN = 0;

  /** 最新值鏡射，給「現在是多少」這種不需要歷史的讀取。 */
  readonly latest = new Map<string, NtValue>();

  tSource: TSource = "none";
  /** 退回本機時鐘的批數；> 0 就要在 UI 上誠實標示。 */
  fallbackBatches = 0;
  /** 機器人時戳倒退（換場 / 重開 OpMode）的次數。 */
  resets = 0;
  samples = 0;
  overflow = false;

  private lastT = -1;
  private version = 0;
  private clientT0 = 0;

  /** gaps() 的增量快取：新的一批只可能在尾端多出一個缺口，不必每次重掃全部。 */
  private gapCache: Gap[] = [];
  private gapThreshold = -1;
  private gapScanned = 0;

  private listeners = new Set<() => void>();
  private keyListeners = new Map<string, Set<() => void>>();
  private dirty = new Set<string>();
  private scheduled = false;
  /** 批次載入期間不發訊號（載完一次性發）。 */
  private silent = false;

  constructor(name = "live") {
    this.name = name;
    this.clientT0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  }

  // ── 寫入 ────────────────────────────────────────────────────────────

  /**
   * 套用一批 diff。回傳這一批採用的時戳（秒）。
   *
   * 時戳一律優先取 d["/FGC/Status/Match s"]——它每圈重算且必然變動，所以必進 dirty，
   * 每一批 nt 與每一行錄影都帶著它（規格 §0）。缺席才退回本機時鐘並記 tSource。
   */
  applyBatch(d: Record<string, NtValue>, forcedT?: number): number {
    let t: number;
    const robotT = d[K.matchS];
    if (forcedT !== undefined && Number.isFinite(forcedT)) {
      t = forcedT;
      if (this.tSource === "none") this.tSource = typeof robotT === "number" ? "robot" : "client";
    } else if (typeof robotT === "number" && Number.isFinite(robotT)) {
      t = robotT;
      if (this.tSource !== "client") this.tSource = "robot";
    } else {
      t = this.clientNow();
      this.fallbackBatches++;
      this.tSource = "client";
    }

    // 單調遞增是二分搜尋的前提。機器人重開 OpMode 會把 Match s 歸零，
    // 這時不能讓時間倒退——記一次 reset，接在尾端繼續走。
    if (this.lastT >= 0 && t < this.lastT) {
      this.resets++;
      t = this.lastT;
    }
    this.lastT = t;

    // 同一個機器人時刻只算一批。樂觀更新（RobotClient.set 的 liveLog.applyBatch(patch,
    // liveLog.tMax)）本來會在尾端塞一個與前一筆相同的時戳，製造一個 0 秒的假間隔，
    // 把 batchIntervals() 的 p50 / p95 拉低——長時間調參可以塞進數百筆。
    if (this.batchN === 0 || this.batchT[this.batchN - 1] !== t) {
      if (this.batchN >= this.batchT.length) this.batchT = grow(this.batchT, this.batchN + 1);
      this.batchT[this.batchN++] = t;
    }

    for (const key in d) {
      const v = d[key];
      this.latest.set(key, v);
      if (this.overflow) continue;
      if (typeof v === "number") {
        if (Number.isFinite(v)) this.push(key, "num", t, v, null);
      } else if (typeof v === "boolean") {
        this.push(key, "bool", t, v ? 1 : 0, null);
      } else if (typeof v === "string") {
        this.push(key, "str", t, 0, v);
      } else if (Array.isArray(v)) {
        // string[]（/FGC/Vision/Tags、CameraPublisher streams）當一個字串存，
        // 語意是「這一刻的整組值」，拆開反而失去對應關係。
        this.push(key, "str", t, 0, v.join(""));
      }
      this.dirty.add(key);
    }
    this.emit();
    return t;
  }

  /** 批次載入（回放檔）：全部套完才發一次訊號。 */
  applyBatches(batches: readonly { t: number; d: Record<string, NtValue> }[]): void {
    this.beginBulk();
    try {
      for (const b of batches) this.applyBatch(b.d, b.t);
    } finally {
      this.endBulk();
    }
  }

  /**
   * 串流載入用：進入靜默，逐批 applyBatch，最後 endBulk() 發一次訊號。
   *
   * 為什麼要開這一對而不是先收集成陣列再 applyBatches：那樣「全部批次的 JS 物件」
   * 會同時活在記憶體裡（一份 20 MB 的錄影檔是幾十萬個 batch 物件 + 每個 key 一個
   * 字串參照），比它想省掉的「原始字串的第二份拷貝」更貴。逐批寫進來，峰值就只有
   * LogStore 自己的 Float64Array。
   */
  beginBulk(): void {
    this.silent = true;
  }

  endBulk(): void {
    this.silent = false;
    this.flush();
  }

  private push(key: string, kind: FieldKind, t: number, v: number, s: string | null): void {
    let f = this.fields.get(key);
    if (!f) {
      f = {
        key,
        kind,
        t: new Float64Array(INIT_CAP),
        v: new Float64Array(INIT_CAP),
        n: 0,
        dict: kind === "str" ? [] : null,
        dictIndex: kind === "str" ? new Map() : null,
        min: Infinity,
        max: -Infinity,
        version: 0,
      };
      this.fields.set(key, f);
    }
    // 型別中途改變（機器人端埋點改了）：以第一次見到的型別為準，其餘忽略，
    // 免得同一條序列一半是數字一半是字典索引。
    if (f.kind !== kind) return;

    let value = v;
    if (kind === "str") {
      const str = s ?? "";
      let idx = f.dictIndex!.get(str);
      if (idx === undefined) {
        idx = f.dict!.length;
        f.dict!.push(str);
        f.dictIndex!.set(str, idx);
      }
      value = idx;
      // 字串欄位同值不重複存：run-length 色帶只在乎變化點。
      if (f.n > 0 && f.v[f.n - 1] === value) return;
    }

    if (f.n >= f.t.length) {
      f.t = grow(f.t, f.n + 1);
      f.v = grow(f.v, f.n + 1);
    }
    f.t[f.n] = t;
    f.v[f.n] = value;
    f.n++;
    f.version++;
    if (kind !== "str") {
      if (value < f.min) f.min = value;
      if (value > f.max) f.max = value;
    }
    this.samples++;
    if (this.samples > MAX_SAMPLES) this.overflow = true;
  }

  private clientNow(): number {
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    return (now - this.clientT0) / 1000;
  }

  // ── 讀取 ────────────────────────────────────────────────────────────

  keys(): string[] {
    return Array.from(this.fields.keys());
  }

  has(key: string): boolean {
    return this.fields.has(key);
  }

  kindOf(key: string): FieldKind | null {
    return this.fields.get(key)?.kind ?? null;
  }

  countOf(key: string): number {
    return this.fields.get(key)?.n ?? 0;
  }

  get batchCount(): number {
    return this.batchN;
  }

  get tMin(): number {
    return this.batchN > 0 ? this.batchT[0] : 0;
  }

  get tMax(): number {
    return this.batchN > 0 ? this.batchT[this.batchN - 1] : 0;
  }

  /** 整份 log 的時間範圍。空的時候回 [0,0]。 */
  get tRange(): [number, number] {
    return [this.tMin, this.tMax];
  }

  /** 某欄位的值域（bool 為 0/1；str 回 null）。 */
  rangeOf(key: string): [number, number] | null {
    const f = this.fields.get(key);
    if (!f || f.n === 0 || f.kind === "str") return null;
    return [f.min, f.max];
  }

  /**
   * zero-order hold 取值：回傳「t 這一刻機器人上的值」。
   * 沒有任何 t 之前的樣本才回 null——不是 0，也不是內插。
   */
  valueAt(key: string, t: number): number | null {
    const f = this.fields.get(key);
    if (!f || f.n === 0) return null;
    const i = seek(f.t, f.n, t);
    return i < 0 ? null : f.v[i];
  }

  /** 同上，但回字串（str 欄位）。非 str 欄位回 null。 */
  stringAt(key: string, t: number): string | null {
    const f = this.fields.get(key);
    if (!f || f.n === 0 || f.kind !== "str") return null;
    const i = seek(f.t, f.n, t);
    return i < 0 ? null : f.dict![f.v[i]];
  }

  /** 該值最後一次更新的時刻；用來顯示「過期 N 秒」而不是顯示空白。 */
  updatedAt(key: string, t: number): number | null {
    const f = this.fields.get(key);
    if (!f || f.n === 0) return null;
    const i = seek(f.t, f.n, t);
    return i < 0 ? null : f.t[i];
  }

  latestNum(key: string, def = 0): number {
    const v = this.latest.get(key);
    return typeof v === "number" ? v : def;
  }

  latestBool(key: string, def = false): boolean {
    const v = this.latest.get(key);
    return typeof v === "boolean" ? v : def;
  }

  latestStr(key: string, def = ""): string {
    const v = this.latest.get(key);
    return typeof v === "string" ? v : def;
  }

  /**
   * 視窗取樣 + min/max decimation（uPlot 官方推薦法）。
   *
   * 一定會把 t0 之前最近的那個樣本帶進來當錨點，否則穩態訊號在視窗左緣會憑空消失
   * ——「數值消失」被誤讀成「值是 0」是視覺調校最常見的災難。
   */
  sampleWindow(key: string, t0: number, t1: number, maxPts = 2000): WindowSamples {
    const empty: WindowSamples = { xs: new Float64Array(0), ys: new Float64Array(0), n: 0, decimated: false };
    const f = this.fields.get(key);
    if (!f || f.n === 0) return empty;

    const anchor = seek(f.t, f.n, t0);
    const start = anchor < 0 ? 0 : anchor;
    const end = seek(f.t, f.n, t1);
    if (end < start) {
      // 視窗完全在第一個樣本之前
      if (anchor < 0) return empty;
      return { xs: Float64Array.of(f.t[start]), ys: Float64Array.of(f.v[start]), n: 1, decimated: false };
    }
    const count = end - start + 1;
    if (count <= maxPts) {
      return {
        xs: f.t.slice(start, end + 1),
        ys: f.v.slice(start, end + 1),
        n: count,
        decimated: false,
      };
    }

    // 每個 bucket 送出局部極小與局部極大兩點（依索引順序），波形的尖峰不會被抽掉。
    const buckets = Math.max(1, Math.floor(maxPts / 2));
    const xs = new Float64Array(buckets * 2);
    const ys = new Float64Array(buckets * 2);
    let out = 0;
    for (let b = 0; b < buckets; b++) {
      const lo = start + Math.floor((count * b) / buckets);
      const hi = start + Math.floor((count * (b + 1)) / buckets) - 1;
      if (hi < lo) continue;
      let iMin = lo;
      let iMax = lo;
      for (let i = lo + 1; i <= hi; i++) {
        if (f.v[i] < f.v[iMin]) iMin = i;
        if (f.v[i] > f.v[iMax]) iMax = i;
      }
      const a = Math.min(iMin, iMax);
      const c = Math.max(iMin, iMax);
      xs[out] = f.t[a];
      ys[out] = f.v[a];
      out++;
      if (c !== a) {
        xs[out] = f.t[c];
        ys[out] = f.v[c];
        out++;
      }
    }
    return { xs: xs.subarray(0, out), ys: ys.subarray(0, out), n: out, decimated: true };
  }

  /** 視窗內的原始值（統計用，絕不 decimate）。 */
  valuesInWindow(key: string, t0: number, t1: number): Float64Array {
    const f = this.fields.get(key);
    if (!f || f.n === 0) return new Float64Array(0);
    let start = seek(f.t, f.n, t0);
    // 統計只要視窗內的樣本，不含錨點
    start = start < 0 ? 0 : f.t[start] < t0 ? start + 1 : start;
    const end = seek(f.t, f.n, t1);
    if (end < start) return new Float64Array(0);
    return f.v.slice(start, end + 1);
  }

  /**
   * run-length 掃描（DiscreteBand 用）：同值合併成色塊。
   * 錨點會被裁到 t0，所以色帶永遠鋪滿整個視窗，不會左邊留白。
   */
  runs(key: string, t0: number, t1: number, maxRuns = 4000): Run[] {
    const f = this.fields.get(key);
    if (!f || f.n === 0) return [];
    const out: Run[] = [];
    let i = seek(f.t, f.n, t0);
    if (i < 0) i = 0;
    if (f.t[i] > t1) return []; // 整個視窗都在第一個樣本之前
    let curV = f.v[i];
    let curT = Math.max(t0, f.t[i]);
    for (i = i + 1; i < f.n && f.t[i] <= t1; i++) {
      if (f.v[i] === curV) continue;
      out.push({ t0: curT, t1: f.t[i], v: curV, s: f.kind === "str" ? f.dict![curV] : null });
      if (out.length >= maxRuns) return out;
      curV = f.v[i];
      curT = f.t[i];
    }
    out.push({ t0: curT, t1, v: curV, s: f.kind === "str" ? f.dict![curV] : null });
    return out;
  }

  /**
   * 這個欄位在整份 log 裡有沒有變過（編碼器沒插線的特徵就是「一直是同一個值」）。
   * 只掃不配置——問一個布林值不該付兩次 Float64Array 的配置成本（changePoints
   * 會 new 一份再 slice 一份，一個 3000 樣本的 key 就是 48 KB，而燈牆 20 Hz 重繪）。
   */
  hasChanged(key: string): boolean {
    const f = this.fields.get(key);
    if (!f || f.n < 2) return false;
    for (let i = 1; i < f.n; i++) if (f.v[i] !== f.v[i - 1]) return true;
    return false;
  }

  /**
   * 值變化點的時刻（Alt+↓/↑ 跳下一個變化用）。
   * 稀疏布林可能 500 幀不變，逐格前進毫無意義。
   */
  changePoints(key: string): Float64Array {
    const f = this.fields.get(key);
    if (!f || f.n === 0) return new Float64Array(0);
    const out = new Float64Array(f.n);
    let n = 0;
    out[n++] = f.t[0];
    for (let i = 1; i < f.n; i++) {
      if (f.v[i] !== f.v[i - 1]) out[n++] = f.t[i];
    }
    return out.slice(0, n);
  }

  /**
   * 資料缺口：相鄰兩批的間隔超過門檻。畫斜線紋，絕不內插。
   *
   * 增量快取：LineGraph / DiscreteBand / TimeBar 每一幀都問，而新的一批只可能在
   * 尾端產生一個新缺口。長 pit session（30 分鐘 ≈ 36,000 批）不做這件事會愈跑愈慢。
   */
  gaps(thresholdSec = 1.0): Gap[] {
    if (thresholdSec !== this.gapThreshold) {
      this.gapThreshold = thresholdSec;
      this.gapCache = [];
      this.gapScanned = 0;
    }
    const from = Math.max(1, this.gapScanned);
    for (let i = from; i < this.batchN; i++) {
      const dt = this.batchT[i] - this.batchT[i - 1];
      if (dt > thresholdSec) this.gapCache.push({ t0: this.batchT[i - 1], t1: this.batchT[i] });
    }
    this.gapScanned = this.batchN;
    return this.gapCache;
  }

  /** 相鄰批次間隔的分位數（底部狀態列的「間隔 p50 / p95」）。 */
  batchIntervals(): Float64Array {
    if (this.batchN < 2) return new Float64Array(0);
    const out = new Float64Array(this.batchN - 1);
    for (let i = 1; i < this.batchN; i++) out[i - 1] = this.batchT[i] - this.batchT[i - 1];
    return out;
  }

  /** 粗估佔用位元組數（底部狀態列顯示「2.9 MB」）。 */
  bytes(): number {
    let n = this.batchT.length * 8;
    this.fields.forEach((f) => {
      n += (f.t.length + f.v.length) * 8;
    });
    return n;
  }

  // ── 訂閱（useSyncExternalStore 用；snapshot 一律是 primitive）────────

  getVersion = (): number => this.version;

  keyVersion(key: string): number {
    return this.fields.get(key)?.version ?? 0;
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  /** 只有這些 key 真的變動才叫醒你（applyBatch 是 diff，大多數 key 每批都沒動）。 */
  subscribeKeys(keys: readonly string[], fn: () => void): () => void {
    for (const k of keys) {
      let set = this.keyListeners.get(k);
      if (!set) {
        set = new Set();
        this.keyListeners.set(k, set);
      }
      set.add(fn);
    }
    return () => {
      for (const k of keys) {
        const set = this.keyListeners.get(k);
        if (!set) continue;
        set.delete(fn);
        if (set.size === 0) this.keyListeners.delete(k);
      }
    };
  }

  /** rAF 合批：把 20 Hz 的推播壓到 <= 60 fps 且與瀏覽器繪製對齊。 */
  private emit(): void {
    this.version++;
    if (this.silent || this.scheduled) return;
    this.scheduled = true;
    const run = () => {
      this.scheduled = false;
      this.flush();
    };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
    else setTimeout(run, 16);
  }

  private flush(): void {
    const woken = new Set<() => void>();
    this.dirty.forEach((k) => {
      const set = this.keyListeners.get(k);
      if (set) set.forEach((fn) => woken.add(fn));
    });
    this.dirty.clear();
    this.listeners.forEach((fn) => woken.add(fn));
    woken.forEach((fn) => {
      try {
        fn();
      } catch {
        /* 一個訂閱者丟例外不該讓其餘的收不到 */
      }
    });
  }

  clear(): void {
    this.fields.clear();
    this.latest.clear();
    this.batchT = new Float64Array(INIT_CAP);
    this.batchN = 0;
    this.gapCache = [];
    this.gapThreshold = -1;
    this.gapScanned = 0;
    this.samples = 0;
    this.overflow = false;
    this.lastT = -1;
    this.resets = 0;
    this.fallbackBatches = 0;
    this.tSource = "none";
    this.clientT0 = typeof performance !== "undefined" ? performance.now() : Date.now();
    this.emit();
  }
}

/** 即時那一份。REPLAY 與 A/B 各自 new 一個實例，面板程式碼完全共用。 */
export const liveLog = new LogStore("live");
