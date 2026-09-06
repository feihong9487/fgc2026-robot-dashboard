// DipAnalyzer（§3.3 #20）：每球凹陷表 + 深度分佈。
//
// 這是整份目錄裡唯一能把 FEED_THRESHOLD 從猜測變成量測的元件：
// 目標 1900、門檻 1200 表示要掉到 63% 才停止送料——每一顆球的底值就在這張表上，
// 「跌破」那一欄是 0 還是 3，直接決定下一步要不要把門檻往下調。
//
// 標題列固定掛「±50 ms」chip：推播週期 PERIOD_MS=50，恢復時間 180 ms 與 220 ms
// 之間的差距只有 40 ms，本來就在解析度之內。不寫出來，這張表會被過度解讀。

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { PanelShell } from "../shell/PanelShell";
import { LogStore, liveLog } from "../../lib/LogStore";
import { cursor } from "../../lib/cursorStore";
import { K, paramKey, shortName } from "../../lib/fgcKeys";
import { histogram } from "../../lib/stats";
import { view } from "../graph/viewWindow";
import { colorForKey } from "../graph/LineGraph";
import { detectDips, median, type Dip } from "./dipDetect";

interface Props {
  log?: LogStore;
  /** 允許互動（非 PIT 一律 false：所有輸入元件不 render，不是 disabled）。 */
  allowInputs?: boolean;
  /** 表格最多顯示幾列（只顯示最近的）。 */
  rows?: number;
}

const RECALC_MS = 1000;

function fmt0(v: number): string {
  return Number.isFinite(v) ? String(Math.round(v)) : "—";
}

export function DipAnalyzer({ log = liveLog, allowInputs, rows = 10 }: Props) {
  const [src, setSrc] = useState<string>(K.sl);
  const [tick, setTick] = useState(0);

  // 每秒重算一次就夠：一場 150 s 只有 20–40 顆球，而且看的人在讀數字不在追動畫。
  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), RECALC_MS);
    return () => window.clearInterval(t);
  }, []);

  const dips = useMemo(
    () => detectDips(log, src),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [log, src, tick],
  );

  const shown = dips.slice(Math.max(0, dips.length - rows));
  // 統計只用「有回升」的凹陷。一段 SHOOT 的最後一顆常常還沒回到速就換成 COLLECT，
  // 那一筆的底值其實是狀態切換時的減速斜坡，把它算進中位數與分佈會系統性地偏低。
  // 表格照樣列它（恢復欄是「—」），因為它確實發生過——只是不知道恢復要多久。
  const closed = dips.filter((d) => d.recoverMs !== null);
  const open = dips.length - closed.length;
  const bottoms = closed.map((d) => d.bottom);
  const depths = closed.map((d) => d.depth);
  const broke = closed.filter((d) => d.broke).length;
  const thr = log.valueAt(paramKey("FEED_THRESHOLD"), log.tMax);

  const hist = useMemo(() => histogram(depths, 8), [depths]);

  const seek = (d: Dip) => {
    cursor.setCursor(d.tBottom, true);
    // 跳過去要看得到：不在目前視窗裡就把視窗移過去（並脫離跟隨尾端）
    if (d.tBottom < view.t0 || d.tBottom > view.t1) {
      view.setFollow(false);
      const half = view.span / 2;
      view.setWindow(d.tBottom - half, d.tBottom + half);
    }
  };

  return (
    <PanelShell
      title="每球 dip"
      rate="±50 ms"
      note={`門檻 ${thr === null ? "未知" : fmt0(thr)}（讀 /FGC/Param 回讀值）`}
      tools={
        allowInputs ? (
          <>
            {[K.sl, K.sr].map((k) => (
              <button
                key={k}
                className={src === k ? "tb-btn on" : "tb-btn"}
                onClick={() => setSrc(k)}
                title={`以 ${shortName(k)} 偵測凹陷`}
              >
                {shortName(k)}
              </button>
            ))}
          </>
        ) : undefined
      }
      flush
    >
      <div className="dip-body">
        <table className="fgc-table dip-table">
          <thead>
            <tr>
              <th>#</th>
              <th>底值</th>
              <th>深度</th>
              <th>恢復</th>
              <th>跌破</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td colSpan={5} className="empty">
                  還沒量到凹陷。進入 SHOOT 射一顆球，{shortName(src)} 掉超過 150 tps 就會列在這裡。
                </td>
              </tr>
            )}
            {shown.map((d) => (
              <tr
                key={d.index}
                className={d.broke ? "broke" : d.recoverMs === null ? "open" : undefined}
                onClick={() => seek(d)}
                title="點一下把游標移到這一顆的底部"
              >
                <td className="num">{d.index}</td>
                <td className="num">{fmt0(d.bottom)}</td>
                <td className="num">−{fmt0(d.depth)}</td>
                {/* 單位不混進數字：`627ms` 會讓這一欄的小數點對不齊上一欄 */}
                <td className="num">
                  {d.recoverMs === null ? "—" : fmt0(d.recoverMs)}
                  {d.recoverMs !== null && <span className="fgc-unit">ms</span>}
                </td>
                <td className="flag">
                  {d.broke ? (
                    <>
                      <span className="fgc-glyph err">■</span>是
                    </>
                  ) : (
                    <span className="no">否</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="dip-foot">
          {/* 中點串的 meta 改成標籤／值：這三個數字不是並列的同級項，
              「中位」是統計、「跌破」是計數、「未回升」是資料完整度的警告。 */}
          <div className="dip-sum">
            <span className="k">中位</span>
            <span className="fgc-num">{fmt0(median(bottoms))}</span>
            <span className="k">跌破</span>
            <span className="fgc-num">
              {broke}/{closed.length}
            </span>
            {open > 0 && (
              <span className="dip-warn" title="未回到參考轉速的凹陷不計入中位與分佈">
                <span className="fgc-num">{open}</span> 顆未回升
              </span>
            )}
            {dips.length > 0 && !dips[dips.length - 1].refFromTarget && (
              <span className="dip-warn" title="沒有 TargetL/TargetR 埋點，參考轉速改用該段最大值">
                ref=段內最大值
              </span>
            )}
          </div>
          {/* 分佈的顏色跟著來源走：以 SL 偵測就是青、以 SR 就是琥珀，
              與主圖那條線同一個顏色，不另立第三套色。
              一顆都還沒量到時整條不畫——全部 0 高的長條會在卡片上留下一條
              沒有意義的橫線，而那條線看起來像一個「值是 0」的量測結果。 */}
          {hist.max > 0 && (
            <div className="dip-hist" style={{ "--c": colorForKey(src, 0) } as CSSProperties} title="深度分佈（tps）">
              {Array.from(hist.counts).map((c, i) => (
                <span
                  key={i}
                  className="bar"
                  style={{ height: `${(c / hist.max) * 100}%` }}
                  title={`${Math.round(hist.edges[i])}–${Math.round(hist.edges[i + 1])} tps：${c} 顆`}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </PanelShell>
  );
}
