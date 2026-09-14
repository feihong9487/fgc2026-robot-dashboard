# FGC2026 部署手冊（teamcode-v3）

> 這份是「照著做就好」的操作手冊。設計理由請看 `儀表板方案-2026-09-06.html`。
> 本機原始碼目錄：`C:\Users\feihong\Desktop\FGC2026\teamcode-v3`

---

## 0. 一分鐘版

| 情況 | 要做什麼 | 要不要重開電源 |
|---|---|---|
| 只改了 OpMode / 子系統 / TagCam / DashHttp… | 上傳 → Build Everything → 重跑 OpMode | **不用** |
| 改了 `DashBridge.java` | 上傳 → Build Everything → **重開 Control Hub 電源** | **要** |
| 第一次部署 | 上傳全部 → Build Everything → **重開電源** | **要** |

原因：`DashBridge` 裡的 `@WebHandlerRegistrar` 一輩子只在 app 綁定服務時跑一次，
`Restart Robot` 不會重跑它。其他所有檔案都是「委派物件」，
每次跑 OpMode 時 `DashBoot.ensure()` 會把新的委派塞進共享 map，所以立刻生效。

---

## 1. 上傳步驟

1. **連上 Control Hub 的 Wi-Fi**
   電腦右下角 Wi-Fi → 選 Control Hub 的 SSID（通常是隊名）→ 輸入密碼。
   連上後電腦的 IP 會是 `192.168.43.x`，Hub 固定是 `192.168.43.1`。

2. **開瀏覽器到 `http://192.168.43.1:8080`**
   看到 REV / FTC Robot Controller 的管理頁面就對了。

3. **進 OnBotJava**
   左側選單 → `OnBotJava`。

4. **Upload Files → 選全部 `.java`**
   建議直接用 `python tools\deploy.py`（它會照本機資料夾結構放，見下）。
   手動上傳的話，Hub 上的結構是三層（2026-09-06 起）：
   - 根目錄 `org/firstinspires/ftc/teamcode/`：`Constants`、五個 `*System`、`FGC2026_TeleOp_v2`、
     `FGC2026_TeleOp_Match`、`FGC2026_TeleOp_Pit`、`FGC2026_BlueDrive`、`FGC2026_RedDrive`（11 支）
   - `teamcode/dash/`：14 支 `Dash*.java`（橋接器）
   - `teamcode/vision/`：`TagCam.java`、`AimAssist.java`
   所有檔案的 `package` 都還是 `org.firstinspires.ftc.teamcode;`（OnBotJava 遞迴編譯整棵樹，
   資料夾只是整理用）。**同一個 class 不能同時在兩個資料夾**，否則 Build 直接失敗——
   `deploy.py --move` 會在備份後把根目錄的舊副本刪掉。

5. **官方 AprilTag jar 另外上傳到 ExternalLibraries**
   OnBotJava 頁面左上角的資料夾樹 → 對 `ExternalLibraries` 按右鍵 → `Upload Files`
   → 選官方的 `IgnitingInnovation`（或當季賽事）jar / aar。
   > 沒上傳也能跑：`TagCam` 會退回自建的 5 個 tag（100–104）標籤庫。
   > `/dash/health` 或 `/FGC/Vision/CamState` 會告訴你目前用的是哪一套。

6. **設定編碼（只要做一次）**
   OnBotJava 右上角齒輪 → 確認 build 有帶 `-encoding UTF-8`。
   程式碼裡的中文註解靠這個，沒設會出現一堆亂碼或 `unmappable character` 錯誤。

7. **Build Everything**（扳手圖示，或 Ctrl+Alt+B）
   下方 console 出現 `BUILD SUCCESSFUL` 才算成功。
   有紅字就照行號改，改完再 Build，**不要**帶著錯誤上場。

8. **第一次、或改過 `DashBridge.java` → 重開 Control Hub 電源**
   把電池開關關掉、等 5 秒、再打開。等 LED 恢復正常（藍燈）再連 Wi-Fi。

9. **確認 Driver Hub 硬體組態**
   Driver Hub → 三個點 → `Configure Robot` → 目前組態要有：
   - Motors：`L`、`R`、`shooterL`、`shooterR`、`way`、`intake`、`climb`
   - CR Servo：`yoyoL`、`yoyoR`
   - Servo：`open`（球倉放下：INIT 0°、按 PLAY 後 120°；缺這顆 OpMode 照跑，但 INIT 畫面會顯示 "open servo MISSING"）
   - **USB Camera：`Webcam 1`** ← AprilTag 一定要這個名字，少一個字都不行
   改完按 `Save`，然後 `Activate`。

---

## 2. Day 1 五個檢查點

按順序做完這五個，才算「橋接器在真機上活著」。任何一個沒過就先別往下走。

### 檢查點 1 — 8080 還活著

電腦上開 PowerShell：

```powershell
curl.exe http://192.168.43.1:8080/dash/health
```

**判讀**

| 看到什麼 | 意思 |
|---|---|
| `no delegate: run an OpMode once` | ✅ 正常。薄殼註冊成功了，只是還沒跑過 OpMode。 |
| 一整頁 `build=... gen=... threads=...` | ✅ 更好，代表之前已經跑過 OpMode。 |
| `404` 或空白 | ❌ `@WebHandlerRegistrar` 沒跑到 → 沒重開電源，或 `DashBridge` Build 失敗。 |
| 連不上 / timeout | ❌ Wi-Fi 沒連上，或 RC app 沒起來。 |

### 檢查點 2 — 跑 `Z-DASH-PING`，看 health 有沒有變

Driver Hub → OpMode 清單選 **`Z-DASH-PING`**（group Z）→ 按 **INIT**。
（這支刻意不呼叫 `waitForStart()`，按 INIT 數字就會開始跳，不用按 START。）

Driver Hub 螢幕上應該看到 `counter` 每秒 +1。然後電腦再 curl 一次：

```powershell
curl.exe http://192.168.43.1:8080/dash/health
```

**判讀** — 這幾個欄位要對：

| 欄位 | 應該是 | 不對的話 |
|---|---|---|
| `build` | `ping` | `DashBoot.ensure()` 沒被呼叫到 |
| `gen` | ≥ 1，而且每跑一次 OpMode 就 +1 | 世代機制沒作用 |
| `threads` | **1**（不是 0）。剛 Build / Restart 完隔 1 秒再看：連續兩次 curl 都是 2 才算異常 | 見下面「threads 一直長」 |
| `mode` | `PIT` | OpMode 沒把模式打開 |
| `enabled` | `1` | 被 `Z-DASH-OFF` 關掉了 |
| `rec` | `rec-yyyyMMdd-HHmmss.jsonl` 與行數 | `/sdcard` 寫入權限問題 |

順便試：

```powershell
curl.exe http://192.168.43.1:8080/dash/state.json
```
PIT 模式下要回一大包 JSON；MATCH 模式下要回 **503**（這是刻意的）。

### 檢查點 3 — 8081 WebSocket 推播

瀏覽器開 `http://192.168.43.1:8080`（一定要從這個網址開，不要用 file://），
按 `F12` → `Console`，貼下面這段：

```js
const ws = new WebSocket("ws://192.168.43.1:8081/");
ws.onopen  = () => { console.log("OPEN"); ws.send(JSON.stringify({namespace:"system", type:"subscribeToNamespace", payload:"dash"})); };
ws.onmessage = e => console.log(e.data);
ws.onerror = e => console.log("ERR", e);
ws.onclose = e => console.log("CLOSE", e.code);
```

**判讀**

| 看到什麼 | 意思 |
|---|---|
| `OPEN` → 一則很長的 `{"namespace":"dash","type":"hello",...}` | ✅ 訂閱成功，全量狀態送到了 |
| 之後每 50 ms 一則 `"type":"nt"` 的小包 | ✅ 增量推播正常（`Z-DASH-PING` 至少每秒會有 Counter 變動） |
| 只有 `OPEN`，沒有 `hello` | ❌ namespace 沒註冊成功 → 看 logcat 有沒有 `IllegalArgumentException` |
| `CLOSE 1006` 立刻斷 | ❌ 8081 沒開；確認 RC app 版本是 11.1.0 |

想停就 `ws.close()`。

順便測寫入（PIT 模式才會成功）：

```js
ws.send(JSON.stringify({namespace:"dash", type:"set", payload:JSON.stringify({k:"/FGC/Tune/VEL_SL", v:1900})}));
```
應該收到 `/FGC/Param/VEL_SL` 的回讀；MATCH 模式下應該收到 `type:"err"`。

### 檢查點 4 — Build Everything 之後，gen 要跳、threads 不能長

這一項是整個設計最脆弱的地方，一定要測。

1. 隨便改一行（例如某支 OpMode 的 telemetry 文字）→ `Build Everything`
2. 再跑一次 `Z-DASH-PING`
3. `curl.exe http://192.168.43.1:8080/dash/health`

**判讀**

| 欄位 | 應該 | 不對代表 |
|---|---|---|
| `gen` | 比上次 **+1** | `DashBoot.ensure()` 沒換世代 |
| `threads` | 隔 1 秒之後穩定在 **1** | ❌ 連續兩次 curl 都 ≥ 2 才是舊 ClassLoader 的迴圈沒收工 → 每 Build 一次就多一條，最後迴圈時間會爆掉 |
| `build` | 還是 `ping`（或你改的那支的 tag） | 委派沒換新 |

重複 Build → 跑 OpMode 三次，`threads` 都要停在 1。

> **交替瞬間看到 2 是正常的。** `ensure()` 的順序是「世代 +1 → 舊 exec `shutdownNow()`
> → 新 publisher 上工」，而 `shutdownNow()` 只是送 interrupt：舊 publisher 若正卡在
> 錄影寫檔或 JSON 序列化就不會立刻結束，這段重疊視 sdcard 速度可達數百毫秒，
> 期間新的已經把 threads 加到 2。**隔 1 秒再 curl 一次**，連續兩次都是 2 才要查。

### 檢查點 5 — Restart Robot 兩次 + logcat

Driver Hub → 三個點 → `Restart Robot`，**連做兩次**。
每次做完都 curl 一次 `/dash/health`。

**判讀**

- 兩次之後 8080 / 8081 都還要活著（薄殼是 app 層級的，Restart Robot 不會拆掉它）。
- `threads` 還是 1。
- 如果變成 `no delegate`：正常，因為 Restart Robot 之後還沒跑 OpMode；再跑一次 OpMode 就會回來。
- 如果整個 404：❌ 這代表薄殼被清掉了，需要重開電源。

同時開 logcat 看有沒有例外（電腦上另開一個 PowerShell）：

```powershell
adb connect 192.168.43.1:5555
adb logcat -c
adb logcat -s RobotCore:* System.err:* AndroidRuntime:E
```

**要注意的關鍵字**

| logcat 出現 | 意思 |
|---|---|
| `IllegalArgumentException: namespace dash already registered` | 正常，已經被 try/catch 吃掉了 |
| `ClassCastException` | ❌ 有 teamcode 自己的類別被放進共享 map 當跨 Build 共用 |
| `NoClassDefFoundError` | ❌ 舊 ClassLoader 的執行緒還在跑 → 世代機制沒作用，回檢查點 4 |
| `OutOfMemory` | ❌ ClassLoader 洩漏；重開電源，並回報 |

---

## 3. 日常流程（練習日）

```
改程式（本機）
   ↓
powershell -ExecutionPolicy Bypass -File tools\check.ps1     ← EXIT 0 才准上傳
   ↓
OnBotJava → Upload Files（只上傳改過的那幾支就好）
   ↓
Build Everything                      ← 一定要 BUILD SUCCESSFUL
   ↓
重跑 OpMode（B1-PIT）                  ← 不用重開機
   ↓
curl /dash/health 確認 gen +1、threads = 1
```

**本機編譯檢查**（每次改完都要跑，這是上機前唯一的防線）：

```powershell
powershell -ExecutionPolicy Bypass -File C:\Users\feihong\Desktop\FGC2026\teamcode-v3\tools\check.ps1
```

用的就是 Control Hub 上 OnBotJava 的同一組 classpath，本機過了上機幾乎一定過。

**線上調參**（只在 PIT 模式有效）：

```
http://192.168.43.1:8080/dash/set?k=/FGC/Tune/VEL_SL&v=1950
http://192.168.43.1:8080/dash/set?k=_save        ← 存到 FIRST/fgc-tune.json
http://192.168.43.1:8080/dash/set?k=_load        ← 重讀檔案
http://192.168.43.1:8080/dash/set?k=_snippet     ← 產生可以貼回 Constants.java 的片段
```

> 調完的值**一定要用 `_snippet` 貼回 `Constants.java` 並 Build**。
> `fgc-tune.json` 只在每次 Build 後的第一次 `ensure()` 自動讀，不要當成正式來源。

---

## 4. 比賽日

### 賽前（進場之前，在 pit 做完）

1. `tools\check.ps1` → EXIT 0
2. 上傳 → Build Everything → `BUILD SUCCESSFUL`
3. 跑一次 `B1-PIT` 確認全車動作正常、`/dash/health` 正常
4. **調參收工**：`_snippet` → 貼回 `Constants.java` → 再 Build 一次
5. 跑一次 **`A1-MATCH`** 空跑 10 秒，確認：
   - Driver Hub 第一行會在 `SPINUP` / `READY` 之間切換
   - `curl /dash/state.json` 回 **503**（證明 MATCH 模式真的關了）
6. 電池換滿電，`/FGC/Status/Battery V` 要 > 12.5 V

### 上場

- Driver Hub 依聯盟選 **`A1-blue_drive (tag 103)`** 或 **`A1-red_drive (tag 101)`**（group A）：
  比賽封鎖照舊（不推播、set 拒絕、MJPEG 503），只多開相機，按住 Circle 時**只朝那一個 tag 轉**，
  看到別的 tag 不動。`A1-MATCH` 是不開相機的備用版（相機開不起來時選它）。
- **不要**選 `B1-PIT`：它會開推播、開相機、開 MJPEG，吃頻寬也吃迴圈時間。
- 想更保險，比賽前一場就跑 **`Z-DASH-OFF`**（group Z）把整個橋接器關掉：
  之後所有 `/dash/*` 都回 404、WebSocket 不推播，
  但**錄影照常**（錄影是本機寫檔，不佔無線頻寬，也不看總開關）。
  演練結束要恢復就跑 **`Z-DASH-ON`** —— 賽後要拉錄影一定要先做這一步。

> 關閉演練建議在 Day 1 就練一次：`Z-DASH-OFF` → curl 應該回 404 → `Z-DASH-ON` → 恢復。

### 如果 `A1-MATCH` 出問題

當場改選 **`Z-FALLBACK-v2`**（group Z）。那是完全沒有埋點、沒有相機、沒有橋接器的
原始 v2 程式，控制邏輯一模一樣。先把比賽打完再說。

### 賽後拉資料

> **先在 Driver Hub 上按 INIT 跑 `Z-DASH-EXPORT`（group Z），curl 才會通。** 原因：
> 1. `/dash/rec.json` 與 `/dash/rec.jsonl` 在 **MATCH 模式下回 503**（刻意的：錄影是
>    整段時間序列，比 `state.json` 洩漏得更多），而 OpMode 一結束模式就被壓回 MATCH，
>    所以要有一支「正在跑而且是 PIT」的 OpMode。
> 2. 跑過 `Z-DASH-OFF` 的話 8080 全部回 404。`Z-DASH-EXPORT` 會順手把總開關打開。
>
> `Z-DASH-EXPORT` 的螢幕會直接列出最新幾個檔名與大小，照著打就好。拉完按 STOP，
> 模式自動回 MATCH。
>
> ★ **一定要用 `?name=<檔名>` 指定** ★ 按下 INIT 的那一刻就會開一個新的錄影檔，
> 所以「不給 name = 最新」會拿到 `Z-DASH-EXPORT` 自己剛開的空檔。上一場的資料在
> 按 STOP 時就已經完整寫進它自己的檔案了。
>
> 錄影本身不受任何影響 —— 不管 MATCH / PIT、不管總開關開不開，publisher 都照錄。

```powershell
# 列出這台 Hub 上所有錄影檔
curl.exe http://192.168.43.1:8080/dash/rec.json

# 下載最新一場（不給 name 就是最新的檔案 —— 跑了 Z-DASH-EXPORT 之後那會是空檔，見上）
curl.exe -o match1.jsonl "http://192.168.43.1:8080/dash/rec.jsonl"

# 下載指定一場
curl.exe -o match1.jsonl "http://192.168.43.1:8080/dash/rec.jsonl?name=rec-20260906-141230.jsonl"

# 還沒 flush 到檔案的記憶體 ring（上限 6000 行且不超過 2 MB）
curl.exe -o live.jsonl "http://192.168.43.1:8080/dash/rec.jsonl?name=live"
```

檔案格式是每行一個 `{"t":秒,"d":{...}}`，可以直接餵給儀表板的
`RobotClient.exportRecording` 匯入回放。

> `/dash/rec.*` 需要 **PIT 模式 + 總開關開著**（見上面那個框）。
> 錄影本身則完全不受影響：MATCH 也錄、`Z-DASH-OFF` 也錄。

---

## 5. 每晚備份

**收工前一定要做**，兩分鐘的事，可以救回整天的工。

```powershell
powershell -ExecutionPolicy Bypass -File C:\Users\feihong\Desktop\FGC2026\teamcode-v3\tools\backup.ps1
```

會做這些事：

- 找 `adb`（PATH → Android SDK platform-tools → Desktop\platform-tools）
- 印出 adb 版本、裝置清單、**RC app versionName**、Hub OS 版本
- 沒有裝置就自動試 `adb connect 192.168.43.1:5555`
- 從 Hub 拉下來：`java/src`、`settings`、`ExternalLibraries`、`blocks`、`fgc-rec`、`fgc-tune.json`
- 存到 `%USERPROFILE%\Desktop\FGC2026\backup\<yyyyMMdd-HHmmss>\` 並壓成同名 `.zip`
- 附一份 `backup-info.txt` 記錄當時的版本資訊

| 結束訊息 | 意思 |
|---|---|
| `DONE` + ZIP 路徑 | ✅ 成功 |
| `MISS /sdcard/FIRST/blocks` | 正常，代表沒用 Blockly |
| `exit 2` 找不到 adb | 裝 Android SDK Platform Tools，或放到 `Desktop\platform-tools\` |
| `exit 3` 沒有裝置 | 沒連上 Hub 的 Wi-Fi；或改用 USB 線 |

參數：`-NoZip` 只留資料夾不壓縮；`-Serial 192.168.43.1:5555` 指定裝置。

---

## 6. 疑難排解表

### 橋接器 / 網頁

| 症狀 | 最可能的原因 | 怎麼修 |
|---|---|---|
| `/dash/health` 回 404 | `@WebHandlerRegistrar` 沒跑到 | **重開 Control Hub 電源**；確認 `DashBridge.java` 有 Build 成功 |
| `/dash/health` 回 `no delegate: run an OpMode once` | 還沒跑過任何 OpMode | 跑一次 `Z-DASH-PING` 或 `B1-PIT` |
| 所有 `/dash/*` 都 404，但之前是好的 | 跑過 `Z-DASH-OFF` | 跑 `Z-DASH-ON` |
| `/dash/state.json` 回 503 | 目前是 MATCH 模式（**這是正常的**） | 要看資料就跑 `B1-PIT` |
| `/dash/set` 回 `{"ok":false,...}` | MATCH 模式拒絕寫入，或超出白名單上下界 | 看 `/FGC/Bridge/Last Set Rejected` |
| WebSocket 連上但沒有 `hello` | namespace 沒註冊 | logcat 找 `WebSocketNamespaceHandlerRegistry`；重開電源 |
| `threads` 一直往上長（2、3、4…，隔 1 秒再看還是沒降） | 舊世代迴圈沒收工 | 重開電源；回報這是 bug（世代機制失效）。**只出現一瞬間的 2 不算** |
| 儀表板數字卡住不動 | 推播執行緒死了，或 `enabled=0` | 看 `/dash/health` 的 `threads` 與 `enabled`；重跑 OpMode |
| `Viewers` 數字偏高但只有一個人在看 | 半死的 TCP 連線還沒被清掉 | 無害，下次 send 失敗就會清掉 |

### OpMode / 硬體

| 症狀 | 最可能的原因 | 怎麼修 |
|---|---|---|
| OpMode 清單裡沒有 `A1-MATCH` | Build 失敗，或檔案沒上傳 | OnBotJava 重 Build，看紅字 |
| INIT 就 crash，訊息含裝置名稱 | 硬體組態名稱對不上 | Driver Hub → Configure Robot，比對第 1 節第 9 步的清單 |
| `Loop p95` > 50（`Loop ms` 偶爾跳一下不算，看第 9.2 節） | 每圈讀太多電流，或推播沒節流 | 確認 bulk caching 是 MANUAL；MATCH 模式本來就不推播 |
| 射手轉不到目標轉速 | 電池電量、`VEL_SL/SR` 設太高 | 看 `/FGC/Status/Battery V` 與 `/FGC/Shooter/SpinupMs` |
| 一直卡在 `SPINUP` 不變 `READY` | `FEED_THRESHOLD` 設得比實際轉速高 | PIT 模式線上調 `FEED_THRESHOLD` |
| 球卡住、馬達出力怪 | 過流 | 看 `/FGC/Shooter/OverCurrentL/R/Way`、`/FGC/Climb/OverCurrent` |
| 爬升放開後會掉 | `HOLD` 太小 | PIT 模式調 `HOLD`（`ClimbSystem.hold()` 會即時重套力道） |
| 車頭方向相反 | `reversed` 開局預設 | 場上按 `Square` 切換；或改 `FGC2026_TeleOp_Match` 裡 `reversed` 初值 |

### 相機 / AprilTag

| 症狀 | 最可能的原因 | 怎麼修 |
|---|---|---|
| `/FGC/Vision/CamState` = `ERROR` | 沒有 `Webcam 1`、USB 沒插好、相機被別的 OpMode 佔用 | 看 `/FGC/Bridge/Last Error`；改組態名稱；重插 USB |
| `CamState` = `OFF` | 這支 OpMode 的 `useCamera()` 是 `false`（`A1-MATCH` 預設如此） | 改跑 `B1-PIT` |
| `CamState` 卡在 `STARTING` | 相機還在協商，或 USB 頻寬不足 | 等 2~3 秒；還是不動就重插 USB、降 `TAG_DECIMATION` |
| `Count` 一直是 0 | 距離太遠、光線不足、`TAG_MIN_MARGIN` 太高 | PIT 模式調 `TAG_MIN_MARGIN`（預設 30）、`TAG_DECIMATION`（預設 2） |
| MJPEG 打不開 | MATCH 模式（回 503）、或已經有一條在看（併發上限 1） | 切 `B1-PIT`；關掉別人的分頁 |
| 按住 Circle 車子往反方向轉 | bearing 與 turn 的符號慣例 | 現場先把 `AIM_KP` 設成負值（白名單下限 −0.20，不必重 Build）；要永久修就把 `AimAssist.BEARING_TO_TURN_SIGN` 改成 `+1.0` 重 Build |
| 按住 Circle 完全沒反應 | `A1-MATCH` 的 `useCamera()` 預設是 `false`（相機沒開就永遠沒有 tag） | 改跑 `B1-PIT`，或見下面「已知限制」第 1 條 |

### 備份 / 工具

| 症狀 | 怎麼修 |
|---|---|
| `check.ps1` 說 `MISSING: ...android.jar` | SDK 路徑變了；改 `tools\check.ps1` 最上面的 `$Sdk` |
| `check.ps1` EXIT 非 0 | 照著紅字的檔名與行號改，**不要上傳** |
| `backup.ps1` 拉不到 `fgc-rec` | 還沒跑過任何 OpMode，或錄影 flush 失敗 → 看 `/FGC/Bridge/Last Error` |

---

## 7. OpMode 一覽

| 名稱 | group | 用途 | 推播 | 相機 |
|---|---|---|---|---|
| `A1-blue_drive (tag 103)` | A | **藍方比賽用**。同 A1-MATCH ＋相機，Circle 只瞄 103 | ✗ | ✓ |
| `A1-red_drive (tag 101)` | A | **紅方比賽用**。同 A1-MATCH ＋相機，Circle 只瞄 101 | ✗ | ✓ |
| `A1-MATCH` | A | 比賽備用（不開相機）。埋點齊全但全部關在本機 | ✗ | ✗ |
| `B1-PIT` | B | 練習 / 調參 / 看畫面（瞄任何 tag） | ✓ | ✓ |
| `Z-FALLBACK-v2` | Z | 純原始 v2，出事時的救命稻草 | ✗ | ✗ |
| `Z-DASH-PING` | Z | Day-1 煙霧測試（按 INIT 就跑） | ✓ | ✗ |
| `Z-DASH-ON` | Z | 打開橋接器總開關 | — | — |
| `Z-DASH-OFF` | Z | 關掉橋接器總開關（關閉演練） | — | — |
| `Z-DASH-EXPORT` | Z | 賽後拉錄影（開總開關 + 切 PIT + 螢幕列檔名） | ✓ | ✗ |

---

### 7.1 手把按鍵（2026-09-11 起）

| 按鍵 | 動作 |
|---|---|
| 左搖桿前後 / 右搖桿左右 | 底盤 |
| R2 按住 | SHOOT（射手達速後 way 送料） |
| L2 按住 | COLLECT |
| X 按住 | EJECT（放開回原本狀態） |
| Square | 切換車頭前後（預設 intake 端為前） |
| Circle 按住 | 瞄準輔助（只轉向，要看得到 tag） |
| R1 / L1 按住 | 球倉開 / 關（yoyoL、yoyoR） |
| **DPad 下 / 上** | **往上爬 / 往下降**（2026-09-11 對調），放開原地保持 |
| **DPad 右** | **爬升模式**開／關：只剩底盤與爬升能動，shooter、intake、倉門全停，狀態機壓回 COLLECT |
| （無按鍵） | `open` 伺服：INIT 0°、按 PLAY 後自動 120° 放下球倉 |

## 8. 已知限制（部署前務必知道）

1. **`A1-MATCH` 不開相機**（`useCamera()` 回 `false`），比賽中要瞄準請選
   `A1-blue_drive` / `A1-red_drive`（它們只翻 `useCamera()` 與 `aimTagId()`，其餘與 A1-MATCH 相同）。
   轉向符號已在 2026-09-06 用 B1-PIT 實測正確（`AimAssist.BEARING_TO_TURN_SIGN = -1`）。
   `aimTagId()` 指定後，看得到別的 tag 也算「沒有 tag」，Circle 不會轉車——這是刻意的，
   免得瞄到中間的 102。

2. ~~**L1 同時是「關球倉」和「瞄準輔助」**~~ **（已修正）**
   瞄準輔助改綁 **Circle**（`gamepad1.circle`），L1 維持 v2 的「關球倉」不變，
   兩者不再互相打架。Circle 在 v2 與 A1-MATCH 原本都沒有用到，右手拇指按得到，
   也不會跟 Cross（退球）衝突。
   要再換鍵的話只有一行：`FGC2026_TeleOp_Match` 主迴圈裡的 `boolean aiming = ...`
   （換完記得同步 `/FGC/Gamepad/Circle` 埋點與 init 畫面那行操作說明）。

3. **瞄準的轉向符號已於 2026-09-06 上機實測：`BEARING_TO_TURN_SIGN = -1.0` 正確**（標籤在視野偏左、按住 Circle，車往左轉）。以下保留當初的推論與現場翻符號的方法，換車或換相機安裝方向時再驗一次。
   `AprilTagPoseFtc.bearing` 的正負到底是左還是右，SDK javadoc（"positive to the
   right"）與坊間程式碼寫的相反，只能有一邊對，所以**不要相信註解，看數字**。
   `AimAssist.BEARING_TO_TURN_SIGN` 預設 `-1.0`（本車 `arcadeDrive` 的 `turn`
   正值 = 右轉，這一半是確定的）。
   第一次上機：跑 `B1-PIT` → tag 放在鏡頭正前方偏左 → 看
   `/FGC/Vision/Best/Bearing deg` 的正負 → 按住 Circle 看 `/FGC/Aim/Delta`
   與車實際轉的方向。
   反了有兩條路：**現場**把 `AIM_KP` 設成負值（白名單下限已放寬到 −0.20，
   不必重 Build），或把那個常數改成 `+1.0` 重 Build。

4. **`TagCam` 的 bearing 是 SDK 原始值**（`AprilTagPoseFtc.bearing`，沒有翻符號）。
   `TagCam.java` 的註解寫「度，右正」，但 FTC 的定義是**正值 = 目標在左**。
   `AimAssist.BEARING_TO_TURN_SIGN = -1.0` 就是為了補這個差；
   上機一定要照第 3 點實測一次再相信它。

5. **`Z-FALLBACK-v2` 的 telemetry 還是中文**（刻意不動它，保持與去年一致）。
   其他所有 OpMode 名稱、group、telemetry 都是 ASCII。

6. **`fgc-tune.json` 只在每次 Build 後第一次 `ensure()` 自動讀。**
   同一次 Build 內重跑 OpMode 不會把線上調好的值蓋回檔案值，
   要手動重讀請用 `/dash/set?k=_load`。

7. **錄影 flush 失敗不會重試**（避免佇列吃光記憶體）。
   失敗只會留一則 `/FGC/Bridge/Last Error`，
   但 `/dash/rec.jsonl?name=live` 仍然能從記憶體拿到 ring 內容
   （上限 6000 行且不超過 2 MB；而且要 PIT 模式才拿得到）。

8. **`/dash/snapshot.jpg` 與 `/dash/stream.mjpg` 的影像不是相機原始畫面。**
   相機實際以 **640×480** 跑（`TagCam.CAM_W/CAM_H`；AprilTag 偵測與 SDK 內建
   鏡頭標定都是在這個解析度上做的，**校正仍然有效**），
   但 `CameraStreamServer` 拿到的是 VisionPortal **LiveView pipeline 縮放後的
   960×720**，而且畫面上帶著一列統計數字（解析度 / FPS / 每幀耗時）。
   所以：拿這些圖去量像素座標、或拿去做鏡頭標定前，要先把 960×720 換算回
   640×480（×2/3），並避開統計列蓋到的區域。
   不想要那列數字就把 `Constants.CAM_STATS_OVERLAY` 改 `false` 重 Build
   （它不在 DashParams 白名單裡 —— 只在建 portal 那一次被讀，線上調了也不會生效）。

---

## 9. 埋點 key 速查（附錄 B 這一版新增的四項）

### 9.1 `/FGC/Param/Build <NAME>` —— Build 進去的預設值（23 個）

每個可調參數現在都有兩個回讀 key：

| key | 意思 | 會被 `_load` / 線上調參改嗎 |
|---|---|---|
| `/FGC/Param/<NAME>` | **現在真的生效的值** | 會 |
| `/FGC/Param/Build <NAME>` | **這次 Build 編譯進去的值**（= `Constants.java` 原始碼裡的字面值） | **不會**，同一次 Build 內永遠不變 |

`Build` 那一份是在 `DashParams` 類別載入時（每次 Build Everything 一次）抄的，
比 `fgc-tune.json` 的 `load()` 早，所以就算 `fgc-tune.json` 蓋掉了一堆值，
兩欄一比就知道「今天現場到底調動了哪幾個」——賽後決定要不要用 `_snippet`
貼回 `Constants.java` 時看這個。

21 個 `<NAME>`（順序同 `_snippet`）：

```
DEADZONE  TURN_SCALE
VEL_SL  VEL_SR  IDLE_TPS  EJECT_VEL  WAIT_SPINUP  FEED_THRESHOLD
WAY_TPS  WAY_IDLE_TPS
INTAKE_COLLECT  INTAKE_SHOOT
CLIMB  HOLD
HOPPER_POWER
TAG_DECIMATION  TAG_MIN_MARGIN  AIM_KP  AIM_MAX  MJPEG_FPS  MJPEG_Q
```

> `Build` 開頭的 key 是**唯讀**的：`/dash/set?k=/FGC/Param/Build VEL_SL` 會回
> `unknown key`（白名單只認 `<NAME>` 本身）。

### 9.2 迴圈時間分佈

| key | 意思 |
|---|---|
| `/FGC/Status/Loop ms` | 最後一圈的毫秒數（原本就有） |
| `/FGC/Status/Loop p95` | **最近 200 圈**的 95 百分位 |
| `/FGC/Status/Loop Max` | **最近 200 圈**的最大值 |

每 20 圈才重算一次（約每秒 2-3 次），排序成本可以忽略。
判讀：`Loop ms` 只看得到「這一瞬間」，偶發尖峰一閃就沒了；
**`Loop p95` > 50 才是真的卡**，`Loop Max` 拿來抓偶發的長尖峰（通常是相機或 sdcard）。
只有 `A1-MATCH` / `B1-PIT` 會發布（`Z-FALLBACK-v2` 沒有埋點）。

### 9.3 提示訊息 notify

| 東西 | 內容 |
|---|---|
| WebSocket 訊息 | `{"namespace":"dash","type":"notify","payload":"{\"level\":..,\"title\":..,\"desc\":..,\"ttlMs\":..,\"t\":..}"}` |
| 埋點 key | `/FGC/Bridge/Last Notify` = `level:title`（例如 `WARN:Shooter off target`） |

規則：**只有 PIT 而且真的有人訂閱 WebSocket 才會推播**；MATCH 不推播，
但 `/FGC/Bridge/Last Notify` 一律留，所以錄影檔（黑盒子）裡查得到第幾秒跳了什麼。
`level` / `title` / `desc` 一律 ASCII。

`A1-MATCH` / `B1-PIT` 目前有兩個觸發（都有節流，不會洗版）：

| level | title | 條件 | 最快多久一次 |
|---|---|---|---|
| `WARN` | `Shooter off target` | 在 `SHOOT` 且已達速，但 `SL` 或 `SR` 偏離 `VEL_SL/VEL_SR` 超過 **10%** 連續 **0.5 秒** | 5 秒 |
| `ERROR` | `Battery low` | `/FGC/Status/Battery V` < **11.5 V**（第一輪輪讀完成前的 0.0 不算） | 30 秒 |

要自己加提示：`DashNotify.send("WARN", "Title", "desc", 5000);`
—— 但**一定要自己做節流**，它是在 OpMode 控制執行緒上序列化並送 socket 的。

### 9.4 INIT 期間就有視覺讀數（`/FGC/Status/Phase`）

`FGC2026_TeleOp_Match` 在 `waitForStart()` 前多了一個 INIT 等待迴圈，
每 50 ms 跑一次 `TagCam.update()` 與埋點（**不碰任何馬達**）。
以前 `update()` 只在主迴圈跑，所以按下 INIT 到按下 PLAY 之間
`/FGC/Vision/CamState` 會一直停在 `STARTING`，看不出相機到底開沒開。

| key | 值 |
|---|---|
| `/FGC/Status/Phase` | `INIT`（等待中）→ `RUN`（按下 PLAY 之後）；在 INIT 就按 STOP 則是 `STOPPED` |

INIT 期間會持續更新的有：`/FGC/Vision/*`（CamState、FPS、Best/*）、
`/FGC/Status/Battery V`、`/FGC/Status/OpMode`、`/FGC/Bridge/Mode`。
Driver Hub 的 telemetry 同步顯示 `INIT`、電池電壓，以及（`useCamera()` 為
true 時）相機狀態 / FPS / 目前最佳 tag 的 id、range、bearing。
這讓「上場前先確認相機活著、tag 看得到、電池是滿的」不必先把車啟動。

> `A1-MATCH` 預設 `useCamera()` 是 `false`，INIT 畫面就不會有相機那幾行，
> `/FGC/Vision/CamState` 也維持 `OFF`。要看相機請跑 `B1-PIT`。

### 9.5 錄影檔第一行是全量快照

每次按 INIT 換新的 `rec-*.jsonl` 時，第一行固定是

```json
{"t":0.000,"d":{ ...換檔那一刻 latest 的全部 key... }}
```

之後才是照舊的增量行。沒有這一行的話，回放起點只有「那 50 ms 內剛好變動過的
key」，`Shooter/TargetL`、`Status/Hubs`、`Param/*`、`Vision/CamState` 這種
「設定好就不再變」的欄位在整段回放裡會永遠是空的。

- `t` 仍然是 `0.000`：換檔一定接在時鐘歸零之後，**INIT 期間 t=0、START 之後才起算**的語意沒有改變。
- 記憶體 ring（`/dash/rec.jsonl?name=live`）也同樣會拿到這一行。
- 行數（`/FGC/Rec/Lines`、`/dash/health` 的 `rec`）會比舊版多 1，這是正常的。
