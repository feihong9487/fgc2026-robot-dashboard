// REPLAY 佔位（第三階段補完：TimeBar / Inspector / EventList / RangeStats）。
//
// 第一階段先把「載入的檔案變成一個獨立 LogStore 實例、由 cursorT 驅動」這條
// 資料路徑接通並顯示誠實的檔案摘要——時戳來源、批數、間隔分位數、缺口位置。
// 若某份檔案缺 Match s（舊格式），這裡會顯示 t=client，使用者就知道所有時間量測
// 只有 ±50 ms 精度，不要拿去比較 FEED_THRESHOLD 1200 與 1300。

import { client } from "../../lib/RobotClient";
import { cursor } from "../lib/cursorStore";
import { percentiles } from "../lib/stats";
import { useCursor } from "../lib/hooks";
import "../styles/lockdown.css";

export function ReplayPage() {
  useCursor();
  const log = client.replayLog;
  if (!log) return null;

  const [t0, t1] = log.tRange;
  const iv = log.batchIntervals();
  const [p50, p95] = iv.length > 0 ? percentiles(iv, [0.5, 0.95]) : [NaN, NaN];
  const gaps = log.gaps(1.0);
  const mb = log.bytes() / (1024 * 1024);

  return (
    <div className="replay-stub">
      <h2 style={{ margin: 0, fontSize: "var(--fs-lg)" }}>
        回放 · {client.replayName}
      </h2>
      <div className="meta">
        時戳來源　<b>t={log.tSource}</b>
        {log.tSource === "client" && "（本機時鐘，精度只有 ±50 ms，不要拿去比較門檻）"}
        <br />
        長度　{(t1 - t0).toFixed(1)} s（{t0.toFixed(1)} → {t1.toFixed(1)}）
        <br />
        批數　{log.batchCount.toLocaleString("en-US")}　·　樣本　{log.samples.toLocaleString("en-US")}　·　欄位　{log.keys().length}
        <br />
        間隔　p50 {Number.isFinite(p50) ? (p50 * 1000).toFixed(1) : "—"} ms　p95{" "}
        {Number.isFinite(p95) ? (p95 * 1000).toFixed(1) : "—"} ms
        <br />
        缺口　{gaps.length} 處
        {gaps.length > 0 &&
          `（${gaps
            .slice(0, 3)
            .map((g) => `${g.t0.toFixed(1)}–${g.t1.toFixed(1)}s`)
            .join("、")}${gaps.length > 3 ? " …" : ""}）`}
        　·　記憶體 {mb.toFixed(1)} MB
        <br />
        游標　{cursor.cursorT.toFixed(3)} s
      </div>
      <div style={{ color: "var(--text-dim)", fontSize: "var(--fs-sm)" }}>
        TimeBar、Inspector、事件清單與統計在第三階段補上；資料層（LogStore + cursorStore）
        已經就位，面板程式碼在 PIT 即時與 REPLAY 回放兩種情境下完全共用。
      </div>
    </div>
  );
}
