// #15 GamepadStrip —— 按鍵燈條。
//
// 教練站在駕駛後面時，這是判斷「機器人壞了 vs 駕駛沒按」的唯一即時證據。
// RT / LT 一定要畫類比值與 0.5 門檻線：機器人端是 `gamepad1.right_trigger > 0.5`
// 這種判定，扳機按到 0.42 在只有燈的 UI 上長得跟完全沒按一模一樣，
// 但駕駛的手感是「我明明按了」。這一條線每年都要救一次人。
//
// Circle 是瞄準輔助（規格 §0 校正：不是 L1；L1 是關球倉），所以它必須在條上。

import { liveLog } from "../../lib/LogStore";
import { K } from "../../lib/fgcKeys";
import { palette } from "../../lib/theme";
import { PanelShell } from "../shell/PanelShell";
import { useCanvasFrame, roundRect, alpha, UI_FONT, MONO_FONT, type Frame } from "./canvas";

/** 機器人端的扳機判定門檻。 */
const TRIGGER_TH = 0.5;

interface Cell {
  label: string;
  key: string;
  analog?: boolean;
  hint?: string;
}

const CELLS: Cell[] = [
  { label: "RT", key: K.gpRT, analog: true, hint: "射擊" },
  { label: "LT", key: K.gpLT, analog: true, hint: "吸取" },
  { label: "✕", key: K.gpCross, hint: "排出" },
  { label: "○", key: K.gpCircle, hint: "瞄準" },
  { label: "□", key: K.gpSquare, hint: "車頭" },
  { label: "R1", key: K.gpR1, hint: "開倉" },
  { label: "L1", key: K.gpL1, hint: "關倉" },
  { label: "↑", key: K.gpDUp, hint: "爬升" },
  { label: "↓", key: K.gpDDown, hint: "下降" },
];

export function GamepadStrip() {
  const ref = useCanvasFrame((f: Frame) => {
    const { ctx, w, h } = f;
    const p = palette();
    const log = liveLog;

    const gap = 6;
    const cw = (w - gap * (CELLS.length + 1)) / CELLS.length;
    const top = 4;
    const ch = h - top - 4;

    CELLS.forEach((c, i) => {
      const x = gap + i * (cw + gap);
      const on = c.analog
        ? log.latestNum(c.key, 0) > TRIGGER_TH
        : log.latestBool(c.key, false);
      const col = on ? p.ok : p.textDim;

      // 凹槽（--surface-3）+ --r-card 3px。這是唯讀顯示，不是按鍵，
      // 所以不給它 --r-chip 的按鍵方角，也不給它任何邊框。
      ctx.fillStyle = p.surface3;
      roundRect(ctx, x, top, cw, ch, 3);
      ctx.fill();

      // 標籤
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.font = `700 ${Math.max(12, Math.round(ch * 0.24))}px ${UI_FONT}`;
      ctx.fillStyle = on ? p.text : p.textDim;
      ctx.fillText(c.label, x + cw / 2, top + ch * 0.08);

      if (c.analog) {
        const v = Math.max(0, Math.min(1, log.latestNum(c.key, 0)));
        const bx = x + cw * 0.12;
        const bw = cw * 0.76;
        const by = top + ch * 0.46;
        const bh = Math.max(6, ch * 0.2);
        ctx.fillStyle = alpha(p.border, 0.9);
        ctx.fillRect(bx, by, bw, bh);
        ctx.fillStyle = col;
        ctx.fillRect(bx, by, bw * v, bh);
        // 0.5 門檻線：機器人端就是拿這個數字判斷「按了沒」
        ctx.strokeStyle = p.warn;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(bx + bw * TRIGGER_TH, by - 2);
        ctx.lineTo(bx + bw * TRIGGER_TH, by + bh + 2);
        ctx.stroke();

        ctx.font = `${Math.max(12, Math.round(ch * 0.2))}px ${MONO_FONT}`;
        ctx.fillStyle = on ? p.text : p.textDim;
        ctx.textBaseline = "bottom";
        ctx.fillText(v.toFixed(2), x + cw / 2, top + ch - 1);
      } else {
        const r = Math.min(cw * 0.26, ch * 0.17);
        const cy = top + ch * 0.5;
        ctx.fillStyle = on ? col : "transparent";
        ctx.strokeStyle = on ? col : alpha(p.textDim, 0.55);
        ctx.lineWidth = 1.6;
        roundRect(ctx, x + cw / 2 - r, cy - r * 0.8, r * 2, r * 1.6, 2);
        if (on) ctx.fill();
        else ctx.stroke();

        if (c.hint) {
          ctx.font = `${Math.max(12, Math.round(ch * 0.17))}px ${UI_FONT}`;
          ctx.fillStyle = p.textDim;
          ctx.textBaseline = "bottom";
          ctx.fillText(c.hint, x + cw / 2, top + ch - 2);
        }
      }
    });
  });

  return (
    <PanelShell title="手把" note="RT / LT 的黃線是機器人端 0.5 判定門檻" flush className="drive-pad">
      <canvas ref={ref} className="drive-canvas" />
    </PanelShell>
  );
}
