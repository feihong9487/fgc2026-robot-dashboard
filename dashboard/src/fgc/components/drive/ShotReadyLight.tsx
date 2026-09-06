// #7 ShotReadyLight —— 巨燈。DRIVE 分頁唯一「1.5 公尺外瞥 0.5 秒」的元件。
//
// 佔左欄上方約 45% 面積不是浮誇：駕駛的眼睛在場上，餘光只解析得了「一大塊是什麼顏色」。
// 所以這裡沒有任何小字是必要資訊——字級 >= 96 px 的那個單字自己就是答案。
//
// 進度環回答 SPINUP 時「還要等多久」。只給 READY / NOT READY 的二值燈會讓駕駛
// 在等待期間反覆瞄螢幕，那正是我們想省掉的那幾次分心。
//
// 形狀語彙（§6.3）：綠 ●／黃 ▲／紅 ■／灰 ○。約 8% 男性有紅綠色覺辨異，
// 而遠距離時形狀比顏色更快被解析——顏色不是唯一通道。
//
// 全 Canvas + 自己 rAF，不走 React。

import { useRef } from "react";
import { liveLog } from "../../lib/LogStore";
import { K } from "../../lib/fgcKeys";
import { palette } from "../../lib/theme";
import { PanelShell } from "../shell/PanelShell";
import { useCanvasFrame, approach, alpha, UI_FONT, MONO_FONT, type Frame } from "./canvas";
import { shotStateOf, spinProgress, type ShotState } from "./driveModel";

const WORD: Record<ShotState, string> = {
  IDLE: "IDLE",
  SPINUP: "SPINUP",
  READY: "READY",
  EJECT: "EJECT",
};

function colorOf(st: ShotState): (p: ReturnType<typeof palette>) => string {
  switch (st) {
    case "READY":
      return (p) => p.ok;
    case "SPINUP":
      return (p) => p.warn;
    case "EJECT":
      return (p) => p.err;
    default:
      return (p) => p.stale;
  }
}

/** 形狀：● 實心圓 / ▲ 三角 / ■ 方塊 / ○ 空心圓。 */
function drawShape(ctx: CanvasRenderingContext2D, st: ShotState, cx: number, cy: number, r: number, c: string) {
  ctx.save();
  ctx.fillStyle = c;
  ctx.strokeStyle = c;
  ctx.lineWidth = Math.max(2, r * 0.16);
  if (st === "READY") {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  } else if (st === "IDLE") {
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.9, 0, Math.PI * 2);
    ctx.stroke();
  } else if (st === "EJECT") {
    const s = r * 1.62;
    ctx.fillRect(cx - s / 2, cy - s / 2, s, s);
  } else {
    // 三角：重心對齊圓心，遠看才不會覺得「偏上」
    const s = r * 1.15;
    ctx.beginPath();
    ctx.moveTo(cx, cy - s);
    ctx.lineTo(cx + s * 0.92, cy + s * 0.72);
    ctx.lineTo(cx - s * 0.92, cy + s * 0.72);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

export function ShotReadyLight({ full }: { full?: boolean }) {
  // 只有這兩個值做 0.15 s 線性緩動：20 Hz 的原始值直接畫會抖，
  // 但用 ease 曲線會讓人誤判到位時間（§6.7）。
  // useRef 而不是每次 render 現造：draw 存在 ref 裡，物件被換掉等於緩動歸零。
  const anim = useRef({ prog: 0, sl: 0, sr: 0 }).current;

  const ref = useCanvasFrame((f: Frame) => {
    const { ctx, w, h, dt } = f;
    const p = palette();
    const log = liveLog;

    const st = shotStateOf(log);
    const c = colorOf(st)(p);
    const progRaw = spinProgress(log);
    const sl = log.latestNum(K.sl, 0);
    const sr = log.latestNum(K.sr, 0);
    const tgtL = log.latestNum(K.targetL, NaN);
    const tgtR = log.latestNum(K.targetR, NaN);

    // 進度環一律畫「真實比值」，READY 也不補成 100%：
    // atSpeed 的判準是 FEED_THRESHOLD（1200），不是目標轉速，所以 SL 1710 / 目標 1900
    // 是**已達速但只有 90%** 的合法狀態。把它畫成 100% 等於幫機器人說謊。
    anim.prog = approach(anim.prog, progRaw ?? 0, dt, 1);
    anim.sl = approach(anim.sl, sl, dt, 3000);
    anim.sr = approach(anim.sr, sr, dt, 3000);

    // 底：狀態色的極淡洗色 + 同色細框。不做漸層、不做陰影。
    ctx.fillStyle = alpha(c, st === "IDLE" ? 0.04 : 0.09);
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = alpha(c, 0.45);
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, w - 2, h - 2);

    const pad = Math.max(12, Math.min(w, h) * 0.05);
    const vertical = w < 560;

    // ── 進度環 ──
    const ringR = vertical ? Math.min(h * 0.2, w * 0.17) : Math.min(h * 0.33, w * 0.135);
    const ringX = vertical ? w / 2 : pad + ringR + ringR * 0.14;
    const ringY = vertical ? pad + ringR + ringR * 0.14 : h / 2;
    const lw = Math.max(4, ringR * 0.16);

    ctx.lineCap = "butt";
    ctx.lineWidth = lw;
    ctx.strokeStyle = alpha(p.border, 0.9);
    ctx.beginPath();
    ctx.arc(ringX, ringY, ringR, 0, Math.PI * 2);
    ctx.stroke();

    if (progRaw !== null) {
      ctx.strokeStyle = c;
      ctx.beginPath();
      ctx.arc(ringX, ringY, ringR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * anim.prog);
      ctx.stroke();
    }

    drawShape(ctx, st, ringX, ringY, ringR * 0.5, c);

    // 環下的百分比：SPINUP 才有意義；目標為 0 時不畫（除以零的 100% 是假的）
    if (progRaw !== null && st !== "EJECT") {
      ctx.fillStyle = st === "READY" ? p.textDim : c;
      ctx.font = `600 ${Math.round(ringR * 0.42)}px ${MONO_FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(`${Math.round(anim.prog * 100)}%`, ringX, ringY + ringR + lw * 0.8);
    }

    // ── 巨字 ──
    const textX = vertical ? w / 2 : ringX + ringR + pad;
    const avail = vertical ? w - pad * 2 : w - textX - pad;
    const word = WORD[st];
    // 0.62 em/字 是這套 bold sans 的實測平均；先估再用 measureText 收斂一次。
    let fs = Math.min(vertical ? h * 0.34 : h * 0.5, avail / (word.length * 0.62));
    ctx.font = `800 ${Math.round(fs)}px ${UI_FONT}`;
    const mw = ctx.measureText(word).width;
    if (mw > avail) fs = Math.max(28, fs * (avail / mw));
    fs = Math.round(fs);

    const textY = vertical ? ringY + ringR + Math.max(28, ringR * 0.7) : h / 2;
    ctx.font = `800 ${fs}px ${UI_FONT}`;
    ctx.fillStyle = c;
    ctx.textAlign = vertical ? "center" : "left";
    ctx.textBaseline = vertical ? "top" : "alphabetic";
    ctx.fillText(word, textX, vertical ? textY : h / 2 + fs * 0.14);

    // ── 副行：實測 / 目標。小字，但一律等寬，值變動時整行不重排 ──
    const tgtTxt = Number.isFinite(tgtL) && Number.isFinite(tgtR)
      ? `目標 ${Math.round(tgtL)} / ${Math.round(tgtR)}`
      : "目標 —";
    const subTxt = `SL ${Math.round(anim.sl)}   SR ${Math.round(anim.sr)}   ${tgtTxt} tps`;
    let sub = Math.max(11, Math.min(30, Math.round(fs * 0.2)));
    ctx.font = `${sub}px ${MONO_FONT}`;
    // 全螢幕時巨字會撐到 300 px 以上，副行照比例算會直接溢出右邊界——量一次再收
    const sw = ctx.measureText(subTxt).width;
    if (sw > avail) {
      sub = Math.max(10, Math.floor((sub * avail) / sw));
      ctx.font = `${sub}px ${MONO_FONT}`;
    }
    ctx.fillStyle = p.textDim;
    ctx.textBaseline = "top";
    const subY = vertical ? textY + fs * 1.12 : h / 2 + fs * 0.28;
    ctx.fillText(subTxt, textX, subY);
  });

  return (
    <PanelShell
      title="射擊就緒"
      note={full ? "Esc 或 F 還原" : "F 全螢幕"}
      flush
      className={`drive-hero${full ? " full" : ""}`}
    >
      <canvas ref={ref} className="drive-canvas" />
    </PanelShell>
  );
}
