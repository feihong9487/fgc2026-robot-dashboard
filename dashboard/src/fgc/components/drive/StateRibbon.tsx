// #10 StateRibbon —— 狀態機膠囊，三格橫排。
//
// **刻意做成「按鈕的樣子但無 hover、無 active、不可點、不可聚焦」**：
// G13 要求前端沒有任何射擊控制路徑，而下拉選單在 pit 裡選錯了畫面上看不出來。
// 所以它長得像 Elastic 的 Split Button Chooser，但它是 <div>，沒有 onClick，
// 也沒有 cursor:pointer——視覺上就不像可點。
//
// 色彩與 DiscreteBand、事件軌共用同一組 --state-* token：同一個 SHOOT
// 在膠囊、色帶、事件清單裡永遠是同一個綠。

import { liveLog } from "../../lib/LogStore";
import { K, DRIVE_STATES } from "../../lib/fgcKeys";
import { useLogKeys } from "../../lib/hooks";
import { PanelShell } from "../shell/PanelShell";

const LABEL: Record<string, string> = {
  COLLECT: "COLLECT",
  SHOOT: "SHOOT",
  EJECT: "EJECT",
};

const SUB: Record<string, string> = {
  COLLECT: "吸取",
  SHOOT: "射擊",
  EJECT: "排出",
};

const STATE_KEYS = [K.driveState];

export function StateRibbon() {
  // 狀態機一秒最多變幾次，走 React 完全撐得住——只有這種低頻的才進 React。
  useLogKeys(STATE_KEYS);
  const cur = liveLog.latestStr(K.driveState, "");

  return (
    <PanelShell title="狀態機" note="唯讀顯示，不是選單" flush className="drive-ribbon">
      <div className="ribbon-row">
        {DRIVE_STATES.map((s) => (
          <div
            key={s}
            className={`ribbon-cell ${s.toLowerCase()}${s === cur ? " on" : ""}`}
            aria-current={s === cur ? "true" : undefined}
          >
            <span className="rc-main">{LABEL[s]}</span>
            <span className="rc-sub">{SUB[s]}</span>
          </div>
        ))}
      </div>
    </PanelShell>
  );
}
