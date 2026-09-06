// stats：區間統計與直方圖。
//
// 只保留 count / min / max / mean / σ。σ 不可砍——調參的正確問題不是「轉速多少」
// 而是「轉速多穩」，σ 直接量化射手一致性，這是決定命中率的物理量。
// Reference / 相對誤差模式不做：10 次以下樣本的相對誤差分布會誤導。

export interface Summary {
  count: number;
  min: number;
  max: number;
  mean: number;
  /** 母體標準差（樣本就是我們有的全部，不做 n-1 修正）。 */
  sigma: number;
}

export const EMPTY_SUMMARY: Summary = { count: 0, min: NaN, max: NaN, mean: NaN, sigma: NaN };

export function summarize(v: ArrayLike<number>): Summary {
  const n = v.length;
  if (n === 0) return EMPTY_SUMMARY;
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const x = v[i];
    if (x < min) min = x;
    if (x > max) max = x;
    sum += x;
  }
  const mean = sum / n;
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const d = v[i] - mean;
    acc += d * d;
  }
  return { count: n, min, max, mean, sigma: Math.sqrt(acc / n) };
}

/**
 * 分位數（線性內插）。loop p50 / p95 用。
 * 會複製一份再排序：呼叫端的 Float64Array 常常是 LogStore 的 slice，排序它等於毀資料。
 */
export function percentile(v: ArrayLike<number>, p: number): number {
  const n = v.length;
  if (n === 0) return NaN;
  const a = Float64Array.from(v as ArrayLike<number>);
  a.sort();
  if (n === 1) return a[0];
  const idx = (n - 1) * Math.min(1, Math.max(0, p));
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return a[lo];
  return a[lo] + (a[hi] - a[lo]) * (idx - lo);
}

/** 一次算多個分位數，只排序一次。 */
export function percentiles(v: ArrayLike<number>, ps: readonly number[]): number[] {
  const n = v.length;
  if (n === 0) return ps.map(() => NaN);
  const a = Float64Array.from(v as ArrayLike<number>);
  a.sort();
  return ps.map((p) => {
    const idx = (n - 1) * Math.min(1, Math.max(0, p));
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    return lo === hi ? a[lo] : a[lo] + (a[hi] - a[lo]) * (idx - lo);
  });
}

export interface Histogram {
  /** bins 個計數。 */
  counts: Int32Array;
  /** 每個 bin 的左界，長度 bins+1（最後一個是右界）。 */
  edges: Float64Array;
  max: number;
}

/** 等寬直方圖。binWidth 給定時（例如 loop ms 每 2 ms 一格）以它為準。 */
export function histogram(
  v: ArrayLike<number>,
  bins = 20,
  range?: [number, number],
  binWidth?: number,
): Histogram {
  const n = v.length;
  let lo: number;
  let hi: number;
  if (range) {
    [lo, hi] = range;
  } else {
    lo = Infinity;
    hi = -Infinity;
    for (let i = 0; i < n; i++) {
      if (v[i] < lo) lo = v[i];
      if (v[i] > hi) hi = v[i];
    }
    if (n === 0) {
      lo = 0;
      hi = 1;
    }
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) hi = lo + 1;

  let count = bins;
  if (binWidth && binWidth > 0) {
    lo = Math.floor(lo / binWidth) * binWidth;
    hi = Math.ceil(hi / binWidth) * binWidth;
    count = Math.max(1, Math.min(512, Math.round((hi - lo) / binWidth)));
  }
  const w = (hi - lo) / count;
  const counts = new Int32Array(count);
  const edges = new Float64Array(count + 1);
  for (let i = 0; i <= count; i++) edges[i] = lo + w * i;
  for (let i = 0; i < n; i++) {
    let b = Math.floor((v[i] - lo) / w);
    if (b < 0) b = 0;
    if (b >= count) b = count - 1;
    counts[b]++;
  }
  let max = 0;
  for (let i = 0; i < count; i++) if (counts[i] > max) max = counts[i];
  return { counts, edges, max };
}

/**
 * 滾動視窗：頂欄的 loop p50 / p95 用。
 * 固定容量的環形緩衝，push 是 O(1)，不做任何搬移。
 */
export class Rolling {
  private buf: Float64Array;
  private head = 0;
  private len = 0;

  constructor(capacity = 400) {
    this.buf = new Float64Array(capacity);
  }

  push(x: number): void {
    if (!Number.isFinite(x)) return;
    this.buf[this.head] = x;
    this.head = (this.head + 1) % this.buf.length;
    if (this.len < this.buf.length) this.len++;
  }

  get size(): number {
    return this.len;
  }

  values(): Float64Array {
    if (this.len < this.buf.length) return this.buf.slice(0, this.len);
    const out = new Float64Array(this.len);
    const tail = this.buf.length - this.head;
    out.set(this.buf.subarray(this.head), 0);
    out.set(this.buf.subarray(0, this.head), tail);
    return out;
  }

  clear(): void {
    this.head = 0;
    this.len = 0;
  }
}

/** 固定寬度數值格式：頂欄與 Inspector 的數字不可以隨值改變寬度。 */
export function fmt(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(digits);
}

export function fmtInt(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return Math.round(v).toLocaleString("en-US");
}
