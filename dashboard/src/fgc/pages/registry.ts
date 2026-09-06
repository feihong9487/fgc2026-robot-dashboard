// 分頁註冊表。
//
// 每個分頁自己 export 一個 PageDef，這裡只負責登記與順序。
// 順序就是比賽日的使用順序：練習跑最常開駕駛，上場前 30 秒開檢查。
//
// §8 M01 措施 5：RunPanel / DebugPanel / LockerPanel / PathPlanPanel / PathTestPanel
// 這些 VMX 專用面板不得進入這張表（它們已在本專案整支刪除，連引誘都不留）。
//
// hidden 的意思是「不在分頁列上，但快捷鍵與 ?tab= 到得了」。
// 兩種東西該 hidden：
//   · 錄影選檔（R）——它是 §5.1 的一個「動作」而不是一個要常駐的分頁
//   · 圖表組裝驗收頁（G）——第二階段 C 的驗收頁，賽場上沒有人要看它
// 刪掉它們會少掉一條驗證路徑；留在分頁列上會多出兩個賽場上按錯的機會。

import type { ComponentType } from "react";
import { DrivePage } from "./DrivePage";
import { ShooterPage } from "./ShooterPage";
import { TunePage } from "./TunePage";
import { HealthPage } from "./HealthPage";
import { SignalsPage } from "./SignalsPage";
import { RecPage } from "./RecPage";
import { GraphDemoPage } from "./GraphDemoPage";

export interface PageDef {
  id: string;
  label: string;
  /** 單鍵快捷（§5.1）。MATCH 下整組停用。 */
  hotkey: string;
  Component: ComponentType;
  /** 滑鼠移上去的一行說明。 */
  hint?: string;
  /** 這一頁需要的最小視窗寬度；不足時分頁列上標記，頁面自己顯示降級提示。 */
  minWidth?: number;
  /** 不列在分頁列上（快捷鍵與 ?tab= 仍到得了）。 */
  hidden?: boolean;
}

/**
 * PIT 分頁（MATCH 下這張表在 UI 上不存在）。
 * 前五個是 §2.2 的分頁列；後兩個 hidden。
 */
export const PIT_PAGES: PageDef[] = [
  DrivePage, //   ① 駕駛 D —— 練習跑最常打開的一頁，所以它排第一（也是預設分頁）
  ShooterPage, // ② Shooter S
  TunePage, //    ③ 參數 T
  HealthPage, //  ④ 檢查 C
  // ⑤ 視覺 V —— 條件項（§9 第一刀），v1 不做
  SignalsPage, // ⑥ 訊號 A
  RecPage, //     選檔 R —— §5.1「進入 REPLAY（選檔）」的實作，不佔分頁列
  GraphDemoPage, // 圖表 G —— 第二階段 C 的組裝驗收頁，?tab=graphdemo 才進得去
];

/** 分頁列上真的畫出來的那幾個。 */
export const TAB_PAGES: PageDef[] = PIT_PAGES.filter((p) => !p.hidden);

export function findPage(id: string | null | undefined): PageDef | undefined {
  if (!id) return undefined;
  return PIT_PAGES.find((p) => p.id === id);
}

export function pageByHotkey(key: string): PageDef | undefined {
  const k = key.toUpperCase();
  return PIT_PAGES.find((p) => p.hotkey.toUpperCase() === k);
}
