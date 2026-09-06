// Lockdown：MATCH（以及任何「模式未知」）時整個 App 只 render 這一頁。
//
// 零輸入元件——分頁列、host 框、滑桿都**不存在**而非 disabled。
// 當場示範只要兩秒：切 MATCH，螢幕上根本沒有滑桿；切 PIT，拖一下值會動。
//
// 錄影心跳卡用 GET /dash/health 的 reclines：那條路徑在 MATCH 也回 200 且不含
// 任何比賽資料（DashHttp.java:87-108，註解明寫「MATCH 也可以看」），所以
// **比賽期間這個數字是真的會動的**。三案都把「封鎖 vs 死亡分不出來」列為未解缺口
// 並建議去函 FIRST——不需要，機器人端已經做完了。
//
// M11 明確劃線：本頁只顯示機器人自身的健康狀態（build / mode / 錄影行數 / threads /
// gen），任何 /FGC/Shooter、/FGC/Vision、/FGC/Drive、/FGC/Aim 的值一律不顯示。

import { client } from "../../lib/RobotClient";
import { store } from "../../lib/store";
import { PATHS } from "../lib/profile";
import { useLink, useTick } from "../lib/hooks";
import "../styles/lockdown.css";

export function LockdownPage({ host }: { host: string }) {
  const link = useLink();
  useTick(1000);

  const health = link.health;
  const ok = health?.kind === "ok";
  const disabled = health?.kind === "disabled";
  const info = ok ? health.info : null;
  const ageS = link.healthAt > 0 ? (Date.now() - link.healthAt) / 1000 : -1;
  const neverConnected = link.helloAt === 0 && !ok;
  const clock = new Date().toLocaleTimeString("zh-TW", { hour12: false });

  return (
    <div className="lockdown">
      <div className="lockdown-hero">
        <div className="lockdown-slab">比 賽 模 式 鎖 定</div>
        <div className="lockdown-rule">
          依 M01 / M09 / M11：遙測已封鎖，本機不存在任何控制路徑
          <br />
          8081 不推播 · <code>/dash/state.json</code> 503 · MJPEG 503 · 只在機器人上錄影
          <br />
          {store.mode === "UNKNOWN" && (
            <span style={{ color: "var(--danger)" }}>
              目前模式未知（尚未收到 hello 或已斷線）——未知即鎖，不是未知即開放
            </span>
          )}
        </div>
        <div className="lockdown-rule" style={{ fontFamily: "var(--mono)" }}>
          {clock}
        </div>
      </div>

      <div className="lockdown-cards">
        <div className="lockdown-card">
          <h3>
            <span className={`fgc-glyph ${ok ? "ok" : "stale"}`}>{ok ? "●" : "○"}</span>
            機器人端錄影中
            <span className="src">來源：GET {PATHS.health}</span>
          </h3>
          {info ? (
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
            </div>
          ) : (
            <div className="rec-line">
              <span className="v" style={{ color: "var(--stale)" }}>
                {disabled
                  ? "health 回 404 —— Z-DASH-OFF 已生效，橋接已停用（這是關閉路徑②的判定依據）"
                  : `8080 無回應（${host}）。錄影是否在進行無法判斷。`}
              </span>
            </div>
          )}
        </div>

        <div className="lockdown-card">
          <h3>場上的三個判斷都在 Driver Hub</h3>
          <ul className="lockdown-list">
            <li>READY / SPINUP … telemetry 第 1 行</li>
            <li>TAG range … telemetry</li>
            <li>建議射速 … telemetry</li>
          </ul>
          <div style={{ color: "var(--text-dim)", fontSize: "var(--fs-xs)" }}>
            本卡刻意不顯示任何數值：它是導覽，不是顯示器。
          </div>
        </div>

        <div className="lockdown-card">
          <h3>賽後取檔（比賽結束、切 B1-PIT 之後）</h3>
          <ul className="lockdown-list">
            <li>
              8080　<code>GET {PATHS.recList}</code>
            </li>
            <li>
              備援　OnBotJava 檔案樹 <code>/sdcard/FIRST/fgc-rec</code>
            </li>
          </ul>
          <div style={{ color: "var(--text-dim)", fontSize: "var(--fs-xs)" }}>
            本頁不提供下載按鈕。<code>?name=live</code> 一律不呼叫——那條路徑會回這一場的全部遙測。
          </div>
        </div>

        {neverConnected && (
          <div className="lockdown-card">
            <h3>
              <span className="fgc-glyph stale">○</span>
              連線設定
            </h3>
            <div className="lockdown-list" style={{ listStyle: "none", paddingLeft: 0 }}>
              目前 host：<code>{host}</code>
              <br />
              本頁沒有輸入框（M06）。要換位址請用網址參數 <code>?host=10.0.0.2</code>，
              或先在 Driver Hub 選 <code>B1-PIT</code> 進 PIT 模式。
              <br />
              連不上時第一個要問的是：Control Hub 是不是改名了、或改成 5 GHz 了。
            </div>
          </div>
        )}
      </div>

      <div className="lockdown-foot">
        本頁沒有任何輸入元件。要調參請在 Driver Hub 選 <code>B1-PIT</code>。
        {client.replayLog === null && link.nextRetryAt > 0 && (
          <>
            {" · "}
            下次重試 {Math.max(0, Math.round((link.nextRetryAt - Date.now()) / 1000))} 秒後
          </>
        )}
      </div>
    </div>
  );
}
