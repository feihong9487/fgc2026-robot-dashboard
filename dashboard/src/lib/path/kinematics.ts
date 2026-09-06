// ChassisKinematics 的 TypeScript 鏡像 —— 對應 src/main/cpp/lib/math/ChassisKinematics.cpp。
// 三輪 kiwi 底盤的逆運動學（β 角）與「邊走邊轉時的輪速飽和上限」。

import { DEG_PER_CM, MOTOR_DIR, NUM_MOTORS, robotDegToWheelDeg } from "./constants.ts";

export interface ChassisSpeeds {
  vx_cm_s: number;
  vy_cm_s: number;
  omega_deg_s: number; // 機器自轉，正 = 右轉
}

//===β 角向量:α = Φ + θ,三顆馬達的平移倍率===
// β1 = 90 − (60 − α) = α + 30，β2 = β1 + 120，β3 = β1 + 240
export function computeBetaRatios(alphaDeg: number): number[] {
  const beta1 = 90.0 - (60.0 - alphaDeg);
  const beta2 = 120.0 + beta1;
  const beta3 = 240.0 + beta1;
  return [
    MOTOR_DIR[0] * Math.cos((beta1 * Math.PI) / 180.0),
    MOTOR_DIR[1] * Math.cos((beta2 * Math.PI) / 180.0),
    MOTOR_DIR[2] * Math.cos((beta3 * Math.PI) / 180.0),
  ];
}

//===極座標版逆運動學:方向角 Φ + 速率 + 自轉 → 三輪 deg/s===
export function toWheelSpeedsPolar(
  phiDeg: number,
  speedCmS: number,
  omegaDegS: number,
  headingDeg: number,
): number[] {
  const ratios = computeBetaRatios(phiDeg + headingDeg);
  const transWheel = speedCmS * DEG_PER_CM;
  const rotWheel = robotDegToWheelDeg(omegaDegS);
  const vel: number[] = [];
  for (let i = 0; i < NUM_MOTORS; i++)
    vel.push(ratios[i] * transWheel - MOTOR_DIR[i] * rotWheel);
  return vel;
}

//===笛卡兒版:世界座標 (vx, vy, ω) → 三輪 deg/s===
export function toWheelSpeeds(speeds: ChassisSpeeds, headingDeg: number): number[] {
  const speed = Math.hypot(speeds.vx_cm_s, speeds.vy_cm_s);
  // Φ 從 −Y 軸起算（Y=直走、X=橫移），與 ChassisMoveProfile 同一慣例
  const phi =
    speed > 1e-9 ? (Math.atan2(speeds.vx_cm_s, -speeds.vy_cm_s) * 180.0) / Math.PI : 0.0;
  return toWheelSpeedsPolar(phi, speed, speeds.omega_deg_s, headingDeg);
}

//===世界座標切線向量 → Φ 方向角===
export function tangentToPhiDeg(tanX: number, tanY: number): number {
  return (Math.atan2(tanX, -tanY) * 180.0) / Math.PI;
}

//===邊走邊轉時的線速度上限(輪速飽和)===
// 令 v = 1 cm/s，則 ω 的數值恰等於 dθ/ds，故各輪速度即為係數 c_i；
// 峰值輪速 = max|c_i|·v，因此 v ≤ wheelVMax / max|c_i|。自轉吃掉的預算已含在內。
export function maxLinearSpeed(
  phiDeg: number,
  dThetaDsDegPerCm: number,
  headingDeg: number,
  wheelVMaxDegS: number,
): number {
  const c = toWheelSpeedsPolar(phiDeg, 1.0, dThetaDsDegPerCm, headingDeg);
  let maxAbs = 0.0;
  for (const ci of c) maxAbs = Math.max(maxAbs, Math.abs(ci));
  // 三輪係數全為 0（既不平移也不旋轉）時不設限，交由上層的 vMax 決定
  return maxAbs < 1e-9 ? wheelVMaxDegS : wheelVMaxDegS / maxAbs;
}
