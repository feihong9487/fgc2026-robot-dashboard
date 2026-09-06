// 比對 TypeScript 移植版與 C++ 本尊的輸出是否一致。
//
// 為什麼需要這支：VMXDashboard 為了「沒接機器也能模擬連續路徑」，把整套路徑規劃
// 複製了一份到 TS。兩份實作一旦漂移，瀏覽器上畫的路徑就會跟機器實際走的不一樣——
// 而「畫面說的跟機器做的不同」正是這個分頁最初出包的原因，不能再犯第二次。
//
// 用法：
//   1. 產生參考值（改過 C++ 就要重跑）：
//        .\tools\mathtest\build.ps1 golden -Csv dashboard-app\tools\golden.json
//   2. 比對：
//        cd dashboard-app && npm run golden
//
// Node 24 原生支援去除型別註記，故可直接跑 .ts，不需要額外測試框架。

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { PathTrajectory } from "../src/lib/path/trajectory.ts";
import { defaultLimits } from "../src/lib/path/velocity.ts";
import type { Waypoint } from "../src/lib/path/geometry.ts";

const here = dirname(fileURLToPath(import.meta.url));
const goldenPath = join(here, "golden.json");

interface GoldenCase {
  name: string;
  cornerRadius_cm: number;
  waypoints: [number, number, number][];
  ok: boolean;
  totalTime_s?: number;
  length_cm?: number;
  corners?: number;
  step_cm?: number;
  pointCount?: number;
  geo?: number[][];
  samples: number[][];
}

// 容差說明：兩邊都是 IEEE754 double、演算法逐行對應，理論上可以到 1e-12。
// 放寬到 1e-9 是留給 Math.hypot / std::hypot 這類 libm 實作差異的餘裕；
// 真正的漂移（漏了一個 clamp、少一個邊界處理）動輒差好幾個數量級，抓得到。
const TOL_ABS = 1e-9;
const TOL_REL = 1e-9;

let checks = 0;
let fails = 0;

function near(got: number, want: number, what: string): void {
  checks++;
  const diff = Math.abs(got - want);
  const tol = TOL_ABS + TOL_REL * Math.abs(want);
  if (!(diff <= tol)) {
    fails++;
    console.log(
      `  FAIL  ${what}\n        got ${got}  want ${want}  (diff ${diff.toExponential(3)} > tol ${tol.toExponential(3)})`,
    );
  }
}

function ok(cond: boolean, what: string): void {
  checks++;
  if (!cond) {
    fails++;
    console.log(`  FAIL  ${what}`);
  }
}

let cases: GoldenCase[];
try {
  cases = JSON.parse(readFileSync(goldenPath, "utf8"));
} catch (e) {
  console.error(
    `讀不到 ${goldenPath}\n請先產生參考值：\n` +
      `  .\\tools\\mathtest\\build.ps1 golden -Csv dashboard-app\\tools\\golden.json\n` +
      `(${(e as Error).message})`,
  );
  process.exit(1);
}

console.log(`golden-check: ${cases.length} cases from C++\n`);

for (const c of cases) {
  console.log(`[${c.name}]`);

  const wps: Waypoint[] = c.waypoints.map((w) => ({
    x_cm: w[0],
    y_cm: w[1],
    heading_deg: w[2],
  }));

  const traj = new PathTrajectory();
  const planned = traj.plan(wps, defaultLimits(), c.cornerRadius_cm);

  ok(planned === c.ok, `plan() agrees on success (${c.ok})`);
  if (!c.ok || !planned) continue;

  near(traj.totalTime(), c.totalTime_s!, "totalTime_s");
  near(traj.length(), c.length_cm!, "length_cm");
  near(traj.geo.step(), c.step_cm!, "step_cm");
  ok(traj.geo.corners === c.corners, `corners (${c.corners})`);
  ok(
    traj.geo.pts.length === c.pointCount,
    `pointCount (got ${traj.geo.pts.length}, want ${c.pointCount})`,
  );

  // 幾何表：C++ 取了 21 個等距索引，這裡用同一套索引取法
  const pts = traj.geo.pts;
  for (let k = 0; k <= 20; k++) {
    const i = pts.length > 1 ? Math.trunc((k / 20) * (pts.length - 1)) : 0;
    const g = c.geo![k];
    near(pts[i].s_cm, g[0], `geo[${k}].s_cm`);
    near(pts[i].x_cm, g[1], `geo[${k}].x_cm`);
    near(pts[i].y_cm, g[2], `geo[${k}].y_cm`);
    near(pts[i].tanX, g[3], `geo[${k}].tanX`);
    near(pts[i].tanY, g[4], `geo[${k}].tanY`);
    near(pts[i].curvature, g[5], `geo[${k}].curvature`);
  }

  // 軌跡取樣：沿時間 41 點
  for (let k = 0; k <= 40; k++) {
    const s = c.samples[k];
    const st = traj.sample(s[0]);
    near(st.x_cm, s[1], `sample[${k}].x_cm`);
    near(st.y_cm, s[2], `sample[${k}].y_cm`);
    near(st.heading_deg, s[3], `sample[${k}].heading_deg`);
    near(st.speed_cm_s, s[4], `sample[${k}].speed_cm_s`);
    near(st.omega_deg_s, s[5], `sample[${k}].omega_deg_s`);
  }
}

console.log(
  `\n${checks} checks, ${fails} failed -> ${fails ? "*** DRIFT DETECTED ***" : "PASS (TS matches C++)"}`,
);
process.exit(fails ? 1 : 0);
