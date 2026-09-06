// viewWindow：所有時間視圖共用的 [t0, t1]。
//
// 為什麼要第三個 store（LogStore = 資料、cursorStore = 游標、這裡 = 視窗）：
// LineGraph、DiscreteBand、TimeBar 必須永遠對齊同一段時間，否則「上下同一條 x 軸」
// 這個 AdvantageScope 的核心洞見就破了——色帶顯示 40–60 s、折線顯示 42–62 s 的話，
// 「按了 R2 但 hopper 還關著」的錯開色塊會變成一個看不出來的假象。
// 所以視窗不是每張圖各自的 state，是一份被大家讀的真相（§4.2、§5.2）。
//
// 與 cursorStore 分開的理由同樣是頻率：視窗在滾輪縮放時每格都動，游標在滑鼠移動時
// 每幀都動，兩者的訂閱者不重疊（Inspector 只在乎游標、色帶只在乎視窗）。
//
// live lock 住在這裡而不是 cursorStore：脫離即時的動作是「往左捲」，那是視窗行為。
// cursorStore.liveLock 仍是對外的旗標，這裡負責在兩邊之間保持一致。

import { cursor } from "../../lib/cursorStore";

/** 最小視窗：再小就只剩兩個推播週期（PERIOD_MS=50），沒有可讀性。 */
export const MIN_SPAN = 0.25;
export const MAX_SPAN = 3600;

/** 判定「已經捲到最右」的容差；小於一個推播週期就算貼齊。 */
const TAIL_EPS = 0.05;

/** 視窗長度的預設選項（§4.2 頂部「窗 20s ▾」）。 */
export const SPAN_CHOICES: readonly number[] = [5, 10, 20, 60, 150];

class ViewWindow {
  private _t0 = 0;
  private _t1 = 20;
  private _span = 20;
  private _follow = true;
  private _tMin = 0;
  private _tMax = 0;
  private _version = 0;

  private listeners = new Set<() => void>();
  private scheduled = false;

  get t0(): number {
    return this._t0;
  }

  get t1(): number {
    return this._t1;
  }

  get span(): number {
    return this._span;
  }

  /** 資料尾端是否推著視窗走。往左捲即 false，捲到最右或按 L 自動接回。 */
  get follow(): boolean {
    return this._follow;
  }

  get tMin(): number {
    return this._tMin;
  }

  get tMax(): number {
    return this._tMax;
  }

  /** 資料的全長；TimeBar 的總覽層永遠畫這一段，不隨縮放改變。 */
  setBounds(tMin: number, tMax: number): void {
    if (!Number.isFinite(tMin) || !Number.isFinite(tMax)) return;
    const changed = tMin !== this._tMin || tMax !== this._tMax;
    this._tMin = tMin;
    this._tMax = tMax;
    if (this._follow) {
      // 資料比視窗短的時候不要留一大片空白：從頭鋪滿。
      const t1 = tMax;
      const t0 = Math.max(tMin, t1 - this._span);
      this.assign(t0, t1);
    } else if (changed) {
      this.emit();
    }
  }

  setSpan(sec: number): void {
    const s = Math.min(MAX_SPAN, Math.max(MIN_SPAN, sec));
    if (s === this._span) return;
    this._span = s;
    if (this._follow) {
      this.assign(Math.max(this._tMin, this._t1 - s), this._t1);
    } else {
      // 不跟隨時以中心為錨：使用者正在看的那一段不會跑掉。
      const c = (this._t0 + this._t1) / 2;
      this.assign(c - s / 2, c + s / 2);
    }
  }

  setWindow(t0: number, t1: number): void {
    if (!Number.isFinite(t0) || !Number.isFinite(t1)) return;
    const lo = Math.min(t0, t1);
    const hi = Math.max(t0, t1);
    this._span = Math.min(MAX_SPAN, Math.max(MIN_SPAN, hi - lo));
    this.assign(lo, lo + this._span);
    this.reconcileFollow();
  }

  /** 平移。dt > 0 往未來走。 */
  panBy(dt: number): void {
    if (!dt) return;
    this.assign(this._t0 + dt, this._t1 + dt);
    this.reconcileFollow();
  }

  /**
   * 以 tAt 為中心縮放。factor > 1 是拉遠。
   * 以游標為中心而不是以視窗中心，這樣「對著那一顆球滾輪放大」才不會把它捲出畫面。
   */
  zoomAt(tAt: number, factor: number): void {
    const span = Math.min(MAX_SPAN, Math.max(MIN_SPAN, this._span * factor));
    if (span === this._span) return;
    const anchor = Math.min(this._t1, Math.max(this._t0, tAt));
    const ratio = this._span > 0 ? (anchor - this._t0) / this._span : 0.5;
    this._span = span;
    this.assign(anchor - ratio * span, anchor + (1 - ratio) * span);
    this.reconcileFollow();
  }

  /** 縮放到某一段（Ctrl+\ 縮放到 RUN 區間、雙擊選區）。 */
  zoomTo(t0: number, t1: number, padRatio = 0.05): void {
    const lo = Math.min(t0, t1);
    const hi = Math.max(t0, t1);
    const pad = Math.max(MIN_SPAN * 0.1, (hi - lo) * padRatio);
    this.setWindow(lo - pad, hi + pad);
  }

  setFollow(on: boolean): void {
    if (this._follow === on) return;
    this._follow = on;
    cursor.setLiveLock(on);
    if (on) {
      this.assign(Math.max(this._tMin, this._tMax - this._span), this._tMax);
    } else {
      this.emit();
    }
  }

  /** 整份資料換掉（載入回放檔、clear）時呼叫。 */
  reset(tMin = 0, tMax = 0, follow = true): void {
    this._tMin = tMin;
    this._tMax = tMax;
    this._follow = follow;
    cursor.setLiveLock(follow);
    const t1 = follow ? tMax : Math.min(tMax, tMin + this._span);
    this.assign(Math.max(tMin, t1 - this._span), t1);
  }

  // ── 內部 ────────────────────────────────────────────────────────────

  /** 往右捲到底就自動接回即時；往左離開就熄燈。省掉一顆「回到即時」按鈕。 */
  private reconcileFollow(): void {
    const atTail = this._t1 >= this._tMax - TAIL_EPS;
    if (atTail !== this._follow) {
      this._follow = atTail;
      cursor.setLiveLock(atTail);
    }
  }

  private assign(t0: number, t1: number): void {
    if (t0 === this._t0 && t1 === this._t1) return;
    this._t0 = t0;
    this._t1 = t1;
    this.emit();
  }

  // ── 訂閱（snapshot 一律 primitive）──────────────────────────────────

  getVersion = (): number => this._version;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  private emit(): void {
    this._version++;
    if (this.scheduled) return;
    this.scheduled = true;
    const run = () => {
      this.scheduled = false;
      this.listeners.forEach((fn) => {
        try {
          fn();
        } catch {
          /* 一個訂閱者丟例外不該讓其餘的收不到 */
        }
      });
    };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
    else setTimeout(run, 16);
  }
}

export const view = new ViewWindow();
