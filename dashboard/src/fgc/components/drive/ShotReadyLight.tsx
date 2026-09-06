// #7 ShotReadyLight —— 巨燈。DRIVE 分頁唯一「1.5 公尺外瞥 0.5 秒」的元件。
//
// 全頁唯一置中的東西，也是全頁唯一填飽和色的東西（設計原則 1）。
// 版面是直立堆疊：燈 → 狀態字 → 副行，三者共用同一條垂直中線。
// 整頁只有這一次置中，所以那必然是視線落點。
//
// **狀態色只填燈本體**：卡片不洗底色、不畫外框。舊版把整張卡染成狀態色的
// 淡洗色再描一圈同色框，1.5 公尺外看到的是「一片紅」而不是「哪一格出事」。
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
import {
  useCanvasFrame,
  approach,
  alpha,
  setTracking,
  UI_FONT,
  MONO_FONT,
  type Frame,
} from "./canvas";
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

    const word = WORD[st];
    const tgtTxt =
      Number.isFinite(tgtL) && Number.isFinite(tgtR)
        ? `目標 ${Math.round(tgtL)} / ${Math.round(tgtR)}`
        : "目標 —";
    const subTxt = `SL ${Math.round(anim.sl)}   SR ${Math.round(anim.sr)}   ${tgtTxt} tps`;
    // 百分比只在 SPINUP 有話要說。IDLE 底下那個永遠的「0%」是裝飾，不是資訊。
    const pctTxt = st === "SPINUP" && progRaw !== null ? `${Math.round(anim.prog * 100)}%` : "";

    const pad = Math.max(10, Math.min(w, h) * 0.045);
    // 直立堆疊 = 全頁唯一的置中構圖。只有卡片被壓到很扁時才退回左燈右字。
    const stacked = h >= 140;

    /** 燈：底環（--border）+ 進度弧（狀態色）+ 中央形狀（狀態色實心）。 */
    const lamp = (cx: number, cy: number, r: number) => {
      const lw = Math.max(4, r * 0.15);
      ctx.lineCap = "butt";
      ctx.lineWidth = lw;
      ctx.strokeStyle = alpha(p.border, 0.9);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      if (progRaw !== null) {
        ctx.strokeStyle = c;
        ctx.beginPath();
        ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * anim.prog);
        ctx.stroke();
      }
      drawShape(ctx, st, cx, cy, r * 0.6, c);
    };

    if (stacked) {
      const availW = w - pad * 2;
      // 狀態字先拿走固定的一份高度（--fs-hero 的等價物），**剩下的全給燈**。
      // 反過來（先切燈再切字）會讓卡片一變矮就兩個一起縮，最後兩個都不夠大。
      // 0.62 em/字 是這套 bold sans 的實測平均；先估再用 measureText 收斂一次。
      let fs = Math.min(h * 0.3, availW / (word.length * 0.62));
      setTracking(ctx, "0.02em");
      ctx.font = `700 ${Math.round(fs)}px ${UI_FONT}`;
      const mw = ctx.measureText(word).width;
      if (mw > availW) fs = Math.max(24, fs * (availW / mw));
      fs = Math.round(fs);

      const subFs = Math.max(12, Math.min(28, Math.round(fs * 0.21)));
      const g1 = Math.max(10, h * 0.06);
      const g2 = Math.max(6, h * 0.03);
      const ringR = Math.max(24, Math.min((h * 0.95 - fs - subFs - g1 - g2) / 2, w * 0.22));
      const blockH = ringR * 2 + g1 + fs + g2 + subFs;
      const top = Math.max(0, (h - blockH) / 2);
      const cx = w / 2;

      lamp(cx, top + ringR, ringR);

      // 狀態字：--text，不是狀態色。字距 .02em 是全案唯一的例外，
      // 理由是 READY/SHOOT/EJECT 是狀態機的字面值，不是設計師挑的大寫標籤。
      ctx.font = `700 ${fs}px ${UI_FONT}`;
      ctx.fillStyle = p.text;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(word, cx, top + ringR * 2 + g1);
      setTracking(ctx, "0px");

      if (pctTxt) {
        ctx.font = `700 ${Math.round(ringR * 0.34)}px ${MONO_FONT}`;
        ctx.fillStyle = c;
        ctx.textBaseline = "middle";
        ctx.fillText(pctTxt, cx, top + ringR * 2 + g1 * 0.5);
        ctx.textBaseline = "top";
      }

      ctx.font = `${subFs}px ${MONO_FONT}`;
      let sw = ctx.measureText(subTxt).width;
      if (sw > availW) {
        const shrunk = Math.max(12, Math.floor((subFs * availW) / sw));
        ctx.font = `${shrunk}px ${MONO_FONT}`;
        sw = ctx.measureText(subTxt).width;
      }
      ctx.fillStyle = p.textDim;
      ctx.fillText(subTxt, cx, top + ringR * 2 + g1 + fs + g2);
      return;
    }

    // ── 扁卡退路：左燈右字（< 140 px 高的降級版面）──
    const ringR = Math.min(h * 0.36, w * 0.12);
    const ringX = pad + ringR;
    lamp(ringX, h / 2, ringR);

    const textX = ringX + ringR + pad;
    const availW = w - textX - pad;
    let fs = Math.min(h * 0.46, availW / (word.length * 0.62));
    setTracking(ctx, "0.02em");
    ctx.font = `700 ${Math.round(fs)}px ${UI_FONT}`;
    const mw = ctx.measureText(word).width;
    if (mw > availW) fs = Math.max(20, fs * (availW / mw));
    fs = Math.round(fs);
    ctx.font = `700 ${fs}px ${UI_FONT}`;
    ctx.fillStyle = p.text;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(word, textX, h / 2 + fs * 0.12);
    setTracking(ctx, "0px");

    const subFs = Math.max(12, Math.min(24, Math.round(fs * 0.24)));
    ctx.font = `${subFs}px ${MONO_FONT}`;
    ctx.fillStyle = p.textDim;
    ctx.textBaseline = "top";
    ctx.fillText(subTxt, textX, h / 2 + fs * 0.26);
  });

  return (
    <PanelShell
      title="射擊就緒"
      note={full ? "Esc 或 F 還原" : undefined}
      flush
      className={`drive-hero${full ? " full" : ""}`}
    >
      <canvas ref={ref} className="drive-canvas" />
    </PanelShell>
  );
}
