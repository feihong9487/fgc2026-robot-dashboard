// #28 HealthWall：Go/No-Go 驗機清單。
//
// 這一頁的使用情境是「上場前 30 秒」與「檢錄」，兩者的共同點是：看的人站著、
// 距離一公尺以上、而且很急。所以：
//   · 一次看完，不捲動
//   · **依 tone 排序（err → warn → stale → ok）**：要修的永遠在最上面。
//     15 張一模一樣的卡片鋪成 5×3 時，掃描成本 = 讀 15 個色點；改成一條清單之後，
//     位置本身就是資訊——第一列就是第一件要做的事
//   · 通過的收成 40px 一行（名稱 + 值），不佔版面也不消失
//   · 顏色不是唯一通道（●▲■○），約 8% 男性有紅綠色覺辨異
//   · 每秒強制刷新，讓「年齡」持續變舊——遙測斷流時畫面不可以凍在最後一個
//     看起來很健康的數字上（沿用 StatusPanel.tsx:12-20）
//
// 判定全部在 checks.ts 的純函式裡，這個檔案只負責畫。

import { useCallback, useMemo, useState } from "react";
import { Glyph } from "../shell/Glyph";
import { client } from "../../../lib/RobotClient";
import { store } from "../../../lib/store";
import { K } from "../../lib/fgcKeys";
import { liveLog } from "../../lib/LogStore";
import { loopStats } from "../../lib/stats";
import { useLink, useTickN, useFlash } from "../../lib/hooks";
import { type Tone } from "../../lib/tone";
import { buildChecks, checksToMarkdown, summarizeChecks, type Check } from "./checks";
import { ShutdownStrip } from "./ShutdownStrip";
import { useRecTrend } from "./useRecTrend";
import { copyText } from "../../lib/clipboard";

/** 清單順序 = 處理順序。這是「顏色不是唯一通道」的第三個通道：位置。 */
const TONE_ORDER: Record<Tone, number> = { err: 0, warn: 1, stale: 2, ok: 3 };

/**
 * 讀數欄的排版規則：**28px 是給數字的。**
 *
 * detail 是一句話（「Cmd 整段沒變過」「視覺未啟用」「沒有讀數」）時，把它畫成
 * 28px 等寬只會得到一段又大又醜的漢字，而且它與旁邊真正的 `10.5 V` 搶同一份
 * 注意力——那一格明明沒有數字可讀。所以：沒有阿拉伯數字的 detail 降到 --fs-md
 * 的比例字體。
 *
 * 同理，尾巴的括號（`(p50 21　max 43)`、`（觀察中 6/30 s）`）是註腳不是讀數，
 * 拆出來畫成 --fs-sm --text-dim。這兩條都是純呈現規則，checks.ts 一個字沒動。
 */
const TAIL = /^(.*?)[\s　]*[（(]([^（(]+)[)）][\s　]*$/;

function Row({ c }: { c: Check }) {
  const m = TAIL.exec(c.detail);
  const head = (m ? m[1] : c.detail).trim();
  const tail = m ? m[2] : null;
  const numeric = /[0-9]/.test(head);
  return (
    <div className={`hw-row ${c.state}${c.ok ? " pass" : ""}`} title={c.hint}>
      <Glyph tone={c.state} />
      <span className="hw-row-name">{c.name}</span>
      <span className={numeric ? "hw-row-detail" : "hw-row-detail words"}>
        {head}
        {tail && <span className="hw-row-tail">{tail}</span>}
      </span>
      {c.ok ? (
        <span />
      ) : (
        <span className="hw-row-hint">
          {c.hint}
          {c.fingerprint && (
            <span className="hw-row-fp" title="這一格直接指向一個具體的機器人端故障，不必再猜是哪裡壞了">
              直指故障
            </span>
          )}
        </span>
      )}
    </div>
  );
}

export function HealthWall() {
  // 這一頁的每一格判定都不需要 20 Hz：使用情境是「上場前 30 秒瞄一眼」與「檢錄」。
  // 以前掛 useLogVersion() 每秒重繪約 20 次，而每一次都在 render body 裡跑
  // buildChecks（15 格，含 valuesInWindow 與三次 everChanged 的配置）——
  // 光這一頁就在製造每秒數 MB 的垃圾。
  const tickN = useTickN(500);
  const link = useLink();
  const recTrend = useRecTrend(0);
  const [copied, flashCopied] = useFlash(2500);

  const wsAgeMs = store.lastBatchAt >= 0 ? (store.now() - store.lastBatchAt) * 1000 : -1;

  const checks = useMemo(() => {
    const tMax = liveLog.tMax;
    const loops = liveLog.valuesInWindow(K.loopMs, tMax - 20, tMax);
    // p95 一律優先取機器人算好的 /FGC/Status/Loop p95（見 stats.loopStats）：
    // 前端手上的 Loop ms 是 1/4 取樣，自己算的 p95 看不到尾端，而這一格會做
    // 25 ms 的 NO GO 判定——整面燈牆裡唯一「數字看起來很篤定」的那一個。
    const loop = loopStats(
      liveLog.has(K.loopP95),
      liveLog.latestNum(K.loopP95, NaN),
      liveLog.latestNum(K.loopMax, NaN),
      loops,
    );
    return buildChecks({
      now: Date.now(),
      linkState: link.state,
      health: link.health,
      healthAgeMs: link.healthAt > 0 ? Date.now() - link.healthAt : -1,
      wsAgeMs,
      helloAt: link.helloAt,
      recTrend,
      log: liveLog,
      loopP50: loop.p50,
      loopP95: loop.p95,
      loopMax: loop.max,
      loopFromRobot: loop.fromRobot,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickN, link, recTrend]);
  const sum = summarizeChecks(checks);
  const build = liveLog.latestStr(K.build) || (link.health?.kind === "ok" ? link.health.info.build : "");

  // Array#sort 是穩定的，所以同 tone 內維持 checks.ts 的原始順序（= 檢查的邏輯順序）。
  const [open, pass] = useMemo(() => {
    const s = [...checks].sort((a, b) => TONE_ORDER[a.state] - TONE_ORDER[b.state]);
    return [s.filter((c) => !c.ok), s.filter((c) => c.ok)];
  }, [checks]);

  const onCopy = useCallback(() => {
    const md = checksToMarkdown(checks, build, Date.now());
    void copyText(md).then((r) => {
      // 動作全程同名：按鈕寫「複製檢錄記錄」，回饋就寫「已複製檢錄記錄」。
      flashCopied(r === "failed" ? "複製失敗，瀏覽器兩條路徑都被擋" : "已複製檢錄記錄");
    });
  }, [checks, build, flashCopied]);

  // 綠必須是真的綠。有 warn 就不給綠字——「全部通過」配一顆 11.7 V 的電池
  // 是在教人忽略黃燈，而黃燈被忽略一次之後就永遠是裝飾。
  //
  // 字面值全部是中文：頁面上唯一該出現的大寫是 READY / SHOOT / EJECT 這種
  // 狀態機自己的詞彙，「NO GO」「READY TO PLAY」是設計師選的標籤，不是資料。
  const verdict: { tone: Tone; text: string } =
    sum.errs > 0
      ? { tone: "err", text: "不通過" }
      : sum.stales > 0
        ? { tone: "stale", text: "資料不足" }
        : sum.warns > 0
          ? { tone: "warn", text: "可以上場" }
          : { tone: "ok", text: "全部通過" };

  // 計數用形狀語彙自己說，不串一條「· A · B · C」的中點 meta 字串。
  const tally: [Tone, number][] = [
    ["err", sum.errs],
    ["warn", sum.warns],
    ["stale", sum.stales],
    ["ok", sum.passed],
  ];

  return (
    <div className="hw">
      <div className={`hw-verdict ${verdict.tone}`}>
        <Glyph tone={verdict.tone} />
        <span className="hw-verdict-head">{verdict.text}</span>
        <span className="hw-tally">
          {tally.map(([tone, n]) =>
            n > 0 ? (
              <span className="item" key={tone}>
                <Glyph tone={tone} />
                <span className="fgc-num">{n}</span>
              </span>
            ) : null,
          )}
        </span>
        <span className="spacer" />
        {copied && <span className="hw-copied">{copied}</span>}
        <button className="hw-btn" onClick={onCopy} title="產生一份帶時間與 Build 的 Markdown，貼進隊內群組就是檢錄記錄">
          複製檢錄記錄
        </button>
      </div>

      {/* 上半 = 要處理的（依 err → warn → stale 排序，一列一件事，值 28px）。
          下半 = 通過的，兩欄 40px 一行——它們不需要動作，所以不需要版面。
          兩塊的欄數不同，所以「有沒有事」不必讀顏色也不必數，掃一眼版面就知道。 */}
      <div className="hw-list">
        {open.length > 0 && (
          <div className="hw-open">
            {open.map((c) => (
              <Row key={c.id} c={c} />
            ))}
          </div>
        )}
        {pass.length > 0 && (
          <div className="hw-pass">
            {pass.map((c) => (
              <Row key={c.id} c={c} />
            ))}
          </div>
        )}
      </div>

      <ShutdownStrip ctx={{ health: link.health, wsAgeMs, recTrend }} />

      <p className="hw-foot">
        判定來自可觀測狀態：8081 的最後一批、8080 的 <code>/dash/health</code>、log 裡這些 key 有沒有變過。
        {client.link.state === "polling" && "目前走 state.json 輪詢（8081 握手三次失敗）。"}
      </p>
    </div>
  );
}
