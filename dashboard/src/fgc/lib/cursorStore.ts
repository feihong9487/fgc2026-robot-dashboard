// cursorStore：時間游標的唯一真相。
//
// 與 LogStore 分開不是潔癖，是正確性問題：滑鼠移動（60 Hz）不該重設使用者選定的時刻，
// 而資料進來（20 Hz）也不該把游標拖走。三個狀態各有各的更新頻率與訂閱者：
//
//   hoverT   60 Hz，不寫入歷史，只驅動十字線與 Inspector 的「懸停」欄
//            → 同步呼叫訂閱者，直接寫 canvas / textContent，不進 React state
//   cursorT  點擊 / 播放 / 快捷鍵設定，持久，驅動 Inspector 主欄、事件高亮、統計區間
//            → rAF 合批後廣播，配 useSyncExternalStore
//   liveLock true 時 cursorT 恆等於 tail 且不可拖；往左捲即 false
//
// uPlot 的 cursor.sync 只是被驅動方：DiscreteBand、時序帶、Inspector、場地圖都不是
// uPlot，不能讓 uPlot 當協調者。

export interface Selection {
  t0: number;
  t1: number;
}

class CursorStore {
  /** 懸停時刻；null = 滑鼠不在任何圖上。刻意是公開欄位，讓 rAF 迴圈直接讀。 */
  hoverT: number | null = null;

  private _cursorT = 0;
  private _selection: Selection | null = null;
  private _playRate = 1;
  private _playing = false;
  private _liveLock = true;
  private _version = 0;

  private listeners = new Set<() => void>();
  private hoverListeners = new Set<(t: number | null) => void>();
  private scheduled = false;

  get cursorT(): number {
    return this._cursorT;
  }

  get selection(): Selection | null {
    return this._selection;
  }

  get playRate(): number {
    return this._playRate;
  }

  get playing(): boolean {
    return this._playing;
  }

  get liveLock(): boolean {
    return this._liveLock;
  }

  // ── hover（不進 React）──────────────────────────────────────────────

  setHover(t: number | null): void {
    if (t === this.hoverT) return;
    this.hoverT = t;
    this.hoverListeners.forEach((fn) => {
      try {
        fn(t);
      } catch {
        /* 一個訂閱者丟例外不該讓其餘的收不到 */
      }
    });
  }

  onHover(fn: (t: number | null) => void): () => void {
    this.hoverListeners.add(fn);
    return () => {
      this.hoverListeners.delete(fn);
    };
  }

  // ── cursor（進 React）──────────────────────────────────────────────

  /** 使用者點擊 / 播放推進。fromUser=true 會脫離 live lock。 */
  setCursor(t: number, fromUser = false): void {
    if (fromUser && this._liveLock) this._liveLock = false;
    if (this._cursorT === t) return;
    this._cursorT = t;
    this.emit();
  }

  /** 即時模式下由資料尾端推著走；live lock 關掉時不動游標。 */
  followTail(tailT: number): void {
    if (!this._liveLock) return;
    if (this._cursorT === tailT) return;
    this._cursorT = tailT;
    this.emit();
  }

  setSelection(sel: Selection | null): void {
    if (sel && sel.t1 < sel.t0) sel = { t0: sel.t1, t1: sel.t0 };
    this._selection = sel;
    this.emit();
  }

  setSelectionStart(t: number): void {
    const t1 = this._selection ? this._selection.t1 : t;
    this.setSelection({ t0: t, t1: Math.max(t, t1) });
  }

  setSelectionEnd(t: number): void {
    const t0 = this._selection ? this._selection.t0 : t;
    this.setSelection({ t0: Math.min(t0, t), t1: t });
  }

  setPlayRate(r: number): void {
    if (this._playRate === r) return;
    this._playRate = r;
    this.emit();
  }

  setPlaying(p: boolean): void {
    if (this._playing === p) return;
    this._playing = p;
    this.emit();
  }

  /** 回到即時：捲到最右或按 L。 */
  setLiveLock(on: boolean): void {
    if (this._liveLock === on) return;
    this._liveLock = on;
    this.emit();
  }

  reset(t = 0): void {
    this._cursorT = t;
    this._selection = null;
    this._playing = false;
    this._playRate = 1;
    this.hoverT = null;
    this.emit();
  }

  // ── 訂閱 ────────────────────────────────────────────────────────────

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
          /* 同上 */
        }
      });
    };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
    else setTimeout(run, 16);
  }
}

export const cursor = new CursorStore();
