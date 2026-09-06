// #8 SpinDualGauge + #9 BalanceBar —— 雙飛輪 270 度環與置中失衡條。
//
// BalanceBar 是全目錄投報比最高的單一功能：ShooterSystem.java:34 的 atSpeed 是
// 「兩顆各自比門檻」的 &&，**從未比較兩顆是否一致**。所以兩顆差 200 tps 時
// atSpeed 照樣是 true，機器人自認一切正常，球卻一直偏。純前端相減、零機器人端成本，
// 卻能在拆機構之前先排除「落點偏是軟體造成的側旋」。
//
// **數值不畫在環裡面**（§4.1 線框寫的是 `SL ◯1851`）：四位數塞進半徑 r 的環內，
// 字級的上限是 0.58r，所以環一小數字就跟著掉到 25 px 以下——那正好低於
// 1.5 公尺的可讀下限。改成「標籤 · 環 · 數值」橫排之後，數值的字級由欄寬決定，
// 在 1440×900 下是 46 px（--fs-xl 那一階），環只負責回答「離目標多遠」。
//
// 目標畫成環上 ±3% 的綠容差帶而不是一條線：飛輪本來就在目標附近抖，
// 一條線會讓「已經夠好了」看起來像「一直沒對準」。
// FEED_THRESHOLD 是紅刻，而且讀 /FGC/Param/ 的回讀值——寫死 1200 的圖表會在
// 有人調過門檻之後開始說謊（§3.3 #18）。

import { useRef } from "react";
import { liveLog } from "../../lib/LogStore";
import { K } from "../../lib/fgcKeys";
import { palette } from "../../lib/theme";
import { PanelShell } from "../shell/PanelShell";
import { useCanvasFrame, approach, alpha, UI_FONT, MONO_FONT, type Frame } from "./canvas";
import { feedThreshold } from "./driveModel";

/** 270 度：從左下 135 度掃到右下 45 度。 */
const SWEEP = Math.PI * 1.5;
const START = Math.PI * 0.75;
/** 目標容差帶半寬。 */
const TOL = 0.03;
/** 失衡門檻（tps）：超過就顯示「側旋」。 */
export const IMBALANCE_TPS = 100;
/** 失衡條滿刻度。 */
const BAL_RANGE = 300;

function snapMax(v: number): number {
  return Math.max(500, Math.ceil(v / 500) * 500);
}

interface GaugeArgs {
  ctx: CanvasRenderingContext2D;
  /** 這一組（標籤 + 環 + 數值）的水平中心。 */
  cx: number;
  cy: number;
  /** 這一組可用的寬與高。 */
  gw: number;
  gh: number;
  mirror: boolean;
  label: string;
  value: number;
  target: number;
  feed: number | null;
  feedSolid: boolean;
  gmax: number;
  color: string;
}

function drawGauge(a: GaugeArgs, p: ReturnType<typeof palette>) {
  const { ctx, cx, cy, gw, gh, mirror, label, value, target, feed, gmax, color } = a;
  // 反轉標記留 50 tps 的死區：COLLECT 期停轉時 SL 會在 0 附近抖出 −5，
  // 那不是「way 反轉」，把它標成紅色反轉會製造一個不存在的故障。
  const neg = value < -50;
  const mag = Math.abs(value);
  const num = String(Math.round(value));
  const unit = neg ? "反轉 tps" : "tps";

  const r = Math.max(16, Math.min(gh * 0.44, gw * 0.16));
  const lw = Math.max(5, r * 0.26);
  const lblFs = Math.max(13, Math.round(Math.min(gh * 0.17, 20)));
  const unitFs = Math.max(12, Math.round(Math.min(gh * 0.14, 16)));
  const gap = Math.max(6, r * 0.28);

  // 一列的總寬：量出來再決定數值字級，不用估的——四位數與三位數差 25%，
  // 用估的會在 1000 tps 那一刻整列跳動。
  const rowW = (nf: number) => {
    ctx.font = `700 ${nf}px ${MONO_FONT}`;
    const nw = ctx.measureText(num).width;
    ctx.font = `700 ${lblFs}px ${UI_FONT}`;
    const lwid = ctx.measureText(label).width;
    ctx.font = `${unitFs}px ${MONO_FONT}`;
    const uw = ctx.measureText(unit).width;
    return { total: lwid + gap + r * 2 + gap + nw + 5 + uw, nw, lwid, uw };
  };

  let numFs = Math.round(Math.min(gh * 0.54, 46));
  let m = rowW(numFs);
  if (m.total > gw) {
    numFs = Math.max(15, Math.floor(numFs * (gw / m.total)));
    m = rowW(numFs);
  }

  let x = cx - m.total / 2;

  // SL/SR 的顏色是 §6.5 的固定綁定（1 = 青、2 = 琥珀），不因面板而異。
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${lblFs}px ${UI_FONT}`;
  ctx.fillStyle = color;
  ctx.fillText(label, x, cy);
  x += m.lwid + gap;

  // ── 環 ──
  const rcx = x + r;
  const dir = mirror ? -1 : 1;
  const start = mirror ? Math.PI * 0.25 : START;
  const ang = (v: number) => start + dir * SWEEP * Math.max(0, Math.min(1, v / gmax));

  ctx.lineCap = "butt";
  ctx.lineWidth = lw;
  ctx.strokeStyle = p.surface3;
  ctx.beginPath();
  ctx.arc(rcx, cy, r, start, start + dir * SWEEP, mirror);
  ctx.stroke();

  // 目標 ±3% 容差帶
  if (target > 0) {
    ctx.strokeStyle = alpha(p.ok, 0.5);
    ctx.beginPath();
    ctx.arc(rcx, cy, r, ang(target * (1 - TOL)), ang(target * (1 + TOL)), mirror);
    ctx.stroke();
  }

  ctx.strokeStyle = neg ? p.err : color;
  ctx.lineWidth = lw * 0.72;
  ctx.beginPath();
  ctx.arc(rcx, cy, r, start, ang(mag), mirror);
  ctx.stroke();

  // FEED_THRESHOLD 紅刻（回讀不到時畫成虛淡色，不假裝知道）
  if (feed !== null && feed > 0) {
    const t = ang(feed);
    ctx.strokeStyle = a.feedSolid ? p.err : alpha(p.err, 0.4);
    ctx.lineWidth = Math.max(2, r * 0.08);
    ctx.beginPath();
    ctx.moveTo(rcx + Math.cos(t) * (r - lw * 0.8), cy + Math.sin(t) * (r - lw * 0.8));
    ctx.lineTo(rcx + Math.cos(t) * (r + lw * 0.8), cy + Math.sin(t) * (r + lw * 0.8));
    ctx.stroke();
  }
  x += r * 2 + gap;

  // ── 數值：卡片主讀數，永遠 --text（反轉時才是 --err）──
  ctx.font = `700 ${numFs}px ${MONO_FONT}`;
  ctx.fillStyle = neg ? p.err : p.text;
  ctx.fillText(num, x, cy);
  x += m.nw + 5;

  ctx.font = `${unitFs}px ${MONO_FONT}`;
  ctx.fillStyle = p.textDim;
  ctx.fillText(unit, x, cy + numFs * 0.24);
}

export function SpinDualGauge() {
  const anim = useRef({ sl: 0, sr: 0, bal: 0 }).current;

  const ref = useCanvasFrame((f: Frame) => {
    const { ctx, w, h, dt } = f;
    const p = palette();
    const log = liveLog;

    const sl = log.latestNum(K.sl, 0);
    const sr = log.latestNum(K.sr, 0);
    const tgtL = log.latestNum(K.targetL, 0);
    const tgtR = log.latestNum(K.targetR, 0);
    const feed = feedThreshold(log);

    anim.sl = approach(anim.sl, sl, dt, 3000);
    anim.sr = approach(anim.sr, sr, dt, 3000);
    anim.bal = approach(anim.bal, sl - sr, dt, BAL_RANGE * 2);

    const gmax = snapMax(
      Math.max(Math.abs(anim.sl), Math.abs(anim.sr), tgtL, tgtR, feed.v ?? 0) * 1.12,
    );

    // ── 上：兩組讀數（標籤 · 環 · 數值）──
    // 失衡條只需要一條線的高度，其餘全給讀數。
    const barH = Math.max(40, Math.min(62, h * 0.26));
    const gh = h - barH;
    const gw = w * 0.46;
    const cy = gh * 0.5;
    drawGauge(
      { ctx, cx: w * 0.25, cy, gw, gh, mirror: false, label: "SL", value: anim.sl, target: tgtL,
        feed: feed.v, feedSolid: feed.from === "param", gmax, color: p.series[0] },
      p,
    );
    drawGauge(
      { ctx, cx: w * 0.75, cy, gw, gh, mirror: true, label: "SR", value: anim.sr, target: tgtR,
        feed: feed.v, feedSolid: feed.from === "param", gmax, color: p.series[1] },
      p,
    );

    // ── 下：失衡條（置中，0 在正中央）──
    const d = anim.bal;
    const bad = Math.abs(d) > IMBALANCE_TPS;
    const bx0 = w * 0.14;
    const bx1 = w * 0.86;
    const by = gh + barH * 0.46;
    const cxm = (bx0 + bx1) / 2;
    const half = (bx1 - bx0) / 2;
    const xOf = (v: number) => cxm + (Math.max(-BAL_RANGE, Math.min(BAL_RANGE, v)) / BAL_RANGE) * half;

    ctx.lineCap = "butt";
    ctx.strokeStyle = p.surface3;
    ctx.lineWidth = Math.max(4, barH * 0.13);
    ctx.beginPath();
    ctx.moveTo(bx0, by);
    ctx.lineTo(bx1, by);
    ctx.stroke();

    // 門檻 ±100：不是刻度而是判準，畫成兩道細立柱
    ctx.strokeStyle = alpha(p.warn, 0.75);
    ctx.lineWidth = 1.5;
    for (const s of [-1, 1]) {
      const x = xOf(s * IMBALANCE_TPS);
      ctx.beginPath();
      ctx.moveTo(x, by - barH * 0.2);
      ctx.lineTo(x, by + barH * 0.2);
      ctx.stroke();
    }
    // 零線
    ctx.strokeStyle = p.textDim;
    ctx.beginPath();
    ctx.moveTo(cxm, by - barH * 0.26);
    ctx.lineTo(cxm, by + barH * 0.26);
    ctx.stroke();

    // 指標
    const px = xOf(d);
    ctx.fillStyle = bad ? p.err : p.text;
    ctx.beginPath();
    ctx.arc(px, by, Math.max(5, barH * 0.14), 0, Math.PI * 2);
    ctx.fill();

    ctx.font = `${Math.max(12, Math.round(barH * 0.22))}px ${MONO_FONT}`;
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    ctx.fillStyle = p.textDim;
    ctx.fillText(`−${BAL_RANGE}`, bx0, by + barH * 0.28);
    ctx.textAlign = "right";
    ctx.fillText(`+${BAL_RANGE}`, bx1, by + barH * 0.28);
    ctx.textAlign = "center";
    ctx.fillText(`失衡門檻 ${IMBALANCE_TPS}`, cxm, by + barH * 0.28);

    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.font = `700 ${Math.max(15, Math.round(barH * 0.36))}px ${MONO_FONT}`;
    ctx.fillStyle = bad ? p.err : p.text;
    const sign = d >= 0 ? "+" : "−";
    ctx.fillText(
      `SL−SR ${sign}${Math.abs(Math.round(d))} tps${bad ? "  側旋" : ""}`,
      cxm,
      by - barH * 0.3,
    );
  });

  return (
    <PanelShell
      title="飛輪雙環"
      note="機器人端 atSpeed 從未比較兩顆是否一致；失衡條是純前端相減"
      flush
      className="drive-gauge"
    >
      <canvas ref={ref} className="drive-canvas" />
    </PanelShell>
  );
}
