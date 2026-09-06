// 第三階段 E（回放分析）的純函式驗證。
//
// 跑法（package.json 是共用檔，多個階段同時在改，所以不加 npm script）：
//   npx esbuild tools/fgc-check-3e.ts --bundle --platform=node --format=esm \
//       --outfile=.fgc-check-3e.mjs --log-level=warning && node .fgc-check-3e.mjs [rec.jsonl]
//
// 驗的是「判定」而不是「畫面」：eventDetect 的八類 + 通知、篩選的 ! 排除、
// 事件/變化點跳轉、四種匯出（JSONL 剪輯做完整往返比對）、M11 時間閘、書籤儲存。
// 畫面的部分用 CDP 真實時間截圖驗（scratchpad/shot3e.mjs）。

import fs from "node:fs";
import path from "node:path";
import { LogStore } from "../src/fgc/lib/LogStore.ts";
import { K, paramKey } from "../src/fgc/lib/fgcKeys.ts";
import {
  KIND_LABEL,
  detect,
  filterEvents,
  mergeEvents,
  nextChange,
  nextEvent,
  runInterval,
  type EventKind,
  type LogEvent,
} from "../src/fgc/lib/eventDetect.ts";
import { parseJsonlText } from "../src/fgc/lib/jsonl.ts";
import {
  tickTimes,
  toCSV,
  toConstantsSnippet,
  toJsonlClip,
  toMarkdown,
  suggestName,
} from "../src/fgc/components/replay/exporters.ts";
import {
  coachGate,
  gateAllows,
  parseRecStamp,
  projectLog,
} from "../src/fgc/components/replay/coachGate.ts";
import {
  addBookmark,
  loadBookmarks,
  logFingerprint,
  removeBookmark,
} from "../src/fgc/components/replay/bookmarks.ts";

// ── localStorage 影子（書籤要用；node 沒有這東西）──────────────────
const mem = new Map<string, string>();
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k),
  key: (i: number) => Array.from(mem.keys())[i] ?? null,
  get length() {
    return mem.size;
  },
};

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra = ""): void {
  if (cond) {
    pass++;
    console.log("  ok   " + name + (extra ? "   " + extra : ""));
  } else {
    fail++;
    console.log("  FAIL " + name + (extra ? "   " + extra : ""));
  }
}
function eq(name: string, got: unknown, want: unknown): void {
  ok(name, Object.is(got, want) || String(got) === String(want), "got=" + String(got) + " want=" + String(want));
}
function near(name: string, got: number, want: number, tol: number): void {
  ok(name, Math.abs(got - want) <= tol, "got=" + got.toFixed(3) + " want=" + want.toFixed(3) + " ±" + tol);
}

// ══ 合成一份「什麼都發生過一次」的 log ═══════════════════════════════
// 20 Hz、30 秒。狀態機、dip、達速、爬升、退球、車頭、電壓谷、四種故障各來一次。
interface Phase {
  t0: number;
  t1: number;
  state: string;
}
const PHASES: Phase[] = [
  { t0: 0, t1: 5, state: "COLLECT" },
  { t0: 5, t1: 12, state: "SHOOT" },
  { t0: 12, t1: 15, state: "COLLECT" },
  { t0: 15, t1: 22, state: "SHOOT" },
  { t0: 22, t1: 24, state: "EJECT" },
  { t0: 24, t1: 30, state: "COLLECT" },
];
/** 每個 SHOOT 段落的三顆球（相對段落起點的秒數）。 */
const DIPS = [1.5, 3.0, 4.5];
const TARGET = 1900;
const GAP = { t0: 12.5, t1: 14.0 }; // 缺口刻意放在 COLLECT，dip 的數量才是確定的

function stateAt(t: number): string {
  for (const p of PHASES) if (t >= p.t0 && t < p.t1) return p.state;
  return "COLLECT";
}
function shootStart(t: number): number | null {
  for (const p of PHASES) if (p.state === "SHOOT" && t >= p.t0 && t < p.t1) return p.t0;
  return null;
}
function slAt(t: number): number {
  const s = shootStart(t);
  if (s === null) return 0;
  const dt = t - s;
  if (dt < 0.4) return Math.round((TARGET * dt) / 0.4); // spin-up 斜坡
  let v = TARGET;
  for (let i = 0; i < DIPS.length; i++) {
    const d = dt - DIPS[i];
    // 第三顆球刻意掉到 1100（跌破 FEED_THRESHOLD 1200），前兩顆掉 600
    const depth = i === 2 ? 800 : 600;
    if (d >= 0 && d < 0.3) v = TARGET - depth * (1 - d / 0.3);
    else if (d >= -0.05 && d < 0) v = TARGET - depth * ((d + 0.05) / 0.05);
  }
  return Math.round(v);
}

const syn = new LogStore("syn");
{
  let prevPhase = "";
  for (let i = 0; i <= 600; i++) {
    const t = i / 20;
    if (t > GAP.t0 && t < GAP.t1) continue; // 資料缺口
    const st = stateAt(t);
    const sl = slAt(t);
    const phase = t < 1 ? "INIT" : t < 29 ? "RUN" : "STOPPED";
    const d: Record<string, string | number | boolean> = {
      [K.matchS]: Math.round(t * 1000) / 1000,
      [K.driveState]: st,
      [K.sl]: sl,
      [K.sr]: sl,
      [K.way]: st === "SHOOT" ? 1800 : -400,
      [K.targetL]: TARGET,
      [K.atSpeed]: sl >= TARGET * 0.97,
      [K.spinupMs]: shootStart(t) === null ? 0 : Math.min(400, Math.round((t - shootStart(t)!) * 1000)),
      [paramKey("FEED_THRESHOLD")]: 1200,
      [paramKey("VEL_SL")]: 1900,
      [paramKey("WAIT_SPINUP")]: true,
      [K.battery]: t > 16 && t < 17 ? 11.9 + (t - 16.5) * (t - 16.5) : 12.6 - t * 0.005,
      [K.loopMs]: t > 20 && t < 20.15 ? 40 : 12,
      [K.overCurrentL]: t > 21 && t < 21.2,
      [K.driveReversed]: t < 10,
      [K.climbHolding]: t > 26,
      [K.climbPos]: t > 26 ? 118 : 0,
      [K.lastError]: t > 27 ? "usb: lynx timeout" : "",
      [K.bestRange]: 4.2,
      "/FGC/Status/Phase": phase,
    };
    if (phase !== prevPhase) prevPhase = phase;
    syn.applyBatch(d, t);
  }
}

console.log("\n── 合成 log ──────────────────────────────────────────────");
console.log(
  "  " + syn.batchCount + " 批 · " + syn.keys().length + " 欄位 · " + syn.samples + " 樣本 · t=" + syn.tSource,
);

// ══ 1. eventDetect：八類 + 通知 ═══════════════════════════════════════
console.log("\n── eventDetect ───────────────────────────────────────────");
const t1 = Date.now();
const ev = detect(syn, {
  notifies: [
    { t: 8, level: "ERROR", title: "SHOOTER STALL", desc: "sl < 300 for 1s" },
    { t: 9, level: "INFO", title: "TAG LOCK" },
  ],
});
const detectMs = Date.now() - t1;
const by = (k: EventKind) => ev.filter((e) => e.kind === k);
console.log(
  "  " +
    ev.length +
    " 筆 / " +
    detectMs +
    " ms　" +
    (Object.keys(KIND_LABEL) as EventKind[]).map((k) => KIND_LABEL[k] + " " + by(k).length).join(" · "),
);

eq("① 進入 SHOOT 兩次", by("shoot").length, 2);
near("① 第一次在 t=5", by("shoot")[0].t, 5, 0.06);
eq("① 序號是 SHOOT #2", by("shoot")[1].label.includes("#2"), true);
eq("⑤ EJECT 一次", by("eject").length, 1);
eq("② spin-up 兩次（每段一次）", by("spinup").length, 2);
near("② spin-up ≈ 400 ms", Number(by("spinup")[0].data?.ms), 400, 60);
eq("③ dip 共六顆（兩段 × 三顆）", by("dip").length, 6);
eq("③ 每段第三顆跌破門檻", by("dip").filter((e) => e.data?.below === true).length, 2);
eq("③ 跌破的那顆是 err", by("dip").find((e) => e.data?.below === true)?.level, "err");
ok(
  "③ 門檻取的是 /FGC/Param 回讀值而不是寫死",
  String(by("dip")[0].data?.thresholdSrc).includes("/FGC/Param"),
  String(by("dip")[0].data?.thresholdSrc),
);
ok("③ 恢復時間標了 ±50 ms 解析度", by("dip")[0].detail.includes("±50 ms"), by("dip")[0].detail.slice(0, 40));
near("③ 底值 ≈ 1100（第三顆）", Number(by("dip")[2].data?.bottom), 1100, 60);
eq("④ 爬升保持一次", by("climb").length, 1);
eq("⑥ 車頭反轉一次", by("flip").length, 1);
ok("⑦ 電壓谷至少一次且都 < 12.0", by("batt").length >= 1 && by("batt").every((e) => Number(e.data?.v) < 12), String(by("batt").length));
const faults = by("fault");
eq("⑧ loop 尖峰合併成一筆", faults.filter((e) => e.label.startsWith("loop")).length, 1);
eq("⑧ 過電流一次", faults.filter((e) => e.label.includes("過電流")).length, 1);
eq("⑧ 資料缺口一筆", faults.filter((e) => e.label.startsWith("資料缺口")).length, 1);
near(
  "⑧ 缺口長度 1.5 s",
  Number(faults.find((e) => e.label.startsWith("資料缺口"))?.data?.dur),
  1.5,
  0.11,
);
eq("⑧ Last Error 一筆", faults.filter((e) => e.label === "Last Error").length, 1);
eq("⑨ 通知兩筆", by("notify").length, 2);
eq("⑨ ERROR 通知是 err", by("notify")[0].level, "err");
ok("事件依時間排序", ev.every((e, i) => i === 0 || ev[i - 1].t <= e.t));
ok("id 不重複", new Set(ev.map((e) => e.id)).size === ev.length);

// 決定性與增量：同一份 log 掃兩次，id 完全一致
const ev2 = detect(syn, { notifies: [{ t: 8, level: "ERROR", title: "SHOOTER STALL", desc: "sl < 300 for 1s" }] });
ok(
  "全掃是決定性的（兩次的 id 相同）",
  ev.filter((e) => e.kind !== "notify").map((e) => e.id).join() ===
    ev2.filter((e) => e.kind !== "notify").map((e) => e.id).join(),
);
const win = detect(syn, { t0: 14 });
ok("t0/t1 只過濾輸出", win.every((e) => e.t >= 14));
eq("視窗過濾後序號仍是 #2（不重新編號）", win.filter((e) => e.kind === "shoot")[0].label.includes("#2"), true);
eq("mergeEvents 以 id 去重", mergeEvents(ev, ev).length, ev.length);

// 空 log 不炸
eq("空 log 回空陣列", detect(new LogStore("empty")).length, 0);

// ══ 2. 篩選 / 跳轉 ════════════════════════════════════════════════════
console.log("\n── 篩選與跳轉 ────────────────────────────────────────────");
eq("! 排除：!dip 之後沒有 dip", filterEvents(ev, "!dip").filter((e) => e.kind === "dip").length, 0);
ok("! 排除保留其餘", filterEvents(ev, "!dip").length === ev.length - 6, String(filterEvents(ev, "!dip").length));
eq("包含詞：dip 只留 dip", new Set(filterEvents(ev, "dip").map((e) => e.kind)).size, 1);
eq("兩個包含詞是 AND", filterEvents(ev, "shoot 進入").length, 2);
eq("類別開關", filterEvents(ev, "", new Set<EventKind>(["shoot"])).length, 2);
eq("空查詢全留", filterEvents(ev, "  ").length, ev.length);
const n1 = nextEvent(ev, 0, 1);
eq("nextEvent 往後", n1?.t !== undefined && n1.t > 0, true);
eq("nextEvent 走到底回 null", nextEvent(ev, 1e9, 1), null);
eq("nextEvent 往前", nextEvent(ev, -1, -1), null);
const c1 = nextChange(syn, K.driveState, 0, 1);
near("nextChange 下一個狀態變化 = 5 s", c1 ?? -1, 5, 0.06);
eq("nextChange 沒有這個 key 回 null", nextChange(syn, "/FGC/Nope", 0, 1), null);
const ri = runInterval(syn);
ok("runInterval 認出 RUN 區間", !!ri && Math.abs(ri.t0 - 1) < 0.06 && Math.abs(ri.t1 - 29) < 0.11, JSON.stringify(ri));
eq("沒有 Phase 埋點時 runInterval 回 null", runInterval(new LogStore("x")), null);

// ══ 3. 匯出 ══════════════════════════════════════════════════════════
console.log("\n── 匯出 ──────────────────────────────────────────────────");
const RANGE = { t0: 5, t1: 12, label: "選取區間" };
const ticks = tickTimes(syn, RANGE.t0, RANGE.t1);
eq("tickTimes 只取批次時戳（不自己造網格）", ticks.length, 141);
ok("tickTimes 單調", Array.from(ticks).every((t, i) => i === 0 || ticks[i - 1] < t));

const csv = toCSV(syn, [K.sl, K.driveState, K.atSpeed], RANGE);
const csvLines = csv.trim().split("\n");
eq("CSV 標頭", csvLines[0], "t,/FGC/Shooter/SL,/FGC/Drive/State,/FGC/Shooter/AtSpeed");
eq("CSV 列數 = tick 數", csvLines.length - 1, ticks.length);
ok("CSV 用 ZOH 取值（第一列是 SHOOT）", csvLines[1].includes("SHOOT"), csvLines[1]);
ok("CSV 布林寫成 true/false", csv.includes("false") && csv.includes("true"));

const clip = toJsonlClip(syn, RANGE);
const back = new LogStore("clip");
const pr = parseJsonlText(clip, (b) => back.applyBatch(b.d, b.t));
eq("JSONL 剪輯沒有壞行", pr.bad, 0);
ok("JSONL 剪輯第一行是整份快照", Object.keys(JSON.parse(clip.split("\n")[0]).d).length === syn.keys().length);
ok(
  "剪輯後 key 一個都不少（diff 剪一段會少 key，所以要有快照那一行）",
  back.keys().length === syn.keys().length,
  back.keys().length + " vs " + syn.keys().length,
);
let same = 0;
let diff = 0;
for (const t of [5.0, 6.5, 7.05, 9.9, 11.95]) {
  for (const k of [K.sl, K.way, K.battery]) {
    const a = syn.valueAt(k, t);
    const b = back.valueAt(k, t);
    if (a !== null && b !== null && Math.abs(a - b) < 1e-9) same++;
    else diff++;
  }
  if (syn.stringAt(K.driveState, t) === back.stringAt(K.driveState, t)) same++;
  else diff++;
}
eq("JSONL 剪輯往返：每個取樣點的值都一致", diff, 0);
ok("往返比對真的比了東西", same === 20, String(same));
ok("剪輯只留選區", back.tMin >= RANGE.t0 - 1e-9 && back.tMax <= RANGE.t1 + 1e-9);

const md = toMarkdown({
  name: "rec-20260906-173539.jsonl",
  log: syn,
  range: RANGE,
  events: ev,
  bookmarks: [{ t: 7.5, label: "way 卡了", at: 0 }],
  statKeys: [K.sl, K.driveState],
});
ok("Markdown 有時間表", md.includes("## 時間表"));
ok("Markdown 事件與書籤交錯排", md.indexOf("way 卡了") > md.indexOf("進入 SHOOT"));
ok("Markdown 有 σ", md.includes("σ"));
ok("Markdown 有每球 dip 表", md.includes("## 每球 dip（解析度 ±50 ms）"));
ok("Markdown 寫出時戳來源", md.includes("t=robot"));
ok("Markdown 統計跳過字串欄位", !/\| `\/FGC\/Drive\/State`/.test(md));

const snippet = toConstantsSnippet(syn, 10);
ok("Constants 片段有 VEL_SL", snippet.includes("public static volatile double VEL_SL = 1900;"), "");
ok("Constants 片段的 bool 是 boolean", snippet.includes("public static volatile boolean WAIT_SPINUP = true;"));
ok("Constants 片段標明來源", snippet.includes("儀表板依 /FGC/Param/* 回讀值重組"));
{
  const withSnip = new LogStore("s2");
  withSnip.applyBatch({ [K.matchS]: 0, [K.snippet]: "VEL_SL = 1965;" }, 0);
  ok("有 _Snippet 就用機器人組好的那一份", toConstantsSnippet(withSnip, 0).includes("VEL_SL = 1965;"));
}
eq("檔名建議", suggestName("rec-20260906-173539.jsonl", "csv", RANGE, "csv"), "rec-20260906-173539-csv-5.0-12.0.csv");

// ══ 4. M11 時間閘 ════════════════════════════════════════════════════
console.log("\n── M11 時間閘 ────────────────────────────────────────────");
const stamp = parseRecStamp("rec-20261007-093412.jsonl");
ok("解析 DashRec 檔名時戳", stamp !== null && new Date(stamp).getHours() === 9 && new Date(stamp).getMinutes() === 34);
ok("解析儀表板匯出的檔名", parseRecStamp("fgc-rec-2026-10-07-09-34-12.jsonl") !== null);
eq("認不得的檔名回 null", parseRecStamp("mydata.jsonl"), null);
{
  const start = parseRecStamp("rec-20261007-093412.jsonl")!;
  const span = (syn.tMax - syn.tMin) * 1000;
  const g1 = coachGate("rec-20261007-093412.jsonl", syn, start + span + 60_000);
  const g2 = coachGate("rec-20261007-093412.jsonl", syn, start + span + 6 * 60_000);
  eq("末批距現在 1 分鐘 → 閘關著", g1.open, false);
  ok("關著時說得出還要多久", (g1.waitMs ?? 0) > 3.9 * 60_000, String(g1.waitMs));
  eq("末批距現在 6 分鐘 → 閘打開", g2.open, true);
  const g3 = coachGate("mydata.jsonl", syn, Date.now());
  eq("檔名認不得 → 預設鎖住", g3.open, false);
  ok("並說出判斷不出來的理由", g3.basis.includes("預設鎖住"), g3.basis);
}
eq("閘關著時 Vision 不給過", gateAllows(K.bestRange, false), false);
eq("閘關著時 Aim 不給過", gateAllows(K.aimDelta, false), false);
eq("閘關著時 TargetL 不給過", gateAllows(K.targetL, false), false);
eq("閘關著時 SL 照給", gateAllows(K.sl, false), true);
eq("閘開著時 Vision 給過", gateAllows(K.bestRange, true), true);
{
  const proj = projectLog(syn, false);
  ok("投影 log 濾掉 coachRisk key", !proj.has(K.bestRange) && !proj.has(K.targetL), proj.keys().length + " 個 key");
  ok("投影 log 保留其餘 key 與末值", proj.has(K.sl) && proj.latest.get(K.driveState) === syn.latest.get(K.driveState));
}

// ══ 5. 書籤 ══════════════════════════════════════════════════════════
console.log("\n── 書籤 ──────────────────────────────────────────────────");
const fp = logFingerprint("rec-a.jsonl", syn);
eq("指紋是 8 碼十六進位", /^[0-9a-f]{8}$/.test(fp), true);
eq("同一份 log 指紋一致", logFingerprint("rec-a.jsonl", syn), fp);
ok("換檔名指紋就不同", logFingerprint("rec-b.jsonl", syn) !== fp);
addBookmark(fp, 12.5, "way 卡了", 1);
addBookmark(fp, 4.0, "起步偏", 2);
eq("書籤存得回來且依時間排序", loadBookmarks(fp).map((b) => b.t).join(), "4,12.5");
addBookmark(fp, 12.5, "way 卡了（改）", 3);
eq("同一時刻只留一顆（改標籤不疊）", loadBookmarks(fp).length, 2);
eq("改到的是標籤", loadBookmarks(fp)[1].label, "way 卡了（改）");
removeBookmark(fp, 4.0);
eq("刪得掉", loadBookmarks(fp).length, 1);
eq("別份 log 的書籤不互相污染", loadBookmarks(logFingerprint("rec-b.jsonl", syn)).length, 0);

// ══ 6. 真檔案 ════════════════════════════════════════════════════════
console.log("\n── 真檔案 ────────────────────────────────────────────────");
const dir = "C:/Users/feihong/Desktop/FGC2026/fake-hub/fake-rec";
let file = process.argv[2];
if (!file && fs.existsSync(dir)) {
  // 挑最大的 rec-*.jsonl：最新的那個常常是假伺服器**正在寫**的 10 秒殘檔
  const cands = fs
    .readdirSync(dir)
    .filter((f) => /^rec-.*\.jsonl$/.test(f))
    .map((f) => ({ f: path.join(dir, f), size: fs.statSync(path.join(dir, f)).size }))
    .sort((a, b) => b.size - a.size);
  if (cands.length) file = cands[0].f;
}
if (file && fs.existsSync(file)) {
  const log = new LogStore(path.basename(file));
  const text = fs.readFileSync(file, "utf8");
  const res = parseJsonlText(text, (b) => log.applyBatch(b.d, b.t));
  const t0 = Date.now();
  const real: LogEvent[] = detect(log);
  const ms = Date.now() - t0;
  const cnt = (k: EventKind) => real.filter((e) => e.kind === k).length;
  console.log("  " + path.basename(file));
  console.log(
    "  " +
      log.batchCount +
      " 批 / " +
      res.bad +
      " 壞行 / t=" +
      log.tSource +
      " / " +
      (log.tMax - log.tMin).toFixed(1) +
      " s / " +
      log.keys().length +
      " 欄位 / " +
      log.samples.toLocaleString("en-US") +
      " 樣本",
  );
  console.log(
    "  detect " +
      real.length +
      " 筆 / " +
      ms +
      " ms　" +
      (Object.keys(KIND_LABEL) as EventKind[]).map((k) => KIND_LABEL[k] + " " + cnt(k)).join(" · "),
  );
  ok("真檔案：SHOOT 事件 >= 6（事件軌上至少六個標記）", cnt("shoot") >= 6, String(cnt("shoot")));
  ok("真檔案：每次 SHOOT 都有達速事件", cnt("spinup") >= cnt("shoot") - 1, cnt("spinup") + "/" + cnt("shoot"));
  ok("真檔案：偵測到球 dip", cnt("dip") > 0, String(cnt("dip")));
  ok("真檔案：全掃 < 200 ms（即時 1 Hz 重算撐得住）", ms < 200, ms + " ms");
  ok("真檔案：事件依時間排序", real.every((e, i) => i === 0 || real[i - 1].t <= e.t));
  const clipR = toJsonlClip(log, { t0: log.tMin + 5, t1: log.tMin + 15, label: "10 s" });
  const backR = new LogStore("backR");
  parseJsonlText(clipR, (b) => backR.applyBatch(b.d, b.t));
  ok(
    "真檔案：10 s 剪輯的欄位數與原檔一致",
    backR.keys().length === log.keys().length,
    backR.keys().length + " vs " + log.keys().length,
  );
  const kb = Buffer.byteLength(clipR) / 1024;
  console.log("  10 s 剪輯 " + kb.toFixed(0) + " KB（原檔 " + (fs.statSync(file).size / 1024 / 1024).toFixed(1) + " MB）");
} else {
  console.log("  （沒有找到錄影檔，跳過真檔案那一段）");
}

console.log("\n" + (fail === 0 ? "OK：" : "FAIL：") + pass + "/" + (pass + fail) + " 通過");
process.exit(fail === 0 ? 0 : 1);
