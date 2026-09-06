// 常數表 schema — 與機器人端 deploy/constants.json / ConfigStore 一一對應。
// Dashboard 是「編輯器」，檔案是「真相」：所有值經 NT /Constants/* 鏡射，
// 按「儲存到機器人」才落地到 VMX-pi 檔案系統，不做自動存檔。
import { NtValue } from "./store";
import { K } from "./keys";

export const CONST_PREFIX = "/Constants";

// 控制用特殊 entry（底線開頭，避免與資料欄位混淆）
export const CONST_CTRL = {
  save: `${CONST_PREFIX}/_save`, // App→機器人：寫入 constants.json
  verify: `${CONST_PREFIX}/_verify`, // App→機器人：讀回檔案並發布 _verifyJson
  verifyJson: `${CONST_PREFIX}/_verifyJson`, // 機器人→App：檔案實際內容
  status: `${CONST_PREFIX}/_status`, // 機器人→App：最後一次存/讀結果訊息
} as const;

export interface Pose {
  x: number;
  y: number;
  theta: number;
}
export interface Hsv {
  hLo: number;
  hHi: number;
  sLo: number;
  sHi: number;
  vLo: number;
  vHi: number;
}

export const BOX_COLORS = ["RED", "BLUE", "BLACK"] as const;
export type BoxColor = (typeof BOX_COLORS)[number];

// 箱色 → 兩顆球的顏色（4 種排列）
export const BALL_PAIRS = ["WHITE_WHITE", "WHITE_YELLOW", "YELLOW_WHITE", "YELLOW_YELLOW"] as const;
export const BALL_PAIR_LABELS = ["白・白", "白・黃", "黃・白", "黃・黃"];

// 箱色 → 櫃位
export const SHELVES = ["BOTTOM", "TOP", "ROOF"] as const;
export const SHELF_LABELS = ["下格 (1.8cm)", "上格 (11.2cm)", "櫃頂 (20.6cm)"];

export const BOX_COLOR_LABELS: Record<BoxColor, string> = {
  RED: "紅箱",
  BLUE: "藍箱",
  BLACK: "黑箱",
};

export interface Constants {
  // 取球區直接放場地座標：取完一顆球其餘 11 顆會滾動移位，
  // 寫死的逐球座標表無意義 —— 每顆球的即時位置由視覺每次重新定位（Runtime），
  // 常數只存「機器人要站到哪裡取球」的場地位姿。
  field: { sortingZone: Pose; shelfPose: Pose; ballZone: Pose };
  colorMap: Record<BoxColor, string>; // BALL_PAIRS 之一
  shelfMap: Record<BoxColor, string>; // SHELVES 之一
  lift: {
    pickHeights: { trip1: number; trip2: number; trip3: number };
    placeHeights: { BOTTOM: number; TOP: number; ROOF: number };
    ticksPerCm: number;
    kP: number;
    kI: number;
    kD: number;
    maxVel: number;
    maxAccel: number;
  };
  drive: {
    wheelRadiusMm: number;
    baseRadiusMm: number;
    ticksPerRev: number;
    kP: number;
    kI: number;
    kD: number;
    kF: number;
    headingKp: number;
    headingKd: number;
  };
  scurve: { vMax: number; aMax: number; jMax: number };
  lineSensor: { thresholds: number[]; spacingMm: number };
  vision: { hsvRed: Hsv; hsvBlue: Hsv; hsvBlack: Hsv };
}

export function defaultConstants(): Constants {
  return {
    field: {
      sortingZone: { x: 0, y: 0, theta: 0 },
      shelfPose: { x: 0, y: 0, theta: 0 },
      ballZone: { x: 0, y: 0, theta: 0 },
    },
    colorMap: { RED: "WHITE_WHITE", BLUE: "WHITE_YELLOW", BLACK: "YELLOW_YELLOW" },
    shelfMap: { RED: "BOTTOM", BLUE: "TOP", BLACK: "ROOF" },
    lift: {
      pickHeights: { trip1: 13.5, trip2: 8.5, trip3: 3.5 },
      placeHeights: { BOTTOM: 1.8, TOP: 11.2, ROOF: 20.6 },
      ticksPerCm: 0,
      kP: 0,
      kI: 0,
      kD: 0,
      maxVel: 0,
      maxAccel: 0,
    },
    drive: {
      wheelRadiusMm: 0,
      baseRadiusMm: 0,
      ticksPerRev: 0,
      kP: 0.01,
      kI: 0,
      kD: 0.0002,
      kF: 0,
      headingKp: 0.5,
      headingKd: 0,
    },
    scurve: { vMax: 600, aMax: 500, jMax: 1000 },
    lineSensor: { thresholds: [0, 0, 0, 0], spacingMm: 0 },
    vision: {
      hsvRed: { hLo: 170, hHi: 10, sLo: 100, sHi: 255, vLo: 60, vHi: 255 },
      hsvBlue: { hLo: 95, hHi: 130, sLo: 100, sHi: 255, vLo: 60, vHi: 255 },
      hsvBlack: { hLo: 0, hHi: 179, sLo: 0, sHi: 255, vLo: 0, vHi: 60 },
    },
  };
}

// ── 常數 → 既有 Chassis live entry 的映射 ───────────────────
// 「套用」時除了 /Constants/* 也寫這些既有 Shuffleboard entry，調參即時生效
// （原 Demo「駕駛調參」分頁的功能由此取代）。
export const LIVE_KEY_MAP: [(c: Constants) => number, string][] = [
  [(c) => c.drive.kP, K.kP],
  [(c) => c.drive.kI, K.kI],
  [(c) => c.drive.kD, K.kD],
  [(c) => c.drive.headingKp, K.kPHeading],
  [(c) => c.scurve.vMax, K.vMax],
  [(c) => c.scurve.aMax, K.aMax],
  [(c) => c.scurve.jMax, K.jMax],
];

// ── 物件 ↔ 扁平 NT 路徑 互轉 ────────────────────────────────
// /Constants/lift/pickHeights/trip1 ↔ constants.lift.pickHeights.trip1
// 陣列以索引為路徑段：/Constants/lineSensor/thresholds/0

export function flattenConstants(c: Constants): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  const walk = (v: unknown, path: string) => {
    if (typeof v === "number" || typeof v === "string") {
      out[path] = v;
    } else if (Array.isArray(v)) {
      v.forEach((item, i) => walk(item, `${path}/${i}`));
    } else if (v && typeof v === "object") {
      for (const [k, sub] of Object.entries(v)) walk(sub, `${path}/${k}`);
    }
  };
  walk(c, CONST_PREFIX);
  return out;
}

/** 從 NT 最新值還原常數表；缺的欄位保留 base（預設值或目前草稿） */
export function unflattenConstants(
  latest: ReadonlyMap<string, NtValue>,
  base: Constants,
): Constants {
  const c: Constants = JSON.parse(JSON.stringify(base));
  const read = (path: string, fallback: number | string) => {
    const v = latest.get(`${CONST_PREFIX}/${path}`);
    if (typeof fallback === "number") return typeof v === "number" ? v : fallback;
    return typeof v === "string" ? v : fallback;
  };
  const walkAssign = (obj: Record<string, unknown>, prefix: string) => {
    for (const [k, v] of Object.entries(obj)) {
      const p = prefix ? `${prefix}/${k}` : k;
      if (typeof v === "number" || typeof v === "string") {
        obj[k] = read(p, v);
      } else if (Array.isArray(v)) {
        v.forEach((item, i) => {
          if (typeof item === "number") v[i] = read(`${p}/${i}`, item);
        });
      } else if (v && typeof v === "object") {
        walkAssign(v as Record<string, unknown>, p);
      }
    }
  };
  walkAssign(c as unknown as Record<string, unknown>, "");
  return c;
}

/** 草稿與另一份常數的逐欄差異（VERIFY 用），回傳「路徑: A → B」清單 */
export function diffConstants(a: Constants, b: Constants): string[] {
  const fa = flattenConstants(a);
  const fb = flattenConstants(b);
  const diffs: string[] = [];
  for (const k of Object.keys(fa)) {
    const va = fa[k];
    const vb = fb[k];
    const eq =
      typeof va === "number" && typeof vb === "number"
        ? Math.abs(va - vb) < 1e-9
        : va === vb;
    if (!eq) diffs.push(`${k.slice(CONST_PREFIX.length + 1)}: ${va} → ${vb}`);
  }
  return diffs;
}
