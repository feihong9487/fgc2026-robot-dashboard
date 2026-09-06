// Go/No-Go 燈牆的判定：一支純函式，吃一包資料吐 15 個 Check。
//
// 沿用 VMX StatusPanel.tsx:22-27 的整個模式（Check{name, ok, detail, hint} 純函式
// + 每秒強制刷新讓「年齡」持續變舊），只換檢查項。**fail 時給處置提示**是這個模式
// 真正的價值——把隊內 know-how 寫進 UI，賽場上不會有時間翻文件。
//
// 純函式的理由不是潔癖：燈牆的判定是「能不能上場」的最終答案，它必須能被
// npm run fgc-check 用一份假的 ctx 直接驗，而不是靠人去盯畫面。
//
// 三顆指紋燈（fingerprint: true）壓縮三個最貴的除錯路徑：
//   Threads !== 1       殭屍推播執行緒（舊 ClassLoader 沒收工）→ 重開 Hub 電源
//   Build 兩邊不一致     委派凍結在舊 ClassLoader → 重跑一次 OpMode
//   Viewers >= 1 收不到  namespace 沒訂閱成功 → 不是網路問題，是握手問題

import { K, TUNABLES, paramKey, buildParamKey } from "../../lib/fgcKeys";
import type { LogStore } from "../../lib/LogStore";
import type { HealthState } from "../../lib/health";
import type { LinkState } from "../../../lib/RobotClient";

export type CheckState = "ok" | "warn" | "err" | "stale";

/** 形狀語彙（§6.3）：顏色不是唯一通道，約 8% 男性有紅綠色覺辨異。 */
export const GLYPH: Record<CheckState, string> = {
  ok: "●",
  warn: "▲",
  err: "■",
  stale: "○",
};

export interface Check {
  id: string;
  name: string;
  /** 通過 = 這一項不擋你上場。warn / stale 一律 false。 */
  ok: boolean;
  state: CheckState;
  /** 第二行：數字本身。永遠不留空白——「沒有值」也要寫出來是為什麼。 */
  detail: string;
  /** 只有沒通過才顯示的處置提示。 */
  hint?: string;
  fingerprint?: boolean;
}

/**
 * 錄影行數的趨勢。
 *
 * reclines 在真機是 flush 時才 addAndGet（DashRec.java:222，FLUSH_MS=10000），
 * 所以它是每 10 秒跳一階而不是連續爬。用 3 秒的瞬時差判斷「有沒有在動」會有
 * 三分之二的時間誤判成停了——視窗必須 >= 30 秒。
 */
export interface RecTrend {
  /** 最新一次 health 的 reclines；NaN = 還沒拿到。 */
  lines: number;
  /** 視窗內增加的行數；NaN = 樣本不足。 */
  delta: number;
  /** 視窗實際長度（秒）。 */
  windowS: number;
  /** 行 / 秒。 */
  rate: number;
}

export const EMPTY_TREND: RecTrend = { lines: NaN, delta: NaN, windowS: 0, rate: NaN };

/** 判定「行數在動」需要的最短觀察窗；小於這個數只說「觀察中」，不說「停了」。 */
export const REC_WINDOW_S = 30;

export interface CheckCtx {
  /** Date.now()。 */
  now: number;
  linkState: LinkState;
  health: HealthState | null;
  /** 最後一次 health 回應的年齡（ms）；-1 = 從未回應。 */
  healthAgeMs: number;
  /** 最後一批遙測的年齡（ms）；-1 = 從未收到。 */
  wsAgeMs: number;
  /** 最後一則 hello 的本機時刻；0 = 從未握手成功。 */
  helloAt: number;
  recTrend: RecTrend;
  log: LogStore;
  /** 最近 20 秒的 loop p50 / p95（ms）；NaN = 沒資料。 */
  loopP50: number;
  loopP95: number;
}

// ── 小工具 ─────────────────────────────────────────────────────────────

const n0 = (v: number) => Math.round(v).toLocaleString("en-US");

function num(log: LogStore, key: string): number {
  return log.has(key) ? log.latestNum(key, NaN) : NaN;
}

/** 這個 key 在整份 log 裡有沒有變過。編碼器沒插線的特徵就是「一直是同一個值」。 */
function everChanged(log: LogStore, key: string): boolean {
  return log.changePoints(key).length > 1;
}

// ── 15 項 ──────────────────────────────────────────────────────────────

export function buildChecks(ctx: CheckCtx): Check[] {
  const { log, health, recTrend } = ctx;
  const hOk = health?.kind === "ok" ? health.info : null;
  const hDisabled = health?.kind === "disabled";

  const out: Check[] = [];

  // (1) 橋接執行緒 —— 指紋燈
  {
    const t = hOk ? hOk.threads : num(log, K.threads);
    out.push(
      Number.isFinite(t)
        ? {
            id: "threads",
            name: "橋接執行緒",
            ok: t === 1,
            state: t === 1 ? "ok" : "err",
            detail: `Threads = ${Math.round(t)}`,
            hint: "殭屍推播執行緒：舊 ClassLoader 的 DashPublisher 沒收工。重開 Control Hub 電源（Restart Robot 不一定夠）",
            fingerprint: true,
          }
        : {
            id: "threads",
            name: "橋接執行緒",
            ok: false,
            state: "stale",
            detail: "沒有 Threads 讀數",
            hint: "8080 與 8081 都沒回話；先看底下的關閉路徑三格",
            fingerprint: true,
          },
    );
  }

  // (2) Build —— 指紋燈：兩條通道各自報一次，不一致就是委派凍結在舊 ClassLoader
  {
    const wsBuild = log.latestStr(K.build, "");
    const httpBuild = hOk ? hOk.build : "";
    const both = wsBuild !== "" && httpBuild !== "";
    const same = both && wsBuild === httpBuild;
    out.push({
      id: "build",
      name: "Build",
      ok: same,
      state: both ? (same ? "ok" : "err") : wsBuild || httpBuild ? "warn" : "stale",
      detail: both
        ? same
          ? wsBuild
          : `8081 ${wsBuild} != 8080 ${httpBuild}`
        : wsBuild || httpBuild || "沒有 Build tag",
      hint: both
        ? "兩條通道回報的 Build 不同 = 委派凍結在舊 ClassLoader。跑一次 B1-PIT 讓新的委派登記上去；還是不一致就重開 Hub 電源"
        : "只有一條通道回報 Build，另一條沒通；賽場上最常被問的就是「你們現在跑的是哪一版」",
      fingerprint: true,
    });
  }

  // (3) 8081 推播 —— 指紋燈：Viewers >= 1 卻收不到 nt = namespace 沒訂閱成功
  {
    const viewers = hOk ? hOk.viewers : num(log, K.viewers);
    const age = ctx.wsAgeMs;
    const never = age < 0;
    const subscribed = ctx.helloAt > 0;
    const state: CheckState = never || age > 3000 ? "err" : age > 250 ? "warn" : "ok";
    out.push({
      id: "ws",
      name: "8081 推播",
      ok: state === "ok",
      state,
      detail: never
        ? ctx.linkState === "polling"
          ? "已退回 state.json 輪詢"
          : "從未收到任何一批"
        : `ws age ${Math.round(age)} ms`,
      hint:
        never && Number.isFinite(viewers) && viewers >= 1 && !subscribed
          ? "Viewers >= 1 卻收不到 nt：socket 連上了但 subscribeToNamespace 沒成功。這不是網路問題，是握手問題"
          : never
            ? "8081 連得上但沒有資料：確認 Driver Hub 正在跑 B1-PIT（不吃儀表板的 OpMode 不會推播）"
            : "遙測變舊：OpMode 可能卡在某一圈。看的是最後一批的年齡而不是 ping——ping 會騙人",
      fingerprint: true,
    });
  }

  // (4) 8080 health
  {
    out.push({
      id: "health",
      name: "8080 health",
      ok: !!hOk,
      state: hOk ? "ok" : "err",
      detail: hOk
        ? `200 · gen ${hOk.gen} · ${ctx.healthAgeMs >= 0 ? Math.round(ctx.healthAgeMs / 1000) : "—"} 秒前`
        : hDisabled
          ? "404 · 橋接已停用"
          : `無回應（${health?.kind === "error" ? health.why.slice(0, 40) : "尚未輪詢"}）`,
      hint: hDisabled
        ? "Z-DASH-OFF 已生效（這正是關閉路徑 (2) 的判定依據）。要恢復請在 Driver Hub 跑一次 Z-DASH-ON"
        : "8080 沒通：確認位址與 Wi-Fi（Control Hub 可能已改名或改成 5 GHz），以及至少跑過一次 OpMode 讓委派登記",
    });
  }

  // (5) 錄影行數在動 —— 比賽日整套方案唯一有價值的產出就是那個 jsonl
  {
    const t = recTrend;
    const known = Number.isFinite(t.lines);
    const enough = Number.isFinite(t.delta) && t.windowS >= REC_WINDOW_S - 5;
    const moving = enough && t.delta > 0;
    out.push({
      id: "rec",
      name: "錄影行數在動",
      ok: moving,
      state: !known || !enough ? "stale" : moving ? "ok" : "err",
      detail: !known
        ? "沒有 reclines 讀數"
        : enough
          ? `${n0(t.lines)}　(+${n0(t.delta)} / ${t.windowS.toFixed(0)}s)`
          : `${n0(t.lines)}　(觀察中 ${t.windowS.toFixed(0)}/${REC_WINDOW_S} s)`,
      hint: !known
        ? "先讓 8080 通"
        : "行數停住 = 沒有人在寫檔。reclines 是 flush 時才加（每 10 秒一階），連續 30 秒不動才算停。確認 B1-PIT 在跑",
    });
  }

  // (6) 電池 —— 驗收線 12.0 / 11.5 V
  {
    const v = num(log, K.battery);
    const state: CheckState = !Number.isFinite(v) ? "stale" : v < 11.5 ? "err" : v < 12.0 ? "warn" : "ok";
    out.push({
      id: "battery",
      name: "電池",
      ok: state === "ok",
      state,
      detail: Number.isFinite(v) ? `${v.toFixed(1)} V` : "沒有讀數",
      hint: "低於 12.0 V 射速就開始受影響，低於 11.5 V 換電池。這是本案唯二有數值驗收線的量之一",
    });
  }

  // (7) loop p95 —— 驗收線 25 ms
  {
    const p95 = ctx.loopP95;
    const state: CheckState = !Number.isFinite(p95) ? "stale" : p95 > 25 ? "err" : p95 > 20 ? "warn" : "ok";
    out.push({
      id: "loop",
      name: "loop p95",
      ok: state === "ok",
      state,
      detail: Number.isFinite(p95)
        ? `${p95.toFixed(0)} ms　(p50 ${Number.isFinite(ctx.loopP50) ? ctx.loopP50.toFixed(0) : "—"})`
        : "沒有讀數",
      hint: "平均 12 ms 但 p95 40 ms 的機器人手感是頓的。先關 MJPEG 串流，再看視覺 decimation",
    });
  }

  // (8) 視覺 fps
  {
    const fps = num(log, K.visionFps);
    const enabled = log.has(K.visionEnabled) ? log.latestBool(K.visionEnabled, false) : null;
    const state: CheckState =
      enabled === false ? "stale" : !Number.isFinite(fps) ? "stale" : fps < 10 ? "err" : fps < 15 ? "warn" : "ok";
    out.push({
      id: "visionfps",
      name: "視覺 fps",
      ok: state === "ok",
      state,
      // 一位小數：門檻就在 15，四捨五入成整數會出現「15（偏低）」這種自打嘴巴的字
      detail:
        enabled === false
          ? "視覺未啟用"
          : Number.isFinite(fps)
            ? `${fps.toFixed(1)}${fps < 15 ? "（偏低）" : ""}`
            : "沒有讀數",
      hint: "降 MJPEG_Q 到 40 或關掉串流；再不行提高 TAG_DECIMATION（犧牲遠距離辨識換 fps）",
    });
  }

  // (9)(10)(11) 三顆編碼器：問的不是「有沒有值」，是「這個值有沒有變過」
  const enc: readonly (readonly [string, string, string, string])[] = [
    ["sl", "SL 編碼器", K.sl, "tps"],
    ["sr", "SR 編碼器", K.sr, "tps"],
    ["way", "way 編碼器", K.way, "tps"],
  ];
  for (const [id, name, key, unit] of enc) {
    const v = num(log, key);
    const has = log.has(key);
    const changed = has && everChanged(log, key);
    const state: CheckState = !has ? "stale" : changed ? "ok" : "warn";
    out.push({
      id,
      name,
      ok: state === "ok",
      state,
      detail: has ? `${v.toFixed(0)} ${unit}${changed ? "" : "（整段沒變過）"}` : "沒有讀數",
      hint: has
        ? "值從連上到現在一次都沒變：可能是編碼器線沒插，也可能只是還沒轉過。先手動轉一下飛輪再看"
        : "這個 key 從來沒出現過：確認跑的是 B1-PIT 而不是 Z-FALLBACK-v2",
    });
  }

  // (12) climb 零點
  {
    const pos = num(log, K.climbPos);
    const holding = log.has(K.climbHolding) ? log.latestBool(K.climbHolding, false) : null;
    const has = Number.isFinite(pos);
    const state: CheckState = !has ? "stale" : Math.abs(pos) > 50 ? "warn" : "ok";
    out.push({
      id: "climb",
      name: "climb 零點",
      ok: state === "ok",
      state,
      detail: has
        ? `${pos.toFixed(0)}${Math.abs(pos) <= 50 ? "　在零點" : ""}${holding ? " · HOLD" : ""}`
        : "沒有讀數",
      hint: "爬升機構不在零點：上場前先降回 0，否則柱上的分數線刻度與實際位置對不上",
    });
  }

  // (13) hopper 有回應（CRServo 無回授，只能看指令值有沒有變化）
  {
    const has = log.has(K.hopperCmd);
    const changed = has && everChanged(log, K.hopperCmd);
    const state: CheckState = !has ? "stale" : changed ? "ok" : "warn";
    out.push({
      id: "hopper",
      name: "hopper 有回應",
      ok: state === "ok",
      state,
      detail: has ? (changed ? "Cmd 有變化" : "Cmd 整段沒變過") : "沒有讀數",
      hint: "CRServo 沒有回授，這裡看的是指令值不是位置。按一次 L1 / R1 開關球倉，數值要跟著動",
    });
  }

  // (14) 值 = 建置值 —— 這一格轉綠是「檢視→調參→驗證」整條流程存在的理由
  {
    let compared = 0;
    let diff = 0;
    const names: string[] = [];
    for (const t of TUNABLES) {
      const pk = paramKey(t.name);
      const bk = buildParamKey(t.name);
      if (!log.has(pk) || !log.has(bk)) continue;
      compared++;
      const a = t.kind === "bool" ? (log.latestBool(pk, false) ? 1 : 0) : log.latestNum(pk, NaN);
      const b = t.kind === "bool" ? (log.latestBool(bk, false) ? 1 : 0) : log.latestNum(bk, NaN);
      if (a !== b) {
        diff++;
        if (names.length < 3) names.push(t.name);
      }
    }
    const state: CheckState = compared === 0 ? "stale" : diff === 0 ? "ok" : "warn";
    out.push({
      id: "paramdiff",
      name: "值 = 建置值",
      ok: state === "ok",
      state,
      detail:
        compared === 0
          ? "機器人端沒有 /FGC/Param/Build <NAME>"
          : diff === 0
            ? `${compared} 項一致`
            : `${diff} 項不同：${names.join("、")}${diff > names.length ? " …" : ""}`,
      hint:
        compared === 0
          ? "沒有編譯值可比：這是機器人端的一個埋點（附錄 B）。沒有它就偵測不到「白調一天」"
          : "volatile 參數只活在 RAM：Restart Robot 或換電池就回到編譯值。到參數頁按 [存到機器人 fgc-tune.json] 或 [複製 Constants 片段]",
    });
  }

  // (15) AprilTag
  {
    const id = num(log, K.bestId);
    const range = num(log, K.bestRange);
    const age = num(log, K.bestAge);
    const has = log.has(K.bestId);
    const seen = Number.isFinite(id) && id >= 0;
    const fresh = seen && Number.isFinite(age) && age < 2;
    const state: CheckState = !has ? "stale" : fresh ? "ok" : "stale";
    out.push({
      id: "tag",
      name: "AprilTag",
      ok: fresh,
      state,
      detail: !has
        ? "沒有讀數"
        : seen
          ? `id ${Math.round(id)} · ${Number.isFinite(range) ? range.toFixed(2) : "—"} m${
              fresh ? "" : ` · 已過期 ${Number.isFinite(age) ? age.toFixed(1) : "?"} s`
            }`
          : "視野內沒有標籤",
      hint: "pit 裡沒有標籤是正常的；檢錄前把機器人對準一張標籤再看這一格",
    });
  }

  return out;
}

export interface CheckSummary {
  total: number;
  passed: number;
  errs: number;
  warns: number;
  stales: number;
  /** 沒有 err、沒有 stale 才算可以上場；warn 只降級成「要注意」。 */
  go: boolean;
}

export function summarizeChecks(checks: readonly Check[]): CheckSummary {
  let errs = 0;
  let warns = 0;
  let stales = 0;
  let passed = 0;
  for (const c of checks) {
    if (c.state === "err") errs++;
    else if (c.state === "warn") warns++;
    else if (c.state === "stale") stales++;
    if (c.ok) passed++;
  }
  return { total: checks.length, passed, errs, warns, stales, go: errs === 0 && stales === 0 };
}

/** [複製結果] 產生的 Markdown：貼進隊內群組就是一份帶時間的檢錄記錄。 */
export function checksToMarkdown(checks: readonly Check[], build: string, at: number): string {
  const s = summarizeChecks(checks);
  const lines: string[] = [];
  lines.push(`# FGC 檢查 ${new Date(at).toLocaleString("zh-TW", { hour12: false })}`);
  lines.push(`Build \`${build || "—"}\` · ${s.passed}/${s.total} 通過 · ${s.go ? "READY TO PLAY" : "NO GO"}`);
  lines.push("");
  lines.push("| | 項目 | 值 |");
  lines.push("|---|---|---|");
  for (const c of checks) lines.push(`| ${GLYPH[c.state]} | ${c.name} | ${c.detail} |`);
  const bad = checks.filter((c) => !c.ok && c.hint);
  if (bad.length > 0) {
    lines.push("");
    lines.push("## 處置");
    for (const c of bad) lines.push(`- **${c.name}**：${c.hint}`);
  }
  return lines.join("\n");
}
