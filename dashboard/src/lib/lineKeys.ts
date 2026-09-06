// 黑線定位調參參數定義 — 與機器人端 Line.cpp / LineVisionParams.h 共用
// 同一組欄位名稱（NT 路徑 Line/Tuning/<name>），修改時兩邊必須同步。
export const LINE_TUNING = "/Line/Tuning";
export const LINE_RESULTS = "/Line/Results";
export const LINE_CONTROL = "/Line/Control";

export const lineTuningKey = (name: string) => `${LINE_TUNING}/${name}`;
export const lineResultKey = (name: string) => `${LINE_RESULTS}/${name}`;
export const lineControlKey = (name: string) => `${LINE_CONTROL}/${name}`;

export interface LineParamDef {
  name: string;
  label: string;
  min: number;
  max: number;
  step: number;
  def: number;
  int?: boolean; // 匯出 C++ 標頭時輸出 constexpr int
  // true = 競賽現場會需要臨場調整（換場地燈光、地板材質）,面板才顯示滑桿。
  // 未標記者為安裝/物理常數（外參、開閉運算、遺失保留幀數）,調好就固化在
  // LineVisionParams.h,比賽當下不該動 —— 但仍會匯出到標頭,機器人端 Line.cpp
  // 也照常讀得到（mountPitchDeg 例外:機器人端直接讀 .h 常數不經 NT,見下方註解）。
  field?: boolean;
}

export interface LineGroup {
  title: string;
  params: LineParamDef[];
}

// 順序與 LineVisionParams.h 的欄位順序一致（影響匯出檔的欄位順序）。
export const LINE_GROUPS: LineGroup[] = [
  {
    title: "黑線二值化",
    params: [
      { name: "threshold", label: "灰階門檻（低於此值視為黑線）", min: 0, max: 255, step: 1, def: 80, int: true, field: true },
    ],
  },
  {
    // 夾爪固定佔畫面某一塊（通常是上緣），直接裁掉不進輪廓判斷。ROI 以外一律清零。
    // 座標維持全畫面，測距/標註不受影響。全 0/100 = 不裁切（整張進判斷）。
    title: "ROI 裁切（切掉夾爪等固定干擾）",
    params: [
      { name: "roiXPct", label: "左緣 X（%）", min: 0, max: 100, step: 1, def: 0, field: true },
      { name: "roiYPct", label: "上緣 Y（%，往下裁夾爪）", min: 0, max: 100, step: 1, def: 0, field: true },
      { name: "roiWPct", label: "寬度（%）", min: 1, max: 100, step: 1, def: 100, field: true },
      { name: "roiHPct", label: "高度（%）", min: 1, max: 100, step: 1, def: 100, field: true },
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
    // 面積濾雜訊/整片陰影；形狀濾「要夾取的黑色物件」—— 黑線細長（長寬比高），
    // 物件是團塊（長寬比低），用最小外接矩形長邊/短邊比剔除。可見線段太短時把 minAspect 調小。
    title: "輪廓過濾（面積 + 形狀）",
    params: [
      { name: "areaMinPct", label: "面積下限（濾雜訊，%）", min: 0, max: 20, step: 0.1, def: 0.5, field: true },
      { name: "areaMaxPct", label: "面積上限（濾整片陰影/背景，%）", min: 0, max: 100, step: 0.5, def: 60, field: true },
      { name: "minAspect", label: "最小長寬比（濾團塊物件，越大越嚴）", min: 1, max: 20, step: 0.5, def: 4, field: true },
    ],
  },
  {
    // X 一律取線的中線;Y 取線的「頭」(端點)而非中點 —— 中點會隨可見線長飄,端點穩定。
    title: "定位目標（Y 基準）",
    params: [
      { name: "headFarEnd", label: "Y 取遠端（關=近端，機器先碰到那端）", min: 0, max: 1, step: 1, def: 0, int: true, field: true },
    ],
  },
  {
    // 與 BallVision 共用同一顆垂直向下裝的相機,外參預設值沿用同一組量測值;
    // floorCm 是黑線所在的地板高度(相對相機掛載基準),通常就是 0。
    title: "相機外參（安裝，需實機量測；與乒乓球共用同一顆相機）",
    params: [
      // 固定 90 = 相機垂直往下（無傾角）。不做成滑桿：機器人端直接讀 .h 常數，不經 NT。
      { name: "mountPitchDeg", label: "下傾角（+朝下）", min: -90, max: 90, step: 0.5, def: 90 },
      { name: "mountForwardCm", label: "前方偏移 cm", min: -50, max: 50, step: 0.5, def: 0 },
      { name: "mountLeftCm", label: "左方偏移 cm", min: -50, max: 50, step: 0.5, def: 0 },
      { name: "mountHeightCm", label: "離地高度 cm", min: 0, max: 100, step: 0.5, def: 28.5, field: true },
      { name: "floorCm", label: "地板離相機基準高度 cm", min: 0, max: 50, step: 0.5, def: 0 },
      { name: "viewWidthCm", label: "視野寬度 cm（無相機校正時）", min: 5, max: 100, step: 0.5, def: 25, field: true },
    ],
  },
  {
    title: "追蹤",
    params: [
      { name: "maxCoastFrames", label: "遺失保留幀數", min: 0, max: 60, step: 1, def: 5, int: true },
    ],
  },
];

// 全部參數：匯出 C++ 標頭都用這份（少一項機器人端就編不過）
export const ALL_LINE_PARAMS: LineParamDef[] = LINE_GROUPS.flatMap((g) => g.params);

// 面板實際顯示的：只留現場可調項，整組都被過濾掉的分類不顯示標題
export const FIELD_LINE_GROUPS: LineGroup[] = LINE_GROUPS
  .map((g) => ({ ...g, params: g.params.filter((p) => p.field) }))
  .filter((g) => g.params.length > 0);

// 機器人端 CameraServer 串流名稱（CameraPublisher/<名稱>/streams）。
// 網址優先從 NT 的 CameraPublisher 解析，fallbackPort 只是 NT 還沒到齊時的猜測。
// 與 BallVision 共用同一顆相機,原始畫面沿用 "Orbbec Color"（見 visionKeys.ts）;
// 黑線自己的遮罩/結果串流緊接在乒乓球的兩個串流之後建立。
export const LINE_STREAMS = [
  { key: "color", ntName: "Orbbec Color", label: "原始畫面", fallbackPort: 1182 },
  { key: "mask", ntName: "Line Mask", label: "遮罩", fallbackPort: 1185 },
  { key: "result", ntName: "Line Result", label: "辨識結果", fallbackPort: 1186 },
] as const;
