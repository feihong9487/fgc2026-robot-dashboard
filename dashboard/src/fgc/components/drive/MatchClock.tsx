// #13 MatchClock —— 色碼倒數。
//
// **起算點必須用機器人端的 /FGC/Status/Match s，前端不可自己按碼表**：
// 那個值是 (now - DashHub.t0()) / 1000，而 t0 由 DashBridge.onOpModePreStart 設，
// 也就是「駕駛按下 START 的那一刻」。前端自己數會在斷線重連後直接錯開好幾秒。
//
// 誠實條款：練習跑的 OpMode 會跑超過 150 秒，這時剩餘時間是負的。
// 我們不假裝比賽還在進行，直接顯示「超時 +m:ss」並轉灰——把倒數扭曲成 0:00
// 會讓人以為練習跑跟比賽一樣長。
//
// 門檻的意義：黃 = 剩下的時間剛好夠爬升 +5 秒緩衝、紅 = 只剩爬升時間。
// 爬升耗時是隊伍自己量出來的，存 localStorage（參數頁之後會給一個地方改）。

import { useRef } from "react";
import { liveLog } from "../../lib/LogStore";
import { K } from "../../lib/fgcKeys";
import * as persist from "../../lib/persist";
import { PanelShell } from "../shell/PanelShell";
import { useFrame } from "./canvas";
import { mmss } from "./driveModel";

export interface MatchClockCfg {
  /** 一場的長度（秒）。FGC TELEOP 是 2:30。 */
  matchSec: number;
  /** 爬升耗時（秒）：紅色門檻就是它，黃色是它 +5。 */
  climbSec: number;
}

export const MATCH_CLOCK_DEFAULT: MatchClockCfg = { matchSec: 150, climbSec: 20 };

export function matchClockCfg(): MatchClockCfg {
  const c = persist.get<Partial<MatchClockCfg>>(persist.KEYS.matchClock, {});
  return {
    matchSec: typeof c.matchSec === "number" && c.matchSec > 0 ? c.matchSec : MATCH_CLOCK_DEFAULT.matchSec,
    climbSec: typeof c.climbSec === "number" && c.climbSec >= 0 ? c.climbSec : MATCH_CLOCK_DEFAULT.climbSec,
  };
}

type Zone = "early" | "mid" | "climb" | "last" | "over" | "none";

export function clockZone(elapsed: number, cfg: MatchClockCfg): Zone {
  if (!Number.isFinite(elapsed)) return "none";
  const left = cfg.matchSec - elapsed;
  if (left <= 0) return "over";
  if (left <= cfg.climbSec) return "last";
  if (left <= cfg.climbSec + 5) return "climb";
  if (elapsed < 30) return "early";
  return "mid";
}

export function MatchClock() {
  const cfg = useRef(matchClockCfg()).current;
  const box = useRef<HTMLDivElement>(null);
  const big = useRef<HTMLSpanElement>(null);
  const sub = useRef<HTMLSpanElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const last = useRef({ txt: "", zone: "" as string });

  // 秒級解析度，8 Hz 就夠；沒有必要一秒重排 60 次版面。
  useFrame(() => {
    const hasT = liveLog.latest.has(K.matchS);
    const el = liveLog.latestNum(K.matchS, NaN);
    const zone = hasT ? clockZone(el, cfg) : "none";
    const left = cfg.matchSec - el;
    const txt = !hasT || !Number.isFinite(el) ? "—:—" : left >= 0 ? mmss(left) : `+${mmss(-left)}`;
    const frac = !Number.isFinite(el) ? 0 : Math.max(0, Math.min(1, el / cfg.matchSec));

    if (big.current && last.current.txt !== txt) {
      big.current.textContent = txt;
      last.current.txt = txt;
    }
    if (bar.current) bar.current.style.width = `${(frac * 100).toFixed(1)}%`;
    if (box.current && last.current.zone !== zone) {
      box.current.className = `clock-box z-${zone}`;
      last.current.zone = zone;
      if (sub.current) {
        sub.current.textContent =
          zone === "over"
            ? "已超過一場的長度（練習跑）"
            : zone === "none"
              ? "尚未收到 Match s"
              : zone === "last"
                ? "只剩爬升時間"
                : zone === "climb"
                  ? "該準備爬升了"
                  : `TELEOP ${mmss(cfg.matchSec)}`;
      }
    }
  }, 8);

  return (
    <PanelShell title="比賽計時" note="來源 /FGC/Status/Match s（OpMode START 起算）" flush className="drive-clock">
      <div ref={box} className="clock-box z-none">
        <div className="clock-row">
          <span className="clock-glyph">⏱</span>
          <span ref={big} className="clock-big fgc-num">—:—</span>
          <span ref={sub} className="clock-sub">尚未收到 Match s</span>
        </div>
        <div className="clock-track">
          <div ref={bar} className="clock-fill" style={{ width: "0%" }} />
        </div>
      </div>
    </PanelShell>
  );
}
