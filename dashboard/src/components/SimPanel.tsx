// 模擬驗證分頁（備賽期 Simulation-first）：
// Field2d 場地圖 + 任務狀態（State / Command / 趟次）+ 規劃器遙測
// （A* 耗時、重規劃次數）+ 故障注入（夾取失敗 / 路徑無解 / 視覺無解）。
// 在家就要測過「A* 無解時會發生什麼」，不能到場才發現機器人卡死。
import { useEffect, useState } from "react";
import { store } from "../lib/store";
import { client } from "../lib/RobotClient";
import { SIM_K } from "../lib/keys";
import { FieldView } from "./FieldView";
import { Chart } from "./Chart";
import { Toggle, Led, Collapse } from "./controls";

function useStore() {
  const [, force] = useState(0);
  useEffect(() => store.subscribe(() => force((n) => n + 1)), []);
}

export function SimPanel() {
  useStore();

  const state = String(store.latest.get(SIM_K.state) ?? "—");
  const cmd = String(store.latest.get(SIM_K.currentCommand) ?? "—");
  const trip = store.num(SIM_K.tripIndex, 0);
  const planMs = store.num(SIM_K.planTimeMs, 0);
  const replans = store.num(SIM_K.replanCount, 0);
  const fGrip = store.bool(SIM_K.faultGrip);
  const fPath = store.bool(SIM_K.faultPath);
  const fVision = store.bool(SIM_K.faultVision);
  const fLine = store.bool(SIM_K.faultLine);
  const fGyro = store.bool(SIM_K.faultGyro);
  const fault = state.startsWith("FAULT");
  const planSlow = planMs > 20;

  const offline = store.connState === "disconnected" || store.connState === "connecting";

  return (
    <>
      <div className="sim-left">
        {offline ? (
          <div className="field-wrap">
            <div className="cam-placeholder">
              未連線。按頂欄「模擬」即可離線演練完整三趟任務（含故障注入），
              或連上機器人後由機器人端發布 /Shuffleboard/Sim/* 遙測。
            </div>
          </div>
        ) : (
          <div className="field-wrap">
            <FieldView />
          </div>
        )}
        <Chart
          title="A* 規劃耗時 ms（須 < 20ms，故障注入時觀察飆高）"
          windowSec={30}
          height={180}
          series={[{ key: SIM_K.planTimeMs, label: "耗時 ms", color: "#4fc3f7" }]}
        />
      </div>

      <div className="tuning-panel">
        <Collapse title="任務狀態">
          <div className={fault ? "status-row estop" : "status-row ok"}>
            State：{state}
          </div>
          <div className="status-row">指令：{cmd}</div>
          <div className="status-row">
            趟次:{" "}
            {[1, 2, 3].map((t) => (
              <span key={t} className={t <= trip ? "trip-dot on" : "trip-dot"}>
                {t}
              </span>
            ))}
            <span style={{ marginLeft: 6 }}>{trip}/3</span>
          </div>
        </Collapse>

        <Collapse title="規劃器">
          <div className={planSlow ? "status-row estop" : "status-row"}>
            單次規劃耗時：{planMs.toFixed(1)} ms {planSlow && "（超標！）"}
          </div>
          <div className="status-row">重規劃次數：{replans}</div>
          <div className="status-row">
            <Led on={!planSlow} label="規劃 < 20ms" color="ok" />
          </div>
        </Collapse>

        <Collapse title="故障注入（Fault Injection）">
          <Toggle label="夾取失敗" on={fGrip} onChange={(v) => client.set(SIM_K.faultGrip, v)} />
          <Toggle label="路徑無解" on={fPath} onChange={(v) => client.set(SIM_K.faultPath, v)} />
          <Toggle label="視覺無解" on={fVision} onChange={(v) => client.set(SIM_K.faultVision, v)} />
          <Toggle label="黑線單顆失效" on={fLine} onChange={(v) => client.set(SIM_K.faultLine, v)} />
          <Toggle label="陀螺儀漂移" on={fGyro} onChange={(v) => client.set(SIM_K.faultGyro, v)} />
          <div className="lv-hint">
            開啟後觀察狀態機的 fallback 行為：夾取失敗應重試、路徑無解應持續重規劃、
            視覺無解應卡在 IdentifyStack、黑線失效應改用剩餘感測器、
            陀螺儀漂移應由黑線/光達校正吸收 —— 這些都必須在備賽期驗證過。
          </div>
        </Collapse>
      </div>
    </>
  );
}
