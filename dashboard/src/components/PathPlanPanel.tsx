// 路徑規劃分頁 — 場地圖上點選/拖曳路徑點，op:path 下傳機器人。
// 分工：Dashboard 只做「編輯」；賽中即時重規劃（A*）仍在機器人端跑。
// 畫面疊即時定位與障礙物，路徑存 localStorage（可存多條具名路徑）。
import { useEffect, useRef, useState } from "react";
import { store } from "../lib/store";
import { client } from "../lib/RobotClient";
import { SIM_K } from "../lib/keys";
import { NumBox } from "./controls";

const FIELD_W = 4; // m
const FIELD_H = 2; // m
const ROBOT_R = 0.175;
const LS_PATHS = "vmx-dashboard.paths";

// 座標系（配合機器人端 FieldMap.h）：原點右下角，x∈[-4,0]、y∈[0,2]（未變動）。畫布
// 內部仍用「左下原點、x∈[0,4]」的局部顯示座標算像素，見 FieldView.tsx 同名 helper。
const toLocalX = (fieldXm: number) => fieldXm + FIELD_W;

type Waypoint = { x: number; y: number; theta: number };

function loadPaths(): Record<string, Waypoint[]> {
  try {
    return JSON.parse(localStorage.getItem(LS_PATHS) ?? "{}");
  } catch {
    return {};
  }
}
function savePaths(p: Record<string, Waypoint[]>) {
  localStorage.setItem(LS_PATHS, JSON.stringify(p));
}

function parsePairs(json: string): number[][] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((p) => Array.isArray(p)) : [];
  } catch {
    return [];
  }
}

function useStore() {
  const [, force] = useState(0);
  useEffect(() => store.subscribe(() => force((n) => n + 1)), []);
}

export function PathPlanPanel() {
  useStore();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pts, setPts] = useState<Waypoint[]>([]);
  const [saved, setSaved] = useState<Record<string, Waypoint[]>>(loadPaths);
  const [name, setName] = useState("path-1");
  const [msg, setMsg] = useState("");
  const dragIdx = useRef(-1);
  const ptsRef = useRef(pts);
  ptsRef.current = pts;

  const offline = store.connState === "disconnected" || store.connState === "connecting";

  // ── 畫布繪製（與 FieldView 同座標系）──────────────────────
  // 離線時畫布不存在（顯示提示文字），effect 必須跳過並在連線後重掛
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (!w || !h) return;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const pad = 24;
      const scale = Math.min((w - pad * 2) / FIELD_W, (h - pad * 2) / FIELD_H);
      const ox = (w - FIELD_W * scale) / 2;
      const oy = (h + FIELD_H * scale) / 2;
      const toX = (mx: number) => ox + mx * scale;
      const toY = (my: number) => oy - my * scale;

      // 場地底 + 格線
      ctx.fillStyle = "#161b26";
      ctx.fillRect(toX(0), toY(FIELD_H), FIELD_W * scale, FIELD_H * scale);
      ctx.strokeStyle = "#232a38";
      ctx.lineWidth = 1;
      for (let m = 0.5; m < FIELD_W; m += 0.5) {
        ctx.beginPath();
        ctx.moveTo(toX(m), toY(0));
        ctx.lineTo(toX(m), toY(FIELD_H));
        ctx.stroke();
      }
      for (let m = 0.5; m < FIELD_H; m += 0.5) {
        ctx.beginPath();
        ctx.moveTo(toX(0), toY(m));
        ctx.lineTo(toX(FIELD_W), toY(m));
        ctx.stroke();
      }
      ctx.strokeStyle = "#2e3950";
      ctx.lineWidth = 2;
      ctx.strokeRect(toX(0), toY(FIELD_H), FIELD_W * scale, FIELD_H * scale);

      // 障礙物（機器人回報，唯讀疊顯）
      const obstacles = parsePairs(String(store.latest.get(SIM_K.obstaclesJson) ?? "[]"));
      ctx.fillStyle = "rgba(229, 115, 115, 0.35)";
      ctx.strokeStyle = "#e57373";
      ctx.lineWidth = 1.5;
      for (const ob of obstacles) {
        if (ob.length < 4) continue;
        const [x, y, wm, hm] = ob;
        const lx = toLocalX(x);
        ctx.fillRect(toX(lx - wm / 2), toY(y + hm / 2), wm * scale, hm * scale);
        ctx.strokeRect(toX(lx - wm / 2), toY(y + hm / 2), wm * scale, hm * scale);
      }

      // 機器人即時定位（畫路徑起點要跟實際位置對得上）。px/py 與 wp.x/wp.y 都是場地
      // 絕對座標（原點右下角），畫布轉換前一律先 toLocalX。
      const px = store.num(SIM_K.poseX, 0.35);
      const py = store.num(SIM_K.poseY, 0.35);
      const lpx = toLocalX(px);
      ctx.fillStyle = "rgba(255, 183, 77, 0.25)";
      ctx.strokeStyle = "#ffb74d";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(toX(lpx), toY(py), ROBOT_R * scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // 編輯中的路徑
      const p = ptsRef.current;
      if (p.length) {
        ctx.strokeStyle = "#81c784";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(toX(lpx), toY(py)); // 從機器人現在位置起
        for (const wp of p) ctx.lineTo(toX(toLocalX(wp.x)), toY(wp.y));
        ctx.stroke();
        p.forEach((wp, i) => {
          ctx.fillStyle = i === p.length - 1 ? "#81c784" : "#dfe6f0";
          ctx.beginPath();
          ctx.arc(toX(toLocalX(wp.x)), toY(wp.y), 6, 0, Math.PI * 2);
          ctx.fill();
          // 終姿角度線。車頭 = (sin θ, cos θ)：heading 0° 朝 +y、順時針為正
          // （FieldMap.h 的慣例；PathTestPanel 畫車頭也是同一式）。
          const th = (wp.theta * Math.PI) / 180;
          ctx.strokeStyle = "#81c784";
          ctx.beginPath();
          ctx.moveTo(toX(toLocalX(wp.x)), toY(wp.y));
          ctx.lineTo(toX(toLocalX(wp.x + Math.sin(th) * 0.15)), toY(wp.y + Math.cos(th) * 0.15));
          ctx.stroke();
          ctx.fillStyle = "#0a0d12";
          ctx.font = "bold 9px sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(String(i + 1), toX(toLocalX(wp.x)), toY(wp.y) + 3);
          ctx.textAlign = "start";
        });
      }

      ctx.fillStyle = "#8b95a7";
      ctx.font = "11px sans-serif";
      ctx.fillText("左鍵：加點／拖點｜右鍵：刪最近點｜綠線 = 待下傳路徑", toX(0), toY(0) + 16);
    };

    const timer = window.setInterval(draw, 66);
    return () => clearInterval(timer);
  }, [offline]);

  // ── 滑鼠互動 ───────────────────────────────────────────────
  // 回傳的 x 是場地絕對座標（原點右下角，x∈[-4,0]）：局部像素座標算出來後減 FIELD_W
  // 換回絕對座標，跟畫布繪製的 toLocalX 互為反變換。
  const toField = (e: React.MouseEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    const pad = 24;
    const scale = Math.min((w - pad * 2) / FIELD_W, (h - pad * 2) / FIELD_H);
    const ox = (w - FIELD_W * scale) / 2;
    const oy = (h + FIELD_H * scale) / 2;
    return {
      x: (e.clientX - rect.left - ox) / scale - FIELD_W,
      y: (oy - (e.clientY - rect.top)) / scale,
      scale,
    };
  };

  const nearest = (fx: number, fy: number, scale: number) => {
    let best = -1;
    let bestD = 12 / scale; // 12px 抓取半徑
    ptsRef.current.forEach((wp, i) => {
      const d = Math.hypot(wp.x - fx, wp.y - fy);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  };

  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

  const onDown = (e: React.MouseEvent) => {
    const { x, y, scale } = toField(e);
    if (e.button === 2) {
      const i = nearest(x, y, scale);
      if (i >= 0) setPts(pts.filter((_, j) => j !== i));
      return;
    }
    const i = nearest(x, y, scale);
    if (i >= 0) {
      dragIdx.current = i;
    } else if (x >= -FIELD_W && x <= 0 && y >= 0 && y <= FIELD_H) {
      setPts([...pts, { x: +x.toFixed(3), y: +y.toFixed(3), theta: 0 }]);
      dragIdx.current = pts.length;
    }
  };
  const onMove = (e: React.MouseEvent) => {
    if (dragIdx.current < 0) return;
    const { x, y } = toField(e);
    setPts(
      pts.map((wp, i) =>
        i === dragIdx.current
          ? { ...wp, x: +clamp(x, -FIELD_W, 0).toFixed(3), y: +clamp(y, 0, FIELD_H).toFixed(3) }
          : wp,
      ),
    );
  };
  const onUp = () => (dragIdx.current = -1);

  // ── 動作 ───────────────────────────────────────────────────
  const send = () => {
    if (!pts.length) return;
    const ok = client.sendPath(pts.map((p) => [p.x, p.y, p.theta] as [number, number, number]));
    setMsg(
      ok
        ? `已下傳 ${pts.length} 點（op:path），機器人依序 Plan() 執行`
        : store.connState === "sim"
          ? "模擬模式：僅編輯與存檔，不下傳（連上真機才有 op:path）"
          : "未連線，無法下傳",
    );
  };
  const saveAs = () => {
    const next = { ...saved, [name]: pts };
    setSaved(next);
    savePaths(next);
    setMsg(`已存路徑「${name}」（${pts.length} 點，本機）`);
  };
  const load = (n: string) => {
    setName(n);
    setPts(saved[n] ?? []);
    setMsg(`已載入「${n}」`);
  };
  const remove = (n: string) => {
    const next = { ...saved };
    delete next[n];
    setSaved(next);
    savePaths(next);
  };

  return (
    <>
      <div className="run-left">
        <div className="field-wrap">
          {offline ? (
            <div className="cam-placeholder">
              未連線。按頂欄「模擬」即可在場地圖上練習編輯路徑；
              連上機器人後可 op:path 下傳實跑。
            </div>
          ) : (
            <canvas
              ref={canvasRef}
              className="field-canvas"
              onMouseDown={onDown}
              onMouseMove={onMove}
              onMouseUp={onUp}
              onMouseLeave={onUp}
              onContextMenu={(e) => e.preventDefault()}
            />
          )}
        </div>
      </div>

      <div className="tuning-panel">
        <section>
          <h3>路徑點（{pts.length}）</h3>
          {pts.length === 0 && <div className="lv-hint">在場地圖上左鍵點擊新增路徑點。</div>}
          <table className="lv-matrix compact path-table">
            <tbody>
              {pts.map((wp, i) => (
                <tr key={i}>
                  <th>{i + 1}</th>
                  <td><NumBox value={wp.x} step={0.05} width={58}
                    onCommit={(v) => setPts(pts.map((p, j) => (j === i ? { ...p, x: v } : p)))} /></td>
                  <td><NumBox value={wp.y} step={0.05} width={58}
                    onCommit={(v) => setPts(pts.map((p, j) => (j === i ? { ...p, y: v } : p)))} /></td>
                  <td><NumBox value={wp.theta} step={5} width={50}
                    onCommit={(v) => setPts(pts.map((p, j) => (j === i ? { ...p, theta: v } : p)))} /></td>
                  <td>
                    <button className="btn preset" onClick={() => setPts(pts.filter((_, j) => j !== i))}>
                      刪
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="btn-row">
            <button className="btn" onClick={() => setPts(pts.slice(0, -1))} disabled={!pts.length}>
              復原
            </button>
            <button className="btn" onClick={() => setPts([])} disabled={!pts.length}>
              清空
            </button>
          </div>
          <button className="btn-start" onClick={send} disabled={!pts.length}>
            下傳路徑（op:path）
          </button>
          {msg && <div className="status-row" style={{ marginTop: 6 }}>{msg}</div>}
        </section>

        <section>
          <h3>本機路徑庫</h3>
          <div className="btn-row">
            <input
              className="host-input"
              style={{ flex: 1, width: "auto" }}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="路徑名稱"
            />
            <button className="btn" onClick={saveAs} disabled={!pts.length || !name.trim()}>
              儲存
            </button>
          </div>
          {Object.keys(saved).length === 0 && (
            <div className="lv-hint">尚無已存路徑。備賽期把常用路線（出發→箱堆→理貨→倉儲）都存起來。</div>
          )}
          {Object.entries(saved).map(([n, p]) => (
            <div key={n} className="btn-row">
              <button className="btn" style={{ flex: 1, textAlign: "left" }} onClick={() => load(n)}>
                {n}（{p.length} 點）
              </button>
              <button className="btn preset" onClick={() => remove(n)}>
                刪
              </button>
            </div>
          ))}
        </section>

        <section>
          <h3>分工</h3>
          <div className="lv-hint">
            這裡編輯的是「途經點序列」，下傳後機器人端依序餵給
            ChassisMoveProfile::Plan() 執行；賽中避障的即時重規劃（A*）
            在機器人端跑，本頁不取代它。編輯時綠線起點 = 機器人當前定位，
            起點對不上就先歸位再畫。
          </div>
        </section>
      </div>
    </>
  );
}
