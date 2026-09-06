// 形狀語彙的唯一渲染元件（§6.3）。
//
// 顏色不是唯一通道：約 8% 男性有紅綠色覺辨異，而遠距離時形狀比顏色更快被解析。
// 燈牆、時序帶圖例、事件清單、通知 rail 全部用這一個元件，學一次到處通。
//
// 刻意不接受任意 children 或自訂字元：能傳字元進來的元件，遲早會有人傳一個
// 別的字元進來，那條保證就從「結構上成立」退化成「大家記得就好」。

import { GLYPHS, TONE_LABEL, type Tone } from "../../lib/tone";

export function Glyph({ tone, title }: { tone: Tone; title?: string }) {
  return (
    <span className={`fgc-glyph ${tone}`} title={title ?? TONE_LABEL[tone]} aria-label={TONE_LABEL[tone]}>
      {GLYPHS[tone]}
    </span>
  );
}
