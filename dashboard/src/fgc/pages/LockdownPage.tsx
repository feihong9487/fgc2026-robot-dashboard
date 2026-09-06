// #29 Lockdown：MATCH（以及任何「模式未知」）時整個 App 只 render 這一頁。
//
// 零輸入元件——分頁列、host 框、滑桿都**不存在**而非 disabled。
// 當場示範只要兩秒：切 MATCH，螢幕上根本沒有滑桿；切 PIT，拖一下值會動。
// 「不存在」是可以當場示範給檢錄志工看的，「disabled」不是。
//
// 為什麼刻意「不好看」（灰階 + 一個橘徽章）：比賽日的螢幕被人看到時，
// 它應該明顯是一台關著的機器，不是一個正在工作的控制台。
//
// health 的輪詢用 RobotClient 既有的那一條（每 3 秒，比規格寫的 5 秒更密），
// 不在這裡再開第二條——同一份資料抓兩次只會讓賽場 Wi-Fi 更擠，而且兩條輪詢
// 的結果不一致時沒有人分得出該信哪一個。

import { store } from "../../lib/store";
import { useAppMode, useLink, useTick } from "../lib/hooks";
import { RecHeartbeat } from "../components/lockdown/RecHeartbeat";
import { DriverHubCard, PostMatchCard, OfflineCard } from "../components/lockdown/LockdownCards";
import "../styles/lockdown.css";

export function LockdownPage({ host }: { host: string }) {
  const mode = useAppMode();
  const link = useLink();
  useTick(1000);

  const health = link.health;
  const ok = health?.kind === "ok";
  const neverConnected = link.helloAt === 0 && !ok;
  const clock = new Date().toLocaleTimeString("zh-TW", { hour12: false });
  const build = ok ? health.info.build : "";
  const nextRetryInS =
    link.nextRetryAt > 0 ? Math.max(0, Math.round((link.nextRetryAt - Date.now()) / 1000)) : null;

  return (
    <div className="lockdown">
      <div className="lockdown-top">
        <span className="brand">FGC2026</span>
        <span className="badge">
          <span className="fgc-glyph">▮</span>
          {mode === "MATCH" ? "MATCH · LOCKDOWN" : "模式未知 · LOCKDOWN"}
        </span>
        <span className="spacer" />
        <span className="mono">Build {build || "—"}</span>
        <span className="mono">{clock}</span>
      </div>

      <div className="lockdown-hero">
        <div className="lockdown-slab">比 賽 模 式 鎖 定</div>
        <div className="lockdown-rule">
          依 M01 / M09 / M11：遙測已封鎖，本機不存在任何控制路徑
          <br />
          8081 不推播 · <code>/dash/state.json</code> 503 · <code>/dash/rec.*</code> 503 · MJPEG 503 ·
          只在機器人上錄影
          {mode === "UNKNOWN" && (
            <>
              <br />
              <span className="warnline">
                目前模式未知（尚未收到 hello 或已斷線）——<b>未知即鎖，不是未知即開放</b>
              </span>
            </>
          )}
        </div>
      </div>

      <div className="lockdown-cards">
        <RecHeartbeat host={host} />
        <DriverHubCard />
        <PostMatchCard />
        {neverConnected && <OfflineCard host={host} nextRetryInS={nextRetryInS} />}
      </div>

      <div className="lockdown-foot">
        本頁沒有任何輸入元件。要調參請在 Driver Hub 選 <code>B1-PIT</code>。
        {store.connState === "connecting" && nextRetryInS !== null && (
          <> · 重連退避中（{nextRetryInS} 秒後）——規則性靜默不是斷線，不製造重連風暴</>
        )}
      </div>
    </div>
  );
}
