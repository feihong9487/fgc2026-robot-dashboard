// 資料層自我檢查：jsonl 解析 → LogStore → valueAt / sampleWindow / runs / gaps / stats。
//
// 這一支不是單元測試框架，是「地基有沒有塌」的一次性驗證，可以在沒有瀏覽器的情況下跑：
//   npm run fgc-check              （用 fake-hub 產生的假錄影檔）
//   npm run fgc-check -- <檔案>    （用真機錄的 jsonl）
//
// 用 esbuild 打包後由 node 執行（見 package.json 的 script）。

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { LogStore } from "../src/fgc/lib/LogStore.ts";
import { parseJsonlText } from "../src/fgc/lib/jsonl.ts";
import { percentiles, summarize } from "../src/fgc/lib/stats.ts";
import { K, isTunableKey, TUNABLES, tuneKey } from "../src/fgc/lib/fgcKeys.ts";

let failed = 0;
let checks = 0;

function ok(cond: boolean, what: string, detail = ""): void {
  checks++;
  if (cond) {
    console.log(`  PASS  ${what}${detail ? "  " + detail : ""}`);
  } else {
    failed++;
    console.log(`  FAIL  ${what}${detail ? "  " + detail : ""}`);
  }
}

function near(a: number, b: number, eps = 1e-9): boolean {
  return Math.abs(a - b) <= eps;
}

// ── 1. 合成資料：zero-order hold 的語意必須完全精確 ────────────────────

console.log("\n[1] LogStore ZOH / 二分搜尋（合成資料）");
{
  const log = new LogStore("synthetic");
  // 三批，機器人時戳 10 / 20 / 30 秒
  log.applyBatch({ [K.matchS]: 10, [K.sl]: 100, [K.driveState]: "COLLECT", [K.atSpeed]: false });
  log.applyBatch({ [K.matchS]: 20, [K.sl]: 200, [K.driveState]: "SHOOT", [K.atSpeed]: true });
  log.applyBatch({ [K.matchS]: 30, [K.sl]: 300 });

  ok(log.tSource === "robot", "tSource 取自 /FGC/Status/Match s", `= ${log.tSource}`);
  ok(log.batchCount === 3, "批數", `= ${log.batchCount}`);
  ok(near(log.tMin, 10) && near(log.tMax, 30), "tRange", `= [${log.tMin}, ${log.tMax}]`);

  ok(log.valueAt(K.sl, 5) === null, "第一個樣本之前回 null（不是 0，也不內插）");
  ok(log.valueAt(K.sl, 10) === 100, "邊界值取自身");
  ok(log.valueAt(K.sl, 19.999) === 100, "ZOH：兩點之間保持前值，不做線性內插");
  ok(log.valueAt(K.sl, 20) === 200, "邊界值切換");
  ok(log.valueAt(K.sl, 999) === 300, "最後一個樣本之後保持最後值");
  ok(log.updatedAt(K.sl, 25) === 20, "updatedAt：回報值是什麼時候更新的（顯示 age 用）");

  ok(log.stringAt(K.driveState, 15) === "COLLECT", "字串欄位 ZOH");
  ok(log.stringAt(K.driveState, 25) === "SHOOT", "字串欄位切換");
  ok(log.valueAt(K.atSpeed, 25) === 1, "布林存成 0/1");

  // run-length：色帶必須鋪滿整個視窗，左緣不留白
  const runs = log.runs(K.driveState, 12, 28);
  ok(runs.length === 2, "runs 合併同值", `= ${runs.length} 段`);
  ok(near(runs[0].t0, 12) && runs[0].s === "COLLECT", "runs 錨點裁到 t0", `t0=${runs[0].t0}`);
  ok(near(runs[runs.length - 1].t1, 28), "runs 尾端補到 t1");

  // 視窗取樣：一定要帶一個 t0 之前的錨點，否則穩態訊號在左緣會憑空消失
  const w = log.sampleWindow(K.sl, 21, 29, 100);
  ok(w.n === 1 && w.xs[0] === 20, "sampleWindow 帶入 t0 之前的錨點", `n=${w.n} x0=${w.xs[0]}`);
  ok(!w.decimated, "點數少於上限時不 decimate");

  // 值變化點（Alt+↓/↑ 用）
  const cp = log.changePoints(K.atSpeed);
  ok(cp.length === 2, "changePoints 只回變化點", `= ${Array.from(cp).join(",")}`);

  // 時戳倒退（機器人重開 OpMode）不可以破壞單調性
  log.applyBatch({ [K.matchS]: 1, [K.sl]: 400 });
  ok(log.resets === 1 && log.tMax === 30, "時戳倒退被吸收成 reset，時間軸仍單調", `resets=${log.resets}`);
}

// ── 2. decimation 的邊界 ──────────────────────────────────────────────

console.log("\n[2] sampleWindow min/max decimation");
{
  const log = new LogStore("decimate");
  for (let i = 0; i < 5000; i++) {
    log.applyBatch({ [K.matchS]: i * 0.05, [K.sl]: 1900 + Math.sin(i / 7) * 100 });
  }
  const raw = log.sampleWindow(K.sl, 0, 250, 100000);
  const dec = log.sampleWindow(K.sl, 0, 250, 400);
  ok(raw.n === 5000 && !raw.decimated, "maxPts 夠大時回原始樣本", `n=${raw.n}`);
  ok(dec.decimated && dec.n <= 400, "超過 maxPts 才 decimate", `n=${dec.n}`);

  const rawSum = summarize(raw.ys);
  const decSum = summarize(dec.ys);
  ok(
    near(rawSum.min, decSum.min, 1e-9) && near(rawSum.max, decSum.max, 1e-9),
    "min/max decimation 保住極值（尖峰不會被抽掉）",
    `raw [${rawSum.min.toFixed(2)}, ${rawSum.max.toFixed(2)}] dec [${decSum.min.toFixed(2)}, ${decSum.max.toFixed(2)}]`,
  );

  let mono = true;
  for (let i = 1; i < dec.n; i++) if (dec.xs[i] < dec.xs[i - 1]) mono = false;
  ok(mono, "decimate 後 x 仍單調遞增（uPlot 的前提）");
}

// ── 3. 白名單：必須逐字對應 DashParams.java ──────────────────────────

console.log("\n[3] 21 項白名單（DashParams.java NAMES/MIN/MAX）");
{
  ok(TUNABLES.length === 21, "白名單項數", `= ${TUNABLES.length}`);
  ok(isTunableKey(tuneKey("VEL_SL")), "/FGC/Tune/VEL_SL 可寫");
  ok(!isTunableKey("/FGC/Param/VEL_SL"), "/FGC/Param/VEL_SL 不可寫（那是回讀欄）");
  ok(!isTunableKey("VEL_SL"), "只給名稱不算（必須是完整的 /FGC/Tune/ key）");
  ok(!isTunableKey("/FGC/Tune/NOPE"), "不在白名單的名稱不可寫");
  ok(!isTunableKey(K.sl), "遙測 key 不可寫");
  const bools = TUNABLES.filter((t) => t.kind === "bool");
  ok(bools.length === 1 && bools[0].name === "WAIT_SPINUP", "唯一的 bool 是 WAIT_SPINUP");
  const vel = TUNABLES.find((t) => t.name === "VEL_SL")!;
  ok(vel.max === 3000 && vel.uiMax === 2400, "VEL_SL：機器人端 MAX 3000、前端幾何上限 2400（G13）");
}

// ── 4. 真檔案：jsonl streaming 解析 ───────────────────────────────────

console.log("\n[4] jsonl 解析（fake-hub 錄影檔）");
{
  const arg = process.argv[2];
  let file = arg ?? "";
  if (!file) {
    const dir = join(process.cwd(), "..", "fake-hub", "fake-rec");
    if (existsSync(dir)) {
      const files = readdirSync(dir)
        .filter((n) => n.endsWith(".jsonl"))
        .sort();
      if (files.length > 0) file = join(dir, files[files.length - 1]);
    }
  }
  if (!file || !existsSync(file)) {
    console.log("  SKIP  找不到錄影檔（先跑一次 fake-hub 產生 fake-rec/）");
  } else {
    const text = readFileSync(file, "utf8");
    const log = new LogStore("replay");
    const batches: { t: number; d: Record<string, never> }[] = [];
    const res = parseJsonlText(text, (b) => batches.push(b as never));
    log.applyBatches(batches as never);

    console.log(`  檔案 ${file}`);
    ok(res.batches > 100, "解析出批數", `= ${res.batches}`);
    ok(res.bad === 0, "沒有壞行", `bad = ${res.bad}`);
    ok(log.tSource === "robot", "時戳來源 = robot", `= ${log.tSource}`);
    ok(log.tMax - log.tMin > 10, "時間跨度", `= ${(log.tMax - log.tMin).toFixed(1)} s`);
    ok(log.keys().length > 30, "欄位數", `= ${log.keys().length}`);
    ok(log.has(K.sl) && log.has(K.driveState), "射手與狀態機欄位都在");

    // ZOH 抽查：隨機時刻的值必須等於「該時刻之前最後一個樣本」
    const mid = (log.tMin + log.tMax) / 2;
    const v = log.valueAt(K.sl, mid);
    const at = log.updatedAt(K.sl, mid)!;
    ok(v !== null && at <= mid, "任意時刻可 seek", `SL@${mid.toFixed(1)}s = ${v} （更新於 ${at.toFixed(2)}s）`);

    const iv = log.batchIntervals();
    const [p50, p95] = percentiles(iv, [0.5, 0.95]);
    ok(p50 > 0 && p50 < 0.5, "批次間隔 p50 在 50 ms 量級", `p50 ${(p50 * 1000).toFixed(1)} ms · p95 ${(p95 * 1000).toFixed(1)} ms`);

    const loops = log.valuesInWindow(K.loopMs, log.tMin, log.tMax);
    if (loops.length > 0) {
      const [lp50, lp95] = percentiles(loops, [0.5, 0.95]);
      const s = summarize(loops);
      ok(lp95 >= lp50, "loop p95 >= p50", `p50 ${lp50.toFixed(1)} p95 ${lp95.toFixed(1)} max ${s.max.toFixed(1)} ms`);
      ok(s.max > 30, "看得到 40 ms 長尾（p95 直方圖才有東西可畫）", `max = ${s.max.toFixed(1)} ms`);
    }

    const gaps = log.gaps(1.0);
    ok(gaps.length >= 0, "缺口偵測可執行", `= ${gaps.length} 處`);
    const st = log.runs(K.driveState, log.tMin, log.tMax);
    ok(st.length > 3, "狀態機 run-length", `= ${st.length} 段`);
    console.log(`  記憶體 ${(log.bytes() / 1024 / 1024).toFixed(2)} MB · 樣本 ${log.samples.toLocaleString("en-US")}`);
  }
}

console.log(`\n${failed === 0 ? "OK" : "FAILED"}：${checks - failed}/${checks} 通過\n`);
process.exit(failed === 0 ? 0 : 1);
