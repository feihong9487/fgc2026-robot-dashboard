// M11 的 REPLAY 時間閘（§8）。
//
// 規則：回放本身可退化成即時教練工具。所以對 coachRisk 欄位（/FGC/Vision/*、/FGC/Aim/*、
// TargetL/TargetR）加一道時間閘——**log 最後一批距現在 > 5 分鐘**（即「這不是正在進行的
// 比賽」）才顯示。閘沒開的時候是不 render，不是 disabled。
//
// 判定依據必須是可觀測狀態，不是「我按了某個按鈕」。這裡能觀測到的是**檔名裡的時戳**：
// DashRec 用 rec-yyyyMMdd-HHmmss.jsonl 命名（DashRec.java），儀表板自己匯出的是
// fgc-rec-<ISO>.jsonl（RobotClient.exportRecording）。兩種都解析；
// 解析不出來就**預設鎖住**——「不知道這份 log 是不是剛剛那一場」時，鎖住才是安全的那一邊。
//
// 刻意不提供任何「臨時開啟」的開關：留了就會有人在賽前一場想試試看（§8 M11）。

import { LogStore } from "../../lib/LogStore";
import { isCoachRiskKey } from "../../lib/fgcKeys";
import type { NtValue } from "../../../lib/store";

export const COACH_GATE_MS = 5 * 60 * 1000;

export interface GateState {
  /** true = coachRisk 欄位可以顯示。 */
  open: boolean;
  /** log 末批距現在的毫秒數；null = 判斷不出來。 */
  ageMs: number | null;
  /** 還要等多久才會開（毫秒）；null = 判斷不出來或已經開了。 */
  waitMs: number | null;
  /** 判定依據，直接顯示在畫面上。 */
  basis: string;
}

/**
 * 從檔名取「這份錄影開始的牆鐘時間」。
 *   rec-20261007-093412.jsonl            ← 機器人端 DashRec
 *   fgc-rec-2026-10-07-09-34-12.jsonl    ← 儀表板 exportRecording
 * 解析不出來回 null。
 */
export function parseRecStamp(name: string): number | null {
  const base = name.replace(/^.*[\\/]/, "");
  let m = /rec-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/.exec(base);
  if (!m) m = /rec-(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})/.exec(base);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const ms = new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s),
  ).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** 閘的狀態。now 由呼叫端傳（純函式，好測）。 */
export function coachGate(name: string, log: LogStore, now: number): GateState {
  const start = parseRecStamp(name);
  if (start === null) {
    return {
      open: false,
      ageMs: null,
      waitMs: null,
      basis: "檔名沒有 rec-yyyyMMdd-HHmmss 時戳，判斷不出這份 log 是不是正在進行的比賽 → 預設鎖住",
    };
  }
  const [t0, t1] = log.tRange;
  const span = Math.max(0, t1 - t0) * 1000;
  const endWall = start + span;
  const ageMs = now - endWall;
  const open = ageMs > COACH_GATE_MS;
  return {
    open,
    ageMs,
    waitMs: open ? null : Math.max(0, COACH_GATE_MS - ageMs),
    basis:
      "檔名時戳 " +
      fmtClock(start) +
      " + log 長度 " +
      (span / 1000).toFixed(1) +
      " s → 末批約 " +
      fmtClock(endWall) +
      "，距現在 " +
      fmtAge(ageMs),
  };
}

function fmtClock(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
}

export function fmtAge(ms: number): string {
  const s = ms / 1000;
  if (s < 0) return "還沒發生（" + Math.round(-s) + " s 後）";
  if (s < 90) return Math.round(s) + " 秒";
  if (s < 5400) return (s / 60).toFixed(1) + " 分鐘";
  return (s / 3600).toFixed(1) + " 小時";
}

/** 閘關著的時候這個 key 能不能顯示。 */
export function gateAllows(key: string, open: boolean): boolean {
  return open || !isCoachRiskKey(key);
}

/**
 * 閘關著時給 SignalTree 用的投影 log：只留通過閘的 key，一批（末批的值）。
 *
 * 為什麼是投影而不是「把樹整個藏起來」：藏起來的話這一頁在比賽當天就等於不能用，
 * 而 M11 要擋的只是那幾個 key。REPLAY 的 log 是靜態的，所以「一批 = 末批的值」
 * 與原本的樹顯示完全一致（樹本來就只顯示 latest）。
 */
export function projectLog(src: LogStore, open: boolean): LogStore {
  const out = new LogStore(src.name + "(M11)");
  const d: Record<string, NtValue> = {};
  src.latest.forEach((v, k) => {
    if (gateAllows(k, open)) d[k] = v;
  });
  out.applyBatch(d, src.tMax);
  return out;
}
