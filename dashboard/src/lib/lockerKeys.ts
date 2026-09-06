// 置物櫃顏色辨識調參參數定義 — 與機器人端 LockerVision.cpp / LockerVisionParams.h 共用
// 同一組欄位名稱（NT 路徑 LockerVision/Tuning/<name>），修改時兩邊必須同步。
export const LOCKER_TUNING = "/LockerVision/Tuning";
export const LOCKER_RESULTS = "/LockerVision/Results";
export const LOCKER_CONTROL = "/LockerVision/Control";

export const lockerTuningKey = (name: string) => `${LOCKER_TUNING}/${name}`;
export const lockerResultKey = (name: string) => `${LOCKER_RESULTS}/${name}`;
export const lockerControlKey = (name: string) => `${LOCKER_CONTROL}/${name}`;

export interface LockerParamDef {
  name: string;
  label: string;
  min: number;
  max: number;
  step: number;
  def: number;
  int?: boolean; // 匯出 C++ 標頭時輸出 constexpr int
  // true = 競賽現場會需要臨場調整（換場地燈光、置物櫃位置），面板才顯示滑桿。
  // 未標記者為安裝常數，調好就固化在 LockerVisionParams.h，但仍會匯出到標頭。
  field?: boolean;
}

export interface LockerGroup {
  title: string;
  params: LockerParamDef[];
}

// 順序與 LockerVisionParams.h 的欄位順序一致（影響匯出檔的欄位順序）。
export const LOCKER_GROUPS: LockerGroup[] = [
  {
    title: "黑格（低明度）",
    params: [
      { name: "blackVMax", label: "V 上限（越小越嚴，只收深黑）", min: 0, max: 255, step: 1, def: 46, int: true, field: true },
    ],
  },
  {
    title: "藍格（HSV）",
    params: [
      { name: "blueHMin", label: "H 下限", min: 0, max: 179, step: 1, def: 100, int: true, field: true },
      { name: "blueHMax", label: "H 上限", min: 0, max: 179, step: 1, def: 124, int: true, field: true },
      { name: "blueSMin", label: "S 下限", min: 0, max: 255, step: 1, def: 43, int: true, field: true },
      { name: "blueVMin", label: "V 下限", min: 0, max: 255, step: 1, def: 46, int: true, field: true },
    ],
  },
  {
    // 紅色的色相環繞 0/180：低帶 [0, H 上限(低)] ∪ 高帶 [H 下限(高), 179]。
    // 學紅格時只會收緊取樣落點所在那一帶，另一帶維持不變。
    title: "紅格（HSV，色相環繞 0/180）",
    params: [
      { name: "redHMax", label: "低帶 H 上限（近 0 那端）", min: 0, max: 179, step: 1, def: 10, int: true, field: true },
      { name: "redHMin", label: "高帶 H 下限（近 180 那端）", min: 0, max: 179, step: 1, def: 156, int: true, field: true },
      { name: "redSMin", label: "S 下限", min: 0, max: 255, step: 1, def: 43, int: true, field: true },
      { name: "redVMin", label: "V 下限", min: 0, max: 255, step: 1, def: 46, int: true, field: true },
    ],
  },
  {
    // ROI 框住畫面中置物櫃所在的矩形。偵測方式：每色各自 inRange → 去噪 → 在 ROI 內找
    // 「最大的一塊輪廓」，取質心座標，三色質心 Y 由上到下即置物櫃顏色排序（45° 透視下
    // 各格高度不等、甚至夾走一格後整疊位移都自動適應）。ROI 盡量只框住置物櫃、別把地板/
    // 陰影框進來（地板陰影可能被誤判成黑；淺色地板若落進藍範圍，記得把藍格 S 下限調高）。
    title: "ROI 框選（置物櫃區域）",
    params: [
      { name: "roiXPct", label: "左緣 X（%）", min: 0, max: 100, step: 1, def: 20, field: true },
      { name: "roiYPct", label: "上緣 Y（%）", min: 0, max: 100, step: 1, def: 5, field: true },
      { name: "roiWPct", label: "寬度（%）", min: 1, max: 100, step: 1, def: 60, field: true },
      { name: "roiHPct", label: "高度（%）", min: 1, max: 100, step: 1, def: 65, field: true },
    ],
  },
  {
    // 找色塊的去噪與面積門檻：開運算去零星雜訊、閉運算補破洞（框架的孔會讓色塊破碎）；
    // 面積門檻濾掉背景散點，只留夠大的一塊 —— 越大越只認實心大色格。
    title: "色塊偵測（去噪 + 面積）",
    params: [
      { name: "open", label: "開運算（去噪點）", min: 0, max: 10, step: 1, def: 2, int: true, field: true },
      { name: "close", label: "閉運算（補破洞）", min: 0, max: 10, step: 1, def: 3, int: true, field: true },
      { name: "minAreaPct", label: "色塊最小面積（佔 ROI %）", min: 0, max: 30, step: 0.5, def: 2, field: true },
    ],
  },
];

// 全部參數：匯出 C++ 標頭都用這份（少一項機器人端就編不過）
export const ALL_LOCKER_PARAMS: LockerParamDef[] = LOCKER_GROUPS.flatMap((g) => g.params);

// 面板實際顯示的：只留現場可調項，整組都被過濾掉的分類不顯示標題
export const FIELD_LOCKER_GROUPS: LockerGroup[] = LOCKER_GROUPS
  .map((g) => ({ ...g, params: g.params.filter((p) => p.field) }))
  .filter((g) => g.params.length > 0);

// 顏色分類代碼（與機器人端 LockerVision::Color 一致）
export const LOCKER_COLOR_NAMES: Record<number, string> = {
  0: "?",
  1: "黑",
  2: "藍",
  3: "紅",
};

// 機器人端 CameraServer 串流名稱（CameraPublisher/<名稱>/streams）。
// 與 BallVision/Line 共用同一顆相機，原始畫面沿用 "Orbbec Color"；
// 置物櫃自己的分類圖/結果串流緊接在黑線的兩個串流之後建立。
export const LOCKER_STREAMS = [
  { key: "color", ntName: "Orbbec Color", label: "原始畫面", fallbackPort: 1182 },
  { key: "mask", ntName: "Locker Mask", label: "分類圖", fallbackPort: 1187 },
  { key: "result", ntName: "Locker Result", label: "辨識結果", fallbackPort: 1188 },
] as const;
