// #28 HealthWall：Go/No-Go 全螢幕燈牆（5 欄 × 3 列）。
//
// 這一頁的使用情境是「上場前 30 秒」與「檢錄」，兩者的共同點是：看的人站著、
// 距離一公尺以上、而且很急。所以：
//   · 一次看完，不捲動
//   · 每一格只有三行：名稱 / 值 / （沒過才有的）處置提示
//   · 顏色不是唯一通道（●▲■○），約 8% 男性有紅綠色覺辨異
//   · 每秒強制刷新，讓「年齡」持續變舊——遙測斷流時畫面不可以凍在最後一個
//     看起來很健康的數字上（沿用 StatusPanel.tsx:12-20）
//
// 判定全部在 checks.ts 的純函式裡，這個檔案只負責畫。

import { useCallback, useState } from "react";
import { Glyph } from "../shell/Glyph";
import { client } from "../../../lib/RobotClient";
import { store } from "../../../lib/store";
import { K } from "../../lib/fgcKeys";
import { liveLog } from "../../lib/LogStore";
import { percentiles } from "../../lib/stats";
import { useLink, useLogVersion, useTick } from "../../lib/hooks";
import { buildChecks, checksToMarkdown, summarizeChecks, type Check } from "./checks";
import { ShutdownStrip } from "./ShutdownStrip";
import { useRecTrend } from "./useRecTrend";
import { copyText } from "../../lib/clipboard";

function Cell({ c }: { c: Check }) {
  return (
    <div className={`hw-cell ${c.state}`} title={c.hint}>
      <div className="hw-name">
        <Glyph tone={c.state} />
        {c.name}
        {c.fingerprint && (
          <span className="hw-fp" title="指紋燈：這一格直接指向一個具體的機器人端故障，不必再猜">
            指紋
          </span>
        )}
      </div>
      <div className="hw-detail">{c.detail}</div>
      {!c.ok && c.hint && <div className="hw-hint">{c.hint}</div>}
    </div>
  );
}

export function HealthWall() {
  useLogVersion();
  useTick(1000);
  const link = useLink();
  const recTrend = useRecTrend(0);
  const [copied, setCopied] = useState("");

  const wsAgeMs = store.lastBatchAt >= 0 ? (store.now() - store.lastBatchAt) * 1000 : -1;
  const tMax = liveLog.tMax;
  const loops = liveLog.valuesInWindow(K.loopMs, tMax - 20, tMax);
  const [loopP50, loopP95] = loops.length > 0 ? percentiles(loops, [0.5, 0.95]) : [NaN, NaN];

  const checks = buildChecks({
    now: Date.now(),
    linkState: link.state,
    health: link.health,
    healthAgeMs: link.healthAt > 0 ? Date.now() - link.healthAt : -1,
    wsAgeMs,
    helloAt: link.helloAt,
    recTrend,
    log: liveLog,
    loopP50,
    loopP95,
  });
  const sum = summarizeChecks(checks);
  const build = liveLog.latestStr(K.build) || (link.health?.kind === "ok" ? link.health.info.build : "");

  const onCopy = useCallback(() => {
    const md = checksToMarkdown(checks, build, Date.now());
    void copyText(md).then((r) => {
      setCopied(r === "failed" ? "複製失敗（瀏覽器兩條路徑都被擋）" : "已複製 Markdown");
      window.setTimeout(() => setCopied(""), 2500);
    });
  }, [checks, build]);

  // 綠必須是真的綠。有 warn 就不給綠字——「READY TO PLAY」配一顆 11.7 V 的電池
  // 是在教人忽略黃燈，而黃燈被忽略一次之後就永遠是裝飾。
  const banner =
    sum.errs > 0
      ? { cls: "nogo", text: "N O   G O" }
      : sum.stales > 0
        ? { cls: "hold", text: "資 料 不 足" }
        : sum.warns > 0
          ? { cls: "hold", text: `R E A D Y ・ ${sum.warns} 項 要 注 意` }
          : { cls: "go", text: "R E A D Y   T O   P L A Y" };

  return (
    <div className="hw">
      <div className={`hw-banner ${banner.cls}`}>
        <div className="hw-banner-text">{banner.text}</div>
        <div className="hw-banner-sub">
          {sum.passed}/{sum.total} 通過
          {sum.errs > 0 && <> · {sum.errs} 項不合格</>}
          {sum.warns > 0 && <> · {sum.warns} 項接近界線</>}
          {sum.stales > 0 && <> · {sum.stales} 項沒有資料</>}
          {" · "}
          <code>{build || "沒有 Build tag"}</code>
          <button className="hw-btn" onClick={onCopy} title="產生一份帶時間的 Markdown，貼進隊內群組就是檢錄記錄">
            複製結果
          </button>
          {copied && <span className="hw-copied">{copied}</span>}
        </div>
      </div>

      <div className="hw-grid">
        {checks.map((c) => (
          <Cell key={c.id} c={c} />
        ))}
      </div>

      <ShutdownStrip ctx={{ health: link.health, wsAgeMs, recTrend }} />

      <div className="hw-foot">
        判定全部來自可觀測狀態：8081 的最後一批、8080 的 <code>/dash/health</code>、以及 log
        裡這些 key 有沒有變過。沒有任何一格是靠前端自己記得的旗標。
        {client.link.state === "polling" && " · 目前走 state.json 輪詢（8081 握手三次失敗）"}
      </div>
    </div>
  );
}
