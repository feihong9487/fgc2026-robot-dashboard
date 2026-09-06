// 訊號分頁：沿用既有 AllSignalsPanel（219 行）。
//
// 第一階段只做兩件事：把它掛進 FGC 的 PanelShell、確認唯讀防線生效。
// 樹狀分組、釘選無上限、排序只在 key 集合變動時重算，是後續階段的改造（§3.35）。

import { AllSignalsPanel } from "../../components/AllSignalsPanel";
import { PanelShell } from "../components/shell/PanelShell";
import type { PageDef } from "./registry";

function Signals() {
  return (
    <div style={{ height: "100%", padding: "var(--u)", boxSizing: "border-box", display: "flex" }}>
      <PanelShell
        title="全部訊號"
        note="唯一可寫的是 /FGC/Tune/ 的 21 項，它們有輸入框；其餘一律純文字。"
        flush
        className="fill"
      >
        <AllSignalsPanel />
      </PanelShell>
    </div>
  );
}

export const SignalsPage: PageDef = {
  id: "signals",
  label: "訊號",
  hotkey: "A",
  hint: "新埋點驗證、找沒想到的那個 key",
  Component: Signals,
};
