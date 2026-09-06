// 點雲 XY 座標表：把當前一圈點雲以 2D 陣列（每列 [X, Y]，附 r/θ）持續列出。
// 資料源與 PointCloudPanel 相同（store.pointCloud，公尺，[x0,y0,x1,y1,...]），
// 每 150ms 重繪一次，跟著點雲即時更新。
import { useEffect, useState } from "react";
import { store } from "../lib/store";

export function PointCloudTable() {
  const [, force] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => force((k) => k + 1), 150);
    return () => clearInterval(timer);
  }, []);

  const pc = store.points();
  const stamp = store.pointCloudStamp;
  const live = stamp > 0 && store.now() - stamp < 1.5;
  const n = Math.floor(pc.length / 2);

  return (
    <div className="tuning-panel">
      <section>
        <h3>點雲座標（{n}）</h3>
        <div className={live ? "status-row ok" : "status-row estop"}>
          {live ? "接收中" : stamp > 0 ? "資料逾時" : "無資料"}
        </div>
        <div className="pc-table-scroll">
          <table className="lv-matrix compact pc-table">
            <thead>
              <tr>
                <th>#</th>
                <th>X (m)</th>
                <th>Y (m)</th>
                <th>r (m)</th>
                <th>θ°</th>
              </tr>
            </thead>
            <tbody>
              {n === 0 ? (
                <tr>
                  <td colSpan={5} className="pc-empty">—</td>
                </tr>
              ) : (
                Array.from({ length: n }, (_, i) => {
                  const x = pc[i * 2];
                  const y = pc[i * 2 + 1];
                  const r = Math.hypot(x, y);
                  const deg = (Math.atan2(y, x) * 180) / Math.PI;
                  return (
                    <tr key={i}>
                      <td className="pc-idx">{i}</td>
                      <td>{x.toFixed(3)}</td>
                      <td>{y.toFixed(3)}</td>
                      <td>{r.toFixed(3)}</td>
                      <td>{deg.toFixed(1)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
