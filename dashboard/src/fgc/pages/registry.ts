// 分頁註冊表。
//
// 每個分頁自己 export 一個 PageDef，這裡只負責登記與順序。
// 順序就是比賽日的使用順序：練習跑最常開駕駛，上場前 30 秒開檢查。
//
// §8 M01 措施 5：RunPanel / DebugPanel / LockerPanel / PathPlanPanel / PathTestPanel
// 這些 VMX 專用面板不得進入這張表（它們已在本專案整支刪除，連引誘都不留）。

import type { ComponentType } from "react";
import { DrivePage } from "./DrivePage";
import { HealthPage } from "./HealthPage";
import { RecPage } from "./RecPage";
import { GraphDemoPage } from "./GraphDemoPage";
import { SignalsPage } from "./SignalsPage";

export interface PageDef {
  id: string;
  label: string;
  /** 單鍵快捷（§5.1）。MATCH 下整組停用。 */
  hotkey: string;
  Component: ComponentType;
  /** 滑鼠移上去的一行說明。 */
  hint?: string;
  /** 這一頁需要的最小視窗寬度；不足時顯示降級提示而不是擠爆版面。 */
  minWidth?: number;
}

/** PIT 分頁（MATCH 下這張表在 UI 上不存在）。後續階段各自 push 進來。 */
export const PIT_PAGES: PageDef[] = [
  DrivePage, // ① 駕駛 DRIVE   D  —— 練習跑最常打開的一頁，所以它排第一（也是預設分頁）
  // ② 射手         S  —— 第二階段 B
  // ③ 參數         T  —— 第二階段 B
  HealthPage, // ④ 檢查   C
  RecPage, //     選檔     R  —— §5.1「進入 REPLAY（選檔）」的實作
  // ⑤ 視覺         V  —— 條件項（§9 第一刀）
  GraphDemoPage, // 圖表   G  —— 第二階段 C 的組裝驗收頁（射手／REPLAY 兩頁會沿用它的組裝方式）
  SignalsPage, // ⑥ 訊號   A
];

export function findPage(id: string | null | undefined): PageDef | undefined {
  if (!id) return undefined;
  return PIT_PAGES.find((p) => p.id === id);
}

export function pageByHotkey(key: string): PageDef | undefined {
  const k = key.toUpperCase();
  return PIT_PAGES.find((p) => p.hotkey.toUpperCase() === k);
}
