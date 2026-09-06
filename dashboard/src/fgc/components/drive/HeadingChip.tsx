// #11 HeadingChip —— 車頭方向。
//
// reversed 開局預設 true（FGC2026_TeleOp_Match.java:225 `boolean reversed = true`，
// 註解明寫「reversed=true 表示吸取端為前」），而 □ 只反前後、不反轉向
// （:257 `if (reversed) forward = -forward;`）。這是新駕駛撞牆的頭號原因，
// 但在 Driver Hub 上它只是一行小字 `front: INTAKE`。
//
// 切換時整格閃 300 ms——這是全 App 只有三處動態之一（§6.7）：
// 車頭切換是「你按了 □ 而且它真的生效了」的唯一即時回饋。

import { useEffect, useRef, useState } from "react";
import { liveLog } from "../../lib/LogStore";
import { K } from "../../lib/fgcKeys";
import { useLogKeys } from "../../lib/hooks";
import { PanelShell } from "../shell/PanelShell";
import { useFrame } from "./canvas";

const HEAD_KEYS = [K.driveReversed];

export function HeadingChip() {
  useLogKeys(HEAD_KEYS);
  const reversed = liveLog.latestBool(K.driveReversed, true);
  const [flash, setFlash] = useState(false);
  const prev = useRef<boolean | null>(null);

  useEffect(() => {
    const changed = prev.current !== null && prev.current !== reversed;
    prev.current = reversed;
    if (!changed) return undefined;
    setFlash(true);
    const t = window.setTimeout(() => setFlash(false), 300);
    return () => window.clearTimeout(t);
  }, [reversed]);

  // forward / turn 是 20 Hz 的連續值：只改 textContent，不進 React。
  const fwdRef = useRef<HTMLSpanElement>(null);
  const turnRef = useRef<HTMLSpanElement>(null);
  useFrame(() => {
    const f = liveLog.latestNum(K.driveForward, 0);
    const t = liveLog.latestNum(K.driveTurn, 0);
    if (fwdRef.current) fwdRef.current.textContent = f.toFixed(2);
    if (turnRef.current) turnRef.current.textContent = t.toFixed(2);
  }, 12);

  return (
    <PanelShell title="車頭" flush className="drive-heading">
      <div className={`head-box${flash ? " flash" : ""}${reversed ? " intake" : " shooter"}`}>
        <span className="head-arrow">{reversed ? "◀◀" : "▶▶"}</span>
        <span className="head-word">{reversed ? "吸取端為前" : "射手端為前"}</span>
        <span className="head-sub fgc-num">
          前後 <span ref={fwdRef}>0.00</span> · 轉向 <span ref={turnRef}>0.00</span>
        </span>
      </div>
    </PanelShell>
  );
}
