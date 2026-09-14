#!/usr/bin/env node
/**
 * fake-hub.mjs — 假 Control Hub（FGC 2026 機器人端橋接器模擬器）
 *
 * 讓儀表板前端可以完全離線開發：模擬真機 DashHub / DashWs / DashHttp / DashParams
 * 的兩個服務：
 *   8081  WebSocket（FTC SDK namespace 協定，namespace = "dash"）
 *   8080  HTTP（/dash/health、state.json、set、rec.json、rec.jsonl、
 *               stream.mjpg、snapshot.jpg，外加只有假伺服器才有的 mode / enabled）
 *
 * 純 Node ESM，唯一外部相依是 devDependency `ws`。
 *
 * 用法：node fake-hub.mjs [--http 8080] [--ws 8081] [--mode PIT|MATCH] [--no-rec]
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REC_DIR = path.join(__dirname, "fake-rec");
const TUNE_FILE = path.join(__dirname, "fake-tune.json");

// ── 指令列參數 ──────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const o = { http: 8080, ws: 8081, mode: "PIT", rec: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--http") o.http = Number(argv[++i]);
    else if (a === "--ws") o.ws = Number(argv[++i]);
    else if (a === "--mode") o.mode = String(argv[++i] || "").toUpperCase() === "MATCH" ? "MATCH" : "PIT";
    else if (a === "--no-rec") o.rec = false;
    else if (a === "--help" || a === "-h") o.help = true;
    else console.error(`[fake-hub] 忽略不認得的參數：${a}`);
  }
  if (!Number.isInteger(o.http) || o.http <= 0) o.http = 8080;
  if (!Number.isInteger(o.ws) || o.ws <= 0) o.ws = 8081;
  return o;
}

const ARGS = parseArgs(process.argv.slice(2));

if (ARGS.help) {
  console.log(`用法：node fake-hub.mjs [選項]

  --http <port>      HTTP 埠（預設 8080）
  --ws <port>        WebSocket 埠（預設 8081）
  --mode PIT|MATCH   啟動模式（預設 PIT）
  --no-rec           不要把這一場寫進 fake-rec/（只留記憶體 ring）
  -h, --help         顯示這段說明
`);
  process.exit(0);
}

// ── 小工具 ─────────────────────────────────────────────────────────────────

/** 可重現的偽亂數（產生離線錄影檔時要每次都一樣）。 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const round = (v, n) => {
  const p = Math.pow(10, n);
  const r = Math.round(v * p) / p;
  return Object.is(r, -0) ? 0 : r;
};

function stamp(d = new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-` +
    `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

// ── Bus：對應真機的 DashHub（latest + dirty）────────────────────────────────

class Bus {
  constructor() {
    this.latest = new Map();
    this.dirty = new Map();
  }

  /** 值型別只允許 number / boolean / string / string[]。 */
  put(k, v) {
    if (typeof k !== "string" || !k) return;
    if (typeof v === "number") {
      if (!Number.isFinite(v)) v = 0;
    } else if (Array.isArray(v)) {
      v = v.map(String);
    } else if (typeof v !== "boolean" && typeof v !== "string") {
      v = String(v);
    }
    const old = this.latest.get(k);
    if (old !== undefined && sameValue(old, v)) return;
    this.latest.set(k, v);
    this.dirty.set(k, v);
  }

  get(k) {
    return this.latest.get(k);
  }

  size() {
    return this.latest.size;
  }

  /** 取出並清空 dirty；沒東西回 null。 */
  drainDirty() {
    if (this.dirty.size === 0) return null;
    const out = Object.fromEntries(this.dirty);
    this.dirty.clear();
    return out;
  }

  snapshot() {
    return Object.fromEntries(this.latest);
  }

  snapshotJson() {
    return JSON.stringify(this.snapshot());
  }
}

function sameValue(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  return a === b;
}

/** {"k":..,"why":..} */
const errJson = (k, why) => JSON.stringify({ k: k == null ? "" : String(k), why: why == null ? "" : String(why) });
/** {"ok":bool,"why":str} */
const okJson = (ok, why) => JSON.stringify({ ok: !!ok, why: why == null ? "" : String(why) });

// ── Params：對應真機的 DashParams（白名單 / min / max 抄自 DashParams.java）──

const TUNE_PREFIX = "/FGC/Tune/";
const PARAM_PREFIX = "/FGC/Param/";

// [名稱, 型別, min, max, 預設值（抄自 Constants.java）]
const PARAM_DEFS = [
  ["DEADZONE", "num", 0.0, 0.4, 0.06],
  ["TURN_SCALE", "num", 0.0, 1.0, 0.8],
  ["VEL_SL", "num", 0.0, 3000.0, 1900],
  ["VEL_SR", "num", 0.0, 3000.0, 1900],
  ["IDLE_TPS", "num", 0.0, 3000.0, 0],
  ["EJECT_VEL", "num", 0.0, 3000.0, 1600],
  ["WAIT_SPINUP", "bool", 0.0, 1.0, true],
  ["FEED_THRESHOLD", "num", 0.0, 3000.0, 1200],
  ["WAY_TPS", "num", 0.0, 3000.0, 1800],
  ["WAY_IDLE_TPS", "num", 0.0, 3000.0, 400],
  ["INTAKE_COLLECT", "num", 0.0, 1.0, 1.0],
  ["INTAKE_SHOOT", "num", 0.0, 1.0, 1.0],
  ["CLIMB", "num", 0.0, 1.0, 1.0],
  ["HOLD", "num", 0.0, 1.0, 0.6],
  ["HOPPER_POWER", "num", 0.0, 1.0, 1],
  ["OPEN_STOW_DEG", "num", 0.0, 270.0, 0],
  ["OPEN_DEPLOY_DEG", "num", 0.0, 270.0, 120],
  ["TAG_DECIMATION", "num", 1.0, 8.0, 2],
  ["TAG_MIN_MARGIN", "num", 0.0, 200.0, 30],
  ["AIM_KP", "num", 0.0, 0.2, 0.01],
  ["AIM_MAX", "num", 0.0, 1.0, 0.3],
  ["MJPEG_FPS", "num", 1.0, 30.0, 10],
  ["MJPEG_Q", "num", 5.0, 95.0, 40],
];

/** 與 Java DashParams.fmt() 一致：整數不留小數，其餘四位。 */
function fmtParam(v) {
  if (v === Math.round(v) && Math.abs(v) < 1e9) return String(Math.trunc(v));
  return v.toFixed(4);
}

function createParams(bus) {
  const values = new Map();
  for (const [name, kind, , , def] of PARAM_DEFS) {
    values.set(name, kind === "bool" ? (def ? 1 : 0) : Number(def));
  }

  const indexOf = (key) => {
    if (typeof key !== "string") return -1;
    let n = key;
    if (n.startsWith(TUNE_PREFIX)) n = n.slice(TUNE_PREFIX.length);
    if (n.startsWith(PARAM_PREFIX)) n = n.slice(PARAM_PREFIX.length);
    return PARAM_DEFS.findIndex((d) => d[0] === n);
  };

  const api = {
    names: () => PARAM_DEFS.map((d) => d[0]),
    /** 數值讀取（bool 以 1/0 表示）。 */
    read(name) {
      return values.get(name) ?? 0;
    },
    /** 給模擬器用的方便讀取器。 */
    num(name) {
      return values.get(name) ?? 0;
    },
    bool(name) {
      return (values.get(name) ?? 0) >= 0.5;
    },

    publishOne(i) {
      const [name, kind] = PARAM_DEFS[i];
      const v = values.get(name);
      if (kind === "bool") {
        bus.put(TUNE_PREFIX + name, v >= 0.5);
        bus.put(PARAM_PREFIX + name, v >= 0.5);
      } else {
        bus.put(TUNE_PREFIX + name, v);
        bus.put(PARAM_PREFIX + name, v);
      }
    },

    publishAll() {
      for (let i = 0; i < PARAM_DEFS.length; i++) api.publishOne(i);
      bus.put(PARAM_PREFIX + "_Snippet", api.snippet());
      api.publishBuild();
    },

    /**
     * 編譯值（機器人端待補的 P1 改動：/FGC/Param/Build <NAME> × 21，hello 時送一次）。
     * 刻意讀 PARAM_DEFS 的預設而不是目前值 —— 這一欄的意義就是「Restart Robot
     * 之後會回到哪裡」，跟著 set 一起動就完全沒有用了。
     */
    publishBuild() {
      for (const [name, kind, , , def] of PARAM_DEFS) {
        bus.put(PARAM_PREFIX + "Build " + name, kind === "bool" ? Boolean(def) : Number(def));
      }
    },

    /** 可直接貼回 Constants.java 的片段（與 Java DashParams.snippet() 同格式）。 */
    snippet() {
      let s = "// fgc-tune snippet\n";
      for (const [name, kind] of PARAM_DEFS) {
        const v = values.get(name);
        if (kind === "bool") s += `public static volatile boolean ${name} = ${v >= 0.5 ? "true" : "false"};\n`;
        else s += `public static volatile double ${name} = ${fmtParam(v)};\n`;
      }
      return s;
    },

    /**
     * 套用一筆設定。成功回 null，失敗回拒絕原因（ASCII，與真機一致）。
     * rawValue 允許 "1900" / "true" / "false"，也允許已經是 number / boolean。
     */
    apply(key, rawValue, { pit = true } = {}) {
      if (!pit) return api.reject(key, "MATCH mode: writes are rejected");
      const i = indexOf(key);
      if (i < 0) return api.reject(key, "unknown key");
      const [name, kind, min, max] = PARAM_DEFS[i];

      let s;
      if (typeof rawValue === "boolean") s = rawValue ? "true" : "false";
      else if (typeof rawValue === "number") s = String(rawValue);
      else s = rawValue == null ? "" : String(rawValue);
      s = s.trim();
      if (s.length === 0) return api.reject(key, "empty value");

      let v;
      if (kind === "bool") {
        if (/^true$/i.test(s) || s === "1") v = 1;
        else if (/^false$/i.test(s) || s === "0") v = 0;
        else return api.reject(key, "not a boolean");
      } else {
        v = Number(s);
        if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s) || Number.isNaN(v)) return api.reject(key, "not a number");
        if (!Number.isFinite(v)) return api.reject(key, "not finite");
        if (v < min || v > max) return api.reject(key, `out of range ${fmtParam(min)}..${fmtParam(max)}`);
      }

      values.set(name, v);
      api.publishOne(i);
      bus.put("/FGC/Bridge/Last Set", `${name}=${fmtParam(values.get(name))}`);
      return null;
    },

    reject(key, why) {
      bus.put("/FGC/Bridge/Last Set Rejected", `${key == null ? "?" : key}: ${why}`);
      return why;
    },

    /** 存到 fake-tune.json；成功回 null。 */
    save() {
      try {
        const o = {};
        for (const [name, kind] of PARAM_DEFS) {
          const v = values.get(name);
          o[name] = kind === "bool" ? v >= 0.5 : v;
        }
        fs.writeFileSync(TUNE_FILE, JSON.stringify(o, null, 2), "utf8");
        bus.put("/FGC/Param/_Saved", path.basename(TUNE_FILE));
        return null;
      } catch (e) {
        lastError(`param save: ${e}`);
        return String(e);
      }
    },

    /** 從 fake-tune.json 讀；檔案不存在也算成功。 */
    load() {
      try {
        if (!fs.existsSync(TUNE_FILE)) return null;
        const o = JSON.parse(fs.readFileSync(TUNE_FILE, "utf8"));
        if (!o || typeof o !== "object" || Array.isArray(o)) return "bad json";
        for (let i = 0; i < PARAM_DEFS.length; i++) {
          const [name, kind, min, max] = PARAM_DEFS[i];
          if (!(name in o)) continue;
          const raw = o[name];
          let v = typeof raw === "boolean" ? (raw ? 1 : 0) : Number(raw);
          if (!Number.isFinite(v)) continue;
          if (kind !== "bool" && (v < min || v > max)) continue; // 檔案裡的爛值一律忽略
          values.set(name, v);
        }
        api.publishAll();
        return null;
      } catch (e) {
        lastError(`param load: ${e}`);
        return String(e);
      }
    },
  };

  return api;
}

// ── Sim：20 Hz 模擬駕駛 + 各子系統 ──────────────────────────────────────────

const ST = { COLLECT: "COLLECT", SHOOT: "SHOOT", EJECT: "EJECT" };

/** loop 尾端統計的環（FGC2026_TeleOp_Match.java:93-94 的同一組常數）。 */
const LOOP_WIN = 200;
const LOOP_EVERY = 20;

class Sim {
  constructor(bus, params, seed = 20260906) {
    this.bus = bus;
    this.p = params;
    this.rng = mulberry32(seed);
    this.t = 0;

    // loop 尾端統計（真機是每一圈都進 ring，這裡的一個 tick 就是一圈）
    this.loopRing = new Float64Array(LOOP_WIN);
    this.loopIdx = 0;
    this.loopCount = 0;
    this.loopSince = 0;

    // 驅動狀態
    this.state = ST.COLLECT;
    this.prevState = ST.COLLECT;
    this.reversed = true;
    this.cycle = -1;
    this.ejectFrom = 1e9;
    this.ejectTo = -1;
    this.squareUntil = -1;

    // 射手
    this.velL = 0;
    this.velR = 0;
    this.way = 0;
    this.atSpeed = false;
    this.shootStart = -1;
    this.spinupMs = 0;
    this.ballsLeft = 0;
    this.nextBall = 1e9;
    this.ballFlash = 0;
    this.curTick = 0;
    this.curL = 0;
    this.curWay = 0;
    this.curR = 0;

    // 爬升 / 球倉
    this.climbPos = 0;
    this.climbUntil = -1;
    this.climbDir = 0;
    this.nextClimb = 6 + this.rng() * 6;
    this.hopperUntil = -1;
    this.hopperDir = 0;
    this.nextHopper = 4 + this.rng() * 5;

    // 電池 / 迴圈
    this.batt = 12.9;
    this.sag = 0;

    // 視覺
    this.visible = true;
    this.hideUntil = -1;
    this.nextHide = 7 + this.rng() * 6;
    this.age = 0;

    // 其他
    this.probe = -1;
    this.lastVisionPublished = false;
  }

  /** dt 秒。pit=false 時不發布 Vision（真機 MATCH 不開相機）。 */
  step(dt, pit) {
    const bus = this.bus;
    const p = this.p;
    const rng = this.rng;
    this.t += dt;
    const t = this.t;

    // ── 比賽節奏：每 8 秒一輪，前 4 秒 COLLECT、後 4 秒 SHOOT，偶爾 EJECT ──
    const cyc = Math.floor(t / 8);
    if (cyc !== this.cycle) {
      this.cycle = cyc;
      if (rng() < 0.25) {
        this.ejectFrom = cyc * 8 + 1.0 + rng() * 1.5;
        this.ejectTo = this.ejectFrom + 0.7 + rng() * 0.5;
      } else {
        this.ejectFrom = 1e9;
        this.ejectTo = -1;
      }
      if (rng() < 0.2) {
        this.reversed = !this.reversed;
        this.squareUntil = t + 0.12;
      }
    }

    const inShootWindow = t % 8 >= 4;
    let want;
    if (t >= this.ejectFrom && t < this.ejectTo) want = ST.EJECT;
    else want = inShootWindow ? ST.SHOOT : ST.COLLECT;

    if (want !== this.state) {
      if (want === ST.SHOOT) {
        this.shootStart = t;
        this.spinupMs = 0;
        this.atSpeed = false;
        this.ballsLeft = 3 + Math.floor(rng() * 3); // 3~5 顆
        this.nextBall = 1e9;
      }
      this.prevState = this.state;
      this.state = want;
    }

    // ── 搖桿（模擬駕駛：兩個低頻正弦疊加，看起來像人在推）──
    const rawLy = clamp(-(0.55 * Math.sin(t * 0.9) + 0.3 * Math.sin(t * 0.31 + 1.2)), -1, 1);
    const rawRx = clamp(0.5 * Math.sin(t * 0.62 + 0.4) + 0.22 * Math.sin(t * 1.7), -1, 1);
    const dz = p.num("DEADZONE");
    const shape = (v) => (Math.abs(v) < dz ? 0 : v * Math.abs(v)); // 與 DriveSystem.shape 同精神
    let forward = shape(-rawLy);
    const turn = shape(rawRx) * p.num("TURN_SCALE");
    if (this.reversed) forward = -forward;

    bus.put("/FGC/Gamepad/LY", round(rawLy, 3));
    bus.put("/FGC/Gamepad/RX", round(rawRx, 3));
    bus.put("/FGC/Gamepad/RT", this.state === ST.SHOOT ? 1 : 0);
    bus.put("/FGC/Gamepad/LT", this.state === ST.COLLECT ? 1 : 0);
    bus.put("/FGC/Gamepad/Cross", this.state === ST.EJECT);
    bus.put("/FGC/Gamepad/Square", t < this.squareUntil);

    bus.put("/FGC/Drive/Forward", round(forward, 3));
    bus.put("/FGC/Drive/Turn", round(turn, 3));
    bus.put("/FGC/Drive/Reversed", this.reversed);
    bus.put("/FGC/Drive/State", this.state);
    bus.put("/FGC/Drive/ClimbMode", false); // 假 Hub 不模擬爬升模式

    // ── 射手：一階上升（tau 0.35 s）+ 餵球造成的 dip ──
    const tau = 0.35;
    const alpha = 1 - Math.exp(-dt / tau);
    let tgtL, tgtR, tgtWay;
    if (this.state === ST.SHOOT) {
      tgtL = p.num("VEL_SL");
      tgtR = p.num("VEL_SR");
    } else if (this.state === ST.EJECT) {
      tgtL = -p.num("EJECT_VEL");
      tgtR = -p.num("EJECT_VEL");
    } else {
      tgtL = p.num("IDLE_TPS");
      tgtR = p.num("IDLE_TPS");
    }

    this.velL += (tgtL - this.velL) * alpha;
    this.velR += (tgtR - this.velR) * alpha;

    const feedTh = p.num("FEED_THRESHOLD");
    const nowAtSpeed = this.velL > feedTh && this.velR > feedTh;
    if (this.state === ST.SHOOT) {
      if (nowAtSpeed && !this.atSpeed) {
        this.spinupMs = Math.max(0, Math.round((t - this.shootStart) * 1000));
        this.nextBall = t + 0.15;
      }
      this.atSpeed = nowAtSpeed;
      const feeding = this.atSpeed || !p.bool("WAIT_SPINUP");
      tgtWay = feeding ? p.num("WAY_TPS") : 0;
      if (feeding && this.ballsLeft > 0 && t >= this.nextBall) {
        this.ballsLeft--;
        this.velL -= 250;
        this.velR -= 250;
        this.ballFlash = t + 0.12;
        this.nextBall = t + 0.62 + rng() * 0.3;
      }
    } else {
      this.atSpeed = false;
      tgtWay = this.state === ST.EJECT ? -p.num("WAY_TPS") : -p.num("WAY_IDLE_TPS");
    }
    this.way += (tgtWay - this.way) * (1 - Math.exp(-dt / 0.2));

    // 一點量測雜訊
    const nL = this.velL + (rng() - 0.5) * 12;
    const nR = this.velR + (rng() - 0.5) * 12;

    bus.put("/FGC/Shooter/SL", round(nL, 1));
    bus.put("/FGC/Shooter/SR", round(nR, 1));
    bus.put("/FGC/Shooter/Way", round(this.way, 1));
    bus.put("/FGC/Shooter/TargetL", p.num("VEL_SL"));
    bus.put("/FGC/Shooter/TargetR", p.num("VEL_SR"));
    bus.put("/FGC/Shooter/AtSpeed", this.atSpeed);
    bus.put("/FGC/Shooter/SpinupMs", this.spinupMs);

    // 電流：不在 bulk cache 裡，真機每 5 圈才讀一次（≈4 Hz）
    this.curTick++;
    if (this.curTick % 5 === 0) {
      const load = Math.abs(this.velL) / 1900;
      const kick = t < this.ballFlash ? 3.2 : 0;
      this.curL = clamp(0.9 + load * 4.2 + kick + (rng() - 0.5) * 0.5, 0, 20);
      this.curR = clamp(0.9 + (Math.abs(this.velR) / 1900) * 4.2 + kick + (rng() - 0.5) * 0.5, 0, 20);
      // 送料馬達：餵球的那一下最吃電，卡球時 isOverCurrent 會拉起來
      this.curWay = clamp(0.5 + (Math.abs(this.way) / 1800) * 3.4 + kick * 1.5 + (rng() - 0.5) * 0.6, 0, 25);
      bus.put("/FGC/Shooter/CurrentL", round(this.curL, 2));
      bus.put("/FGC/Shooter/CurrentR", round(this.curR, 2));
      bus.put("/FGC/Shooter/CurrentWay", round(this.curWay, 2));
      // 真機 FGC2026_TeleOp_Match.java:574-576 有這三個 isOverCurrent 埋點
      bus.put("/FGC/Shooter/OverCurrentL", this.curL > 9);
      bus.put("/FGC/Shooter/OverCurrentR", this.curR > 9);
      bus.put("/FGC/Shooter/OverCurrentWay", this.curWay > 8.2);
    }

    // ── Intake ──
    let intake = 0;
    if (this.state === ST.SHOOT) intake = p.num("INTAKE_SHOOT");
    else if (this.state === ST.COLLECT) intake = p.num("INTAKE_COLLECT");
    bus.put("/FGC/Intake/Power", round(intake, 3));

    // ── 爬升 ──
    if (this.climbUntil < t && t >= this.nextClimb) {
      this.climbDir = rng() < 0.65 ? 1 : -1;
      this.climbUntil = t + 1.0 + rng() * 1.2;
      this.nextClimb = this.climbUntil + 8 + rng() * 8;
    }
    const climbing = t < this.climbUntil;
    if (climbing) this.climbPos = clamp(this.climbPos + this.climbDir * 900 * dt, 0, 4000);
    const climbCur = climbing ? 3.4 + (rng() - 0.5) * 0.6 : this.climbPos > 5 ? 1.1 + (rng() - 0.5) * 0.25 : 0.05;
    bus.put("/FGC/Climb/Pos", round(this.climbPos, 0));
    bus.put("/FGC/Climb/Holding", !climbing && this.climbPos > 5);
    bus.put("/FGC/Climb/Current", round(climbCur, 2));
    bus.put("/FGC/Climb/OverCurrent", climbCur > 5); // 真機 :581
    bus.put("/FGC/Gamepad/DUp", climbing && this.climbDir > 0);
    bus.put("/FGC/Gamepad/DDown", climbing && this.climbDir < 0);

    // ── 球倉 ──
    if (this.hopperUntil < t && t >= this.nextHopper) {
      this.hopperDir = rng() < 0.5 ? 1 : -1;
      this.hopperUntil = t + 0.5 + rng() * 0.4;
      this.nextHopper = this.hopperUntil + 5 + rng() * 6;
    }
    const hopperOn = t < this.hopperUntil;
    const hopperCmd = !hopperOn ? "STOP" : this.hopperDir > 0 ? "OPEN" : "CLOSE";
    bus.put("/FGC/Hopper/Cmd", hopperCmd);
    bus.put("/FGC/Hopper/Deploy", "DEPLOYED"); // 假 Hub 只模擬 RUN：open 伺服已放下
    bus.put("/FGC/Hopper/OpenDeg", 120);
    bus.put("/FGC/Gamepad/R1", hopperOn && this.hopperDir > 0);
    bus.put("/FGC/Gamepad/L1", hopperOn && this.hopperDir < 0);

    // ── 電池 / 迴圈時間 ──
    const draw = this.curL + this.curR + (climbing ? 6 : 0) + Math.abs(forward) * 3;
    this.sag += (draw * 0.055 - this.sag) * (1 - Math.exp(-dt / 0.25));
    this.batt = 12.9 - (t / 60) * 0.035; // 隨時間緩降
    const battV = clamp(this.batt - this.sag + (rng() - 0.5) * 0.02, 10.5, 13.2);
    bus.put("/FGC/Status/Battery V", round(battV, 2));

    const spike = rng() < 0.015;
    const loopMs = spike ? 38 + rng() * 6 : 20 + (rng() - 0.5) * 6;
    bus.put("/FGC/Status/Loop ms", round(loopMs, 1));
    // 機器人端算好的尾端統計。真機每圈都進 ring（LOOP_WIN），每 LOOP_EVERY 圈
    // 發一次 nearest-rank p95 與 Max——前端一定要用這兩個而不是自己拿 20 Hz 的
    // Loop ms 取樣去算（那份樣本結構性地看不到尾端）。假伺服器的 tick 就是「一圈」，
    // 所以這裡照抄同一套：ring + arraycopy + sort + ceil(0.95n)-1。
    this.loopRing[this.loopIdx] = loopMs;
    this.loopIdx = (this.loopIdx + 1) % LOOP_WIN;
    if (this.loopCount < LOOP_WIN) this.loopCount++;
    if (++this.loopSince >= LOOP_EVERY) {
      this.loopSince = 0;
      const n = this.loopCount;
      const sorted = this.loopRing.slice(0, n).sort((a, b) => a - b);
      let rank = Math.ceil(0.95 * n) - 1;
      if (rank < 0) rank = 0;
      if (rank >= n) rank = n - 1;
      bus.put("/FGC/Status/Loop p95", round(sorted[rank], 1));
      bus.put("/FGC/Status/Loop Max", round(sorted[n - 1], 1));
    }
    // 真機送的是 (now - t0) / 1000.0 這個原始 double（FGC2026_TeleOp_Match.java:600），
    // 所以它每一圈都變、必進 dirty、每一批 nt 都帶著它——整份規格的時間基準就建立在
    // 這個不變式上（§0）。原本這裡 round(t, 1) 讓 50 ms 週期有一半的批次「值沒變」，
    // diff 推播就不送它，前端只好退回本機時鐘並把整份 log 標成 t=client。
    bus.put("/FGC/Status/Match s", round(t, 3));

    // ── 視覺（PIT 才有）──
    if (pit) {
      if (!this.lastVisionPublished) {
        bus.put("/FGC/Vision/CamState", "STREAMING");
        this.lastVisionPublished = true;
      }
      if (this.hideUntil < t && t >= this.nextHide) {
        this.hideUntil = t + 1.2 + rng() * 1.3;
        this.nextHide = this.hideUntil + 8 + rng() * 6;
      }
      this.visible = t >= this.hideUntil;
      if (this.visible) this.age = 0.0 + rng() * 0.05;
      else this.age += dt;

      const range = 3.25 + 1.25 * Math.sin(t * 0.21 + 0.7);
      const bearing = 12 * Math.sin(t * 0.33) + (rng() - 0.5) * 0.6;
      const yaw = -18 * Math.sin(t * 0.17 + 0.9) + (rng() - 0.5) * 0.8;
      const margin = 48 + 14 * Math.sin(t * 0.5) + (rng() - 0.5) * 4;

      bus.put("/FGC/Vision/Count", this.visible ? 1 : 0);
      bus.put("/FGC/Vision/FPS", round(14.5 + (rng() - 0.5) * 1.6, 1));
      bus.put("/FGC/Vision/Best/Age s", round(this.age, 2));
      if (this.visible) {
        bus.put("/FGC/Vision/Best/Id", 102);
        bus.put("/FGC/Vision/Best/Range m", round(range, 3));
        bus.put("/FGC/Vision/Best/Bearing deg", round(bearing, 2));
        bus.put("/FGC/Vision/Best/Yaw deg", round(yaw, 2));
        bus.put("/FGC/Vision/Best/Margin", round(margin, 1));
        bus.put("/FGC/Vision/Tags", [
          JSON.stringify({ id: 102, r: round(range, 3), b: round(bearing, 2), y: round(yaw, 2), m: round(margin, 1) }),
        ]);
      } else {
        bus.put("/FGC/Vision/Tags", []);
      }
    } else if (this.lastVisionPublished) {
      bus.put("/FGC/Vision/CamState", "CLOSED");
      bus.put("/FGC/Vision/Count", 0);
      bus.put("/FGC/Vision/FPS", 0);
      this.lastVisionPublished = false;
    }

    // ── 探針：每秒 +1 ──
    const sec = Math.floor(t);
    if (sec !== this.probe) {
      this.probe = sec;
      bus.put("/FGC/Probe/Counter", sec);
    }
  }
}

// ── 錄影（記憶體 ring + fake-rec/*.jsonl）───────────────────────────

const MAX_LINES = 6000;

class Rec {
  constructor(dir, { write = true } = {}) {
    this.dir = dir;
    this.write = write;
    this.ring = [];
    this.pending = [];
    this.lines = 0;
    this.file = null;
    this.t0 = Date.now();
    this.lastFlush = Date.now();
  }

  addLine(d) {
    if (!d) return;
    const t = Math.max(0, (Date.now() - this.t0) / 1000);
    const line = `{"t":${t.toFixed(3)},"d":${JSON.stringify(d)}}`;
    this.ring.push(line);
    if (this.ring.length > MAX_LINES) this.ring.splice(0, this.ring.length - MAX_LINES);
    if (this.write) this.pending.push(line);
  }

  currentName() {
    return this.file ? path.basename(this.file) : "";
  }

  flush() {
    this.lastFlush = Date.now();
    if (!this.write || this.pending.length === 0) return;
    try {
      if (!fs.existsSync(this.dir)) fs.mkdirSync(this.dir, { recursive: true });
      if (!this.file) this.file = path.join(this.dir, `rec-${stamp()}.jsonl`);
      const chunk = this.pending.splice(0, this.pending.length);
      fs.appendFileSync(this.file, chunk.join("\n") + "\n", "utf8");
      this.lines += chunk.length;
    } catch (e) {
      this.pending.length = 0;
      lastError(`rec flush: ${e}`);
    }
  }

  ringText() {
    return this.ring.length ? this.ring.join("\n") + "\n" : "";
  }

  flushAgeS() {
    return (Date.now() - this.lastFlush) / 1000;
  }
}

/** 檔名安全檢查：只允許 rec-*.jsonl（與 DashRec.safeName 一致）。 */
function safeName(name) {
  if (!name || name.length > 64) return false;
  if (name.includes("/") || name.includes("\\") || name.includes("..")) return false;
  return name.startsWith("rec-") && name.endsWith(".jsonl");
}

const lineCountCache = new Map(); // name -> {size, mtime, lines}

function countLines(file, st) {
  const key = file;
  const hit = lineCountCache.get(key);
  if (hit && hit.size === st.size && hit.mtime === st.mtimeMs) return hit.lines;
  let lines = 0;
  try {
    const buf = fs.readFileSync(file);
    for (let i = 0; i < buf.length; i++) if (buf[i] === 10) lines++;
  } catch {
    lines = 0;
  }
  lineCountCache.set(key, { size: st.size, mtime: st.mtimeMs, lines });
  return lines;
}

function listRecFiles() {
  const out = [];
  try {
    if (!fs.existsSync(REC_DIR)) return out;
    for (const name of fs.readdirSync(REC_DIR)) {
      if (!name.endsWith(".jsonl")) continue;
      const full = path.join(REC_DIR, name);
      let st;
      try {
        st = fs.statSync(full);
      } catch {
        continue;
      }
      if (!st.isFile()) continue;
      out.push({ name, size: st.size, lines: countLines(full, st), mtime: Math.round(st.mtimeMs) });
    }
  } catch (e) {
    lastError(`rec list: ${e}`);
  }
  out.sort((a, b) => b.mtime - a.mtime || (a.name < b.name ? 1 : -1));
  return out;
}

/** 啟動時若 fake-rec/ 是空的，就用同一套產生器離線寫兩個 150 秒的假錄影檔。 */
function ensureFakeRecordings() {
  if (!fs.existsSync(REC_DIR)) fs.mkdirSync(REC_DIR, { recursive: true });
  const existing = fs.readdirSync(REC_DIR).filter((n) => n.endsWith(".jsonl"));
  if (existing.length > 0) return [];

  const made = [];
  const now = Date.now();
  for (let n = 0; n < 2; n++) {
    const bus = new Bus();
    const params = createParams(bus);
    seedStatic(bus, "PIT");
    params.publishAll();
    const sim = new Sim(bus, params, 20260906 + n * 7919);

    const dt = 0.05;
    const steps = Math.round(150 / dt);
    const lines = [];
    for (let i = 0; i < steps; i++) {
      sim.step(dt, true);
      bus.put("/FGC/Bridge/Viewers", 1);
      bus.put("/FGC/Rec/Lines", lines.length);
      const d = bus.drainDirty();
      if (!d) continue;
      lines.push(`{"t":${(i * dt).toFixed(3)},"d":${JSON.stringify(d)}}`);
    }
    const when = new Date(now - (2 - n) * 11 * 60 * 1000);
    const name = `rec-${stamp(when)}.jsonl`;
    const full = path.join(REC_DIR, name);
    fs.writeFileSync(full, lines.join("\n") + "\n", "utf8");
    fs.utimesSync(full, when, when);
    made.push({ name, lines: lines.length, bytes: fs.statSync(full).size });
  }
  return made;
}

// ── 4 張內建 JPEG（64×48 純色 + 一個會移動的小方塊）────────────────────────

const FRAME_B64 = [
  "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",
];
const FRAMES = FRAME_B64.map((b) => Buffer.from(b, "base64"));

// ── 全域執行期狀態 ─────────────────────────────────────────────────────────

const BUILD_TAG = `fake-hub ${stamp()}`;
const bus = new Bus();
const params = createParams(bus);

let mode = ARGS.mode; // "PIT" | "MATCH"
let enabled = true;
let mjpegBusy = false;
let genCounter = 1;

const pit = () => mode === "PIT";

function lastError(why) {
  try {
    bus.put("/FGC/Bridge/Last Error", String(why == null ? "" : why).slice(0, 300));
  } catch {
    /* 錯誤路徑不准再丟錯 */
  }
}

/** 開機埋點（離線產生錄影檔時也會用到）。 */
function seedStatic(b, m) {
  b.put("/FGC/Bridge/Build", BUILD_TAG);
  b.put("/FGC/Bridge/Gen", 1);
  b.put("/FGC/Bridge/Threads", 1);
  b.put("/FGC/Bridge/Viewers", 0);
  b.put("/FGC/Bridge/Mode", m);
  b.put("/FGC/Bridge/Enabled", true);
  b.put("/FGC/Bridge/Camera", true);
  b.put("/FGC/Bridge/Last Set", "");
  b.put("/FGC/Bridge/Last Set Rejected", "");
  b.put("/FGC/Bridge/Last Error", "");
  b.put("/FGC/Status/OpMode", m === "PIT" ? "B1-PIT" : "A1-MATCH");
  if (m !== "PIT") {
    // MATCH 不開相機：跟 PIT→MATCH 切換後的狀態一致
    b.put("/FGC/Vision/CamState", "CLOSED");
    b.put("/FGC/Vision/Count", 0);
    b.put("/FGC/Vision/FPS", 0);
  }
  b.put("/FGC/Rec/File", "");
  b.put("/FGC/Rec/Lines", 0);
  b.put("/FGC/Rec/Flush Age s", 0);
  b.put("/CameraPublisher/C270/streams", [`mjpg:http://127.0.0.1:${ARGS.http}/dash/stream.mjpg`]);
}

const rec = new Rec(REC_DIR, { write: ARGS.rec });
seedStatic(bus, mode);
params.load();
params.publishAll();
const sim = new Sim(bus, params, 20260906);

// ── WebSocket（8081，SDK namespace 協定）───────────────────────────────────

const NS = "dash";
const subs = new Set(); // 已訂閱 dash namespace 的 socket
const inbox = []; // 待處理的 set 指令（模擬 DashHub.inbox，由推播迴圈消化）

function envelope(type, payload) {
  return JSON.stringify({ namespace: NS, type, payload });
}

function sendTo(ws, type, payload) {
  if (!ws || ws.readyState !== ws.OPEN) return;
  try {
    ws.send(envelope(type, payload));
  } catch {
    subs.delete(ws);
  }
}

function broadcast(type, payload) {
  for (const ws of subs) sendTo(ws, type, payload);
}

/**
 * hello。PIT 是全量 snapshot；**MATCH 只送 /FGC/Bridge/* 白名單 + OpMode**，
 * 並強制帶上 Mode=MATCH（DashHub.java:284-296 helloJson）。
 *
 * 以前這裡不分模式一律回全量快照，等於 MATCH 期間只要送一則 hello/sync 就能把
 * 整份比賽遙測要回來——那是假伺服器獨有的漏洞，真機沒有。
 */
function helloTo(ws) {
  if (pit()) {
    sendTo(ws, "hello", bus.snapshotJson());
    return;
  }
  const m = {};
  for (const [k, v] of bus.latest) {
    if (k.startsWith("/FGC/Bridge/") || k === "/FGC/Status/OpMode") m[k] = v;
  }
  m["/FGC/Bridge/Mode"] = "MATCH";
  sendTo(ws, "hello", JSON.stringify(m));
}

const wss = new WebSocketServer({ port: ARGS.ws });

wss.on("connection", (ws) => {
  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return; // 壞封包直接忽略（SDK 也不會回錯）
    }
    if (!msg || typeof msg !== "object") return;
    const ns = msg.namespace;
    const type = msg.type;
    const payload = msg.payload;

    if (ns === "system") {
      if (type === "subscribeToNamespace") {
        let want = payload;
        if (typeof want === "string" && want.trim().startsWith("{")) {
          try {
            want = JSON.parse(want).namespace;
          } catch {
            /* 保持原字串 */
          }
        }
        // 訂閱未註冊的 namespace：SDK 不回錯，我們也不回
        if (want !== NS) return;
        subs.add(ws);
        bus.put("/FGC/Bridge/Viewers", subs.size);
        helloTo(ws);
        return;
      }
      if (type === "unsubscribeFromNamespace") {
        subs.delete(ws);
        bus.put("/FGC/Bridge/Viewers", subs.size);
      }
      return;
    }

    if (ns !== NS) return; // 沒訂閱 / 不認得的 namespace：不回應

    if (type === "set") {
      if (!pit()) {
        bus.put("/FGC/Bridge/Last Set Rejected", "MATCH mode");
        sendTo(ws, "err", errJson("", "MATCH mode: writes are rejected"));
        return;
      }
      if (inbox.length >= 64) return; // 沒人處理時別無限長大
      inbox.push(typeof payload === "string" ? payload : JSON.stringify(payload));
      return;
    }
    if (type === "hello" || type === "sync") {
      helloTo(ws);
    }
  });

  ws.on("close", () => {
    if (subs.delete(ws)) bus.put("/FGC/Bridge/Viewers", subs.size);
  });
  ws.on("error", () => {
    if (subs.delete(ws)) bus.put("/FGC/Bridge/Viewers", subs.size);
  });
});

/** 消化 inbox（對應 DashParams.drainInbox）。 */
function drainInbox() {
  for (let guard = 0; guard < 64 && inbox.length; guard++) {
    const raw = inbox.shift();
    let k = null;
    try {
      const o = JSON.parse(raw);
      if (!o || typeof o !== "object" || Array.isArray(o)) {
        broadcast("err", errJson("", "bad payload"));
        continue;
      }
      if (!("k" in o) || !("v" in o)) {
        broadcast("err", errJson("", "missing k or v"));
        continue;
      }
      k = String(o.k);
      const why = params.apply(k, o.v, { pit: pit() });
      if (why !== null) broadcast("err", errJson(k, why));
    } catch (e) {
      broadcast("err", errJson(k ?? "", `parse: ${e}`));
    }
  }
}

// ── 推播迴圈（50 ms，對應 DashPublisher）──────────────────────────────────

let lastTick = Date.now();
let lastHello = 0;
let lastNotify = Date.now();
let notifyIdx = 0;

/**
 * 機器人主動通知。不改協定 —— DashWs.broadcast(type, payload) 的 type 是任意字串
 * （DashWs.java:93），機器人端只要多一行。level / title 一律 ASCII：OnBotJava 的
 * javac 編碼與 Driver Hub 對 CJK 都沒驗證過，前端查對照表顯示中文。
 */
const NOTIFIES = [
  { level: "WARN", title: "SHOOTER_LOW", desc: "SL 1420 < 90% target", ttl: 8 },
  { level: "INFO", title: "REC_ROLLED", desc: "new recording file", ttl: 4 },
  { level: "ERROR", title: "OVERCURRENT_WAY", desc: "way motor over current", ttl: 0 },
  { level: "WARN", title: "BATTERY_LOW", desc: "battery 11.4 V", ttl: 8 },
];

function bridgeStats() {
  bus.put("/FGC/Bridge/Gen", genCounter);
  bus.put("/FGC/Bridge/Threads", 1 + (mjpegBusy ? 1 : 0));
  bus.put("/FGC/Bridge/Viewers", subs.size);
  bus.put("/FGC/Bridge/Mode", mode);
  bus.put("/FGC/Bridge/Enabled", enabled);
  bus.put("/FGC/Bridge/Camera", true);
  bus.put("/FGC/Status/OpMode", pit() ? "B1-PIT" : "A1-MATCH");
  bus.put("/FGC/Rec/File", rec.currentName());
  bus.put("/FGC/Rec/Lines", rec.lines);
  bus.put("/FGC/Rec/Flush Age s", round(rec.flushAgeS(), 1));
}

function tick() {
  const now = Date.now();
  const dt = clamp((now - lastTick) / 1000, 0.001, 0.2);
  lastTick = now;
  try {
    if (enabled) drainInbox();
    sim.step(dt, pit());
    bridgeStats();

    const d = bus.drainDirty();
    if (d) {
      // 錄影是「黑盒子」：不分 MATCH / PIT，也**不看總開關**。
      // DashPublisher.java:37-46 把 addLine 移到 on 閘外面，註解寫得很清楚——
      // 以前綁在 on 底下，跑過一次 Z-DASH-OFF 整場就完全沒有錄影，而 health 也
      // 連不上（薄殼回 404），現場根本發現不了，偏偏那正是最需要事後追查的情境。
      rec.addLine(d);
      // 推播才看總開關（DashPublisher.java:46 的 `on && pit() && !sockets.isEmpty()`）
      if (enabled && pit() && subs.size > 0) broadcast("nt", JSON.stringify(d));
    }
    // hello / notify 一樣要看總開關：關掉之後 NsShell.onSubscribe 直接 return
    // （DashBridge.java:213），前端會看到「ws 連得上但年齡一直變舊」——這正是
    // 「橋接停用」與「機器人死了」在 8081 這條通道上長得一樣的原因，
    // 所以關閉路徑第 (2) 格必須靠 8080 的 404 來判，不能靠 ws。
    if (enabled && pit() && subs.size > 0 && now - lastHello >= 2000) {
      lastHello = now;
      broadcast("hello", bus.snapshotJson());
    }
    // notify 的推播只在 PIT，但埋點不分模式：DashNotify.java:58 一律
    // put("/FGC/Bridge/Last Notify", level + ":" + title)。MATCH 期間那是唯一
    // 看得到「機器人剛剛喊了什麼」的痕跡（Lockdown 頁的最後一格就是讀它）。
    if (enabled && now - lastNotify >= 20000) {
      lastNotify = now;
      const n = NOTIFIES[notifyIdx++ % NOTIFIES.length];
      bus.put("/FGC/Bridge/Last Notify", `${n.level}:${n.title}`);
      if (pit() && subs.size > 0) broadcast("notify", JSON.stringify(n));
    }
    if (now - rec.lastFlush >= 10000) rec.flush();
  } catch (e) {
    lastError(`publish: ${e}`);
  }
}

const ticker = setInterval(tick, 50);
ticker.unref?.();

/** 切模式：MATCH 期間完全不推播，只在切換的當下推一次。 */
function setMode(m) {
  const next = m === "MATCH" ? "MATCH" : "PIT";
  if (next === mode) return false;
  mode = next;
  genCounter++;
  bus.put("/FGC/Bridge/Mode", mode);
  bus.put("/FGC/Bridge/Gen", genCounter);
  bus.put("/FGC/Status/OpMode", pit() ? "B1-PIT" : "A1-MATCH");
  if (subs.size > 0 && pit()) {
    lastHello = Date.now();
    broadcast("hello", bus.snapshotJson());
  }
  // MATCH：**什麼都不推**。真機的 PIT→MATCH 在已開的 socket 上是完全靜默的——
  // DashPublisher.java:37 的 drainDirty() 一定會被呼叫（要餵 DashRec.addLine），
  // 把剛變成 "MATCH" 的那筆取走並清空 dirty，而第 46 行的廣播被 pit() 擋住，
  // 所以那一批永遠不會送出去；下一圈 DashHub.put 值沒變直接 return，這個 key
  // 再也不會進 dirty。
  //
  // 這裡以前多推了一則帶 Mode/Gen/OpMode 的 nt（「MATCH：只推這一次」），
  // 那是假伺服器比真機仁慈的地方，而且正好把前端「模式是鎖存不是有保鮮期的事實」
  // 這個 fatal 遮起來——在這個假伺服器上永遠測不出來。拿掉之後，前端要靠
  // 自己的模式看門狗（送 ws sync）或 /dash/health 的降級才會鎖住，
  // 那才是真機上會發生的事。
  return true;
}

// ── HTTP（8080）───────────────────────────────────────────────────────────

function head(res, status, mime, extra = {}) {
  res.writeHead(status, {
    "Content-Type": mime,
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
    ...extra,
  });
}

function sendText(res, status, body) {
  const buf = Buffer.from(body ?? "", "utf8");
  head(res, status, "text/plain; charset=utf-8", { "Content-Length": buf.length });
  res.end(buf);
}

function sendJson(res, status, body) {
  const buf = Buffer.from(body ?? "", "utf8");
  head(res, status, "application/json", { "Content-Length": buf.length });
  res.end(buf);
}

function sendNdjson(res, status, body) {
  const buf = Buffer.from(body ?? "", "utf8");
  head(res, status, "application/x-ndjson", { "Content-Length": buf.length });
  res.end(buf);
}

/** DashHub.java:72-78 寫死的七條註冊路徑；總開關關掉時薄殼對這些一律回 404。 */
const REGISTERED_PATHS = new Set([
  "/dash/health",
  "/dash/state.json",
  "/dash/set",
  "/dash/rec.json",
  "/dash/rec.jsonl",
  "/dash/stream.mjpg",
  "/dash/snapshot.jpg",
]);

const INDEX = () =>
  [
    "fake Control Hub — FGC 2026",
    "",
    `WS   ws://127.0.0.1:${ARGS.ws}   (namespace "dash")`,
    "",
    "GET /dash/health",
    "GET /dash/state.json           (MATCH -> 503)",
    "GET /dash/set?k=&v=            (k=_save|_load|_snippet 也可)",
    "GET /dash/rec.json",
    "GET /dash/rec.jsonl?name=<name|live>",
    "GET /dash/stream.mjpg?fps=10&q=40   (PIT only, 1 viewer)",
    "GET /dash/snapshot.jpg",
    "GET /dash/mode?m=PIT|MATCH     (只有假伺服器才有)",
    "GET /dash/enabled?v=0|1        (只有假伺服器才有)",
    "",
  ].join("\n");

function handleSet(u, res) {
  const k = u.searchParams.get("k");
  if (!k) return sendJson(res, 400, okJson(false, "missing k"));

  if (!pit()) {
    bus.put("/FGC/Bridge/Last Set Rejected", `${k}: MATCH mode`);
    return sendJson(res, 403, okJson(false, "MATCH mode: writes are rejected"));
  }
  if (k === "_save") {
    const why = params.save();
    return sendJson(res, why === null ? 200 : 500, okJson(why === null, why === null ? "saved" : why));
  }
  if (k === "_load") {
    const why = params.load();
    return sendJson(res, why === null ? 200 : 500, okJson(why === null, why === null ? "loaded" : why));
  }
  if (k === "_snippet") {
    bus.put(PARAM_PREFIX + "_Snippet", params.snippet());
    return sendJson(res, 200, okJson(true, "snippet published"));
  }
  const v = u.searchParams.get("v");
  if (v === null) return sendJson(res, 400, okJson(false, "missing v"));

  const why = params.apply(k, v, { pit: true });
  if (why !== null) {
    broadcast("err", errJson(k, why));
    return sendJson(res, 400, okJson(false, why));
  }
  return sendJson(res, 200, okJson(true, ""));
}

function handleStream(u, res, req) {
  if (!pit()) return sendText(res, 503, "MATCH mode: camera is closed");
  if (mjpegBusy) return sendText(res, 503, "stream busy: only one viewer at a time");

  let fps = Number(u.searchParams.get("fps"));
  if (!Number.isFinite(fps) || fps <= 0) fps = 10; // 預設 100 ms 一格
  fps = clamp(fps, 1, 30);
  const periodMs = Math.round(1000 / fps);

  mjpegBusy = true;
  res.writeHead(200, {
    "Content-Type": "multipart/x-mixed-replace; boundary=fgcframe",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
    Connection: "close",
    Pragma: "no-cache",
  });

  let i = 0;
  const timer = setInterval(() => {
    if (!pit()) return stop(); // 比賽開始就切掉畫面
    const frame = FRAMES[i++ % FRAMES.length];
    const ok = res.write(
      `--fgcframe\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`
    );
    res.write(frame);
    res.write("\r\n");
    if (!ok) {
      /* 背壓：下一格照送，Node 會自己排隊 */
    }
  }, periodMs);

  const stop = () => {
    clearInterval(timer);
    mjpegBusy = false;
    try {
      res.end();
    } catch {
      /* 已關 */
    }
  };
  req.on("close", stop);
  req.on("aborted", stop);
  res.on("error", stop);
}

const server = http.createServer((req, res) => {
  let u;
  try {
    u = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
  } catch {
    return sendText(res, 400, "bad url");
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
      "Cache-Control": "no-store",
    });
    return res.end();
  }
  if (req.method !== "GET") return sendText(res, 405, "GET only");

  // 總開關關掉時，薄殼對「所有註冊路徑」回 404 "dash disabled"
  // （DashBridge.java:143-149 的 HttpShell.getResponse 第一段）。
  // 這正是前端 ShutdownStrip 第 (2) 格的判定依據：可觀測狀態（404），
  // 而不是「我按了某個按鈕」。/dash/mode 與 /dash/enabled 是假伺服器專用的
  // 測試端點（真機沒有這兩條），所以不套這個閘，否則關掉就再也開不回來。
  if (!enabled && REGISTERED_PATHS.has(u.pathname)) {
    return sendText(res, 404, "dash disabled");
  }

  try {
    switch (u.pathname) {
      case "/":
      case "/dash":
      case "/dash/":
        return sendText(res, 200, INDEX());

      case "/dash/health": {
        const le = bus.get("/FGC/Bridge/Last Error");
        const body =
          `build=${BUILD_TAG}\n` +
          `gen=${genCounter}\n` +
          `threads=${1 + (mjpegBusy ? 1 : 0)}\n` +
          `mode=${mode}\n` +
          `enabled=${enabled ? "1" : "0"}\n` +
          `viewers=${subs.size}\n` +
          `camsrc=${pit() ? "yes" : "no"}\n` +
          `rec=${rec.currentName()}\n` +
          `reclines=${rec.lines}\n` +
          `recpending=${rec.pending.length}\n` +
          `lasterror=${le == null ? "" : le}\n` +
          `keys=${bus.size()}\n`;
        return sendText(res, 200, body);
      }

      case "/dash/state.json":
        if (!pit()) return sendText(res, 503, "MATCH mode: state is closed");
        return sendJson(res, 200, bus.snapshotJson());

      case "/dash/set":
        return handleSet(u, res);

      case "/dash/rec.json": {
        if (!pit()) return sendText(res, 503, "MATCH mode: recordings are closed");
        rec.flush();
        return sendJson(
          res,
          200,
          JSON.stringify({
            dir: REC_DIR,
            current: rec.currentName(),
            files: listRecFiles().map((f) => ({ name: f.name, size: f.size, mtime: f.mtime })),
          })
        );
      }

      case "/dash/rec.jsonl": {
        if (!pit()) return sendText(res, 503, "MATCH mode: recordings are closed");
        rec.flush();
        const name = u.searchParams.get("name");
        if (name === "live") return sendNdjson(res, 200, rec.ringText());
        let file;
        if (!name) {
          const fs0 = listRecFiles();
          if (fs0.length === 0) return sendText(res, 404, "no recordings");
          file = path.join(REC_DIR, fs0[0].name);
        } else {
          if (!safeName(name)) return sendText(res, 400, "bad name");
          file = path.join(REC_DIR, name);
          if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return sendText(res, 404, "no such file");
        }
        return sendNdjson(res, 200, fs.readFileSync(file, "utf8"));
      }

      case "/dash/stream.mjpg":
        return handleStream(u, res, req);

      case "/dash/snapshot.jpg": {
        if (!pit()) return sendText(res, 503, "MATCH mode: camera is closed");
        const frame = FRAMES[Math.floor(Date.now() / 100) % FRAMES.length];
        head(res, 200, "image/jpeg", { "Content-Length": frame.length });
        return res.end(frame);
      }

      // ── 只有假伺服器才有：方便前端測試切模式 / 總開關 ──
      case "/dash/mode": {
        const m = String(u.searchParams.get("m") || "").toUpperCase();
        if (m !== "PIT" && m !== "MATCH") return sendJson(res, 400, okJson(false, "m must be PIT or MATCH"));
        const changed = setMode(m);
        return sendJson(res, 200, okJson(true, changed ? `mode=${mode}` : `already ${mode}`));
      }

      case "/dash/enabled": {
        const v = u.searchParams.get("v");
        if (v !== "0" && v !== "1") return sendJson(res, 400, okJson(false, "v must be 0 or 1"));
        enabled = v === "1";
        bus.put("/FGC/Bridge/Enabled", enabled);
        return sendJson(res, 200, okJson(true, `enabled=${enabled ? 1 : 0}`));
      }

      default:
        return sendText(res, 404, "not found");
    }
  } catch (e) {
    lastError(`http: ${e}`);
    return sendText(res, 500, `error: ${e}`);
  }
});

// ── 啟動 ───────────────────────────────────────────────────────────────────

const made = ensureFakeRecordings();

server.listen(ARGS.http, () => {
  const H = `http://127.0.0.1:${ARGS.http}`;
  console.log("");
  console.log("  假 Control Hub 已啟動（FGC 2026 橋接器模擬）");
  console.log(`  build : ${BUILD_TAG}`);
  console.log(`  mode  : ${mode}   （切換：${H}/dash/mode?m=MATCH）`);
  console.log(`  錄影  : ${REC_DIR}${ARGS.rec ? "" : "（--no-rec：本場不寫檔）"}`);
  if (made.length) for (const m of made) console.log(`          已產生假錄影 ${m.name}（${m.lines} 行 / ${m.bytes} bytes）`);
  console.log("");
  console.log(`  WS    : ws://127.0.0.1:${ARGS.ws}`);
  console.log(`          連上後先送 {"namespace":"system","type":"subscribeToNamespace","payload":"dash"}`);
  console.log(`  HTTP  : ${H}/dash/health`);
  console.log(`          ${H}/dash/state.json`);
  console.log(`          ${H}/dash/rec.json`);
  console.log(`          ${H}/dash/rec.jsonl?name=live`);
  console.log(`          ${H}/dash/stream.mjpg`);
  console.log(`          ${H}/dash/set?k=/FGC/Tune/VEL_SL&v=1900`);
  console.log("");
  console.log("  Ctrl+C 離開。說明見 README-fake-hub.md");
  console.log("");
});

function shutdown() {
  try {
    clearInterval(ticker);
    rec.flush();
  } catch {
    /* 收工路徑不吵 */
  }
  try {
    wss.close();
  } catch {
    /* ignore */
  }
  try {
    server.close();
  } catch {
    /* ignore */
  }
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
