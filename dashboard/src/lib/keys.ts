// NT 路徑對照表 — 與機器人端 Shuffleboard entries 一一對應
const TAB = "/Shuffleboard/Chassis";

export const K = {
  // 調參（V1 起由常數表分頁管理，「套用」時寫入這些 live key 即時生效）
  kP: `${TAB}/kP`,
  kI: `${TAB}/kI`,
  kD: `${TAB}/kD`,
  kPHeading: `${TAB}/kP Heading`,
  vMax: `${TAB}/vMax`,
  aMax: `${TAB}/aMax`,
  jMax: `${TAB}/jMax`,
  // 移動指令（初始化除錯分頁的底盤試跑）
  x: `${TAB}/X cm`,
  y: `${TAB}/Y cm`,
  theta: `${TAB}/Theta cm`,
  start: `${TAB}/Start`,
  // 狀態
  eStop: `${TAB}/E-Stop`,
  yaw: `${TAB}/Gyro Yaw`,
  headingErr: `${TAB}/Heading Err`,
  // S-curve 波形（執行狀態分頁顯示）
  wavePos: `${TAB}/Waveform/Position deg`,
  waveVel: `${TAB}/Waveform/Velocity`,
  waveAcc: `${TAB}/Waveform/Accel`,
} as const;

export const motorKey = (
  i: number,
  field: "CurrentAngle" | "TargetAngle" | "Error" | "Output",
) => `${TAB}/M${i}/${field}`;

export const cosBetaKey = (i: number) => `${TAB}/cosBeta/cosB${i + 1}`;

export const NUM_MOTORS = 3;

// ── 模擬驗證分頁 ─────────────────────────────────────────────
// 機器人端（或 SimSource）發布任務狀態機與規劃器遙測
const SIM = "/Shuffleboard/Sim";
export const SIM_K = {
  poseX: `${SIM}/Pose X m`,
  poseY: `${SIM}/Pose Y m`,
  poseTheta: `${SIM}/Pose Theta deg`,
  pathJson: `${SIM}/Path Json`, // [[x,y],...] 剩餘路徑（公尺）
  obstaclesJson: `${SIM}/Obstacles Json`, // [[x,y,w,h],...] 障礙物（公尺）
  planTimeMs: `${SIM}/Plan Time ms`,
  replanCount: `${SIM}/Replan Count`,
  state: `${SIM}/State`, // 狀態機當前 State 名稱
  currentCommand: `${SIM}/Current Command`, // CommandScheduler 當前 Command
  tripIndex: `${SIM}/Trip Index`, // 1/2/3
  faultGrip: `${SIM}/Fault/Grip Fail`, // 故障注入：夾取失敗
  faultPath: `${SIM}/Fault/Path Blocked`, // 故障注入：路徑無解
  faultVision: `${SIM}/Fault/Vision Lost`, // 故障注入：視覺無解
  faultLine: `${SIM}/Fault/Line Dead`, // 故障注入：黑線單顆失效
  faultGyro: `${SIM}/Fault/Gyro Drift`, // 故障注入：陀螺儀漂移
} as const;

// ── 建圖分頁（Occupancy grid 上機實測）─────────────────────
// 純 NT 路徑（非 Shuffleboard），控制/遙測都在 VMXDashboard「建圖」分頁。
// 字串必須與 MappingSubsystem.cpp 完全一致。
const MAP = "/Mapping";
export const MAP_K = {
  enable: `${MAP}/Enable`, // 是否累積掃描
  reset: `${MAP}/Reset`, // 按鈕（momentary）：清圖 + 錨定場地中央
  staticLayer: `${MAP}/StaticLayer`, // 是否套先驗外框/工作站（真賽場才開）
  occupied: `${MAP}/Occupied Cells`, // 遙測：OCCUPIED 格數
  scans: `${MAP}/Scans`, // 遙測：已累積掃描圈數
  // 整合閘門（stop-and-scan 程式強制）：只有車靜止且沉澱期滿才把掃描累積進 grid。
  // 移動中建圖時「位姿延遲 × 車速」會讓同一面牆每圈落在不同格，加上 OCCUPIED 只增
  // 不減，聯集起來就是「東西被畫得比實際大」。關掉 gateEnable 即回到舊行為做 A/B。
  gateEnable: `${MAP}/GateEnable`, // 閘門開關（預設 true）
  maxSpeed: `${MAP}/MaxSpeed cm_s`, // 視為靜止的速度上限（預設 2 cm/s）
  gated: `${MAP}/Gated`, // 遙測：這一拍是否被閘門擋住
  gateReason: `${MAP}/GateReason`, // 遙測：被擋原因（移動中／沉澱中）
  skippedScans: `${MAP}/SkippedScans`, // 遙測：累計被丟棄的掃描圈數
  // 移動中建圖（deskew）：一圈掃描要 83ms，整圈共用一個位姿等於假設這段時間車沒動；
  // 旋轉尤其致命（90°/s → 一圈轉 7.5°，2m 遠的回波就偏 26cm）。開啟後每條射線各用
  // 自己採集時刻的位姿反投影。要試移動中建圖：deskew 開著、把 gateEnable 關掉。
  deskew: `${MAP}/Deskew`, // 逐射線對齊位姿（預設 true）；關掉＝整圈一個位姿，A/B 對照
  sweepSpan: `${MAP}/SweepSpan deg`, // 遙測：這圈內 heading 掃掠幾度（deskew 修掉的量）
  sweepPoints: `${MAP}/SweepPoints`, // 遙測：這圈的有效點數
  // 殘餘延遲：時戳已經量到「圈內掃掠」那段，這裡只補量不到的 USB/驅動緩衝。
  poseLag: `${MAP}/PoseLag ms`, // 殘餘延遲補償 ms（預設 20）；上機調到地圖最銳利
  // 孤點濾波：孤立的 OCCUPIED 格不輸出（真牆是連通的）。只濾送出的副本，不動證據。
  speckleFilter: `${MAP}/SpeckleFilter`, // 是否啟用（預設 true）
  speckleRemoved: `${MAP}/SpeckleRemoved`, // 遙測：本次發布濾掉的孤點數
  // 直接測距定位：不經牆面擬合，單一角度的距離讀數直接就是座標。整條只有兩行——
  //   X = −d270、Y = d0
  // 角度以實體安裝為準（光達反裝在機器後方），與 LidarFrame.h 的 kRight/kLeft 左右相反。
  // 四個角度的原始讀數都發布：0 = 該方向無回波，一眼分得出「量不到」與「算錯」。
  dirD0: `${MAP}/Direct/d0 cm`, // 0° → Y
  dirD90: `${MAP}/Direct/d90 cm`, // 90°（原始讀數，不參與計算）
  dirD180: `${MAP}/Direct/d180 cm`, // 180°（原始讀數，不參與計算）
  dirD270: `${MAP}/Direct/d270 cm`, // 270° → X
  dirX: `${MAP}/Direct/X cm`, // = −d270
  dirY: `${MAP}/Direct/Y cm`, // = d0
} as const;

// ── 定位分頁（WallPoseCorrector 階段 1+2，observe-only）───────
// 純 NT 路徑，控制/遙測都在 VMXDashboard「定位」分頁。目前機器人端只計算、不套用
// 修正（不寫回 odometry）——heading 符號等慣例要先在這裡看過確認。
// 字串必須與 LocalizationSubsystem.cpp 完全一致。
const LOC = "/Localization";
export const LOC_K = {
  enable: `${LOC}/Enable`,
  // 預設 false：打開後修正量會真的寫回 odometry，直接改變航向保持/cross-track
  // 回授（不只是改地圖估計）。務必先在 Observe 模式看過殘差穩定收斂再打開。
  apply: `${LOC}/Apply`,
  // 階段 1：heading
  rawHeading: `${LOC}/Heading/Raw deg`,
  bias: `${LOC}/Heading/Bias deg`,
  correctedHeading: `${LOC}/Heading/Corrected deg`,
  headingResidual: `${LOC}/Heading/Residual deg`,
  headingAccepted: `${LOC}/Heading/Accepted`,
  headingDisagree: `${LOC}/Heading/Disagree`,
  headingGated: `${LOC}/Heading/Gated`,
  headingNUsed: `${LOC}/Heading/NUsed`,
  headingStreak: `${LOC}/Heading/Streak`,
  // 階段 2：position（X/Y 各一組）
  xObserved: `${LOC}/X/Observed`,
  yObserved: `${LOC}/Y/Observed`,
  xAccepted: `${LOC}/X/Accepted`,
  yAccepted: `${LOC}/Y/Accepted`,
  xResidual: `${LOC}/X/Residual cm`,
  yResidual: `${LOC}/Y/Residual cm`,
  xNudge: `${LOC}/X/Nudge cm`,
  yNudge: `${LOC}/Y/Nudge cm`,
  xNExcluded: `${LOC}/X/NExcluded`,
  yNExcluded: `${LOC}/Y/NExcluded`,
  xDisagree: `${LOC}/X/Disagree`,
  yDisagree: `${LOC}/Y/Disagree`,
  xGated: `${LOC}/X/Gated`,
  yGated: `${LOC}/Y/Gated`,
  xStreak: `${LOC}/X/Streak`,
  yStreak: `${LOC}/Y/Streak`,
  skippedSkew: `${LOC}/SkippedSkew`,
  // 對照組：raw odometry vs. 修正器算出的「若套用」預覽位姿
  rawX: `${LOC}/Raw X cm`,
  rawY: `${LOC}/Raw Y cm`,
  previewX: `${LOC}/Preview X cm`,
  previewY: `${LOC}/Preview Y cm`,
} as const;

// ── 連續路徑測試分頁 ─────────────────────────────────────────
// 控制端（Waypoints/Run/Stop…）純 NT 路徑，字串須與 PathTestSubsystem.cpp 一致；
// 遙測端（Running/Plan */波形）由 ContinuousMove 經 PathTestTelemetry.cpp 發布。
const PT = "/PathTest";
export const PT_K = {
  waypoints: `${PT}/Waypoints`, // JSON [[x_cm,y_cm,theta_deg],...]，只列目的地
  run: `${PT}/Run`, // 按鈕（momentary）：排程一個 ContinuousMove
  stop: `${PT}/Stop`, // 按鈕（momentary）：取消目前這一趟
  corner: `${PT}/Corner cm`, // 轉角倒角深度，0 = 走尖角
  vMax: `${PT}/vMax deg_s`, // 規劃用單輪最高速；0 = 沿用機器人端預設
  aMax: `${PT}/aMax cm_s2`, // 切向加速度上限；0 = 同上
  error: `${PT}/Error`, // 解析／規劃失敗原因，空字串 = 沒問題
  running: `${PT}/Running`, // 遙測：ContinuousMove 執行中
  planOk: `${PT}/Plan OK`, // 遙測：幾何規劃成功
  wpCount: `${PT}/WP Count`, // 遙測：實際規劃點數（含自動補的起點）
  totalTime: `${PT}/Total Time s`,
  length: `${PT}/Length cm`, // 遙測：路徑弧長
  t: `${PT}/t s`, // 波形：本趟經過秒數
  planV: `${PT}/Plan v cm_s`, // 波形：規劃線速度
  planOmega: `${PT}/Plan omega deg_s`, // 波形：規劃自轉（已含航向修正）
  planX: `${PT}/Plan X cm`, // 規劃位置（畫 XY 軌跡用）
  planY: `${PT}/Plan Y cm`,
  planHead: `${PT}/Plan Head deg`,
  actualV: `${PT}/Actual v cm_s`, // 波形：測程法微分出的實測線速度
} as const;

// ── 泰坦三輪底盤遙測（TitanDriveSystems 的 Shuffleboard entries）───
// 連續路徑測試分頁的「測程法位姿」讀這組；單位 cm/度（與 ContinuousMove 同一 frame）。
const TD = "/Shuffleboard/TitanDrive";
export const TD_K = {
  poseX: `${TD}/Odometry/Pose X cm`,
  poseY: `${TD}/Odometry/Pose Y cm`,
  poseHead: `${TD}/Odometry/Pose Head`,
  poseSpeed: `${TD}/Odometry/Pose Speed cm_s`,
  crossErr: `${TD}/Odometry/CrossTrack Err`,
  headingErr: `${TD}/Heading Err`,
} as const;

// ── 執行狀態分頁（賽中監控）─────────────────────────────────
const RUN = "/Shuffleboard/Run";
export const RUN_K = {
  boxOrder: `${RUN}/Box Order`, // JSON ["RED","BLUE","BLACK"]（視覺辨識結果）
  ballColors: `${RUN}/Ball Colors`, // JSON 12 色 ["WHITE","YELLOW",...]
  matchTimer: `${RUN}/Match Timer s`, // 本次任務經過秒數
  abort: `${RUN}/Abort`, // App→機器人：軟體中止（清空指令佇列並停機）
  reset: `${RUN}/Reset`, // App→機器人：中止後復歸（回出發區重新待命）
} as const;

// ── 機器狀態分頁（Go/No-Go 燈牆）+ 頂欄常駐 ─────────────────
const STATUS = "/Shuffleboard/Status";
export const STATUS_K = {
  battery: `${STATUS}/Battery V`,
  cpuTemp: `${STATUS}/CPU Temp C`,
  loopMs: `${STATUS}/Loop ms`, // 控制迴圈實際週期（標稱 20ms）
  constantsOk: `${STATUS}/Constants OK`, // constants.json 載入成功
  gyroOk: `${STATUS}/Gyro OK`, // navX 通訊正常且已歸零
  motorsOk: `${STATUS}/Motors OK`, // Titan CAN 回應 + Encoder 有回報
  cameraOk: `${STATUS}/Camera OK`,
  lidarOk: `${STATUS}/Lidar OK`,
} as const;

// ── 初始化除錯分頁（單一子系統隔離測試）─────────────────────
// 機構（2026-07-15 確認）：只有一個 Z 軸做上下、無觸鬚、有上下極限開關
const DBG = "/Shuffleboard/Debug";
export const DBG_K = {
  zTarget: `${DBG}/Z/Target cm`,
  zHeight: `${DBG}/Z/Height cm`,
  zGo: `${DBG}/Z/Go`,
  zHome: `${DBG}/Z/Home`,
  zHomed: `${DBG}/Z/Homed`,
  zUpperLim: `${DBG}/Z/Upper Limit`,
  zLowerLim: `${DBG}/Z/Lower Limit`,
  driveVx: `${DBG}/Drive/vx`,
  driveVy: `${DBG}/Drive/vy`,
  driveOmega: `${DBG}/Drive/omega`,
  driveEnable: `${DBG}/Drive/Enable`,
  odomX: `${DBG}/Drive/Odom X m`,
  odomY: `${DBG}/Drive/Odom Y m`,
  odomTheta: `${DBG}/Drive/Odom Theta deg`,
  gripperOpen: `${DBG}/Gripper/Open`,
  gripperAngle: `${DBG}/Gripper/Angle deg`,
  trayAngle: `${DBG}/Tray/Angle deg`,
} as const;

// 黑線感測陣列：VMX-pi 類比輸入僅 4 組，硬體上限即感測器上限。
// 實際配置：2 顆 MATRIX 灰度感測器 MS-003V2（AOUT）+ 2 顆紅外線反射感測器，
// 四顆共用同一組類比通道，全部走「AOUT 類比值 + 軟體門檻二值化」同一套邏輯。
export const NUM_LINE_SENSORS = 4;
export const LINE_SENSOR_LABELS = ["灰度L", "灰度R", "紅外線L", "紅外線R"] as const;
export const lineRawKey = (i: number) => `${DBG}/Line/Raw${i}`;
export const lineBinKey = (i: number) => `${DBG}/Line/Bin${i}`;

// Z 軸六個預設高度：取箱 13.5/8.5/3.5，放置 1.8/11.2/20.6（cm）
export const Z_PRESETS = [
  { label: "趟1 取 13.5", cm: 13.5 },
  { label: "趟2 取 8.5", cm: 8.5 },
  { label: "趟3 取 3.5", cm: 3.5 },
  { label: "下格 1.8", cm: 1.8 },
  { label: "上格 11.2", cm: 11.2 },
  { label: "櫃頂 20.6", cm: 20.6 },
] as const;

export const Z_MAX_CM = 25;

// ── 標定精靈（初始化除錯分頁內）─────────────────────────────
const CAL = "/Shuffleboard/Calibrate";
export const CAL_K = {
  lineRun: `${CAL}/Line/Run`,
  lineStep: `${CAL}/Line/Step`, // 目前步驟提示文字
  lineProgress: `${CAL}/Line/Progress`, // 0~1
  lineContrastOk: `${CAL}/Line/Contrast OK`,
  odomRun: `${CAL}/Odom/Run`,
  odomStep: `${CAL}/Odom/Step`,
  odomProgress: `${CAL}/Odom/Progress`,
  odomMeasured: `${CAL}/Odom/Measured mm`, // 人工輸入捲尺實測值
  odomConfirm: `${CAL}/Odom/Confirm`,
  odomFactor: `${CAL}/Odom/Factor`, // 修正係數 k = actual / 2000
} as const;

// ── 光達對牆矯正 ─────────────────────────────────────────────────────────
// occluded 走 Shuffleboard「Lidar」分頁；LidarCal 定位結果走自己的 "/LidarCal" 表。
const LIDAR = "/Shuffleboard/Lidar";
const LIDARCAL = "/LidarCal";
export const LIDAR_K = {
  frontOccluded: `${LIDAR}/Front occluded`, // 前牆被障礙物完全遮擋（量到的是障礙物）
  leftOccluded: `${LIDAR}/Left occluded`,   // 左牆同上
  blockedX: `${LIDARCAL}/blockedX`,         // 左方路徑有障礙物、停在它前面（沒到指定 x；x=左）
  blockedY: `${LIDARCAL}/blockedY`,         // 前方同上（y=前）
  settled: `${LIDARCAL}/settled`,           // 已收斂達標
} as const;
