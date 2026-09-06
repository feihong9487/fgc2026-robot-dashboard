// #12 ClimbLadder —— 爬升階梯柱。
//
// 柱上刻的是 **50 / 110 / 130 / 150 分數線**而非 encoder counts：
// 隊長要的是「再上一格值 20 分」，沒有人在賽末 15 秒還能把 2,900 counts 換算成分數。
//
// **不做「HOLD 已改需重新進入保持」黃燈**：ClimbSystem.java:30-33 的
// `else if (appliedHold != Constants.HOLD)` 已經即時重套，那顆燈會對一個已經修好的
// 問題持續發假警報（規格 §0 與 §10 都特別點名這一條）。
//
// 誠實標示：counts 對應到哪一格是**暫定標定值**，畫面上直接寫「刻度待實機標定」。
// 一根看起來很精確但沒校過的柱子，比一根承認自己沒校過的柱子危險。

import { useRef } from "react";
import { liveLog } from "../../lib/LogStore";
import { K } from "../../lib/fgcKeys";
import { palette } from "../../lib/theme";
import { PanelShell } from "../shell/PanelShell";
import { useCanvasFrame, approach, alpha, UI_FONT, MONO_FONT, type Frame } from "./canvas";

export interface ClimbMark {
  /** 分數線。 */
  score: number;
  /** 對應的 encoder counts。TODO: 待實機標定（climb.getPosition()）。 */
  counts: number;
}

/**
 * TODO: 待實機標定 —— 這五個 counts 是暫定值，必須在機器上量一次再寫死。
 * 標定方法：手動把爬升推到每一格，讀頂欄的 /FGC/Climb/Pos。
 */
export const CLIMB_MARKS: readonly ClimbMark[] = [
  { score: 0, counts: 0 },
  { score: 50, counts: 1000 },
  { score: 110, counts: 2200 },
  { score: 130, counts: 2900 },
  { score: 150, counts: 3600 },
];

const SCORE_MAX = CLIMB_MARKS[CLIMB_MARKS.length - 1].score;

/** counts → 分數軸位置（分段線性）。超出最後一格就夾在頂端。 */
export function countsToScore(counts: number): number {
  if (!Number.isFinite(counts)) return 0;
  if (counts <= CLIMB_MARKS[0].counts) return 0;
  for (let i = 1; i < CLIMB_MARKS.length; i++) {
    const a = CLIMB_MARKS[i - 1];
    const b = CLIMB_MARKS[i];
    if (counts <= b.counts) {
      const f = b.counts === a.counts ? 1 : (counts - a.counts) / (b.counts - a.counts);
      return a.score + f * (b.score - a.score);
    }
  }
  return SCORE_MAX;
}

/** 已經拿到手的分數（跨過的最後一條線），不是內插值——分數是離散的。 */
export function achievedScore(counts: number): number {
  let s = 0;
  for (const m of CLIMB_MARKS) if (counts >= m.counts) s = m.score;
  return s;
}

export function nextMark(counts: number): ClimbMark | null {
  for (const m of CLIMB_MARKS) if (counts < m.counts) return m;
  return null;
}

export function ClimbLadder() {
  const anim = useRef({ score: 0 }).current;

  const ref = useCanvasFrame((f: Frame) => {
    const { ctx, w, h, dt } = f;
    const p = palette();
    const log = liveLog;

    const counts = log.latestNum(K.climbPos, 0);
    const holding = log.latestBool(K.climbHolding);
    const over = log.latestBool(K.climbOverCurrent);
    const cur = log.latestNum(K.climbCurrent, NaN);

    anim.score = approach(anim.score, countsToScore(counts), dt, SCORE_MAX);

    const padT = 14;
    const padB = 22;
    const labelW = 34;
    const barW = Math.max(26, Math.min(58, w * 0.26));
    const bx = labelW + 6;
    const by0 = padT;
    const by1 = h - padB;
    const yOf = (s: number) => by1 - (Math.max(0, Math.min(SCORE_MAX, s)) / SCORE_MAX) * (by1 - by0);

    // 柱身
    ctx.fillStyle = alpha(p.border, 0.45);
    ctx.fillRect(bx, by0, barW, by1 - by0);

    // 已達高度
    const fillC = over ? p.err : holding ? p.ok : p.series[2];
    const yc = yOf(anim.score);
    ctx.fillStyle = alpha(fillC, 0.85);
    ctx.fillRect(bx, yc, barW, by1 - yc);

    // 分數線 + 左側標籤
    ctx.textBaseline = "middle";
    for (const m of CLIMB_MARKS) {
      const y = yOf(m.score);
      const passed = counts >= m.counts;
      ctx.strokeStyle = passed ? alpha(p.text, 0.7) : alpha(p.textDim, 0.55);
      ctx.lineWidth = m.score === SCORE_MAX ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(bx - 4, y);
      ctx.lineTo(bx + barW + 5, y);
      ctx.stroke();

      ctx.font = `${m.score === SCORE_MAX ? 600 : 400} 11px ${MONO_FONT}`;
      ctx.fillStyle = passed ? p.text : p.textDim;
      ctx.textAlign = "right";
      ctx.fillText(String(m.score), labelW, y);
    }

    // 現在位置指標
    ctx.fillStyle = fillC;
    ctx.textAlign = "left";
    ctx.font = `600 11px ${MONO_FONT}`;
    ctx.fillText(`◀ ${Math.round(anim.score)}`, bx + barW + 8, yc);

    // 柱底鎖頭：Holding 才亮
    const lockY = by1 + 10;
    const lockX = bx + barW / 2;
    ctx.strokeStyle = holding ? p.ok : alpha(p.textDim, 0.4);
    ctx.fillStyle = holding ? p.ok : alpha(p.textDim, 0.4);
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(lockX, lockY - 3, 3.4, Math.PI, 0);
    ctx.stroke();
    ctx.fillRect(lockX - 5, lockY - 3, 10, 7);

    // ── 右欄文字 ──
    const tx = bx + barW + 54;
    const avail = w - tx - 6;
    if (avail > 60) {
      const got = achievedScore(counts);
      const nx = nextMark(counts);
      let y = by0 + 6;

      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillStyle = p.textDim;
      ctx.font = `11px ${UI_FONT}`;
      ctx.fillText("已達", tx, y);
      y += 14;

      const fs = Math.min(46, Math.max(26, avail * 0.42));
      ctx.font = `700 ${Math.round(fs)}px ${MONO_FONT}`;
      ctx.fillStyle = over ? p.err : p.text;
      ctx.fillText(String(got), tx, y);
      const gw = ctx.measureText(String(got)).width;
      ctx.font = `${Math.round(fs * 0.38)}px ${UI_FONT}`;
      ctx.fillStyle = p.textDim;
      ctx.fillText("分", tx + gw + 4, y + fs * 0.5);
      y += fs + 8;

      ctx.font = `12px ${UI_FONT}`;
      ctx.fillStyle = nx ? p.warn : p.ok;
      ctx.fillText(nx ? `再上一格 +${nx.score - got} 分` : "已達頂格", tx, y);
      y += 17;

      ctx.font = `11px ${MONO_FONT}`;
      ctx.fillStyle = p.textDim;
      ctx.fillText(`counts ${Math.round(counts)}`, tx, y);
      y += 15;
      if (nx) {
        ctx.fillText(`還差 ${Math.max(0, Math.round(nx.counts - counts))}`, tx, y);
        y += 15;
      }
      if (Number.isFinite(cur)) {
        ctx.fillStyle = over ? p.err : p.textDim;
        ctx.fillText(`${cur.toFixed(1)} A${over ? " 過流" : ""}`, tx, y);
        y += 15;
      }
      ctx.fillStyle = holding ? p.ok : p.stale;
      ctx.font = `11px ${UI_FONT}`;
      ctx.fillText(holding ? "● HOLD 保持中" : "○ 未保持", tx, y);
    }
  });

  return (
    <PanelShell title="爬升" note="分數線為暫定標定值（待實機量測）" flush className="drive-climb">
      <canvas ref={ref} className="drive-canvas" />
    </PanelShell>
  );
}
