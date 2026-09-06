// 錄影行數的趨勢取樣。
//
// 為什麼不能只看「現在幾行」：reclines 在真機是 flush 時才 addAndGet
// （DashRec.java:222，FLUSH_MS = 10000），假伺服器也照抄了同一個節奏。
// 所以它是每 10 秒跳一階的階梯，不是連續爬的斜線。任何小於 30 秒的視窗
// 都會有三分之二的時間看到「delta = 0」而誤判成「錄影停了」。
//
// 這支 hook 只讀 client.link.health（RobotClient 已經每 3 秒輪詢一次），
// 不自己再開一條 fetch——同一份資料抓兩次只會讓賽場 Wi-Fi 更擠。

import { useRef } from "react";
import { useLink, useTick } from "../../lib/hooks";
import { EMPTY_TREND, REC_WINDOW_S, type RecTrend } from "./checks";

interface Sample {
  at: number;
  lines: number;
}

/** 保留視窗略長於判定窗，讓 windowS 穩定落在 30 s 附近。 */
const KEEP_MS = (REC_WINDOW_S + 12) * 1000;

/**
 * @param tickMs 額外的強制重繪週期；傳 0 表示呼叫端自己會重繪。
 */
export function useRecTrend(tickMs = 1000): RecTrend {
  const link = useLink();
  useTick(tickMs > 0 ? tickMs : 60_000);
  const samples = useRef<Sample[]>([]);

  const h = link.health;
  const now = Date.now();

  if (h?.kind === "ok" && link.healthAt > 0) {
    const arr = samples.current;
    const last = arr[arr.length - 1];
    // 同一次 health 回應不重複記；healthAt 是它的身分證
    if (!last || last.at !== link.healthAt) {
      arr.push({ at: link.healthAt, lines: h.info.recLines });
      while (arr.length > 1 && now - arr[0].at > KEEP_MS) arr.shift();
    }
  } else if (h && h.kind !== "ok") {
    // 8080 斷了：舊樣本會讓 delta 看起來還在動，寧可回到「不知道」
    samples.current.length = 0;
  }

  const arr = samples.current;
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
