// 每球凹陷偵測（§3.3 #20 的演算法部分，刻意與畫面分開）。
//
// 為什麼要有這支：FEED_THRESHOLD 現在是猜出來的。目標 1900、門檻 1200 表示
// 「飛輪要掉到 63% 才停止送料」——這句話有沒有道理，只有把每一顆球造成的
// 轉速凹陷底值量出來才知道。沒有這張表就只能憑「感覺卡卡的」調參。
//
// **解析度誠實聲明**：推播週期 PERIOD_MS=50，所以每個時間量測的解析度是 ±50 ms。
// 恢復時間若只有 150–250 ms，誤差就是 20–33%——UI 上必須把這句話寫出來
// （DipAnalyzer 的標題列），否則使用者會拿 180 ms 跟 220 ms 認真比較。
//
// 這支是純函式（只讀 LogStore），所以第三階段 E 的 eventDetect 可以直接呼叫它
// 產生「③ 每球 dip」那一類事件，不必再實作一次。

import { LogStore } from "../../lib/LogStore";
import { K, paramKey } from "../../lib/fgcKeys";

export interface Dip {
  /** 整份 log 裡的第幾顆（1 起算）。 */
  index: number;
  /** 開始跌破 ref − minDepth 的時刻。 */
  tStart: number;
  tBottom: number;
  /** 回到 ref − exitDepth 的時刻；null = 到這一段結束都沒回來。 */
  tRecover: number | null;
  /** 當時的參考轉速：優先取 TargetL/R 回讀值，沒有才用這一段的最大值。 */
  ref: number;
  refFromTarget: boolean;
  bottom: number;
  /** ref − bottom。 */
  depth: number;
  /** 從底值回到 ref − exitDepth 的毫秒數；null = 沒回來。 */
  recoverMs: number | null;
  /** 當時的 /FGC/Param/FEED_THRESHOLD 回讀值（不是寫死的 1200）。 */
  threshold: number;
  /** 底值有沒有跌破當時的門檻。 */
  broke: boolean;
  /** 這一顆屬於第幾段 SHOOT。 */
  shootIndex: number;
}

export interface DipOptions {
  /** 進入凹陷的深度門檻（tps）。§3.3 #20 規定 150。 */
  minDepth?: number;
  /** 離開凹陷的深度（遲滯，避免一顆球被切成三顆）。 */
  exitDepth?: number;
  /** 只掃最近幾段 SHOOT（整場 780 s 有 80 段，全掃沒必要）。 */
  maxRuns?: number;
  /** 目標 key：SL 配 TargetL、SR 配 TargetR。 */
  targetKey?: string;
}

const NO_DIPS: Dip[] = [];

/**
 * 掃出 SHOOT 期間 `key` 的每一次局部凹陷。
 *
 * 只在 /FGC/Drive/State === "SHOOT" 的區間內找：COLLECT 期間飛輪本來就降到
 * IDLE_TPS（Constants 預設 0，也就是停死），那不是「一顆球造成的凹陷」，
 * 把它算進去會讓每一段 COLLECT 都變成一顆假球。
 */
export function detectDips(log: LogStore, key: string = K.sl, opts: DipOptions = {}): Dip[] {
  const minDepth = opts.minDepth ?? 150;
  const exitDepth = opts.exitDepth ?? Math.max(20, minDepth / 3);
  const maxRuns = opts.maxRuns ?? 40;
  const targetKey = opts.targetKey ?? (key === K.sr ? K.targetR : K.targetL);
  const thrKey = paramKey("FEED_THRESHOLD");

  if (!log.has(key) || !log.has(K.driveState)) return NO_DIPS;
  const [tMin, tMax] = log.tRange;
  if (!(tMax > tMin)) return NO_DIPS;

  const shoot = log.runs(K.driveState, tMin, tMax, 8000).filter((r) => r.s === "SHOOT" && r.t1 > r.t0);
  const from = Math.max(0, shoot.length - maxRuns);
  const out: Dip[] = [];
  let index = 0;

  for (let ri = 0; ri < shoot.length; ri++) {
    const run = shoot[ri];
    // 序號要跨整份 log 連續，所以被 maxRuns 裁掉的那些也要先數過
    if (ri < from) {
      index += countDips(log, key, run.t0, run.t1, targetKey, minDepth, exitDepth);
      continue;
    }
    scanRun(log, key, run.t0, run.t1, thrKey, targetKey, minDepth, exitDepth, ri + 1, () => ++index, out);
  }
  return out;
}

/** 被裁掉的區段只要數量（維持序號連續），不建物件。 */
function countDips(
  log: LogStore,
  key: string,
  t0: number,
  t1: number,
  targetKey: string,
  minDepth: number,
  exitDepth: number,
): number {
  let n = 0;
  scanRun(log, key, t0, t1, "", targetKey, minDepth, exitDepth, 0, () => ++n, null);
  return n;
}

/**
 * 掃一段 SHOOT。遲滯狀態機：跌破 ref−minDepth 進入、回到 ref−exitDepth 離開。
 * 沒有遲滯的話，一顆球在底部的抖動會被切成三四顆。
 */
function scanRun(
  log: LogStore,
  key: string,
  t0: number,
  t1: number,
  thrKey: string,
  targetKey: string,
  minDepth: number,
  exitDepth: number,
  shootIndex: number,
  nextIndex: () => number,
  out: Dip[] | null,
): void {
  // maxPts 開大：統計用的取樣絕不能被 decimate（min/max 抽樣會製造假的底值）
  const w = log.sampleWindow(key, t0, t1, 1_000_000);
  if (w.n === 0 || w.decimated) return;

  // 參考轉速：先問目標回讀值（COLLECT/SHOOT 的目標是階梯，取中點最不會踩在邊界上），
  // 沒有埋點才退回這一段的最大值。
  const mid = (t0 + t1) / 2;
  const tgt = log.valueAt(targetKey, mid);
  let ref = 0;
  let refFromTarget = false;
  if (tgt !== null && Number.isFinite(tgt) && tgt > minDepth) {
    ref = tgt;
    refFromTarget = true;
  } else {
    for (let i = 0; i < w.n; i++) if (w.xs[i] >= t0 && w.ys[i] > ref) ref = w.ys[i];
  }
  if (!(ref > minDepth)) return;

  const enter = ref - minDepth;
  const exit = ref - exitDepth;

  // armed：這一段 SHOOT 的飛輪**第一次**到速之前不算凹陷。
  // 沒有這一條，每一段 SHOOT 開頭的 spin-up 斜坡（COLLECT 期 IDLE_TPS=0 → 1900）
  // 都會被算成一顆「深度 1592、恢復 1929 ms、跌破門檻」的假球——那不是球，
  // 那是 spin-up 死時間，它有自己的量測欄位（/FGC/Shooter/SpinupMs）。
  let armed = false;
  let inDip = false;
  let tStart = 0;
  let bottom = 0;
  let tBottom = 0;

  const close = (tRecover: number | null) => {
    const idx = nextIndex();
    if (!out) return;
    const threshold = thrKey ? (log.valueAt(thrKey, tBottom) ?? NaN) : NaN;
    out.push({
      index: idx,
      tStart,
      tBottom,
      tRecover,
      ref,
      refFromTarget,
      bottom,
      depth: ref - bottom,
      recoverMs: tRecover === null ? null : (tRecover - tBottom) * 1000,
      threshold,
      broke: Number.isFinite(threshold) && bottom < threshold,
      shootIndex,
    });
  };

  for (let i = 0; i < w.n; i++) {
    const t = w.xs[i];
    // sampleWindow 一定會帶入 t0 之前的錨點（ZOH 才畫得對），統計時要跳過它
    if (t < t0) continue;
    const v = w.ys[i];
    if (!armed) {
      if (v >= exit) armed = true;
      continue;
    }
    if (!inDip) {
      if (v < enter) {
        inDip = true;
        tStart = t;
        bottom = v;
        tBottom = t;
      }
    } else {
      if (v < bottom) {
        bottom = v;
        tBottom = t;
      }
      if (v >= exit) {
        close(t);
        inDip = false;
      }
    }
  }
  // 這一段結束時還在凹陷裡：算一顆，但恢復時間是「還沒回來」而不是 0
  if (inDip) close(null);
}

/** 中位數（給「中位底值 1372」那一行；不排序原陣列）。 */
export function median(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  const a = Float64Array.from(xs);
  a.sort();
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
