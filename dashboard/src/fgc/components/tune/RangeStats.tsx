// RangeStats（§3.3 #21）：區間統計。五個數字 + σ + 直方圖。
//
// σ 不可砍。調參的正確問題不是「轉速多少」而是「轉速多穩」——σ 直接量化射手
// 一致性，那是決定命中率的物理量；曲線圖只給模糊印象，而 mean 在兩份設定之間
// 常常只差 3 tps，看不出差別的其實是 σ 從 42 降到 18。
//
// Reference / 相對誤差模式刻意不做：10 次以下樣本的相對誤差分布會誤導。
//
// 取樣一律走 valuesInWindow（絕不 decimate）。sampleWindow 的 min/max 抽樣是給
// 畫圖用的，拿去算 σ 會得到一個偏大的假數字。

import { useEffect, useMemo, useState } from "react";
import { PanelShell } from "../shell/PanelShell";
import { LogStore, liveLog } from "../../lib/LogStore";
import { cursor } from "../../lib/cursorStore";
import { K, shortName } from "../../lib/fgcKeys";
import { histogram, summarize } from "../../lib/stats";
import { useCursor } from "../../lib/hooks";
import { view } from "../graph/viewWindow";

interface Props {
  log?: LogStore;
  allowInputs?: boolean;
}

type RangeMode = "sel" | "win" | "all" | "shoot" | "last10";

const RANGE_LABEL: Record<RangeMode, string> = {
  sel: "游標選取",
  win: "可見視窗",
  all: "整份 log",
  shoot: "SHOOT 聯集",
  last10: "最近 10 s",
};

const BIN_CHOICES = [10, 20, 40];

/**
 * 直方圖的顏色跟著被統計的 key 走（§6.5 固定綁定：SL 青、SR 琥珀、Way 冷紫）。
 * 以前不論統計誰都畫 --series-1 的青色——選了 SR 之後，同一個量在射手頁是琥珀、
 * 在這裡是青，那條「一個訊號一個顏色」的保證就在這一格默默失效。
 * 沒有綁定的 key 用中性灰：分布圖不屬於任何一條時間序列，硬給它一個 series 色是說謊。
 */
const HIST_COLOR: Record<string, string> = {
  [K.sl]: "var(--series-1)",
  [K.sr]: "var(--series-2)",
  [K.way]: "var(--series-4)",
};
const RECALC_MS = 1000;

function concat(parts: Float64Array[]): Float64Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Float64Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function gather(log: LogStore, key: string, mode: RangeMode): { v: Float64Array; label: string } {
  const [tMin, tMax] = log.tRange;
  if (mode === "shoot") {
    const runs = log.runs(K.driveState, tMin, tMax, 8000).filter((r) => r.s === "SHOOT" && r.t1 > r.t0);
    const parts = runs.map((r) => log.valuesInWindow(key, r.t0, r.t1));
    return { v: concat(parts), label: runs.length + " 段 SHOOT" };
  }
  let t0 = tMin;
  let t1 = tMax;
  if (mode === "sel") {
    const s = cursor.selection;
    if (!s || s.t1 <= s.t0) return { v: new Float64Array(0), label: "尚未框選（在圖上 Shift+拖曳）" };
    t0 = s.t0;
    t1 = s.t1;
  } else if (mode === "win") {
    t0 = view.t0;
    t1 = view.t1;
  } else if (mode === "last10") {
    t0 = Math.max(tMin, tMax - 10);
  }
  return { v: log.valuesInWindow(key, t0, t1), label: t0.toFixed(1) + "–" + t1.toFixed(1) + " s" };
}

function fmt(v: number, d = 1): string {
  return Number.isFinite(v) ? v.toFixed(d) : "—";
}

export function RangeStats({ log = liveLog, allowInputs }: Props) {
  useCursor();
  const [key, setKey] = useState<string>(K.sl);
  // 預設「最近 10 s」而不是「可見視窗」：參數頁上沒有時間軸，view 的視窗可能還停在
  // 開機值 0–20 s（那一段通常一個樣本都沒有）。跨頁的正解是在射手頁框選再切過來，
  // 但那要使用者先做一件事；預設值必須是「打開就有數字」的那一個。
  // 刻意不叫 mode / setMode：store 的模式是 §8 M01 的核心（「這一行寫錯，其他全部
  // 是裝飾」），grep "setMode(" 的結果不該包含一個統計區間的區域 state。
  const [range, setRange] = useState<RangeMode>("last10");
  const [bins, setBins] = useState(20);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), RECALC_MS);
    return () => window.clearInterval(t);
  }, []);

  // 數值欄位才能統計：布林與字串進來只會得到一個沒有意義的平均數
  const numKeys = useMemo(
    () => log.keys().filter((k) => log.kindOf(k) === "num").sort(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [log, tick],
  );

  const { v, label } = useMemo(
    () => gather(log, key, range),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [log, key, range, tick, cursor.getVersion()],
  );
  const s = useMemo(() => summarize(v), [v]);
  const hist = useMemo(() => histogram(v, bins), [v, bins]);

  return (
    <PanelShell
      title="區間統計"
      note={"範圍 " + RANGE_LABEL[range] + "（" + label + "）"}
      tools={
        allowInputs ? (
          <select className="rs-sel" value={key} onChange={(e) => setKey(e.target.value)} title="統計對象">
            {numKeys.length === 0 && <option value={key}>{shortName(key)}</option>}
            {numKeys.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        ) : (
          <span className="ro-value">{shortName(key)}</span>
        )
      }
    >
      <div className="rs">
        {allowInputs && (
          <div className="rs-tabs">
            {(Object.keys(RANGE_LABEL) as RangeMode[]).map((m) => (
              <button key={m} className={m === range ? "tb-btn on" : "tb-btn"} onClick={() => setRange(m)}>
                {RANGE_LABEL[m]}
              </button>
            ))}
          </div>
        )}

        <div className="rs-nums">
          <span>
            n <b>{s.count}</b>
          </span>
          <span>
            min <b>{fmt(s.min)}</b>
          </span>
          <span>
            max <b>{fmt(s.max)}</b>
          </span>
          <span>
            mean <b>{fmt(s.mean)}</b>
          </span>
          <span className="sigma" title="母體標準差：射手一致性的物理量">
            σ <b>{fmt(s.sigma, 2)}</b>
          </span>
        </div>

        <div className="rs-hist" title="直方圖">
          {s.count === 0 ? (
            <span className="rs-empty">這個範圍內沒有樣本。換一個區間，或到射手頁框選一段再切回來。</span>
          ) : (
            Array.from(hist.counts).map((c, i) => (
              <span
                key={i}
                className="bar"
                style={{
                  height: (hist.max ? (c / hist.max) * 100 : 0) + "%",
                  background: HIST_COLOR[key] ?? "var(--border-hi)",
                }}
                title={fmt(hist.edges[i]) + "–" + fmt(hist.edges[i + 1]) + "：" + c}
              />
            ))
          )}
        </div>

        <div className="rs-foot">
          <span>
            {fmt(hist.edges[0])} … {fmt(hist.edges[hist.edges.length - 1])}
          </span>
          {allowInputs && (
            <span className="rs-bins">
              bin
              {BIN_CHOICES.map((b) => (
                <button key={b} className={b === bins ? "tb-btn on" : "tb-btn"} onClick={() => setBins(b)}>
                  {b}
                </button>
              ))}
            </span>
          )}
        </div>
      </div>
    </PanelShell>
  );
}
