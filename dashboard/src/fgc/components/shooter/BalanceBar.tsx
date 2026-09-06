// BalanceBar（§3.3 #9，也被 #8 雙環引用）：SL − SR 失衡。
//
// 為什麼這是全目錄投報比最高的單一功能：ShooterSystem.java:34 的 atSpeed 是
// 「SL >= 門檻 && SR >= 門檻」兩顆各自比，**從未比較兩顆是否一致**。所以兩顆
// 差 200 tps 的時候機器人照樣說「已達速」，球出去帶側旋、落點偏，而場上第一個
// 被懷疑的永遠是機構。這裡純前端相減、零機器人端成本，就能在拆機構之前先排除
// 「落點偏是軟體造成的側旋」。
//
// 兩個數字是兩件事：即時 Δ 是「現在這一刻」，SHOOT 期 RMS 是「這一場整體」。
// 只看即時 Δ 會被單一取樣點騙，只看 RMS 看不到剛剛那一下。

import { useEffect, useMemo, useState } from "react";
import { PanelShell } from "../shell/PanelShell";
import { Glyph } from "../shell/Glyph";
import { LogStore, liveLog } from "../../lib/LogStore";
import { K } from "../../lib/fgcKeys";
import { useLogKeys } from "../../lib/hooks";

interface Props {
  log?: LogStore;
  /** 側旋門檻（tps）；超過就是紅字。§3.2 #8 規定 100。 */
  threshold?: number;
  /** 條的半幅（tps）。 */
  fullScale?: number;
}

const LIVE_KEYS = [K.sl, K.sr] as const;
const RECALC_MS = 1000;
/** 只算最近幾段 SHOOT：整場 80 段全算沒有意義，調參看的是「剛剛改完之後」。 */
const MAX_RUNS = 12;

/** SHOOT 期間 (SL − SR) 的 RMS。COLLECT 期間兩顆都停死，差值恆為 0，算進去只會稀釋。 */
function shootRms(log: LogStore): { rms: number; n: number; peak: number } {
  const [t0, t1] = log.tRange;
  if (!(t1 > t0) || !log.has(K.sl) || !log.has(K.sr) || !log.has(K.driveState)) {
    return { rms: NaN, n: 0, peak: NaN };
  }
  const runs = log.runs(K.driveState, t0, t1, 8000).filter((r) => r.s === "SHOOT" && r.t1 > r.t0);
  let acc = 0;
  let n = 0;
  let peak = 0;
  for (let i = Math.max(0, runs.length - MAX_RUNS); i < runs.length; i++) {
    const r = runs[i];
    const w = log.sampleWindow(K.sl, r.t0, r.t1, 1_000_000);
    if (w.decimated) continue;
    for (let j = 0; j < w.n; j++) {
      const t = w.xs[j];
      if (t < r.t0) continue; // sampleWindow 帶進來的錨點不屬於這一段
      const sr = log.valueAt(K.sr, t);
      if (sr === null) continue;
      const d = w.ys[j] - sr;
      acc += d * d;
      if (Math.abs(d) > Math.abs(peak)) peak = d;
      n++;
    }
  }
  return { rms: n ? Math.sqrt(acc / n) : NaN, n, peak };
}

export function BalanceBar({ log = liveLog, threshold = 100, fullScale = 300 }: Props) {
  useLogKeys(LIVE_KEYS, log);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), RECALC_MS);
    return () => window.clearInterval(t);
  }, []);

  const stat = useMemo(
    () => shootRms(log),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [log, tick],
  );

  const sl = log.latestNum(K.sl, NaN);
  const sr = log.latestNum(K.sr, NaN);
  const delta = sl - sr;
  const hasLive = Number.isFinite(delta);

  const pct = hasLive ? 50 + (Math.max(-fullScale, Math.min(fullScale, delta)) / fullScale) * 50 : 50;
  const thrPct = (threshold / fullScale) * 50;

  const level = (v: number): "ok" | "warn" | "err" =>
    !Number.isFinite(v) ? "ok" : Math.abs(v) >= threshold ? "err" : Math.abs(v) >= threshold / 2 ? "warn" : "ok";

  return (
    <PanelShell
      title="失衡 SL − SR"
      note="atSpeed 只各自比門檻，從不比較兩顆"
      fresh={null}
    >
      <div className="bal">
        <div className={`bal-now ${level(delta)}`}>
          <span className="fgc-num">{hasLive ? (delta > 0 ? "+" : "") + delta.toFixed(0) : "—"}</span>
          <span className="fgc-unit">tps</span>
          {/* 顏色不是唯一通道：超過門檻時同時出現形狀 */}
          {hasLive && level(delta) !== "ok" && <Glyph tone={level(delta)} />}
        </div>

        <div className="bal-bar">
          <span className="mid" />
          <span className="thr" style={{ left: `${50 - thrPct}%` }} />
          <span className="thr" style={{ left: `${50 + thrPct}%` }} />
          {hasLive && <span className={`knob ${level(delta)}`} style={{ left: `${pct}%` }} />}
        </div>
        {/* 兩條黃虛線是 ±100 側旋門檻——刻度直接標在線的正下方，
            不靠卡片底部的說明句去解釋畫面上的一根線。 */}
        <div className="bal-scale">
          <span className="end l fgc-num">−{fullScale}</span>
          <span className="thr-lbl fgc-num" style={{ left: `${50 - thrPct}%` }} title="側旋門檻">
            −{threshold}
          </span>
          <span className="zero fgc-num">0</span>
          <span className="thr-lbl fgc-num" style={{ left: `${50 + thrPct}%` }} title="側旋門檻">
            +{threshold}
          </span>
          <span className="end r fgc-num">+{fullScale}</span>
        </div>

        <div className="bal-rms">
          <span className="lbl">SHOOT 期 RMS</span>
          <span className={`val fgc-num ${level(stat.rms)}`}>
            {Number.isFinite(stat.rms) ? stat.rms.toFixed(0) : "—"}
          </span>
          <span className="sub">
            <span className="k">峰值</span>
            <span className="fgc-num">
              {Number.isFinite(stat.peak) ? (stat.peak > 0 ? "+" : "") + stat.peak.toFixed(0) : "—"}
            </span>
            <span className="k">n</span>
            <span className="fgc-num">{stat.n}</span>
          </span>
        </div>
      </div>
    </PanelShell>
  );
}
