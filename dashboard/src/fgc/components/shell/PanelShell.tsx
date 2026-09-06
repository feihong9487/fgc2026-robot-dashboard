// PanelShell：所有面板的統一外殼。
//
// 版面只是外層 Grid，面板自己不管位置——這是「v1 不引入 react-grid-layout，
// 但保留升級路徑」的那個保留（§5.3）：若第 3 週實測發現固定版面真的不夠，
// 只要把某一頁的外層 Grid 換成 RGL，面板本身一行都不用改。
//
// 標題列固定四件事：標題 · 新鮮度小點 · 取樣率 chip · 右上圖示列。
// 取樣率 chip 是誠實原則的載體：2 Hz 的電流不可以畫得跟 20 Hz 的轉速一樣有權威感。

import type { ReactNode } from "react";

export type Freshness = "ok" | "stale" | "dead" | null;

export interface PanelShellProps {
  title: string;
  /** 標題右邊的小字（例如「CRServo 無回授，此為指令值」）。 */
  note?: string;
  /** 新鮮度小點；null = 這個面板沒有時效概念（例如參數表）。 */
  fresh?: Freshness;
  /** 取樣率 chip 的文字，例如 "~2 Hz"。 */
  rate?: string;
  /** 右上圖示列。 */
  tools?: ReactNode;
  /** body 不留 padding（Canvas 面板用）。 */
  flush?: boolean;
  className?: string;
  children: ReactNode;
}

const FRESH_TITLE: Record<string, string> = {
  ok: "資料新鮮（< 250 ms）",
  stale: "已過期：仍顯示最後一次的值與年齡，不顯示空白",
  dead: "斷流",
};

export function PanelShell({
  title,
  note,
  fresh = null,
  rate,
  tools,
  flush,
  className,
  children,
}: PanelShellProps) {
  return (
    <section className={`panel-shell${flush ? " flush" : ""}${className ? " " + className : ""}`}>
      <header>
        <span className="title">{title}</span>
        {fresh && <span className={`fresh-dot ${fresh}`} title={FRESH_TITLE[fresh]} />}
        {rate && (
          <span className="rate-chip" title="取樣率：低於 10 Hz 一律畫散點，不畫平滑曲線">
            {rate}
          </span>
        )}
        {tools && <span className="tools">{tools}</span>}
      </header>
      <div className="body">{children}</div>
      {/* 說明句在卡片底部，不在標題後面。標題後掛一句灰色小字是「WORD — fragment」
          模板 chrome 的變體：五張卡各掛一句，加起來就是 70 個字的噪音，
          而 3 秒律的頁面上沒有人會讀它們。 */}
      {note && <p className="note">{note}</p>}
    </section>
  );
}

/** ws age → 新鮮度。門檻 250 ms（推播週期 PERIOD_MS=50L，500 ms 太鬆）。 */
export function freshnessOf(ageMs: number): Freshness {
  if (ageMs < 0) return "dead";
  if (ageMs > 3000) return "dead";
  if (ageMs > 250) return "stale";
  return "ok";
}
