// 第二階段 A 的純函式自我檢查：燈牆判定、關閉路徑三格、rec.json 解析、檔名白名單。
//
// 燈牆的判定是「能不能上場」的最終答案，所以它必須能在沒有瀏覽器、沒有機器人的
// 情況下被驗證。這一支就是為了那件事存在的——盯畫面盯不出「11.4 V 到底算不算 err」。
//
// 跑法（不需要動 package.json）：
//   npx esbuild tools/fgc-check-2a.ts --bundle --platform=node --format=esm \
//     --outfile=.fgc-check-2a.mjs --log-level=warning && node .fgc-check-2a.mjs

import { LogStore } from "../src/fgc/lib/LogStore.ts";
import { K, TUNABLES, paramKey, buildParamKey } from "../src/fgc/lib/fgcKeys.ts";
import type { HealthState, HealthInfo } from "../src/fgc/lib/health.ts";
import {
  buildChecks,
  checksToMarkdown,
  summarizeChecks,
  EMPTY_TREND,
  type CheckCtx,
  type Check,
  type RecTrend,
} from "../src/fgc/components/health/checks.ts";
import { buildShutdown } from "../src/fgc/components/health/shutdown.ts";
import { parseRecList, robotAcceptsName } from "../src/fgc/components/rec/recList.ts";

let failed = 0;
let checks = 0;

function ok(cond: boolean, what: string, detail = ""): void {
  checks++;
  if (cond) console.log(`  PASS  ${what}${detail ? "  " + detail : ""}`);
  else {
    failed++;
    console.log(`  FAIL  ${what}${detail ? "  " + detail : ""}`);
  }
}

function section(t: string) {
  console.log(`\n${t}`);
}

// ── 假資料 ─────────────────────────────────────────────────────────────

function health(patch: Partial<HealthInfo> = {}): HealthState {
  return {
    kind: "ok",
    info: {
      build: "B7f3a2",
      gen: 4,
      threads: 1,
      mode: "PIT",
      enabled: true,
      viewers: 1,
      camsrc: true,
      rec: "rec-1.jsonl",
      recLines: 2413,
      recPending: 12,
      lastError: "",
      keys: 121,
      at: Date.now(),
      ...patch,
    },
  };
}

function trend(delta: number, windowS = 40, lines = 2413): RecTrend {
  return { lines, delta, windowS, rate: windowS > 0 ? delta / windowS : NaN };
}

/** 一份「全部健康」的 log：每個 key 都有兩個不同的值，所以 everChanged 成立。 */
function goodLog(): LogStore {
  const log = new LogStore("t");
  const base: Record<string, number | string | boolean> = {
    [K.matchS]: 0,
    [K.build]: "B7f3a2",
    [K.threads]: 1,
    [K.viewers]: 1,
    [K.battery]: 12.4,
    [K.loopMs]: 11,
    [K.visionFps]: 22,
    [K.visionEnabled]: true,
    [K.sl]: 1900,
    [K.sr]: 1897,
    [K.way]: 1802,
    [K.climbPos]: 0,
    [K.climbHolding]: false,
    [K.hopperCmd]: 0,
    [K.bestId]: 102,
    [K.bestRange]: 3.24,
    [K.bestAge]: 0.1,
  };
  for (const t of TUNABLES) {
    const v = t.kind === "bool" ? true : t.min + (t.max - t.min) / 2;
    base[paramKey(t.name)] = v;
    base[buildParamKey(t.name)] = v;
  }
  log.applyBatch(base);
  log.applyBatch({
    [K.matchS]: 1,
    [K.sl]: 1904,
    [K.sr]: 1893,
    [K.way]: 1810,
    [K.hopperCmd]: 1,
    [K.loopMs]: 12,
  });
  return log;
}

function ctxOf(patch: Partial<CheckCtx> = {}): CheckCtx {
  return {
    now: Date.now(),
    linkState: "live",
    health: health(),
    healthAgeMs: 1000,
    wsAgeMs: 40,
    helloAt: Date.now() - 5000,
    recTrend: trend(120),
    log: goodLog(),
    loopP50: 11,
    loopP95: 19,
    ...patch,
  };
}

const byId = (cs: Check[], id: string): Check => {
  const c = cs.find((x) => x.id === id);
  if (!c) throw new Error(`no check "${id}"`);
  return c;
};

// ── 1. 形狀 ────────────────────────────────────────────────────────────

section("燈牆：形狀與完整性");
{
  const cs = buildChecks(ctxOf());
  ok(cs.length === 15, "剛好 15 項（5 x 3 燈牆）", `實際 ${cs.length}`);
  ok(new Set(cs.map((c) => c.id)).size === 15, "id 不重複");
  ok(
    cs.every((c) => c.name.length > 0 && c.detail.length > 0),
    "每一格都有名稱與值：永遠不顯示空白（把「數值消失」誤讀成「值是 0」是最貴的一種誤判）",
  );
  ok(
    cs.every((c) => c.ok === (c.state === "ok")),
    "ok 與 state 一致：warn / stale 一律不算通過",
  );
  ok(cs.filter((c) => c.fingerprint).length === 3, "剛好三顆指紋燈");
  ok(
    cs.every((c) => c.ok || !!c.hint),
    "沒通過的每一格都有處置提示",
  );
  const s = summarizeChecks(cs);
  ok(s.go && s.passed === 15, "健康的 ctx 下 15/15 通過且 go=true", `passed=${s.passed} errs=${s.errs}`);
}

// ── 2. 預設鎖住 / 沒有資料時不可以看起來很健康 ──────────────────────

section("燈牆：什麼都沒有的時候");
{
  const cs = buildChecks(
    ctxOf({ health: null, healthAgeMs: -1, wsAgeMs: -1, helloAt: 0, recTrend: EMPTY_TREND, log: new LogStore("empty"), loopP50: NaN, loopP95: NaN }),
  );
  const s = summarizeChecks(cs);
  ok(!s.go, "全空 → go = false（不是「沒有壞消息就是好消息」）");
  ok(s.passed === 0, "全空 → 0 項通過", `passed=${s.passed}`);
  ok(byId(cs, "ws").state === "err", "沒有任何一批 → 8081 推播 err");
  ok(byId(cs, "health").state === "err", "沒有 health → 8080 err");
  ok(byId(cs, "rec").state === "stale", "沒有 reclines → 錄影格是 stale 而不是 err（不知道 != 停了）");
}

// ── 3. 三顆指紋燈 ──────────────────────────────────────────────────────

section("燈牆：三顆指紋燈");
{
  ok(byId(buildChecks(ctxOf({ health: health({ threads: 2 }) })), "threads").state === "err", "Threads=2 → err（殭屍推播執行緒）");
  ok(byId(buildChecks(ctxOf({ health: health({ threads: 1 }) })), "threads").state === "ok", "Threads=1 → ok");

  const mism = byId(buildChecks(ctxOf({ health: health({ build: "OTHER" }) })), "build");
  ok(mism.state === "err", "8080 與 8081 的 Build 不一致 → err（委派凍結在舊 ClassLoader）");
  ok(mism.detail.includes("B7f3a2") && mism.detail.includes("OTHER"), "不一致時兩個值都要寫出來", mism.detail);

  const nsFail = byId(
    buildChecks(ctxOf({ wsAgeMs: -1, helloAt: 0, health: health({ viewers: 2 }) })),
    "ws",
  );
  ok(
    nsFail.state === "err" && !!nsFail.hint && nsFail.hint.includes("subscribeToNamespace"),
    "Viewers>=1 + 從未 hello → 提示指向握手而不是網路",
  );
  ok(byId(buildChecks(ctxOf({ wsAgeMs: 300 })), "ws").state === "warn", "ws age 300 ms → warn（門檻 250）");
  ok(byId(buildChecks(ctxOf({ wsAgeMs: 40 })), "ws").state === "ok", "ws age 40 ms → ok");
}

// ── 4. Z-DASH-OFF ──────────────────────────────────────────────────────

section("燈牆：Z-DASH-OFF（health 404）");
{
  const cs = buildChecks(ctxOf({ health: { kind: "disabled", status: 404 }, recTrend: EMPTY_TREND }));
  const h = byId(cs, "health");
  ok(h.state === "err" && h.detail.includes("404"), "health 404 → err 且寫出 404", h.detail);
  ok(!!h.hint && h.hint.includes("Z-DASH-ON"), "提示要講怎麼恢復");
  ok(byId(cs, "rec").detail.includes("沒有 reclines"), "停用時錄影格顯示「沒有讀數」——真機在停用後仍然照錄，只是看不到");
}

// ── 5. 錄影行數的視窗 ──────────────────────────────────────────────────

section("燈牆：錄影行數（flush 是每 10 秒一階）");
{
  ok(byId(buildChecks(ctxOf({ recTrend: trend(647, 42) })), "rec").state === "ok", "42 秒內 +647 行 → ok");
  ok(byId(buildChecks(ctxOf({ recTrend: trend(0, 42) })), "rec").state === "err", "42 秒內 0 行 → err");
  ok(
    byId(buildChecks(ctxOf({ recTrend: trend(0, 8) })), "rec").state === "stale",
    "只觀察 8 秒 → stale（不到一個 flush 週期就宣告停了，會有三分之二的時間誤判）",
  );
  ok(byId(buildChecks(ctxOf({ recTrend: trend(0, 8) })), "rec").detail.includes("觀察中"), "樣本不足時要說「觀察中」");
}

// ── 6. 數值門檻 ────────────────────────────────────────────────────────

section("燈牆：驗收線");
{
  const bat = (v: number) => {
    const log = goodLog();
    log.applyBatch({ [K.matchS]: 2, [K.battery]: v });
    return byId(buildChecks(ctxOf({ log })), "battery").state;
  };
  ok(bat(12.4) === "ok", "電池 12.4 V → ok");
  ok(bat(11.7) === "warn", "電池 11.7 V → warn（12.0 是第一條線）");
  ok(bat(11.4) === "err", "電池 11.4 V → err（11.5 是第二條線）");

  const loop = (p95: number) => byId(buildChecks(ctxOf({ loopP95: p95 })), "loop").state;
  ok(loop(19) === "ok", "loop p95 19 ms → ok");
  ok(loop(22) === "warn", "loop p95 22 ms → warn");
  ok(loop(30) === "err", "loop p95 30 ms → err（驗收線 25）");

  const fps = (v: number) => {
    const log = goodLog();
    log.applyBatch({ [K.matchS]: 2, [K.visionFps]: v });
    return byId(buildChecks(ctxOf({ log })), "visionfps");
  };
  ok(fps(22).state === "ok", "視覺 22 fps → ok");
  ok(fps(12).state === "warn", "視覺 12 fps → warn");
  ok(fps(8).state === "err", "視覺 8 fps → err");
  ok(fps(14.6).detail.startsWith("14.6"), "視覺 fps 用一位小數：整數會出現「15（偏低）」這種自打嘴巴的字", fps(14.6).detail);
}

// ── 7. 編碼器：問的是「有沒有變過」 ────────────────────────────────────

section("燈牆：編碼器與 hopper 問的是「有沒有變過」");
{
  const frozen = new LogStore("frozen");
  frozen.applyBatch({ [K.matchS]: 0, [K.sl]: 0, [K.sr]: 0, [K.way]: 0, [K.hopperCmd]: 0 });
  frozen.applyBatch({ [K.matchS]: 1, [K.sl]: 0, [K.sr]: 0, [K.way]: 0, [K.hopperCmd]: 0 });
  const cs = buildChecks(ctxOf({ log: frozen }));
  ok(byId(cs, "sl").state === "warn", "SL 兩批都同一個值 → warn（編碼器線可能沒插）");
  ok(byId(cs, "sl").detail.includes("整段沒變過"), "而且要講出來為什麼", byId(cs, "sl").detail);
  ok(byId(cs, "hopper").state === "warn", "hopper Cmd 沒變過 → warn");
  ok(byId(buildChecks(ctxOf()), "sl").state === "ok", "值有變過 → ok");
  ok(byId(buildChecks(ctxOf({ log: new LogStore("e") })), "sl").state === "stale", "key 從沒出現 → stale");
}

// ── 8. 值 = 建置值 ─────────────────────────────────────────────────────

section("燈牆：值 = 建置值");
{
  ok(byId(buildChecks(ctxOf()), "paramdiff").state === "ok", "21 項一致 → ok");

  const drift = goodLog();
  drift.applyBatch({ [K.matchS]: 2, [paramKey("VEL_SL")]: 9999 });
  const d = byId(buildChecks(ctxOf({ log: drift })), "paramdiff");
  ok(d.state === "warn", "有漂移 → warn 而不是 err（調參中不該一直亮紅）");
  ok(d.detail.includes("VEL_SL"), "要點名是哪一項", d.detail);
  ok(!!d.hint && d.hint.includes("fgc-tune.json"), "提示要講怎麼保住（volatile 只活在 RAM）");

  const noBuild = new LogStore("nb");
  const b: Record<string, number> = { [K.matchS]: 0 };
  for (const t of TUNABLES) b[paramKey(t.name)] = 1;
  noBuild.applyBatch(b);
  ok(byId(buildChecks(ctxOf({ log: noBuild })), "paramdiff").state === "stale", "機器人端沒有 Build <NAME> 埋點 → stale");
}

// ── 9. 匯出 ────────────────────────────────────────────────────────────

section("燈牆：複製結果");
{
  const cs = buildChecks(ctxOf({ loopP95: 30 }));
  const md = checksToMarkdown(cs, "B7f3a2", Date.UTC(2026, 9, 7, 1, 2, 3));
  ok(cs.every((c) => md.includes(c.name)), "Markdown 含每一項");
  ok(md.includes("NO GO"), "有 err 時標題寫 NO GO");
  ok(md.includes("## 處置"), "沒過的項目要帶處置段落");
}

// ── 10. 關閉路徑三格 ───────────────────────────────────────────────────

section("關閉路徑三格：判定依據是可觀測狀態");
{
  const cells = (p: Parameters<typeof buildShutdown>[0]) => buildShutdown(p);
  const live = cells({ health: health(), wsAgeMs: 40, recTrend: trend(120) });
  ok(live.length === 3, "三格");
  ok(live[0].active === false && live[1].active === false && live[2].active === false, "一切正常 → 三格都不亮");

  const dead = cells({ health: { kind: "error", why: "fetch failed" }, wsAgeMs: -1, recTrend: EMPTY_TREND });
  ok(dead[0].active === true, "8080 與 8081 都沒回應 → (1) 未連筆電");
  ok(dead[1].active === false, "但 (2) 不亮：分不出「停用」與「斷線」時不可以宣稱停用");
  ok(dead[1].basis.includes("分不出"), "而且要講出來分不出來", dead[1].basis);
  ok(dead[2].active === false, "(3) 也不亮：8080 沒通就判斷不出 fallback");

  const off = cells({ health: { kind: "disabled", status: 404 }, wsAgeMs: -1, recTrend: EMPTY_TREND });
  ok(off[1].active === true, "health 404 → (2) Z-DASH-OFF 生效");
  ok(off[0].active === false, "(1) 不亮：筆電是連著的，是橋接被關掉");
  ok(off[1].basis.includes("404"), "判定依據要寫出 404", off[1].basis);

  const fb = cells({ health: health(), wsAgeMs: -1, recTrend: trend(0, 40) });
  ok(fb[2].active === true, "橋接活著但遙測與錄影都停了 → (3)");
  const unknown = cells({ health: health(), wsAgeMs: -1, recTrend: trend(0, 5) });
  ok(unknown[2].active === null, "樣本不足 → (3) 是「不知道」而不是 false");
  ok(
    fb[2].how.includes("不碰 DashHub"),
    "而且要講清楚 Z-FALLBACK-v2 不會回報自己，這一格是反推的",
  );
}

// ── 11. rec.json 解析與檔名 ────────────────────────────────────────────

section("RecBrowser：rec.json 解析與檔名白名單");
{
  const real = parseRecList({
    dir: "/sdcard/FIRST/fgc-rec",
    current: "rec-b.jsonl",
    files: [
      { name: "rec-a.jsonl", size: 100, mtime: 1000 },
      { name: "rec-b.jsonl", size: 200, mtime: 3000 },
      { name: "rec-c.jsonl", size: 300, mtime: 2000 },
    ],
  });
  ok(real.files.length === 3 && real.current === "rec-b.jsonl", "解出三個檔與 current");
  ok(real.files[0].name === "rec-b.jsonl", "依 mtime 由新到舊排序", real.files.map((f) => f.name).join(","));

  const junk = parseRecList({ files: [{ size: 1 }, null, "x", { name: "rec-x.jsonl" }] });
  ok(junk.files.length === 1 && junk.files[0].size === 0, "壞資料不整支炸掉，缺的欄位補 0");
  ok(parseRecList(null).files.length === 0, "null 也不炸");
  ok(parseRecList([]).files.length === 0, "舊版的裸陣列格式回 0 個檔（真機是 {dir,current,files}）");

  ok(robotAcceptsName("rec-20261007-094012.jsonl"), "rec-*.jsonl 可以拉");
  ok(!robotAcceptsName("real-B1PIT-174830.jsonl"), "手動拷進去的檔名拉不下來（safeName 只收 rec- 開頭）");
  ok(!robotAcceptsName("live"), "live 不是檔名");
  ok(!robotAcceptsName("../../etc/passwd"), "路徑穿越拒絕");
  ok(!robotAcceptsName("rec-x.txt"), "副檔名不對拒絕");
  ok(!robotAcceptsName("rec-" + "x".repeat(70) + ".jsonl"), "超過 64 字拒絕");
}

console.log(`\n${failed === 0 ? "OK" : "FAILED"}：${checks - failed}/${checks} 通過`);
process.exit(failed === 0 ? 0 : 1);
