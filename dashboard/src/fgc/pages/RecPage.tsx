// 錄影分頁（PIT）：列出機器人上的 jsonl，點一列就進 REPLAY。
//
// 為什麼是一個分頁而不是一顆按鈕：§5.1 把 `R` 定義成「進入 REPLAY（選檔）」，
// 而本專案的全域快捷鍵是由 registry.ts 的 pageByHotkey 派送的，所以「一個掛在
// R 鍵上的 PageDef」就是那個選檔動作最直接的實作，不必為它多做一層 modal。
//
// host 從 client.link.host 拿：那是「目前真的在連的那個位址」，比從 App 傳下來的
// state 更接近事實（App 的 host 改了但還沒重連時，兩者會不一樣）。

import { DEFAULT_HOST } from "../lib/profile";
import { useLink } from "../lib/hooks";
import { RecBrowser } from "../components/rec/RecBrowser";
import type { PageDef } from "./registry";
import "../styles/rec.css";

function Rec() {
  const link = useLink();
  return (
    <div className="rec-page">
      <RecBrowser host={link.host || DEFAULT_HOST} />
    </div>
  );
}

export const RecPage: PageDef = {
  id: "rec",
  label: "錄影",
  hotkey: "R",
  hint: "賽後取檔：GET /dash/rec.json → 點一列 streaming 載入成 REPLAY",
  hidden: true, // §5.1 的 R 是一個「動作」（選檔進 REPLAY），不是一個常駐分頁
  Component: Rec,
};
