// #10 StateRibbon —— 狀態機膠囊，三格橫排。
//
// **刻意不長得像按鈕**：G13 要求前端沒有任何射擊控制路徑，而舊版做成等寬圓角
// 三格、現態綠底黑字反白，版面語彙說「可點」，所以才需要用標題文字澄清
// 「唯讀顯示，不是選單」。要靠文字澄清的版面就是錯的版面。
// 現在：無框、無圓角、無等寬三格——現態占 1.4 份寬並落進凹槽（--surface-3），
// 其餘兩格退成 --stale 的裸字。寬度差本身就說明了「這是現在的狀態」。
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
  COLLECT: "intake",
  SHOOT: "射擊",
  EJECT: "排出",
};

const STATE_KEYS = [K.driveState, K.driveClimbMode];

export function StateRibbon() {
  // 狀態機一秒最多變幾次，走 React 完全撐得住——只有這種低頻的才進 React。
  useLogKeys(STATE_KEYS);
  const cur = liveLog.latestStr(K.driveState, "");
  // 爬升模式（DPad Right）：狀態機被壓在 COLLECT 但 shooter/intake 全停，
  // 三格不能照常亮，否則駕駛會以為 intake 在轉。整條換成一句話。
  const climb = liveLog.latestBool(K.driveClimbMode, false);

  return (
    <PanelShell title="狀態機" flush className="drive-ribbon">
      {climb ? (
        <div className="ribbon-climb" role="status">
          <span className="rcl-main">CLIMB MODE</span>
          <span className="rcl-sub">只剩底盤與爬升；shooter / intake / 倉門全停。再按 DPad Right 退出</span>
        </div>
      ) : (
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
      )}
    </PanelShell>
  );
}
