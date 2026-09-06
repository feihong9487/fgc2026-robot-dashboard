# FGC 2026 儀表板 v2 規格書

> 目標實作位置：`C:\VMX Robot\Worldskills-Mobile-Robot-main\dashboard-app`（新增 FGC profile）
> 機器人端真相來源：`C:\Users\feihong\Desktop\FGC2026\teamcode-v3\`（本規格所有 key／端點皆已逐檔核對）
> 版本：v2.0 · 2026-09-06

---

## 0. 事實校正（在讀本規格之前必看）

三份候選設計與兩位評審共提出大量 key／端點假設，我逐檔核對後，**以下為唯一真相**。任何與此不符的敘述一律以本表為準。

| 項目 | 三案的假設 | **實際（已核對）** | 證據 |
|---|---|---|---|
| 模式 key | `/FGC/Robot/Mode` | **`/FGC/Bridge/Mode`**（只有 `"PIT"` / `"MATCH"`） | `DashPublisher.java:76`、`DashHub.java` `MODE_PIT/MODE_MATCH` |
| 狀態機 | `/FGC/Robot/State` | **`/FGC/Drive/State`**（`COLLECT`/`SHOOT`/`EJECT`） | `FGC2026_TeleOp_Match.java:339` |
| 達速旗標 | `/FGC/Shooter/At Speed` | **`/FGC/Shooter/AtSpeed`** | `:345` |
| 射手目標 | `/FGC/Shooter/SL Target` | **`/FGC/Shooter/TargetL` / `TargetR`**（way 無 Target key） | `:343-344` |
| 電流 | `/FGC/Shooter/SL Amps` | **`/FGC/Shooter/CurrentL/CurrentR/CurrentWay`** + `OverCurrentL/R/Way` | `:348-353` |
| 手把 | `/FGC/Input/*` | **`/FGC/Gamepad/{LY,RX,LT,RT,Cross,Square,L1,R1,DUp,DDown}`** | `:361-370` |
| 電池／迴圈／比賽時間 | `/FGC/Robot/*`、`/FGC/Match/Elapsed` | **`/FGC/Status/{Battery V, Loop ms, OpMode, Match s, Hubs}`**；`/FGC/Robot/` 命名空間**完全不存在** | `:373-376` |
| Build tag | `/FGC/Bridge/Build Tag` | **`/FGC/Bridge/Build`** | `DashHub.java` |
| 連線數 | `/FGC/Bridge/Clients` | **`/FGC/Bridge/Viewers`** | `DashWs.java:23`、`DashPublisher.java` |
| 相機 fps | `/FGC/Cam/FPS` | **`/FGC/Vision/FPS`**（視覺）與 `/FGC/Camera/{Frames,Frame KB,Clients,Last Error}`（串流）是兩組 | `TagCam.java`、`DashMjpeg.java` |
| AprilTag | `/FGC/Tag/<id>/*` | **只有 `/FGC/Vision/Best/{Id,Range m,Bearing deg,Yaw deg,Margin,Age s}` 與 `/FGC/Vision/Age/<id>`**；per-id 五列表需新埋點 | `TagCam.java` |
| 連通性探針 | `GET /dash/ping` | **不存在**。八條路徑寫死在 `DashHub.java:60-67`：`/dash/health`、`/dash/state.json`、`/dash/set`、`/dash/rec.json`、`/dash/rec.jsonl`、`/dash/stream.mjpg`、`/dash/snapshot.jpg`。`Z-DASH-PING` 是 OpMode 不是端點 | `DashPing.java` |
| 錄影清單 | `GET /dash/rec/` | **`GET /dash/rec.json`**（回 `{dir,current,files:[{name,size,mtime}]}`）＋ **`GET /dash/rec.jsonl?name=<檔名\|live>`** | `DashHttp.java:167-225` |
| MATCH 時哪些端點 503 | 「rec 也 503」 | **【2026-09-06 17:20 更新，機器人端審查後已改】MATCH 時 `/dash/state.json`、`/dash/set`、`/dash/stream.mjpg`、`/dash/snapshot.jpg`、`/dash/rec.json`、`/dash/rec.jsonl` 全部回 503**（rec.* 也關閉，堵住 `name=live` 旁路）。只有 `/dash/health` 在 MATCH 回 200（含 mode/build/gen/threads/rec 檔名/reclines，零比賽資料）。8081 的 hello 在 MATCH 只回 `/FGC/Bridge/*` + `/FGC/Status/OpMode` 白名單子集。賽後取檔：Driver Hub 跑 **Z-DASH-EXPORT**（開總開關 + 切 PIT + 螢幕列出最新 6 個錄影檔名）或 B1-PIT，再 GET `/dash/rec.json` → `/dash/rec.jsonl?name=<檔名>`（**一定要指定 name**，因為 INIT 會開新檔）。RecBrowser 在 MATCH 收到 503 要顯示「比賽模式：賽後切 B1-PIT 或 Z-DASH-EXPORT 再取檔」而非錯誤 | `DashHttp.java`（fixer 後） |
| 瞄準輔助按鍵 | L1 | **Circle**（`gamepad1.circle`；L1 維持關球倉）；新增 `/FGC/Gamepad/Circle` | `FGC2026_TeleOp_Match.java` |
| 標籤庫來源 | — | `/FGC/Vision/Library` = `official` / `local` / `field` | `TagCam.java` |
| 錄影 ring | 6000 行 | 6000 行 **且 2 MB** 位元組上限；`rec.jsonl` 改串流回應 | `DashRec.java` |
| spin-up | 「需新增埋點」 | **`/FGC/Shooter/SpinupMs` 已存在**（機器人端 latch 計時） | `:215-224, :347` |
| 機器人時戳 | 「nt 封包沒有時間欄位，需新增 `/FGC/Robot/t`」 | **`/FGC/Status/Match s` 每圈重算且必然變動 → 必進 dirty → 每一批 nt 與每一行錄影都帶著它。時戳已經有了** | `:376`、`DashHub.java:242` diff 邏輯 |
| 白名單 | 15 項 | **21 項**（多 `TAG_DECIMATION, TAG_MIN_MARGIN, AIM_KP, AIM_MAX, MJPEG_FPS, MJPEG_Q`），`MIN[]/MAX[]` 在 `DashParams.java:58-76` | `DashParams.java:37-46` |
| HOLD 護欄 | 「改了不生效，要重新進入保持」 | **已修好**：`ClimbSystem.java:30-33` 的 `else if (appliedHold != Constants.HOLD)` 會即時重套。**三案設計的那顆黃燈會發假警報，一律不做** | — |
| Constants | 「還是 static final、缺六個欄位、不會編譯過」 | **全部 `public static volatile`，六個欄位齊全**（`Constants.java:26-64`）。此判斷完全過時 | — |
| 備援取檔路徑 | `/sdcard/FIRST/java/src/rec/` | **`/sdcard/FIRST/fgc-rec`**（`DIR_NAME="fgc-rec"`，`MAX_LINES=6000`，`FLUSH_MS=10000`） | `DashRec.java:34-39` |
| 假伺服器 | 「要寫一個」 | **`tools/fake-hub.mjs` 已存在（46 KB）**，已實作 namespace 信封、`subscribeToNamespace`、hello/nt/set/err、八條 HTTP 路徑、MATCH 503、串流併發上限，外加 `/dash/mode`、`/dash/enabled` 兩個測試專用端點 | `tools/fake-hub.mjs:1024-1034` |

**新發現的規則風險（三案與兩位評審中只有一位提到，且必須立刻處理）**：
`GET /dash/rec.jsonl?name=live` 回傳「這一場記憶體 ring 的全部遙測」，而 `DashHttp.java` 全檔只有兩處 `pit()` 閘，**這條路徑在 MATCH 完全開放**。這是一條繞過「MATCH 不推播」的即時資料旁路，等同 M01/M09/M11 要罰的行為。前端必須先自律（見 §8），並向機器人端提交一行修補。

---

## 1. 設計主張

**單一真相是「一份帶機器人時戳、可任意 seek 的 log」；即時只是那份 log 的尾端。** 機器人端的推播是 diff（`DashHub.java:242` 值相同直接 return、`DashPublisher.java:41` 只送 `drainDirty()`），所以資料的原生形態本來就是「每個 key 各自的稀疏事件序列」，而不是等間隔取樣表。順著這個形態設計資料層，能一次換到六件別人要各自實作的能力：跨面板時間游標、事件標記與跳轉、任意區間統計、A/B 疊比、快照同步、選區匯出——而且**同一套面板程式碼在 PIT 即時與 REPLAY 回放兩種情境下都正確，不需要寫兩套**。

在這個地基上疊三條不可退讓的規則：
1. **模式是結構不是狀態。** MATCH 下控制項「不存在」而非 `disabled`。模式真相只來自 `/FGC/Bridge/Mode`，前端沒有任何切換它的 UI；**未知即鎖**。
2. **每個 widget 必須二選一**：通過「1.5 公尺外瞥 0.5 秒答對」，或產出一個能拿去跟另一組參數比較的數字。兩者都不是的東西不進 v1。
3. **誠實優先於美觀。** 取樣率 < 10 Hz 的資料標 chip 並畫散點；資料缺口畫斜線不內插；送出未回讀的值一律橘框。

### 三者各借了什麼

| 功能 | 來源 | 我們怎麼做得更好 |
|---|---|---|
| 自動發現 key → 勾選繪圖 | FTC Dashboard `GraphView.tsx:105-128` | 它只收 `parseFloat` 得出的數值 key（`:115`）且 `availableKeys` 只增不減會累積死 key。我們依 `/FGC/<子系統>/<名稱>` 建樹，布林/字串可拖進離散色帶，並加「只顯示最近 N 秒有更新」開關 |
| 圖表時間基準補償 + rAF 連續捲動 | FTC `Graph.ts:276-320`（刻意落後 250 ms） | 它硬編 −250 ms 且只保留 `windowMs+250` 就 `shift()` 丟棄（無法回捲）。我們改用 `/FGC/Status/Match s` 的真實機器人時戳，整場全留（150 s × 60 key ≈ 2.9 MB，不需 ring buffer），暫停＝凍結視窗但繼續累積 |
| 暫停會清空歷史 | FTC `GraphCanvas.jsx:48-50` `graph.reset()` | **這是缺陷不是特性**。我們的暫停只跳過 `setScale("x")`、繼續 `setData`，所以「暫停 → 放大看剛剛那一下 → 恢復」不掉任何歷史 |
| 參數髒標記 `*` / 只送 diff / 不覆蓋草稿 | FTC `ConfigView.tsx:24-71`、`reducers/config.ts:42-95` | 它有髒標記但**沒有回讀對帳**。我們做左送出（`/FGC/Tune/*`）右回讀（`/FGC/Param/*`）雙欄四態，並加寫回帳本顯示被拒原因 |
| Copy Config to Clipboard + http fallback | FTC `CustomVariable.tsx:79-87`（`isSecureContext` 判斷 → `execCommand`） | 機器人端已把片段組好放在 `/FGC/Param/_Snippet`（`DashParams.java:229`），前端只要複製字串。fallback 一定要抄——Control Hub 是 http，`navigator.clipboard` 是 `undefined` |
| ResizeObserver + devicePixelRatio 高解析 Canvas | FTC `AutoFitCanvas.jsx:11-39` | 幾乎原封照抄，只加 100 ms debounce 與靜態層離屏快取（爬升柱刻度、時序帶格線不每幀重畫） |
| 三區座標軸：左軸 / 右軸 / **discrete 區** | AdvantageScope Line Graph | **FRC 側最值得抄的單一元件**，Shuffleboard/Elastic/Glass 都沒有。我們把它做成獨立的 `DiscreteBand`（Canvas run-length），共用 uPlot 的 x scale |
| 跨分頁時間游標同步 | AdvantageScope | uPlot 原生 `cursor.sync`（`uPlot.d.ts:508-518` 有 key/setSeries/scales/match，另有 static `uPlot.sync(key)`），但**由我們的 `cursorStore` 當真相、uPlot 當被驅動方**——因為時序帶、場地圖、Inspector 都不是 uPlot |
| 統計：Reference / Relative Error / 直方圖 | AdvantageScope Statistics | 只保留 count/min/max/mean/**σ** + 直方圖。σ 是決定命中率的物理量；相對誤差分布在 10 次以下樣本會誤導，不做 |
| Lock Layout（比賽日鎖版面） | Elastic | 它是「鎖住的可拖版面」；我們推到極致做成**另一頁**：分頁列、host 框、滑桿在 MATCH 根本不 render |
| 機器人主動通知（level/title/ttl） | Elastic ElasticLib Notifications | 不改協定——`DashWs.broadcast(type,payload)` 的 type 是任意字串（`DashWs.java:93`），機器人端只要 `broadcast("notify", json)` 一行。**加分：通知同時寫進 log 成為一類事件**，賽後回放時間軸上看得到 |
| 相機串流未使用時自動停用 | Elastic | 我們加三重閘（PIT 且 tab 可見 且 IntersectionObserver 在視窗內），不成立時 `src=""` **真斷連**；並在按鈕旁即時顯示「開串流後 loop p95 +N ms」，把代價和決定放在同一視野 |
| Match Time 色碼倒數 | Elastic | 起算點用機器人端已有的 `/FGC/Status/Match s`，不讓前端自己按碼表 |
| Split Button Chooser（≤5 選項攤平） | Elastic / Shuffleboard `kSplitButtonChooser` | 下拉在 pit 裡選錯了畫面上看不出來。狀態機膠囊做成「按鈕的樣子但無 hover/active」——G13 要求無任何射擊控制路徑 |
| 「已在底部才自動捲」 | FTC `CustomVirtualGrid.tsx:87-105`（`scrollUpdateWasRequested`） | 直接沿用，套用到事件清單與寫回帳本 |
| Go/No-Go 燈牆：純函式 `buildChecks` + 失敗才顯示 hint | **VMX `StatusPanel.tsx:22-27`（既有）** | 沿用整個模式，只換檢查項。fail 時給處置提示＝把隊內 know-how 寫進 UI |
| 常駐生命徵象頂欄 + 500 ms 強制重繪讓數字持續變舊 | **VMX `ConnectionBar.tsx:29-32, 44-45`（既有）** | 沿用；stale 門檻由 500 ms 收緊到 250 ms（推播週期是 `PERIOD_MS=50L`） |
| 草稿-送出輸入模式（`draft: string\|null`） | **VMX `controls.tsx`（410 行既有）** | 遙測 20 Hz 回推，受控元件直接綁 store 會讓你打到一半被蓋掉。整份沿用 |
| 節流寫回（pending Map 去重 + 尾端補送） | **VMX `VisionPanel.tsx:25-38`（既有 14 行）** | 提升成 `client.setThrottled(key, v)` 給所有可調控件共用 |
| 宣告式 Phase 陣列的模擬源 | **VMX `sim.ts`（619 行既有）** | 不重寫。改用「載入一份錄好的 jsonl 進 REPLAY」當離線資料源（成本 0 行），並靠已存在的 `tools/fake-hub.mjs` 做雙向 set 往返 |
| Canvas 不吃 CSS 變數，主題色要以 props 傳進繪圖層 | FTC `GraphView.tsx:317-331` | 做成 `theme.ts`：開機 `getComputedStyle` 讀一次快取成 JS 物件，主題切換重讀。順便一次清掉 tsx 裡 **103 處硬編碼 hex**（`Chart.tsx:38-47` 的 `#8b95a7` 軸色與 `#2a3040` 格線在內） |

---

## 2. 資訊架構

### 2.1 三個模式（前端無切換 UI）

```
/FGC/Bridge/Mode == "PIT"     且 ws 已連  →  PIT     （唯一可寫回）
/FGC/Bridge/Mode == "MATCH"                →  MATCH   （Lockdown 單頁）
Mode 未知 / 尚未收到 hello / ws 斷線       →  MATCH   ← 預設鎖住，不是預設開放
使用者載入 jsonl（拖放 / rec.json）        →  REPLAY  （不建立 ws，物理上不可寫）
```

`store.mode` 是獨立欄位，**不塞進既有的 `ConnState`**（`store.ts:12` 的五態不動，否則所有既有 switch 都要改）。

> **裁決（衝突：要不要第四個 DRIVE 模式）**：driver-first 主張四模式、另兩案主張三模式。採折衷——**DRIVE 是 PIT 模式底下的一個分頁，不是第四個模式**。理由：`/FGC/Bridge/Mode` 在機器人端只有兩值，多做一個模式維度會讓 §8 的硬閘判斷變複雜；但另兩案把「練習駕駛」這個佔 90% 使用時間的情境整個漏掉，而它恰好最便宜（全 Canvas、零張 uPlot、只訂閱 14 個 key）。

### 2.2 分頁

| 模式 | 分頁 | 誰在看 | 何時看 |
|---|---|---|---|
| **PIT** | ① **駕駛** DRIVE | 駕駛、教練 | 練習跑（最常打開的一頁） |
| | ② **射手** | 程式 | 調 VEL/FEED_THRESHOLD/IDLE_TPS |
| | ③ **參數** | 程式 | 寫回對帳、複製 Constants 片段 |
| | ④ **檢查** | 全隊 | 上場前 30 秒、檢錄 |
| | ⑤ **視覺** | 程式 | AprilTag 標定（條件項，見 §9） |
| | ⑥ **訊號** | 程式 | 新埋點驗證、找沒想到的那個 key |
| **MATCH** | **Lockdown**（唯一一頁，無分頁列） | 裁判、志工、隊員 | 比賽期間 |
| **REPLAY** | ① **分析**　② **事件/統計** | 程式、隊長 | 賽後檢討 |

分頁不做成自由拖曳版面（理由見 §5.3），而是四套固定 CSS Grid。

### 2.3 頂欄（44 px，永遠存在；MATCH 只剩四項）

```
[模式徽章] [Build] [OpMode] │ ws age · 8080 燈 │ ⌁電壓 · loop p50/p95 │ ⏺錄影行數 · flush age │ Thr │ [分頁]
```

| 欄位 | key / 來源 | 為什麼在頂欄 |
|---|---|---|
| 模式徽章 | `/FGC/Bridge/Mode` | 「能不能動」的最終答案 |
| Build | `/FGC/Bridge/Build` | 賽場上最常被問的是「你們現在跑的是哪一版」，比任何波形都常被問 |
| OpMode | `/FGC/Status/OpMode` | 分辨 A1-MATCH / B1-PIT / Z-FALLBACK-v2 |
| ws age | `store.lastBatchAt` 的年齡（**不是 ping**） | ws 沒斷但 OpMode 卡住很常見，ping 會騙人。沿用 `ConnectionBar.tsx:44` 的判定，門檻 250 ms |
| 8080 燈 | `GET /dash/health` 每 3 s | 兩條通道會各自壞，合成一顆燈會誤診 |
| 電壓 / loop | `/FGC/Status/Battery V`、`Loop ms`（p50/p95 前端滾動算） | 本案唯二有數值驗收線的量（11.5 V / 25 ms） |
| 錄影行數 | `/FGC/Rec/Lines`、`/FGC/Rec/File` | 比賽日整套方案唯一有價值的產出就是那個 jsonl，行數在動是它活著的唯一證據 |
| Thr | `/FGC/Bridge/Threads` | ≠1 就是殭屍推播執行緒（舊 ClassLoader 沒收工），是最難查的症狀之一 |

**所有數字塊固定寬度 + `font-variant-numeric: tabular-nums` + 右對齊**（抄 FTC `Dashboard.tsx:60-71`）。值變動時右邊圖示不左右晃——在 3 秒律下版面跳動比數字錯誤更致命，因為眼睛會被吸引去追移動的東西。

---

## 3. Widget 目錄

估行數含樣式與型別，不含測試。**★ = 不可砍**。

### 3.1 地基（非視覺）

| # | 名稱 | 資料 key | 行為 | 來源 | 行數 |
|---|---|---|---|---|---|
| ★1 | **LogStore** | 全部 | 每欄位獨立稀疏時間軸（`Float64Array` 手動 2× 成長，永不 `splice`）；`valueAt(id,t)` = 二分搜尋 + zero-order hold；`sampleWindow(t0,t1,maxPts)` 做 min/max decimation；**可實例化**（`{live, A, B}`）供 A/B；`applyBatch(d)` 從 `d["/FGC/Status/Match s"]` 取機器人時戳，缺席才退回本機時鐘並記 `tSource` | replay-first LogStore + tuning-first 的 resample | 320 |
| ★2 | **cursorStore** | 無 | `hoverT`（60 Hz，只驅動十字線與懸停欄，**不進 React state**）／`cursorT`（點擊/播放設定，驅動所有面板）／`selection`／`playRate`／`liveLock`。**與 LogStore 分開是正確性問題**：滑鼠移動不該重設使用者選定的時刻 | replay-first | 90 |
| ★3 | **fgcKeys.ts** | — | 21 項白名單的 `{name, kind, min, max, step, unit, group, coachRisk}`；min/max **逐字對應 `DashParams.java:58-76`**，並用既有的 `npm run golden` 加一支比對防漂移 | tuning-first | 160 |
| 4 | **theme.ts** | — | 開機 `getComputedStyle` 把所有 token 讀成 JS 物件；主題切換重讀並廣播。Canvas/uPlot 一律從這裡取色 | FTC `GraphView.tsx:317-331` | 70 |
| 5 | **eventDetect.ts** | 見下 | 純函式 `detect(log)` → 八類標記。即時增量呼叫、回放一次性全掃，**同一支函式** | replay-first + tuning-first | 190 |
| 6 | **persist.ts** | — | 統一前綴 `fgc.` + schema 版本 + migration + 匯出/匯入全部設定。現況 9 個 localStorage 鍵散在 7 個檔案、兩套命名、無版本 | 三案共識 | 80 |

**事件八類**（規則全部從 `FGC2026_TeleOp_Match.java:169-176` 的狀態機推導，因為它夠簡單）：
① 進入 SHOOT ② spin-up 完成（`SpinupMs` latch）③ 每球 dip（SHOOT 期間 `SL` 局部極小、深度 > 150 tps，屬性含底值/恢復 ms/是否跌破**當時的** `/FGC/Param/FEED_THRESHOLD` 回讀值）④ 爬升段（`Climb/Holding` 邊緣）⑤ EJECT ⑥ 車頭反轉 ⑦ 電壓局部谷（< 12.0）⑧ 故障（`OverCurrent*` 上升緣 / `Loop ms` > 25 / ws 缺口 > 1 s / `Last Error` 變動）

### 3.2 DRIVE 分頁

| # | 名稱 | 資料 key | 行為 / 警戒色 | 來源 | 行數 |
|---|---|---|---|---|---|
| ★7 | **ShotReadyLight** 巨燈 | `/FGC/Drive/State`、`/FGC/Shooter/AtSpeed`、`SL`、`SR`、`TargetL`、`TargetR` | 四態：IDLE 灰空心圓 ○／SPINUP 黃三角 ▲ **+ 進度環** `min(SL,SR)/min(TargetL,TargetR)`／READY 綠實心圓 ●／EJECT 紅方塊 ■。字高 ≥ 96 px。Canvas + 自己 rAF，不走 React。`F` 全螢幕化 | driver-first；Elastic Boolean Box 放大 | 150 |
| 8 | **SpinDualGauge** 雙飛輪半環 | `SL`、`SR`、`TargetL`、`TargetR`、`/FGC/Param/FEED_THRESHOLD` | 兩個 270° 半環左右鏡像；目標畫成環上 ±3% 綠容差帶，FEED_THRESHOLD 一道紅刻。**中央置中失衡條 (SL−SR)**：> 100 tps 變紅並顯示「側旋」 | driver-first + tuning-first BalanceBar | 170 |
| ★9 | **BalanceBar** 失衡（併入 #8） | 同上 | `ShooterSystem.java:34` 的 `atSpeed` 是兩顆各自比門檻的 `&&`，**從未比較兩顆是否一致**。純前端相減、零機器人端成本，卻能在拆機構之前先排除「落點偏是軟體造成的側旋」。全目錄投報比最高的單一功能 | tuning-first | （含在 #8） |
| 10 | **StateRibbon** 狀態膠囊 | `/FGC/Drive/State` | 三格橫排，當前格填色 + 字加粗，其餘 30% 不透明。**刻意做成「按鈕的樣子但無 hover/active、不可點」**——G13 要求前端無任何射擊控制路徑。色彩與 DiscreteBand、事件軌共用 `--state-*` token | Elastic Split Button（唯讀版） | 70 |
| 11 | **HeadingChip** 車頭方向 | `/FGC/Drive/Reversed`、`Forward`、`Turn` | 64 px 雙箭頭 +「吸取端為前 / 射手端為前」六個大字，切換時整格閃 300 ms。`reversed` 開局預設 `true`（`FGC2026_TeleOp_Match.java:130`）、□ 只反前後不反轉向，這是新駕駛撞牆的頭號原因，而 Driver Hub 上它只是一行小字 | driver-first（原創） | 60 |
| 12 | **ClimbLadder** 爬升階梯柱 | `/FGC/Climb/Pos`、`Holding`、`Current`、`OverCurrent` | 垂直柱，柱上刻 **50 / 110 / 130 / 150 分數線**而非 encoder counts——隊長要的是「再上一格值 20 分」。`Holding` 為 true 時柱底亮鎖頭。**不做「HOLD 已改需重新進入保持」黃燈**（`ClimbSystem.java:30-33` 已即時重套，那顆燈會發假警報） | driver-first（修正版） | 110 |
| 13 | **MatchClock** 色碼倒數 | `/FGC/Status/Match s` | 2:30 倒數 + 進度條，藍→綠→黃（剩餘 = 爬升耗時 +5 s）→紅（剩餘 = 爬升耗時）。門檻存 localStorage。**起算點必須用機器人端的 `Match s`，前端不可自己按碼表** | Elastic Match Time | 90 |
| 14 | **BallRhythm** 球節奏 | `/FGC/Shooter/SpinupMs` + 事件抽取的 dip | 本輪已射顆數畫成一排圓點（●●●●●○○）+ 上一顆間隔秒 + 本次 spin-up ms（括號內中位/最大）。`IDLE_TPS=0`（`Constants.java:32`）表示每次 COLLECT 都把飛輪停死，spin-up 就是「按下 R2 到第一顆球出膛」的死時間，是 500 顆球吞吐量遊戲裡最貴的固定成本 | driver-first + AdvantageScope Statistics | 100 |
| 15 | **GamepadStrip** 按鍵燈條 | `/FGC/Gamepad/*` 十顆 | DRIVE 是 8 顆橫排燈（即時）；REPLAY 是時序帶。RT/LT 送類比值並畫 0.5 門檻線（對應 `FGC2026_TeleOp_Match.java` 的判定）才看得出「按到一半」。教練站在駕駛後面時，這是判斷「機器人壞了 vs 駕駛沒按」的唯一即時證據 | AdvantageScope Joysticks | 100 |
| 16 | **HopperCmdStrip** 開迴路誠實標示 | `/FGC/Hopper/Cmd` | 只顯示「指令」，標題明寫「CRServo 無回授，此為指令值」，灰底無圖示，視覺上刻意與有回授的 ClimbLadder 區隔。`HopperSystem` 用 CRServo，介面沒有 `getPosition`——若畫成「開/關狀態圖示」使用者會當回授，卡球時反而找錯方向 | driver-first（誠實優先） | 60 |
| 17 | **AlertRail / Toast** | ws `notify` type + 前端自產 | DRIVE 右下 rail 最多 3 條（ERROR 不消失、WARN 8 s、INFO 4 s）；PIT 右上 toast + 可捲事件日誌。ERROR 附 WebAudio 兩短嗶（駕駛眼睛在場上不在螢幕），**MATCH 絕不出聲也不顯示**。通知同時寫進 log 成為第九類事件 | Elastic Notifications | 130 |

### 3.3 射手 / 參數分頁

| # | 名稱 | 資料 key | 行為 / 警戒色 | 來源 | 行數 |
|---|---|---|---|---|---|
| ★18 | **LineGraph** 三區軸折線 | 任意 number；目標線用 `TargetL/TargetR` | 改寫既有 `Chart.tsx`（116 行）。三個 drop zone（左軸/右軸/離散區）。**目標畫成階梯**（`uPlot.paths.stepped`，`uPlot.d.ts:787`）——COLLECT 時 SL/SR 目標是 `IDLE_TPS`、way 是 `−WAY_IDLE_TPS`（**負值**，`ShooterSystem.java:28`），畫成一條 1900 直線會把「way 反轉」誤讀成「送料壞掉」。`FEED_THRESHOLD` 橫線讀 `/FGC/Param/` 回讀值**不可寫死 1200** | FTC GraphView + AdvantageScope + 既有 uPlot | 380 |
| ★19 | **DiscreteBand** 離散色帶 | `/FGC/Drive/State`、`Shooter/AtSpeed`、`Shooter/Way`（取號 +/0/−）、`Hopper/Cmd`、`Gamepad/RT`、`Drive/Reversed` | Canvas run-length 掃描，同值合併色塊，每列 22 px，與 LineGraph 共用 x scale。「前射後吸的瀑布流」本質是 intake→hopper→way→shooter 一條時序管線，而這四段分別由狀態機、bumper、`atSpeed` 閘、trigger 控制，**彼此沒有互鎖**。色帶讓「按了 R2 但 hopper 還關著」變成肉眼可見的錯開色塊，折線圖做不到 | AdvantageScope discrete 區 | 200 |
| 20 | **DipAnalyzer** 每球凹陷 | `SL`、`SR`、`/FGC/Drive/State`、`/FGC/Param/FEED_THRESHOLD` | 表格：序號 / 底值 / 恢復 ms / 是否跌破門檻 + 深度直方圖。這是唯一能把 FEED_THRESHOLD 從猜測變成量測的東西——目標 1900、門檻 1200 表示要掉到 63% 才停止送料。**UI 必須標「解析度 ±50 ms」**（推播 `PERIOD_MS=50L`），恢復時間若只有 150–250 ms 則誤差 20–33% | tuning-first（原創） | 180 |
| 21 | **RangeStats** 區間統計 | 拖入的任一 number | 範圍五選一（選取區間 / 可見視窗 / 整份 log / SHOOT 期間聯集 / 最近 10 s）；輸出 count/min/max/mean/**σ** + 可調 bin 直方圖。**σ 不可砍**：調參的正確問題不是「轉速多少」而是「轉速多穩」，σ 直接量化射手一致性，這是決定命中率的物理量，曲線圖只給模糊印象。Reference/相對誤差模式**不做**（10 次以下樣本會誤導） | AdvantageScope Statistics（裁剪版） | 90 |
| 22 | **CurrentStrip** 電流稀疏帶 | `/FGC/Shooter/Current{L,R,Way}`、`/FGC/Climb/Current` + 四顆 `OverCurrent*` | **散點階梯**（`spanGaps:false` + points），標題掛灰色 `~2 Hz` chip。`FGC2026_TeleOp_Match.java:307-320` 是每圈只讀十分之一輪流（`getCurrent` 不在 bulk cache，是獨立 Lynx 往返），所以取樣率 ≈ loop/10。**一張畫成平滑曲線的電流圖比沒有這張圖更糟**——它誘導使用者做取樣率撐不住的推論。上方一排 `OverCurrent` 布林燈才是高頻的、有用的那一半 | tuning-first + Glass | 120 |
| 23 | **LoopHistogram** | `/FGC/Status/Loop ms` | 直方圖（2 ms 一格）+ 25 ms 紅線 + p50/p95/max。**不是折線**：平均 12 ms 但 p95 40 ms 的機器人手感是頓的，只看即時數字會被平均值騙過去。「存快照對照」鍵把 p50/p95 + Build 存成一列，直接產生 README 要的對照表 | Glass loop timing | 110 |
| ★24 | **TuneTable** 參數雙欄 | **21 項**：左欄 `/FGC/Tune/<NAME>` 送出、右欄 `/FGC/Param/<NAME>` 回讀 | 四態：草稿（橘框 `*`）→ 已送出未回讀（橘框 + 旋轉點，> 1 s 轉紅）→ 一致（綠勾 1.2 s 淡出）→ 被拒（紅框 + `/FGC/Bridge/Last Set Rejected` 的 why）。**寫回鏈路有三道會默默吃掉你的值的關卡：白名單（`DashParams.java:37-46`）、範圍夾限（`:58-76`）、MATCH 拒絕（`DashWs.java:44-47`），單欄 UI 會讓三道全部隱形。** min/max 直接用 `MIN[]/MAX[]`；`WAIT_SPINUP` 是唯一的 bool（`KIND` 表）。滑桿拖動 50 ms 節流。**鐵律：樂觀更新只准套 `/FGC/Tune/*`，絕不可套 `/FGC/Param/*`**（`RobotClient.ts:128` 目前無條件套用，會讓右欄被自己送的值蓋掉，對帳變自欺） | FTC ConfigView + VMX controls.tsx | 260 |
| 25 | **SetLedger** 寫回帳本 | `/FGC/Bridge/Last Set`、`Last Set Rejected`、ws `err`（`{k,why}`）+ 前端自記時戳 | 最近 20 筆：時間 / key / 舊→新 / 回讀延遲 ms / 結果。**寫回失敗有四種原因（不在白名單、超出範圍、MATCH 拒絕、斷線），沒有帳本時它們在 UI 上長得一模一樣——都是「數字沒變」。** 不需新協定，`err` 已存在 | tuning-first | 110 |
| 26 | **ParamDiffCard** | `/FGC/Param/<NAME>` vs `/FGC/Param/Build <NAME>`（**需新增**）、`/FGC/Param/_Snippet`、`_Saved` | 列出「目前值 ≠ 編譯值」+ 三顆鍵：[複製 Constants 片段]（直接複製 `_Snippet`，機器人端已組好）／[存到機器人 `fgc-tune.json`]（`GET /dash/set?k=_save`）／[從機器人讀回]（`k=_load`）。**這是防止「白調一天」的唯一機制**——volatile 參數只活在 RAM，Restart Robot 或換電池就回到編譯值。**http fallback 必抄** | FTC Copy Config | 120 |
| 27 | **CamPane** 相機 | `GET /dash/stream.mjpg?fps=&q=`、`/dash/snapshot.jpg`、`/FGC/Camera/{Frames,Frame KB,Clients}`、`/FGC/Vision/FPS`、`/FGC/Status/Loop ms` | 三態 [串流 / 單張輪詢 / **暫停（預設）**]。切換時即時顯示「開串流代價：loop p95 +N ms、視覺 fps −N%」。三重閘不成立時 `src=""` 真斷連。機器人端併發上限已是 1（`DashMjpeg.java`），第二處開串流時顯示「已被另一個串流佔用」而非無限轉圈 | Elastic + driver-first | 150 |

### 3.4 檢查 / 訊號 / Lockdown

| # | 名稱 | 資料 key | 行為 | 來源 | 行數 |
|---|---|---|---|---|---|
| ★28 | **HealthWall** Go/No-Go | `/FGC/Bridge/{Threads,Gen,Build,Enabled,Viewers,Camera,Last Error}`、`/FGC/Rec/Lines`、`/FGC/Vision/FPS`、`/FGC/Status/{Battery V,Loop ms,Hubs}`、`/FGC/Shooter/{SL,SR,Way}`、`/FGC/Climb/Pos`、`/FGC/Param/*` vs Build、`GET /dash/health` | 5×3 全螢幕燈牆，**失敗時多一行處置提示**（沿用 `StatusPanel.tsx:22-27` 的 `Check{name,ok,detail,hint}` 純函式 + `:12-20` 每秒強制刷新讓「年齡」持續變舊）。三顆指紋燈壓縮三個最貴的除錯路徑：`Threads≠1`＝殭屍執行緒（重開 Hub 電源）／`Build` 沒更新＝委派凍結在舊 ClassLoader／`Viewers≥1` 卻收不到 nt＝namespace 沒訂閱成功。底部一列**關閉路徑三格** | VMX StatusPanel + Elastic Alerts | 230 |
| ★29 | **LockdownPage** | `/FGC/Bridge/Mode`、`/FGC/Bridge/Build` + 每 5 s `GET /dash/health` | 整個 App 只 render 這一頁。巨徽章 + 規則依據一行 + **錄影心跳卡（用 health 的 `reclines`，MATCH 也回 200，所以比賽期間這個數字是真的會動的）** + Driver Hub 導覽卡（**刻意只列名稱不列數值**）。零輸入元件：分頁列、host 框、滑桿都**不存在**而非 disabled | Elastic Lock Layout（推到極致） | 130 |
| 30 | **RecBrowser** | `GET /dash/rec.json` → `GET /dash/rec.jsonl?name=<檔名>` | 表格列檔名/大小/mtime，點選 streaming 解析成 LogStore（`ReadableStream` + `TextDecoder` 逐行，不一次 `split("\n")`）。**兩條路徑都要在 UI 上**：8080 與備援的 OnBotJava 檔案樹 `/sdcard/FIRST/fgc-rec`——Day 1 若 8080 註冊失敗第一條路就沒了，而賽場上不會有時間翻文件。**`name=live` 一律不呼叫**（見 §8） | tuning-first + 既有 `startReplay` | 120 |
| ★31 | **TimeBar** 全域時間軸 | `log.tRange`、`events[]`、`bookmarks[]`、`gaps[]`、cursorStore | 三層：總覽波形（16 px，**整場縮圖，永遠全長不隨縮放改變**——這是「我在哪裡」的地圖）／事件軌（20 px，八類 + 書籤 + **資料缺口斜線紋，絕不內插**）／視窗條 + 播放控制。滾輪以游標為中心縮放、拖曳平移、Shift+拖曳選區。**live lock：往左捲脫離即時（燈熄），捲到最右或按 `L` 自動接回**——省掉一顆「回到即時」按鈕和一次分心 | AdvantageScope | 260 |
| 32 | **Inspector** 游標讀值 | 所有已訂閱欄位 | 三欄：欄位 / `cursorT` 的值 / `hoverT` 的值與差。zero-order hold 二分查值。**過期值（距 cursorT > 2 s 沒更新）顯示灰色 + age，永遠不顯示空白**——把「數值消失」誤讀成「距離 0」是視覺調校最常見的災難。`Ctrl+C` 複製成 Markdown | AdvantageScope legend | 120 |
| 33 | **EventList** | eventDetect 輸出 | 可篩選（**`!` 前綴為排除**——實務上更常需要的是「濾掉那個洗版的」）、點擊 seek、`Ctrl+↓/↑` 跳事件。一場 2:30 有約 3000 批，用眼睛找「第三次射擊為什麼卡住」要五分鐘，有標記是五秒 | AdvantageScope Console | 130 |
| 34 | **Bookmarks** | localStorage（以檔案 hash 為 key） | `Ctrl+B` 在 cursorT 打書籤並彈單行輸入。事件是機器算的、書籤是人看到的；匯出 Markdown 時兩者交錯排在同一張時間表，**就是賽後檢討記錄的初稿**。全目錄成本最低的高價值元件 | replay-first（原創） | 80 |
| 35 | **SignalTree / RawTable** | 全部 `/FGC/**` | 沿用既有 `AllSignalsPanel.tsx`（219 行）並改造四處：(1) 依 `/` 兩層建樹可摺疊；(2) 釘選上限從 6 條（`PIN_COLORS` 長度，`:105` 的 `slice`）改成無上限自動配色 + 線型區分；(3) 分組排序每批重算 O(n log n)（`:110-128`）改成只在 key 集合變動時重算；(4) **非 PIT 時所有欄位改成純文字渲染而非 disabled input**——`:35` 與 `:59` 對任何 key 都直接呼叫 `client.set`，這是規則防線最大的漏洞 | VMX + AdvantageScope 側欄 | 140（改造） |
| 36 | **ExportMenu** | 選區 + 選定欄位 | 四種：CSV（tick 對齊每列一 tick）／Markdown（事件+書籤+統計）／JSONL 剪輯（只留選區，2 MB→200 KB 方便貼給隊友）／Constants 片段。**三層下載路徑**：`navigator.clipboard`（`isSecureContext` 判斷）→ Tauri `plugin-dialog/fs` → `Blob + a.click()` | Shuffleboard Convert + FTC fallback | 130 |
| 37 | **ShutdownStrip** 關閉路徑三格 | `GET /dash/health` | ① 未連筆電 ② `Z-DASH-OFF` 已生效（**health 回 404**）③ `Z-FALLBACK-v2` 執行中。**判定依據是可觀測狀態（404）而不是「我按了某個按鈕」**——`DashBridge.java:124` 停用時對所有註冊路徑回 404。這一格同時當 8080 連通性燈，不必再寫第二個輪詢 | driver-first（原創） | 70 |
| 38 | **BackupNudge** | localStorage | PIT 角落徽章，> 20 h 黃、> 30 h 紅。文案不寫「你還沒備份」（會被無視），寫「距上次備份 26 小時 · 明天第一場 09:40」這種帶後果的句子。`/sdcard/FIRST/settings` 是硬體組態，9 個裝置重建 20 分鐘且最容易錯 | driver-first | 50 |

**v1 總計約 4,140 行**（新增 lib 910 + 新增元件 2,940 + 改造 290）。

---

## 4. 線框（1440 寬）與降級規則

### 4.1 PIT · 駕駛（DRIVE）

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ▲PIT  B7f3a2  B1-PIT │ ws 42ms ● 8080 ● │ ⌁12.4V  loop 11/19ms │ ⏺2413行 4s │ Thr1 │ [射手][參數][檢查] │
├───────────────────────────────────────────────────────┬──────────────────────────────────────────────────┤
│                                                       │  ⏱  1:47   ████████████░░░░░░░░  綠            │
│    ┌───────────────────────────────────────────┐      ├──────────────────────────────────────────────────┤
│    │                                           │      │  ⚑ 車頭                                          │
│    │            R E A D Y                      │      │      ◀◀   吸取端為前                             │
│    │        ◕ 96%     1904 / 1897              │      ├──────────────────────────────────────────────────┤
│    │                                           │      │  ⬆ 爬升                        ● HOLD 0.6        │
│    └───────────────────────────────────────────┘      │    150 ┤░░░░░░░░░░                               │
│                                                       │    130 ┤░░░░░░░                                  │
│      SL ◔ 1904                    SR ◔ 1897           │    110 ┤▓▓▓▓▓  ◀ 現在 118                        │
│      ├──────────────●──────────────┤   Δ 7 tps        │     50 ┤▓▓                                       │
│           −300      0     +300  失衡門檻 100          │      0 └──────────                               │
├───────────────────────────────────────────────────────┼──────────────────────────────────────────────────┤
│  ┌───────────┐  ┌───────────┐  ┌───────────┐          │  ⚠ 警報                                          │
│  │  COLLECT  │  │███ SHOOT ██│  │   EJECT   │          │  ┌────────────────────────────────────────────┐  │
│  └───────────┘  └───────────┘  └───────────┘          │  │ ▲ 射手偏離目標 >10%  已 0.8 s              │  │
│                                                       │  └────────────────────────────────────────────┘  │
│   本輪 ● ● ● ● ● ○ ○   5 顆      節奏 0.42 s          │  ┌────────────────────────────────────────────┐  │
│   spin-up 380 ms（中位 402 / 最大 510）               │  │ ● 電池 12.0 V 接近門檻                     │  │
├───────────────────────────────────────────────────────┤  └────────────────────────────────────────────┘  │
│ RT▓▓▓  LT░  ✕░  □░  ↑░  ↓░  R1▓  L1░                 │  倉門指令 ▌開（CRServo 無回授，此為指令值）      │
└───────────────────────────────────────────────────────┴──────────────────────────────────────────────────┘
```

**為什麼這樣排**：左 62% 全給「現在能不能射」。巨燈佔左上約 45% 面積不是浮誇——駕駛的眼睛在場上，餘光只解析得了「一大塊是什麼顏色」。進度環 96% 回答 SPINUP 時「還要等多久」；只給 READY/NOT READY 的二值燈會讓駕駛在等待期間反覆瞄螢幕。右上第二格給車頭方向（`reversed` 開局預設 true）。右側整條給爬升柱並標分數而非 counts。底部按鍵燈條是教練站在駕駛後面時的唯一即時證據。**全頁零按鈕**（右上只有分頁切換）。

### 4.2 PIT · 射手工作台

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ▲PIT B7f3a2 │ ws 42ms ● │ ⌁12.4V loop 11/19 │ ⏺2413行 │ ⚠參數漂移 2 項 │ [駕駛][參數][檢查][視覺][訊號]│
├──────────┬───────────────────────────────────────────────────┬───────────────────────────────────────────┤
│ 訊號樹🔍 │ 射手三軌 + 階梯目標    [⏸][⤢]  窗 20s ▾  [左軸tps]│ spin-up          │ 每球 dip  ±50ms 解析度│
│ ▾ FGC    │2000┤      ┌───────────┐        ┌──────┐          │                  │ # 底值 恢復 跌破門檻   │
│  ▾Shooter│    │─ ─ ─ ┘           └ ─ ─ ─ ─┘      └ ─ 目標階梯│    412 ms        │ 1 1418 180ms  否       │
│   ● SL   │1500┤      ╱▔╲╱▔╲╱▔╲                              │ p50 438 max 611  │ 2 1372 220ms  否       │
│   ● SR   │    │──── ╱       ╲ ──── FEED_THRESHOLD 1200       │ ▁▃▂▅▂▁▂▃▂▁ 近10  │ 3 1104 380ms  是 ⚠     │
│   ● Way  │1000┤    ╱          ╲    dip −640  恢復 180ms      ├──────────────────┤ 中位 1372 · 跌破 1/3   │
│   ○AtSpd │   0┼────┴─────┴─────┴─────┴─────┴─────┴─────►     │ 失衡 SL−SR       │ ▁▂▅█▃▁ 深度分佈        │
│  ▸ Climb │  −400 ┄ way 反轉（COLLECT）                       │ ◀───┃──█────▶ +48├───────────────────────┤
│  ▸ Drive ├───────────────────────────────────────────────────┤ SHOOT 期 RMS 61⚠ │ 電流 ~2Hz（散點）      │
│  ▸Gamepad│ State │▓▓COLLECT▓▓│███ SHOOT ███│▓▓COLLECT▓▓│     ├──────────────────┤ L · · ·  4.2A          │
│  ▸ Status│ AtSpd │░░░░░░░░░░░│▁▁█████████▁▁│░░░░░░░░░░░│     │ loop ms 直方圖   │ R · · ·  4.4A          │
│  ▸ Param │ Way   │▂▂▂▂▂▂▂▂▂▂▂│███████████│▂▂▂▂▂▂▂▂▂▂▂│     │ ▁▃█▇▄▂▁ │25ms   │ W · · ●· 9.1A          │
│  ▸ Vision│ Hopper│░░░░░░░░░░░│░░░▓▓▓░░░░░│░░░░░░░░░░░│     │ p50 11 p95 19    │ Over ○ ○ ● ○  卡球     │
│  ▸ Bridge│ RT    │░░░░░░░░░░░│███████████│░░░░░░░░░░░│     │ [存快照對照]     │                        │
│          │           ▲ 游標 12.480 s   Δ +0.34 s             │                  │                        │
│ 釘選     ├───────────────────────────────────────────────────┴──────────────────┴───────────────────────┤
│ ▪SL ▪SR  │ ● live ├─────────────────────────────────────────────────────────────────────┤ ← 往左捲脫離  │
└──────────┴──────────────────────────────────────────────────────────────────────────────────────────────┘
```

**為什麼這樣排**：上下分割是 AdvantageScope 的核心洞見——連續訊號畫曲線、離散訊號畫色帶，共用同一條 x 軸與同一個游標。診斷「射不出去」的第一步永遠是分辨『沒到速 / way 沒開 / way 方向反了』，而這三者只有把速度曲線與離散狀態疊在同一條時間軸上才分得出來。電流刻意做小且標 `~2 Hz`——它的取樣率撐不起大面積帶來的權威感。

### 4.3 PIT · 參數對帳台

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ▲PIT B7f3a2 │ ws 41ms │ ⌁12.3V │ ⏺2519行 │  [近射][中射][遠射][*目前]  │  [駕駛][射手][檢查][視覺][訊號]│
├────────────────────────────────────────────────────┬─────────────────────────────────────────────────────┤
│ 參數雙欄（21 項白名單） 🔍         [依子系統 ▾]    │ 目前值 vs 編譯值                                    │
│  名稱            草稿      →   回讀     單位  狀態 │  ⚠ 3 項不同（Restart Robot 就會回到編譯值）         │
│ ▾ 射手                                             │    VEL_SL          1900 → 1965                      │
│ *VEL_SL     [1965  ] ────→  1965      tps   ✓ 68ms │    FEED_THRESHOLD  1200 → 1320                      │
│    0├────────────────●───┤2400*  (*幾何上限)       │    IDLE_TPS           0 → 400   ✗ 尚未套用          │
│  VEL_SR     [1900  ] ────→  1900      tps   ✓      │  [複製 Constants 片段] ← /FGC/Param/_Snippet        │
│ *FEED_THR   [1320  ] ────→  1320      tps   ✓ 51ms │  [存到機器人 fgc-tune.json]   _Saved 12:41          │
│  WAIT_SPINUP  [■ ON] ────→  ON              ✓      │  [從機器人讀回]                                     │
│ *IDLE_TPS   [4000  ] ────→  0         tps   ✗ 被拒 ├─────────────────────────────────────────────────────┤
│    └ err: "IDLE_TPS: out of range (0..3000)"       │ 區間統計                                            │
│  EJECT_VEL  [1600  ] ────→  1600      tps   ✓      │  對象 /FGC/Shooter/SL    範圍[游標選取 44.0–48.2s]  │
│ ▸ 送料(2) ▸ 爬升(2) ▸ 球倉(1) ▸ 底盤(2)            │  n 862   min 1104  max 1972  mean 1893              │
│ ▸ 視覺(4) ▸ 串流(2)                                │  σ 42.1                    ▁▂▅█▇▃▁ 直方圖 bin 20    │
├────────────────────────────────────────────────────┤─────────────────────────────────────────────────────┤
│ 寫回帳本（最近 20 筆）                             │ 相機   [▶開串流][單張][◉暫停]                       │
│ 12:43:02  VEL_SL     1900→1965  回讀 68ms  ✓       │ ┌─────────────────────────────────────────────────┐ │
│ 12:43:11  IDLE_TPS      0→4000  ——         ✗       │ │  暫停中 · 省 CPU                                │ │
│           why: out of range (0..3000)              │ │  開串流預估：loop p95 +6 ms · 視覺 fps −18%     │ │
│ 12:43:20  FEED_TH    1200→1320  回讀 51ms  ✓       │ └─────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────┴─────────────────────────────────────────────────────┘
```

**為什麼這樣排**：四個區塊剛好是「一個值從你手指到機器人再回到你眼睛」這條鏈路的四段——雙欄表是送出與回讀、帳本是失敗時的原因、差異卡是「調完之後怎麼保住」、統計是「調完之後有沒有比較好」。左右分欄而非上下堆疊，因為調參時眼睛要在「我改了什麼」與「結果如何」之間高頻來回，垂直捲動會打斷這個節奏。滑桿與數字框並排：現場用滑鼠微調比打字快，但要打精確值時滑桿又不夠準。

### 4.4 PIT · 檢查（Go/No-Go 全螢幕）

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                        ██   R E A D Y   T O   P L A Y   ██                                               │
│              15 項全通過 · 上次通過 3 分鐘前 · B7f3a2 · [複製結果]                                       │
├──────────────────┬──────────────────┬──────────────────┬──────────────────┬──────────────────────────────┤
│ ● 橋接執行緒     │ ● Build          │ ● 8081 推播      │ ● 8080 health    │ ● 錄影行數在動               │
│   Threads = 1    │   B7f3a2         │   ws age 18 ms   │   200 · gen 4    │   2,413  (+41/s)             │
├──────────────────┼──────────────────┼──────────────────┼──────────────────┼──────────────────────────────┤
│ ● 電池           │ ● loop p95       │ ▲ 視覺 fps       │ ● SL 編碼器      │ ● SR 編碼器                  │
│   12.4 V         │   19 ms          │   11（偏低）     │   1904 tps       │   1897 tps                   │
│                  │                  │ → 降 q40 或關串流│                  │                              │
├──────────────────┼──────────────────┼──────────────────┼──────────────────┼──────────────────────────────┤
│ ● way 編碼器     │ ● climb 零點     │ ● hopper 有回應  │ ● 值 = 建置值    │ ■ AprilTag                   │
│   1802 tps       │   已知 (0)       │   Cmd 有變化     │   21 項一致      │   Best id 102 · 3.24 m       │
├──────────────────┴──────────────────┴──────────────────┴──────────────────┴──────────────────────────────┤
│ 關閉路徑：  [ ] ① 未連筆電      [ ] ② Z-DASH-OFF（health → 404）      [ ] ③ Z-FALLBACK-v2 執行中         │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 4.5 MATCH · Lockdown（唯一一頁）

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│  FGC2026                    ▮ MATCH · LOCKDOWN                    Build B7f3a2            14:32:07       │
├──────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                          │
│                          ████████████████████████████████                                                │
│                          █    比 賽 模 式 鎖 定        █                                                │
│                          ████████████████████████████████                                                │
│                                                                                                          │
│           依 M01 / M09 / M11：遙測已封鎖，本機不存在任何控制路徑                                         │
│           8081 不推播 · /dash/state.json 503 · MJPEG 503 · 只在機器人上錄影                              │
│                                                                                                          │
│   ┌────────────────────────────────────────────────────────────────────────────────────────────────┐    │
│   │  ● 機器人端錄影中（來源：GET /dash/health，每 5 秒）                                            │    │
│   │     rec-20261007-094012.jsonl        18,204 行        pending 12        gen 4 · threads 1       │    │
│   └────────────────────────────────────────────────────────────────────────────────────────────────┘    │
│                                                                                                          │
│   ┌──────────────────────────────────────────┐   ┌──────────────────────────────────────────────────┐   │
│   │ 場上的三個判斷都在 Driver Hub            │   │ 賽後取檔（比賽結束、切 B1-PIT 之後）             │   │
│   │   READY / SPINUP  … telemetry 第 1 行    │   │   ▸ 8080   GET /dash/rec.json                    │   │
│   │   TAG range       … telemetry            │   │   ▸ 備援  OnBotJava 檔案樹                       │   │
│   │   建議射速        … telemetry            │   │            /sdcard/FIRST/fgc-rec                 │   │
│   │ 本卡刻意不顯示任何數值                   │   │   本頁不提供下載按鈕（見 §8 規則自律）           │   │
│   └──────────────────────────────────────────┘   └──────────────────────────────────────────────────┘   │
│                                                                                                          │
│        本頁沒有任何輸入元件。要調參請在 Driver Hub 選 B1-PIT。                                           │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

**與三案的差異**：三案都寫「MATCH 期間錄影行數不會更新是正常的」。**這是錯的**——`/dash/health` 在 MATCH 也回 200 且含 `reclines`（`DashHttp.java:87-108`，註解明寫「MATCH 也可以看（不含任何比賽資料）」）。所以比賽期間錄影心跳是**真的會動**的，這同時解掉三案都列為「未解缺口、需去函確認」的「封鎖 vs 死亡分不出來」——不需要去函，也不需要新程式碼。

### 4.6 REPLAY · 分析

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ▣REPLAY │ rec-20261007-093412.jsonl │ 150.2 s · 3004 批 · t=robot │ [載入 B] │ [匯出 ▾]                  │
├──────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ ◀◀ ▶ ▶▶   0.25x [1x] 2x 4x      t = 47.318 s     Δ +2.104 s     選取 41.2→52.6 (11.4 s)     🔖  ⤓       │
│ ▁▂▃▅▇▅▃▂▁▁▂▄▇▇▇▅▂▁▁▁▃▅▇▇▆▄▂▁▁▂▃▄▅▆▇▇▅▃▁▁▁▂▃▄▅▆▇▇▇▆▄▂▁▁▂▃▄▅▃▁  ← 總覽 SL，永遠全長          │
│ ●    ●  ▲ ●   ⚑     ■■■■■      ✕      ⚠         ●  ●   ▲▲        ⧗▨▨▨  ← 事件軌 + 書籤 + 缺口斜線      │
│ ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐    │
│ │░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│    │
│ └──────────────────────────────────────────────────────────────────────────────────────────────────┘    │
│ 0         20         40    ▼47.3      60         80        100        120        140            150 s   │
├──────────────┬────────────────────────────────────────────────┬──────────────────────────────────────────┤
│ 訊號樹    🔍 │ 射手                          [左軸 tps][右軸 A]│ 游標讀值 @ 47.318 s                      │
│ ▾ FGC        │2000┤    ╭───╮ ╭──╮ ╭───╮                       │  Drive/State      SHOOT                  │
│  ▾ Shooter   │    │╭───╯   ╰─╯  ╰─╯   ╰──╮                    │  Shooter/SL     1874 tps  (懸停 1893)    │
│   ● SL    ⠿ │1500┤│┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈╰╮ ← 目標階梯        │  Shooter/SR     1902 tps  (1899)         │
│   ● SR    ⠿ │1200┼┴──────────────────────┴─ FEED_THRESHOLD   │  SL − SR          −28                    │
│   ○ Way   ⠿ │   0┼───┬────┬────┬────┬────┬────┬────┬───►      │  Shooter/AtSpeed  ● true                 │
│  ▸ Climb     │     40   42   44   46 ▼48  50   52   54  56 s  │  Status/Battery V 12.31                  │
│  ▸ Drive     ├────────────────────────────────────────────────┤  Status/Loop ms   11.4                   │
│  ▸ Gamepad   │ State │▓▓COLLECT▓│███ SHOOT ███│▓COLLECT▓│░EJ│ ├──────────────────────────────────────────┤
│  ▸ Status    │ AtSpd │░░░░░░░░░░│▁█████████░░░│░░░░░░░░░│░░░│ │ 事件 (23)                   ⏷ 篩選 [!hop]│
│  ▸ Vision    │ Way   │──neg─────│──────pos────│──neg────│neg│ │ ▸ 47.30  進入 SHOOT #4                   │
│              │ RT    │░░░░░░░░░░│█████████████│░░░░░░░░░│░░░│ │ ▸ 47.71  spin-up 410 ms                  │
│ 釘選         │ 車頭  │◀◀◀◀◀◀◀◀◀│▶▶▶▶▶▶▶▶▶▶▶▶▶│▶▶▶▶▶▶▶▶▶│▶▶▶│ │ ▸ 48.19  球#1 dip −640 恢復 240ms        │
│ ▪SL ▪SR ▪Way │ 電池 12.6 ──╲______╲___________╲_______ 11.98  │ ⚑ 50.02  書籤「way 卡了」                │
├──────────────┴────────────────────────────────────────────────┴──────────────────────────────────────────┤
│ t=robot（/FGC/Status/Match s） · 3004 批 · 間隔 p50 50.1 ms p95 62 ms · 缺口 1 處(88.4–89.9s) · 2.9 MB   │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

**底部狀態列的誠實原則**：寫出時戳來源與缺口位置。若某份檔案缺 `Match s`（例如舊格式），顯示 `t=client`，使用者就知道所有時間量測只有 ±50 ms 精度，不要拿去比較 FEED_THRESHOLD 1200 與 1300。

### 4.7 降級規則（窄視窗）

| 斷點 | DRIVE | 射手 | 參數 | REPLAY |
|---|---|---|---|---|
| **≥ 1440** | 完整 | 完整 | 左右分欄 | 完整（樹 + 中 + Inspector） |
| **1200–1439** | 右欄 38% → 32% | 右側三小卡改成兩欄疊放 | 統計區摺疊成一行摘要 | Inspector 寬 320 → 260 |
| **1024–1199**（1366×768 舊筆電） | 砍掉按鍵燈條與球節奏卡；巨燈字級不變 | 訊號樹變圖示列（40 px）；電流卡摺疊 | 寫回帳本變成抽屜（點開才展） | 訊號樹收起（`Ctrl+.`）；Inspector 變抽屜 |
| **< 1024**（平板/手機） | **只保留巨燈 + 狀態膠囊 + 車頭 + 爬升柱**，單欄垂直堆疊，字級 ×1.2 | 不提供（顯示「請用 ≥1200 寬視窗」） | 只保留 TuneTable 單欄 + 差異卡 | 只保留 TimeBar + 事件清單（無圖表） |

現況 `styles.css` 是固定 118 px 側欄（`:69`）+ 固定像素右欄，**全檔 0 個 `@media`**，1366×768 上會擠爆。加斷點是必須項不是加分項。

---

## 5. 互動

### 5.1 快捷鍵

全域 `keydown` 掛 `document`，但先檢查 `e.target` 不是 `input`/`textarea`；面板內鍵掛面板自己的 ref + `tabIndex={0}`（抄 FTC `BaseView`，多面板時不互搶）。**現況全專案 0 個 `addEventListener('keydown')`，這一整張表是新的。**

| 鍵 | 動作 |
|---|---|
| `D` / `S` / `T` / `C` / `V` / `A` | 切分頁：駕駛 / 射手 / 參數(Tune) / 檢查 / 視覺 / 訊號 |
| `R` | 進入 REPLAY（選檔） |
| `Space` | REPLAY 播放/暫停；PIT 凍結/解凍圖表 |
| `←` `→` | 單步一個樣本；`Shift+` 跳 1 秒 |
| `Ctrl+↓` `Ctrl+↑` | 下/上一個**事件** |
| `Alt+↓` `Alt+↑` | 下/上一個**選定欄位的值變化點**（給稀疏布林用；布林可能 500 幀不變，逐格前進毫無意義） |
| `[` `]` `\` | 設選區左界 / 右界 / 清除 |
| `Ctrl+\` | 縮放到 OpMode RUN 區間 |
| `Home` `End` | 跳頭 / 尾 |
| `1` `2` `4` | 0.25× / 1× / 4× |
| `L` | 回到 LIVE lock |
| `Ctrl+B` | 加書籤（彈單行輸入） |
| `Ctrl+F` | 聚焦事件過濾；`/` 聚焦訊號樹搜尋 |
| `F` | 面板最大化 / 還原（DRIVE 是巨燈全螢幕） |
| `Ctrl+.` | 收合 / 展開訊號樹 |
| `Ctrl+C`（Inspector 上） | 複製游標時刻所有值成 Markdown |
| `Esc` | 取消目前編輯草稿（沿用 `controls.tsx` 既有語意） |
| **MATCH 模式** | **全部停用，一顆都不留**（M06） |

### 5.2 時間游標

三個狀態，這是最容易做錯的地方：

```
hoverT    60 Hz，不寫入歷史，只影響十字線與 Inspector 的「懸停」欄
          → 直接寫 canvas + 一個 DOM 節點的 textContent，不進 React state
cursorT   點擊 / 播放 / 快捷鍵設定，持久，驅動 Inspector 主欄、事件高亮、統計區間
          → 透過 cursorStore + useSyncExternalStore 廣播
liveLock  true 時 cursorT 恆等於 tail 且不可拖；往左捲即 false
```

uPlot 的 `cursor.sync: { key: "fgc" }` 讓多張圖十字線同步，但 **cursorStore 才是真相、uPlot 是被驅動方**（`plot.setCursor({left: xToPx(cursorT)})`）——因為 DiscreteBand、Inspector、事件軌都不是 uPlot，不能讓 uPlot 當協調者。

### 5.3 拖曳排版：**v1 不引入 react-grid-layout**

> **裁決**：driver-first 明確反對、tuning-first 與 replay-first 都採用（各約 260–320 行）。**採 driver-first。**
>
> 三個理由：
> 1. **對駕駛是負債。** 3 秒可讀性靠的是「元素永遠在同一個位置」形成的肌肉記憶，自由排版正是摧毀這個的東西；教練沒辦法遠端說「看左上角那顆燈」。
> 2. **RGL 的 320 行只是入場費。** 真正的成本是拖曳期間 20 個 Canvas 面板同時 rAF、鎖定/解鎖時 margin 與 rowHeight 的補償、undo/redo（FTC 自己那份在 Windows 上完全失效——`ConfigurableLayout.tsx:400-416` 把整段 ctrl 判斷包在 `navigator.platform.indexOf('Mac') > -1` 內）、以及版面 JSON 的 schema 版本管理。
> 3. **另兩案自己也把它列為可砍**（replay-first 第五刀、tuning-first 第九刀）。三案有兩案承認它可砍，那它就不該進 v1。
>
> **替代方案**：六套固定 CSS Grid 版面 + `minmax/fr` 自適應 + 三檔密度（`--u` 變數）。**PIT 只允許一件事**：射手分頁的波形區可從訊號樹拖序列進來、時序帶可增減列，存 localStorage。約 60 行，覆蓋 95% 的真實自訂需求。
>
> **保留升級路徑**：所有面板都包在統一的 `<PanelShell>` 外殼（標題 + 新鮮度小點 + 取樣率 chip + 右上圖示列），版面只是外層 Grid。若第 3 週實測發現真的不夠，再單獨為射手分頁引入 RGL——那時只影響一頁。

**layout 存檔**：`persist.ts` 統一前綴 `fgc.` + schema 版本 + migration，並提供「匯出/匯入全部設定」JSON（解掉換筆電要重設與隊友分享）。**不做** Elastic 的機器人下發版面（`/dash/layout.json`）——那需要新增一條 HTTP 路徑，而 `DashHub.java:60-67` 的八條是寫死的，改動成本不對稱。

### 5.4 通知（機器人 → 儀表板）

**不改協定。** `DashWs.broadcast(type, payload)` 的 `type` 是任意字串（`DashWs.java:93`），機器人端只要多一行：

```java
// 機器人端（約 8 行的靜態工具）
DashWs.broadcast("notify",
    "{\"level\":\"ERROR\",\"title\":\"SHOOTER_LOW\",\"desc\":\"SL 1420 < 90% target\",\"ttl\":0}");
```

前端在既有的 `onmessage` 分支加 `type === "notify"`。**level/title 一律 ASCII**（OnBotJava 的 javac 編碼與 Driver Hub 對 CJK 都沒驗證過），前端查對照表顯示中文。

觸發點：射手偏離目標 > 10% 持續 0.5 s／`isMotorOverCurrent` 卡球／climb `RUN_TO_POSITION` 逾時／電壓 < 11.5 V／loop > 50 ms／錄影 flush age > 15 s。

**加分設計**：通知同時寫進 log 成為第九類事件，所以「當時機器人喊了什麼」在賽後回放的時間軸上看得到，不是彈完就沒。

**v1 可延**：第一版先用已存在的 `/FGC/Bridge/Last Error` 與燈牆狀態自產前端告警，`notify` 排到第 4 週。

### 5.5 錄影 / 回放流程

```
【PIT 練習】
  連上即自動開錄（沿用 RobotClient onopen → startRecording，抄 Shuffleboard「啟動即錄」
  ——沒有人會在事故發生前記得按錄影，而事故永遠只發生一次）
  頂欄 /FGC/Rec/Lines 在動 → 跑完 → 匯出 jsonl → R 鍵載入 → REPLAY

【比賽日】
  Driver Hub 選 A1-MATCH → 前端進 Lockdown（Mode=MATCH）
  → 筆電留 pit，機器人自己每 10 秒 flush 到 /sdcard/FIRST/fgc-rec/rec-*.jsonl
  → Lockdown 頁每 5 s 輪詢 /dash/health 顯示 reclines（真的會動）
  → 比賽結束、回 pit、Driver Hub 切 B1-PIT
  → RecBrowser：GET /dash/rec.json → 點檔 → GET /dash/rec.jsonl?name=<檔名>
  → streaming 解析成 LogStore → detect() → 跳到第一個 SHOOT 事件

【檢視 → 調參 → 驗證的閉環】
  Ctrl+↓ 逐事件走 → 看到異常 Ctrl+B 打書籤 → [ ] 框選 → 匯出 Markdown 給隊友
  → 切回 PIT，TuneTable 改 FEED_THRESHOLD，看右欄回讀確認真的套用了 → 再跑一次
  → 兩份檔案的逐球統計各匯出一張 Markdown，人工並排比較
  → [複製 Constants 片段] → 貼回 OnBotJava → Build
  → 燈牆的「值 = 建置值」燈轉綠   ← 這一步是整條流程存在的理由
```

**資料模型必改**：載入時全部解析進獨立的 `LogStore` 實例，由 `cursorT` 決定顯示。**不可像現況 `RobotClient.ts:184-204` 那樣 `clearHistory()` 再用 40 ms `setInterval` 直線播到底、播畢自動 disconnect**——那會被 `HISTORY_SEC=120` 截斷（比賽是 150 s），而且 `store.ts:57` 用 `performance.now()` 重標時戳，等於丟掉檔案裡的機器人時戳再用本機時鐘量化一次。

### 5.6 set 回讀雙欄（最重要的單一互動）

```
  使用者拖滑桿
      ↓  50 ms 節流合併（沿用 VisionPanel.tsx:25-38 的 pending Map 去重 + 尾端補送）
  client.set("/FGC/Tune/VEL_SL", 1965)
      ↓  ① 全域硬閘：mode !== "PIT" → 拒絕並回饋（不是靜默丟棄）
      ↓  ② 白名單：!isTunableKey(key) → 拒絕
      ↓  ③ 樂觀更新只寫 /FGC/Tune/VEL_SL（左欄），絕不碰 /FGC/Param/*
  ws send {namespace:"dash", type:"set", payload:'{"k":"...","v":1965}'}
      ↓  機器人：DashWs.offerSet → inbox → DashPublisher 執行緒 DashParams.drainInbox()
      ↓  白名單比對 → 範圍夾限 MIN[i]/MAX[i] → 寫 volatile → put /FGC/Param/VEL_SL
  nt 回推 → 右欄更新
      ↓  一致 → 綠勾 1.2 s 淡出
      ↓  不一致（被夾限） → 整列黃底
      ↓  收到 err {k, why} → 紅框 + why 展開 + 進 SetLedger
      ↓  300 ms 內沒有任何回讀 → 橘框 + 旋轉點；1 s 後轉紅「未確認」
```

**四態視覺是必需品不是裝飾。** 現況 `RobotClient.ts:126-128` 的樂觀更新若機器人拒絕會停在一個假值且完全無提示——這是最危險的一種靜默失敗。

---

## 6. 視覺系統

### 6.1 三層 token（沿用既有 10 個變數當相容層，不動）

現況 `styles.css:2-13` 只有 10 個變數，而 tsx 裡散著 **103 處硬編碼 hex**，所以所有 Canvas 與 uPlot 都吃不到主題。策略：**保留那 10 個給 VMX profile 用**，在 `[data-profile="fgc"]` 作用域內加三層。

```css
/* ── 既有（不動，VMX profile 相容層）───────────────────────── */
--bg  --bg2  --bg3  --border  --fg  --fg-dim  --accent  --warn  --err  --ok

/* ── 第一層 原始色（只被第二層引用）──────────────────────── */
--gray-900…100  --green-400  --amber-400  --red-400  --blue-400  --purple-400

/* ── 第二層 語意色 ─────────────────────────────────────────── */
--surface-1 --surface-2 --surface-3      /* 對應 bg/bg2/bg3 */
--text --text-dim --border-c
--ok --warn --err
--danger      /* ≠ --err！err = 「這個值不對」，danger = 「這個按鈕會改機器人」 */
--focus-ring
--stale       /* diff 推播下的新語意：值沒更新 ≠ 值是舊的，但相機/tag 確實會過期 */
--gap         /* 資料缺口：斜線紋，不是實色，絕不畫成 0 或內插 */

/* ── 第三層 領域色 ─────────────────────────────────────────── */
--series-1 … --series-8                  /* 8 條（不是 6），超過循環並用線型區分 */
--state-collect --state-shoot --state-eject   /* DiscreteBand / StateRibbon / 事件軌共用 */
--band-on --band-off --band-neg
--target      /* 目標線：與對應實測線同色 + 60% 透明 + dash:[6,4]
                 目標與實測必須同色，這樣一眼就是「誤差 = 兩條同色線的距離」 */
--thresh      /* 門檻線：--warn 虛線 dash:[2,4]，比目標線更細 */
--alliance-red --alliance-blue           /* 必須獨立於 --err/--accent，否則燈牆與聯盟色互相混淆 */
--field-bg --field-grid --field-tag --fov
```

`src/lib/theme.ts`（70 行）：開機 `getComputedStyle(document.documentElement).getPropertyValue('--series-1')` 把所有 token 讀成 JS 物件快取，主題切換重讀並廣播。**LineGraph / DiscreteBand / 巨燈 / 爬升柱 / 直方圖全部吃這個物件當 props。** 這一步一次清掉 103 處硬編碼。

### 6.2 三個主題

| 主題 | 用途 | 特徵 |
|---|---|---|
| **dark**（預設） | pit 帳篷、賽後分析 | 沿用現有暗色觀感，密度 compact |
| **field**（高對比） | 賽場、站著看、隔 1.5 m | 純黑 `#000` 底、只有 `#00E676` 綠 / `#FFD600` 黃 / `#FF1744` 紅 / `#FFFFFF` 白，無漸層無陰影，`--font-scale: 1.6`，燈直徑 ×1.5，按鈕命中區 ≥ 44 px |
| **lockdown**（MATCH 專用，不可切換） | 比賽期間 | 灰階為主 + 一個橘徽章。**刻意「不好看」**——比賽日的螢幕被人看到時，它應該明顯是一台關著的機器，不是一個正在工作的控制台 |

`light` 主題**砍掉**（第八刀）：`field` 才是賽場真正需要的，`light` 是舒適品。切換走 `[data-theme]` 屬性 + 首次載入讀 `prefers-color-scheme`（現況全檔 0 個 `prefers-color-scheme`），記 localStorage。

### 6.3 形狀語彙（色盲 + 遠距）

**顏色不是唯一通道**：綠 = 實心圓 `●`／黃 = 三角 `▲`／紅 = 方塊 `■`／灰 = 空心圓 `○`。約 8% 男性有紅綠色覺辨異，而遠距離時形狀比顏色更快被解析。這四個字元在燈牆、時序帶圖例、事件清單、通知 rail **全部共用同一套，學一次到處通**。

### 6.4 字體與密度

- **介面**：系統堆疊（沿用 `styles.css:22` 的 `"Segoe UI", "Microsoft JhengHei"`）。**不引入 web font**——比賽現場沒網路，離線 bundle 字體會讓包大好幾 MB。
- **所有數值**：等寬 `ui-monospace, "Cascadia Mono", Consolas, monospace` + `font-variant-numeric: tabular-nums` + 固定寬度容器 + 右對齊。這對時間游標讀值是**必需**不是偏好：比例字體會讓 Inspector 的數字在滑鼠移動時橫向跳動，讀不了。
- **字級階梯**：`--fs-hero` 96 px（巨燈）／`--fs-xl` 48 px（爬升值、計時）／`--fs-lg` 28 px（狀態膠囊、電池）／`--fs-md` 16 px／`--fs-sm` 13 px（表格）／`--fs-xs` 11 px（圖例）。
- **單位後綴**小一號、用 `--text-dim`；數值本體大且亮。`tps` / `mm` / `°` / `A` / `V` / `ms` 一律顯示，不讓人猜。
- **密度一個變數三檔**：`--u: 4px`（參數/射手，資訊密集）／`6px`（駕駛）／`9px`（Lockdown 與 field 主題）。所有 padding/gap/圖示尺寸寫成 `calc(var(--u) * n)`。這同時解掉觸控目標問題：駕駛密度下 `.btn` 的 padding 自然來到 ≥ 44 px（現況固定 `5px 14px`，`styles.css:41`）。

### 6.5 圖表色序

`--series-1..8` 用色盲安全的分類色盤，順序：青 → 橙 → 綠 → 紫 → 黃 → 粉 → 藍 → 棕。**固定綁定**：`SL` = series-1（青）、`SR` = series-2（橙）、`Way` = series-4（紫）——射手三軌在每一張圖、每一次回放、每一份匯出都是同一組顏色，不因面板而異。

### 6.6 警戒色語意（全域，不因面板而異）

| 狀態 | 表現 |
|---|---|
| 符合驗收條件 | `--ok` ●（loop p95 < 25 ms、電壓 > 12.0 V、值 = 建置值） |
| 接近界線 | `--warn` ▲（電壓 12.0–11.5、loop p95 20–25 ms、視覺 fps < 15） |
| 超出 | `--err` ■（電壓 < 11.5、loop p95 > 25、Threads ≠ 1） |
| 無資料 / 已過期 | `--stale` ○ + 顯示 age，**永遠不顯示空白** |
| 編輯中未送出 | 邊框 `--warn` + `*`（沿用既有 `.editing`，`styles.css:376`） |
| 送出未回讀確認 | 邊框 `--warn` + 旋轉點；> 1 s 轉 `--err` |
| 回讀不符 | 整列底色 `--err` 10% |
| 唯讀（非 PIT） | **純文字，無邊框無背景**（不是 disabled input） |
| 資料缺口 | `--gap` 斜線紋，波形斷開不連線 |
| 稀疏取樣 | 散點 + 標題掛灰色 `~2 Hz` chip，**不畫平滑曲線** |

### 6.7 動態：極少

只有三處：連線斷開的呼吸（沿用 `@keyframes blink`，`styles.css:53`）、車頭切換的 300 ms 閃、通知進場的 150 ms 滑入。其餘一律無 transition——**比賽日的畫面每動一次都在偷駕駛的注意力**。爬升柱與轉速環的值變化用 0.15 s **線性**緩動（避免 20 Hz 抖動的視覺噪音），但不用 ease 曲線（會讓人誤判到位時間）。

---

## 7. 技術計畫

### 7.1 檔案清單

**新增 `src/lib/fgc/`**

| 檔案 | 行數 | 內容 |
|---|---|---|
| `profile.ts` | 60 | `worldskills` / `fgc` 兩組：port（8080/8081）、協定、模式、TABS、預設版面 |
| `fgcKeys.ts` | 160 | 完整 key 對照表 + 21 項可調的 `{min,max,step,unit,group,coachRisk}`（逐字對應 `DashParams.java:58-76`） |
| `LogStore.ts` | 320 | 見 §3.1 |
| `cursorStore.ts` | 90 | 見 §3.1 |
| `eventDetect.ts` | 190 | 八類純函式偵測器 |
| `jsonl.ts` | 90 | `ReadableStream` 逐行解析 / 序列化 |
| `stats.ts` | 80 | count/min/max/mean/σ + 直方圖 bin |
| `theme.ts` | 70 | CSS 變數 → JS 色票物件 |
| `persist.ts` | 80 | 統一前綴 + schema 版本 + migration + 匯出匯入 |
| **小計** | **1,140** | |

**新增 `src/components/fgc/`**：§3 的 32 個視覺 widget，約 **2,940 行**

**修改既有**

| 檔案 | 現況行數 | 改動 | 說明 |
|---|---|---|---|
| `RobotClient.ts` | 231 | **+110 / −25** | 見 §7.3 |
| `Chart.tsx` | 116 | **+264**（→ `LineGraph.tsx` 380） | 見 §7.4 |
| `App.tsx` | 138 | +90 | profile 分流、模式路由、全域鍵盤 |
| `ConnectionBar.tsx` | 148 | +70 | FGC 頂欄欄位 |
| `AllSignalsPanel.tsx` | 219 | +25 / 改造 | **唯讀渲染（規則防線）** + 樹狀 + 釘選無上限 |
| `styles.css` | — | +280 | 三層 token + 三主題 + `@media` 斷點 |
| `store.ts` | 170 | **0** | **原封不動保留給 VMX profile**；FGC 走 LogStore |
| **小計** | | **+839** | |

**總計約 4,919 行**（v1 砍單後見 §9）。

### 7.2 套件

| 套件 | 決定 | 理由 |
|---|---|---|
| `react-grid-layout` | **不採用** | 見 §5.3 |
| 第二個圖表庫 | **不採用** | uPlot 1.6.32（實際安裝版本；`package.json` 宣告 `^1.6.31`）已足夠。多 scale、`cursor.sync`（`uPlot.d.ts:508-518`，另有 static `uPlot.sync(key)` at `:161`）、`cursor.drag`、`paths.stepped`（`:787`）**全是原生能力，目前只是被 `Chart.tsx:33` 主動關掉或沒用到** |
| `zustand` / `redux` | **不採用** | LogStore + cursorStore + React 18 內建 `useSyncExternalStore` 就夠 |
| `react-window` | **不採用** | key 數 60–80 之間不虛擬化也不會掉幀。`AllSignalsPanel` 沿用既有實作 |
| Tailwind | **不採用** | 既有是手寫 CSS，混入是負債 |
| web font | **不採用** | 現場沒網路 |
| `idb-keyval` | **可選**（約 1 KB gzip） | 回放檔 5–20 MB，localStorage 5 MB 裝不下（FTC `RecorderView.jsx:14-15` 的 0.2 MB 單檔上限就是這個教訓）。只用來快取最近開過的 jsonl。**可砍**——改成每次重新選檔即可 |
| `@tauri-apps/plugin-dialog` + `plugin-fs` | **採用（條件）** | 見 §7.7 |

**所有依賴走 npm + Vite bundle，禁止任何 CDN runtime 載入**——比賽現場沒網路。

### 7.3 RobotClient 改動（+110 / −25）

| 行 | 現況 | 改成 |
|---|---|---|
| `:8` | `const PORT = 5800` | 由 `profile.ts` 提供（fgc: 8081） |
| `:35` | `new WebSocket(ws://host:5800)` | `ws://host:8081`；連上後先送 SDK 握手：<br>`{"namespace":"system","type":"subscribeToNamespace","payload":"dash"}`<br>2 s 沒收到 hello 就重送，3 次失敗切 `/dash/state.json` 輪詢 |
| `:41-53` | 單層 `JSON.parse` 後看 `msg.op` | **兩層解包**：先 parse 外層 SDK 封包 → 檢查 `namespace === "dash"` → 取 `type`（`hello`/`nt`/`err`/`notify`）→ 再 parse `payload`（是 JSON **字串**） |
| `:52-54` | 空 `catch` | **必須處理 `err`**（payload 是 `{k, why}`，來自 `DashHub.errJson()`）→ SetLedger + toast。現況協定不合時靜默無資料，極難 debug |
| `:59-63` | 固定 1000 ms 重連 | **指數退避** 1→2→5→10 s 上限；收到 503 判定為 lockdown，退避拉到 15 s 並顯示灰徽章而非紅色錯誤 + 重連風暴 |
| `:74-116` | 二進位通道（點雲/擬合線/grid RLE） | FGC 無用途，且 FTC SDK ws 是否支援二進位 frame【未證實】→ 保留程式碼但 profile 為 fgc 時不註冊 |
| `:119-130` | `set()` 只擋 `replay` | **加三行全域硬閘**（見 §8） |
| `:126-128` | 樂觀更新無條件套用 | **只准套 `/FGC/Tune/*`** |
| `:133-139` | `sendPath()` | **整支刪除**（不是不呼叫）——VMX 專用下行指令，留著就是一條控制路徑 |
| `:179-205` | `startReplay` 用 40 ms `setInterval` 直線播、播畢 disconnect | 改成「全載入進 LogStore 實例 + 由 `cursorT` 驅動」 |

### 7.4 Chart.tsx → LineGraph.tsx（+264）

| 現況 | 改成 |
|---|---|
| `:33` `cursor: { drag: { x: false, y: false } }`（主動關掉框選） | `drag: { x: true, setScale: false }` + `hooks.setSelect` 寫進 `selection`；視窗由 TimeBar 統一決定（所有圖視窗永遠一致） |
| 無 `cursor.sync` | `cursor.sync: { key: "fgc" }`，**約 5 行** |
| `:36-49` 只宣告一個 y 軸（`RunPanel` 因此把位置/速度/加速度壓同軸） | `ChartSeries` 加 `scale?: "left"\|"right"`、`unit?`、`stepped?`，依用到的 scale 集合動態生成 axes |
| `:38-47` 硬編 `#8b95a7` / `#2a3040` | 從 `theme.ts` 讀 |
| 無暫停 | 加 `paused` prop：暫停時跳過 `:103` 的 `setScale("x")` 但**繼續 `setData`**。搭配 drag 縮放就是「凍結 + 放大看剛剛那一下」，且**避開 FTC 恢復時 `graph.reset()` 清光歷史的缺陷** |
| `:78-100` 每 100 ms 用 `Set` 收集時間戳 → `sort` → 雙指標對齊（O(n log n)） | `logStore.sampleWindow()` 直接切片，免 `Set` 免 `sort`。**diff 推播下這個改動是必須的**：穩態的 1900 rpm 一秒可能只有兩個點，`Set` 收集出來的 x 軸既稀疏又要為每個序列補 null |
| `:112-113` deps 只有 `[height, title]`，靠 `AllSignalsPanel.tsx:168` 的 `key={pinned.join("\|")}` 硬重建 | deps 納入 `series.map(s=>s.key).join()`，或用 `addSeries/delSeries`，讓 workaround 消失 |
| 目標值畫成折線 | `paths: uPlot.paths.stepped({ align: 1 })`——狀態機跳階值用線性內插畫是**錯的** |
| 無門檻線 | `hooks.draw` 在資料下層畫 `FEED_THRESHOLD` 橫線與目標 ±3% 綠帶 |

### 7.5 效能策略（目標：DRIVE idle CPU < 3%）

1. **兩個 store 分離**（資料 vs 游標）：滑鼠 60 Hz 不讓資料訂閱者重繪。
2. **`useSyncExternalStore`，snapshot 一律回 primitive**（數值或 per-key version 整數）。**絕不回傳新建的物件/陣列**——會無限重繪。這同時修掉現況 16 處 `const [,force] = useState(0)` 在 React 18 concurrent 下的 tearing 風險。
3. **per-key 訂閱** `subscribeKeys(keys, fn)`：`applyBatch` 只通知本批變動的欄位。現況 `store.ts:48-50` 是無差別廣播——只有一個分頁掛載時撐得住，同畫面 20+ widget 就是每秒 20 次 × 20 棵子樹。
4. **emit 用 rAF 合批**（dirty set + 單一 rAF flag）：把 20 Hz 的 render 壓到 ≤ 60 fps 且與瀏覽器繪製對齊，幾乎不動呼叫端。
5. **高頻視覺完全繞過 React**：巨燈、雙環、爬升柱、DiscreteBand、事件軌、TimeBar 各自 rAF 直接讀 LogStore，React 只管容器與圖例。**這是 VMX 既有的正確做法**（`Chart.tsx:69-104`、`FieldView.tsx:30-52`），保留並擴大。
6. **`Float64Array` 手動 2× 成長，永不 `splice`**：現況 `store.ts:70-73` 滿載時每批對每個 key 做 O(n) 記憶體搬移；20 Hz × 40 key 就是每秒 800 次 4000 元素搬移。
7. **視窗取樣 min/max decimation** 到容器寬 × 2 個點（uPlot 官方推薦法）。
8. **整場全留不截斷**：150 s × 20 Hz × 60 key ≈ 18 萬樣本 ≈ 2.9 MB。**不需要 ring buffer**——這也一併修掉 `HISTORY_SEC = 120 < 150 s` 的 bug（`store.ts:4`；正解不是改成 200，是根本不截）。保險：總樣本 > 500 萬時停錄並警告。
9. **AutoFitCanvas 模式**：`ResizeObserver` + `devicePixelRatio`（抄 FTC `AutoFitCanvas.jsx:11-39`）+ 100 ms debounce；靜態層（爬升柱刻度、時序帶格線）畫到離屏 canvas 快取。
10. **DRIVE 分頁掛零張 uPlot 圖**，只訂閱 14 個 key。
11. **相機三重閘**不成立時 `src=""` 真斷連（不是 `display:none`）。
12. **`detect()` 只在載入時跑一次 + 選區改變時增量**；先量，> 16 ms 才考慮 Worker【未證實，先量再決定】。

### 7.6 假伺服器：**已經存在，不用寫**

`tools/fake-hub.mjs`（46 KB，唯一外部相依是既有 devDependency `ws`）已完整實作：

```
WS   ws://127.0.0.1:8081   (namespace "dash")
     subscribeToNamespace 握手、hello / nt / set / err、MATCH 拒寫、
     namespace 信封 {namespace, type, payload}
GET /dash/health
GET /dash/state.json           (MATCH -> 503)
GET /dash/set?k=&v=            (k=_save|_load|_snippet 也可)
GET /dash/rec.json
GET /dash/rec.jsonl?name=<name|live>
GET /dash/stream.mjpg?fps=10&q=40   (PIT only, 1 viewer)
GET /dash/snapshot.jpg
GET /dash/mode?m=PIT|MATCH     (只有假伺服器才有 ← 用來測 Lockdown 切換)
GET /dash/enabled?v=0|1        (只有假伺服器才有 ← 用來測 404 關閉路徑)
```

啟動：`npm run fake-hub`（`package.json` 已有 script），旁邊有 `tools/fake-rec/`（假錄影檔）與 `tools/fake-tune.json`。

**v2 只需要三處小擴充（約 60 行）**：
1. `broadcast("notify", ...)` 的定時觸發（測通知 rail）
2. `/FGC/Param/Build <NAME>` 21 個 key（測 ParamDiffCard）
3. 前端自算 p95 的驗證資料：讓 `Loop ms` 偶爾噴出 40 ms 長尾（測直方圖）

**這是本專案最大的既有資產**：Control Hub 常常不在手邊，沒有它整套 UI 只能在有機器人的時候開發。**因此 `sim.ts` 重寫（三案共 400 行/10 h）完全不必做**——載入一份錄好的 jsonl 進 REPLAY 就能離線開發所有面板，成本 0 行。

### 7.7 Tauri 打包

| 項目 | 現況 | 改動 |
|---|---|---|
| CSP | `tauri.conf.json:23` `"csp": null` | **先維持 null**。要連 `http://<hub>:8080` 的 MJPEG 與 `ws://<hub>:8081`，而 Hub IP 會變動；收緊必須明列 `img-src`/`connect-src`。在 README 寫明風險 |
| 視窗 | `:16-17` 預設 800×600 | 改 **1600×900 + `minWidth: 1200`**，並記住上次尺寸位置 |
| 權限 | `capabilities/default.json:8-10` 只有 `core:default`，**無 fs/dialog** | 三處匯出全靠 `Blob + a.click()`（`RobotClient.ts:167-176`、`ConstantsPanel.tsx:64-70`、`VisionPanel.tsx:50-56`），**在 Tauri 2 WebView2 下是否可用【未證實】**。ExportMenu 走三層 fallback（clipboard → `plugin-dialog/fs` → Blob），並用 `'__TAURI_INTERNALS__' in window` 分支。**這件事必須在賽前實機驗一次，不能等到要存錄影檔才發現按了沒反應** |
| localStorage origin | Tauri 版與瀏覽器版不互通 | `persist.ts` 的「匯出/匯入全部設定」JSON 順便解掉 |
| 多視窗 | `:13-20` 只宣告一個 main | **v1 不做**。要做只做「相機彈到第二螢幕」一個情境，且資料走 `BroadcastChannel` 而不是第二條 ws（否則 Control Hub 要扛兩條連線） |

---

## 8. 規則合規檢查表

### M01 / M09 — 第二控制路徑（最高 RED CARD）

| # | 措施 | 位置 | 狀態 |
|---|---|---|---|
| 1 | `set()` 全域硬閘三行 | `RobotClient.ts:119` | **必做** |
| 2 | `sendPath()` **整支刪除**（不是不呼叫） | `RobotClient.ts:133-139` | **必做** |
| 3 | 非 PIT 時所有輸入元件**不 render**（不是 disabled） | 全域 | **必做** |
| 4 | `AllSignalsPanel` 改純文字渲染 | `:35`、`:59` | **必做（最大漏洞）** |
| 5 | `RunPanel`/`DebugPanel`/`LockerPanel`/`PathPlanPanel`/`PathTestPanel` 不進 FGC profile 註冊表 | `App.tsx` | **必做** |
| 6 | **`/dash/rec.jsonl?name=live` 一律不呼叫** | `RecBrowser` | **必做（新發現）** |

```ts
set(key: string, v: NtValue) {
  if (store.mode !== "PIT")            return reject("MATCH：寫回已鎖定");  // UNKNOWN 也拒絕
  if (store.connState !== "connected") return reject("未連線：指令未送出");
  if (!isTunableKey(key))              return reject("不在白名單");         // 只有 /FGC/Tune/*
  // ...
}
```

**三個關鍵性質**：(a)【預設鎖住】`Mode` 未知/未收到 hello 一律當 MATCH——**這一行寫錯，其他全部是裝飾**；(b) 被擋下**要有回饋**，不是靜默丟棄（FTC `socketMiddleware.ts:75` 的 readyState 檢查後直接靜默丟棄，使用者以為存好了其實沒送出去）；(c) 模式來源**唯讀**，前端無任何切換它的 UI。

**當場示範**：切 MATCH → 螢幕上根本沒有滑桿；切 PIT → 拖一下值會動。兩秒示範完畢。

**⚠ 新發現的旁路（必須向機器人端提修補）**：`GET /dash/rec.jsonl?name=live` 回記憶體 ring 的**全部遙測**（`DashHttp.java:206-209`），而 `DashHttp.java` 全檔只有兩處 `pit()` 閘（`:117`、`:135`）——**這條路徑在 MATCH 完全開放**。前端這一層先自律（RecBrowser 永不呼叫 `name=live`），同時建議機器人端在 `RecFile.getResponse` 的 `"live".equals(name)` 分支前補一行 `if (!DashHub.pit()) return text(SERVICE_UNAVAILABLE, "MATCH mode");`。**在修補之前，「我方只有一條寫回路徑」這句話對檢錄志工說是錯的。**

### M06 — 場邊不得複雜設定（WHITE CARD）

- MATCH：`TABS` 回空陣列、`ConnectionBar` 只 render 徽章、host 輸入框不存在、**快捷鍵全部停用**、啟動時偵測到 MATCH 直接進 Lockdown。
- 場邊唯一動作是 Driver Hub 選 `A1-MATCH`，筆電不進場邊（隊規）。
- **例外**：host 輸入框在 PIT 必須保留可輸入——TRG Appendix E 預告會有「Changing the Name of the Control Hub」，志工可能在檢錄時改名或改 5 GHz。**不要為了 M06 把 host 寫死。** 連不上的錯誤文案要明講「Control Hub 可能已改名或改成 5 GHz」而非「連線失敗」；差別是 30 分鐘。

### M11 — 場外教練式通訊（YELLOW CARD）

- 資料層已由「MATCH 不推播」解決（`DashPublisher.java:43` 的 `DashHub.pit()` 閘）。
- UI 層再守一條：`fgcKeys.ts` 對每個 key 標 `coachRisk`（`/FGC/Vision/Best/*`、`/FGC/Aim/*`、任何建議射速），由共用的 `<CoachGuard>` 包住，非 PIT 直接不 render。
- **不留任何「臨時開啟即時建議」的開關**——留了就會有人在賽前一場想試試看。
- Lockdown 頁的 Driver Hub 導覽卡**只列名稱不列數值**：它是導覽不是顯示器。
- **明確劃線**：Lockdown 頁可顯示「機器人自身的健康狀態」（build / mode / 錄影行數 / threads / gen），因為它不含任何可轉述給駕駛的比賽資訊；**任何 `/FGC/Shooter`、`/FGC/Vision`、`/FGC/Drive`、`/FGC/Aim` 的值一律不顯示**。這條線寫進 `fgcKeys.ts` 的 `coachRisk` 旗標，不靠記憶。
- **REPLAY 的獨有風險**：回放本身可退化成即時教練工具。對 `coachRisk` 欄位加時間閘——log 最後一批的時戳距現在 > 5 分鐘（即「這不是正在進行的比賽」）才顯示。**成本 5 行。**
- 【未證實】M03 的 DRIVE TEAM 能否在 ALLIANCE STATION 內看唯讀遙測。**在收到 support@first.global 書面答覆前，UI 一律以「不可」設計。**

### G13 — 把球射向機器人或場外（RED CARD）

- 全前端**無任何動作按鈕**（no shoot / eject / jog / 開火），也無任何能把 way 或 shooter 直接設成非零速度的捷徑。
- `StateRibbon` 做成膠囊而非按鈕、無 hover/active 樣式——視覺上就不像可點。
- 白名單裡**只有參數，沒有「直接命令」型 key**——機器人端已做對（`DashParams.NAMES[]` 21 項全是參數）。Code review 檢查清單加一條。
- 參數改了仍必須由駕駛按 R2 進入 SHOOT 才生效（唯一出球路徑是 `ShooterSystem.shoot()`，只由狀態機在 SHOOT 時呼叫）。
- **`VEL_SL`/`VEL_SR` 的前端滑桿 max 用幾何算出的物理上限（不越 SU 頂棚），比機器人端的 `MAX[]=3000` 更嚴，並在 UI 寫明上限來源。這是把 G13 寫進滑桿範圍裡。**
  【未證實】具體數字（三案提到的 2400 / SU 頂 2009 mm）我未在 `2026 FGC Playing Field Drawings.pdf` 上逐項核對。**動工前必須在圖紙上重算一次再寫死**；在算出來之前先用 2400 並在程式碼標 `// TODO: 幾何上限待圖紙核算`。
- `AimAssist` 開關只在 PIT 頁，旁邊常駐「僅轉向，不代按扳機」。

### R14 / 檢錄 / R18

- **關閉路徑三格**（HealthWall 底部）：① 未連筆電（0 秒）② `Z-DASH-OFF` 已生效 = **`GET /dash/health` 回 404**（`DashBridge.java:124` 停用時對所有註冊路徑回 404 `"dash disabled"`）③ `Z-FALLBACK-v2` 執行中。**判定依據是可觀測狀態而不是「我按了某個按鈕」**——`ENABLED` 常數摺疊那個坑證明了「我以為關了」與「真的關了」是兩件事。
- **每晚備份徽章**（R18 五晚留 pit）：`/sdcard/FIRST/settings` 是硬體組態，9 個裝置重建 20 分鐘且最容易錯，而志工可能在檢錄時重設 Hub。
- 【未證實】R14 是否涵蓋筆電。

### 規則性靜默 ≠ 斷線

MATCH 時 8081 不推、`state.json` 503、MJPEG 503。前端必須辨識成**獨立的 lockdown 狀態**（灰徽章 + 說明 + 退避 15 s），而不是紅色錯誤 + 1 秒一次的重連迴圈。三個理由：看起來不像壞了、不製造無謂 Wi-Fi 流量、**任何人瞄一眼螢幕都不會覺得這台筆電正在試圖連機器人**。

而「封鎖 vs 死亡」的區分——三案都列為未解缺口並建議去函——**機器人端已經做完了**：`/dash/health` 在 MATCH 回 200，含 `mode/build/gen/threads/rec/reclines/recpending/lasterror`，零比賽資料（`DashHttp.java:87-108`，註解明寫「MATCH 也可以看（不含任何比賽資料）」）。**不需要去函，也不需要新程式碼**，前端直接輪詢即可。

### 語言

機器人端 OpMode 名稱與 telemetry **全 ASCII**（`A1-MATCH` / `B1-PIT` / `Z-DASH-OFF` / `Z-FALLBACK-v2` / `READY` / `SPINUP`）——OnBotJava 的 javac 編碼與 Driver Hub 對 CJK 的渲染都沒驗證過，現場排錯時一串看不懂的字只會拖慢志工。`notify` 的 level/title 也走 ASCII，前端查對照表顯示中文。中文只留在儀表板前端。

---

## 9. 三週實作排程

### 前置（第 0 天，半天）— 三個必須實測的假設

這三件會改**架構決策**而非只是實作細節，所以先量：

1. **Tauri 2 WebView2 下 `Blob + a.click()` 是否可用**【未證實】→ 決定要不要引入 `plugin-fs`。錄影檔存不下來就是整個比賽日白做。
2. **8081 的 `subscribeToNamespace` 握手確切形狀與 URL 路徑**【未證實】→ 這是「連上了但收不到資料」最可能的原因。先用 `tools/fake-hub.mjs` 對，再對真機。
3. **瀏覽器對 chunked multipart（MJPEG）的行為**【未證實】→ 決定 CamPane 要不要退成 snapshot 輪詢。注意：機器人端 `DashMjpeg.java` 已完整實作（含 boundary、fps/q、併發上限 1、MATCH 503），所以這是「未實測」不是「未實作」。

同時提交機器人端三項小改動（合計約 15 行）：
- `/dash/rec.jsonl?name=live` 補 `pit()` 閘（**規則風險，最高優先**）
- `/FGC/Param/Build <NAME>` × 21，hello 時送一次（`DashParams.java`，約 10 行）
- `Loop p95` / `Loop Max`（滾動視窗，約 5 行）

### 第 1 週 — 地基與比賽日底線（約 16 h）

| 交付 | 行數 |
|---|---|
| `profile.ts` + `fgcKeys.ts`（21 項對 `MIN[]/MAX[]`）+ `npm run golden` 比對 | 220 |
| `LogStore` + `cursorStore` + `jsonl.ts` | 500 |
| `RobotClient` transport 改造（兩層解包、握手、err、指數退避、**set 硬閘**、刪 `sendPath`） | +110 |
| `theme.ts` + 三層 token + `field` 主題 + `@media` 斷點 | 350 |
| **LockdownPage** + 錄影心跳（輪詢 `/dash/health`） | 130 |
| **HealthWall** Go/No-Go 15 格 + 關閉路徑三格 | 300 |

**驗收**：
- ① `npm run fake-hub -- --mode MATCH` → 前端自動進 Lockdown，畫面上找不到任何 input／滑桿／分頁列，快捷鍵全無反應。
- ② `curl /dash/enabled?v=0` → 燈牆的「Z-DASH-OFF 已生效」格轉亮（health 回 404）。
- ③ 拔掉 fake-hub → 頂欄 ws age 持續變舊而不是凍住；重連間隔 1→2→5→10 s。
- ④ 送一個超範圍的 `IDLE_TPS=4000` → 收到 `err` 並在畫面上看得到 why。

### 第 2 週 — 駕駛與調參（約 18 h）

| 交付 | 行數 |
|---|---|
| `LineGraph`（三區軸 + 階梯目標 + 門檻線 + `cursor.sync` + 暫停） | 380 |
| `DiscreteBand` 六列時序帶 | 200 |
| `TimeBar` 三層 + live lock | 260 |
| **DRIVE 分頁**：巨燈 / 雙環+失衡 / 狀態膠囊 / 車頭 / 爬升柱 / 計時 / 球節奏 / 按鍵燈條 / 倉門 | 840 |
| **TuneTable** 雙欄四態 + `SetLedger` + `ParamDiffCard` | 490 |
| `AllSignalsPanel` 唯讀改造 + 樹狀 + 釘選無上限 | +140 |

**驗收**：
- ① 1.5 公尺外站著看 DRIVE 分頁，0.5 秒內能答對「現在能不能射」與「車頭是哪端」。
- ② 調 `FEED_THRESHOLD` 1200→1320，右欄 100 ms 內變 1320 且綠勾；調 `IDLE_TPS` 到 4000 被拒，紅框 + why 顯示，帳本留下一筆。
- ③ 射手圖上 way 在 COLLECT 畫在零線下方且標「反轉」，目標線是階梯不是直線。
- ④ 時序帶能看出「按了 RT 但 AtSpeed 還沒亮、way 還是 0」的錯位。

### 第 3 週 — 回放與收尾（約 14 h）

| 交付 | 行數 |
|---|---|
| `eventDetect` 八類 + `EventList`（`!` 排除）+ `Bookmarks` | 400 |
| `RecBrowser`（`rec.json` → `rec.jsonl?name=`，兩條路徑都在 UI 上） | 120 |
| `Inspector` + `RangeStats`（五個數字 + 直方圖） | 210 |
| `DipAnalyzer` + `CurrentStrip` + `LoopHistogram` | 410 |
| `ExportMenu`（三層 fallback） + `persist.ts` + `BackupNudge` | 260 |
| `CamPane`（三態 + 代價顯示） | 150 |
| ErrorBoundary（每面板一個；**現況全專案 0 個**，一個 panel 丟例外整個 App 白畫面） | 40 |

**驗收**：
- ① 載入一份真機錄的 150 s jsonl，底欄顯示 `t=robot`，事件軌出現至少 6 個 SHOOT 標記，`Ctrl+↓` 逐事件跳轉，所有面板同步。
- ② 匯出 Markdown 貼進隊伍筆記，內容含事件表 + 書籤 + 統計。
- ③ 開串流時 loop p95 的增量顯示在按鈕旁；切到別的分頁自動斷連（用 fake-hub 的 viewer 數驗證）。

### 砍單順序（發現進度落後時，從第 1 刀往下砍）

| 刀 | 砍什麼 | 省 | 替代做法 |
|---|---|---|---|
| 1 | **視覺分頁整組**（TagTable / FieldMap2D / DecimationSweep） | 12 h / 600 行 | 掛在「9/13 有無標定牆」的決策點上；沒有標定牆就整組不進 TABS。真要做先只做「Best 一列 + Age 欄」約 60 行 |
| 2 | **`idb-keyval` 與快照序列同步** | 4 h / 170 行 | 用手機另外錄影手動對時間 |
| 3 | **A/B 跨場次疊比** | 5 h / 200 行 | 逐球統計一鍵複製成 Markdown（20 行），人工並排看。**閉環還在，只是慢 3 分鐘** |
| 4 | **`RangeStats` 的直方圖**（保留五個數字含 σ） | 2 h / 60 行 | σ 不可砍 |
| 5 | **`CamPane`** | 4 h / 150 行 | Driver Hub 本來就有預覽；砍掉反而消掉一個 loop ms 風險 |
| 6 | **`LoopHistogram` 退成三個數字** | 2 h / 80 行 | p95 數字本身還在 |
| 7 | **`CurrentStrip` 退成只留四顆 `OverCurrent` 布林燈** | 2 h / 90 行 | 電流反正只有 ~2 Hz，布林燈才是有用的那一半 |
| 8 | **`ExportMenu` 只留 Markdown + CSV** | 2 h / 50 行 | |
| 9 | **`BallRhythm` 的 dip 自動偵測**（保留球數與節奏） | 2 h / 50 行 | 人工看波形 |
| 10 | **`BackupNudge`** | 1 h / 50 行 | 貼一張紙在筆電上 |

**絕不能砍（砍了整套失去意義，合計約 1,700 行 / 22 h）**：
`set()` 全域硬閘（3 行）｜`sendPath` 刪除｜`AllSignalsPanel` 唯讀改造（25 行）｜`LockdownPage`（130）｜錄影心跳｜`RecBrowser`（120）｜`HealthWall`（300）｜頂欄生命徵象｜`LogStore` 收機器人時戳｜`TimeBar`（260）｜`DiscreteBand`（200）｜`ShotReadyLight` 巨燈（150）｜`TuneTable` 雙欄（260）

**MVP 定義（第 1 週 + 第 2 週的前半，約 26 h）**：能鎖、能錄、能檢查、駕駛練習時看得懂。這 26 小時做完就已經涵蓋比賽日的全部價值。

---

## 10. 被否決的點子與原因

| 點子 | 出處 | 否決理由 |
|---|---|---|
| **react-grid-layout 自由排版** | tuning-first、replay-first | 3 秒可讀性靠「元素永遠在同一個位置」的肌肉記憶，自由排版正是摧毀它的東西；RGL 的 320 行只是入場費，真正成本是拖曳期 rAF、鎖定補償、undo/redo（FTC 那份在 Windows 完全失效，`ConfigurableLayout.tsx:400-416`）、schema 版本。**兩案自己都把它列為前六刀可砍**。省下的 300+ 行轉給 TimeBar 與事件抽取 |
| **DRIVE 當成第四個模式** | driver-first | `/FGC/Bridge/Mode` 在機器人端只有 PIT/MATCH 兩值，多一個模式維度會讓 §8 的硬閘判斷變複雜。改成 PIT 底下的一個分頁，效果相同、判斷單純 |
| **TickStore 對齊 50 ms 網格** | tuning-first | 推播是 diff（`DashHub.java:242`），穩態 key 本來就沒有樣本；tick 對齊等於要為每個 key 在每個 tick 補值，製造 4000×40 的空洞矩陣。稀疏儲存 + 查詢時 resample 才對——tick 網格是「查詢時的投影」不是「儲存的格式」 |
| **新增 `/FGC/Robot/t` 或 `/FGC/T` 心跳 key** | 三案 | **`/FGC/Status/Match s` 已經是了**（每圈重算、必然變動、必進 dirty）。tuning-first 的 `/FGC/T` 做法還會讓 dirty 永不為空、`DashRec` 每 50 ms 必寫一行 |
| **「HOLD 改了不生效」黃燈** | 三案全部 | `ClimbSystem.java:30-33` 已有 `else if (appliedHold != Constants.HOLD)` 即時重套。**這顆燈會對一個已修好的問題持續發假警報** |
| **spin-up 需新增機器人端埋點** | 三案全部 | `/FGC/Shooter/SpinupMs` 已存在（`FGC2026_TeleOp_Match.java:215-224, :347`），機器人端用 `System.currentTimeMillis()` latch。三案為此編列的工時歸零 |
| **`sim.ts` 重寫成 FGC 機構（400 行 / 10 h）** | tuning-first | `tools/fake-hub.mjs`（46 KB）已存在且協定完整，外加 `/dash/mode`、`/dash/enabled` 兩個測試端點。再加「載入 jsonl 進 REPLAY 當離線資料源」（0 行），覆蓋 100% 的離線開發需求 |
| **`/dash/layout.json` 機器人下發版面** | replay-first、Elastic | 需要在 `DashHub.java:60-67` 那八條寫死的路徑外新增一條，改動成本與收益不對稱。用 `persist.ts` 的「匯出/匯入全部設定 JSON」達成同樣效果 |
| **Relative Error / Reference 統計模式** | tuning-first | 三週內不可能累積到有意義的樣本數，10 次以下的相對誤差分布會誤導。σ 保留、分布不做 |
| **A/B 疊比的「自動列出參數差」（靠檔頭 hello 全量）** | replay-first | **前提是錯的**：`hello` 只在 `onSubscribe` 或客戶端主動要求時送（`DashWs.java:22-30, :55-58`），沒有週期性全量；而且 `hello` 走 ws，`DashRec` 只寫 `drainDirty()` 的差異，**全量快照從來不會進檔案**。若要做 A/B 參數對照，必須另外在 `DashRec.startNewFile()` 時把 `latest()` 灌回 dirty（機器人端 1 行）——這也順帶修掉一個更嚴重的問題：**新錄影檔目前只含「與上一次跑相比有變化」的 key，回放起點會缺初始值** |
| **`navigator.getGamepads` 接管手把** | FTC gamepadMiddleware | 比賽時手把走 Driver Hub；PIT 測單一子系統雖然好用，但 http 非安全上下文下瀏覽器可能直接不支援（FTC README 自承不穩定），而且它會構成一條實質的第二控制路徑（M01/M09）。**整組不做** |
| **base64 JPEG over WebSocket** | FTC CameraView | 體積膨脹 33% 且與遙測搶同一條連線。已定案走 8080 的 `/dash/stream.mjpg`，`<img>` 讓瀏覽器原生解碼。只抄它的旋轉+置中縮放數學 |
| **每包從機器人送場地底圖 op** | FTC `TelemetryPacket.java:21-41` | 純粹的浪費。場地 7×7 m 與 AprilTag 位置畫死在前端當靜態圖層 |
| **`dangerouslySetInnerHTML` 渲染遙測** | FTC `TelemetryView.tsx:51,56` | XSS。字串一律純文字渲染 |
| **無白名單 `dispatch(JSON.parse(evt.data))`** | FTC `socketMiddleware.ts:32-35` | 對端可送任意 action 直接改前端 store。FGC 版對 `type` 做白名單（只認 `hello`/`nt`/`err`/`notify`），payload 做 schema 檢查 |
| **恢復播放時 `graph.reset()`** | FTC `GraphCanvas.jsx:48-50` | **這是缺陷不是設計**。「暫停」實際上變成「凍結畫面然後丟掉全部歷史」。我們的暫停只跳過 `setScale`、繼續 `setData` |
| **`light` 主題** | driver-first、tuning-first | `field` 高對比才是賽場真正需要的，`light` 是舒適品。第八刀 |
| **多視窗（相機彈到第二螢幕）** | 兩案 | v1 不做。真要做會變成兩條 ws 連線，要嘛共用一條再 IPC 分發、要嘛實測 Control Hub 負擔——都不是三週內該花的時間 |
| **Elastic 的 `selectTab`（機器人切分頁）** | frc-dashboards | 概念好，但需要新 key + 「可停用」開關 + 「手動切過就暫停自動 10 秒」的狀態機。收益（少按一次）遠低於成本 |

---

## 附錄 A｜未證實項目清單（動工前需驗證）

| # | 項目 | 影響 | 何時驗 |
|---|---|---|---|
| 1 | Tauri 2 WebView2 下 `Blob + a.click()` 下載是否可用 | 決定引不引入 `plugin-fs`；**錄影檔存不下來 = 比賽日白做** | 第 0 天 |
| 2 | 8081 `subscribeToNamespace` 的確切訊息形狀與 URL 路徑 | 「連上了但收不到資料」最可能的原因，需專屬燈與錯誤文案 | 第 0 天 |
| 3 | 瀏覽器對 chunked multipart（MJPEG）的行為 | CamPane 要不要退成 snapshot 輪詢 | 第 0 天 |
| 4 | FTC SDK 8081 ws 是否支援二進位 frame | FGC 無用途，profile 為 fgc 時不註冊即可 | 不阻塞 |
| 5 | `VEL_SL/SR` 的幾何物理上限（不越 SU 頂棚）具體數值 | **G13 滑桿範圍的依據**；三案給的 2400 / 2009 mm 我未在圖紙核對 | 動工前在 `2026 FGC Playing Field Drawings.pdf` 重算 |
| 6 | M03：DRIVE TEAM 能否在 ALLIANCE STATION 內看唯讀遙測 | 已去函 support@first.global 未回覆。**在書面答覆前一律以「不可」設計**；若答覆寬鬆，Lockdown 頁再加一個「唯讀觀賽」變體即可 | 排程上標明，**不要在 10/6 現場臨時加功能**（那正是 M06 要罰的） |
| 7 | R14 是否涵蓋筆電 | 併入去函 | 同上 |
| 8 | 20 Hz × 40 key 下前端的 frame time | 第 1 週埋點時一併量前端，不能只量機器人的 loop ms | 第 1 週 |
| 9 | `detect()` 在 3000 批上的執行時間 | > 16 ms 才考慮 Worker | 第 3 週 |

## 附錄 B｜機器人端最小改動清單（合計約 30 行）

| 優先 | 項目 | 位置 | 行數 |
|---|---|---|---|
| **P0（規則）** | `/dash/rec.jsonl?name=live` 補 `pit()` 閘 | `DashHttp.java:207` 分支前 | 1 |
| **P0（回放正確性）** | `DashRec.startNewFile()` 把 `DashHub.latest()` 灌回 dirty，讓新檔案帶完整初始快照 | `DashRec.java:61` | 3 |
| **P1** | `/FGC/Param/Build <NAME>` × 21，hello 時送一次 | `DashParams.java` | 10 |
| **P1** | `/FGC/Status/Loop p95`、`Loop Max`（滾動視窗） | `FGC2026_TeleOp_Match.java` | 6 |
| **P2** | `DashWs.broadcast("notify", json)` + `Notify.error()` 靜態工具 | 新增 | 8 |
| P3（條件） | AprilTag per-id 五列（`/FGC/Vision/Tag/<id>/*`） | `TagCam.java` | 15 |

**不需要的**（三案共列了約 60 行，全部已存在）：`spin-up` 計時、機器人時戳、電流四路、`OverCurrent` 四顆、手把十路、`Match s`、`Snippet` 產生器、health 端點、串流併發控制。