// 乒乓球定位調參參數定義 — 與機器人端 BallVision.cpp / BallVisionParams.h 共用
// 同一組欄位名稱（NT 路徑 BallVision/Tuning/<name>），修改時兩邊必須同步。
export const VISION_TUNING = "/BallVision/Tuning";
export const VISION_RESULTS = "/BallVision/Results";
export const VISION_CONTROL = "/BallVision/Control";

export const tuningKey = (name: string) => `${VISION_TUNING}/${name}`;
export const resultKey = (name: string) => `${VISION_RESULTS}/${name}`;
export const controlKey = (name: string) => `${VISION_CONTROL}/${name}`;

export interface VisionParamDef {
  name: string;
  label: string;
  min: number;
  max: number;
  step: number;
  def: number;
  int?: boolean; // 匯出 C++ 標頭時輸出 constexpr int
  options?: string[]; // 有值時以下拉選單呈現（索引即參數值）
  // true = 競賽現場會需要臨場調整（換場地燈光、球距改變），面板才顯示滑桿。
  // 未標記者為安裝/物理常數（外參、球徑、去噪、追蹤），調好就固化在
  // BallVisionParams.h，比賽當下不該動 —— 但仍會匯出到標頭與設定檔，
  // 機器人端 BallVision.cpp 也照常讀得到。要放回面板只需補上 field: true。
  field?: boolean;
}

export interface VisionGroup {
  title: string;
  params: VisionParamDef[];
}

// 順序與 BallVisionParams.h 的欄位順序一致（影響匯出檔的欄位順序）。
// field: true 者才會出現在調參面板，詳見 VisionParamDef.field 的說明。
export const VISION_GROUPS: VisionGroup[] = [
  {
    title: "白球色彩（低飽和/高明度）",
    params: [
      { name: "whiteSMax", label: "S 上限（越小越白）", min: 0, max: 255, step: 1, def: 60, int: true, field: true },
      { name: "whiteVMin", label: "V 下限（越大越亮）", min: 0, max: 255, step: 1, def: 180, int: true, field: true },
    ],
  },
  {
    title: "黃/橘球色彩 (HSV)",
    params: [
      { name: "yellowHMin", label: "H 下限", min: 0, max: 179, step: 1, def: 15, int: true, field: true },
      { name: "yellowHMax", label: "H 上限", min: 0, max: 179, step: 1, def: 40, int: true, field: true },
      { name: "yellowSMin", label: "S 下限", min: 0, max: 255, step: 1, def: 100, int: true, field: true },
      { name: "yellowVMin", label: "V 下限", min: 0, max: 255, step: 1, def: 100, int: true, field: true },
    ],
  },
  {
    title: "去噪（形態學）",
    params: [
      { name: "open", label: "開運算（去噪點）", min: 0, max: 10, step: 1, def: 2, int: true },
      { name: "close", label: "閉運算（補洞）", min: 0, max: 10, step: 1, def: 2, int: true },
    ],
  },
  {
    title: "霍夫圓變換",
    params: [
      { name: "houghDp", label: "累加器解析度", min: 0.5, max: 3, step: 0.1, def: 1.2 },
      { name: "houghParam1", label: "Canny 高門檻", min: 1, max: 300, step: 1, def: 100 },
      { name: "houghParam2", label: "圓心門檻（越小越敏感）", min: 1, max: 200, step: 1, def: 20, field: true },
      { name: "houghMinDist", label: "兩圓最小間距 px", min: 1, max: 320, step: 1, def: 40, int: true },
      { name: "houghMinRadius", label: "最小半徑 px", min: 0, max: 200, step: 1, def: 6, int: true, field: true },
      { name: "houghMaxRadius", label: "最大半徑 px", min: 0, max: 320, step: 1, def: 120, int: true, field: true },
      { name: "houghFillMin", label: "圓內球色佔比下限", min: 0, max: 1, step: 0.05, def: 0.6, field: true },
    ],
  },
  {
    // 深度只用來測距與濾掉超出範圍的像素；挑哪顆球一律是取 x²+y² 最小（相機垂直往下，
    // 各球深度幾乎一樣，「最近深度」不成立）。
    title: "深度測距（上下限也當遮罩）",
    params: [
      { name: "depthWindow", label: "取樣視窗 px", min: 1, max: 31, step: 2, def: 9, int: true },
      { name: "depthMinMm", label: "深度下限 mm", min: 0, max: 1000, step: 10, def: 100, field: true },
      { name: "depthMaxMm", label: "深度上限 mm", min: 100, max: 10000, step: 50, def: 4000, field: true },
      { name: "ballDiameterMm", label: "球直徑 mm（半徑反推備援）", min: 10, max: 100, step: 1, def: 40 },
    ],
  },
  {
    // Orbbec 平時只用前方/左方偏移與下傾角；但深度破洞退用假定高度反投影時，也會讀
    // 離地高度與盒底高度（那是假定深度的來源）。視野寬度才是 LifeCam（無深度無校正）專用。
    title: "相機外參（安裝，需實機量測）",
    params: [
      // 固定 90 = 相機垂直往下（無傾角）。不做成滑桿：機器人端直接讀 .h 常數，不經 NT。
      { name: "mountPitchDeg", label: "下傾角（+朝下）", min: -90, max: 90, step: 0.5, def: 90 },
      { name: "mountForwardCm", label: "前方偏移 cm", min: -50, max: 50, step: 0.5, def: 0 },
      { name: "mountLeftCm", label: "左方偏移 cm", min: -50, max: 50, step: 0.5, def: 0 },
      { name: "mountHeightCm", label: "離地高度 cm（破洞/無深度測距用）", min: 0, max: 100, step: 0.5, def: 30, field: true },
      { name: "boxFloorCm", label: "盒底離地高度 cm（破洞/無深度測距用）", min: 0, max: 50, step: 0.5, def: 0 },
      { name: "viewWidthCm", label: "視野寬度 cm（無深度無校正時）", min: 5, max: 100, step: 0.5, def: 25, field: true },
    ],
  },
  {
    title: "追蹤",
    params: [
      { name: "maxCoastFrames", label: "遺失保留幀數", min: 0, max: 60, step: 1, def: 5, int: true },
    ],
  },
];

// 全部參數：匯出 C++ 標頭、儲存/載入設定檔都用這份（少一項機器人端就編不過）
export const ALL_VISION_PARAMS: VisionParamDef[] = VISION_GROUPS.flatMap((g) => g.params);

// 面板實際顯示的：只留現場可調項，整組都被過濾掉的分類不顯示標題
export const FIELD_VISION_GROUPS: VisionGroup[] = VISION_GROUPS
  .map((g) => ({ ...g, params: g.params.filter((p) => p.field) }))
  .filter((g) => g.params.length > 0);

// 常用色彩快速預設（一鍵套白球或黃/橘球的門檻）
export const COLOR_PRESETS: Record<string, Record<string, number>> = {
  白球: { whiteSMax: 60, whiteVMin: 180 },
  黃橘球: { yellowHMin: 10, yellowHMax: 35, yellowSMin: 100, yellowVMin: 100 },
};

// 顏色分類代碼（與機器人端 BallVision::Color 一致）
export const COLOR_NAMES: Record<number, string> = {
  0: "?",
  1: "白",
  2: "黃",
};

// 機器人端 CameraServer 串流名稱（CameraPublisher/<名稱>/streams）。
// 網址優先從 NT 的 CameraPublisher 解析，fallbackPort 只是 NT 還沒到齊時的猜測；
// 埠號依 PutVideo 呼叫順序從 1181 遞增，這裡照 Orbbec 模式的順序排
// （深度 → 彩色 → 遮罩 → 結果）。LifeCam 模式沒有深度串流，其餘會各往前一號。
export const VISION_STREAMS = [
  { key: "color", ntName: "Orbbec Color", label: "原始畫面", fallbackPort: 1182 },
  { key: "depth", ntName: "Orbbec Depth", label: "深度圖", fallbackPort: 1181 },
  { key: "mask", ntName: "Ball Mask", label: "遮罩", fallbackPort: 1183 },
  { key: "result", ntName: "Ball Result", label: "辨識結果", fallbackPort: 1184 },
] as const;

// 深度串流的呈現方式（機器人端 DepthCamera::publishDepthFrame 寫死的，改那邊要同步）
export const DEPTH_STREAM_MAX_MM = 4000;
