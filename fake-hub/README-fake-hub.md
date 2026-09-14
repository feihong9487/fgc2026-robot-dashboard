# 假 Control Hub（`FGC2026/fake-hub/fake-hub.mjs`）

模擬 FGC 2026 機器人端橋接器的兩個服務，讓儀表板前端**完全離線**也能開發：

| 服務 | 埠 | 對應真機檔案（`../teamcode-v3/`） |
| --- | --- | --- |
| WebSocket（SDK namespace 協定，namespace = `dash`） | 8081 | `DashWs.java` / `DashPublisher.java` |
| HTTP（`/dash/*`） | 8080 | `DashHttp.java` |
| 參數白名單 / 邊界 / 回讀 | — | `DashParams.java`（min/max 逐條抄過來） |
| 遙測資料表 | — | `DashHub.java`（`latest` + `dirty` 兩張表的行為一致） |

純 Node ESM，只用到一個 devDependency：`ws`。這個資料夾是自成一國的小專案，
跟 `teamcode-v3/`（上機的 Java 原始碼）完全分開，不會被 `tools/check.ps1` 掃到。

---

## 1. 啟動

```bash
cd C:\Users\feihong\Desktop\FGC2026\fake-hub
npm install --no-audit --no-fund   # 第一次才要（只裝 ws）
npm run fake-hub
```

或直接帶參數（預設值就是下面這組）：

```bash
node fake-hub.mjs --http 8080 --ws 8081 --mode PIT
node fake-hub.mjs --http 8090 --ws 8091 --mode MATCH   # 換埠、以 MATCH 起
node fake-hub.mjs --no-rec                             # 這一場不寫錄影檔
node fake-hub.mjs --help
```

啟動後會印出所有網址。`Ctrl+C` 離開（離開前會把錄影 flush 掉）。

**第一次啟動**會自動在 `fake-rec/` 產生兩個各 150 秒的假錄影檔（`rec-*.jsonl`，
每行 `{"t":秒,"d":{...}}`，內容用與即時模擬同一套產生器，種子固定所以每次都一樣）；
之後啟動看到資料夾裡已經有檔就不再產生。想重來一次就把 `fake-rec/` 整個刪掉。

---

## 2. 前端要連的位址

一律連 **`127.0.0.1`**（不要用 `localhost`，某些環境會先解析到 IPv6 再 fallback，多花幾百毫秒）：

```
ws://127.0.0.1:8081          ← 遙測 / 調參
http://127.0.0.1:8080/dash/  ← health、state.json、set、rec、MJPEG
```

所有 HTTP 回應都帶 `Access-Control-Allow-Origin: *` 與 `Cache-Control: no-store`，
所以 Vite dev server（5173）直接 `fetch()` 不需要 proxy。

MJPEG 直接餵給 `<img>` 就好：

```html
<img src="http://127.0.0.1:8080/dash/stream.mjpg" />
```

`/CameraPublisher/C270/streams` 這個 key 會回
`["mjpg:http://127.0.0.1:8080/dash/stream.mjpg"]`，前端可以照真機的做法從這裡拿網址。

---

## 3. 用瀏覽器 console 測 8081（三行）

打開任何一個分頁的 DevTools console，貼這三行：

```js
const ws = new WebSocket("ws://127.0.0.1:8081");
ws.onmessage = e => { const m = JSON.parse(e.data); console.log(m.type, JSON.parse(m.payload)); };
ws.onopen = () => ws.send(JSON.stringify({ namespace: "system", type: "subscribeToNamespace", payload: "dash" }));
```

你會看到：

- 訂閱後立刻一則 `hello`，payload 是**全量**狀態（約 100 個 key）；
- 之後每 50 ms 一則 `nt`，payload **只有這 50 ms 內有變化的 key**；
- 每 2 秒再補一則全量 `hello`（掉封包也能自己追回來）。

調參（PIT 模式才會成功）：

```js
ws.send(JSON.stringify({ namespace: "dash", type: "set",
  payload: JSON.stringify({ k: "/FGC/Tune/VEL_SL", v: 1750 }) }));
// 成功 → 下一則 nt 會帶 /FGC/Param/VEL_SL 與 /FGC/Tune/VEL_SL = 1750
// 失敗 → 收到 {"namespace":"dash","type":"err","payload":"{\"k\":...,\"why\":...}"}
//        同時 /FGC/Bridge/Last Set Rejected 會被更新
```

要重新拿一次全量狀態：`ws.send(JSON.stringify({namespace:"dash",type:"hello",payload:""}))`。

> **注意**：訊息信封固定是 `{"namespace","type","payload"}`，而 `payload` 永遠是**字串**
> （字串內容本身才是 JSON）—— 這點和真機的 FTC SDK 一模一樣，前端記得 `JSON.parse` 兩次。
> 沒送 `subscribeToNamespace` 之前，伺服器不會推任何 `dash` 訊息；訂閱不存在的 namespace
> 也不會回錯（SDK 就是這樣，靜靜的）。

---

## 4. 用 curl 測 8080

```bash
# 健康檢查（純文字；MATCH 也看得到）
curl http://127.0.0.1:8080/dash/health

# 全量狀態（MATCH 回 503）
curl http://127.0.0.1:8080/dash/state.json

# 調參：可以用完整 key 或只給名稱
curl "http://127.0.0.1:8080/dash/set?k=/FGC/Tune/VEL_SL&v=1750"   # {"ok":true,"why":""}
curl "http://127.0.0.1:8080/dash/set?k=VEL_SR&v=1880"             # {"ok":true,"why":""}
curl "http://127.0.0.1:8080/dash/set?k=/FGC/Tune/AIM_KP&v=5"      # {"ok":false,"why":"out of range 0..0.2000"}
curl "http://127.0.0.1:8080/dash/set?k=/FGC/Tune/NOPE&v=1"        # {"ok":false,"why":"unknown key"}
curl "http://127.0.0.1:8080/dash/set?k=/FGC/Tune/WAIT_SPINUP&v=false"

# 特殊指令：存檔 / 讀檔 / 產生 Constants.java 片段
curl "http://127.0.0.1:8080/dash/set?k=_save"      # 寫 fake-tune.json
curl "http://127.0.0.1:8080/dash/set?k=_load"      # 讀回來並全部回推
curl "http://127.0.0.1:8080/dash/set?k=_snippet"   # 更新 /FGC/Param/_Snippet

# 錄影清單：{"dir","current","files":[{"name","size","mtime"}, ...]}（新到舊）
curl http://127.0.0.1:8080/dash/rec.json

# 錄影內容（application/x-ndjson）
curl "http://127.0.0.1:8080/dash/rec.jsonl?name=rec-20260906-160000.jsonl"
curl "http://127.0.0.1:8080/dash/rec.jsonl?name=live"   # 記憶體裡最近 6000 行
curl "http://127.0.0.1:8080/dash/rec.jsonl"             # 不給 name → 最新那個檔

# 影像
curl -o snap.jpg http://127.0.0.1:8080/dash/snapshot.jpg
curl -N "http://127.0.0.1:8080/dash/stream.mjpg?fps=15" | head -c 400 | xxd | head
```

`/dash/stream.mjpg` 是 `multipart/x-mixed-replace; boundary=fgcframe`，
預設 100 ms 一格（10 fps），`?fps=` 可改（1–30）。`?q=` 收得下但不生效（4 張圖是內建的）。
**同時只允許一條**，第二條連線回 `503`；MATCH 模式也回 `503`。

---

## 5. 切模式（PIT / MATCH）

真機的模式是由跑哪一支 OpMode 決定的，假伺服器多開了兩個端點方便前端測：

```bash
curl "http://127.0.0.1:8080/dash/mode?m=MATCH"   # {"ok":true,"why":"mode=MATCH"}
curl "http://127.0.0.1:8080/dash/mode?m=PIT"
curl "http://127.0.0.1:8080/dash/enabled?v=0"    # 總開關關掉（等同 Driver Hub 跑 Z-DASH-OFF）
curl "http://127.0.0.1:8080/dash/enabled?v=1"    # 等同 Z-DASH-ON
```

也可以直接在瀏覽器網址列打開這幾個網址。啟動時要以 MATCH 起就加 `--mode MATCH`。

**`enabled=0` 之後（和真機一致）**：

| | 行為 | 依據 |
| --- | --- | --- |
| 七條註冊路徑 | 全部回 **404 `dash disabled`**（含 `/dash/health`） | `DashBridge.java:143-149` `HttpShell` |
| 8081 的 `nt` / `hello` / `notify` | 全部停止推播 | `DashPublisher.java:46`、`DashBridge.java:213` |
| **本機錄影** | **照常進行**（`rec.addLine` 不看總開關） | `DashPublisher.java:37-46`，註解明寫這是刻意的 |

最後一列很重要：跑過 Z-DASH-OFF 之後錄影還在寫，但 `health` 已經 404，所以前端
**看不到** `reclines`。儀表板的「錄影行數在動」在這個情境要顯示「沒有讀數」而不是
「停了」——這兩件事在賽後追查時差很多。

前端的「關閉路徑三格」第 ② 格就是靠這個 404 判定 `Z-DASH-OFF` 已生效，而不是靠
「我按了某個按鈕」。`/dash/mode` 與 `/dash/enabled` 是假伺服器專用端點（真機沒有），
不受這個閘影響，否則關掉就再也開不回來。

**MATCH 模式的行為（和真機一致，前端一定要測到）：**

| 端點 / 行為 | PIT | MATCH |
| --- | --- | --- |
| WS `nt` / `hello` 推播 | 有 | **完全沒有**（只在切換的當下推一次） |
| WS / HTTP `set` | 照白名單接受 | 一律拒絕（WS 回 `err`、HTTP 回 403） |
| `/dash/state.json` | 200 全量 JSON | 503 |
| `/dash/stream.mjpg`、`/dash/snapshot.jpg` | 200 | 503 |
| `/dash/health` | 200 | 200（比賽中也能看健康狀態，含 `reclines`） |
| `/dash/rec.json`、`/dash/rec.jsonl` | 200 | **503**（真機 `DashHttp.RecList`/`RecFile` 都有 `pit()` 閘） |
| `/FGC/Vision/*` | 有完整 tag 資料 | `CamState=CLOSED`、`Count=0` |
| 錄影 | 錄 | 照錄（真機也是不分模式一律錄） |

所以「連線後畫面整個不動」在 MATCH 是**正確行為**，不是前端壞掉 ——
前端應該用 `/dash/health` 的 `mode=` 或最後一則 `/FGC/Bridge/Mode` 顯示提示。

---

## 6. 模擬出來的資料

20 Hz 更新，key 命名與機器人端一致（共約 100 個 key）：

| 群組 | 內容 |
| --- | --- |
| `/FGC/Bridge/*` | `Mode`、`Gen`、`Threads`、`Viewers`、**`Build`**（真機是 `/FGC/Bridge/Build`，沒有 " Tag"）、`Enabled`、`Camera`、`Last Set`、`Last Set Rejected`、`Last Error` |
| `/FGC/Status/*` | `Battery V`（12.9 起，隨射擊壓降 + 時間緩降）、`Loop ms`（20±3，偶發 40 尖峰）、`OpMode`（`B1-PIT` / `A1-MATCH`）、`Match s` |
| `/FGC/Drive/*` | `Forward`、`Turn`、`Reversed`、`State`（`COLLECT` / `SHOOT` / `EJECT`） |
| `/FGC/Shooter/*` | `SL`、`SR`、`Way`、`TargetL`、`TargetR`、`AtSpeed`、`SpinupMs`、`CurrentL`、`CurrentR`、`CurrentWay`、`OverCurrentL/R/Way` |
| `/FGC/Climb/*` | `Pos`、`Holding`、`Current` |
| `/FGC/Hopper/Cmd` | `OPEN` / `CLOSE` / `STOP` |
| `/FGC/Intake/Power` | 依狀態機給 `INTAKE_COLLECT` / `INTAKE_SHOOT` |
| `/FGC/Gamepad/*` | `LY`、`RX`、`LT`、`RT`、`Cross`、`Square`、`L1`、`R1`、`DUp`、`DDown`（與模擬駕駛一致） |
| `/FGC/Vision/*` | `Count`、`FPS`、`Best/Id`、`Best/Range m`、`Best/Bearing deg`、`Best/Yaw deg`、`Best/Margin`、`Best/Age s`、`Tags`、`CamState` |
| `/FGC/Param/*` | 21 個參數的回讀值 + `_Snippet`（可貼回 `Constants.java` 的片段）+ **`Build <NAME>` × 21**（編譯值，不隨 set 改變，給 ParamDiffCard 對照用） |
| `/FGC/Tune/*` | 21 個參數的寫入用 key（值與 `/FGC/Param/*` 同步） |
| `/FGC/Rec/*` | `File`、`Lines`、`Flush Age s` |
| `/CameraPublisher/C270/streams` | `string[]`，MJPEG 網址 |
| `/FGC/Probe/Counter` | 每秒 +1（拿來驗證推播沒斷） |

模擬駕駛的節奏：每 8 秒一輪 —— 前 4 秒 `COLLECT`、後 4 秒 `SHOOT`
（射手以時間常數 0.35 s 一階上升到 `VEL_SL`，越過 `FEED_THRESHOLD` 後 `AtSpeed=true`
開始餵球，每輪 3–5 球，每球造成 −250 tps 的 dip 再回復），約四分之一的輪次會插一段
`EJECT`。`CurrentL/R/Way` 每 5 圈才更新一次（≈4 Hz，模擬真機 `getCurrent()` 不在 bulk cache 裡），
同一批同時更新 `OverCurrentL/R/Way` 與 `/FGC/Climb/OverCurrent`（真機 `FGC2026_TeleOp_Match.java:571-581`）。
AprilTag 102 的距離在 2.0–4.5 m 之間緩慢變動，每隔十幾秒會「看不到」1–2.5 秒，
這時 `Count=0`、`Tags=[]`、`Best/Age s` 持續累加。

值型別只有四種：`number` / `boolean` / `string` / `string[]`，和真機 `DashHub.toJson()` 一致。

另外 PIT 模式下每 **20 秒**會廣播一則 `notify`（`{"level","title","desc","ttl"}`，
level/title 一律 ASCII），輪流送 `SHOOTER_LOW` / `REC_ROLLED` / `OVERCURRENT_WAY` /
`BATTERY_LOW` 四則，用來測前端的通知 rail 與「通知寫進 log 成為第九類事件」。
`/FGC/Status/Loop ms` 平時 20±3 ms，約 1.5% 的圈會噴到 38–44 ms 的長尾，
拿來驗前端自算的 p95 與 loop 直方圖。

---

## 7. 可調參數（白名單與上下界，抄自 `DashParams.java`）

寫入用 `/FGC/Tune/<NAME>`，回讀看 `/FGC/Param/<NAME>`；超界、型別不符、不在白名單一律拒絕。

| 參數 | 型別 | min | max | 預設 |
| --- | --- | --- | --- | --- |
| `DEADZONE` | double | 0 | 0.40 | 0.06 |
| `TURN_SCALE` | double | 0 | 1.0 | 0.80 |
| `VEL_SL` | double | 0 | 3000 | 1900 |
| `VEL_SR` | double | 0 | 3000 | 1900 |
| `IDLE_TPS` | double | 0 | 3000 | 0 |
| `EJECT_VEL` | double | 0 | 3000 | 1600 |
| `WAIT_SPINUP` | boolean | — | — | true |
| `FEED_THRESHOLD` | double | 0 | 3000 | 1200 |
| `WAY_TPS` | double | 0 | 3000 | 1800 |
| `WAY_IDLE_TPS` | double | 0 | 3000 | 400 |
| `INTAKE_COLLECT` | double | 0 | 1.0 | 1.0 |
| `INTAKE_SHOOT` | double | 0 | 1.0 | 1.0 |
| `CLIMB` | double | 0 | 1.0 | 1.0 |
| `HOLD` | double | 0 | 1.0 | 0.6 |
| `HOPPER_POWER` | double | 0 | 1.0 | 1 |
| `TAG_DECIMATION` | double | 1 | 8 | 2 |
| `TAG_MIN_MARGIN` | double | 0 | 200 | 30 |
| `AIM_KP` | double | 0 | 0.20 | 0.01 |
| `AIM_MAX` | double | 0 | 1.0 | 0.3 |
| `MJPEG_FPS` | double | 1 | 30 | 10 |
| `MJPEG_Q` | double | 5 | 95 | 40 |

改過的值 `_save` 會寫進 `fake-tune.json`，下次啟動自動讀回（真機是
`/sdcard/FIRST/fgc-tune.json`）。想回到出廠值就把這個檔刪掉。

---

## 8. 已知限制

- MJPEG 是 4 張 64×48 的內建純色 JPEG 輪播（`?q=` 只是收下不生效），不是真畫面。
- 錄影：這一場的資料每 10 秒 append 到 `fake-rec/rec-<時間>.jsonl`，
  跑久了會長大（約 1 MB / 分鐘）。不想寫檔就加 `--no-rec`（記憶體 ring 仍有，
  `/dash/rec.jsonl?name=live` 照樣可用）。
- 只支援簡單 GET（跟真機一樣），沒有 POST；`OPTIONS` 一律回 204。
- 這支程式只是模擬器：不要拿它的行為當規格，規格以 `teamcode-v3/` 的 Java 為準。
