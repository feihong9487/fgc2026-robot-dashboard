// PIT ① 駕駛 DRIVE —— 練習跑時最常打開的一頁（§2.2）。
//
// 版面照 §4.1：左 62% 全給「現在能不能射」，右 38% 給「時間 / 車頭 / 爬升 / 警報」。
// **全頁零按鈕**——右上只有分頁切換（那是 ConnectionBar 的事），這一頁本身沒有任何
// 可點的東西。G13 要求前端不存在任何射擊或動作控制路徑，做法不是把按鈕 disable，
// 而是根本沒有畫上去。
//
// 效能（§7.5 第 10 點）：掛零張 uPlot，只訂閱 14 個 key，五個高頻視覺各自 rAF
// 直接讀 LogStore，React 只管「這個面板存不存在」。
//
// 降級（§4.7）用 matchMedia 真的 unmount 而不是 display:none：隱藏的 canvas
// 一樣會跑 rAF，而 1366×768 的舊筆電正是最沒有 CPU 可以浪費的那一台。

import { useEffect, useState } from "react";
import { ShotReadyLight } from "../components/drive/ShotReadyLight";
import { SpinDualGauge } from "../components/drive/SpinDualGauge";
import { StateRibbon } from "../components/drive/StateRibbon";
import { HeadingChip } from "../components/drive/HeadingChip";
import { ClimbLadder } from "../components/drive/ClimbLadder";
import { MatchClock } from "../components/drive/MatchClock";
import { BallRhythm } from "../components/drive/BallRhythm";
import { GamepadStrip } from "../components/drive/GamepadStrip";
import { HopperCmdStrip } from "../components/drive/HopperCmdStrip";
import { AlertRail } from "../components/drive/AlertRail";
import { useBreakpoint } from "../components/drive/driveModel";
import { getTheme } from "../lib/theme";
import { usePalette } from "../lib/hooks";
import type { PageDef } from "./registry";
import "../styles/drive.css";

function Drive() {
  const bp = useBreakpoint();
  const [full, setFull] = useState(false);

  // F：巨燈全螢幕；Esc 還原（§5.1）。用 CSS 覆蓋層而不是 Fullscreen API——
  // 後者要使用者手勢、在無頭截圖與 Tauri WebView2 下的行為都還沒實測。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable) return;
      if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        setFull((v) => !v);
      } else if (e.key === "Escape") {
        setFull(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // field 主題（賽場、站著看、隔 1.5 公尺）的字級是 1.6 倍、密度 9px，
  // 同一個視窗高度裝下的東西少很多——實測 1440x900 下巨燈從 133px 掉到約 60px，
  // 那正好把 field 主題唯一的用途（遠距讀那一個單字）弄壞。
  // 所以 field 視同「窄一階」：砍掉球節奏與按鍵燈條，把高度還給巨燈。
  usePalette(); // 訂閱主題變更，換主題時這一頁要重算版面
  const fieldTheme = getTheme() === "field";

  // < 1024：只保留巨燈 + 狀態膠囊 + 車頭 + 爬升柱，單欄垂直堆疊
  const tiny = bp === "sm";
  // 1024–1199（1366x768 舊筆電）：砍掉按鍵燈條與球節奏卡；巨燈字級不變
  const dense = bp === "md" || tiny || fieldTheme;

  if (full) {
    return (
      <div className="drive-full">
        <ShotReadyLight full />
      </div>
    );
  }

  return (
    <div className={`drive bp-${bp}`}>
      <div className="drive-left">
        <ShotReadyLight />
        {!tiny && <SpinDualGauge />}
        <StateRibbon />
        {!dense && <BallRhythm />}
        {!dense && <GamepadStrip />}
      </div>
      <div className="drive-right">
        {!tiny && <MatchClock />}
        <HeadingChip />
        <ClimbLadder />
        {!tiny && <AlertRail />}
        {!dense && <HopperCmdStrip />}
      </div>
    </div>
  );
}

export const DrivePage: PageDef = {
  id: "drive",
  label: "駕駛",
  hotkey: "D",
  hint: "練習跑：現在能不能射、車頭是哪端、還剩幾分",
  Component: Drive,
};
