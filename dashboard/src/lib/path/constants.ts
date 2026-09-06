// 機器人常數的 TypeScript 鏡像 —— 對應 src/main/include/Constants.h。
//
// 這份檔案存在的唯一理由是「沒接機器時也要能在瀏覽器裡跑同一套路徑規劃」。
// 值必須與 C++ 端一致，否則模擬出來的路徑會騙人——而「畫面說的跟機器實際做的
// 不一樣」正是這個分頁踩過的坑。
//
// 防漂移機制：tools/mathtest/build.ps1 golden 會用 C++ 產生參考輸出，
// dashboard-app/tools/golden-check.ts 再用這裡的 TS 實作跑同一組輸入比對。
// 改動任何一邊都要重跑 `npm run golden`。

export const NUM_MOTORS = 3;

// ── 底盤幾何 ──────────────────────────────────────────────────
export const ROBOT_DIA = 32.4; // 機器直徑 cm（自轉弧長換算用）
export const DEG_PER_CM = 11.559156; // deg = cm × 360 / (2π × 輪半徑cm)
export const MOTOR_DIR = [-1.0, -1.0, -1.0] as const;

// ── 速度規劃 ──────────────────────────────────────────────────
export const CHASSIS_VMAX = 1000.0; // 單輪最高轉速 deg/s（韌體硬上限）
export const WHEEL_VMAX_RATIO = 0.5; // 規劃只用額定的幾成，其餘留給回授
export const CHASSIS_PLAN_VMAX = CHASSIS_VMAX * WHEEL_VMAX_RATIO;
export const CHASSIS_AMAX_CM_S2 = 40.0; // 切向加/減速上限
export const CHASSIS_ALAT_CM_S2 = 400.0; // 向心加速度上限（摩擦圓；多半不 binding）

// ── 倒角 ──────────────────────────────────────────────────────
export const CHASSIS_CORNER_AUTO = -1.0; // <0 = 自動決定每個轉角的深度
export const CHASSIS_CORNER_RADIUS_CM = CHASSIS_CORNER_AUTO;
export const CHASSIS_CORNER_VEL_CM_S = 35.0; // 自動模式的目標過彎速度
export const CHASSIS_CORNER_MIN_R_CM = 8.0; // 自動模式的半徑下限

// ── 機身角分配形狀 ────────────────────────────────────────────
export const CHASSIS_HEADING_RAMP_FRAC = 0.15;
// 中繼 waypoint 的 heading 要不要生效（false = 只看頭尾，中間的角度被丟棄）
export const CHASSIS_HEADING_PER_WAYPOINT = true;

//===機器自轉角度 → 輪子轉角===
export function robotDegToWheelDeg(robotDeg: number): number {
  return robotDeg * ((ROBOT_DIA * Math.PI) / 360.0) * DEG_PER_CM;
}
