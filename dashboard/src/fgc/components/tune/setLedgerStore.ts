// 寫回帳本的資料層（§3.3 #25 的儲存部分）。
//
// 為什麼要獨立成模組層級的 store 而不是 SetLedger 元件的 useState：
// 帳本要記的正是「我剛剛送出去的東西後來怎麼了」，而使用者在等回讀的那一秒
// 很可能已經切到別的分頁去看波形了。掛在元件裡的話，一 unmount 就把證據丟了。
//
// 這支在 import 時就掛上 client.onSetResult——registry 靜態 import 參數頁，
// 所以從 App 開機那一刻起每一筆 set（含被硬閘擋下的）都會被記下來。

import { client, type SetRecord } from "../../../lib/RobotClient";

const MAX = 50;

class SetLedgerStore {
  /** 由舊到新。 */
  records: readonly SetRecord[] = [];
  private version = 0;
  private listeners = new Set<() => void>();

  constructor() {
    client.onSetResult((r) => this.push(r));
  }

  /**
   * 前端自己擋下來的那一種（例如 G13 幾何上限）。
   * 它一樣要進帳本：使用者按了 Enter 而值沒動，就必須有一行說明是誰擋的。
   */
  pushLocal(r: SetRecord): void {
    this.push(r);
  }

  private push(r: SetRecord): void {
    const next = this.records.concat(r);
    this.records = next.length > MAX ? next.slice(next.length - MAX) : next;
    this.version++;
    this.listeners.forEach((fn) => fn());
  }

  /** 某個參數最近的一筆結果（TuneTable 的四態要靠它）。 */
  lastFor(name: string): SetRecord | undefined {
    for (let i = this.records.length - 1; i >= 0; i--) {
      if (this.records[i].name === name) return this.records[i];
    }
    return undefined;
  }

  clear(): void {
    this.records = [];
    this.version++;
    this.listeners.forEach((fn) => fn());
  }

  getVersion = (): number => this.version;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
}

export const setLedger = new SetLedgerStore();
