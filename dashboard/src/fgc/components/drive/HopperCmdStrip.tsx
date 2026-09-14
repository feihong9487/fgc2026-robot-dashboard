// #16 HopperCmdStrip —— 開迴路誠實標示。
//
// HopperSystem 用 CRServo，介面根本沒有 getPosition()——機器人送出去的只有
// open() / close() / stop() 三個「指令」，沒有任何回授說球倉真的動了。
// 所以這一格刻意做成灰底、無圖示、標題明寫「此為指令值」，視覺上與有回授的
// ClimbLadder 區隔。若畫成開／關的狀態圖示，卡球時駕駛會相信它並往錯的方向找。
//
// 第二行是 "open" 定位伺服（放下球倉）：INIT 收起 0°、PLAY 後放下 120°。
// 定位伺服一樣沒有回授，顯示的是機器人送出的指令狀態（STOWED / DEPLOYED），
// MISSING 表示硬體組態裡沒有 "open"——這個要在維修區就看到，不能等上場。

import { liveLog } from "../../lib/LogStore";
import { K } from "../../lib/fgcKeys";
import { useLogKeys } from "../../lib/hooks";
import { PanelShell } from "../shell/PanelShell";

const HOPPER_KEYS = [K.hopperCmd, K.hopperDeploy, K.hopperOpenDeg];

const CN: Record<string, string> = { OPEN: "開", CLOSE: "關", STOP: "停" };
const DEPLOY_CN: Record<string, string> = { STOWED: "收起", DEPLOYED: "已放下", MISSING: "缺硬體" };

export function HopperCmdStrip() {
  useLogKeys(HOPPER_KEYS);
  const cmd = liveLog.latestStr(K.hopperCmd, "");
  const known = cmd in CN;
  const dep = liveLog.latestStr(K.hopperDeploy, "");
  const depKnown = dep in DEPLOY_CN;
  const deg = liveLog.latestNum(K.hopperOpenDeg, NaN);

  return (
    <PanelShell title="倉門指令" note="CRServo 無回授，此為指令值" flush className="drive-hopper">
      <div className="hopper-box">
        <span className="hop-bar" aria-hidden />
        <span className="hop-cmd">{known ? CN[cmd] : "—"}</span>
        <span className="hop-raw fgc-num">{cmd || "尚無資料"}</span>
      </div>
      <div className={"hop-deploy" + (dep === "MISSING" ? " missing" : "")}>
        <span className="hop-deploy-label">放倉 open</span>
        <span className="hop-deploy-val">{depKnown ? DEPLOY_CN[dep] : "—"}</span>
        <span className="hop-raw fgc-num">
          {dep ? `${dep}${Number.isFinite(deg) ? ` ${deg.toFixed(0)}°` : ""}` : "尚無資料"}
        </span>
      </div>
    </PanelShell>
  );
}
