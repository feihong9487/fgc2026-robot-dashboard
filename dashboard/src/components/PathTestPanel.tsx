// 連續路徑測試分頁 —— 兩種用法：
//
//  1. 離線模擬（不用接機器）：瀏覽器裡直接跑同一套路徑規劃（src/lib/path/，
//     從 C++ 移植，有 golden-vector 防漂移），編 waypoint 的當下就看得到真實的
//     路徑形狀、速度波形、總時間、每個轉角的實際半徑。
//  2. 連上機器後：同一組 waypoint 可以下傳實跑，把實測疊在規劃上比對。
//
// 座標系是 ContinuousMove 自己的場地座標系（cm／度，X=橫移、Y=直走、角度正=右轉），
// 與「路徑規劃」分頁的 4m×2m 公尺場地圖不同，故不共用 FieldView。
//
// 實機與模擬的一個差異要記得：實機的路徑起點是「當下測程位姿」，不是清單第一個點；
// 模擬沒有測程法，所以起點由下面的「模擬起點」欄位指定（可一鍵抓目前位姿）。
import { useEffect, useMemo, useRef, useState } from "react";
import { store } from "../lib/store";
import { client } from "../lib/RobotClient";
import { PT_K, TD_K } from "../lib/keys";
import { Chart } from "./Chart";
import { SimWaveChart } from "./SimWaveChart";
import { NumBox } from "./controls";
import { simulate, type SimResult } from "../lib/path/trajectory.ts";
import { defaultLimits } from "../lib/path/velocity.ts";
import type { Waypoint } from "../lib/path/geometry.ts";

const LS_PATHS = "vmx-dashboard.pathtest";

type WP = { x: number; y: number; theta: number };
type XY = [number, number];

// 一趟最多留幾個實測軌跡點（50ms 一批 → 4000 點約 3.3 分鐘）。
// 滿了就停止累積而不是丟頭：丟頭會把路徑起點吃掉，比截尾更難看懂。
const kMaxTracePts = 4000;

function loadSaved(): Record<string, WP[]> {
  try {
    return JSON.parse(localStorage.getItem(LS_PATHS) ?? "{}");
  } catch {
    return {};
  }
}

function useStore() {
  const [, force] = useState(0);
  useEffect(() => store.subscribe(() => force((n) => n + 1)), []);
}

export function PathTestPanel() {
  useStore();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pts, setPts] = useState<WP[]>([{ x: 0, y: 50, theta: 0 }]);
  const [start, setStart] = useState<WP>({ x: 0, y: 0, theta: 0 });
  const [saved, setSaved] = useState<Record<string, WP[]>>(loadSaved);
  const [name, setName] = useState("test-1");
  const [json, setJson] = useState("");
  const [msg, setMsg] = useState("");
  const [cornerLocal, setCornerLocal] = useState(-1);

  const offline = store.connState === "disconnected" || store.connState === "connecting";

  const running = store.bool(PT_K.running);
  const planOk = store.bool(PT_K.planOk);
  const wpCount = store.num(PT_K.wpCount);
  const totalTime = store.num(PT_K.totalTime);
  const length = store.num(PT_K.length);
  const err = store.str(PT_K.error);
  const tNow = store.num(PT_K.t);
  const vMax = store.num(PT_K.vMax, 0);
  const aMax = store.num(PT_K.aMax, 0);
  // 離線時沒有 NT，用本地值；連線後以機器人端為準（它才是真的會拿去規劃的值）
  const corner = offline ? cornerLocal : store.num(PT_K.corner, -1);

  const poseX = store.num(TD_K.poseX);
  const poseY = store.num(TD_K.poseY);
  const poseHead = store.num(TD_K.poseHead);
  const poseSpeed = store.num(TD_K.poseSpeed);
  const crossErr = store.num(TD_K.crossErr);
  const headingErr = store.num(TD_K.headingErr);

  // ── 離線模擬：waypoint 一改就重算 ──────────────────────────
  // 完整規劃（含 512 段貝茲細分）對一條路徑約幾毫秒，useMemo 足夠，不用 worker。
  const sim: SimResult = useMemo(() => {
    const lim = defaultLimits();
    if (vMax > 0) lim.wheelVMax_deg_s = vMax;
    if (aMax > 0) lim.aMax_cm_s2 = aMax;
    const wps: Waypoint[] = [
      { x_cm: start.x, y_cm: start.y, heading_deg: start.theta },
      ...pts.map((p) => ({ x_cm: p.x, y_cm: p.y, heading_deg: p.theta })),
    ];
    return simulate(wps, lim, corner);
  }, [pts, start, corner, vMax, aMax]);

  // ── 實測軌跡採樣 ──────────────────────────────────────────
  // 直接在 store 訂閱裡把 (x, y) 成對取下來。**不可以**改用 store.history 依索引
  // 配對 planX/planY：history 只在該 key 出現在那一批遙測裡才 push，而 bridge 只推
  // 送有變動的 NT entry——軸對齊路段上規劃的 planY 是幾何表算出的固定值，整段都不會
  // 進批次，兩條序列長度就此發散，配出來的點跟真實規劃完全無關。
  const traceRef = useRef<{ act: XY[] }>({ act: [] });
  const wasRunningRef = useRef(false);
  useEffect(
    () =>
      store.subscribe(() => {
        const on = store.bool(PT_K.running);
        if (on && !wasRunningRef.current) traceRef.current = { act: [] };
        wasRunningRef.current = on;
        if (!on) return;
        const tr = traceRef.current;
        if (tr.act.length >= kMaxTracePts) return;
        tr.act.push([store.num(TD_K.poseX), store.num(TD_K.poseY)]);
      }),
    [],
  );

  // ── XY 軌跡圖 ─────────────────────────────────────────────
  // 位姿與模擬結果走 ref 而非 effect 依賴：這些值每拍都變，放進依賴陣列會讓
  // 重繪 interval 每秒被拆掉重建二十次。
  const drawRef = useRef({ pts, start, poseX, poseY, poseHead, sim, running, offline });
  drawRef.current = { pts, start, poseX, poseY, poseHead, sim, running, offline };
  // 同 SimWaveChart：改成「每次 render 重畫」而不是常駐計時器。會改變畫面的三件事
  // （模擬結果、位姿、實測軌跡）都必然伴隨一次 render——useStore 讓每批遙測都觸發
  // render——所以計時器只是白燒 CPU，還會讓畫面永遠沒有靜止幀。
  const doDrawRef = useRef<() => void>(() => {});

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;

    const draw = () => {
      const { pts, start, poseX, poseY, poseHead, sim, running, offline } = drawRef.current;
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

      const act = traceRef.current.act;

      // 縮放範圍取「規劃 + 實測 + 目的地 + 起點 + 目前位姿」的包絡，至少 40cm 見方。
      // 目的地一定要算進來，綠點才不會掉到畫面外——「規劃線到底有沒有走到目的地」
      // 正是這張圖要回答的問題。
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      const grow = (x: number, y: number) => {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      };
      for (const [x, y] of sim.xy) grow(x, y);
      for (const [x, y] of act) grow(x, y);
      for (const wp of pts) grow(wp.x, wp.y);
      grow(start.x, start.y);
      if (!offline) grow(poseX, poseY);

      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const half = Math.max(20, (maxX - minX) / 2, (maxY - minY) / 2) * 1.15;

      const pad = 28;
      const scale = Math.min((w - pad * 2) / (2 * half), (h - pad * 2) / (2 * half));
      const ox = w / 2;
      const oy = h / 2;
      // X 向右、Y 向上（把 cm 數字照著讀就對得上；與 Waypoint 註解的 frame 一致）
      const toX = (x: number) => ox + (x - cx) * scale;
      const toY = (y: number) => oy - (y - cy) * scale;

      // 原點十字
      ctx.strokeStyle = "#232a38";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(toX(cx - half), toY(0));
      ctx.lineTo(toX(cx + half), toY(0));
      ctx.moveTo(toX(0), toY(cy - half));
      ctx.lineTo(toX(0), toY(cy + half));
      ctx.stroke();

      // 規劃路徑（本地模擬算出來的，離線也有）
      if (sim.xy.length > 1) {
        ctx.strokeStyle = "#4fc3f7";
        ctx.lineWidth = 2;
        ctx.beginPath();
        sim.xy.forEach(([x, y], i) =>
          i ? ctx.lineTo(toX(x), toY(y)) : ctx.moveTo(toX(x), toY(y)),
        );
        ctx.stroke();
      }

      // 實測軌跡（只有連線並跑過才有）
      if (act.length > 1) {
        ctx.strokeStyle = "#ffb74d";
        ctx.lineWidth = 2;
        ctx.beginPath();
        act.forEach(([x, y], i) => (i ? ctx.lineTo(toX(x), toY(y)) : ctx.moveTo(toX(x), toY(y))));
        ctx.stroke();
      }

      // 起點（空心方框，與目的地圓點區隔）
      ctx.strokeStyle = "#81c784";
      ctx.lineWidth = 2;
      ctx.strokeRect(toX(start.x) - 5, toY(start.y) - 5, 10, 10);

      // 目的地
      pts.forEach((wp, i) => {
        ctx.fillStyle = "#81c784";
        ctx.beginPath();
        ctx.arc(toX(wp.x), toY(wp.y), 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#0a0d12";
        ctx.font = "bold 9px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(String(i + 1), toX(wp.x), toY(wp.y) + 3);
        ctx.textAlign = "start";
      });

      // 沿規劃路徑標出機身朝向（每隔一段畫一根短鬚），holonomic 的機身角與行進
      // 方向解耦，不畫出來看不出 heading profile 在做什麼
      if (sim.ok && sim.samples.length) {
        ctx.strokeStyle = "rgba(79, 195, 247, 0.55)";
        ctx.lineWidth = 1.5;
        const every = Math.max(1, Math.floor(sim.samples.length / 14));
        for (let i = 0; i < sim.samples.length; i += every) {
          const s = sim.samples[i];
          const th = (s.heading_deg * Math.PI) / 180;
          const nose = 14 / scale;
          ctx.beginPath();
          ctx.moveTo(toX(s.x_cm), toY(s.y_cm));
          ctx.lineTo(toX(s.x_cm + Math.sin(th) * nose), toY(s.y_cm + Math.cos(th) * nose));
          ctx.stroke();
        }
      }

      // 目前位姿（連線時才畫）
      if (!offline) {
        const th = (poseHead * Math.PI) / 180;
        ctx.strokeStyle = "#e8ecf3";
        ctx.fillStyle = "rgba(232, 236, 243, 0.25)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(toX(poseX), toY(poseY), 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        const noseLen = 18 / scale;
        ctx.beginPath();
        ctx.moveTo(toX(poseX), toY(poseY));
        ctx.lineTo(toX(poseX + Math.sin(th) * noseLen), toY(poseY + Math.cos(th) * noseLen));
        ctx.stroke();
      }

      ctx.fillStyle = "#8b95a7";
      ctx.font = "11px sans-serif";
      const legend = offline
        ? `藍=規劃（本地模擬）　鬚=機身朝向　綠□=起點　綠●=目的地`
        : `藍=規劃　橘=實測　綠□=起點　綠●=目的地　白=目前位姿`;
      ctx.fillText(`${legend}　｜　尺度 ${(half * 2).toFixed(0)} cm`, pad / 2, h - 8);
      void running;
    };

    doDrawRef.current = draw;
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(canvas);
    return () => ro.disconnect();
    // 其餘輸入經 drawRef 熱更新（見上）
  }, []);

  // 每次 render 重畫一次
  useEffect(() => {
    doDrawRef.current();
  });

  // ── 動作 ──────────────────────────────────────────────────
  const run = () => {
    if (!pts.length) return;
    client.set(PT_K.waypoints, JSON.stringify(pts.map((p) => [p.x, p.y, p.theta])));
    client.set(PT_K.run, true);
    setMsg(`已下傳 ${pts.length} 點並執行（起點由機器人端的測程位姿自動補上）`);
  };
  const stop = () => {
    client.set(PT_K.stop, true);
    setMsg("已停止並把測程法歸零 (0,0,0) —— 下一趟以車子現在的位置為原點");
  };
  const setCorner = (v: number) => {
    setCornerLocal(v);
    if (!offline) client.set(PT_K.corner, v);
  };
  const importJson = () => {
    try {
      const v = JSON.parse(json);
      if (!Array.isArray(v)) throw new Error("不是陣列");
      setPts(v.map((p: number[]) => ({ x: +p[0] || 0, y: +p[1] || 0, theta: +p[2] || 0 })));
      setMsg(`已匯入 ${v.length} 點`);
    } catch (e) {
      setMsg(`匯入失敗：${(e as Error).message}`);
    }
  };
  const saveAs = () => {
    const next = { ...saved, [name]: pts };
    setSaved(next);
    localStorage.setItem(LS_PATHS, JSON.stringify(next));
    setMsg(`已存「${name}」（${pts.length} 點，本機）`);
  };
  const remove = (n: string) => {
    const next = { ...saved };
    delete next[n];
    setSaved(next);
    localStorage.setItem(LS_PATHS, JSON.stringify(next));
  };

  const simT = sim.samples.map((s) => s.t_s);

  return (
    <>
      <div className="run-left">
        <SimWaveChart
          title={`模擬速度波形（本地規劃，不需連線）${sim.ok ? `　總時間 ${sim.totalTime_s.toFixed(2)}s` : ""}`}
          t={simT}
          height={190}
          cursorT={running ? tNow : undefined}
          series={[
            { label: "規劃 v cm/s", color: "#4fc3f7", values: sim.samples.map((s) => s.v_cm_s) },
            {
              label: "規劃 ω °/s",
              color: "#81c784",
              dash: true,
              values: sim.samples.map((s) => s.omega_deg_s),
            },
          ]}
        />

        {!offline && (
          <Chart
            title="實機波形（規劃 vs 實測）"
            windowSec={20}
            height={165}
            series={[
              { key: PT_K.planV, label: "規劃 v cm/s", color: "#4fc3f7" },
              { key: PT_K.actualV, label: "實測 v cm/s", color: "#ffb74d" },
              { key: PT_K.planOmega, label: "規劃 ω °/s", color: "#81c784", dash: [5, 4] },
            ]}
          />
        )}

        <div className="field-wrap">
          <canvas ref={canvasRef} className="field-canvas" />
        </div>
      </div>

      <div className="run-side">
        <div className="run-block">
          <div className="run-block-title">
            模擬起點　X=橫移 / Y=直走 / θ 正=右轉，單位 cm・度
          </div>
          <div className="run-mech-row">
            <span>起點位姿</span>
            <span>
              <NumBox value={start.x} step={1} width={54}
                onCommit={(v) => setStart({ ...start, x: v })} />
              <NumBox value={start.y} step={1} width={54}
                onCommit={(v) => setStart({ ...start, y: v })} />
              <NumBox value={start.theta} step={5} width={50}
                onCommit={(v) => setStart({ ...start, theta: v })} />
            </span>
          </div>
          <button
            className="btn"
            style={{ width: "100%" }}
            disabled={offline}
            onClick={() => setStart({ x: poseX, y: poseY, theta: poseHead })}
          >
            用目前測程位姿當起點
          </button>
          <div className="lv-hint">
            只影響模擬。實機執行時起點一律是「當下測程位姿」，不看這個欄位——
            所以下面的路徑點清單不含起點。
          </div>
        </div>

        <div className="run-block">
          <div className="run-block-title">路徑點陣列（{pts.length}）</div>
          <table className="lv-matrix compact path-table">
            <thead>
              <tr><th /><th>X</th><th>Y</th><th>θ</th><th /></tr>
            </thead>
            <tbody>
              {pts.map((wp, i) => (
                <tr key={i}>
                  <th>{i + 1}</th>
                  <td><NumBox value={wp.x} step={1} width={58}
                    onCommit={(v) => setPts(pts.map((p, j) => (j === i ? { ...p, x: v } : p)))} /></td>
                  <td><NumBox value={wp.y} step={1} width={58}
                    onCommit={(v) => setPts(pts.map((p, j) => (j === i ? { ...p, y: v } : p)))} /></td>
                  <td><NumBox value={wp.theta} step={5} width={54}
                    onCommit={(v) => setPts(pts.map((p, j) => (j === i ? { ...p, theta: v } : p)))} /></td>
                  <td>
                    <button className="btn preset" onClick={() => setPts(pts.filter((_, j) => j !== i))}>刪</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="btn-row">
            <button
              className="btn"
              onClick={() =>
                setPts([...pts, pts.length ? { ...pts[pts.length - 1] } : { x: 0, y: 50, theta: 0 }])
              }
            >
              加一點
            </button>
            <button className="btn" onClick={() => setPts(pts.slice(0, -1))} disabled={!pts.length}>復原</button>
            <button className="btn" onClick={() => setPts([])} disabled={!pts.length}>清空</button>
          </div>
        </div>

        <div className="run-block">
          <div className="run-block-title">模擬結果（本地算的，不需連線）</div>
          {sim.ok ? (
            <>
              <div className="run-mech-row"><span>總時間</span><span className="run-mech-val">{sim.totalTime_s.toFixed(2)} s</span></div>
              <div className="run-mech-row"><span>弧長</span><span className="run-mech-val">{sim.length_cm.toFixed(1)} cm</span></div>
              <div className="run-mech-row"><span>倒角數</span><span className="run-mech-val">{sim.corners}</span></div>
              <div className="run-mech-row">
                <span>最小過彎半徑</span>
                <span className="run-mech-val">
                  {Number.isFinite(sim.minRadius_cm) ? `${sim.minRadius_cm.toFixed(1)} cm` : "直線"}
                </span>
              </div>
              <div className="run-mech-row">
                <span>dθ/ds 峰值倍率</span>
                <span className="run-mech-val">{sim.peakToMeanTurnRate.toFixed(3)}×</span>
              </div>
              <div className="run-mech-row">
                <span>平均速度</span>
                <span className="run-mech-val">
                  {(sim.length_cm / Math.max(sim.totalTime_s, 1e-6)).toFixed(1)} cm/s
                </span>
              </div>
            </>
          ) : (
            <div className="status-row" style={{ color: "#e57373" }}>
              {sim.error || "規劃失敗"}
            </div>
          )}
        </div>

        <div className="run-block">
          <div className="run-block-title">規劃參數</div>
          <div className="run-mech-row">
            <span>轉角倒角 cm（&lt;0=自動）</span>
            <NumBox value={corner} step={1} width={70} onCommit={setCorner} />
          </div>
          <div className="run-mech-row">
            <span>vMax deg/s（0=預設）</span>
            <NumBox value={vMax} step={10} width={70} disabled={offline}
              onCommit={(v) => client.set(PT_K.vMax, v)} />
          </div>
          <div className="run-mech-row">
            <span>aMax cm/s²（0=預設）</span>
            <NumBox value={aMax} step={5} width={70} disabled={offline}
              onCommit={(v) => client.set(PT_K.aMax, v)} />
          </div>
          <div className="lv-hint">
            倒角負值 = 自動：依每個轉角的角度反解深度，讓各轉角的過彎半徑一致。
            固定深度的問題是同一個值在 30° 轉角給 62cm 半徑、150° 只剩 1.5cm。
            0 = 走尖角（過彎會停）。vMax/aMax 是機器人端的值，離線時不可調。
          </div>
        </div>

        <div className="btn-row">
          <button className="btn-start" style={{ flex: 1 }} onClick={run}
                  disabled={!pts.length || running || offline}>
            {offline ? "未連線（僅模擬）" : running ? "執行中…" : "下傳並執行"}
          </button>
          <button className="btn" onClick={stop} disabled={offline}
                  title="取消目前這一趟，並把測程法位姿歸零 (0,0,0)">
            停止 / 歸零
          </button>
        </div>
        {msg && <div className="status-row">{msg}</div>}
        {err && <div className="status-row" style={{ color: "#e57373" }}>機器人端：{err}</div>}

        {!offline && (
          <>
            <div className="run-block">
              <div className="run-block-title">實機規劃結果</div>
              <div className="run-mech-row">
                <span>狀態</span>
                <span className="run-mech-val" style={{ color: planOk ? "#81c784" : "#e57373" }}>
                  {running ? "執行中" : planOk ? "規劃成功" : "尚未規劃／失敗"}
                </span>
              </div>
              <div className="run-mech-row"><span>規劃點數（含起點）</span><span className="run-mech-val">{wpCount.toFixed(0)}</span></div>
              <div className="run-mech-row"><span>總時間</span><span className="run-mech-val">{totalTime.toFixed(2)} s</span></div>
              <div className="run-mech-row"><span>弧長</span><span className="run-mech-val">{length.toFixed(1)} cm</span></div>
              <div className="run-mech-row"><span>已跑</span><span className="run-mech-val">{tNow.toFixed(2)} s</span></div>
            </div>

            <div className="run-block">
              <div className="run-block-title">測程法位姿</div>
              <div className="run-mech-row"><span>X</span><span className="run-mech-val">{poseX.toFixed(1)} cm</span></div>
              <div className="run-mech-row"><span>Y</span><span className="run-mech-val">{poseY.toFixed(1)} cm</span></div>
              <div className="run-mech-row"><span>θ</span><span className="run-mech-val">{poseHead.toFixed(1)}°</span></div>
              <div className="run-mech-row"><span>速度</span><span className="run-mech-val">{poseSpeed.toFixed(1)} cm/s</span></div>
              <div className="run-mech-row"><span>cross-track 誤差</span><span className="run-mech-val">{crossErr.toFixed(1)} cm</span></div>
              <div className="run-mech-row"><span>航向誤差</span><span className="run-mech-val">{headingErr.toFixed(1)}°</span></div>
            </div>
          </>
        )}

        <div className="run-block">
          <div className="run-block-title">JSON 匯入 / 匯出</div>
          <textarea
            className="host-input"
            style={{ width: "100%", height: 64, fontFamily: "monospace", fontSize: 11 }}
            value={json}
            onChange={(e) => setJson(e.target.value)}
            placeholder="[[x,y,theta], ...]"
          />
          <div className="btn-row">
            <button className="btn" onClick={importJson} disabled={!json.trim()}>匯入</button>
            <button className="btn"
              onClick={() => setJson(JSON.stringify(pts.map((p) => [p.x, p.y, p.theta])))}>
              匯出目前
            </button>
          </div>
        </div>

        <div className="run-block">
          <div className="run-block-title">本機路徑庫</div>
          <div className="btn-row">
            <input className="host-input" style={{ flex: 1, width: "auto" }} value={name}
              onChange={(e) => setName(e.target.value)} placeholder="名稱" />
            <button className="btn" onClick={saveAs} disabled={!pts.length || !name.trim()}>儲存</button>
          </div>
          {Object.entries(saved).map(([n, p]) => (
            <div key={n} className="btn-row">
              <button className="btn" style={{ flex: 1, textAlign: "left" }}
                onClick={() => { setName(n); setPts(p); }}>
                {n}（{p.length} 點）
              </button>
              <button className="btn preset" onClick={() => remove(n)}>刪</button>
            </div>
          ))}
        </div>

        <div className="lv-hint">
          模擬用的是從 C++ 移植過來的同一套規劃（src/lib/path/），並以 golden vector
          擋漂移：改過任一邊都要重跑
          <code> .\tools\mathtest\build.ps1 golden -Csv dashboard-app\tools\golden.json </code>
          與 <code>npm run golden</code>。
          {!offline && (
            <>
              <br />
              注意：按「下傳並執行」會排程一個佔用底盤的 ContinuousMove，正在跑的
              AutoMain 段落會被直接打斷。
            </>
          )}
        </div>
      </div>
    </>
  );
}
