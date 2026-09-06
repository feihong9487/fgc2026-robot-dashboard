// 光達觀測資料側欄 — 全部由 App 端從點雲即時推導（機器人端不需額外遙測）：
// 更新率、資料延遲、點數、最近障礙物（距離+方位）、前/左/後/右四方向淨空、範圍統計
import { useEffect, useRef, useState } from "react";
import { store } from "../lib/store";
import { Led } from "./controls";
import { LIDAR_K } from "../lib/keys";

const MIN_VALID_M = 0.05; // 距離小於此值視為無效點（光達自身/雜訊）
const NEAR_WARN_M = 0.3; // 最近障礙物警示門檻

interface LidarStats {
  points: number;
  nearestR: number; // Infinity = 無有效點
  nearestDeg: number; // 0=前方，左正右負
  maxR: number;
  meanR: number;
  sector: { front: number; left: number; back: number; right: number };
}

function computeStats(pc: Float32Array): LidarStats {
  let nearestR = Infinity;
  let nearestDeg = 0;
  let maxR = 0;
  let sum = 0;
  let n = 0;
  const sector = { front: Infinity, left: Infinity, back: Infinity, right: Infinity };

  for (let i = 0; i + 1 < pc.length; i += 2) {
    const x = pc[i];
    const y = pc[i + 1];
    const r = Math.hypot(x, y);
    if (r < MIN_VALID_M) continue;
    n++;
    sum += r;
    if (r > maxR) maxR = r;

    const deg = (Math.atan2(y, x) * 180) / Math.PI; // x 前方 y 左方 → 左正右負
    if (r < nearestR) {
      nearestR = r;
      nearestDeg = deg;
    }
    const key =
      deg > -45 && deg <= 45 ? "front" :
      deg > 45 && deg <= 135 ? "left" :
      deg <= -45 && deg > -135 ? "right" : "back";
    if (r < sector[key]) sector[key] = r;
  }

  return { points: n, nearestR, nearestDeg, maxR, meanR: n ? sum / n : 0, sector };
}

const fmtM = (r: number) => (Number.isFinite(r) ? `${r.toFixed(2)} m` : "—");

function SectorRow({ label, r }: { label: string; r: number }) {
  const warn = Number.isFinite(r) && r < NEAR_WARN_M;
  return (
    <div className={warn ? "status-row estop" : "status-row"}>
      {label}：{fmtM(r)}
    </div>
  );
}

export function LidarStatsPanel() {
  const [, force] = useState(0);
  const lastStamp = useRef(0);
  const rateHz = useRef(0);

  useEffect(() => {
    // 更新率：訂閱 store（每幀點雲都會 emit），對 stamp 間隔做 EMA；
    // 顯示本身固定 5Hz 重繪就夠（延遲值也要持續走動）
    const unsub = store.subscribe(() => {
      const stamp = store.pointCloudStamp;
      if (stamp === lastStamp.current) return;
      const dt = stamp - lastStamp.current;
      if (lastStamp.current > 0 && dt > 0 && dt < 5)
        rateHz.current = rateHz.current * 0.7 + (1 / dt) * 0.3;
      lastStamp.current = stamp;
    });
    const timer = window.setInterval(() => force((k) => k + 1), 200);
    return () => {
      unsub();
      clearInterval(timer);
    };
  }, []);

  const stamp = store.pointCloudStamp;
  const ageSec = store.now() - stamp;
  const live = stamp > 0 && ageSec < 1.5;
  const s = computeStats(store.points());
  const nearWarn = live && Number.isFinite(s.nearestR) && s.nearestR < NEAR_WARN_M;

  return (
    <div className="tuning-panel">
      <section>
        <h3>資料狀態</h3>
        <div className={live ? "status-row ok" : "status-row estop"}>
          {live ? "接收中" : stamp > 0 ? "資料逾時" : "無資料"}
        </div>
        <div className="status-row">更新率：{live ? `${rateHz.current.toFixed(1)} Hz` : "—"}</div>
        <div className="status-row">
          延遲：{stamp > 0 ? `${(ageSec * 1000).toFixed(0)} ms` : "—"}
        </div>
        <div className="status-row">有效點數：{live ? s.points : "—"}</div>
      </section>

      <section>
        <h3>最近障礙物</h3>
        <div className={nearWarn ? "status-row estop" : "status-row"}>
          距離：{live ? fmtM(s.nearestR) : "—"}
        </div>
        <div className="status-row">
          方位：
          {live && Number.isFinite(s.nearestR)
            ? `${Math.abs(s.nearestDeg).toFixed(0)}°（${
                Math.abs(s.nearestDeg) <= 20 ? "正前方" : s.nearestDeg > 0 ? "左" : "右"
              }）`
            : "—"}
        </div>
      </section>

      <section>
        <h3>對牆矯正</h3>
        <div className="btn-row wrap">
          <Led on={store.bool(LIDAR_K.frontOccluded)} label="前遮擋" color="warn" />
          <Led on={store.bool(LIDAR_K.blockedY)} label="前擋路" color="err" />
          <Led on={store.bool(LIDAR_K.leftOccluded)} label="左遮擋" color="warn" />
          <Led on={store.bool(LIDAR_K.blockedX)} label="左擋路" color="err" />
          <Led on={store.bool(LIDAR_K.settled)} label="已定位" color="ok" />
        </div>
      </section>

      <section>
        <h3>四方向淨空</h3>
        {live ? (
          <>
            <SectorRow label="前" r={s.sector.front} />
            <SectorRow label="左" r={s.sector.left} />
            <SectorRow label="右" r={s.sector.right} />
            <SectorRow label="後" r={s.sector.back} />
          </>
        ) : (
          <div className="status-row">—</div>
        )}
      </section>

      <section>
        <h3>範圍統計</h3>
        <div className="status-row">最遠點：{live ? fmtM(s.maxR) : "—"}</div>
        <div className="status-row">平均距離：{live ? fmtM(s.meanR) : "—"}</div>
      </section>
    </div>
  );
}
