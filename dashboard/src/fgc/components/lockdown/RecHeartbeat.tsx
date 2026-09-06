// Lockdown 的錄影心跳卡。
//
// 這張卡是整個 Lockdown 頁唯一「會動」的東西，而它會動這件事本身就是資訊：
// 三案都寫「MATCH 期間錄影行數不會更新是正常的」——**這是錯的**。
// /dash/health 在 MATCH 也回 200 且含 reclines（DashHttp.java:94-115，註解明寫
// 「MATCH 也可以看（不含任何比賽資料）」），所以比賽期間這個數字是真的會動的。
//
// 這同時解掉三案都列為「未解缺口、需去函 FIRST 確認」的那一條：
// **封鎖 vs 死亡分得出來**——封鎖是「行數在動但沒有遙測」，死亡是「行數也停了」。
// 不需要去函，也不需要新程式碼。
//
// M11 劃線：這裡顯示的全部是機器人自身的健康狀態（build / mode / 行數 / threads /
// gen），沒有任何一個值可以被轉述給駕駛當作比賽建議。

import { PATHS } from "../../lib/profile";
import { Glyph } from "../shell/Glyph";
import { type Tone } from "../../lib/tone";
import { K, lockdownValue } from "../../lib/fgcKeys";
import { liveLog } from "../../lib/LogStore";
import { useLink, useTick } from "../../lib/hooks";
import { useRecTrend } from "../health/useRecTrend";

export function RecHeartbeat({ host }: { host: string }) {
  const link = useLink();
  const trend = useRecTrend(1000);
  useTick(1000);

  // Lockdown 的每一次取值都走 lockdownValue()：不在 LOCKDOWN_KEYS ∩
  // isLockdownSafeKey 裡的 key 拿到的是 null，整格不 render。以前這一頁的 M11
  // 白名單完全靠手寫 JSX，而 LockdownCards 的檔頭卻宣稱「這條線寫在旗標裡，
  // 不靠記憶」——旗標其實是死碼。現在它是真的。
  //
  // Last Notify（DashNotify.java:58）是 MATCH 期間唯一看得到「機器人剛剛喊了
  // 什麼」的埋點：即時的 notify 在 MATCH 不推播，這個 key 是那一段時間唯一的痕跡。
  // 格式是 "level:title"，零比賽資料，不違反 M11。
  const notifyRaw = lockdownValue(K.lastNotify, (k) => liveLog.latestStr(k, "")) ?? "";
  const ci = notifyRaw.indexOf(":");
  const notify = notifyRaw
    ? { level: ci > 0 ? notifyRaw.slice(0, ci) : "INFO", title: ci > 0 ? notifyRaw.slice(ci + 1) : notifyRaw }
    : null;

  const h = link.health;
  const ok = h?.kind === "ok";
  const disabled = h?.kind === "disabled";
  const info = ok ? h.info : null;
  const ageS = link.healthAt > 0 ? (Date.now() - link.healthAt) / 1000 : -1;

  // 「在動」的證據：不是有數字，是數字比上一輪大。
  const moving = Number.isFinite(trend.delta) && trend.delta > 0;
  const known = Number.isFinite(trend.delta) && trend.windowS >= 25;
  const tone: Tone = !ok ? "stale" : moving ? "ok" : known ? "err" : "stale";

  return (
    <div className="lockdown-card wide">
      <h3>
        <Glyph tone={tone} />
        {ok ? (moving ? "機器人端錄影中" : known ? "錄影行數停住了" : "機器人端錄影中（觀察中）") : "無法確認錄影狀態"}
        <span className="src">
          來源：GET {PATHS.health}　每 3 秒
        </span>
      </h3>

      {info ? (
        <>
          <div className="rec-line">
            <span>
              <span className="k">檔名</span>
              <span className="v">{info.rec || "（尚未建立）"}</span>
            </span>
            <span>
              <span className="k">行數</span>
              <span className="big">{info.recLines.toLocaleString("en-US")}</span>
            </span>
            <span>
              <span className="k">最近 {trend.windowS > 0 ? trend.windowS.toFixed(0) : "—"} 秒</span>
              <span className={`v ${moving ? "up" : ""}`}>
                {Number.isFinite(trend.delta) ? `${trend.delta > 0 ? "+" : ""}${trend.delta} 行` : "觀察中"}
              </span>
            </span>
            <span>
              <span className="k">待寫</span>
              <span className="v">{info.recPending}</span>
            </span>
            <span>
              <span className="k">gen · threads</span>
              <span className="v">
                {info.gen} · {info.threads}
              </span>
            </span>
            <span>
              <span className="k">更新於</span>
              <span className="v">{ageS >= 0 ? `${ageS.toFixed(0)} 秒前` : "—"}</span>
            </span>
            {notify && (
              <span>
                <span className="k">最後通知</span>
                <span
                  className={"v " + (notify.level === "ERROR" ? "lv-err" : notify.level === "WARN" ? "lv-warn" : "")}
                  title="/FGC/Bridge/Last Notify —— MATCH 期間 notify 不推播，這是唯一的痕跡"
                >
                  {notify.title || notify.level}
                </span>
              </span>
            )}
          </div>
          <div className="lockdown-fine">
            行數每 10 秒跳一階（flush 週期），所以要看 30 秒才判得出停沒停。
            {known && !moving && " 現在的判定是：橋接活著但沒有人在寫檔——這是「死亡」不是「封鎖」。"}
          </div>
        </>
      ) : (
        <div className="rec-line">
          <span className="v" style={{ color: "var(--stale)" }}>
            {disabled
              ? `health 回 404 —— Z-DASH-OFF 已生效，橋接已停用（這正是關閉路徑 (2) 的判定依據）`
              : `8080 無回應（${host}）。錄影是否在進行無法判斷。`}
          </span>
        </div>
      )}
    </div>
  );
}
