// 模擬資料源：沒有機器人時開發／驗證 UI 用（Simulation-first HMI 的核心）
// 產生：S-curve 波形、三馬達追蹤、陀螺儀、cosβ、光達點雲、
//       2×4m 場地任務狀態機（三趟 PickBox→PickBalls→PlaceBox + A* 假遙測）、
//       故障注入反應（含黑線失效/陀螺儀漂移）、軟體中止/復歸、
//       Z 軸/黑線/夾爪等子系統物理、系統健康（電池/CPU/迴圈）、
//       辨識結果（箱色/12球色排序）、標定精靈、常數表存/讀/VERIFY。
import { store, NtValue } from "./store";
import {
  K, motorKey, cosBetaKey, NUM_MOTORS,
  SIM_K, RUN_K, STATUS_K, DBG_K, CAL_K,
  lineRawKey, lineBinKey, NUM_LINE_SENSORS, Z_MAX_CM,
} from "./keys";
import { ALL_VISION_PARAMS, resultKey, tuningKey } from "./visionKeys";
import {
  CONST_CTRL, CONST_PREFIX, defaultConstants, flattenConstants,
} from "./constantsSchema";

const RATE_MS = 40; // 25Hz

// ── 場地（公尺）：原點右下角，x∈[-4,0] 長邊（左負）、y∈[0,2] 短邊（未變動）。
// 位置對齊大會示意圖／FieldMap.h ──
const START = { x: -0.3, y: 0.26 }; // 出發區（右下角）
const STACK = { x: -0.45, y: 1.75 }; // 整理箱附近（上右）
const SORT = { x: -0.4, y: 1.68 }; // 領貨區附近（右上）
const SHELF = { x: -3.65, y: 1.32 }; // 倉儲櫃附近（左中，送貨目標）

interface Phase {
  state: string;
  cmd: string;
  dur: number; // 秒
  trip: number; // 0 = 尚未開始趟次
  from?: { x: number; y: number };
  to?: { x: number; y: number };
}

function buildMission(): Phase[] {
  const ph: Phase[] = [
    { state: "IDENTIFY", cmd: "IdentifyStack()", dur: 2, trip: 0 },
  ];
  let prev = START;
  for (let t = 1; t <= 3; t++) {
    ph.push({ state: `TRIP${t}_NAV_STACK`, cmd: "NavigateTo(箱堆)", dur: 3, trip: t, from: prev, to: STACK });
    ph.push({ state: `TRIP${t}_PICK`, cmd: `PickBox(trip${t})`, dur: 2.2, trip: t });
    ph.push({ state: `TRIP${t}_NAV_SORT`, cmd: "NavigateTo(理貨區)", dur: 3, trip: t, from: STACK, to: SORT });
    ph.push({ state: `TRIP${t}_BALLS`, cmd: "PickBalls()", dur: 2.5, trip: t });
    ph.push({ state: `TRIP${t}_NAV_SHELF`, cmd: "NavigateTo(倉儲櫃)", dur: 3.2, trip: t, from: SORT, to: SHELF });
    ph.push({ state: `TRIP${t}_PLACE`, cmd: "PlaceBox()", dur: 2.5, trip: t });
    prev = SHELF;
  }
  ph.push({ state: "RETURN", cmd: "NavigateTo(出發區)", dur: 3.5, trip: 3, from: SHELF, to: START });
  ph.push({ state: "DONE", cmd: "（待命）", dur: 4, trip: 3 });
  return ph;
}

const MISSION = buildMission();

const easeInOut = (u: number) => (u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u));

// 辨識結果（IDENTIFY 完成後發布）
const SIM_BOX_ORDER = ["BLUE", "RED", "BLACK"];
const SIM_BALL_COLORS = [
  "WHITE", "YELLOW", "WHITE", "WHITE", "YELLOW", "YELLOW",
  "WHITE", "YELLOW", "YELLOW", "WHITE", "WHITE", "YELLOW",
];

export class SimSource {
  private timer: number | null = null;
  private t = 0;
  private params = new Map<string, NtValue>();
  private onBatch: ((d: Record<string, NtValue>) => void) | null;

  // S-curve profile 狀態（波形）
  private running = false;
  private profileT = 0;
  private profileDur = 0;
  private dist = 0;
  private targets = [0, 0, 0];
  private currents = [0, 0, 0];

  // 任務狀態機
  private phaseIdx = 0;
  private phaseT = 0;
  private missionT = 0; // 任務計時（RUN_K.matchTimer）
  private aborted = false;
  private identified = false;
  private pose = { x: START.x, y: START.y, theta: 0 };
  private gyroDrift = 0; // 故障注入：漂移累積
  private replanCount = 0;
  private planTimeMs = 5;
  private obstacles: number[][] = [
    [-2.7, 0.9, 0.25, 0.25],
    [-1.5, 1.3, 0.25, 0.25],
    [-1.0, 0.5, 0.25, 0.25],
  ];
  private nextObstacleShift = 6;

  // 子系統
  private zHeight = 0;
  private zTarget = 0;
  private zMoving = false;
  private savedConstants: Record<string, number | string>; // 「檔案」內容（VERIFY 的真相）

  // 標定流程
  private lineCalT = -1; // <0 = 未執行
  private odomCalT = -1;
  private odomWaiting = false;

  constructor(onBatch?: (d: Record<string, NtValue>) => void) {
    this.onBatch = onBatch ?? null;
    const defaults: Record<string, NtValue> = {
      [K.kP]: 0.01, [K.kI]: 0, [K.kD]: 0.0002, [K.kPHeading]: 0.5,
      [K.vMax]: 600, [K.aMax]: 500, [K.jMax]: 1000,
      [K.x]: 100, [K.y]: 150, [K.theta]: 45,
      [K.start]: false, [K.eStop]: false,
      // 故障注入預設關閉
      [SIM_K.faultGrip]: false, [SIM_K.faultPath]: false, [SIM_K.faultVision]: false,
      [SIM_K.faultLine]: false, [SIM_K.faultGyro]: false,
      // 執行狀態
      [RUN_K.boxOrder]: "[]", [RUN_K.ballColors]: "[]",
      [RUN_K.matchTimer]: 0, [RUN_K.abort]: false, [RUN_K.reset]: false,
      // 機器狀態（燈牆）
      [STATUS_K.battery]: 12.6, [STATUS_K.cpuTemp]: 55, [STATUS_K.loopMs]: 20,
      [STATUS_K.constantsOk]: true, [STATUS_K.gyroOk]: true, [STATUS_K.motorsOk]: true,
      [STATUS_K.cameraOk]: true, [STATUS_K.lidarOk]: true,
      // 初始化除錯（Z 軸 + 底盤 + 夾爪 + 托盤）
      [DBG_K.zTarget]: 10, [DBG_K.zHeight]: 0,
      [DBG_K.zGo]: false, [DBG_K.zHome]: false, [DBG_K.zHomed]: false,
      [DBG_K.zUpperLim]: false, [DBG_K.zLowerLim]: true,
      [DBG_K.driveVx]: 0, [DBG_K.driveVy]: 0, [DBG_K.driveOmega]: 0, [DBG_K.driveEnable]: false,
      [DBG_K.odomX]: 0, [DBG_K.odomY]: 0, [DBG_K.odomTheta]: 0,
      [DBG_K.gripperOpen]: false, [DBG_K.gripperAngle]: 30,
      [DBG_K.trayAngle]: 0,
      // 標定精靈
      [CAL_K.lineRun]: false, [CAL_K.lineStep]: "待命", [CAL_K.lineProgress]: 0,
      [CAL_K.lineContrastOk]: false,
      [CAL_K.odomRun]: false, [CAL_K.odomStep]: "待命", [CAL_K.odomProgress]: 0,
      [CAL_K.odomMeasured]: 2000, [CAL_K.odomConfirm]: false, [CAL_K.odomFactor]: 1,
      // 常數表控制
      [CONST_CTRL.save]: false, [CONST_CTRL.verify]: false,
      [CONST_CTRL.verifyJson]: "", [CONST_CTRL.status]: "",
    };
    for (const [k, v] of Object.entries(defaults)) this.params.set(k, v);
    for (const p of ALL_VISION_PARAMS) this.params.set(tuningKey(p.name), p.def);
    // 常數表：模擬的「檔案」初始為預設值，NT 上也發布同一份
    this.savedConstants = flattenConstants(defaultConstants());
    for (const [k, v] of Object.entries(this.savedConstants)) this.params.set(k, v);
  }

  private apply(d: Record<string, NtValue>) {
    this.onBatch?.(d); // 錄進 JSONL 記錄（回放用）
    store.applyBatch(d);
  }

  start() {
    this.apply(Object.fromEntries(this.params));
    this.timer = window.setInterval(() => this.tick(), RATE_MS);
  }

  stop() {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  set(key: string, value: NtValue) {
    this.params.set(key, value);
    this.apply({ [key]: value });

    if (key === K.start && value === true && !this.running) {
      const x = Number(this.params.get(K.x)) || 0;
      const y = Number(this.params.get(K.y)) || 0;
      const vMax = Math.max(Number(this.params.get(K.vMax)) || 600, 50);
      this.dist = Math.hypot(x, y);
      this.profileDur = Math.min(Math.max((this.dist / vMax) * 2.5, 1.5), 10);
      this.profileT = 0;
      this.running = true;
    }

    // Z 軸：Go / Home 按鈕（消耗後自動彈回 false）
    if (key === DBG_K.zGo && value === true) {
      this.zTarget = Number(this.params.get(DBG_K.zTarget)) || 0;
      this.zMoving = true;
      this.set(DBG_K.zGo, false);
    }
    if (key === DBG_K.zHome && value === true) {
      this.zTarget = 0;
      this.zMoving = true;
      this.set(DBG_K.zHome, false);
    }

    // 軟體中止／復歸
    if (key === RUN_K.abort && value === true) {
      this.aborted = true;
      this.set(RUN_K.abort, false);
    }
    if (key === RUN_K.reset && value === true) {
      this.aborted = false;
      this.phaseIdx = 0;
      this.phaseT = 0;
      this.missionT = 0;
      this.identified = false;
      this.pose = { x: START.x, y: START.y, theta: 0 };
      this.replanCount = 0;
      this.set(RUN_K.reset, false);
    }

    // 標定：啟動一鍵流程
    if (key === CAL_K.lineRun && value === true && this.lineCalT < 0) this.lineCalT = 0;
    if (key === CAL_K.odomRun && value === true && this.odomCalT < 0) {
      this.odomCalT = 0;
      this.odomWaiting = false;
    }
    if (key === CAL_K.odomConfirm && value === true && this.odomWaiting) {
      const measured = Number(this.params.get(CAL_K.odomMeasured)) || 2000;
      const k = measured / 2000;
      const wrKey = `${CONST_PREFIX}/drive/wheelRadiusMm`;
      const wr = Number(this.params.get(wrKey)) || 0;
      const batch: Record<string, NtValue> = {
        [CAL_K.odomFactor]: k,
        [CAL_K.odomStep]: `完成，k=${k.toFixed(4)}${wr ? "，wheelRadius 已修正（草稿）" : ""}`,
        [CAL_K.odomProgress]: 1,
        [CAL_K.odomConfirm]: false,
        [CAL_K.odomRun]: false,
      };
      if (wr) batch[wrKey] = wr * k;
      for (const [bk, bv] of Object.entries(batch)) this.params.set(bk, bv);
      this.apply(batch);
      this.odomWaiting = false;
      this.odomCalT = -1;
    }

    // 常數表：儲存（NT 草稿 → 模擬檔案）與 VERIFY（讀回檔案）
    if (key === CONST_CTRL.save && value === true) {
      this.savedConstants = {};
      for (const [pk, pv] of this.params) {
        if (pk.startsWith(`${CONST_PREFIX}/`) && !pk.includes("/_") &&
            (typeof pv === "number" || typeof pv === "string"))
          this.savedConstants[pk] = pv;
      }
      this.set(CONST_CTRL.save, false);
      this.set(CONST_CTRL.status, "已寫入 deploy/constants.json（模擬）");
    }
    if (key === CONST_CTRL.verify && value === true) {
      this.set(CONST_CTRL.verify, false);
      // 以「檔案」為準組出巢狀 JSON 字串
      const nested: Record<string, unknown> = {};
      for (const [ck, cv] of Object.entries(this.savedConstants)) {
        const segs = ck.slice(CONST_PREFIX.length + 1).split("/");
        let cur = nested;
        for (let i = 0; i < segs.length - 1; i++) {
          if (typeof cur[segs[i]] !== "object" || cur[segs[i]] === null) cur[segs[i]] = {};
          cur = cur[segs[i]] as Record<string, unknown>;
        }
        cur[segs[segs.length - 1]] = cv;
      }
      this.set(CONST_CTRL.verifyJson, JSON.stringify(nested, null, 2));
      this.set(CONST_CTRL.status, "已讀回檔案內容（模擬）");
    }
  }

  private tick() {
    this.t += RATE_MS / 1000;
    const dt = RATE_MS / 1000;
    const d: Record<string, NtValue> = {};

    this.tickProfile(d, dt);
    this.tickMission(d, dt);
    this.tickStatus(d);
    this.tickSubsystems(d, dt);
    this.tickCalibrate(d, dt);
    this.tickVision(d);
    this.apply(d);
    this.publishPointCloud();
  }

  // ── S-curve 波形 + 三馬達 ──────────────────────────────────
  private tickProfile(d: Record<string, NtValue>, dt: number) {
    let vel = 0;
    if (this.running) {
      this.profileT += dt;
      const u = Math.min(this.profileT / this.profileDur, 1);
      const s = 3 * u * u - 2 * u * u * u;
      const dsdu = 6 * u - 6 * u * u;
      const d2sdu2 = 6 - 12 * u;
      d[K.wavePos] = this.dist * s;
      vel = (this.dist * dsdu) / this.profileDur;
      d[K.waveVel] = vel;
      d[K.waveAcc] = (this.dist * d2sdu2) / (this.profileDur * this.profileDur);
      if (u >= 1) {
        this.running = false;
        this.params.set(K.start, false);
        d[K.start] = false;
      }
    } else {
      d[K.wavePos] = 0;
      d[K.waveVel] = 0;
      d[K.waveAcc] = 0;
    }

    const alpha = this.t * 0.3;
    const betas = [0, 1, 2].map((i) => Math.cos(alpha + (i * 2 * Math.PI) / 3));
    const maxB = Math.max(...betas.map(Math.abs), 1e-6);
    for (let i = 0; i < NUM_MOTORS; i++) {
      const ratio = betas[i] / maxB;
      d[cosBetaKey(i)] = ratio;
      this.targets[i] += vel * ratio * dt * 2;
      this.currents[i] +=
        (this.targets[i] - this.currents[i]) * 0.25 + (Math.random() - 0.5) * 0.4;
      const err = this.targets[i] - this.currents[i];
      const kP = Number(this.params.get(K.kP)) || 0.01;
      d[motorKey(i, "TargetAngle")] = this.targets[i];
      d[motorKey(i, "CurrentAngle")] = this.currents[i];
      d[motorKey(i, "Error")] = err;
      d[motorKey(i, "Output")] = Math.max(-1, Math.min(1, kP * err * 5));
    }
    // 陀螺儀漂移注入：狀態機應由黑線/光達校正吸收，看 pose 會不會歪掉
    if (this.params.get(SIM_K.faultGyro) === true) this.gyroDrift += 0.8 * dt;
    d[K.yaw] = Math.sin(this.t * 0.2) * 3 + this.gyroDrift + (Math.random() - 0.5) * 0.2;
    d[K.headingErr] = (Math.random() - 0.5) * 1.5;
  }

  // ── 任務狀態機（模擬驗證 + 執行狀態分頁）──────────────────
  private tickMission(d: Record<string, NtValue>, dt: number) {
    const ph = MISSION[this.phaseIdx];
    const faultGrip = this.params.get(SIM_K.faultGrip) === true;
    const faultPath = this.params.get(SIM_K.faultPath) === true;
    const faultVision = this.params.get(SIM_K.faultVision) === true;

    // 軟體中止：凍結任務、清空指令
    if (this.aborted) {
      d[SIM_K.state] = "ABORTED";
      d[SIM_K.currentCommand] = "（已中止 — 按復歸重新待命）";
      d[SIM_K.tripIndex] = ph.trip;
      d[SIM_K.pathJson] = "[]";
      d[RUN_K.matchTimer] = this.missionT;
      d[SIM_K.poseX] = this.pose.x;
      d[SIM_K.poseY] = this.pose.y;
      d[SIM_K.poseTheta] = this.pose.theta;
      d[SIM_K.obstaclesJson] = JSON.stringify(this.obstacles);
      d[SIM_K.planTimeMs] = 0;
      d[SIM_K.replanCount] = this.replanCount;
      return;
    }

    // 障礙物漂移 → 重規劃事件
    this.nextObstacleShift -= dt;
    if (this.nextObstacleShift <= 0) {
      this.nextObstacleShift = 5 + Math.random() * 4;
      const ob = this.obstacles[Math.floor(Math.random() * this.obstacles.length)];
      ob[0] = Math.min(-0.4, Math.max(-3.4, ob[0] + (Math.random() - 0.5) * 0.5));
      ob[1] = Math.min(1.6, Math.max(0.4, ob[1] + (Math.random() - 0.5) * 0.4));
      this.replanCount++;
      this.planTimeMs = 4 + Math.random() * 9;
    }

    const isNav = !!ph.to;
    let cmd = ph.cmd;
    let state = ph.state;
    let advance = true;

    if (faultVision && ph.state === "IDENTIFY") {
      cmd = "IdentifyStack()【視覺無解】";
      state = "FAULT_VISION";
      advance = false;
    } else if (faultPath && isNav) {
      cmd = `${ph.cmd}【路徑無解，重規劃中】`;
      state = "FAULT_PATH";
      advance = false;
      // 每 ~0.7s 記一次失敗的重規劃，耗時飆高 —— 練習期就要看過這個畫面
      if (Math.floor((this.t / 0.7) % 2) === 0 && Math.random() < 0.1) {
        this.replanCount++;
        this.planTimeMs = 80 + Math.random() * 60;
      }
    } else if (faultGrip && ph.state.endsWith("_PICK")) {
      cmd = `PickBox(trip${ph.trip})【夾取失敗，重試】`;
      state = "FAULT_GRIP";
      advance = false;
    }

    if (advance) this.phaseT += dt;
    this.missionT += dt;
    const u = Math.min(this.phaseT / ph.dur, 1);

    // 位姿：導航段之間插值；到位後朝向歸零
    if (ph.from && ph.to && advance) {
      const s = easeInOut(u);
      this.pose.x = ph.from.x + (ph.to.x - ph.from.x) * s;
      this.pose.y = ph.from.y + (ph.to.y - ph.from.y) * s;
      // 車頭朝行進方向。heading 慣例是 0° = +y、順時針為正（FieldMap.h），車頭
      // = (sin θ, cos θ)，反解得 θ = atan2(dx, dy) —— 注意引數順序與標準
      // atan2(dy, dx) 相反；寫反的話模擬出來的位姿會跟真機差 90° 又鏡射。
      this.pose.theta =
        (Math.atan2(ph.to.x - ph.from.x, ph.to.y - ph.from.y) * 180) / Math.PI +
        this.gyroDrift; // 漂移注入直接反映在回報位姿
    }

    // IDENTIFY 完成 → 發布辨識結果（箱色/12球色排序）
    if (ph.state === "IDENTIFY" && u >= 1 && advance && !this.identified) {
      this.identified = true;
      d[RUN_K.boxOrder] = JSON.stringify(SIM_BOX_ORDER);
      d[RUN_K.ballColors] = JSON.stringify(SIM_BALL_COLORS);
    }

    if (u >= 1 && advance) {
      this.phaseIdx = (this.phaseIdx + 1) % MISSION.length;
      this.phaseT = 0;
      if (this.phaseIdx === 0) {
        // 任務重跑：歸位
        this.pose = { x: START.x, y: START.y, theta: 0 };
        this.replanCount = 0;
        this.missionT = 0;
        this.identified = false;
        d[RUN_K.boxOrder] = "[]";
        d[RUN_K.ballColors] = "[]";
      }
      if (MISSION[this.phaseIdx].to) this.planTimeMs = 4 + Math.random() * 8; // 段首規劃
    }

    // 剩餘路徑（導航段：目前位置 → 中繼點 → 終點，模擬 A* 折線）
    let path: number[][] = [];
    if (ph.to && (advance || faultPath)) {
      const mid = {
        x: (this.pose.x + ph.to.x) / 2 + 0.15 * Math.sin(this.t * 0.8),
        y: (this.pose.y + ph.to.y) / 2 - 0.12,
      };
      path = [
        [this.pose.x, this.pose.y],
        [mid.x, Math.max(0.25, mid.y)],
        [ph.to.x, ph.to.y],
      ];
    }

    d[SIM_K.poseX] = this.pose.x;
    d[SIM_K.poseY] = this.pose.y;
    d[SIM_K.poseTheta] = this.pose.theta;
    d[SIM_K.pathJson] = JSON.stringify(path);
    d[SIM_K.obstaclesJson] = JSON.stringify(this.obstacles);
    d[SIM_K.planTimeMs] = this.planTimeMs;
    d[SIM_K.replanCount] = this.replanCount;
    d[SIM_K.state] = state;
    d[SIM_K.currentCommand] = cmd;
    d[SIM_K.tripIndex] = ph.trip;
    d[RUN_K.matchTimer] = this.missionT;
  }

  // ── 系統健康（機器狀態燈牆 + 頂欄常駐）────────────────────
  private tickStatus(d: Record<string, NtValue>) {
    d[STATUS_K.battery] = 12.6 - this.t * 0.002 + (Math.random() - 0.5) * 0.05;
    d[STATUS_K.cpuTemp] = 55 + Math.sin(this.t * 0.05) * 5 + (Math.random() - 0.5);
    // 規劃耗時飆高時迴圈也跟著抖，這個關聯到場要認得出來
    d[STATUS_K.loopMs] = 20 + (this.planTimeMs > 20 ? 8 : 0) + (Math.random() - 0.5) * 2;
    d[STATUS_K.gyroOk] = this.params.get(SIM_K.faultGyro) !== true;
    d[STATUS_K.cameraOk] = this.params.get(SIM_K.faultVision) !== true;
  }

  // ── 初始化除錯子系統物理 ───────────────────────────────────
  private tickSubsystems(d: Record<string, NtValue>, dt: number) {
    // Z 軸：一階趨近 + 微小雜訊；上下極限開關由高度推導
    if (this.zMoving) {
      this.zHeight += (this.zTarget - this.zHeight) * Math.min(1, dt * 4);
      if (Math.abs(this.zTarget - this.zHeight) < 0.05) {
        this.zHeight = this.zTarget;
        this.zMoving = false;
        if (this.zTarget === 0) d[DBG_K.zHomed] = true;
      }
    }
    d[DBG_K.zHeight] = this.zHeight + (Math.random() - 0.5) * 0.02;
    d[DBG_K.zUpperLim] = this.zHeight >= Z_MAX_CM - 0.05;
    d[DBG_K.zLowerLim] = this.zHeight <= 0.05;

    // 底盤 jog：Enable 時積分里程計
    if (this.params.get(DBG_K.driveEnable) === true) {
      const vx = Number(this.params.get(DBG_K.driveVx)) || 0;
      const vy = Number(this.params.get(DBG_K.driveVy)) || 0;
      const om = Number(this.params.get(DBG_K.driveOmega)) || 0;
      d[DBG_K.odomX] = (Number(this.params.get(DBG_K.odomX)) || 0) + vx * dt;
      d[DBG_K.odomY] = (Number(this.params.get(DBG_K.odomY)) || 0) + vy * dt;
      d[DBG_K.odomTheta] = (Number(this.params.get(DBG_K.odomTheta)) || 0) + om * dt;
      this.params.set(DBG_K.odomX, d[DBG_K.odomX]);
      this.params.set(DBG_K.odomY, d[DBG_K.odomY]);
      this.params.set(DBG_K.odomTheta, d[DBG_K.odomTheta]);
    }

    // 黑線陣列：一條黑線週期性掃過 4 顆感測器（2 灰度 + 2 紅外線，索引 0-3）
    const faultLine = this.params.get(SIM_K.faultLine) === true;
    const center = ((this.t * 0.8) % 7) - 1.5; // 感測器索引空間
    for (let i = 0; i < NUM_LINE_SENSORS; i++) {
      if (faultLine && i === 1) {
        // 單顆失效：raw 貼 0（接線脫落），二值化恆 false
        d[lineRawKey(i)] = 0;
        d[lineBinKey(i)] = false;
        continue;
      }
      const dip = 600 * Math.exp(-((i - center) ** 2) / 0.8);
      const raw = 800 - dip + (Math.random() - 0.5) * 30;
      d[lineRawKey(i)] = raw;
      const th = Number(this.params.get(`${CONST_PREFIX}/lineSensor/thresholds/${i}`)) || 500;
      d[lineBinKey(i)] = raw < th;
    }
  }

  // ── 標定精靈 ───────────────────────────────────────────────
  private tickCalibrate(d: Record<string, NtValue>, dt: number) {
    if (this.lineCalT >= 0) {
      this.lineCalT += dt;
      if (this.lineCalT < 2.5) {
        d[CAL_K.lineStep] = "步驟 1/2：請將機器人放在純白區，採樣中…";
        d[CAL_K.lineProgress] = (this.lineCalT / 2.5) * 0.5;
      } else if (this.lineCalT < 5) {
        d[CAL_K.lineStep] = "步驟 2/2：請將機器人放到黑線上，採樣中…";
        d[CAL_K.lineProgress] = 0.5 + ((this.lineCalT - 2.5) / 2.5) * 0.5;
      } else {
        // 計算門檻 =（白均值 + 黑均值）/ 2，寫入常數表「草稿」（NT）
        for (let i = 0; i < NUM_LINE_SENSORS; i++) {
          const th = Math.round(490 + (Math.random() - 0.5) * 40);
          const key = `${CONST_PREFIX}/lineSensor/thresholds/${i}`;
          this.params.set(key, th);
          d[key] = th;
        }
        d[CAL_K.lineStep] = "完成，門檻已寫入常數表草稿 — 記得到常數表按「儲存到機器人」";
        d[CAL_K.lineProgress] = 1;
        d[CAL_K.lineContrastOk] = true;
        d[CAL_K.lineRun] = false;
        this.params.set(CAL_K.lineRun, false);
        this.lineCalT = -1;
      }
    }

    if (this.odomCalT >= 0 && !this.odomWaiting) {
      this.odomCalT += dt;
      if (this.odomCalT < 3) {
        d[CAL_K.odomStep] = "直線前進 2.0 m 中…（依編碼器積分）";
        d[CAL_K.odomProgress] = (this.odomCalT / 3) * 0.7;
      } else {
        d[CAL_K.odomStep] = "請用捲尺量實際位移，輸入 mm 後按「確認」";
        d[CAL_K.odomProgress] = 0.7;
        this.odomWaiting = true;
      }
    }
  }

  // ── 乒乓球定位假結果 ───────────────────────────────────────
  private tickVision(d: Record<string, NtValue>) {
    const lost = this.params.get(SIM_K.faultVision) === true;
    const hasBall = !lost && Math.sin(this.t * 0.4) > -0.85;
    const xNorm = Math.sin(this.t * 0.7) * 0.6;
    d[resultKey("HasBall")] = hasBall;
    // 模擬視為已校正（機器座標有意義）；實機是內參沒進來或該處深度無效才會是 false
    d[resultKey("WorldOk")] = hasBall;
    // 模擬成深度相機在線：有深度圖。多數幀深度實測，偶爾模擬球心破洞（量不到）→
    // 這時機器人會退用假定離地高度反投影，DepthMode 轉 false、距離標「推算」。
    const depthHole = Math.sin(this.t * 1.3) < -0.6; // 約 15% 的幀是破洞
    d[resultKey("HasDepth")] = true;
    d[resultKey("DepthMode")] = hasBall && !depthHole;
    // 深度圖分頁的色階說明會顯示這個讀數（畫面中央十字的取樣值），破洞時回 0
    d["/SmartDashboard/DepthCamera/CenterDepth_mm"] = depthHole ? 0 : 480 + Math.sin(this.t * 0.5) * 60;
    d[resultKey("XNorm")] = hasBall ? xNorm : 0;
    d[resultKey("DistMm")] = hasBall ? 400 + Math.sin(this.t * 0.3) * 150 : 0;
    d[resultKey("X_cm")] = hasBall ? -xNorm * 20 : 0;
    d[resultKey("Y_cm")] = hasBall ? 35 + Math.cos(this.t * 0.3) * 10 : 0;
    d[resultKey("RadiusPx")] = hasBall ? 40 + Math.sin(this.t) * 8 : 0;
    // 白/黃交替，讓顏色讀數在模擬下也會變（實機為 classifyColor 的結果）
    d[resultKey("Color")] = hasBall ? (Math.sin(this.t * 0.11) > 0 ? 2 : 1) : 0;
    const circles = hasBall ? Math.round(6 + Math.sin(this.t) * 3) : 0;
    d[resultKey("CircleCount")] = circles;
    d[resultKey("RawCircleCount")] = circles + (hasBall ? 4 : 0);
    d[resultKey("AgeFrames")] = 0;
  }

  // ── 點雲：4m × 3m 房間牆面 + 一個繞圈的圓柱障礙物 ─────────
  private publishPointCloud() {
    const pts: number[] = [];
    const rx = Math.sin(this.t * 0.15) * 0.8;
    const ry = Math.cos(this.t * 0.11) * 0.5;
    const addWallPoint = (wx: number, wy: number) => {
      pts.push(wx - rx + (Math.random() - 0.5) * 0.015);
      pts.push(wy - ry + (Math.random() - 0.5) * 0.015);
    };
    for (let i = 0; i <= 100; i++) {
      const f = i / 100;
      addWallPoint(-2 + 4 * f, 1.5);
      addWallPoint(-2 + 4 * f, -1.5);
      if (i <= 75) {
        addWallPoint(-2, -1.5 + 3 * (i / 75));
        addWallPoint(2, -1.5 + 3 * (i / 75));
      }
    }
    let ox = Math.cos(this.t * 0.5) * 1.0 - rx;
    let oy = Math.sin(this.t * 0.5) * 0.7 - ry;
    const od = Math.hypot(ox, oy);
    if (od < 0.6) {
      const push = od > 1e-6 ? 0.6 / od : 0;
      ox = push ? ox * push : 0.6;
      oy = push ? oy * push : 0;
    }
    for (let a = 0; a < Math.PI * 2; a += 0.12) {
      pts.push(ox + Math.cos(a) * 0.12 + (Math.random() - 0.5) * 0.01);
      pts.push(oy + Math.sin(a) * 0.12 + (Math.random() - 0.5) * 0.01);
    }
    store.setPointCloud(new Float32Array(pts));

    // 模擬機器人端的 TLS 擬合線段（通道 2）：貼在前牆(x=2)與左牆(y=1.5)上，
    // 套用與點雲相同的 rx/ry 位移，紅線就會剛好落在牆點上。純為 UI 驗證用。
    store.setFitLines(new Float32Array([
      2 - rx, -1.5 - ry, 2 - rx, 1.5 - ry,   // 前牆
      -2 - rx, 1.5 - ry, 2 - rx, 1.5 - ry,   // 左牆
    ]));

    // 模擬笛卡兒選點窗口（通道 3）：機器人端 kWallWindowWidthCm=80、kWallDepthHalfCm=15，
    // 換算成公尺就是沿牆 ±0.4、垂直牆 ±0.15。角點順序同機器人端（沿邊界繞一圈）。
    const HALF_W = 0.4;
    const HALF_D = 0.15;
    const fp = 2 - rx;    // 前牆 perpRef：n=(1,0), t=(0,1) → 角 = (perp, along)
    const lp = 1.5 - ry;  // 左牆 perpRef：n=(0,1), t=(-1,0) → 角 = (-along, perp)
    store.setFitWindows(new Float32Array([
      fp - HALF_D, -HALF_W, fp + HALF_D, -HALF_W, fp + HALF_D, HALF_W, fp - HALF_D, HALF_W,
      HALF_W, lp - HALF_D, HALF_W, lp + HALF_D, -HALF_W, lp + HALF_D, -HALF_W, lp - HALF_D,
    ]));
  }
}
