// #17 的資料層：告警來源有兩條，合流成同一條 rail。
//
//   ① 機器人主動通知：ws 的 "notify" 訊息（DashNotify.java）。level/title 一律 ASCII
//      ——OnBotJava 的 javac 編碼與 Driver Hub 對 CJK 都沒驗證過，所以中文只存在於
//      前端的對照表裡（§5.4 與 §8「語言」）。查不到的 title 就原樣顯示 ASCII，
//      **絕不自己編一個中文**：看不懂的字串至少還能拿去 grep 程式碼。
//   ② 前端自產：規則寫在這裡，條件消失時卡片自己收掉。
//
// 「條件式告警」是刻意的設計：規格說 ERROR 不自動消失，但全頁零按鈕，
// 沒有東西可以關掉它。解法是讓 ERROR 跟著「它在講的那件事」活——過流一停、
// 電壓一回來，卡片就走。這比一顆關閉鍵誠實：你關掉的是卡片，不是問題。

import type { LogStore } from "../../lib/LogStore";
import { GLYPHS, LIMITS, type Tone } from "../../lib/tone";
import { K } from "../../lib/fgcKeys";
import { percentile, Rolling } from "../../lib/stats";
import type { NotifyMsg } from "../../../lib/RobotClient";

export type Level = "ERROR" | "WARN" | "INFO";

export interface Alert {
  /** 同一件事永遠同一個 key：重複觸發只更新 desc，不會洗版。 */
  key: string;
  level: Level;
  title: string;
  desc: string;
  /** 第一次出現的本機時刻（顯示「已 N.N s」）。 */
  at: number;
  /** 0 = 只要條件還在就留著。 */
  expiresAt: number;
  source: "robot" | "local";
}

// ── 驗收線（§6.6，全域一致，不因面板而異）────────────────────────────
export const BATT_WARN_V = LIMITS.battWarnV;
export const BATT_ERR_V = LIMITS.battErrV;
export const LOOP_P95_MS = LIMITS.loopErrMs;
/** shooter 偏離目標的判定：與機器人端 SHOOT_OFF_PCT 同一個 10%。 */
export const SHOOT_OFF_PCT = 0.1;
/** 偏離要持續這麼久才喊，避免每次餵球的 dip 都跳一次。 */
const SHOOT_OFF_HOLD_MS = 500;
/** ws 斷流多久算故障（推播週期 50 ms）。 */
const LINK_GAP_MS = 1000;

const TTL_BY_LEVEL: Record<Level, number> = { ERROR: 0, WARN: 8000, INFO: 4000 };

/** ASCII title → 中文。查不到就原樣顯示。 */
const TITLE_CN: Record<string, string> = {
  SHOOTER_OFF_TARGET: "shooter 偏離目標",
  SHOOTER_LOW: "shooter 轉速偏低",
  BATTERY_LOW: "電池電壓偏低",
  REC_ROLLED: "錄影已換檔",
  OVERCURRENT_L: "左飛輪過流",
  OVERCURRENT_R: "右飛輪過流",
  OVERCURRENT_WAY: "送料馬達過流",
  OVERCURRENT_CLIMB: "爬升馬達過流",
  CLIMB_TIMEOUT: "爬升逾時",
  LOOP_SLOW: "控制迴圈變慢",
  REC_FLUSH_LATE: "錄影寫入落後",
};

export function normTitle(s: string): string {
  return s.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");
}

export function titleCn(ascii: string): string {
  return TITLE_CN[normTitle(ascii)] ?? ascii;
}

function levelOf(s: string): Level {
  const u = s.trim().toUpperCase();
  return u === "ERROR" || u === "WARN" ? u : "INFO";
}

const RANK: Record<Level, number> = { ERROR: 0, WARN: 1, INFO: 2 };

interface Cond {
  key: string;
  level: Level;
  title: string;
  desc: string;
}

/** 需要「持續 N 毫秒」的條件各自的起算時刻。 */
interface HoldState {
  shootOffSince: number;
  lastError: string;
}

export class AlertStore {
  private robot = new Map<string, Alert>();
  private local = new Map<string, Alert>();
  private version = 0;
  private listeners = new Set<() => void>();
  private hold: HoldState = { shootOffSince: 0, lastError: "" };
  private loopRoll = new Rolling(200);
  /** 新出現的 ERROR（給 WebAudio 用）；讀走就清掉。 */
  private pendingBeep = false;

  getVersion = (): number => this.version;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  private emit(): void {
    this.version++;
    this.listeners.forEach((fn) => fn());
  }

  takeBeep(): boolean {
    const b = this.pendingBeep;
    this.pendingBeep = false;
    return b;
  }

  /** ws 的 notify。ttl 是毫秒（DashNotify.MAX_TTL_MS = 60000）；0 = 由前端依 level 決定。 */
  onNotify(n: NotifyMsg): void {
    const level = levelOf(n.level);
    const key = "robot:" + (normTitle(n.title) || "MSG");
    const ttl = n.ttl > 0 ? n.ttl : TTL_BY_LEVEL[level];
    const prev = this.robot.get(key);
    this.robot.set(key, {
      key,
      level,
      title: titleCn(n.title),
      desc: n.desc,
      at: prev ? prev.at : n.at,
      expiresAt: ttl > 0 ? n.at + ttl : 0,
      source: "robot",
    });
    if (level === "ERROR" && !prev) this.pendingBeep = true;
    this.emit();
  }

  /**
   * 每 200 ms 呼叫一次：重算所有前端自產的條件並對帳。
   * @param linkAgeMs 最後一批遙測的年齡；< 0 = 從來沒收到過。
   */
  evaluate(log: LogStore, linkAgeMs: number, now = Date.now()): void {
    const conds: Cond[] = [];

    // ① 遙測斷流。放第一個：後面所有判斷用的都是舊值，先講這件事才誠實。
    if (linkAgeMs > LINK_GAP_MS) {
      conds.push({
        key: "link",
        level: "ERROR",
        title: "遙測中斷",
        desc: "已 " + (linkAgeMs / 1000).toFixed(1) + " s 沒有新的一批（推播週期 50 ms）",
      });
    } else if (linkAgeMs >= 0) {
      // ② shooter 偏離目標 > 10% 且已達速，持續 0.5 s
      const st = log.latestStr(K.driveState, "");
      const atSpeed = log.latestBool(K.atSpeed);
      const sl = log.latestNum(K.sl, NaN);
      const sr = log.latestNum(K.sr, NaN);
      const tl = log.latestNum(K.targetL, NaN);
      const tr = log.latestNum(K.targetR, NaN);
      const off = (v: number, t: number) =>
        t > 0 && Number.isFinite(v) && Math.abs(v - t) > SHOOT_OFF_PCT * t;
      const bad = st === "SHOOT" && atSpeed && (off(sl, tl) || off(sr, tr));
      if (!bad) {
        this.hold.shootOffSince = 0;
      } else {
        if (this.hold.shootOffSince === 0) this.hold.shootOffSince = now;
        if (now - this.hold.shootOffSince >= SHOOT_OFF_HOLD_MS) {
          conds.push({
            key: "shootOff",
            level: "WARN",
            title: "shooter 偏離目標 > 10%",
            desc: "SL " + Math.round(sl) + "/" + Math.round(tl) + "　SR " + Math.round(sr) + "/" + Math.round(tr),
          });
        }
      }

      // ③ 電池
      const v = log.latestNum(K.battery, NaN);
      if (Number.isFinite(v) && v > 0) {
        if (v < BATT_ERR_V) {
          conds.push({
            key: "batt",
            level: "ERROR",
            title: "電池電壓過低",
            desc: v.toFixed(2) + " V < " + BATT_ERR_V.toFixed(1) + " V",
          });
        } else if (v < BATT_WARN_V) {
          conds.push({
            key: "batt",
            level: "WARN",
            title: "電池接近門檻",
            desc: v.toFixed(2) + " V（門檻 " + BATT_WARN_V.toFixed(1) + " V）",
          });
        }
      }

      // ④ loop p95：平均 12 ms 但 p95 40 ms 的機器人手感是頓的，
      //    只看即時數字會被平均值騙過去。
      const lp = log.latestNum(K.loopMs, NaN);
      if (Number.isFinite(lp)) this.loopRoll.push(lp);
      if (this.loopRoll.size >= 40) {
        const p95 = percentile(this.loopRoll.values(), 0.95);
        if (p95 > LOOP_P95_MS) {
          conds.push({
            key: "loop",
            level: "WARN",
            title: "控制迴圈變慢",
            desc: "p95 " + p95.toFixed(1) + " ms > " + LOOP_P95_MS + " ms",
          });
        }
      }

      // ⑤ 過流四路
      const oc: [string, string, string][] = [
        [K.overCurrentL, "ocL", "左飛輪過流"],
        [K.overCurrentR, "ocR", "右飛輪過流"],
        [K.overCurrentWay, "ocWay", "送料過流（可能卡球）"],
        [K.climbOverCurrent, "ocClimb", "爬升過流"],
      ];
      for (const row of oc) {
        if (log.latestBool(row[0])) {
          conds.push({ key: row[1], level: "ERROR", title: row[2], desc: "isMotorOverCurrent = true" });
        }
      }

      // ⑥ 機器人端最後一個錯誤（變動才算一次新事件）
      const le = log.latestStr(K.lastError, "");
      if (le && le !== this.hold.lastError) {
        this.hold.lastError = le;
        this.robot.set("bridgeErr", {
          key: "bridgeErr",
          level: "WARN",
          title: "橋接器回報錯誤",
          desc: le.slice(0, 120),
          at: now,
          expiresAt: now + TTL_BY_LEVEL.WARN,
          source: "robot",
        });
      }
    }

    // 對帳：新條件建卡（保留原本的 at 才數得出「已 N.N s」）、消失的條件收卡
    let changed = false;
    const seen = new Set<string>();
    for (const c of conds) {
      seen.add(c.key);
      const prev = this.local.get(c.key);
      if (!prev) {
        this.local.set(c.key, { key: c.key, level: c.level, title: c.title, desc: c.desc, at: now, expiresAt: 0, source: "local" });
        if (c.level === "ERROR") this.pendingBeep = true;
        changed = true;
      } else if (prev.desc !== c.desc || prev.level !== c.level || prev.title !== c.title) {
        this.local.set(c.key, { ...prev, level: c.level, title: c.title, desc: c.desc });
        changed = true;
      }
    }
    for (const k of Array.from(this.local.keys())) {
      if (!seen.has(k)) {
        this.local.delete(k);
        changed = true;
      }
    }
    for (const entry of Array.from(this.robot.entries())) {
      if (entry[1].expiresAt > 0 && now >= entry[1].expiresAt) {
        this.robot.delete(entry[0]);
        changed = true;
      }
    }
    if (changed) this.emit();
  }

  /** 排序：先嚴重、再新。rail 只給 3 格——多過 3 條的畫面沒有人在讀。 */
  list(max = 3): Alert[] {
    const all = [...this.local.values(), ...this.robot.values()];
    all.sort((a, b) => RANK[a.level] - RANK[b.level] || b.at - a.at);
    return all.slice(0, max);
  }

  count(): number {
    return this.local.size + this.robot.size;
  }

  clear(): void {
    this.local.clear();
    this.robot.clear();
    this.hold = { shootOffSince: 0, lastError: "" };
    this.loopRoll.clear();
    this.emit();
  }
}

export const alerts = new AlertStore();

/**
 * 形狀語彙（§6.3）唯一來源在 lib/tone.ts。
 * 這裡只是把通知的三級對到全域四態：ERROR→err ■、WARN→warn ▲、INFO→ok ●。
 */
export const ALERT_TONE: Record<Level, Tone> = { ERROR: "err", WARN: "warn", INFO: "ok" };
export const GLYPH: Record<Level, string> = {
  ERROR: GLYPHS.err,
  WARN: GLYPHS.warn,
  INFO: GLYPHS.ok,
};
