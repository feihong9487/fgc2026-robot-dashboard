// FGC 2026 key 目錄與 21 項可調參數白名單。
//
// 真相來源（逐檔核對，不得憑印象改）：
//   key 名稱      FGC2026_TeleOp_Match.java 的 DashHub.put 呼叫、DashHub.java:191
//   白名單/邊界   DashParams.java NAMES[]/KIND[]/MIN[]/MAX[]（:37-76）
//   模式          DashHub.java MODE_PIT / MODE_MATCH（只有這兩個字串）
//
// 常見的三個錯誤假設已在規格 §0 校正：模式不是 /FGC/Robot/Mode、狀態機在
// /FGC/Drive/State、Build tag 是 /FGC/Bridge/Build（沒有 " Tag"）。

// ── key 目錄 ──────────────────────────────────────────────────────────

export const K = {
  // /FGC/Bridge/* —— 橋接器自身，MATCH 也看得到（不含任何比賽資料）
  mode: "/FGC/Bridge/Mode",
  build: "/FGC/Bridge/Build",
  gen: "/FGC/Bridge/Gen",
  threads: "/FGC/Bridge/Threads",
  viewers: "/FGC/Bridge/Viewers",
  enabled: "/FGC/Bridge/Enabled",
  bridgeCamera: "/FGC/Bridge/Camera",
  lastSet: "/FGC/Bridge/Last Set",
  lastSetRejected: "/FGC/Bridge/Last Set Rejected",
  lastError: "/FGC/Bridge/Last Error",
  /** DashNotify.java:58 —— 不管哪一種模式一律留一筆 "level:title"。
      MATCH 期間 notify 不推播，這個埋點是那一段時間唯一「機器人剛剛喊了什麼」的痕跡。 */
  lastNotify: "/FGC/Bridge/Last Notify",

  // /FGC/Status/*
  battery: "/FGC/Status/Battery V",
  loopMs: "/FGC/Status/Loop ms",
  /**
   * 機器人端算好的尾端統計（FGC2026_TeleOp_Match.java:485-498，nearest-rank）。
   * **一定優先用這兩個**：DashPublisher.PERIOD_MS=50 而 OpMode 迴圈約 12 ms，
   * 前端手上的 Loop ms 是「每 4 圈只看得到 1 圈、而且偏向有變動的那些圈」的樣本，
   * 用它算出來的 p95 結構性地看不到尾巴（那支檔案第 90 行的註解就是在說這件事）。
   */
  loopP95: "/FGC/Status/Loop p95",
  loopMax: "/FGC/Status/Loop Max",
  opMode: "/FGC/Status/OpMode",
  matchS: "/FGC/Status/Match s",
  hubs: "/FGC/Status/Hubs",

  // /FGC/Drive/*
  driveState: "/FGC/Drive/State",
  driveForward: "/FGC/Drive/Forward",
  driveTurn: "/FGC/Drive/Turn",
  driveReversed: "/FGC/Drive/Reversed",
  driveClimbMode: "/FGC/Drive/ClimbMode", // DPad Right 切換：只剩底盤與爬升能動

  // /FGC/Shooter/*
  sl: "/FGC/Shooter/SL",
  sr: "/FGC/Shooter/SR",
  way: "/FGC/Shooter/Way",
  targetL: "/FGC/Shooter/TargetL",
  targetR: "/FGC/Shooter/TargetR",
  atSpeed: "/FGC/Shooter/AtSpeed",
  spinupMs: "/FGC/Shooter/SpinupMs",
  currentL: "/FGC/Shooter/CurrentL",
  currentR: "/FGC/Shooter/CurrentR",
  currentWay: "/FGC/Shooter/CurrentWay",
  overCurrentL: "/FGC/Shooter/OverCurrentL",
  overCurrentR: "/FGC/Shooter/OverCurrentR",
  overCurrentWay: "/FGC/Shooter/OverCurrentWay",

  // /FGC/Climb/*
  climbPos: "/FGC/Climb/Pos",
  climbHolding: "/FGC/Climb/Holding",
  climbCurrent: "/FGC/Climb/Current",
  climbOverCurrent: "/FGC/Climb/OverCurrent",

  // /FGC/Hopper/*（CRServo，無回授，只有指令值）
  hopperCmd: "/FGC/Hopper/Cmd",
  hopperDeploy: "/FGC/Hopper/Deploy",   // "open" 定位伺服的指令狀態：STOWED / DEPLOYED / MISSING（無回授）
  hopperOpenDeg: "/FGC/Hopper/OpenDeg", // 上一次送出的角度（deg）

  // /FGC/Gamepad/*
  gpLY: "/FGC/Gamepad/LY",
  gpRX: "/FGC/Gamepad/RX",
  gpLT: "/FGC/Gamepad/LT",
  gpRT: "/FGC/Gamepad/RT",
  gpCross: "/FGC/Gamepad/Cross",
  gpCircle: "/FGC/Gamepad/Circle",
  gpSquare: "/FGC/Gamepad/Square",
  gpL1: "/FGC/Gamepad/L1",
  gpR1: "/FGC/Gamepad/R1",
  gpDUp: "/FGC/Gamepad/DUp",
  gpDDown: "/FGC/Gamepad/DDown",
  gpDRight: "/FGC/Gamepad/DRight",

  // /FGC/Vision/*（TagCam.java:97-110）
  visionCount: "/FGC/Vision/Count",
  visionFps: "/FGC/Vision/FPS",
  visionCamState: "/FGC/Vision/CamState",
  visionTags: "/FGC/Vision/Tags",
  visionLibrary: "/FGC/Vision/Library",
  visionDecimation: "/FGC/Vision/Decimation",
  visionFrames: "/FGC/Vision/Frames",
  visionEnabled: "/FGC/Vision/Enabled",
  bestId: "/FGC/Vision/Best/Id",
  bestRange: "/FGC/Vision/Best/Range m",
  bestBearing: "/FGC/Vision/Best/Bearing deg",
  bestYaw: "/FGC/Vision/Best/Yaw deg",
  bestMargin: "/FGC/Vision/Best/Margin",
  bestAge: "/FGC/Vision/Best/Age s",

  // /FGC/Camera/*（MJPEG 串流，與 Vision 是兩組不同的東西）
  camFrames: "/FGC/Camera/Frames",
  camFrameKB: "/FGC/Camera/Frame KB",
  camClients: "/FGC/Camera/Clients",
  camLastError: "/FGC/Camera/Last Error",

  // /FGC/Aim/*
  aimActive: "/FGC/Aim/Active",
  aimDelta: "/FGC/Aim/Delta",

  // /FGC/Rec/*
  recFile: "/FGC/Rec/File",
  recLines: "/FGC/Rec/Lines",

  // /FGC/Probe/*（Z-DASH-PING 這支 OpMode 才有）
  probeCounter: "/FGC/Probe/Counter",
  probeUptime: "/FGC/Probe/Uptime s",

  // /FGC/Param/*
  snippet: "/FGC/Param/_Snippet",
  saved: "/FGC/Param/_Saved",
} as const;

export const TUNE_PREFIX = "/FGC/Tune/";
export const PARAM_PREFIX = "/FGC/Param/";
/** 編譯值（機器人端待補的 P1 改動，約 10 行）；缺席時 ParamDiffCard 顯示「未知」。 */
export const BUILD_PARAM_PREFIX = "/FGC/Param/Build ";

/** /FGC/Vision/Age/<id> s：每個看過的 tag 各一個 key。 */
export const VISION_AGE_PREFIX = "/FGC/Vision/Age/";

export const MODE_PIT = "PIT";
export const MODE_MATCH = "MATCH";

/** 狀態機三態（FGC2026_TeleOp_Match.java:339）。 */
export type DriveState = "COLLECT" | "SHOOT" | "EJECT";
export const DRIVE_STATES: readonly DriveState[] = ["COLLECT", "SHOOT", "EJECT"];

// ── 21 項可調參數白名單 ────────────────────────────────────────────────

export type TuneKind = "num" | "bool";

export interface Tunable {
  /** DashParams.NAMES[i]，逐字對應。 */
  name: string;
  kind: TuneKind;
  /** DashParams.MIN[i] / MAX[i]。機器人端會夾限，前端只是先擋。 */
  min: number;
  max: number;
  /** 滑桿粒度（純前端，機器人端不知道）。 */
  step: number;
  /** 顯示單位；空字串代表無單位比例值。 */
  unit: string;
  /** UI 分組（§4.3 左欄的摺疊群）。 */
  group: string;
  /**
   * M11：這個值本身或它推導出的建議，能被轉述給場上的駕駛。
   * 非 PIT 一律不 render（不是 disabled）。
   */
  coachRisk: boolean;
  /**
   * G13：比機器人端 MAX[] 更嚴的前端上限（幾何上限，不越 SU 頂棚）。
   * 沒有就等於 max。
   */
  uiMax?: number;
  /** uiMax 的來源，直接顯示在滑桿旁邊——上限是規則不是偏好。 */
  uiMaxWhy?: string;
  /** 預設值（Constants.java），只用來在完全離線時顯示灰字。 */
  def: number;
}

// TODO: 幾何上限待圖紙核算 —— VEL_SL / VEL_SR 的 uiMax 2400 尚未在
// 2026 FGC Playing Field Drawings.pdf 上逐項核對（規格附錄 A #5）。
const VEL_UI_MAX = 2400;
const VEL_UI_WHY = "幾何上限（待圖紙核算）";

export const TUNABLES: readonly Tunable[] = [
  { name: "DEADZONE",       kind: "num",  min: 0, max: 0.4,  step: 0.01,  unit: "",    group: "底盤", coachRisk: false, def: 0.06 },
  { name: "TURN_SCALE",     kind: "num",  min: 0, max: 1,    step: 0.05,  unit: "",    group: "底盤", coachRisk: false, def: 0.8 },

  { name: "VEL_SL",         kind: "num",  min: 0, max: 3000, step: 10,    unit: "tps", group: "shooter", coachRisk: false, def: 1900, uiMax: VEL_UI_MAX, uiMaxWhy: VEL_UI_WHY },
  { name: "VEL_SR",         kind: "num",  min: 0, max: 3000, step: 10,    unit: "tps", group: "shooter", coachRisk: false, def: 1900, uiMax: VEL_UI_MAX, uiMaxWhy: VEL_UI_WHY },
  { name: "IDLE_TPS",       kind: "num",  min: 0, max: 3000, step: 10,    unit: "tps", group: "shooter", coachRisk: false, def: 0 },
  { name: "EJECT_VEL",      kind: "num",  min: 0, max: 3000, step: 10,    unit: "tps", group: "shooter", coachRisk: false, def: 1600 },
  { name: "WAIT_SPINUP",    kind: "bool", min: 0, max: 1,    step: 1,     unit: "",    group: "shooter", coachRisk: false, def: 1 },
  { name: "FEED_THRESHOLD", kind: "num",  min: 0, max: 3000, step: 10,    unit: "tps", group: "shooter", coachRisk: false, def: 1200 },

  { name: "WAY_TPS",        kind: "num",  min: 0, max: 3000, step: 10,    unit: "tps", group: "送料", coachRisk: false, def: 1800 },
  { name: "WAY_IDLE_TPS",   kind: "num",  min: 0, max: 3000, step: 10,    unit: "tps", group: "送料", coachRisk: false, def: 400 },

  { name: "INTAKE_COLLECT", kind: "num",  min: 0, max: 1,    step: 0.05,  unit: "",    group: "intake", coachRisk: false, def: 1 },
  { name: "INTAKE_SHOOT",   kind: "num",  min: 0, max: 1,    step: 0.05,  unit: "",    group: "intake", coachRisk: false, def: 1 },

  { name: "CLIMB",          kind: "num",  min: 0, max: 1,    step: 0.05,  unit: "",    group: "爬升", coachRisk: false, def: 1 },
  { name: "HOLD",           kind: "num",  min: 0, max: 1,    step: 0.05,  unit: "",    group: "爬升", coachRisk: false, def: 0.6 },

  { name: "HOPPER_POWER",   kind: "num",  min: 0, max: 1,    step: 0.05,  unit: "",    group: "球倉", coachRisk: false, def: 1 },
  { name: "OPEN_STOW_DEG",   kind: "num",  min: 0, max: 270,  step: 5,     unit: "deg", group: "球倉", coachRisk: false, def: 0 },
  { name: "OPEN_DEPLOY_DEG", kind: "num",  min: 0, max: 270,  step: 5,     unit: "deg", group: "球倉", coachRisk: false, def: 120 },

  { name: "TAG_DECIMATION", kind: "num",  min: 1, max: 8,    step: 1,     unit: "",    group: "視覺", coachRisk: false, def: 2 },
  { name: "TAG_MIN_MARGIN", kind: "num",  min: 0, max: 200,  step: 5,     unit: "",    group: "視覺", coachRisk: false, def: 30 },
  { name: "AIM_KP",         kind: "num",  min: 0, max: 0.2,  step: 0.001, unit: "",    group: "視覺", coachRisk: true,  def: 0.01 },
  { name: "AIM_MAX",        kind: "num",  min: 0, max: 1,    step: 0.05,  unit: "",    group: "視覺", coachRisk: true,  def: 0.3 },

  { name: "MJPEG_FPS",      kind: "num",  min: 1, max: 30,   step: 1,     unit: "fps", group: "串流", coachRisk: false, def: 10 },
  { name: "MJPEG_Q",        kind: "num",  min: 5, max: 95,   step: 5,     unit: "",    group: "串流", coachRisk: false, def: 40 },
];

const BY_NAME = new Map<string, Tunable>(TUNABLES.map((t) => [t.name, t]));

/** 白名單分組後的顯示順序（保持 DashParams.NAMES 的相對順序）。 */
export const TUNE_GROUPS: readonly string[] = [
  "shooter",
  "送料",
  "intake",
  "爬升",
  "球倉",
  "底盤",
  "視覺",
  "串流",
];

export function tuneKey(name: string): string {
  return TUNE_PREFIX + name;
}

export function paramKey(name: string): string {
  return PARAM_PREFIX + name;
}

export function buildParamKey(name: string): string {
  return BUILD_PARAM_PREFIX + name;
}

/** 去掉 /FGC/Tune/ 或 /FGC/Param/ 前綴（DashParams.indexOf 的行為）。 */
export function bareName(key: string): string {
  if (key.startsWith(TUNE_PREFIX)) return key.slice(TUNE_PREFIX.length);
  if (key.startsWith(PARAM_PREFIX)) return key.slice(PARAM_PREFIX.length);
  return key;
}

export function tunable(nameOrKey: string): Tunable | undefined {
  return BY_NAME.get(bareName(nameOrKey));
}

/**
 * set() 的白名單閘（§8 M01 第三行）。
 *
 * 刻意嚴格到「必須是 /FGC/Tune/<白名單名稱>」：只給名稱不算、給 /FGC/Param/* 不算。
 * 機器人端 DashParams.indexOf 兩種前綴都吃，但那是它的寬容，不是我們的許可。
 */
export function isTunableKey(key: string): boolean {
  if (!key.startsWith(TUNE_PREFIX)) return false;
  return BY_NAME.has(key.slice(TUNE_PREFIX.length));
}

/** 前端滑桿上限：取機器人端 MAX 與幾何上限的較小者（G13）。 */
export function uiMaxOf(t: Tunable): number {
  return t.uiMax !== undefined ? Math.min(t.uiMax, t.max) : t.max;
}

/** 夾限成機器人端會接受的值。 */
export function clampTune(t: Tunable, v: number): number {
  if (!Number.isFinite(v)) return t.min;
  return Math.min(t.max, Math.max(t.min, v));
}

// ── 規則旗標 ──────────────────────────────────────────────────────────

/**
 * M11：可被轉述給場上駕駛的資訊。非 PIT 一律不 render。
 * 這條線寫在這裡而不是靠記憶（§8）。
 */
export function isCoachRiskKey(key: string): boolean {
  if (key.startsWith("/FGC/Vision/")) return true;
  if (key.startsWith("/FGC/Aim/")) return true;
  if (key === K.targetL || key === K.targetR) return true;
  const t = tunable(key);
  return t ? t.coachRisk : false;
}

/**
 * Lockdown 頁可顯示的 key：機器人自身的健康狀態，零比賽資訊。
 * /FGC/Shooter、/FGC/Vision、/FGC/Drive、/FGC/Aim 一律不在此列。
 */
export function isLockdownSafeKey(key: string): boolean {
  if (key.startsWith("/FGC/Bridge/")) return true;
  if (key.startsWith("/FGC/Rec/")) return true;
  return key === K.opMode;
}

/**
 * Lockdown 子樹**唯一**准許取值的 key 集合。
 *
 * 這個常數存在的理由：以前 isLockdownSafeKey() 是死碼（零呼叫點），而
 * LockdownCards.tsx 的檔頭卻寫著「這條線寫在旗標裡，不靠記憶」——那比沒有註解更糟，
 * 因為它會讓 code review 略過那一頁。現在 Lockdown 的每一次取值都走 lockdownValue()，
 * 而 tools/fgc-check-2a.ts 會斷言這個集合 ⊆ isLockdownSafeKey。
 * 往 Lockdown 加一格而忘了想 M11 的人，會在 npm run check 就被擋下來。
 */
export const LOCKDOWN_KEYS: readonly string[] = [
  K.build,
  K.gen,
  K.threads,
  K.mode,
  K.opMode,
  K.recFile,
  K.recLines,
  K.lastNotify,
];

/**
 * Lockdown 頁取值的唯一入口。不在白名單就回 null（不是「顯示空字串」——
 * 呼叫端拿到 null 會整格不 render，而不是畫一個空框讓人以為機器人壞了）。
 */
export function lockdownValue<T>(key: string, read: (k: string) => T): T | null {
  if (!isLockdownSafeKey(key)) return null;
  return read(key);
}

/** 依 /FGC/<子系統>/<名稱> 取子系統名（訊號樹用）。 */
export function groupOf(key: string): string {
  const parts = key.split("/").filter(Boolean);
  return parts.length >= 2 ? parts[1] : "其他";
}

/** 顯示用短名（去掉 /FGC/<子系統>/）。 */
export function shortName(key: string): string {
  const parts = key.split("/").filter(Boolean);
  return parts.length >= 3 ? parts.slice(2).join("/") : key;
}
