// VelocityProfile 的 TypeScript 鏡像 —— 對應 src/main/cpp/lib/path/VelocityProfile.cpp。
// 前向—後向掃描規劃單一條 v(s)：立速限牌 → 前掃（加速）→ 後掃（提前煞車）→ 積分成時間表。

import {
  CHASSIS_ALAT_CM_S2,
  CHASSIS_AMAX_CM_S2,
  CHASSIS_CORNER_VEL_CM_S,
  CHASSIS_PLAN_VMAX,
} from "./constants.ts";
import type { PathGeometry } from "./geometry.ts";
import type { HeadingProfile } from "./heading.ts";
import { maxLinearSpeed, tangentToPhiDeg } from "./kinematics.ts";

const kEps = 1e-9;

// 尖角／反向偵測：實際切線轉角扣掉「曲率本該造成的轉角」後的餘量門檻。
const kCornerExtraTurnRad = (2.0 * Math.PI) / 180.0;

export interface MotionLimits {
  wheelVMax_deg_s: number;
  aMax_cm_s2: number;
  aLatMax_cm_s2: number;
  vCorner_cm_s: number;
}

export function defaultLimits(): MotionLimits {
  return {
    wheelVMax_deg_s: CHASSIS_PLAN_VMAX,
    aMax_cm_s2: CHASSIS_AMAX_CM_S2,
    aLatMax_cm_s2: CHASSIS_ALAT_CM_S2,
    vCorner_cm_s: CHASSIS_CORNER_VEL_CM_S,
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export class VelocityProfile {
  s: number[] = [];
  v: number[] = [];
  t: number[] = [];

  totalTime(): number {
    return this.t.length === 0 ? 0.0 : this.t[this.t.length - 1];
  }
  length(): number {
    return this.s.length === 0 ? 0.0 : this.s[this.s.length - 1];
  }

  plan(
    geo: PathGeometry,
    hdg: HeadingProfile,
    lim: MotionLimits,
    vStart = 0.0,
    vEnd = 0.0,
  ): boolean {
    this.s = [];
    this.v = [];
    this.t = [];

    const pts = geo.pts;
    const N = pts.length;
    if (N < 2) return false;

    const ds = geo.step();
    const aMax = Math.max(lim.aMax_cm_s2, kEps);
    const aLat = Math.max(lim.aLatMax_cm_s2, kEps);
    const vWheel = Math.max(lim.wheelVMax_deg_s, 0.0);

    this.s = new Array<number>(N).fill(0);
    this.v = new Array<number>(N).fill(0);
    this.t = new Array<number>(N).fill(0);

    // ── Step 1：立速限牌 ──
    for (let i = 0; i < N; i++) {
      this.s[i] = pts[i].s_cm;
      const phi = tangentToPhiDeg(pts[i].tanX, pts[i].tanY);
      const heading = hdg.headingAt(pts[i].s_cm);
      const dtds = hdg.dThetaDs(pts[i].s_cm);

      // (a) 輪速飽和：邊走邊轉時某輪先到頂，這才是真正的瓶頸
      let vlim = maxLinearSpeed(phi, dtds, heading, vWheel);

      // (b) 向心加速度（摩擦圓）：v ≤ sqrt(aLat / |κ|)
      const kappa = Math.abs(pts[i].curvature);
      if (kappa > kEps) vlim = Math.min(vlim, Math.sqrt(aLat / kappa));

      this.v[i] = Math.max(vlim, 0.0);
    }

    // ── Step 1b：尖角／反向 → 強制停 ──
    for (let i = 1; i < N; i++) {
      const dot = clamp(pts[i].tanX * pts[i - 1].tanX + pts[i].tanY * pts[i - 1].tanY, -1.0, 1.0);
      const turn = Math.acos(dot);
      const expected =
        0.5 * (Math.abs(pts[i].curvature) + Math.abs(pts[i - 1].curvature)) * ds;
      if (turn - expected > kCornerExtraTurnRad) {
        this.v[i - 1] = 0.0;
        this.v[i] = 0.0;
      }
    }

    // ── 邊界條件 ──
    this.v[0] = Math.min(this.v[0], Math.max(vStart, 0.0));
    this.v[N - 1] = Math.min(this.v[N - 1], Math.max(vEnd, 0.0));

    // ── Step 2：前掃（切向加速度上限）──
    for (let i = 0; i + 1 < N; i++) {
      const reach = Math.sqrt(this.v[i] * this.v[i] + 2.0 * aMax * ds);
      this.v[i + 1] = Math.min(this.v[i + 1], reach);
    }

    // ── Step 3：後掃（提前煞車）──
    for (let i = N - 1; i > 0; i--) {
      const reach = Math.sqrt(this.v[i] * this.v[i] + 2.0 * aMax * ds);
      this.v[i - 1] = Math.min(this.v[i - 1], reach);
    }

    // ── Step 4：積分成時間表 ──
    this.t[0] = 0.0;
    for (let i = 0; i + 1 < N; i++) {
      const vsum = this.v[i] + this.v[i + 1];
      const dt = vsum > kEps ? (2.0 * ds) / vsum : 0.0;
      this.t[i + 1] = this.t[i] + dt;
    }
    return true;
  }

  // t 單調遞增，二分找區間
  private locate(tS: number): number {
    let lo = 0,
      hi = this.t.length - 1;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1;
      if (this.t[mid] <= tS) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  //===時間→弧長(段內等加速度,與 speedAt 自洽)===
  arcLengthAt(tS: number): number {
    if (this.s.length === 0) return 0.0;
    if (tS <= 0.0) return this.s[0];
    if (tS >= this.totalTime()) return this.s[this.s.length - 1];

    const lo = this.locate(tS);
    const hi = lo + 1;
    const dt = this.t[hi] - this.t[lo];
    if (dt <= kEps) return this.s[lo];
    const tau = tS - this.t[lo];
    const a = (this.v[hi] - this.v[lo]) / dt;
    return this.s[lo] + this.v[lo] * tau + 0.5 * a * tau * tau;
  }

  //===時間→線速度(線性內插)===
  speedAt(tS: number): number {
    if (this.v.length === 0) return 0.0;
    if (tS <= 0.0) return this.v[0];
    if (tS >= this.totalTime()) return this.v[this.v.length - 1];

    const lo = this.locate(tS);
    const hi = lo + 1;
    const span = this.t[hi] - this.t[lo];
    const frac = span > kEps ? (tS - this.t[lo]) / span : 0.0;
    return this.v[lo] + frac * (this.v[hi] - this.v[lo]);
  }
}
