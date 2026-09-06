// FGC 頂欄（44 px，永遠存在；MATCH 只剩四項）。
//
//   [模式徽章] [Build] [OpMode] │ ws age · 8080 燈 │ ⌁電壓 · loop p50/p95 │ ⏺錄影行數 │ Thr │ [分頁]
//
// 每一欄都有它非在頂欄不可的理由（§2.3）：
//   Build    賽場上最常被問的是「你們現在跑的是哪一版」，比任何波形都常被問
//   ws age   ws 沒斷但 OpMode 卡住很常見，ping 會騙人 —— 看的是最後一批的年齡
//   8080 燈  兩條通道會各自壞，合成一顆燈會誤診
//   錄影行數 比賽日整套方案唯一有價值的產出就是那個 jsonl，行數在動是它活著的唯一證據
//   Thr      != 1 就是殭屍推播執行緒（舊 ClassLoader 沒收工），最難查的症狀之一
//
// 500 ms 強制重繪讓數字持續變舊：遙測斷流時畫面不可以凍在最後一個看起來很健康的數字上。

import type { ReactNode } from "react";
import { store } from "../../../lib/store";
import { client } from "../../../lib/RobotClient";
import { K } from "../../lib/fgcKeys";
import { liveLog } from "../../lib/LogStore";
import { FGC, httpPort } from "../../lib/profile";
import { percentiles } from "../../lib/stats";
import { useAppMode, useLink, useLogVersion, useTick } from "../../lib/hooks";
import { LIMITS, toneByThreshold } from "../../lib/tone";
import { SettingsMenu } from "./SettingsMenu";

interface Props {
  host: string;
  setHost: (h: string) => void;
  /** 分頁列；MATCH 下 App 直接不傳（整條不 render，不是 disabled）。 */
  tabs?: ReactNode;
  /**
   * 齒輪（主題／密度／埠／設定備份）。MATCH 下 App 直接不傳 —— 沒有這個 callback
   * 就沒有齒輪，所以「MATCH 下零輸入元件」不是靠一個 if 記得寫，是靠沒有東西可傳。
   */
  onPortsChanged?: () => void;
}

function Stat({
  label,
  value,
  width = 5,
  tone,
  title,
  unit,
  clip,
  className,
}: {
  label?: string;
  value: string;
  width?: 4 | 5 | 6 | 8;
  tone?: "warn" | "err" | "stale";
  title?: string;
  unit?: string;
  /** 長度不可預測的字串（Build tag、OpMode 名稱）：超出就省略號，全文進 title。
      不設上限的話一個 24 字的 build tag 會把分頁列擠出畫面外——實測 1440 寬時
      整條頂欄 scrollWidth 1439 > clientWidth 1410，最右邊的「訊號」被切掉。 */
  clip?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`fgc-stat w${width}${tone ? " " + tone : ""}${clip ? " clip" : ""}${className ? " " + className : ""}`}
      title={clip && title ? `${title}　=　${value}` : title}
    >
      {label && <span className="label">{label}</span>}
      <span className="value">{value}</span>
      {unit && <span className="fgc-unit">{unit}</span>}
    </span>
  );
}

/** 全域四態 → Stat 的 tone（ok 不上色，因為頂欄一半的欄位都是 ok，上色等於沒上色）。 */
function statTone(t: "ok" | "warn" | "err" | "stale"): "warn" | "err" | "stale" | undefined {
  return t === "ok" ? undefined : t;
}

export function ConnectionBar({ host, setHost, tabs, onPortsChanged }: Props) {
  const mode = useAppMode();
  const link = useLink();
  useLogVersion();
  useTick(500);

  const replay = client.replayLog !== null;
  const build = liveLog.latestStr(K.build) || (link.health?.kind === "ok" ? link.health.info.build : "");
  const opMode = liveLog.latestStr(K.opMode);

  const ageMs = store.lastBatchAt >= 0 ? (store.now() - store.lastBatchAt) * 1000 : -1;
  const stale = ageMs < 0 || ageMs > FGC.staleMs;

  const health = link.health;
  const healthOk = health?.kind === "ok";
  const healthDisabled = health?.kind === "disabled";
  const healthAgeS = link.healthAt > 0 ? (Date.now() - link.healthAt) / 1000 : -1;

  const battery = liveLog.latestNum(K.battery, NaN);
  const threads = healthOk ? health.info.threads : liveLog.latestNum(K.threads, NaN);
  const recLines = healthOk ? health.info.recLines : liveLog.latestNum(K.recLines, NaN);
  const recPending = healthOk ? health.info.recPending : NaN;

  // loop p50 / p95：最近 20 秒的滾動視窗。平均 12 ms 但 p95 40 ms 的機器人手感是頓的，
  // 只看即時數字會被平均值騙過去。
  const tMax = liveLog.tMax;
  const loops = liveLog.valuesInWindow(K.loopMs, tMax - 20, tMax);
  const [p50, p95] = loops.length > 0 ? percentiles(loops, [0.5, 0.95]) : [NaN, NaN];

  const badge =
    replay
      ? { cls: "replay", glyph: "▣", text: "REPLAY" }
      : mode === "PIT"
        ? { cls: "pit", glyph: "▲", text: "PIT" }
        : mode === "MATCH"
          ? { cls: "match", glyph: "▮", text: "MATCH" }
          : { cls: "unknown", glyph: "○", text: "未知（鎖定）" };

  const lockedDown = !replay && mode !== "PIT";

  // REPLAY 的頂欄講的是另一件事：這份檔案是什麼、時戳可不可信（§4.6）。
  // 生命徵象在回放時全部是「—」，留著只會讓人以為連線壞了。
  if (replay) {
    const log = client.replayLog!;
    const [rt0, rt1] = log.tRange;
    return (
      <header className="fgc-bar">
        <span className="fgc-badge replay">
          <span className="fgc-glyph">▣</span>
          REPLAY
        </span>
        <Stat value={client.replayName} width={8} clip title="載入的錄影檔" />
        <span className="sep" />
        <Stat label="長度" value={(rt1 - rt0).toFixed(1)} unit="s" width={6} />
        <Stat label="批" value={log.batchCount.toLocaleString("en-US")} width={6} />
        <Stat
          label="t"
          value={log.tSource}
          width={6}
          tone={log.tSource === "robot" ? undefined : "warn"}
          title={
            log.tSource === "robot"
              ? "時戳來自 /FGC/Status/Match s（機器人時鐘）"
              : "時戳來自本機時鐘：所有時間量測只有 ±50 ms 精度"
          }
        />
        <span className="spacer" />
        {tabs}
        {onPortsChanged && <SettingsMenu onPortsChanged={onPortsChanged} />}
      </header>
    );
  }

  return (
    <header className="fgc-bar">
      <span className={`fgc-badge ${badge.cls}`} title="模式只來自 /FGC/Bridge/Mode；前端沒有切換它的 UI">
        <span className="fgc-glyph">{badge.glyph}</span>
        {badge.text}
      </span>

      <Stat label="Build" value={build || "—"} width={8} clip title="/FGC/Bridge/Build" tone={build ? undefined : "stale"} />

      {!lockedDown && (
        <Stat label="OpMode" value={opMode || "—"} width={8} clip title="/FGC/Status/OpMode" tone={opMode ? undefined : "stale"} />
      )}

      <span className="sep" />

      {!lockedDown && (
        <>
          <Stat
            label="ws"
            value={ageMs < 0 ? "—" : ageMs > 9999 ? "斷流" : String(Math.round(ageMs))}
            unit={ageMs >= 0 && ageMs <= 9999 ? "ms" : undefined}
            width={5}
            tone={stale ? "warn" : undefined}
            title={`距上一批遙測的時間（門檻 ${FGC.staleMs} ms）。看的不是 ping——ws 沒斷但 OpMode 卡住很常見`}
          />
          <span
            className={`fgc-dot ${stale ? "warn" : "ok"}`}
            title={link.state === "polling" ? "已退回 /dash/state.json 輪詢" : `8081 推播：${link.state}`}
          />
        </>
      )}

      <span
        className={`fgc-dot ${healthOk ? "ok" : healthDisabled ? "err" : "warn"}`}
        title={
          healthOk
            ? `8080 health 200 · gen ${health.info.gen} · ${healthAgeS.toFixed(0)} 秒前`
            : healthDisabled
              ? "GET /dash/health 回 404 = Z-DASH-OFF 已生效（橋接已停用）"
              : `8080 無回應：${health?.kind === "error" ? health.why : "尚未輪詢"}`
        }
      />
      {/* 埠可被覆寫（Driver Hub 中繼是 18080），所以這裡寫的是真的在連的那個數字 */}
      <span className="label" style={{ color: "var(--text-dim)", fontSize: "var(--fs-xs)" }}>
        {httpPort()}
      </span>

      {!lockedDown && (
        <>
          <span className="sep" />
          <Stat
            label="⌁"
            value={Number.isFinite(battery) ? battery.toFixed(1) : "—"}
            unit="V"
            width={4}
            tone={statTone(toneByThreshold(battery, LIMITS.battWarnV, LIMITS.battErrV, "low"))}
            title={`/FGC/Status/Battery V —— 驗收線 ${LIMITS.battWarnV} / ${LIMITS.battErrV} V`}
          />
          <Stat
            label="loop"
            value={
              Number.isFinite(p50) ? `${p50.toFixed(0)}/${p95.toFixed(0)}` : "—"
            }
            unit="ms"
            width={6}
            tone={statTone(toneByThreshold(p95, LIMITS.loopWarnMs, LIMITS.loopErrMs))}
            title={`/FGC/Status/Loop ms 的 p50 / p95（最近 20 秒滾動視窗）。驗收線 ${LIMITS.loopErrMs} ms`}
          />
        </>
      )}

      <span className="sep" />

      <Stat
        label="⏺"
        value={Number.isFinite(recLines) ? Math.round(recLines).toLocaleString("en-US") : "—"}
        unit="行"
        width={8}
        tone={Number.isFinite(recLines) ? undefined : "stale"}
        title="/dash/health 的 reclines —— 比賽日唯一有價值的產出就是那個 jsonl，行數在動是它活著的唯一證據"
      />
      {Number.isFinite(recPending) && (
        // 1200 以下讓位給分頁列：待寫是「行數為什麼還沒跳」的註腳，
        // 而行數本身還在。分頁列被擠掉的話滑鼠就換不了頁了。
        <Stat
          label="待寫"
          value={String(Math.round(recPending))}
          width={4}
          className="hide-lt-1200"
          title="recpending：還沒 flush 到檔案的行數（FLUSH_MS=10000）"
        />
      )}

      <Stat
        label="Thr"
        value={Number.isFinite(threads) ? String(Math.round(threads)) : "—"}
        width={4}
        tone={!Number.isFinite(threads) ? "stale" : threads !== 1 ? "err" : undefined}
        title="/FGC/Bridge/Threads —— != 1 就是殭屍推播執行緒（舊 ClassLoader 沒收工），重開 Hub 電源"
      />

      <span className="spacer" />

      {/* host 輸入框只在 PIT。TRG Appendix E 預告會有「Changing the Name of the
          Control Hub」，志工可能在檢錄時改名或改 5 GHz，所以不能寫死；
          但 MATCH／未知一律不 render（不是 disabled）。 */}
      {mode === "PIT" && !replay && (
        <input
          className="fgc-host hide-lt-1200"
          value={host}
          spellCheck={false}
          onChange={(e) => setHost(e.target.value)}
          placeholder="Control Hub 位址"
          title="連不上時：Control Hub 可能已改名或改成 5 GHz"
        />
      )}

      {tabs}

      {/* 齒輪固定在最右：它的下拉是 position:fixed 靠右對齊，
          放在分頁列右邊才會從按鈕底下長出來而不是從別的地方 */}
      {onPortsChanged && mode === "PIT" && <SettingsMenu onPortsChanged={onPortsChanged} />}
    </header>
  );
}
