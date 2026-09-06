// PIT · 參數對帳台（§4.3）。
//
// 四個區塊剛好是「一個值從你的手指到機器人再回到你眼睛」這條鏈路的四段：
//   雙欄表 = 送出與回讀 · 帳本 = 失敗時的原因 · 差異卡 = 調完之後怎麼保住
//   統計   = 調完之後有沒有比較好
// 左右分欄而不是上下堆疊，因為調參時眼睛要在「我改了什麼」與「結果如何」之間
// 高頻來回，垂直捲動會打斷這個節奏。
//
// §8：整頁的可寫元件都掛在 allowInputs 上，非 PIT 一律不 render（不是 disabled）。
// 真正的硬閘在 RobotClient.set 裡；這一層是「連引誘都不留」。

import { useEffect, useState } from "react";
import { CamPane } from "../components/tune/CamPane";
import { ParamDiffCard } from "../components/tune/ParamDiffCard";
import { RangeStats } from "../components/tune/RangeStats";
import { SetLedger } from "../components/tune/SetLedger";
import { TuneTable } from "../components/tune/TuneTable";
import { liveLog } from "../lib/LogStore";
import { client } from "../../lib/RobotClient";
import { useAppMode } from "../lib/hooks";
import type { PageDef } from "./registry";
import "../styles/tune.css";

/** 1200 以下寫回帳本改成抽屜（§4.7）：它是「出事才要看」的東西，不該佔常駐版面。 */
const LEDGER_DRAWER_W = 1200;

function Tune() {
  const mode = useAppMode();
  const replay = client.replayLog !== null;
  const log = client.replayLog ?? liveLog;
  // 回放不是 PIT，但它物理上不可寫（沒有 ws）——所以純檢視類的控制項照樣給。
  // 會真的送出東西的（TuneTable 的欄位、ParamDiffCard 的三顆鍵、CamPane）只認 PIT。
  const canWrite = mode === "PIT" && !replay;
  const canView = mode === "PIT" || replay;

  const [ledgerOpen, setLedgerOpen] = useState(() => window.innerWidth >= LEDGER_DRAWER_W);
  useEffect(() => {
    const on = () => setLedgerOpen((o) => (window.innerWidth >= LEDGER_DRAWER_W ? o : false));
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);

  return (
    <div className="tp">
      <div className="tp-main">
        <div className="tp-left">
          <div className="tp-table">
            <TuneTable log={log} allowInputs={canWrite} />
          </div>

          <div className={"tp-ledger hide-lt-1024" + (ledgerOpen ? " open" : "")}>
            {canView && (
              <button className="tp-drawer" onClick={() => setLedgerOpen((o) => !o)}>
                {ledgerOpen ? "▾" : "▸"} 寫回帳本
              </button>
            )}
            {ledgerOpen && <SetLedger log={log} allowInputs={canView} />}
          </div>
        </div>

        <div className="tp-right">
          <div className="tp-diff">
            <ParamDiffCard log={log} allowInputs={canWrite} />
          </div>
          <div className="tp-stats hide-lt-1024">
            <RangeStats log={log} allowInputs={canView} />
          </div>
          <div className="tp-cam hide-lt-1024">
            <CamPane log={log} allowInputs={canWrite} />
          </div>
        </div>
      </div>
    </div>
  );
}

export const TunePage: PageDef = {
  id: "tune",
  label: "參數",
  hotkey: "T",
  hint: "21 項白名單雙欄對帳、寫回帳本、Constants 片段、區間統計、相機",
  minWidth: 1024,
  Component: Tune,
};
