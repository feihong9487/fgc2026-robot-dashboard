// 檢查分頁（PIT · Go/No-Go 全螢幕）。
//
// 使用時機：上場前 30 秒、檢錄。所以它不捲動、不分欄、一眼看完。
// 底部是關閉路徑三格（#37）與備份徽章（#38）——兩者都是「賽場上的隊務」而不是
// 「機器人的狀態」，放在同一頁是因為打開這一頁的人剛好就是要處理這兩件事的人。
//
// 右側是相機即時畫面（2026-09-06 使用者要求：pit 區檢查時要看得到鏡頭現在看到什麼）。
// 這一頁的 CamPane 預設就開串流，而且記住上次的選擇；參數頁那一個維持預設暫停。
// 機器人同時只接受一個串流，分頁切換時 CamPane 自己會等 1.5 s 再敲門，不用手動重開。

import { HealthWall } from "../components/health/HealthWall";
import { BackupNudge } from "../components/health/BackupNudge";
import { CamPane } from "../components/tune/CamPane";
import { useAppMode } from "../lib/hooks";
import type { PageDef } from "./registry";
import "../styles/health.css";
import "../styles/tune.css";

function Health() {
  const mode = useAppMode();
  return (
    <div className="hw-page">
      <div className="hw-top">
        <HealthWall />
        <div className="hw-cam">
          <CamPane allowInputs={mode === "PIT"} defaultMode="stream" remember />
        </div>
      </div>
      <BackupNudge />
    </div>
  );
}

export const HealthPage: PageDef = {
  id: "health",
  label: "檢查",
  hotkey: "C",
  hint: "上場前 30 秒、檢錄：15 項 Go/No-Go 燈牆 + 相機即時畫面 + 關閉路徑三格",
  Component: Health,
};
