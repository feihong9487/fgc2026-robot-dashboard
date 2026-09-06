# FGC 2026 儀表板 · God Bless／有拜有包庇

給 FIRST Global Challenge 2026 的機器人遙測儀表板。獨立專案，**只服務 FGC 2026**，
資料來源是 `teamcode-v3` 的橋接器（`DashHub` / `DashWs` / `DashHttp` / `DashRec`）。

一句話設計主張：**單一真相是「一份帶機器人時戳、可任意 seek 的 log」，即時只是那份 log 的尾端。**
所以同一套面板程式碼在「PIT 即時」與「賽後回放」兩種情境下都正確，不需要寫兩套。

---

## 目錄

1. [快速開始](#1-快速開始)
2. [npm scripts](#2-npm-scripts)
3. [連真機](#3-連真機)
4. [假 Control Hub（離線開發）](#4-假-control-hub離線開發)
5. [三個模式](#5-三個模式)
6. [分頁與快捷鍵](#6-分頁與快捷鍵)
7. [URL 參數](#7-url-參數)
8. [規則合規](#8-規則合規)
9. [Tauri 打包](#9-tauri-打包)
10. [故障排除](#10-故障排除)
11. [程式碼地圖](#11-程式碼地圖)

---

## 1. 快速開始

```bash
cd C:\Users\feihong\Desktop\FGC2026\dashboard
npm ci                       # 第一次
npm run dev                  # http://127.0.0.1:5173
```

`npm run dev` 綁 `127.0.0.1`。**不要拿掉 `--host 127.0.0.1`**——不指定時 Vite 只綁 IPv6，
無頭 Edge 與部分瀏覽器會直接 `ERR_CONNECTION_REFUSED`。

開起來之後在頂欄右邊的 host 框輸入 Control Hub 位址（預設 `192.168.43.1`），或直接用
`http://127.0.0.1:5173/?host=192.168.43.1`。

> **不要把 Edge / Chrome 的 profile 目錄建在這個專案裡。** Vite 的 chokidar 會去 watch
> `Default\Network\Cookies`，瀏覽器一鎖檔就 `EBUSY` 讓整個 dev server 退出。
> `.gitignore` 擋了 `.edge-profile*/`，但最好放到專案外。

---

## 2. npm scripts

| script | 做什麼 |
|---|---|
| `npm run dev` | Vite dev server（127.0.0.1:5173） |
| `npm run build` | 產生 `dist/`（Tauri 也吃這個） |
| `npm run preview` | 用 production build 服務 `dist/`，截圖驗證用這個比 dev 穩 |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run fake-hub` | 起假 Control Hub（PIT 模式，8080/8081） |
| `npm run fgc-check` | 資料層 45 項（LogStore ZOH／decimation／白名單／`recFileUrl` 收口／真檔案解析） |
| `npm run fgc-check-2a` | 燈牆／關閉路徑／rec.json／**Lockdown 的 M11 白名單** 86 項純函式 |
| `npm run fgc-check-3e` | eventDetect 與四種匯出 94 項純函式 |
| `npm run fgc-check-all` | 上面三支一起跑（225 項） |
| `npm run check` | `typecheck` + `build` + `fgc-check-all`，送 commit 前跑這一支 |

`fgc-check*` 用 esbuild 把 TS 打包成一支 mjs 再跑。**esbuild 目前是靠 Vite 帶進來的**
（沒有列成直接的 devDependency），如果哪天 Vite 換掉 bundler，這三支要自己補 `npm i -D esbuild`。

`npm run fgc-check` 不帶參數時會挑 `../fake-hub/fake-rec/` 裡**最大**的那一份 jsonl
（不是最新的——最新的通常是假伺服器正在寫、只有幾秒的那一份）。要指定檔案：

```bash
npm run fgc-check -- ..\fake-hub\fake-rec\rec-20260906-173539.jsonl
```

---

## 3. 連真機

### 3.1 直連 Control Hub（正常情況）

| 項目 | 值 |
|---|---|
| host | `192.168.43.1`（Control Hub 原廠位址） |
| 遙測 WebSocket | `ws://<host>:8081`，namespace = `dash` |
| HTTP | `http://<host>:8080/dash/*` |

八條 HTTP 路徑寫死在 `DashHub.java`，**沒有 `/dash/ping`**（`Z-DASH-PING` 是一個 OpMode，不是端點）：

```
/dash/health   /dash/state.json   /dash/set   /dash/rec.json
/dash/rec.jsonl   /dash/stream.mjpg   /dash/snapshot.jpg
```

前置條件：Driver Hub 上**至少跑過一次會用到儀表板的 OpMode**（`B1-PIT` / `A1-MATCH`），
橋接器才會把那八條路徑登記上去。沒跑過就連不上，而且症狀跟 Wi-Fi 壞掉一模一樣。

### 3.2 經 Driver Hub 中繼（筆電連不到 Control Hub 的 Wi-Fi 時）

Driver Hub 用 `adb reverse` 把 Control Hub 的 8080/8081 映到手機本機的 18080/18081，
筆電再透過 USB 連 Driver Hub。這時 **host 是 `127.0.0.1`、埠不是原廠值**：

```
http://127.0.0.1:5173/?host=127.0.0.1&relay=1
```

`relay=1` 等同 `httpPort=18080&wsPort=18081`。也可以用齒輪 ⚙ →「連線埠」→
「Driver Hub 中繼（18080/18081）」，那一條會記進 localStorage；**用網址帶的埠不會記**
（一條臨時的分享連結不該改掉這台筆電的設定）。

埠一旦離開原廠值，齒輪會變成橘色，頂欄的「8080」也會改寫成真正在連的那個數字。
連不上的時候**先看這兩處**，不要先去查 Wi-Fi。

### 3.3 host 為什麼一定要可以輸入

TRG Appendix E 預告會有「Changing the Name of the Control Hub」，志工可能在檢錄時改名或
改成 5 GHz。**不要為了 M06 把 host 寫死**——差別是 30 分鐘。所以 PIT 模式下 host 框一定在，
MATCH 模式下它不存在（不是 disabled）。

---

## 4. 假 Control Hub（離線開發）

```bash
cd C:\Users\feihong\Desktop\FGC2026\fake-hub
npm install --no-audit --no-fund     # 第一次（只裝 ws）
node fake-hub.mjs --mode PIT         # 8080 / 8081
```

前端連 `?host=127.0.0.1`。它實作了 namespace 信封、`subscribeToNamespace`、hello/nt/set/err、
八條 HTTP 路徑、MATCH 503、MJPEG 併發上限，外加兩個**測試專用**端點：

```bash
curl "http://127.0.0.1:8080/dash/mode?m=MATCH"     # 切模式（真機沒有這條）
curl "http://127.0.0.1:8080/dash/enabled?v=0"      # 模擬 Z-DASH-OFF（其餘七條路徑轉 404）
```

細節看 `../fake-hub/README-fake-hub.md`。

---

## 5. 三個模式

模式**只**來自 `/FGC/Bridge/Mode`，前端沒有任何切換它的 UI。

| 條件 | 路由 | 畫面 |
|---|---|---|
| `Mode == "PIT"` 且 ws 已連 | **PIT** | 五個分頁，唯一可寫回 |
| `Mode == "MATCH"` | **MATCH** | Lockdown 單頁，零輸入元件 |
| 模式未知 / 還沒收到 hello / ws 斷線 | **MATCH** | 同上 —— **預設鎖住，不是預設開放** |
| 載入了一份 jsonl | **REPLAY** | 分析頁，不建立 ws，物理上不可寫 |

MATCH 進來時自動套 `lockdown` 主題（灰階 + 一個橘徽章）。它**刻意不好看**：
比賽日的螢幕被人看到時，應該明顯是一台關著的機器，不是一個正在工作的控制台。

**規則性靜默 ≠ 斷線。** MATCH 期間 8081 不推播、`state.json` / `rec.*` / MJPEG 全部 503，
這是規則要求的行為不是故障，所以前端顯示灰徽章 + 說明 + 退避 15 秒，而不是紅色錯誤加一秒一次的重連迴圈。
`/dash/health` 在 MATCH 仍然回 200（只有 mode/build/gen/threads/錄影行數，零比賽資料），
所以 Lockdown 頁的「錄影心跳」在比賽期間是真的會動的。

---

## 6. 分頁與快捷鍵

### 分頁（只有 PIT 有）

| 鍵 | 分頁 | 誰在看 · 何時看 |
|---|---|---|
| `D` | **駕駛** | 駕駛、教練 · 練習跑（最常打開的一頁） |
| `S` | **射手** | 程式 · 調 VEL / FEED_THRESHOLD / IDLE_TPS |
| `T` | **參數** | 程式 · 寫回對帳、複製 Constants 片段 |
| `C` | **檢查** | 全隊 · 上場前 30 秒、檢錄 |
| `A` | **訊號** | 程式 · 新埋點驗證、找沒想到的那個 key |
| `R` | 錄影選檔 | 賽後取檔 → 進 REPLAY（**不在分頁列上**） |
| `G` | 圖表驗收頁 | 開發用（**不在分頁列上**，`?tab=graphdemo`） |

分頁列上的分頁若標了 `⌐`，代表目前視窗寬度不足以完整顯示那一頁（例如射手頁需要 ≥ 1200）。

### 快捷鍵

| 鍵 | 動作 | 掛在哪 |
|---|---|---|
| `D` `S` `T` `C` `A` `R` `G` | 切分頁 | App |
| `Space` | 播放 / 暫停 | TimeBar |
| `←` `→` | 單步一個樣本；`Shift+` 跳 1 秒 | TimeBar |
| `Home` `End` | 跳頭 / 尾 | TimeBar |
| `1` `2` `4` | 0.25× / 1× / 4× | TimeBar |
| `L` | 回到 LIVE lock | TimeBar |
| `[` `]` `\` | 設選區左界 / 右界 / 清除 | TimeBar |
| `Ctrl+↓` `Ctrl+↑` | 下 / 上一個**事件** | 回放頁 |
| `Alt+↓` `Alt+↑` | 下 / 上一個**選定欄位的值變化點** | 回放頁 |
| `Ctrl+\` | 縮放到 OpMode RUN 區間 | 回放頁 |
| `Ctrl+B` | 加書籤（彈單行輸入） | 回放頁 |
| `Ctrl+F` | 聚焦事件篩選 | 事件清單 |
| `Ctrl+C` | 複製游標時刻所有值成 Markdown | Inspector |
| `Ctrl+.` | 收合 / 展開訊號樹 | 回放頁 |
| `F` / `Esc` | 巨燈全螢幕 / 還原 | 駕駛頁 |
| **MATCH 模式** | **全部停用，一顆都不留**（M06） | — |

所有 handler 都先檢查 `e.target` 不是 `input` / `textarea` / `select` / `contenteditable`，
所以在搜尋框裡打字不會意外換頁。

---

## 7. URL 參數

| 參數 | 例 | 說明 |
|---|---|---|
| `host` | `?host=192.168.43.1` | Control Hub 位址 |
| `tab` | `?tab=shooter` | 開哪一個分頁（含 `graphdemo` 這種不在分頁列上的） |
| `mode=replay&file=` | `?mode=replay&file=rec-20260906-173539.jsonl` | 直接 streaming 載入一份錄影檔進 REPLAY，**不建立 ws** |
| `theme` | `?theme=field` | `dark`（預設）或 `field`。`lockdown` 不能用參數指定 |
| `relay` | `?relay=1` | 埠改成 18080/18081（Driver Hub 中繼） |
| `httpPort` / `wsPort` | `?httpPort=18080&wsPort=18081` | 個別覆寫 |

`?mode=` **只認 `replay`**。網址不能把前端切成 PIT——模式真相只來自 `/FGC/Bridge/Mode`。
`file=live` 一律拒絕（見下一節）。

---

## 8. 規則合規

這一節是這份專案存在的前提，不是附註。

### M01 / M09 — 第二控制路徑（最高 RED CARD）

`client.set()` 有三行全域硬閘，**不在 PIT、沒連線、或不是 `/FGC/Tune/*` 一律拒絕並回饋**
（`src/lib/RobotClient.ts` 的 `gate()`）。被擋下來一定會出現在寫回帳本裡，不會靜默丟棄——
「使用者以為存好了其實沒送出去」比拒絕更危險。

**前端通往 `/dash/set` 的出口只有兩支，而且共用同一個 `gate()`**：`client.set()`（21 項白名單）
與 `client.command("_save" | "_load")`。`_save` / `_load` 以前是 `ParamDiffCard` 自己 `fetch` 的
第二條路徑——沒有模式檢查、沒有連線檢查、被拒也不進帳本。它有一個真實競態：按下「存到機器人」
的同一秒機器人切進 MATCH，請求已經送出去了而前端沒有留下任何紀錄說它送過。現在兩支都進帳本。

**模式是「有保鮮期的事實」，不是鎖存。** 這是本節最容易寫錯的一行：

- **授權**：只有 ws 的 `hello` / `nt` 裡的 `/FGC/Bridge/Mode` 能把前端切成 PIT。
  `/dash/state.json` 的備援輪詢與 `/dash/health` 都**只准降級，不准授予**。
- **保鮮期**：真機的 PIT→MATCH 在**已經開著的 socket 上是完全靜默的**——
  `DashPublisher.java:37` 的 `drainDirty()` 一定會被呼叫（要餵 `DashRec.addLine`），
  把剛變成 `"MATCH"` 的那筆取走並清空 dirty，而第 46 行的廣播被 `pit()` 擋住，
  所以那一批永遠不會送出去；下一圈 `DashHub.put` 值沒變直接 return，這個 key 再也不會進 dirty。
  也就是說「ws 開著但不推播」正是 MATCH 的常態，而「斷線即鎖」擋不住它。
  推播靜默超過 `FGC.modeStaleMs`（1 s）就主動送一則 ws `sync`（`DashWs.java:56` 支援，
  MATCH 的 hello 白名單一定帶 `/FGC/Bridge/Mode`）；再過 `modeGraceMs`（2.5 s）
  仍然沒有任何下行就降成 `UNKNOWN`。**未知即鎖，不是未知即開放。**
- **matchLatch**：`/dash/health` 回 `mode=MATCH` 之後就閂上，ws 說 PIT 也不算數，
  要等 health 回 `mode=PIT` 才解開。授權要兩條通道都同意，降級任一條說了算。
  這擋的是「8080 說 MATCH、8081 說 PIT」的分腦——症狀就是 `Thr != 1` 的殭屍推播執行緒
  推著上一場的遙測（實測過：修之前那個情境會出現約 800 ms 的完整可寫 PIT 介面）。

⚠ **假伺服器必須跟真機一樣殘忍**：`fake-hub.mjs` 以前在切 MATCH 的當下額外推一則帶
`Mode/Gen/OpMode` 的 nt，而且 `hello` 不分模式一律回全量快照。兩者真機都沒有，而前者正好
把上面那個 fatal 遮起來（在那個版本的假伺服器上永遠測不出來）。兩處都已修正。

- `sendPath()` 已**整支刪除**，不是不呼叫。VMX 的 `RunPanel` / `DebugPanel` / `LockerPanel` /
  `PathPlanPanel` / `PathTestPanel` 也整批刪掉，連引誘都不留。
- 非 PIT 時所有輸入元件**不 render**（不是 disabled）。當場示範只要兩秒：
  切 MATCH → 螢幕上根本沒有滑桿、沒有分頁列、沒有 host 框、沒有齒輪；切 PIT → 拖一下值會動。
- **`GET /dash/rec.jsonl?name=live` 前端一律不呼叫**，那條路徑會回這一場記憶體 ring 的
  全部遙測。機器人端已補上 `pit()` 閘，但前端這一層仍然自律。

### M11 — 場外教練式通訊（YELLOW CARD）

- `fgcKeys.ts` 對每個 key 標 `coachRisk`（`/FGC/Vision/Best/*`、`/FGC/Aim/*`、任何建議射速）。
- Lockdown 頁可以顯示機器人**自身的健康狀態**（build / mode / 錄影行數 / threads / gen /
  `/FGC/Bridge/Last Notify`），因為它不含任何可轉述給駕駛的比賽資訊；
  **`/FGC/Shooter`、`/FGC/Vision`、`/FGC/Drive`、`/FGC/Aim` 的值一律不顯示**。
  Driver Hub 導覽卡只列名稱不列數值。

  這條線**由程式保證，不靠記憶**：Lockdown 子樹的每一次取值都走 `fgcKeys.lockdownValue()`
  （不在白名單就回 `null`，呼叫端整格不 render），而 `tools/fgc-check-2a.ts` 斷言
  `LOCKDOWN_KEYS ⊆ isLockdownSafeKey` 且其中沒有任何 `coachRisk` 欄位。往這一頁加一格而
  忘了想 M11 的人，會在 `npm run check` 就被擋下來。

  **頂欄拍板（§8 M06 與 M11 的衝突）**：規格 §8 M06 寫「ConnectionBar 只 render 徽章」，
  但同一份 §8 的 M11 明確劃線授權了「build / mode / 錄影行數 / threads / gen」。
  **結論：以 M11 的劃線為準**——M06 那句被它取代。Lockdown 頂欄只顯示
  **徽章 / Build / 8080 燈（含實際在連的埠）/ ⏺ 錄影行數 / Thr** 這五項，理由是它們正是
  「封鎖 vs 死亡」的判別依據，而且全部是機器人自身的健康狀態，沒有一個可以被轉述給場上駕駛。
  `recpending`（待寫）不在 M11 的清單裡，所以 lockdown 下不 render。

- **匯出也吃同一道閘**：`ExportMenu` 收 `gateOpen`，`toJsonlClip()` 與 `toConstantsSnippet()`
  都收 `allowKey`。閘關著時 JSONL 剪輯不含任何 `coachRisk` 欄位、Constants 片段不吐 `AIM_*`，
  而且匯出面板上會寫明濾掉了幾個欄位。閘擋住折線圖卻讓一顆按鈕把同一份資料印在預覽區裡，
  成本是一次點擊、零警告——那正是 M11 要擋的事。
- **REPLAY 也有閘**：log 最後一批的時戳距現在不到 5 分鐘時，`coachRisk` 欄位整批不 render，
  並在畫面上寫明還要等幾分鐘。回放本身可以退化成即時教練工具，這條堵的是那個。

### G13 — 把球射向機器人或場外（RED CARD）

- 全前端**無任何動作按鈕**（no shoot / eject / jog / 開火）。狀態機做成「按鈕的樣子但不可點」
  的膠囊：無 hover、無 active、無 `tabIndex`。
- 白名單裡只有參數沒有命令。`VEL_SL` / `VEL_SR` 的前端滑桿上限是 **2400**（比機器人端的
  `MAX[]=3000` 更嚴），這是把幾何上限寫進滑桿範圍裡。
  ⚠ **2400 目前仍是暫定值**（`fgcKeys.ts` 標著 `// TODO: 幾何上限待圖紙核算`），
  上場前必須在 `2026 FGC Playing Field Drawings.pdf` 上重算。

### R14 / 檢錄

檢查頁底部的「關閉路徑三格」判定依據全部是**可觀測狀態**而不是「我按了某個按鈕」：

| 格 | 判定 |
|---|---|
| ① 未連筆電 | 8080 與 8081 都沒回話 |
| ② `Z-DASH-OFF` 已生效 | `GET /dash/health` 回 **404** |
| ③ `Z-FALLBACK-v2` 執行中 | 橋接活著但 ws ≥ 5 s 無資料且錄影行數 30 秒沒動 |

第 ③ 格是反推的，`Z-FALLBACK-v2` 不碰 `DashHub` 所以不會回報自己——格子裡寫明了
「任何不吃儀表板的 OpMode（含沒有 OpMode 在跑）都會落在這一格」。

---

## 9. Tauri 打包

第一次需要 Rust：

```bash
winget install Rustlang.Rustup      # 或 https://rustup.rs
```

之後：

```bash
npm run tauri dev                   # 開發（會先跑 npm run dev）
npm run tauri build                 # 產生 src-tauri/target/release/bundle/ 裡的 msi / exe
```

`src-tauri/tauri.conf.json` 目前的設定與**為什麼**：

| 項目 | 值 | 理由 |
|---|---|---|
| 視窗 | 1600×900，`minWidth: 1200` | 射手頁需要 ≥ 1200 才不降級（§4.7） |
| `security.csp` | `null` | 要連 `http://<hub>:8080` 的 MJPEG 與 `ws://<hub>:8081`，而 Hub IP 會變。收緊必須明列 `img-src` / `connect-src`，做之前先想清楚 IP 怎麼填 |
| 權限 | 只有 `core:default`（**無 fs / dialog**） | 匯出走三層 fallback：`navigator.clipboard` → Tauri `plugin-dialog/fs` → `Blob + a.click()` |

**⚠ 賽前必須實機驗一次的兩件事**（都是「按了沒反應」型的靜默失敗）：

1. `Blob + a.click()` 在 Tauri 2 的 WebView2 下能不能真的存出檔案。
   不能的話要補 `@tauri-apps/plugin-dialog` + `plugin-fs` 與對應的 capability。
2. WebAudio 的兩短嗶。瀏覽器的 autoplay policy 會讓 AudioContext 停在 `suspended`，
   程式碼安靜放棄（不丟例外）。**使用者第一次點過畫面之後才會響。**

Tauri 版與瀏覽器版是兩個 origin、localStorage 不互通。要搬設定用齒輪 ⚙ →
「設定備份」→「複製全部設定」，在另一邊「從檔案匯入…」。

---

## 10. 故障排除

### 連不上

| 症狀 | 先看什麼 |
|---|---|
| 齒輪 ⚙ 是橘色 / 頂欄寫的不是 8080 | **埠被改過**（`?relay=1` 或齒輪設過）。⚙ →「回原廠」 |
| 8080 燈紅、ws 也沒動 | Driver Hub 有沒有跑過一次 `B1-PIT`？沒跑過八條路徑就沒登記 |
| 8080 燈紅、`GET /dash/health` 回 **404** | `Z-DASH-OFF` 已生效。跑 `Z-DASH-ON` 恢復 |
| 什麼都連不上、位址也沒錯 | **Control Hub 可能已改名或改成 5 GHz**（TRG Appendix E）。志工在檢錄時會動它 |
| ws 連得上但沒有資料 | 握手問題不是網路問題。檢查頁的「8081 推播」格會直接說 |
| 徽章寫「未知（鎖定）」 | 還沒收到 hello。**預設鎖住是刻意的**，不是 bug |

### 數字怪怪的

| 症狀 | 原因 |
|---|---|
| `Thr` ≠ 1 | 殭屍推播執行緒（舊 ClassLoader 沒收工）。**重開 Hub 電源**，不要只重跑 OpMode |
| 頂欄 Build 與檢查頁的 Build 不一致 | 委派凍結在舊 ClassLoader。重跑一次 OpMode |
| 錄影行數不動 | 行數每 10 秒跳一階（`FLUSH_MS=10000`），要看滿 30 秒才判得出真的停了 |
| loop p95 遠大於 p50 | 平均 12 ms 但 p95 40 ms 的機器人手感是頓的。先關 MJPEG 串流再看 |
| 回放頁標 `t=client（±50 ms）` | 那一份 log 有批次沒帶 `/FGC/Status/Match s`。在 MATCH 期間開頁面會踩到（見「已知限制」） |
| 電流圖看起來很跳 | 它就是 ~2 Hz（`getCurrent` 不在 bulk cache）。所以畫成散點並掛 `~2 Hz` chip，**不要**把它讀成連續量 |

### 賽後取不到錄影檔

`rec.json` / `rec.jsonl` 在 MATCH 是 503。**先切 `B1-PIT` 或跑 `Z-DASH-EXPORT`**，再開錄影頁（`R`）。
取檔一定要指定 `name=<檔名>`：INIT 會開新檔，「最新的」是剛開的空檔。

備援路徑：OnBotJava 的檔案樹 → `/sdcard/FIRST/fgc-rec`。
**Day 1 如果 8080 註冊失敗，第一條路就沒了**，這條路徑常駐在錄影頁與 Lockdown 頁上。

### 已知限制

- **`LogStore.tSource` 是單向閂鎖**：只要有任何一批沒帶 `Match s` 就永久標成 `client`。
  而 MATCH 的 hello 白名單本來就沒有 `Match s`，所以「MATCH 期間開頁面、賽後切回 PIT」
  會讓儀表板從此謊報 `t=client`。**重新整理一次就好**，但值得修。
- **爬升柱的分數線（0/1000/2200/2900/3600 counts）是暫定值**，畫面上有標。上場前必須手推到
  每一格讀 `/FGC/Climb/Pos` 實測。
- **`/FGC/Shooter/TargetL|R` 在機器人端是無條件寫 `Constants.VEL_SL`**，不隨狀態改變，
  所以 COLLECT 期顯示的「目標 1900」不是當下真正下給 PID 的值（當下是 `IDLE_TPS`）。
  這是機器人端的埋點語意問題，前端照實顯示。
- **A/B 疊比未實作**（回放頁上那顆虛線 chip 明寫著）。
- **每球 dip 只掃 `SL`**。SR 側單獨卡球（SL 正常）抓不到。
- **notify 第九類事件在 REPLAY 永遠是 0 筆**：notify 是 ws 訊息不是 nt key，錄影檔裡沒有。

---

## 11. 程式碼地圖

```
src/
  App.tsx                       模式路由 · 分頁 · ErrorBoundary · 快捷鍵
  styles.css                    三層 token · 三主題 · 三檔密度 · 斷點
  lib/
    RobotClient.ts              ws / health / 輪詢 / set 硬閘 / 模式看門狗 / 回放載入
    store.ts                    連線五態 + mode + 最新值鏡射（VMX 沿用；時間序列在 LogStore）
  components/
    AllSignalsPanel.tsx         全 key 自動列表（VMX 沿用；釘選圖已換成 LineGraph）
  fgc/
    lib/
      profile.ts                埠 · 八條路徑 · 時間門檻 · URL 參數 · 埠覆寫
      fgcKeys.ts                全 key 目錄 + 21 項白名單（逐字對應 DashParams.java）
      LogStore.ts               稀疏時間序列：ZOH · min/max decimation · run-length
      cursorStore.ts            hoverT / cursorT / selection / liveLock
      eventDetect.ts            八類事件 + 通知第九類（純函式）
      theme.ts                  CSS 變數 → JS 色票（Canvas / uPlot 取色唯一來源）
      tone.ts                   形狀語彙 ●▲■○ 與警戒色語意（全專案唯一一份）
      persist.ts / clipboard.ts / stats.ts / jsonl.ts / health.ts
      hooks.ts                  useLogKeys（per-key snapshot）· useReplayLog · useWindowWidth · useFlash
    components/
      shell/                    ConnectionBar · PanelShell · SettingsMenu · ErrorBoundary · Glyph
      drive/                    巨燈 · 雙環 · 膠囊 · 車頭 · 爬升柱 · 計時 · 節奏 · 按鍵 · 警報
      graph/                    LineGraph · DiscreteBand · TimeBar · Inspector · SignalTree
      shooter/                  dipDetect · DipAnalyzer · BalanceBar · LoopHistogram · CurrentStrip
      tune/                     TuneTable · SetLedger · ParamDiffCard · RangeStats · CamPane
      health/                   checks · shutdown · HealthWall · BackupNudge
      rec/ · lockdown/ · replay/
    pages/                      registry.ts + 一頁一個 PageDef
    styles/                     每頁一份 CSS，由該頁 import
tools/                          fgc-check{,-2a,-3e}.ts —— 純函式驗證，不需要瀏覽器
```

**改東西之前要知道的三條約定**

1. **顏色不准硬編。** Canvas 與 uPlot 從 `theme.palette()` 取色，CSS 從 token 取色。
   `src/**.tsx` 裡的硬編碼 hex 數量目前是 **0**，請維持。
2. **形狀語彙只有一份。** ●▲■○ 在 `lib/tone.ts`，不要在自己的檔案裡再寫一次——寫反了不會有人發現，
   因為色盲使用者看到形狀對不上，其他人看到顏色是對的。
3. **判定與畫面分離。** 燈牆、關閉路徑、事件、dip、匯出全部是純函式，
   所以 `fgc-check*` 可以用假資料直接驗，不必靠人盯畫面。新增判定請照這個模式。

**已刪除的兩支 VMX 遺留檔**（`git log` 找得回來，但不要復活它們）

- `components/Chart.tsx` —— 每 100 ms 用 `Set` 收時戳再 `sort`、只有一個 y 軸、硬編色、
  `series` 不在 effect 相依裡（靠呼叫端 `key=` 強制 remount 才正確）。
  它的位置由 `fgc/components/graph/LineGraph.tsx` 取代。
- `components/controls.tsx` —— 沒有任何檔案 import 它。它的價值（草稿-送出輸入模式、
  `draft: string | null`）已經被 `TuneTable` 與 `AllSignalsPanel` 的 `NumberRow` / `StringRow`
  吸收。留著的成本是「下一個要做視覺分頁的人會先看到它並直接用」。

同時，`store.ts` 的 `history` ring buffer 也整份移除了：那是同一份遙測的第二份拷貝，
而且每一批對每個變動的 key 各做一次 `splice(0,1)`（3000 點 × 約 20 個 key × 20 Hz
≈ 每秒 240 萬次元素搬移）。時間序列只有 `LogStore` 一份。
