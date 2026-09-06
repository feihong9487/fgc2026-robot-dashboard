// 錄影行數的趨勢取樣。
//
// 為什麼不能只看「現在幾行」：reclines 在真機是 flush 時才 addAndGet
// （DashRec.java:222，FLUSH_MS = 10000），假伺服器也照抄了同一個節奏。
// 所以它是每 10 秒跳一階的階梯，不是連續爬的斜線。任何小於 30 秒的視窗
// 都會有三分之二的時間看到「delta = 0」而誤判成「錄影停了」。
//
// 這支 hook 只讀 client.link.health（RobotClient 已經每 3 秒輪詢一次），
// 不自己再開一條 fetch——同一份資料抓兩次只會讓賽場 Wi-Fi 更擠。

import { useEffect } from "react";
import { useLink, useTick } from "../../lib/hooks";
import { EMPTY_TREND, REC_WINDOW_S, type RecTrend } from "./checks";

interface Sample {
  at: number;
  lines: number;
}

/** 保留視窗略長於判定窗，讓 windowS 穩定落在 30 s 附近。 */
const KEEP_MS = (REC_WINDOW_S + 12) * 1000;

/**
 * 樣本環放在模組層級。
 *
 * 兩個理由。(1) render 必須是純函式：React 18 在 concurrent 下可以 render 完就丟棄
 * 結果（transition 被打斷、Suspense 重試、StrictMode 雙重 render），在 render 期間
 * push/shift 一個 ref 會讓樣本被記進去而那次 render 從來沒 commit。這支 hook 的輸出
 * 正是「錄影還活著嗎」的判定依據，也就是比賽日唯一有價值的產出的存活證明——用一個
 * 會在 concurrent 下失真的機制去回答它，代價與收益不成比例。
 * (2) HealthWall 與 RecHeartbeat 兩個地方要用同一份趨勢，各自維護一份 ref 本來就是
 * 重複的（而且兩份的取樣時機不同，delta 會不一樣）。
 */
const samples: Sample[] = [];

function note(at: number, lines: number): void {
  const last = samples[samples.length - 1];
  // 同一次 health 回應不重複記；healthAt 是它的身分證
  if (last && last.at === at) return;
  samples.push({ at, lines });
  const now = Date.now();
  while (samples.length > 1 && now - samples[0].at > KEEP_MS) samples.shift();
}

/**
 * @param tickMs 額外的強制重繪週期；傳 0 表示呼叫端自己會重繪。
 */
export function useRecTrend(tickMs = 1000): RecTrend {
  const link = useLink();
  useTick(tickMs > 0 ? tickMs : 60_000);

  const h = link.health;
  // 取樣是副作用，只在 commit 之後做
  useEffect(() => {
    if (h?.kind === "ok" && link.healthAt > 0) note(link.healthAt, h.info.recLines);
    // 8080 斷了：舊樣本會讓 delta 看起來還在動，寧可回到「不知道」
    else if (h && h.kind !== "ok") samples.length = 0;
  }, [h, link.healthAt]);

  const arr = samples;
  if (arr.length === 0) return EMPTY_TREND;
  const first = arr[0];
  const last = arr[arr.length - 1];
  const windowS = (last.at - first.at) / 1000;
  if (arr.length < 2 || windowS <= 0) {
    return { lines: last.lines, delta: NaN, windowS: 0, rate: NaN };
  }
  const delta = last.lines - first.lines;
  return { lines: last.lines, delta, windowS, rate: delta / windowS };
}
