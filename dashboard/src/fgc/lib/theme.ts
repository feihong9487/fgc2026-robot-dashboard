// theme：CSS 變數 → JS 色票物件。
//
// Canvas 與 uPlot 吃不到 CSS 變數，所以三案裡有 103 處硬編碼 hex（Chart.tsx:38-47 的
// #8b95a7 軸色與 #2a3040 格線在內），換主題時圖表完全不跟著換。
// 這裡開機 getComputedStyle 讀一次快取成 JS 物件，主題切換重讀並廣播；
// LineGraph / DiscreteBand / 巨燈 / 爬升柱 / 直方圖一律從這裡取色。

import * as persist from "./persist";

/** light 已砍（規格第八刀）：field 高對比才是賽場需要的，light 是舒適品。 */
export type ThemeName = "dark" | "field" | "lockdown";
export type Density = "compact" | "normal" | "loose";

export interface Palette {
  surface1: string;
  surface2: string;
  surface3: string;
  text: string;
  textDim: string;
  border: string;
  ok: string;
  warn: string;
  err: string;
  /** ≠ err：err =「這個值不對」，danger =「這個按鈕會改機器人」。 */
  danger: string;
  focusRing: string;
  /** 值沒更新 ≠ 值是舊的，但相機 / tag 確實會過期。 */
  stale: string;
  /** 資料缺口：斜線紋的線色，絕不畫成 0 或內插。 */
  gap: string;
  /** 8 條（不是 6），超過循環並用線型區分。 */
  series: string[];
  stateCollect: string;
  stateShoot: string;
  stateEject: string;
  bandOn: string;
  bandOff: string;
  bandNeg: string;
  /** 目標線：與實測同色 + 透明 + 虛線，誤差 = 兩條同色線的距離。 */
  target: string;
  /** 門檻線：比目標線更細的 warn 虛線。 */
  thresh: string;
  allianceRed: string;
  allianceBlue: string;
  fieldBg: string;
  fieldGrid: string;
  fieldTag: string;
  fov: string;
}

const FALLBACK: Palette = {
  surface1: "#12151c",
  surface2: "#1a1f2a",
  surface3: "#232a38",
  text: "#dfe6f0",
  textDim: "#8b95a7",
  border: "#2e3950",
  ok: "#81c784",
  warn: "#ffb74d",
  err: "#e57373",
  danger: "#ff8a65",
  focusRing: "#4fc3f7",
  stale: "#6b7488",
  gap: "#3a4256",
  series: ["#4dd0e1", "#ffb74d", "#81c784", "#ba68c8", "#fff176", "#f06292", "#64b5f6", "#a1887f"],
  stateCollect: "#4fc3f7",
  stateShoot: "#81c784",
  stateEject: "#e57373",
  bandOn: "#81c784",
  bandOff: "#2e3950",
  bandNeg: "#ba68c8",
  target: "#dfe6f0",
  thresh: "#ffb74d",
  allianceRed: "#ff5252",
  allianceBlue: "#448aff",
  fieldBg: "#0d1017",
  fieldGrid: "#2a3040",
  fieldTag: "#fff176",
  fov: "#4dd0e1",
};

const VAR_MAP: Record<Exclude<keyof Palette, "series">, string> = {
  surface1: "--surface-1",
  surface2: "--surface-2",
  surface3: "--surface-3",
  text: "--text",
  textDim: "--text-dim",
  border: "--border-c",
  ok: "--ok",
  warn: "--warn",
  err: "--err",
  danger: "--danger",
  focusRing: "--focus-ring",
  stale: "--stale",
  gap: "--gap",
  stateCollect: "--state-collect",
  stateShoot: "--state-shoot",
  stateEject: "--state-eject",
  bandOn: "--band-on",
  bandOff: "--band-off",
  bandNeg: "--band-neg",
  target: "--target",
  thresh: "--thresh",
  allianceRed: "--alliance-red",
  allianceBlue: "--alliance-blue",
  fieldBg: "--field-bg",
  fieldGrid: "--field-grid",
  fieldTag: "--field-tag",
  fov: "--fov",
};

let cache: Palette = FALLBACK;
let current: ThemeName = "dark";
/**
 * 使用者「真正想要的」主題（永遠不是 lockdown）。
 * lockdown 是 MATCH 強制套上的，離開 MATCH 時要還原成這個而不是去讀 localStorage
 * ——`?theme=field` 這種一次性的網址參數不寫 localStorage，去讀 localStorage
 * 會把它吃掉（開機 route 一定先是 MATCH，所以每一次都會吃掉）。
 */
let preferred: Exclude<ThemeName, "lockdown"> = "dark";
const listeners = new Set<() => void>();

function readVar(cs: CSSStyleDeclaration, name: string, fallback: string): string {
  const v = cs.getPropertyValue(name).trim();
  return v || fallback;
}

/** 從 :root 重新讀一次所有 token。主題切換或字級變更後呼叫。 */
export function readPalette(): Palette {
  if (typeof window === "undefined" || typeof getComputedStyle !== "function") return FALLBACK;
  const cs = getComputedStyle(document.documentElement);
  const out = { ...FALLBACK } as Palette;
  for (const [k, varName] of Object.entries(VAR_MAP) as [keyof Palette, string][]) {
    if (k === "series") continue;
    (out as unknown as Record<string, unknown>)[k] = readVar(cs, varName, FALLBACK[k] as string);
  }
  out.series = [];
  for (let i = 1; i <= 8; i++) {
    out.series.push(readVar(cs, `--series-${i}`, FALLBACK.series[i - 1]));
  }
  cache = out;
  return out;
}

/** 取快取（每幀都可以呼叫，不會觸發 layout）。 */
export function palette(): Palette {
  return cache;
}

/**
 * 序列固定綁定：SL = series-1（青）、SR = series-2（橙）、Way = series-4（紫）。
 * 射手三軌在每一張圖、每一次回放、每一份匯出都是同一組顏色，不因面板而異。
 */
export function seriesColor(i: number): string {
  const s = cache.series;
  return s[((i % s.length) + s.length) % s.length];
}

export function getTheme(): ThemeName {
  return current;
}

/** 離開 MATCH 時要還原成哪一個（永遠不是 lockdown）。 */
export function preferredTheme(): Exclude<ThemeName, "lockdown"> {
  return preferred;
}

/**
 * 套用主題。lockdown 不由使用者選——MATCH 進來時強制套上，
 * 刻意「不好看」：比賽日的螢幕被人看到時，它應該明顯是一台關著的機器。
 */
export function setTheme(name: ThemeName, remember = true): void {
  current = name;
  if (name !== "lockdown") preferred = name;
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-theme", name);
  }
  if (remember && name !== "lockdown") persist.setStr(persist.KEYS.theme, name);
  readPalette();
  listeners.forEach((fn) => fn());
}

export function setDensity(d: Density): void {
  if (typeof document !== "undefined") document.documentElement.setAttribute("data-density", d);
  persist.setStr(persist.KEYS.density, d);
  readPalette();
  listeners.forEach((fn) => fn());
}

export function getDensity(): Density {
  const d = persist.getStr(persist.KEYS.density, "normal");
  return d === "compact" || d === "loose" ? d : "normal";
}

/** 開機：先讀記憶，沒有就跟系統偏好走。 */
export function initTheme(forced?: string | null): ThemeName {
  let name: ThemeName = "dark";
  const saved = persist.getStr(persist.KEYS.theme, "");
  if (forced === "dark" || forced === "field") name = forced;
  else if (saved === "dark" || saved === "field") name = saved;
  else if (typeof window !== "undefined" && window.matchMedia) {
    // 現況全檔 0 個 prefers-color-scheme；淺色偏好的人在賽場其實需要的是 field
    name = window.matchMedia("(prefers-color-scheme: light)").matches ? "field" : "dark";
  }
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-profile", "fgc");
    document.documentElement.setAttribute("data-density", getDensity());
  }
  setTheme(name, false);
  return name;
}

export function subscribeTheme(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
