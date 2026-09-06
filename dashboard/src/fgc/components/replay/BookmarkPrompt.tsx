// Ctrl+B 的單行輸入（§3.4 #34）。
//
// 不是 window.prompt()：那東西會凍住整個 render 迴圈（播放中的 rAF 也停），
// 而且在 Tauri 的 webview 裡行為不一致。這裡就是一個蓋在畫面上的單行輸入，
// Enter 送出、Esc 取消，開啟時自動 focus——賽後檢討的節奏是「看到 → Ctrl+B → 打幾個字 → 繼續」，
// 中間任何一次要用滑鼠都會斷掉。

import { useEffect, useRef, useState } from "react";

interface Props {
  t: number;
  /** 已經有書籤在同一時刻時帶進來的舊標籤。 */
  initial?: string;
  onSubmit: (label: string) => void;
  onCancel: () => void;
}

export function BookmarkPrompt({ t, initial = "", onSubmit, onCancel }: Props) {
  const [text, setText] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  return (
    <div className="bm-backdrop" onMouseDown={onCancel}>
      <div className="bm-box" onMouseDown={(e) => e.stopPropagation()}>
        <div className="bm-head">
          書籤 @ <span className="fgc-num">{t.toFixed(3)}</span>
          <span className="fgc-unit">s</span>
        </div>
        <input
          ref={ref}
          className="bm-input"
          value={text}
          placeholder="看到了什麼？（Enter 存、Esc 取消）"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") onSubmit(text);
            else if (e.key === "Escape") onCancel();
          }}
        />
        <div className="bm-foot">
          事件是機器算的、書籤是人看到的。匯出 Markdown 時兩者會交錯排在同一張時間表。
        </div>
      </div>
    </div>
  );
}
