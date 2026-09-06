// 球節奏偵測器（#14 的資料層）。
//
// 為什麼 dip 偵測值得做：IDLE_TPS = 0（Constants.java:32）表示每次 COLLECT 都把
// 飛輪停死，所以 spin-up 就是「按下 R2 到第一顆球出膛」的死時間——在一場要射 500 顆球的
// 遊戲裡，這是最貴的固定成本。而每顆球出膛時飛輪的凹陷深度與恢復時間，是把
// FEED_THRESHOLD 從猜測變成量測的唯一證據。
//
// 這裡是「前端簡易版」：規格 §3.1 的 eventDetect.ts 會在第三階段用同一套規則
// 對整份 log 一次性全掃。這一版只吃即時尾端，所以刻意只用「深度 > 150 tps 的
// 局部極小」這一條，不做恢復時間統計（那需要回頭看樣本，屬於 DipAnalyzer 的工作）。
//
// 已知限制：推播是 20 Hz 的 diff，兩顆球間隔 0.42 s 只有約 8 個樣本，
// 所以偵測解析度是 ±50 ms。UI 上要標出來。

/** 進入 dip 的深度門檻（tps）。 */
export const DIP_DEPTH = 150;
/** 恢復到「參考值 − 這個量」以內就算這一顆結束。 */
export const DIP_RECOVER = 60;
/** 參考值（近期高點）的衰減速度，讓目標下修時參考值跟得上。 */
const REF_DECAY_TPS_PER_S = 300;
const MAX_ROUNDS = 20;

export interface Round {
  /** 進入 SHOOT 的機器人時戳（秒）。 */
  start: number;
  /** 每顆球的時戳（秒）。 */
  balls: number[];
  /** 這一輪的 /FGC/Shooter/SpinupMs latch 值。 */
  spinupMs: number | null;
}

export class RhythmTracker {
  /** 已結束的輪次（最新在最後）。 */
  rounds: Round[] = [];
  /** 正在進行的這一輪；不在 SHOOT 時是 null。 */
  cur: Round | null = null;
  /** 剛結束的那一輪，讓「本輪 5 顆」在回到 COLLECT 之後還看得到。 */
  last: Round | null = null;

  private inShoot = false;
  private ref = 0;
  private inDip = false;
  private dipT = 0;
  private lastT = 0;

  reset(): void {
    this.rounds = [];
    this.cur = null;
    this.last = null;
    this.inShoot = false;
    this.inDip = false;
  }

  /**
   * @param t        機器人時戳（秒）
   * @param state    /FGC/Drive/State
   * @param sl       /FGC/Shooter/SL
   * @param spinupMs /FGC/Shooter/SpinupMs（機器人端 latch，不是前端算的）
   */
  update(t: number, state: string, sl: number, spinupMs: number): void {
    const dt = this.lastT > 0 ? Math.max(0, t - this.lastT) : 0;
    this.lastT = t;

    if (state === "SHOOT") {
      if (!this.inShoot) {
        this.inShoot = true;
        this.cur = { start: t, balls: [], spinupMs: null };
        this.ref = sl;
        this.inDip = false;
      }
      const cur = this.cur;
      if (!cur) return;

      if (cur.spinupMs === null && spinupMs > 0) cur.spinupMs = spinupMs;

      if (this.inDip) {
        if (sl > this.ref - DIP_RECOVER) {
          this.inDip = false;
          cur.balls.push(this.dipT);
          this.ref = Math.max(this.ref, sl);
        }
      } else if (sl < this.ref - DIP_DEPTH) {
        this.inDip = true;
        this.dipT = t;
      } else {
        // 參考值追高、緩慢追低：目標被調小時不該一直卡在舊高點
        this.ref = Math.max(sl, this.ref - REF_DECAY_TPS_PER_S * dt);
      }
      return;
    }

    if (this.inShoot) {
      this.inShoot = false;
      this.inDip = false;
      if (this.cur) {
        this.last = this.cur;
        this.rounds.push(this.cur);
        if (this.rounds.length > MAX_ROUNDS) this.rounds.shift();
      }
      this.cur = null;
    }
  }

  /** 顯示用的那一輪：正在射的優先，否則是剛射完的。 */
  shown(): Round | null {
    return this.cur ?? this.last;
  }

  /** 最近一顆與前一顆的間隔（秒）；不足兩顆回 null。 */
  lastInterval(): number | null {
    const r = this.shown();
    if (!r || r.balls.length < 2) return null;
    return r.balls[r.balls.length - 1] - r.balls[r.balls.length - 2];
  }

  /** 各輪的 spin-up（毫秒），最新在最後。 */
  spinups(): number[] {
    const out: number[] = [];
    for (const r of this.rounds) if (r.spinupMs !== null) out.push(r.spinupMs);
    const c = this.cur?.spinupMs;
    if (typeof c === "number") out.push(c);
    return out;
  }
}

/** 模組單例：切到別的分頁再切回來時，球數與 spin-up 統計不會歸零。 */
export const rhythm = new RhythmTracker();
