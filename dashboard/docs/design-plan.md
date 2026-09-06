# FGC 2026 儀表板 · 視覺設計計畫
## 方向 A —— 野火暗色工業風

> **一句話定位**：這塊儀表板是一片被野火燒過的鋼板。底色是冷掉的炭，資料是熱像儀的青與琥珀，**只有還連著機器人的地方是燙的**——那是唯一的橘。

---

# 1. 現況批評

## 1.1 駕駛頁 `s4-01-drive.png`

1. **左欄五張卡片完全同構**（射擊就緒／飛輪雙環／狀態機／球節奏／手把）：同樣 6px 圓角、同樣 1px `--border`、同樣 `--surface-2` 底。這是 skill 點名的第 4 種 AI 預設「SaaS-card kit」。因為每張都有框，**框不再帶任何資訊**——看不出哪張是現在該看的。
2. **每張卡標題後面都掛一句灰色小字**（「F 全螢幕」「機器人端 atSpeed 從未比較兩顆是否一致」「唯讀顯示，不是選單」「dip 為前端推估」「RT / LT 的黃線是機器人端 0.5 判定閾」）。這是 skill 第 5 條「WORD — fragment」模板 chrome 的變體。五句加起來 70 個字，在 3 秒律的頁面上是純噪音。
3. **狀態機三格（畫面中段 y≈500-575）長得像分段控制器**：等寬、圓角、SHOOT 用綠底黑字反白。版面語彙說「可點」，所以才需要用標題文字澄清「不是選單」。**要靠文字澄清的版面就是錯的版面**。
4. **一個畫面六種飽和色**：頂欄 accent 藍（`127.0.0.1` 輸入框 + 「駕駛 D」分頁）、巨燈綠、SL 青環、SR 橙環、爬升綠柱、車頭綠三角、警報紅條。skill 說「Spend your boldness in one place」——現況花了六個地方，於是一個都不醒目。
5. **右上「比賽計時」下方那條全灰進度條（y≈157）是純裝飾**：練習跑沒有終點，條永遠是 0%。它佔了 12px 高度、橫貫整張卡，只為了讓卡片「看起來完整」。

## 1.2 圖表頁 `2c-03-graph-full.png`

1. **粉紫 `#ba68c8` 的 Way 線**是 matplotlib `tab10` 的既視感。在深藍底上，粉紫是整個調色盤裡最沒有「工業」感的顏色，它讓工程波形看起來像資料科學筆記本。
2. **左欄訊號樹每列塞三種 metadata**（`○` 圓圈 + 名稱 + 值 + 右邊灰色 `A`/`#`/`⊡`），擠在 17px 行高裡。`A`/`#`/`⊡` 沒有任何圖例，使用者只能靠猜。
3. **底部六條 DiscreteBand（y≈635-760）與上方折線不同源**：State 的綠 `#81c784` ≠ 折線裡任何一條線的綠；色塊滿版飽和，整條看起來像堆疊的進度條而不是時序帶。
4. **右欄 Inspector 每列尾巴掛 `–` 與 `×`** 兩個灰符號，又是第三套圖示語彙（左欄用 `○`，中間用色塊，右欄用符號）。
5. **底部「總覽」縮圖用的青色 = `--series-1`**，於是那條波形看起來像第七條資料線，而不是導航控制項。

## 1.3 檢查頁 `s4-health.png`

1. **`N O G O` 用 `letter-spacing: 0.22em` 拉開的全大寫橘字**（`health.css:48`）——skill 第 5 條「tracked-out ALL-CAPS eyebrow」的教科書案例。而且拉開後第一眼讀成四個獨立字母。
2. **15 張一模一樣的卡片鋪成 5×3**：通過的與不通過的卡片外觀完全相同，唯一差別是左上角一個 6px 色點。**掃描這面牆的成本 = 讀 15 個色點**，而使用者真正要知道的是「哪 4 個要修」。
3. **底部「關閉路徑」用 (1) (2) (3) 編號**——skill 明說編號只在內容真的是序列時才用。這三格是三種並列的關閉方式，不是三個步驟。
4. **卡片右上角的「指紋」chip 只有 3 張有**（橋接執行緒 / Build / 8081 推播），沒有任何解釋。它是一個沒有圖例的 badge。
5. **紅色說明長文與數值同一個字級區間**：「10.5 V」（24px）底下壓著三行 12px 紅字，15 張卡裡有 6 段。真正要讀的數字被自己的註解淹掉。

## 1.4 鎖定頁 `s4-04-match-lockdown.png`

1. **「比 賽 模 式 鎖 定」用 `letter-spacing: 0.35em`**（`lockdown.css:29`）。**中文加字距是排版上最沒有收益的操作**——漢字本來就是等寬方塊，拉開只會變鬆散，不會變莊重。
2. **設計意圖與結果相反**：規格說 lockdown 要「刻意不好看，像一台關著的機器」，現況卻是一個 650×110 的亮橘大框加亮橘大字。那是**「非常醒目」**，不是「關著」。
3. **頂部兩條 bar 資訊重複**：頂欄有 `Build fake-hub 2026…`，下面那條又有 `Build fake-hub 20260906-190122`。
4. **灰化只作用到上半頁**：下面三張卡（機器人端錄影中 / 場上的三個判斷 / 賽後取檔）是正常對比的深色卡，`54,588` 用了 28px 亮白數字。一頁之內兩種能量。
5. **卡內堆了 220 個字的教學長文**（「行數每 10 秒跳一階（flush 週期），所以要看 30 秒才判得出停沒停」）。比賽日站在這台電腦前的人沒有一秒鐘會讀它。

## 1.5 參數頁 `s4-tune.png`

1. **21 條全寬亮藍實心滑軌是整頁最強的視覺**。但調參是打數字，滑桿是這頁**最不需要精確**的輸入方式。頁面把最強的視覺配給了最弱的功能。
2. **左欄輸入框與右欄回讀值之間 21 個 `→`**，垂直連成一條裝飾線。skill 第 5 條點名 `→` 是模板 chrome 的 tell。
3. **`WAIT_SPINUP` 的 `ON` 是綠底黑字按鈕**，在 20 個藍框輸入框之間視覺不同源，看起來像「被選中的分頁」而不是一個布林值。
4. **右欄「區間統計」的直方圖用青色，左欄滑桿用藍色**——`#4dd0e1` 與 `#4fc3f7` 相差 12° 色相，並排時難分，於是「這是資料」與「這是控制項」在色彩上沒有分界。
5. **底部「寫回帳本」空卡佔 130px 高**，只裝一句灰字。空狀態沒有邀請任何行動。

## 1.6 射手頁 `s4-shooter.png`

1. **右側 220px 內三層邊框套疊**：外卡片框 → 內小卡框 → 表格框。在最窄的欄位裡用了最多的框線。
2. **`−6 tps` 底下那條 −300/0/+300 的軌**有兩根橘色刻度豎線（y≈163）但**沒有標籤**，使用者不知道那是失衡門檻。
3. **電流區四條 sparkline（L/R/W/爬）用青橙青紫**，與主圖的 SL/SR/Way **同色但不同訊號**——spec §6.5 明訂的「固定綁定」在這裡被打破了。
4. **「每球 dip」表格四欄不對齊**：底值/深度是數字右對齊，恢復是 `627ms` 混排，跌破是「否」。同一列裡三種對齊。

## 1.7 回放頁 `s4-05-replay.png`

1. **頂部「事件」軌（y≈122）是一整排糊掉的彩色字元**：484 秒塞 582 個 `▲■●○`。它不是資訊，是一條噪音帶。
2. **事件篩選 8 個 chip 各自一色**（射擊 61 / 達速 60 / 球 dip 218 / 爬升 65 / 退球 14 / 車頭 9 / 電壓 55 / 故障 100），這是第三套獨立於 `series-*` 與 `tone` 的顏色系統。
3. **底部狀態列用 `·` 串起 7 段 meta**：`t=robot (…) · 7,770 批 · 間隔 p50 62.0 ms · p95 64.0 ms · 缺口 0 處 · 116,045 樣本 · 2.6 MB · 121 欄位`。skill 第 5 條直接點名「meta strings joined with middle dots」。
4. **右上三個按鈕圖示語彙不一致**：「📌 書籤」有 emoji、「匯出 ▾」有三角、「離開回放」什麼都沒有。

## 1.8 field 主題 `s4-03-field-drive.png` / `s4-03-field-signals.png`

1. **純黑底 + `#3a3a3a` 邊框 = 一堆看不見的框**。field 主題只換了底色與字級，卡片結構原封不動，結果是卡片邊界在 1.5 m 外完全消失，內容像浮在虛空。
2. **EJECT 狀態整張卡染紅**（紅框 + 暗紅底 + 紅巨燈 + 紅巨字），1.5 m 外只看到一片紅，讀不出「是哪一格出事」。
3. **「比賽計時」標題在 `--font-scale: 1.6` 下換行成兩行**，把 `+52:11` 擠到卡片右側。**標題放大只會換行，不會更好讀**。
4. **雙環儀表沒有跟著放大**（canvas 固定尺寸），與周圍 1.6 倍的字完全不成比例。
5. **`s4-03-field-signals.png` 的群組標題 `/FGC/Bridge` 是亮藍色**。field 主題號稱只有綠/黃/紅/白——這是相容層 `--accent` 漏出來的藍。
6. **每列左邊 30px 的 `⊡` 欄大部分是空的**，形成一條貫穿全頁的空白溝；而值靠螢幕最右對齊，key 靠最左，中間 1000px 全空，眼睛要橫跨整個螢幕連線（`01-pit-signals.png` 更明顯）。

---

# 2. 設計計畫

## 2.1 色

### 核心六色（具名）

| 名 | hex | oklch | 用途 |
|---|---|---|---|
| **炭 `--char`** | `#0E141C` | `oklch(.189 .019 256)` | 頁底。有可測量的藍色度（C=.019），不是 `#111`（C=0） |
| **燼 `--ash`** | `#161F2A` | `oklch(.236 .025 254)` | 面板/卡片底 |
| **煤 `--soot`** | `#1F2A38` | `oklch(.281 .030 255)` | 凹槽：輸入框、表頭、圖表繪圖區 |
| **骨白 `--bone`** | `#E4EAF2` | `oklch(.935 .013 256)` | 主文字與數值（15.3:1） |
| **煙 `--smoke`** | `#8B99AC` | `oklch(.678 .032 256)` | 標籤、單位、說明（6.4:1） |
| **野火橘 `--wildfire`** | `#FF6B1A` | `oklch(.703 .198 43)` | **全案唯一強調色**（6.5:1） |

> 三層 surface 的**色度遞增**（.019 → .025 → .030）：越上層越有顏色。這讓三層在暗處仍可分辨，而不需要靠陰影。**全案零陰影**。
>
> 橘底上的字永遠是 `--char`（6.49:1）。骨白在橘上只有 **2.35:1**，禁用。

### 資料色（色盲安全的冷青／琥珀序列）

| token | hex | oklch | 綁定 |
|---|---|---|---|
| `--series-1` 冷青 | `#3FC9DE` | `oklch(.772 .118 210)` | **SL**（固定） |
| `--series-2` 琥珀 | `#F2A93B` | `oklch(.787 .147 73)` | **SR**（固定） |
| `--series-3` 松青 | `#1F9E96` | `oklch(.633 .104 188)` | CurrentL 等 |
| `--series-4` 冷紫 | `#9B8CFF` | `oklch(.703 .164 287)` | **Way**（固定） |
| `--series-5..8` | `#8FE0EE` `#FFD08A` `#5FC8C0` `#C7BEFF` | L≈.83–.88 | 1–4 的淺色版，**強制配線型** |

> **這裡的誠實話**：八條線不是靠八個顏色分的。1–4 靠色相（青/琥珀/松青/冷紫在 deuteranopia 下仍互相可分，因為它們橫跨藍黃安全軸並且明度差 ≥ .07）；5–8 是 1–4 的淺色版 **+ 強制 dash**（5,6 → `[8,4]`；7,8 → `[2,3]`）。八個獨立色相在暗底上必然會撞到警戒色。
>
> 刪掉了現況的粉 `#f06292` 與棕 `#a1887f`——粉會撞 `--err`，棕在暗底上是泥。

### 警戒三色 + stale / gap

| token | hex | oklch | 對比 | 語意 | 形狀 |
|---|---|---|---|---|---|
| `--ok` | `#3FD08A` | `oklch(.764 .159 158)` | 9.3:1 | 符合驗收條件 | `●` |
| `--warn` | `#FFD429` | `oklch(.882 .172 93)` | 13.0:1 | 接近界線 | `▲` |
| `--err` | `#FF4D6D` | `oklch(.679 .213 15)` | 5.8:1 | 超出驗收線 | `■` |
| `--stale` | `#6C7B90` | `oklch(.578 .037 257)` | 4.3:1 | 無資料／已過期 | `○` |
| `--gap` | `#44566D` | `oklch(.448 .044 255)` | 2.5:1 | 資料缺口斜線紋 | （紋理） |

> `--err` 從 Material 的 `#e57373`（H 25°，離野火橘 43° 只有 18°）推到 **H 15°** 的洋紅紅。這是必要的：錯誤紅絕不能被誤讀成「這裡可寫」。
> `--warn` 從 `#ffb74d`（H 73°，**與琥珀資料色同色相**）推到 **H 93°** 的訊號黃。現況的警告橘與 SR 的資料橙是同一個顏色，這是個真 bug。

### `--danger` 與 `--focus-ring`

兩者都 = `--wildfire`。這是本方案的核心決定：

> **橘只有一個意思：這裡連著機器人。**
> 橘出現在——可寫欄位的邊框、送出按鈕、focus ring、當前分頁的下標線、lockdown 的錄影徽章。
> **資料永遠不橘。警戒永遠不橘。** 全頁橘色像素預算 < 2%。

### dark 主題完整表

| 語意 token | 值 | 說明 |
|---|---|---|
| `--surface-1` | `#0E141C` | 頁底 |
| `--surface-2` | `#161F2A` | 卡片 |
| `--surface-3` | `#1F2A38` | 輸入/表頭/繪圖區 |
| `--text` | `#E4EAF2` | |
| `--text-dim` | `#8B99AC` | |
| `--border-c` | `#2C3A4B` | `oklch(.344 .035 254)`，1.6:1 —— 刻意低，框不該搶戲 |
| `--border-hi` | `#3D4E63` | hover / 表格分隔 |
| `--ok / --warn / --err` | 見上表 | |
| `--danger` | `#FF6B1A` | = wildfire |
| `--focus-ring` | `#FF6B1A` | = wildfire |
| `--on-fire` | `#0E141C` | **橘底上的字色**（新增 token） |
| `--stale` | `#6C7B90` | |
| `--gap` | `#44566D` | |
| `--target` | `#B9C6D6` | 目標線（骨白降一階，10.7:1） |
| `--thresh` | `#FFD429` | = warn |
| `--state-collect` | `#3FC9DE` | 青 |
| `--state-shoot` | `#3FD08A` | 綠 |
| `--state-eject` | `#FF4D6D` | 紅 |
| `--band-on` | `#3FD08A` | |
| `--band-off` | `#2C3A4B` | |
| `--band-neg` | `#9B8CFF` | |
| `--alliance-red` | `#E03A4B` | 保留；明度比 `--err` 低一階 |
| `--alliance-blue` | `#3D7DE8` | 保留 |
| `--field-bg` | `#080C12` | 相機/場地畫布（比頁底再深一階） |
| `--field-grid` | `#22303F` | 1.4:1 |
| `--field-tag` | `#FFD429` | |
| `--fov` | `#3FC9DE` | |

### field 高對比主題表（賽場、站著、1.5 m）

| token | 值 | 對比（於 `#000`） | 備註 |
|---|---|---|---|
| `--surface-1/2` | `#000000` | — | 純黑 |
| `--surface-3` | `#0F1318` | 1.13 | 唯一有色度的層 |
| `--text` | `#FFFFFF` | 21.0 | |
| `--text-dim` | `#B6C2D0` | 11.6 | 比 dark 的煙亮兩階——1.5 m 外 6:1 不夠 |
| `--border-c` | `#4A5461` | 2.7 | **但 field 主題下卡片不畫框**（見版面） |
| `--ok` | `#22FF88` | 15.7 | |
| `--warn` | `#FFE01B` | 15.9 | |
| `--err` | `#FF5A5A` | 6.9 | 紅先天低明度 → **錯誤態靠面積與 `■` 補償，不靠對比** |
| `--danger`/`--focus-ring` | `#FF8A3D` | 9.0 | 橘在純黑上要提亮到 L=.75 |
| `--series-1..4` | `#22E0FF` `#FFB020` `#00E5C0` `#B49BFF` | 13.2 / 11.5 / 13.0 / 9.1 | |
| `--stale` | `#8A939E` | 6.8 | |
| `--u` | `10px` | | 命中區 ≥ 44px |
| `--font-scale` | `1.6` | | **只作用於讀數音階** |
| `--fs-md/sm/xs` | `19/16/13px` | | 標籤明確重新宣告，不吃 1.6 倍 |

> field 主題的三條硬規則：
> 1. **卡片不畫框**，只靠 `--u × 3` 的留白分組。純黑上的低對比框線是視覺垃圾。
> 2. **標題不放大**。放大的只有數字。（這一條直接修掉「比賽計時」換兩行的 bug，也讓 `styles.css:990` 的 `.fgc-bar` hack 可以刪掉。）
> 3. **狀態色不填滿卡片**，只填燈本體。

### lockdown 灰化規則（MATCH 專用，不可切換）

演算法式的一句話：**把整個 dark 主題的色度歸零，只留一個 10px 的橘方塊。**

| token | 值 | oklch | 說明 |
|---|---|---|---|
| `--surface-1` | `#15171A` | `(.204 .007 258)` | 色度 .019 → .007 |
| `--surface-2` | `#1B1E22` | `(.234 .009 256)` | |
| `--surface-3` | `#23272C` | `(.271 .011 254)` | |
| `--text` | `#B9BCC0` | `(.794 .007 256)` | **9.4:1，比 dark 低 38%** |
| `--text-dim` | `#71757B` | `(.561 .010 258)` | 3.9:1 |
| `--border-c` | `#31353A` | `(.327 .010 254)` | |
| `--ok`/`--warn`/`--err`/`--series-1..8`/`--state-*` | 全部 `#7E8288` | `(.605 .010 258)` | 單一灰 |
| `--stale` | `#5A5E63` | `(.480 .009 254)` | |
| `--danger` | `#C9642A` | `(.615 .146 47)` | **降飽和的橘，只給錄影徽章** |
| `--focus-ring` | `#7E8288` | | 灰 —— lockdown 頁沒有可 focus 的東西 |
| `--u` | `10px` | | |
| `--font-scale` | `1` | | |

> **「刻意不好看」的正確做法不是加一個很大的橘框，是把所有能量抽掉。**
> lockdown 頁只有一個像素等級的顏色：左上角 10×10 的 `#C9642A` 方塊（錄影中）。橘框、`letter-spacing: 0.35em`、28px 亮白數字全部拿掉。整頁最亮的東西是 `--text` 的 9.4:1 —— 遠看是一台待機的機器。

---

## 2.2 字

### 家族與角色分工

```css
--font-ui:  "Noto Sans TC", "Microsoft JhengHei", "PingFang TC", "Noto Sans", system-ui, sans-serif;
--font-num: ui-monospace, "Cascadia Mono", Consolas, "Noto Sans Mono", monospace;
```

**關鍵改動：把 `"Segoe UI"` 從第一位拿掉。** 現況 `styles.css:22` 是 `"Segoe UI", "Microsoft JhengHei"`，結果拉丁字來自 Segoe（humanist，軸心偏斜）、漢字來自正黑（neo-grotesque），兩套設計軸混在一行裡。改成 Noto Sans TC 打頭，拉丁與漢字都出自同一個家族，`VEL_SL` 與「射手」的筆畫粗細才會一致。無 web font 載入。

| 角色 | 家族 | 說明 |
|---|---|---|
| 中文一切 | `--font-ui` | 標題、標籤、說明、按鈕、空狀態 |
| 拉丁 UI 文字 | `--font-ui` | 分頁名、狀態機字面值 |
| **所有數值** | `--font-num` + `tabular-nums` | 含單位後綴 |
| 機器字面字串 | `--font-num` | `/FGC/Tune/VEL_SL`、`rec-…jsonl`、`fake-hub 20260906-190122` |
| 形狀語彙 `●▲■○□` | **`--font-ui`** | ← 見下方陷阱 |

> **等寬白名單就是上面這四項。** 禁止等寬的地方：卡片標題、按鈕文字、說明段落、空狀態文案、圖表標題。skill 第 5 條「a monospace face for small data labels」是 tell —— **等寬給值，不給標籤**。
>
> **實作陷阱（現況是錯的）**：`styles.css` 的 `.fgc-glyph { font-family: var(--mono) }`。多數等寬字體沒有 `▲■●○` 這幾個 CJK 符號，會 fallback 到不同字體，四個字元寬度不一致，燈牆就對不齊。**改成 `--font-ui` + `display:inline-block; width:1.25em; text-align:center`**。

### 字級階梯（實際 px）

分成兩個音階，理由不同：

**讀數音階** —— 以 **28px = 1.5 m 可讀下限**為基準（96 dpi 下 28px ≈ 7.4 mm，對應 1.5 m 的實務閱讀角），向上以完全五度 **1.5** 推：

| token | px | 用途 |
|---|---|---|
| `--fs-hero` | **94** | 巨燈狀態字 —— **全案只有一個元素能用** |
| `--fs-2xl` | **63** | 比賽計時、爬升分數（新增） |
| `--fs-xl` | **42** | 卡片主讀數：SL/SR tps、電壓、失衡值 |
| `--fs-lg` | **28** | 狀態膠囊、燈牆每列主值 —— **1.5 m 可讀下限** |

**介面音階** —— 以 **14px = 60 cm 桌面閱讀下限**為基準，小三度 1.2：

| token | px | 用途 |
|---|---|---|
| `--fs-md` | **17** | 卡片標題、按鈕、分頁 |
| `--fs-sm` | **14** | 表格、表單、正文（基準） |
| `--fs-xs` | **12** | 單位、軸標籤、圖例 —— **全案最小，沒有 11px** |

> `--font-scale` **只乘讀數音階**。介面音階固定。這是一條實質規則：field 主題下放大的是數字，不是標籤。
> **本設計沒有 11px。** 這條限制強迫你刪掉標籤，而不是把它縮到讀不到。

### 字重

Noto Sans TC 與 Microsoft JhengHei 的**共同可用字重只有 Regular 與 Bold**。所以：

**全案只用 400 與 700 兩檔。** 沒有 500、600。第三層級用**顏色與尺寸**區分，不用字重。這不是妥協，這是「不可載入 web font」的誠實結論。

| 元素 | 字重 |
|---|---|
| 巨燈狀態字、卡片主讀數、當前分頁 | **700** |
| 其餘一切（含卡片標題） | 400 |

> **卡片標題用 400，不用 700。** 標題靠位置（卡片頂部）與顏色（`--text`）區分，不靠粗。滿頁粗標題是 SaaS 模板的特徵。

### 行高與字距

| token | 值 | 用途 |
|---|---|---|
| `--lh-num` | `1` | 所有數值。數字沒有下伸部，行高 1 才能讓大數字對齊格線 |
| `--lh-ui` | `1.5` | 中文介面文字 |
| `--lh-prose` | `1.75` | 說明段落（中文需要比拉丁更鬆） |
| `--ls-cjk` | **`0`** | **中文永遠不加字距。** 這是全案最硬的排版規則 |
| `--ls-num` | `-0.01em` | tabular 數字先天偏寬，收回一點 |
| `--ls-state` | `0.02em` | **唯一例外**：巨燈的 `READY`/`SHOOT`/`EJECT`。它們是狀態機的字面值，是機器的詞彙，不是設計師選的大寫標籤 |
| `--measure` | `30em` | 說明段落容器上限 = 30 個全形字 |

> `text-transform: uppercase` 在 `styles.css` 有 4 處（148/285/521/691），**全部刪掉**。頁面上唯一的大寫是 `READY`/`SHOOT`/`EJECT`/`COLLECT`，那是資料本身就是大寫，不是樣式做的。

---

## 2.3 版面

### 每分頁一句話

| 分頁 | 版面概念 |
|---|---|
| **駕駛** | 一塊擋風玻璃 —— 左邊是「現在能不能射」，右邊是「這一場還剩什麼」，中間沒有東西要讀。 |
| **參數** | 一本帳簿 —— 左頁是你寫的，右頁是機器讀回來的，中間一條裝訂線。 |
| **射手** | 一台示波器 —— 上面波形，下面同一條時間軸上的邏輯分析儀，右邊統計。 |
| **圖表** | 一張攤開的桌子 —— 左手邊可挑的清單，中間攤開的紙，右手邊抄下的讀值。 |
| **檢查** | 一張驗機清單，不是一面燈牆 —— 只有不合格的那幾項會被展開。 |
| **回放** | 一條時間軸，其他都是它的註腳。 |
| **鎖定** | 一台關著的機器 —— 沒有橫幅，只有一句話和一顆亮著的錄影燈。 |
| **訊號** | 一份索引 —— key 靠左，值貼在 72em 的欄寬內，不飛到螢幕最右。 |

### 駕駛頁 ASCII 線框

```
┌──────────────────────────────────────────────┬───────────────────────┐
│                                              │ 比賽計時               │
│                    ◉                         │   +76:07        (63px)│
│                 READY                        │                       │
│         SL 1851  SR 1796  目標 1965 tps      ├───────────────────────┤
│         ← 全頁唯一置中的東西 · 全頁唯一填色  │ 車頭  ▶▶ 射手端為前   │
├──────────────────────────────────────────────┤                       │
│  SL ◯1851        │SL−SR +55│        SR ◯1796 ├───────────────────────┤
│                  └────●────┘                 │ 爬升    50 分   (42px)│
├──────────────────────────────────────────────┤   ▊  再上一格 +60     │
│  COLLECT      │▌ SHOOT ▐│      EJECT         │   ▊  counts 1845      │
│  (現態格 1.4fr · 其餘 1fr · 無框無圓角)      │   ▊  ● HOLD 保持中     │
├──────────────────────────────────────────────┼───────────────────────┤
│  本輪 ●○○○○○○○  1 顆   spin-up 313 ms       │ 警報                  │
├──────────────────────────────────────────────┤ ■ 送料馬達過流   2.4s │
│  RT ▊▊▊▊ 1.00   LT ░ 0.00   × ○ □ R1 L1 ↑ ↓ │ ■ 電池電壓過低  22.0s │
└──────────────────────────────────────────────┴───────────────────────┘
   grid-template-columns: minmax(0,1.55fr) minmax(320px,.85fr)
```

### 對齊規則

| 情境 | 規則 |
|---|---|
| 寬欄（> 480px）的標籤+值 | 標籤靠左，值**靠右對齊 + 小數點對齊** |
| 窄欄（< 480px）的標籤+值 | 值**靠左貼齊標題左緣**。窄欄右對齊會讓兩者離太遠 |
| 表格數值欄 | 一律右對齊 + `tabular-nums` + 固定 `ch` 寬 |
| 表格文字欄 | 靠左 |
| 卡片標題 | 靠左，永遠對齊卡片內容左緣 |
| 圖表 x 軸 | 所有堆疊圖表共用同一條像素格線（左緣對齊到整數 px） |
| 置中 | **全案只有一處**：駕駛頁的巨燈。整頁只有一次置中，所以那必然是視線落點 |

### 密度變數 `--u` 三檔

| 檔 | `--u` | 適用 | 最小命中區 |
|---|---|---|---|
| `compact` | `4px` | 參數 · 射手 · 圖表 · 訊號（坐著看，資訊密集） | 32px |
| `normal` | `6px` | 駕駛 · 檢查 · 回放 | 36px |
| `loose` | `10px` | field 主題 · lockdown（站著看） | **44px** |

所有 padding / gap / 圖示尺寸寫成 `calc(var(--u) * n)`。`--u: 10px`（不是 spec 的 9px）是為了讓 `.btn` 的 `padding: calc(var(--u)*1.2) calc(var(--u)*2.4)` 在 17px 字級下自然來到 44px。

### 卡片何時有邊框

> **原則：邊框只表示「可寫」。**

| 外觀 | 意思 | 出現在 |
|---|---|---|
| `1px solid --border-c` + `--surface-2` 底 + `3px` 圓角 | **這張卡裡有能改機器人的東西** | 參數雙欄、設定選單、匯出選單 |
| `1px solid --wildfire` + `2px` 圓角 | 這個欄位現在可寫且被 focus | 輸入框 `:focus-visible` |
| **無框**，`--surface-2` 底，`calc(--u*3)` 內距，`3px` 圓角 | 唯讀顯示 | 駕駛 / 檢查 / 回放 / 射手的全部卡片 |
| **無框無底**，上方 `calc(--u*4)` 留白 + 一條 `1px --border-c` 頂線 | 同一張卡內的分節 | 「射手 / 送料 / 吸取 / 爬升」等群組 |

現況 100% 的卡片都有框，所以框不帶資訊。改完之後，**掃一眼就知道哪裡能打字**。

### 圓角三檔（帶資訊，不是裝飾）

| token | 值 | 用途 |
|---|---|---|
| `--r-card` | `3px` | 唯讀卡片 |
| `--r-chip` | `2px` | **可寫元件**：按鈕、輸入框、chip。方正=機器面板上的按鍵 |
| `--r-lamp` | `50%` | **只有燈是圓的** |

直接回應 skill 第 4 條「one border-radius on everything regardless of hierarchy」。並且不是 0 —— 全 0 是 broadsheet 預設（第 3 條）。

### 燈號形狀語彙尺寸表

四個字元 `● ▲ ■ ○`（+ `□` = 路徑未生效），`--font-ui`，固定 `width: 1.25em; display:inline-block; text-align:center`。

| 用途 | font-size | 容器寬 | 說明 |
|---|---|---|---|
| **巨燈**（圓形填色燈本體） | `--fs-hero` 94px | 直徑 180px | 駕駛頁唯一一顆。field 下 ×1.6 = 288px |
| 燈牆行首 | `--fs-lg` 28px | 35px | 檢查頁每列 |
| 卡片標題列狀態 | `--fs-md` 17px | 21px | |
| 事件清單 / 警報 rail | `--fs-sm` 14px | 18px | |
| 圖例 / 時序帶 / chip 內 | `--fs-xs` 12px | 15px | |
| 頂欄 | `--fs-sm` 14px | 18px | |

---

## 2.4 原則（5 條）

1. **唯一醒目的是巨燈。**
   全頁只有一個元素可以同時「> `--fs-lg`」且「填飽和色」。要加第二個醒目的東西，先刪掉一個。（Chanel：出門前拿掉一件配件。）

2. **邊框只表示可寫。**
   看到框 = 這裡可以改機器人。唯讀資訊靠留白與底色階差分組。這條規則讓「哪裡能打字」變成 0.2 秒的判斷。

3. **橘只有一個意思：這裡連著機器人。**
   資料永遠不橘，警戒永遠不橘。全頁橘色像素預算 < 2%。lockdown 頁只剩一個 10px 的橘方塊。

4. **顏色不是唯一通道。**
   每個狀態同時帶形狀（`●▲■○`）、位置（檢查頁依 tone 排序）、與文字（值 + age）。灰階列印仍然可讀，8% 的紅綠色覺辨異使用者拿到的資訊完全相同。

5. **中文不加字距，數字不位移。**
   `letter-spacing: 0` 是漢字的預設也是終點。所有數值等寬 + `tabular-nums` + 固定 `ch` 寬容器 —— **值變動時版面零位移**。在 3 秒律下，版面跳動比數字錯誤更致命：眼睛會不由自主去追移動的東西。

---

# 3. 對照 skill 的「AI 生成預設樣式」清單

| # | skill 點名的預設 | 判定 | 我改了什麼 / 為什麼 |
|---|---|---|---|
| **1** | 暖奶油底 `#F4F1EA` + 高對比襯線 + terracotta `#D97757` | 不適用 | 本案是暗色。附帶說明：野火橘 `#FF6B1A` 的 C=.198 是 `#D97757`（C≈.09）的**兩倍以上飽和度**，兩者不會被混淆；而且它是 brief 指定的遊戲球色，不是我從調色盤挑的。 |
| **2** | **近黑底 + 單一亮色強調** | **最危險的一條** | 我承認這是本案最接近的 tell，分三點區隔：(a)**底不是近黑**——`#0E141C` 的 oklch C=.019 是**可測量的**藍色度，而 `#111`/`#0B0B0B` 的 C=0；三層 surface 的色度還遞增（.019→.025→.030），這是設計決定不是隨機加深。(b)**強調色不是 acid-green 或 vermilion**——是 H=43° 的純橘，而且它是 brief 釘死的。(c)**最關鍵**：這條之所以成為預設，是因為那個亮色被到處撒。我做了相反的事——橘有一條硬規則（只表示可寫）、有像素預算（< 2%）、資料完全不用橘。**限制強調色的用法，才是這條預設真正的解藥。** |
| **3** | broadsheet：hairline rules、零圓角、報紙式密集欄 | 部分踩到 → 改 | 現況有大量 1px hairline。我保留 hairline（工業面板本來就有分隔線），但：圓角**不是 0**（3/2/50% 三檔且帶資訊）；欄不是報紙式（每分頁 2–3 欄，各有明確職責）；hairline 的對比壓到 1.6:1，是背景不是圖案。 |
| **4** | **SaaS-card kit**：同構圓角卡、單一圓角、`rgba(0,0,0,.1)` 陰影、漸層裝飾 | **重度踩到** | (a)**卡片框改成語意通道**：唯讀卡無框，只有可寫卡有框。(b)**圓角三檔且帶資訊**。(c)**全案零陰影**——工業面板不打光，層次靠底色階差與 1px 線。(d)**零漸層**。(e)檢查頁的 5×3 同構卡片格**整個拆掉**，改單欄依 tone 排序清單：err → warn → stale → ok，通過項收成 40px 一行。 |
| **5a** | 拉開字距的全大寫 eyebrow | **重度踩到** | 刪掉 `styles.css` 全部 4 處 `text-transform: uppercase`；刪掉 `health.css:48` 的 `N O G O`（改成 `--fs-2xl` 的正常「不通過」+ 一顆 `■`）；刪掉 `lockdown.css:29` 的 `letter-spacing: .35em`。**中文字距一律 0**。唯一保留的字距是巨燈的 `.02em`，理由：那是狀態機的字面值。 |
| **5b** | `·` 串起來的 meta 字串 | 踩到 | 回放頁底部 `t=robot · 7,770 批 · 間隔 p50 62.0 ms · …` 七段中點串。改成**兩行的標籤/值表**（標籤 `--fs-xs --text-dim`，值 `--font-num --text`）。中點只在真正的「同級並列且無標籤」時保留（如 `id 102 · 2.48 m`）。 |
| **5c** | `WORD — fragment` 帶間隔破折號 | 變體踩到 | 駕駛頁五張卡的標題後面各掛一句灰色解釋。**全部移出標題列**：必要的移到卡片底部 `--fs-xs` 一行；不必要的（「F 全螢幕」「唯讀顯示，不是選單」）刪掉——後者靠版面修好（見下）。 |
| **5d** | `#0B0B0B`/`#111` 假裝成黑 | 未踩，但要主動證明 | 見第 2 條。底色帶可測量色度且三層遞增。 |
| **5e** | 小資料標籤用等寬字 | 踩到 | 建立**等寬白名單**：數值、機器字面字串（key path/檔名/build id）、時間刻度。標籤本身一律 `--font-ui` 中文比例字體。 |
| **5f** | 按鈕/連結文字尾巴加 `→` | 踩到 | 參數頁 21 個 `→` **全刪**，改成貫穿全表的一條 1px `--border-c` 垂直裝訂線。這同時把「送出值 vs 回讀值」的關係從**逐列的裝飾**升級成**版面本身的結構**。 |
| **6** | 標題裡只把一個詞染色/加粗 | 未踩 | 本案標題不染色。 |
| **7** | 全大寫標籤 | 見 5a | |
| **8** | 內容上方掛不必要的排版標籤 | 踩到 | 檢查頁的「指紋」chip（15 張只有 3 張有、無圖例）刪掉，改成該列右側 `--fs-xs --text-dim` 的一個詞。 |
| **9** | `01 / 02 / 03` 編號但內容不是序列 | 踩到 | 檢查頁底部「關閉路徑 (1)(2)(3)」三格是**並列的三種關閉方式，不是步驟**。編號刪掉，改三格等寬 + 各自的 `□`/`●` 狀態字元。 |
| **10** | 每段 fade-and-slide-up、每張卡 hover transition | 未踩，且要守住 | 現況只有三處動態（斷線呼吸、車頭切換 300ms 閃、通知 150ms 滑入），完全正確。新增規則：**卡片沒有 hover transition**；爬升柱與轉速環用 **0.15s 線性**（不是 ease，ease 會讓人誤判到位時間）；`prefers-reduced-motion` 全關（`styles.css:1165` 已有，保留）。 |
| **加碼** | （skill 未列，但同性質）進度條當裝飾 | 踩到 | 駕駛頁「比賽計時」下方那條 0% 灰進度條刪掉。練習跑沒有終點，那條永遠是空的。 |

---

# 4. 可直接貼進 `src/fgc/styles/tokens.css` 的完整 CSS

```css
/* ═══════════════════════════════════════════════════════════════════════
   FGC 2026 · 野火暗色工業風 —— 三層 token

   從 styles.css:741-905 搬出並重估。**第二／第三層的變數名一個都沒改**，
   所以 theme.ts 的 VAR_MAP 零改動，32 個 widget 零改動——換掉的只有值。

   載入順序：main.tsx 必須 `import "./styles.css"` **之後**再
   `import "./fgc/styles/tokens.css"`（選擇器特異度相同，後載入者贏），
   並把 styles.css 原本的 741-905 整段刪掉。
   ═══════════════════════════════════════════════════════════════════════ */

:root[data-profile="fgc"] {

  /* ── 第一層 原始色 ────────────────────────────────────────────────
     燒過的地表。色度隨層數遞增（.019 → .025 → .030），暗處也能分辨三層，
     所以全案不需要任何陰影。元件不准直接引用這一層。 */
  --char:        #0E141C;  /* oklch(.189 .019 256) 炭 · 頁底 */
  --ash:         #161F2A;  /* oklch(.236 .025 254) 燼 · 面板 */
  --soot:        #1F2A38;  /* oklch(.281 .030 255) 煤 · 凹槽 */
  --rule:        #2C3A4B;  /* oklch(.344 .035 254) 1.6:1 框線刻意低 */
  --rule-hi:     #3D4E63;  /* oklch(.418 .041 254) hover / 表格分隔 */
  --slag:        #44566D;  /* oklch(.448 .044 255) 缺口斜線 */
  --ember-cold:  #6C7B90;  /* oklch(.578 .037 257) 已過期 */
  --smoke:       #8B99AC;  /* oklch(.678 .032 256) 6.4:1 次要文字 */
  --smoke-hi:    #B9C6D6;  /* oklch(.822 .027 254) 10.7:1 目標線 */
  --bone:        #E4EAF2;  /* oklch(.935 .013 256) 15.3:1 主文字 */

  /* 野火橘 —— WILDFIRE 遊戲球。全案唯一強調色。
     只有一個意思：這裡連著機器人。資料不橘，警戒不橘。像素預算 < 2%。 */
  --wildfire:      #FF6B1A;  /* oklch(.703 .198 43) 6.5:1 */
  --wildfire-deep: #C25415;  /* oklch(.579 .157 45) 4.0:1 按下態 */

  /* 狀態三色（不是強調色）。warn 從 H73 推到 H93，
     因為 H73 正好撞上 SR 的琥珀資料色——現況那是個真 bug。
     err 從 H25 推到 H15，拉開與野火橘（H43）的距離。 */
  --signal-green:  #3FD08A;  /* oklch(.764 .159 158)  9.3:1 */
  --signal-yellow: #FFD429;  /* oklch(.882 .172  93) 13.0:1 */
  --signal-red:    #FF4D6D;  /* oklch(.679 .213  15)  5.8:1 */

  /* 熱像儀資料色盤：冷青 → 琥珀。1-4 靠色相分（橫跨藍黃安全軸，
     明度差 >= .07，deuteranopia 下仍可分）；5-8 是 1-4 的淺色版，
     **必須配線型**（見 --series-dash-*）。八個獨立色相在暗底上必然撞警戒色。 */
  --scan-cyan:      #3FC9DE;  /* oklch(.772 .118 210) */
  --scan-amber:     #F2A93B;  /* oklch(.787 .147  73) */
  --scan-teal:      #1F9E96;  /* oklch(.633 .104 188) */
  --scan-violet:    #9B8CFF;  /* oklch(.703 .164 287) */
  --scan-cyan-hi:   #8FE0EE;  /* oklch(.859 .081 210) */
  --scan-amber-hi:  #FFD08A;  /* oklch(.883 .102  77) */
  --scan-teal-hi:   #5FC8C0;  /* oklch(.769 .098 189) */
  --scan-violet-hi: #C7BEFF;  /* oklch(.831 .091 291) */

  /* ── 第二層 語意色（名稱與 theme.ts VAR_MAP 完全對齊，不准改名）── */
  --surface-1: var(--char);
  --surface-2: var(--ash);
  --surface-3: var(--soot);
  --text:      var(--bone);
  --text-dim:  var(--smoke);
  --border-c:  var(--rule);
  --border-hi: var(--rule-hi);

  --ok:   var(--signal-green);
  --warn: var(--signal-yellow);
  --err:  var(--signal-red);

  /* danger != err：err =「這個值不對」，danger =「這個按鈕會改機器人」。
     兩者在本方案裡是不同通道：err 是狀態紅，danger 是野火橘。 */
  --danger:     var(--wildfire);
  --focus-ring: var(--wildfire);

  /* 橘底上的字色。骨白在 #FF6B1A 上只有 2.35:1，禁用。 */
  --on-fire: var(--char);

  --stale: var(--ember-cold);
  --gap:   var(--slag);

  /* ── 第三層 領域色 ──────────────────────────────────────────── */
  /* 固定綁定（§6.5）：SL = 1（青）、SR = 2（琥珀）、Way = 4（冷紫）。
     不因面板而異，包含 sparkline 與匯出。 */
  --series-1: var(--scan-cyan);
  --series-2: var(--scan-amber);
  --series-3: var(--scan-teal);
  --series-4: var(--scan-violet);
  --series-5: var(--scan-cyan-hi);
  --series-6: var(--scan-amber-hi);
  --series-7: var(--scan-teal-hi);
  --series-8: var(--scan-violet-hi);

  /* 5-8 是 1-4 的淺色版，所以**必須**同時吃線型，否則色盲下與 1-4 同一條。
     LineGraph 讀這幾個字串當 uPlot 的 dash 陣列。 */
  --series-dash-1: none;
  --series-dash-2: none;
  --series-dash-3: none;
  --series-dash-4: none;
  --series-dash-5: 8 4;
  --series-dash-6: 8 4;
  --series-dash-7: 2 3;
  --series-dash-8: 2 3;

  --state-collect: var(--scan-cyan);
  --state-shoot:   var(--signal-green);
  --state-eject:   var(--signal-red);
  --band-on:       var(--signal-green);
  --band-off:      var(--rule);
  --band-neg:      var(--scan-violet);

  /* 目標與實測同色，誤差 = 兩條同色線的距離。--target 是「無對應實測線」時的退路。 */
  --target: var(--smoke-hi);
  --thresh: var(--signal-yellow);

  /* 保留 token，目前無元件使用。一旦有場地圖，聯盟色一律以「填色方塊 + 隊號」
     呈現，絕不以裸色文字呈現——否則與 --err / --focus-ring 互相混淆。 */
  --alliance-red:  #E03A4B;
  --alliance-blue: #3D7DE8;

  --field-bg:   #080C12;   /* 比頁底再深一階，畫布才有邊界 */
  --field-grid: #22303F;   /* 1.4:1，是背景不是圖案 */
  --field-tag:  var(--signal-yellow);
  --fov:        var(--scan-cyan);

  /* ── 字體 ────────────────────────────────────────────────────────
     Noto Sans TC 打頭：拉丁與漢字出自同一家族，`VEL_SL` 與「射手」
     的筆畫粗細才一致。現況 "Segoe UI" 打頭會讓拉丁來自 humanist、
     漢字來自 neo-grotesque，兩套設計軸混在一行裡。不載入 web font。 */
  --font-ui:  "Noto Sans TC", "Microsoft JhengHei", "PingFang TC",
              "Noto Sans", system-ui, sans-serif;
  --font-num: ui-monospace, "Cascadia Mono", Consolas,
              "Noto Sans Mono", monospace;
  --mono: var(--font-num);   /* 舊名，既有 CSS 還在用 */

  /* 只用 400 / 700 兩檔：Noto Sans TC 與 Microsoft JhengHei 的共同可用
     字重就這兩個。第三層級用顏色與尺寸區分，不用字重。 */
  --fw-normal: 400;
  --fw-bold:   700;

  /* ── 字級：兩個音階 ──────────────────────────────────────────
     讀數音階：28px = 1.5 m 可讀下限（96dpi 下 ~7.4mm），向上完全五度 1.5。
               只有這一組吃 --font-scale。
     介面音階：14px = 60cm 桌面下限，小三度 1.2。永遠不縮放——
               標籤放大只會換行，不會更好讀。 */
  --font-scale: 1;
  --fs-hero: calc(94px * var(--font-scale));  /* 巨燈。全案只有一個元素能用 */
  --fs-2xl:  calc(63px * var(--font-scale));  /* 比賽計時、爬升分數 */
  --fs-xl:   calc(42px * var(--font-scale));  /* 卡片主讀數 */
  --fs-lg:   calc(28px * var(--font-scale));  /* 狀態膠囊 · 1.5m 下限 */
  --fs-md: 17px;   /* 卡片標題、按鈕、分頁 */
  --fs-sm: 14px;   /* 表格、表單、正文（基準） */
  --fs-xs: 12px;   /* 單位、軸標籤、圖例 —— 全案最小，沒有 11px */

  --lh-num:   1;      /* 數字沒有下伸部，行高 1 才對得上格線 */
  --lh-ui:    1.5;
  --lh-prose: 1.75;   /* 中文說明段落要比拉丁更鬆 */

  --ls-cjk:   0;        /* 中文永遠不加字距 */
  --ls-num:   -0.01em;  /* tabular 數字先天偏寬 */
  --ls-state: 0.02em;   /* 唯一例外：巨燈的 READY/SHOOT/EJECT */
  --measure:  30em;     /* 說明段落上限 = 30 個全形字 */

  /* ── 密度與形狀 ─────────────────────────────────────────────── */
  --u: 6px;
  --hit: 36px;          /* 最小命中區 */
  --r-card: 3px;        /* 唯讀卡片 */
  --r-chip: 2px;        /* 可寫元件：方正 = 機器面板上的按鍵 */
  --r-lamp: 50%;        /* 只有燈是圓的 */
  --bw: 1px;

  /* 全案零陰影。工業面板不打光，層次靠底色階差與 1px 線。 */
  --shadow: none;

  /* ── 相容層：把舊的 10 個 VMX 變數接到第二層 ──
     注意 --accent 現在是野火橘。styles.css 裡有 29 處 var(--accent)，
     其中 7 處是把 accent 當裝飾用（區塊標題著色），必須在同一個 commit
     內改成 var(--text) / var(--text-dim)，否則訊號頁的群組標題會整片變橘。
     清單見計畫第 6 節。 */
  --bg:      var(--surface-1);
  --bg2:     var(--surface-2);
  --bg3:     var(--surface-3);
  --border:  var(--border-c);
  --fg:      var(--text);
  --fg-dim:  var(--text-dim);
  --accent:  var(--focus-ring);

  color-scheme: dark;
  font-variant-numeric: tabular-nums;
  letter-spacing: var(--ls-cjk);
}

/* ── 密度三檔 ─────────────────────────────────────────────────────
   compact：參數/射手/圖表/訊號（坐著看，資訊密集）
   normal ：駕駛/檢查/回放
   loose  ：field 與 lockdown（站著看，命中區 >= 44px）
   --u:10px 而不是 9px，是為了讓 .btn 在 17px 字級下自然來到 44px。 */
:root[data-profile="fgc"][data-density="compact"] { --u: 4px;  --hit: 32px; }
:root[data-profile="fgc"][data-density="normal"]  { --u: 6px;  --hit: 36px; }
:root[data-profile="fgc"][data-density="loose"]   { --u: 10px; --hit: 44px; }

/* ═══ 主題 2：field（賽場、站著看、隔 1.5 公尺）══════════════════════
   三條硬規則：
   1. 卡片不畫框，只靠留白分組。純黑上的低對比框線是視覺垃圾。
   2. 標題不放大——放大的只有數字。（這修掉「比賽計時」在 1.6 倍下換兩行，
      也讓 styles.css 的 .fgc-bar 字級 hack 可以整段刪掉。）
   3. 狀態色不填滿卡片，只填燈本體。1.5 m 外一整片紅讀不出是哪一格。 */
:root[data-profile="fgc"][data-theme="field"] {
  --surface-1: #000000;
  --surface-2: #000000;
  --surface-3: #0F1318;
  --text:      #FFFFFF;   /* 21.0:1 */
  --text-dim:  #B6C2D0;   /* 11.6:1 —— 比 dark 亮兩階，6:1 在 1.5m 外不夠 */
  --border-c:  #4A5461;
  --border-hi: #6B7684;

  --ok:   #22FF88;        /* 15.7:1 */
  --warn: #FFE01B;        /* 15.9:1 */
  --err:  #FF5A5A;        /*  6.9:1 —— 紅先天低明度，靠面積與 ■ 補償 */
  --danger:     #FF8A3D;  /*  9.0:1 —— 橘在純黑上要提亮到 L=.75 */
  --focus-ring: #FF8A3D;
  --on-fire: #000000;
  --stale: #8A939E;       /*  6.8:1 */
  --gap:   #4A5461;

  --series-1: #22E0FF;
  --series-2: #FFB020;
  --series-3: #00E5C0;
  --series-4: #B49BFF;
  --series-5: #22E0FF;    /* 與 1-4 同色，靠 dash 區分 */
  --series-6: #FFB020;
  --series-7: #00E5C0;
  --series-8: #B49BFF;

  --state-collect: #22E0FF;
  --state-shoot:   #22FF88;
  --state-eject:   #FF5A5A;
  --band-on:  #22FF88;
  --band-off: #2A2F36;
  --band-neg: #B49BFF;
  --target: #FFFFFF;
  --thresh: #FFE01B;
  --field-bg:   #000000;
  --field-grid: #2A3441;

  --u: 10px;
  --hit: 44px;
  --font-scale: 1.6;      /* 只乘讀數音階 */
  --fs-md: 19px;          /* 介面音階明確重新宣告，不吃 1.6 倍 */
  --fs-sm: 16px;
  --fs-xs: 13px;
  --shadow: none;
}

/* ═══ 主題 3：lockdown（MATCH 專用，不可切換）════════════════════════
   演算法式的一句話：把 dark 的色度歸零，只留一個 10px 的橘方塊。

   「刻意不好看」的正確做法不是加一個很大的橘框，是把所有能量抽掉。
   --text 只有 9.4:1（dark 的 62%）。整頁最亮的東西就是普通文字。
   遠看是一台待機的機器，不是一個正在工作的控制台。 */
:root[data-profile="fgc"][data-theme="lockdown"] {
  --surface-1: #15171A;   /* oklch(.204 .007 258) 色度 .019 -> .007 */
  --surface-2: #1B1E22;
  --surface-3: #23272C;
  --text:      #B9BCC0;   /* 9.4:1 */
  --text-dim:  #71757B;   /* 3.9:1 */
  --border-c:  #31353A;
  --border-hi: #3D4147;

  /* 全部狀態色與資料色歸一為同一個灰 */
  --ok: #7E8288;  --warn: #7E8288;  --err: #7E8288;
  --series-1: #7E8288; --series-2: #7E8288;
  --series-3: #7E8288; --series-4: #7E8288;
  --series-5: #7E8288; --series-6: #7E8288;
  --series-7: #7E8288; --series-8: #7E8288;
  --state-collect: #7E8288;
  --state-shoot:   #7E8288;
  --state-eject:   #7E8288;
  --band-on: #4A4E54; --band-off: #26292E; --band-neg: #5C6066;
  --target: #7E8288;  --thresh: #5A5E63;
  --stale: #5A5E63;
  --gap:   #3A3E43;

  /* 全頁唯一的顏色：錄影中的 10px 方塊徽章。 */
  --danger: #C9642A;      /* oklch(.615 .146 47) 4.6:1 降飽和的橘 */
  --focus-ring: #7E8288;  /* lockdown 頁沒有可 focus 的東西 */
  --on-fire: #15171A;

  --u: 10px;
  --hit: 44px;
  --font-scale: 1;
  --shadow: none;
}

/* ═══ 基礎排版 ═════════════════════════════════════════════════════ */

:root[data-profile="fgc"] body,
:root[data-profile="fgc"] #root {
  background: var(--surface-1);
  color: var(--text);
  font-family: var(--font-ui);
  font-size: var(--fs-sm);
  line-height: var(--lh-ui);
  letter-spacing: var(--ls-cjk);
}

/* 所有數值：等寬 + tabular + 右對齊 + 固定寬。
   比例字體會讓 Inspector 的數字在滑鼠移動時橫向跳動，讀不了。 */
.fgc-num {
  font-family: var(--font-num);
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum" 1;
  letter-spacing: var(--ls-num);
  line-height: var(--lh-num);
  text-align: right;
  white-space: nowrap;
}

/* 單位後綴：小一號、dim。tps / mm / ° / A / V / ms 一律顯示，不讓人猜。 */
.fgc-unit {
  font-size: var(--fs-xs);
  color: var(--text-dim);
  margin-left: 0.25em;
  font-family: var(--font-num);
  letter-spacing: 0;
}

/* 形狀語彙：綠● 黃▲ 紅■ 灰○ (+ □ = 路徑未生效)。
   **不能用 --font-num**：多數等寬字體沒有這幾個 CJK 符號，
   fallback 後四個字元寬度不一致，燈牆就對不齊。
   固定 1.25em 容器是唯一不靠字體運氣的做法。 */
.fgc-glyph {
  font-family: var(--font-ui);
  display: inline-block;
  width: 1.25em;
  text-align: center;
  line-height: 1;
  letter-spacing: 0;
}
.fgc-glyph.ok    { color: var(--ok); }
.fgc-glyph.warn  { color: var(--warn); }
.fgc-glyph.err   { color: var(--err); }
.fgc-glyph.stale { color: var(--stale); }

/* 說明段落：30 全形字，行高 1.75。 */
.fgc-prose {
  max-width: var(--measure);
  line-height: var(--lh-prose);
  color: var(--text-dim);
  font-size: var(--fs-xs);
}

/* 卡片三態（原則 2：邊框只表示可寫）。 */
.fgc-card {                       /* 唯讀 —— 無框 */
  background: var(--surface-2);
  border-radius: var(--r-card);
  padding: calc(var(--u) * 3);
  box-shadow: var(--shadow);
}
.fgc-card--writable {             /* 可寫 —— 有框 */
  border: var(--bw) solid var(--border-c);
}
.fgc-card--plain {                /* 卡內分節 —— 無框無底，只有頂線 */
  background: none;
  border-top: var(--bw) solid var(--border-c);
  padding: calc(var(--u) * 4) 0 0;
}
:root[data-profile="fgc"][data-theme="field"] .fgc-card,
:root[data-profile="fgc"][data-theme="field"] .fgc-card--writable {
  border: none;                   /* field：純黑上的低對比框是視覺垃圾 */
  background: none;
  padding: calc(var(--u) * 3);
}

/* focus：橘 = 這裡連著機器人。 */
:root[data-profile="fgc"] :focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}

/* ── 響應式：窄螢幕先降密度，再降字級，分頁列永遠不吃掉 ── */
@media (max-width: 1280px) { :root[data-profile="fgc"] { --u: 5px; } }
@media (max-width: 1024px) { :root[data-profile="fgc"] { --u: 4px; --fs-md: 16px; } }
@media (max-width: 820px)  { :root[data-profile="fgc"] { --font-scale: .78; } }

/* 高對比偏好 = 直接給 field 的文字對比 */
@media (prefers-contrast: more) {
  :root[data-profile="fgc"] { --text: #FFFFFF; --text-dim: #C4CEDB; --border-c: #46586E; }
}

/* 比賽日的畫面每動一次都在偷駕駛的注意力。 */
@media (prefers-reduced-motion: reduce) {
  :root[data-profile="fgc"] *,
  :root[data-profile="fgc"] *::before,
  :root[data-profile="fgc"] *::after {
    animation-duration: .001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: .001ms !important;
  }
}
```

---

# 5. 每種 widget 的視覺規則表

## 5.1 燈號

| 種類 | 尺寸 | 填色 | 文字 | 形狀 |
|---|---|---|---|---|
| **巨燈**（駕駛頁，全案唯一） | 直徑 180px（field ×1.6 = 288px） | 燈**本體**填 `--ok/--warn/--err`；**卡片與文字絕不染色** | 狀態字 `--fs-hero` `--fw-bold` `--text` | 圓 `--r-lamp` + 內含 `●▲■` |
| 頂欄連線點 | 10px | 同上 | 無 | 圓 |
| 燈牆行首 | `--fs-lg` 28px 字元 | 無底，字元本身著色 | 無 | `●▲■○` |
| 警報 rail 行首 | `--fs-sm` 14px 字元 + 左側 3px 直條 | 直條著色，底色 `--surface-2` | 無 | `▲■` |
| 布林 LED | 12px | on = `--ok`，off = `--band-off` | 無 | 圓 |

> **巨燈規則**：狀態色只填燈，不填卡。這修掉 `s4-03-field-drive.png` 的 EJECT 一片紅。

## 5.2 chip

| 態 | 底 | 框 | 字 |
|---|---|---|---|
| 唯讀資訊 chip | `--surface-3` | 無 | `--text-dim` `--fs-xs` |
| 可選（未選） | 無 | `1px --border-c` `--r-chip` | `--text-dim` |
| 可選（已選） | `--surface-3` | `1px --wildfire` | `--text` |
| 計數 chip（回放篩選） | `--surface-3` | 未選無框 / 已選橘框 | 標籤 `--text` + 數字 `--font-num --text-dim` |
| 警戒 chip | `color-mix(in srgb, var(--err) 12%, transparent)` | `1px` 同色 40% | `--err` + `■` |

> **回放頁 8 個彩色 chip 全部改成單一系統**：未選無框、已選橘框。類別的顏色由旁邊的 `--fs-xs` 形狀字元承擔，不由 chip 底色承擔。

## 5.3 表格

| 部位 | 規則 |
|---|---|
| 表頭 | `--surface-3` 底，`--fs-xs --text-dim`，`position: sticky`，**下方 1px `--border-hi`**，不加上框左右框 |
| 資料列 | 無底色；**不用斑馬紋**，改用 `border-bottom: 1px solid --border-c`（1.6:1，幾乎看不見但眼睛跟得上） |
| hover 列 | `background: --surface-2`；**無 transition** |
| 數值欄 | `--font-num` 右對齊，寬度用 `ch` 固定（如 `width: 8ch`） |
| 文字欄 | `--font-ui` 靠左 |
| key 路徑欄 | `--font-num --text-dim`，`text-overflow: ellipsis`，**中段省略**而非尾端（`/FGC/…/VEL_SL` 比 `/FGC/Tune/VEL…` 有用） |
| 列內距 | `calc(var(--u) * .8) calc(var(--u) * 1.5)` |
| 回讀不符列 | 整列 `color-mix(in srgb, var(--err) 10%, transparent)` + 左側 2px `--err` |

## 5.4 按鈕

| 種 | 底 | 框 | 字 | 用在 |
|---|---|---|---|---|
| **主要（會改機器人）** | `--wildfire` | 無 | `--on-fire` `--fw-bold` | 送出、存到機器人、START |
| 主要 `:active` | `--wildfire-deep` | 無 | `--on-fire` | |
| 次要 | 無 | `1px --border-c` `--r-chip` | `--text` | 複製、匯出、重讀 |
| 次要 `:hover` | `--surface-3` | `1px --border-hi` | `--text` | |
| 破壞性 | 無 | `1px --err` | `--err` | 清除選區、刪除書籤 |
| 停用 | 無 | `1px --border-c` | `--stale`，`cursor: not-allowed` | |
| 分頁（未選） | 無 | 無 | `--text-dim` | |
| 分頁（當前） | 無 | **底部 2px `--wildfire`** | `--text` `--fw-bold` | |

- 命中區 `min-height: var(--hit)`，內距 `calc(var(--u)*1.2) calc(var(--u)*2.4)`。
- **按鈕文字尾巴不加 `→`、不加 emoji、不加 `▾` 以外的符號**（`▾` 只給真的會展開選單的）。
- 文案用主動語態，且動作全程同名：按鈕寫「存到機器人」，回饋就寫「已存到機器人」。

## 5.5 輸入框

| 態 | 底 | 框 | 字 | 附加 |
|---|---|---|---|---|
| **可寫 · 閒置** | `--surface-3` | `1px --border-c` `--r-chip` | `--font-num --text` 右對齊 | — |
| **可寫 · focus** | `--surface-3` | `1px --wildfire` + `outline 2px --wildfire` | `--text` | — |
| **編輯中未送出** | `--surface-3` | `1px --warn` | `--text` | 右側 `*`（`--warn`） |
| **送出未回讀** | `--surface-3` | `1px --warn` | `--text` | 右側旋轉點；> 1 s 轉 `--err` 並顯示「未確認」 |
| **回讀一致** | `--surface-3` | `1px --border-c` | `--text` | 右側 `●`（`--ok`），1.2 s 淡出 |
| **回讀不符（被夾限）** | 整列 `--err` 10% | `1px --err` | `--text` | 展開 `why` 一行 |
| **唯讀（非 PIT）** | **無底** | **無框** | `--font-num --text` | **純文字**，不是 disabled input |

> 最後一列是原則 2 的直接後果：**MATCH 期間頁面上不存在任何有框的東西**，所以「不能寫」是用看的就知道，不需要試著點。

## 5.6 滑桿（參數頁，降級）

- 閒置：值下方一條 `2px` 高的軌，底 `--band-off`，已填部分 `--border-hi`（**不是橘、不是藍**）。無握把。
- hover / focus：出現 10px 圓握把，`--wildfire`；軌已填部分轉 `--wildfire` 30%。
- 這把 21 條全寬亮藍軌從「整頁最強視覺」降到「數字底下的一條刻度」。**調參是打數字，滑桿是輔助。**

## 5.7 圖表軸與格線

| 部位 | 值 |
|---|---|
| 繪圖區底 | `--surface-3`（比卡片深一階，畫布有邊界） |
| 格線 | `1px --border-c`（1.6:1）。**只畫水平格線**，垂直只在時間刻度處畫 |
| 零線 | `1px --border-hi`（2.2:1），比其他格線亮一階 |
| 軸標籤 | `--font-num --fs-xs --text-dim` |
| 軸線 | **不畫**。刻度標籤本身就界定了軸 |
| 資料線 | `1.5px`；field 主題 `2.5px` |
| 目標線 | **與對應實測線同色** + 60% 透明 + `dash [6,4]`。誤差 = 兩條同色線的距離 |
| 門檻線 | `--thresh`，`1px`，`dash [2,4]`（比目標線更細） |
| 游標線 | `1px --wildfire`（游標是使用者的操作 → 橘） |
| 資料缺口 | `--gap` 45° 斜線紋，**波形斷開不連線**，絕不畫成 0 或內插 |
| 稀疏取樣 | 散點，**不畫平滑曲線**；標題掛 `~2 Hz` 灰 chip |
| 圖例 | 底部，`--fs-xs`，色塊 10×10 `--r-chip` + 名稱。series 5–8 的色塊要畫出 dash 圖樣 |

## 5.8 色帶 / 時序帶（DiscreteBand）

| 部位 | 值 |
|---|---|
| 帶高 | `calc(var(--u) * 3.5)`（compact 下 14px） |
| 列標籤 | `--fs-xs --text-dim` **右對齊**貼齊繪圖區左緣 |
| 色塊 | 狀態色 **35% 透明**（不是滿版飽和）+ `1px` 同色實線上下邊 |
| 塊內文字 | `--fs-xs --text`，只在塊寬 > 32px 時顯示 |
| off / 未知 | `--band-off`，無邊 |
| 缺口 | `--gap` 斜線紋 |
| 塊間 | `1px` `--surface-1` 縫，**不是圓角** |

> 35% 透明是關鍵改動：現況滿版飽和色塊讓整條看起來像堆疊進度條，而且蓋過了上方折線的色彩系統。

## 5.9 時間軸（TimeBar）

| 部位 | 值 |
|---|---|
| 總覽波形 | `--border-hi` **單色**，不用任何 series 色 —— 它是導航，不是第七條資料線 |
| 目前視窗框 | `1px --wildfire` + 內部 `--wildfire` 8% 底 |
| 刻度標籤 | `--font-num --fs-xs --text-dim` |
| **事件軌** | **不再逐一畫字元**。改成：上半 = 每 bucket 的事件**密度直方圖**（`--text-dim`，高度 = 該區間事件數）；下半 = 只把**當前篩選中的類別**畫成 2px 刻痕（tone 著色） |
| 書籤 | `--wildfire` 3px 倒三角，永遠畫在最上層 |
| 播放頭 | `2px --wildfire` 貫穿全高 |

> 484 秒 582 個事件全部畫成 `▲■●○` 只會得到一條噪音帶。密度圖回答「事件集中在哪」，刻痕回答「我篩的那類在哪」——這是使用者真正的兩個問題。

## 5.10 卡片標題列

```
┌─────────────────────────────────────────┐
│ 射擊就緒                            ● │   ← 標題列
│─────────────────────────────────────────│   ← 無分隔線，靠 --u*2 留白
│ (內容)                                  │
│                                         │
│ dip 為前端推估（深度 > 150 tps）         │   ← 說明移到底部，--fs-xs
└─────────────────────────────────────────┘
```

| 部位 | 規則 |
|---|---|
| 標題文字 | `--fs-md` **`--fw-normal`** `--text`，靠左，`letter-spacing: 0` |
| **禁止** | 標題後掛灰色說明句；`text-transform`；`::before` 裝飾；粗體 |
| 右側 | 最多一個元素：狀態字元、或一個次要按鈕。兩個都要就代表這張卡在做兩件事 |
| 與內容間距 | `calc(var(--u) * 2)` 留白，**不畫分隔線** |
| 說明 | 移到卡片**底部**，`.fgc-prose`（`--fs-xs`，30 全形字，`--text-dim`） |
| 資料來源註記 | 卡片右上，`--font-num --fs-xs --stale`（如 `GET /dash/health · 每 3 秒`） |

## 5.11 空狀態文案語氣

**規則**：一句陳述發生了什麼 + 一句下一步。不用「請」「抱歉」「哎呀」；不用驚嘆號；不用表情符號；動詞用祈使形。錯誤不道歉，也絕不含糊帶過發生了什麼。

| 位置 | 現況 | 改成 |
|---|---|---|
| 寫回帳本 | 「還沒有任何 set。被硬閘擋下的（MATCH / 未連線 / 不在白名單）也會記在這裡—— 絕不靜默丟棄。」 | **「還沒送出參數。左欄改一個值按 Enter，送出、回讀、被擋下的原因都會記在這裡。」** |
| 警報 rail 空 | （空白） | **「目前沒有警報。」**（不加「一切正常」「👍」） |
| 事件被篩空 | （空白） | **「這個篩選條件下沒有事件。清掉篩選看全部 582 筆。」** |
| 相機無畫面 | 「暫停中 · 省 CPU」 | 保留（這句很好，它說明了為什麼）。無連線時改 **「相機沒有畫面。8081 串流沒有回應 —— 檢查 Driver Hub 的 Wi-Fi。」** |
| 回放無檔 | — | **「沒有可回放的檔案。在機器人上跑一場，或把 .jsonl 拖進這裡。」** |
| 圖表未選訊號 | — | **「還沒選訊號。從左邊拖一個 key 進來。」** |
| 燈牆全數通過 | — | **「15 項全部通過。」** + 一行 `--fs-xs`「上次檢查：14 秒前」 |
| 被硬閘拒絕 | `被拒：/FGC/Tune/IDLE_TPS: out of range 0..3000` | **「IDLE_TPS 超出範圍。可接受 0 到 3000，送出的是 3500。」**（說出實際送出的值，而不是只回一句 out of range） |

---

# 6. 實作順序與風險

## 6.1 九個步驟（每步可獨立驗收，可獨立回退）

| # | 內容 | 動哪些檔 | 估計行數 | 驗收 |
|---|---|---|---|---|
| **1** | **建 `tokens.css`**，搬出並重估 token；`main.tsx` 調整 import 順序；`styles.css:741-905` 整段刪掉 | `src/fgc/styles/tokens.css`（新）· `src/styles.css` · `src/main.tsx` | +260 / −165 / +1 | 八個頁面全部換色。**元件零改動，`theme.ts` 零改動** |
| **2** | **accent 汙染清理**：7 處把 `--accent` 當裝飾的舊規則改成 `--text`/`--text-dim`；刪 4 處 `text-transform: uppercase`；刪 `letter-spacing: .35em`/`.22em` | `styles.css`（147/284/347/396/520/682/690）· `lockdown.css:29` · `health.css:48` | ~20 行改 | 訊號頁群組標題不是橘的；`N O G O` 不再拉字距 |
| **3** | **字級與家族**：`--font-ui` 上根；`.fgc-glyph` 改 `--font-ui` + `1.25em` 固定寬；`MatchClock`/`ClimbLadder` 改吃 `--fs-2xl`；刪 `styles.css:990` 的 `.fgc-bar` 字級 hack | `tokens.css` · `styles.css` · `MatchClock.tsx` · `ClimbLadder.tsx` | ~30 行 | field 主題下「比賽計時」不換行；燈牆四個字元對齊 |
| **4** | **邊框規則**：唯讀卡去框（`.fgc-card`），只留參數雙欄與設定選單有框；唯讀輸入改純文字；圓角三檔 | 全部 8 份 `*.css` | ~70 行改 | MATCH 頁面上不存在任何有框的東西 |
| **5** | **駕駛頁**：巨燈只填燈不填卡；狀態機三格去按鈕感（現態 1.4fr，無框無圓角）；刪計時的 0% 進度條；五句標題說明移到卡底 | `drive.css` · `DrivePage.tsx` · `ShotReadyLight.tsx` · `StateRibbon.tsx` · `MatchClock.tsx` | ~90 行 | 全頁只有一處置中、一處填色 |
| **6** | **參數頁**：刪 21 個 `→` 改一條垂直裝訂線；滑桿降級；`WAIT_SPINUP` 布林改與其他欄位同源 | `tune.css` · `TuneTable.tsx` | ~60 行 | 頁面最強視覺不再是藍滑軌 |
| **7** | **鎖定頁**：去大橘框、去字距、灰化下半頁、橘徽章縮成 10px、長教學文收進 `<details>` | `lockdown.css` · `LockdownPage.tsx` | ~70 行 | 遠看像待機的機器 |
| **8** | **檢查頁**：5×3 卡片格 → 單欄依 tone 排序清單；通過項收成 40px 一行；刪「指紋」chip 與 (1)(2)(3) 編號 | `health.css` · `HealthWall.tsx` · `ShutdownStrip.tsx` | CSS ~110 / TS ~35 | 「哪 4 個要修」一眼看到 |
| **9** | **回放頁**：事件軌改密度直方圖 + 篩選刻痕；底部 meta 中點串改兩行標籤/值表；8 色 chip 統一；書籤 emoji 拿掉 | `replay.css` · `TimeBar.tsx` · `EventList.tsx` · `ReplayPage.tsx` | CSS ~70 / TS ~60 | 事件軌可解讀 |

**合計約 CSS 660 行、TSX 190 行。** 步驟 1–4 是純樣式層，佔全部視覺變化的 ~70%，可以先做完看效果再決定 5–9。

## 6.2 什麼不能動（硬約束）

| 約束 | 為什麼 | 這份計畫怎麼遵守 |
|---|---|---|
| **MATCH 頁不得出現任何輸入元件** | M01/M09/M11 遙測封鎖 | `LockdownPage.tsx` 目前是零 `input`/`button`/`select`。步驟 7 **只改 CSS 值與 DOM 分組**，不新增任何互動元素——包含「複製」按鈕。長教學文收進 `<details>` 這一項若會引入互動元素，就退回成純文字裁短 |
| **`set` 硬閘**（`mode !== "PIT" → 拒絕`） | 靜默失敗是最危險的失敗 | 視覺層只呈現拒絕**結果**（SetLedger、`--err` 邊框、`why` 展開）。**不得**為了「看起來順」把 disabled 樣式改成看起來可寫；不得移除或延後任何回饋 |
| **規則相關邏輯與文案** | M01/M09/M11、coachGate | `coachGate.ts` 零改動。規則引用的字串（「依 M01 / M09 / M11：遙測已封鎖」）**逐字保留**，不改寫成更口語的版本 |
| **`tone.ts` 的四個字元與 `LIMITS`** | 全案唯一真相，一處寫反就在一個面板上默默失效 | 只改**渲染尺寸與字體**，不改字元本身、不改門檻數值 |
| **`theme.ts` 的 `VAR_MAP` key 名** | 32 個 widget 都吃它 | 本計畫刻意讓第二／第三層變數**一個都沒改名**，只改值。`theme.ts` 零改動 |
| **既有 10 個 VMX 相容變數** | AllSignalsPanel / controls / uPlot 包裝還在用 | 相容層保留，`--accent` 改指向 `--focus-ring`（見風險 1） |

## 6.3 風險

1. **`--accent` 變橘會連帶染色 29 處舊 VMX 樣式。**
   最嚴重的是 `styles.css:347`（`.sig-list h3`，訊號頁群組標題）與 `:284`/`:147`（調參區塊標題）——這三處會讓整片標題變橘，直接違反「橘 < 2%」。
   **對策：步驟 1 與步驟 2 必須在同一次驗收內完成，不可只上步驟 1。** 七個要改的行號已列在上表。

2. **`--fs-xl` 48 → 42 會讓 MatchClock 與 ClimbLadder 縮小。**
   **對策：步驟 3 同時把這兩個元件改吃 `--fs-2xl`（63px）**，否則駕駛頁右欄最該讀的兩個數字反而變小。

3. **`--fs-md/sm/xs` 不再吃 `--font-scale` 是一個 token 結構改動。**
   它會影響所有寫 `font-size: var(--fs-sm)` 的地方在 field 主題下的表現（從 20.8px 變成 16px）。這是**刻意的**（標題放大只會換行），但需要在 field 主題下逐頁截圖確認沒有欄位變得太小。
   **對策：field 主題明確重新宣告 `--fs-md/sm/xs` 為 19/16/13px**，而不是留空。

4. **檢查頁改單欄清單需要動 `HealthWall.tsx` 的 render 結構**，不只是 CSS。這是唯一一個版面改動要碰 TSX 的地方，所以排在第 8 步。
   **對策：排序邏輯用純函式（`checks.ts` 已有 tone），只在 render 層加一次 `sort`，不改判定邏輯。**

5. **`color-mix()` 相容性。** `graph.css` 已在用，所以目標環境支援。**新規則沿用 `color-mix()`，不引入任何新的 CSS 功能**（無 `@container`、無 `oklch()` 字面值——oklch 只寫在註解裡當文件）。

6. **形狀語彙字元的字體 fallback。** `▲■●○` 在 `--font-num` 下寬度不一致是**現存的隱形 bug**（燈牆對不齊，但沒有人會通報）。步驟 3 的 `1.25em` 固定寬容器是唯一不靠字體運氣的解法；若某台賽場電腦連 Noto Sans TC 都沒有，JhengHei 也有這四個字元，固定寬容器仍然成立。

7. **野火橘與 `--err` 的色相距離 28°。**
   在 8% 紅綠色覺辨異的使用者眼中，兩者都偏黃綠但明度不同（.703 vs .679，幾乎相同）。
   **對策：這兩個顏色永遠不以相同形式出現。** 橘只出現在 **1–2px 的線與小填色塊**（框、下標線、按鈕）；`--err` 只出現在 **`■` 字元、3px 左側直條、10% 底色**。加上 `--err` 永遠伴隨 `■`，而橘永遠不帶形狀字元。這是形狀通道存在的理由。
