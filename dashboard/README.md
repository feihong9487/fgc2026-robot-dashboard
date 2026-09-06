# VMX Dashboard

VMX-pi 機器人自製人機介面（取代 Shuffleboard）。架構與通訊協定見
[docs/dashboard-hmi.md](../docs/dashboard-hmi.md)。

## 開發／日常使用（瀏覽器即可）

```
cd dashboard-app
npm install        # 第一次
npm run dev        # 開 http://localhost:5173
```

- 頂欄輸入機器人 IP → 連線（機器人程式已內建 ws://:5800 橋接器）
- 沒有機器人時按「模擬」→ 用假資料操作所有面板

## 打包成獨立桌面 exe（Tauri）

第一次需安裝 Rust 與初始化 Tauri（之後不用再做）：

```
winget install Rustlang.Rustup        # 或 https://rustup.rs
cd dashboard-app
npx tauri init
#   App name:            VMX Dashboard
#   Window title:        VMX Dashboard
#   Web assets 路徑:      ../dist
#   Dev server URL:      http://localhost:5173
#   Dev 指令:            npm run dev
#   Build 指令:          npm run build
```

之後每次打包：

```
npm run tauri build
# 產物：src-tauri/target/release/bundle/ 下的安裝檔/exe
```

## 面板總覽

| 分頁 | 內容 |
|---|---|
| 波形與調參 | S-curve 位置/速度/加速度、三馬達目標vs實際、誤差、輸出；PID、S-curve、航向增益調參；X/Y/θ + 開始移動 |
| 光達點雲 | 2D 點雲（縮放/平移/距離圈、最近障礙物標記）；側欄觀測資料：更新率/延遲/點數、最近障礙物距離與方位、前後左右淨空（<0.3m 紅色警示）、範圍統計 —— 全部由 App 端從點雲推導 |
| 視覺調參 | vision-tuner「模式2」的整合版：原始/遮罩/辨識結果三路串流、HSV/去噪/面積/形狀/深度/CLAHE/ROI/卡爾曼滑桿即時同步、顏色快速預設、辨識結果狀態列、設定檔存取（與 vision-tuner profiles 互換）、匯出 VisionParams.h |
| 全部訊號 | 橋接器鏡射的所有 NT entry 自動列出並依 table 分組——機器人端 `tab.Add(...)` 加什麼就出現什麼，App 零修改（驚喜模組用）。數字可編輯、布林開關、字串可編輯；關鍵字過濾；數字訊號可釘選成即時波形（多條疊圖、10/30/120s 時間窗、釘選記在 localStorage） |

視覺調參需要機器人程式跑著 `VisionProcessor`（見
`WorldSkills-Example-Projects-main/Depth Camera/cpp`）；參數走 NT
`VisionTuner/Tuning/*`，橋接器會自動鏡射，賽前預先調參（相機直接接電腦）仍用
Python 版 vision-tuner 的模式1。

## 新增遙測值？

機器人端照舊 `tab.Add("名稱", 0.0)`（Shuffleboard API），橋接器會自動鏡射，
「全部訊號」分頁會直接出現、可看可改可釘選波形——不改 App 也能用。
若要放進固定面板（波形與調參等），再到 `src/lib/keys.ts` 加路徑、
對應面板加一行即可。
