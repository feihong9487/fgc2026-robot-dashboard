# FGC 2026 · Igniting Innovation · 程式與儀表板總覽

更新：2026-09-06。隊伍 Control Hub：SSID `FTC-Nvlv`（密碼 `password`）、RC 11.2／OS 1.1.6、硬體組態 `FGC2026`、鏡頭 `Webcam 1`。

## 資料夾

| 路徑 | 內容 |
|---|---|
| `teamcode-v3/` | **機器人端（OnBot Java，已上機）**：27 支 .java，Hub 上分三層——根目錄是你原本的 7 支＋TeleOp Match/Pit/blue_drive/red_drive，`dash/` 是橋接器 14 支，`vision/` 是 TagCam＋AimAssist。`README-deploy.md` 是部署手冊。`tools/check.ps1` 本機編譯；`tools/deploy.py` 一鍵上傳＋Build；`tools/backup.ps1` 每晚備份。`backup/` 是每次上傳前自動備份的 Hub 原檔。 |
| `teamcode/` | 原始 v2 程式（未改動，留作對照）。 |
| `dashboard/` | **FGC 儀表板**（Vite + React + TypeScript，從 VMX 儀表板複製後改造）。`npm run dev` 開發；`npm run build` 打包；`README.md` 有連線與快捷鍵說明。 |
| `fake-hub/` | 假 Control Hub（Node）：`node fake-hub.mjs --mode PIT`，模擬 8080/8081，讓儀表板離線開發。`fake-rec/` 內含真機錄影樣本 `real-B1PIT-20260906-174830.jsonl`。 |
| `apriltag-official/` | 官方 AprilTag jar、OnBot Java／Blocks 範例、A4／Letter 印刷 PDF（已解壓）、README（含 5 個標籤的場地座標）。 |
| `backup/` | Hub 上的 OnBotJava 原始碼備份與下載的錄影檔。 |
| `儀表板方案-2026-09-06.html` | 決策文件（要不要 Android Studio、架構、規則、四週計畫）。線上版：https://claude.ai/code/artifact/3defafaf-6e9c-4244-a30a-2c6998e7c0e8 |

## 三十秒流程

**改機器人程式**：改 `teamcode-v3/*.java` → `powershell -File tools\check.ps1`（EXIT 0）→ `python tools\deploy.py --base http://192.168.43.1:8080`（筆電連 Hub Wi-Fi）或 `--base http://127.0.0.1:18080`（經 Driver Hub adb 中繼）→ Driver Hub 重跑 OpMode。只有動到 `DashHub`／`DashBridge` 標「★ 凍結介面 ★」的常數值才需要重開 Control Hub 電源。

**練習／調參**：Driver Hub 選 `B1-PIT`；儀表板連 `192.168.43.1`（或中繼 `127.0.0.1` + port 18080/18081）。

**比賽**：Driver Hub 依聯盟選 `A1-blue_drive (tag 103)` 或 `A1-red_drive (tag 101)`（開相機，按住 Circle 只朝該 tag 轉）；`A1-MATCH` 是不開相機的備用版。三支都是比賽封鎖：不推播、只在機器人上錄影；筆電留 pit。賽後選 `Z-DASH-EXPORT` 或 `B1-PIT` 再從儀表板取檔回放。

**關閉橋接器給裁判看**：Driver Hub 選 `Z-DASH-OFF`（5 秒，`/dash/health` 回 404）；或選 `Z-FALLBACK-v2`（完全沒有橋接器的原版）。

**每晚備份**：筆電在 Hub Wi-Fi 上時 `powershell -File teamcode-v3\tools\backup.ps1`（它會自己 `adb connect 192.168.43.1:5555`）。只接得到 Driver Hub 時先開 adb 隧道再跑：

```
adb -s 4315Q2U9R9 shell "toybox nc -L -p 15555 toybox nc 192.168.43.1 5555"   # 常駐
adb -s 4315Q2U9R9 forward tcp:15555 tcp:15555
adb connect 127.0.0.1:15555
powershell -File teamcode-v3\tools\backup.ps1 -Serial 127.0.0.1:15555
```

抓的是原始碼（含 dash/、vision/）、硬體組態 `FGC2026.xml`、錄影、matchlogs，存 `backup\<時間>\` 並壓 zip。

## 儀表板（2026-09-06 晚上完成）

```
cd C:\Users\feihong\Desktop\FGC2026\dashboard
npm ci            # 第一次
npm run dev       # http://127.0.0.1:5173  → 頂欄 host 框填 192.168.43.1（直連）或 127.0.0.1（中繼，齒輪裡切 18080/18081）
```

- 離線練習用假 Hub：另開一個終端 `npm run fake-hub`（8080/8081），host 填 `127.0.0.1`。
- 五個分頁：駕駛 D、shooter S、參數 T、檢查 C、訊號 A；齒輪切主題（暗色／賽場高對比）、密度、中繼埠。
- 機器人 A1-MATCH 時整頁自動變成灰階「比賽模式鎖定」，零輸入元件；賽後 `Z-DASH-EXPORT` 或 `B1-PIT` 再到「檢查」頁下載錄影、按「回放」。
- 用語：機器人兩端叫 **shooter 端／intake 端**，不用「射手／吸取」。
- 送 commit 前跑 `npm run check`（typecheck + build + 225 項純函式檢查）。細節、規則合規（M01/M09/M11/G13/R14）、故障排除都在 `dashboard/README.md`。
- 視覺方向 A「野火暗色工業風」：token 在 `dashboard/src/fgc/styles/tokens.css`，設計計畫備份在 `dashboard/docs/design-plan.md`。

## Driver Hub adb 中繼（筆電不用切 Wi-Fi）

```
adb -s <DriverHub序號> shell "toybox nc -L -p 18080 toybox nc 192.168.43.1 8080"   # 常駐
adb -s <DriverHub序號> shell "toybox nc -L -p 18081 toybox nc 192.168.43.1 8081"   # 常駐
adb -s <DriverHub序號> forward tcp:18080 tcp:18080
adb -s <DriverHub序號> forward tcp:18081 tcp:18081
```

## 2026-09-06 真機結果摘要

- Day 1 五檢查點（8080 註冊、8081 訂閱、Build 不重開機生效、Restart Robot ×2 恢復、寫回／拒絕）全部通過。
- 射手 spin-up：電池 12.5 V 時 1721 ms、充飽 14.4 V 時 1396 ms；spin-up 瞬間電壓掉約 3.3 V（射手約 21 A）→ **檢查主電源開關／XT30／電池線**；可先把 `IDLE_TPS` 調到約 1000 減少衝擊。
- AprilTag 102 在 0.4–1.8 m 穩定辨識（28 fps）；瞄準輔助（Circle）轉向方向正確。
- loop p50 15 ms、p95 21–24 ms（開相機）。
