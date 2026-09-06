import { useState } from "react";
import { ConnectionBar, loadSavedHost } from "./components/ConnectionBar";
import { StatusPanel } from "./components/StatusPanel";
import { RunPanel } from "./components/RunPanel";
import { PathPlanPanel } from "./components/PathPlanPanel";
import { PathTestPanel } from "./components/PathTestPanel";
import { SimPanel } from "./components/SimPanel";
import { ConstantsPanel } from "./components/ConstantsPanel";
import { DebugPanel } from "./components/DebugPanel";
import { PointCloudPanel } from "./components/PointCloudPanel";
import { PointCloudTable } from "./components/PointCloudTable";
import { LidarStatsPanel } from "./components/LidarStatsPanel";
import { SlamPanel } from "./components/SlamPanel";
import { LocalizationPanel } from "./components/LocalizationPanel";
import { VisionPanel } from "./components/VisionPanel";
import { LinePanel } from "./components/LinePanel";
import { LockerPanel } from "./components/LockerPanel";
import { AllSignalsPanel } from "./components/AllSignalsPanel";

// V1 九分頁，按比賽日使用順序排：
// 檢錄後看「機器狀態」，上場只開「執行狀態」；備賽期用路徑規劃/模擬/常數表；
// 組裝期用初始化除錯；光達/視覺/全部訊號為跨階段工具。
const TABS = [
  { id: "status", label: "機器狀態", hint: "Go/No-Go 燈牆，全綠才上場" },
  { id: "run", label: "執行狀態", hint: "賽中監控 + S-curve 波形 + 中止" },
  { id: "path", label: "路徑規劃", hint: "場地圖點編輯 + op:path 下傳" },
  { id: "pathtest", label: "連續路徑測試", hint: "waypoint 陣列下傳試跑 + 速度波形 + 測程位姿" },
  { id: "sim", label: "模擬驗證", hint: "狀態機 + 故障注入" },
  { id: "constants", label: "常數表", hint: "constants.json 編輯器（含 PID/S-curve）" },
  { id: "debug", label: "初始化除錯", hint: "子系統隔離測試 + 標定精靈" },
  { id: "lidar", label: "光達", hint: "點雲 + 淨空觀測" },
  { id: "slam", label: "定位建圖", hint: "場地圖疊即時 grid + 機器人位姿（三角形車身、內圓為光達）" },
  { id: "localization", label: "定位診斷", hint: "牆面錨定 heading/position 修正的殘差與採用狀態（調機用）" },
  { id: "vision", label: "乒乓球定位", hint: "調色 + 霍夫圓 + 最近球座標" },
  { id: "line", label: "黑線定位", hint: "二值化 + 輪廓 + 最近黑線點座標" },
  { id: "locker", label: "置物櫃辨識", hint: "逐色找色塊 + 質心 Y 排序（黑/藍/紅 上→下）" },
  { id: "signals", label: "全部訊號", hint: "NT 鏡射總表" },
] as const;

type TabId = (typeof TABS)[number]["id"];

const LS_TAB = "vmx-dashboard.tab";

function loadSavedTab(): TabId {
  const t = localStorage.getItem(LS_TAB);
  return TABS.some((x) => x.id === t) ? (t as TabId) : "status";
}

export default function App() {
  const [host, setHost] = useState(loadSavedHost);
  const [tab, setTab] = useState<TabId>(loadSavedTab);

  const select = (id: TabId) => {
    setTab(id);
    localStorage.setItem(LS_TAB, id);
  };

  return (
    <div className="app">
      <ConnectionBar host={host} setHost={setHost} />

      <div className="app-body">
        <nav className="sidebar">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={tab === t.id ? "side-tab active" : "side-tab"}
              title={t.hint}
              onClick={() => select(t.id)}
            >
              <span className="side-label">{t.label}</span>
            </button>
          ))}
        </nav>

        {tab === "status" ? (
          <main className="layout-fill">
            <StatusPanel />
          </main>
        ) : tab === "run" ? (
          <main className="layout-run">
            <RunPanel />
          </main>
        ) : tab === "path" ? (
          <main className="layout-run">
            <PathPlanPanel />
          </main>
        ) : tab === "pathtest" ? (
          <main className="layout-run">
            <PathTestPanel />
          </main>
        ) : tab === "sim" ? (
          <main className="layout-sim">
            <SimPanel />
          </main>
        ) : tab === "constants" ? (
          <main className="layout-fill">
            <ConstantsPanel />
          </main>
        ) : tab === "debug" ? (
          <main className="layout-fill">
            <DebugPanel />
          </main>
        ) : tab === "lidar" ? (
          <main className="layout-sensors">
            <PointCloudPanel />
            <PointCloudTable />
            <LidarStatsPanel />
          </main>
        ) : tab === "slam" ? (
          <main className="layout-run">
            <SlamPanel />
          </main>
        ) : tab === "localization" ? (
          <main className="layout-fill">
            <LocalizationPanel />
          </main>
        ) : tab === "vision" ? (
          <main className="layout-vision">
            <VisionPanel host={host} />
          </main>
        ) : tab === "line" ? (
          <main className="layout-vision">
            <LinePanel host={host} />
          </main>
        ) : tab === "locker" ? (
          <main className="layout-vision">
            <LockerPanel host={host} />
          </main>
        ) : (
          <main className="layout-signals">
            <AllSignalsPanel />
          </main>
        )}
      </div>
    </div>
  );
}
