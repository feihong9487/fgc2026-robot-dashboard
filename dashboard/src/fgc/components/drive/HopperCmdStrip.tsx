// #16 HopperCmdStrip —— 開迴路誠實標示。
//
// HopperSystem 用 CRServo，介面根本沒有 getPosition()——機器人送出去的只有
// open() / close() / stop() 三個「指令」，沒有任何回授說球倉真的動了。
// 所以這一格刻意做成灰底、無圖示、標題明寫「此為指令值」，視覺上與有回授的
// ClimbLadder 區隔。若畫成開／關的狀態圖示，卡球時駕駛會相信它並往錯的方向找。

import { liveLog } from "../../lib/LogStore";
import { K } from "../../lib/fgcKeys";
import { useLogKeys } from "../../lib/hooks";
import { PanelShell } from "../shell/PanelShell";

const HOPPER_KEYS = [K.hopperCmd];

const CN: Record<string, string> = { OPEN: "開", CLOSE: "關", STOP: "停" };

export function HopperCmdStrip() {
  useLogKeys(HOPPER_KEYS);
  const cmd = liveLog.latestStr(K.hopperCmd, "");
  const known = cmd in CN;

  return (
    <PanelShell title="倉門指令" note="CRServo 無回授，此為指令值" flush className="drive-hopper">
      <div className="hopper-box">
        <span className="hop-bar" aria-hidden />
        <span className="hop-cmd">{known ? CN[cmd] : "—"}</span>
        <span className="hop-raw fgc-num">{cmd || "（尚無資料）"}</span>
      </div>
    </PanelShell>
  );
}
