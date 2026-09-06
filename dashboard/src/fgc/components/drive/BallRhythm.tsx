// #14 BallRhythm —— 球節奏。
//
// 一排圓點回答「這一輪射了幾顆」、間隔回答「順不順」、spin-up 回答「起步慢不慢」。
// 括號裡的中位／最大是關鍵：spin-up 380 ms 聽起來很好，但如果最大值是 900 ms，
// 那代表有幾次幾乎浪費掉一個射擊窗口，而只看即時數字永遠看不到那幾次。
//
// 空心圓只是版面留位（避免每射一顆整條列就變寬），**不代表球倉容量**——
// HopperSystem 用 CRServo，機器人端根本不知道裡面有幾顆球。

import { useRef, useState } from "react";
import { liveLog } from "../../lib/LogStore";
import { K } from "../../lib/fgcKeys";
import { percentile } from "../../lib/stats";
import { PanelShell } from "../shell/PanelShell";
import { useFrame } from "./canvas";
import { rhythm, DIP_DEPTH } from "./rhythm";

const SLOTS = 8;

export function BallRhythm() {
  const [, bump] = useState(0);
  const sig = useRef("");

  // 30 Hz 餵偵測器；只有「顯示出來的那幾個數字」變了才叫 React。
  useFrame(() => {
    const log = liveLog;
    const t = log.latestNum(K.matchS, log.tMax);
    rhythm.update(t, log.latestStr(K.driveState, ""), log.latestNum(K.sl, 0), log.latestNum(K.spinupMs, 0));
    const r = rhythm.shown();
    const s = `${r?.balls.length ?? -1}|${rhythm.lastInterval()?.toFixed(2) ?? ""}|${rhythm.spinups().length}|${r?.spinupMs ?? ""}`;
    if (s !== sig.current) {
      sig.current = s;
      bump((n) => n + 1);
    }
  }, 30);

  const r = rhythm.shown();
  const n = r?.balls.length ?? 0;
  const gap = rhythm.lastInterval();
  const ups = rhythm.spinups();
  const med = ups.length ? percentile(ups, 0.5) : NaN;
  const mx = ups.length ? Math.max(...ups) : NaN;
  const cur = r?.spinupMs ?? null;

  return (
    <PanelShell
      title="球節奏"
      note={`dip 為前端推估：跌破深度大於 ${DIP_DEPTH} tps 才算一顆，解析度 ±50 ms`}
      flush
      className="drive-rhythm"
    >
      <div className="rhythm-box">
        <div className="rhythm-line">
          <span className="rl-label">本輪</span>
          <span className="rl-dots" title="空心圓只是版面留位，不代表球倉容量">
            {Array.from({ length: SLOTS }, (_, i) => (
              // fgc-glyph：●○ 一律走 --font-ui 的 1.25em 固定寬容器。
              // 等寬字體多半沒有這兩個 CJK 符號，fallback 後寬度不一致，整排就對不齊。
              <span key={i} className={i < n ? "fgc-glyph dot on" : "fgc-glyph dot"}>
                {i < n ? "●" : "○"}
              </span>
            ))}
          </span>
          <span className="rl-count fgc-num">{n}</span>
          <span className="fgc-unit">顆</span>
          <span className="rl-gap">
            節奏 <b className="fgc-num">{gap === null ? "—" : gap.toFixed(2)}</b>
            <span className="fgc-unit">s</span>
          </span>
        </div>
        <div className="rhythm-line dim">
          <span className="rl-label">spin-up</span>
          <b className="fgc-num">{cur === null ? "—" : Math.round(cur)}</b>
          <span className="fgc-unit">ms</span>
          <span className="rl-stat">
            <span className="rs-item">
              中位 <span className="fgc-num">{Number.isFinite(med) ? Math.round(med) : "—"}</span>
            </span>
            <span className="rs-item">
              最大 <span className="fgc-num">{Number.isFinite(mx) ? Math.round(mx) : "—"}</span>
            </span>
            <span className="rs-item">
              <span className="fgc-num">{ups.length}</span> 輪
            </span>
          </span>
        </div>
      </div>
    </PanelShell>
  );
}
