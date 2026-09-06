// PathTrajectory 的 TypeScript 鏡像 —— 對應 src/main/cpp/lib/path/PathTrajectory.cpp。
// 把幾何、機身角、速度三張表包成單一介面：Plan() 一次，之後用經過時間 t 查詢。
//
// 這一層存在的意義：讓 VMXDashboard 在**完全沒接機器**的情況下也能跑同一套規劃，
// 在編輯 waypoint 的當下就看到真實的路徑形狀與速度波形。

import {
  CHASSIS_CORNER_MIN_R_CM,
  CHASSIS_CORNER_RADIUS_CM,
  CHASSIS_HEADING_PER_WAYPOINT,
  CHASSIS_HEADING_RAMP_FRAC,
} from "./constants.ts";
import { PathGeometry, type BlendSpec, type PathPoint, type Waypoint } from "./geometry.ts";
import { HeadingProfile } from "./heading.ts";
import { defaultLimits, VelocityProfile, type MotionLimits } from "./velocity.ts";

export interface TrajectoryState {
  x_cm: number;
  y_cm: number;
  heading_deg: number;
  tanX: number;
  tanY: number;
  vx_cm_s: number;
  vy_cm_s: number;
  omega_deg_s: number;
  speed_cm_s: number;
  finished: boolean;
}

export class PathTrajectory {
  geo = new PathGeometry();
  hdg = new HeadingProfile();
  vel = new VelocityProfile();
  planned = false;

  //===規劃:依序建三張表(幾何→機身角→速度)===
  // cornerRadius_cm < 0 → 自動決定每個轉角的深度；>= 0 → 沿用固定深度。
  plan(
    wps: Waypoint[],
    lim: MotionLimits = defaultLimits(),
    cornerRadiusCm: number = CHASSIS_CORNER_RADIUS_CM,
    vStart = 0.0,
    vEnd = 0.0,
  ): boolean {
    this.planned = false;

    const spec: BlendSpec = {
      manual_cm: cornerRadiusCm,
      aLatMax_cm_s2: lim.aLatMax_cm_s2,
      vCorner_cm_s: lim.vCorner_cm_s,
      minRadius_cm: CHASSIS_CORNER_MIN_R_CM,
      gapFrac: 0.35,
    };

    if (!this.geo.build(wps, spec, 1.0)) return false;
    this.hdg.build(wps, this.geo, CHASSIS_HEADING_RAMP_FRAC, CHASSIS_HEADING_PER_WAYPOINT);
    if (!this.vel.plan(this.geo, this.hdg, lim, vStart, vEnd)) return false;
    this.planned = true;
    return true;
  }

  totalTime(): number {
    return this.vel.totalTime();
  }
  length(): number {
    return this.geo.length();
  }
  isFinished(t: number): boolean {
    return t >= this.vel.totalTime();
  }

  //===取樣:t→s→(幾何+機身角+速度)合成世界座標前饋===
  sample(t: number): TrajectoryState {
    if (!this.planned) {
      return {
        x_cm: 0, y_cm: 0, heading_deg: 0, tanX: 1, tanY: 0,
        vx_cm_s: 0, vy_cm_s: 0, omega_deg_s: 0, speed_cm_s: 0, finished: true,
      };
    }
    const s = this.vel.arcLengthAt(t);
    const v = this.vel.speedAt(t);
    const p: PathPoint = this.geo.sample(s);

    return {
      x_cm: p.x_cm,
      y_cm: p.y_cm,
      tanX: p.tanX,
      tanY: p.tanY,
      heading_deg: this.hdg.headingAt(s),
      speed_cm_s: v,
      // 平移沿切線方向、自轉 ω = v · dθ/ds（deg/cm × cm/s = deg/s）
      vx_cm_s: v * p.tanX,
      vy_cm_s: v * p.tanY,
      omega_deg_s: v * this.hdg.dThetaDs(s),
      finished: this.isFinished(t),
    };
  }
}

// 面板要畫的整包結果：一次算好，不要每幀重規劃。
export interface SimResult {
  ok: boolean;
  error: string;
  wpCount: number;
  totalTime_s: number;
  length_cm: number;
  corners: number;
  minRadius_cm: number;
  peakToMeanTurnRate: number;
  xy: [number, number][]; // 規劃路徑座標（cm）
  samples: {
    t_s: number;
    v_cm_s: number;
    omega_deg_s: number;
    x_cm: number;
    y_cm: number;
    heading_deg: number;
  }[];
}

//===跑一次完整規劃並取樣成可畫的資料===
// waypoints 含起點（模擬時起點由面板決定，不像實機那樣自動取測程位姿）。
export function simulate(
  wps: Waypoint[],
  lim: MotionLimits = defaultLimits(),
  cornerRadiusCm: number = CHASSIS_CORNER_RADIUS_CM,
  sampleHz = 50,
): SimResult {
  const empty: SimResult = {
    ok: false, error: "", wpCount: wps.length, totalTime_s: 0, length_cm: 0,
    corners: 0, minRadius_cm: 0, peakToMeanTurnRate: 0, xy: [], samples: [],
  };

  if (wps.length < 2) return { ...empty, error: "至少要兩個點（含起點）" };

  // 先擋掉重複點：C++ 端 Build 對此回傳 false，但那樣看不出是哪一段出問題
  for (let i = 0; i + 1 < wps.length; i++) {
    if (Math.hypot(wps[i + 1].x_cm - wps[i].x_cm, wps[i + 1].y_cm - wps[i].y_cm) < 1e-9)
      return { ...empty, error: `第 ${i + 1} 與 ${i + 2} 點重複（零長度線段）` };
  }

  const traj = new PathTrajectory();
  if (!traj.plan(wps, lim, cornerRadiusCm))
    return { ...empty, error: "幾何無效，規劃失敗" };

  let kPeak = 0;
  for (const p of traj.geo.pts) kPeak = Math.max(kPeak, Math.abs(p.curvature));

  const T = traj.totalTime();
  const n = Math.max(2, Math.ceil(T * sampleHz));
  const samples: SimResult["samples"] = [];
  for (let i = 0; i <= n; i++) {
    const t = (T * i) / n;
    const st = traj.sample(t);
    samples.push({
      t_s: t,
      v_cm_s: st.speed_cm_s,
      omega_deg_s: st.omega_deg_s,
      x_cm: st.x_cm,
      y_cm: st.y_cm,
      heading_deg: st.heading_deg,
    });
  }

  return {
    ok: true,
    error: "",
    wpCount: wps.length,
    totalTime_s: T,
    length_cm: traj.length(),
    corners: traj.geo.corners,
    minRadius_cm: kPeak > 1e-12 ? 1.0 / kPeak : Infinity,
    peakToMeanTurnRate: traj.hdg.peakToMeanTurnRate(),
    // 直接用幾何取樣表畫線，比用時間取樣密（等弧長，轉彎處不會變疏）
    xy: traj.geo.pts.map((p) => [p.x_cm, p.y_cm] as [number, number]),
    samples,
  };
}
