// DRIVE 分頁的共用讀值層：只訂閱 14 個 key，狀態推導只有這一份。
//
// 每個 widget 各自 rAF 讀 LogStore，但「現在是哪一態」必須全頁一致——
// 巨燈說 READY、狀態膠囊說 SHOOT、按鍵燈條說 RT 沒按，這種互相矛盾的畫面
// 比沒有畫面更糟。所以推導寫在這裡，四個元件共用同一支函式。

import { LogStore } from "../../lib/LogStore";
import { K, paramKey, tunable } from "../../lib/fgcKeys";
import { useWindowWidth } from "../../lib/hooks";

/** §7.5 第 10 點：DRIVE 掛零張 uPlot，只訂閱這些 key。 */
export const DRIVE_KEYS: readonly string[] = [
  K.driveState,
  K.driveReversed,
  K.driveForward,
  K.driveTurn,
  K.sl,
  K.sr,
  K.targetL,
  K.targetR,
  K.atSpeed,
  K.spinupMs,
  K.climbPos,
  K.climbHolding,
  K.climbOverCurrent,
  K.hopperCmd,
  K.matchS,
];

/** 巨燈四態。字串本身是 ASCII，因為它同時是畫在巨燈上的那個字。 */
export type ShotState = "IDLE" | "SPINUP" | "READY" | "EJECT";

/**
 * 四態推導（§3.2 #7）。
 * EJECT 優先於一切：那是唯一「機器人正在把球吐出來」的狀態，看錯的代價最高。
 */
export function shotStateOf(log: LogStore): ShotState {
  const st = log.latestStr(K.driveState, "");
  if (st === "EJECT") return "EJECT";
  if (st === "SHOOT") return log.latestBool(K.atSpeed) ? "READY" : "SPINUP";
  return "IDLE";
}

/**
 * spin-up 進度：min(SL,SR) / min(TargetL,TargetR)。
 * 目標為 0（COLLECT 期的 IDLE_TPS=0）時回 null——除以零的 100% 是假的。
 */
export function spinProgress(log: LogStore): number | null {
  const tgt = Math.min(log.latestNum(K.targetL, NaN), log.latestNum(K.targetR, NaN));
  if (!Number.isFinite(tgt) || tgt <= 0) return null;
  const cur = Math.min(log.latestNum(K.sl, 0), log.latestNum(K.sr, 0));
  return Math.max(0, Math.min(1, cur / tgt));
}

export interface ThresholdRead {
  /** null = 機器人還沒回讀過這個參數。 */
  v: number | null;
  /** param = /FGC/Param/ 回讀值；build = Constants 編譯預設（只能當灰字提示）。 */
  from: "param" | "build";
}

/**
 * FEED_THRESHOLD 一律讀 /FGC/Param/ 的回讀值，**不可寫死 1200**（§3.3 #18）。
 * 沒回讀到就明講是編譯預設，畫成灰色虛線而不是假裝知道。
 */
export function feedThreshold(log: LogStore): ThresholdRead {
  const v = log.latest.get(paramKey("FEED_THRESHOLD"));
  if (typeof v === "number") return { v, from: "param" };
  return { v: tunable("FEED_THRESHOLD")?.def ?? null, from: "build" };
}

/** 狀態機三態 → CSS token 名（DiscreteBand / StateRibbon / 事件軌共用同一組）。 */
export function stateColor(st: string, p: { stateCollect: string; stateShoot: string; stateEject: string; stale: string }): string {
  if (st === "COLLECT") return p.stateCollect;
  if (st === "SHOOT") return p.stateShoot;
  if (st === "EJECT") return p.stateEject;
  return p.stale;
}

// ── 降級斷點（§4.7）────────────────────────────────────────────────────
//
// 用 matchMedia 真的把元件 unmount，而不是 display:none：隱藏的 canvas 一樣會
// 跑 rAF，1366×768 的舊筆電正是最沒有 CPU 可以浪費的那一台。

export type Bp = "xl" | "lg" | "md" | "sm";

function bpOf(w: number): Bp {
  if (w >= 1440) return "xl";
  if (w >= 1200) return "lg";
  if (w >= 1024) return "md";
  return "sm";
}

/**
 * 斷點從共用的 useWindowWidth 衍生（帶 100 ms debounce），不再自己掛第三個
 * 沒有 debounce 的 resize 監聽器。拖視窗邊框時每一個事件都會讓 App 整棵樹與
 * DrivePage 的斷點一起重繪，而底下還有十幾個 rAF Canvas 迴圈在跑。
 */
export function useBreakpoint(): Bp {
  return bpOf(useWindowWidth());
}

/** 固定寬度的 tps 顯示：值變動時右邊的東西不可以左右晃。 */
export function tps(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return String(Math.round(v));
}

export function mmss(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}
