// 檢查分頁（PIT · Go/No-Go 全螢幕）。
//
// 使用時機：上場前 30 秒、檢錄。所以它不捲動、不分欄、一眼看完。
// 底部是關閉路徑三格（#37）與備份徽章（#38）——兩者都是「賽場上的隊務」而不是
// 「機器人的狀態」，放在同一頁是因為打開這一頁的人剛好就是要處理這兩件事的人。

import { HealthWall } from "../components/health/HealthWall";
import { BackupNudge } from "../components/health/BackupNudge";
import type { PageDef } from "./registry";
import "../styles/health.css";

function Health() {
  return (
    <div className="hw-page">
      <HealthWall />
      <BackupNudge />
    </div>
  );
}

export const HealthPage: PageDef = {
  id: "health",
  label: "檢查",
  hotkey: "C",
  hint: "上場前 30 秒、檢錄：15 項 Go/No-Go 燈牆 + 關閉路徑三格",
  Component: Health,
};
