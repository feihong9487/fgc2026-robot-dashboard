// 場地圖（Field2d）：2×4 m 場地俯視圖 — 機器人位姿、A* 路徑、障礙物、
// 走過的軌跡。座標系（配合機器人端 FieldMap.h）：原點右下角，x ∈ [-4,0] 長邊
// （左負），y ∈ [0,2] 短邊（上正，未變動）。
import { useEffect, useRef } from "react";
import { store } from "../lib/store";
import { SIM_K } from "../lib/keys";

const FIELD_W = 4; // m
const FIELD_H = 2; // m
const ROBOT_R = 0.175; // Ø350 底盤

// 畫布內部仍用「左下原點、x∈[0,4]」的局部顯示座標算像素（occupancy grid 那格陣列本來
// 就是這個局部座標，見下方）；場地端傳來的絕對座標（機器人位姿、先驗物件、障礙物、
// 路徑點）現在是 x∈[-4,0]，丟進 toX 前先用這個平移回局部座標。
const toLocalX = (fieldXm: number) => fieldXm + FIELD_W;

function parsePairs(json: string): number[][] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((p) => Array.isArray(p)) : [];
  } catch {
    return [];
  }
}

export function FieldView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const trail = useRef<number[][]>([]);

  useEffect(() => {
    const canvas = canvasRef.current!;
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

      // 等比縮放置中
      const pad = 24;
      const scale = Math.min((w - pad * 2) / FIELD_W, (h - pad * 2) / FIELD_H);
      const ox = (w - FIELD_W * scale) / 2;
      const oy = (h + FIELD_H * scale) / 2; // y 向上
      const toX = (mx: number) => ox + mx * scale;
      const toY = (my: number) => oy - my * scale;

      // 場地底 + 格線（0.5m）
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

      // Occupancy grid（通道 4）：畫在區域標記與點雲之下。col 沿長邊 x、row 沿短邊 y，
      // 2cm 格。UNKNOWN 不畫（透明）、FREE 淡藍、OCCUPIED 紅。上機建圖時看這層。
      const g = store.grid;
      if (g && g.cells.length === g.cols * g.rows) {
        const cs = 0.02; // 2cm，與機器人端 FieldMap kCellSizeCm 一致
        const wpx = Math.ceil(cs * scale) + 1; // 稍微放大避免格間縫隙
        for (let row = 0; row < g.rows; row++) {
          for (let col = 0; col < g.cols; col++) {
            const s = g.cells[row * g.cols + col];
            if (s === 0) continue;
            ctx.fillStyle = s === 2 ? "rgba(229, 115, 115, 0.6)" : "rgba(79, 195, 247, 0.10)";
            ctx.fillRect(toX(col * cs), toY((row + 1) * cs), wpx, wpx);
          }
        }
      }

      // 固定區域標記：出發區（45×45cm）、理貨區、倉儲櫃
      const zone = (x: number, y: number, wm: number, hm: number, color: string, name: string) => {
        ctx.strokeStyle = color;
        ctx.setLineDash([5, 4]);
        ctx.lineWidth = 1.5;
        ctx.strokeRect(toX(toLocalX(x)), toY(y + hm), wm * scale, hm * scale);
        ctx.setLineDash([]);
        ctx.fillStyle = color;
        ctx.font = "11px sans-serif";
        ctx.fillText(name, toX(toLocalX(x)) + 4, toY(y + hm) + 13);
      };
      // 位置/尺寸依大會示意圖，與機器人端 lib/mapping/FieldMap.h 一致（公分→公尺，
      // 原點右下角）。出發區=45×45 右下角；倉儲櫃=16.6×11 左中；領貨區=25.2×9.1 右上；
      // 整理箱=11×7 上右。
      zone(-0.525, 0.035, 0.45, 0.45, "#81c784", "出發區");
      zone(-3.975, 1.237, 0.11, 0.166, "#ba68c8", "倉儲櫃");
      zone(-0.096, 1.554, 0.091, 0.252, "#4fc3f7", "領貨區");
      zone(-0.505, 1.915, 0.11, 0.07, "#ffb74d", "整理箱");

      // 障礙物
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

      // 規劃路徑
      const path = parsePairs(String(store.latest.get(SIM_K.pathJson) ?? "[]"));
      if (path.length >= 2) {
        ctx.strokeStyle = "#4fc3f7";
        ctx.lineWidth = 2;
        ctx.setLineDash([7, 5]);
        ctx.beginPath();
        ctx.moveTo(toX(toLocalX(path[0][0])), toY(path[0][1]));
        for (let i = 1; i < path.length; i++) ctx.lineTo(toX(toLocalX(path[i][0])), toY(path[i][1]));
        ctx.stroke();
        ctx.setLineDash([]);
        // 終點旗標
        const last = path[path.length - 1];
        ctx.fillStyle = "#4fc3f7";
        ctx.beginPath();
        ctx.arc(toX(toLocalX(last[0])), toY(last[1]), 5, 0, Math.PI * 2);
        ctx.fill();
      }

      // 機器人：位姿 + 走過軌跡。px/py 是機器人端場地絕對座標（原點右下角），trail
      // 也存絕對座標——只有丟進 toX 畫布轉換前才需要 toLocalX，判斷移動距離等純數學
      // 用絕對座標即可（平移不影響差值）。
      const px = store.num(SIM_K.poseX, 0.35);
      const py = store.num(SIM_K.poseY, 0.35);
      const lpx = toLocalX(px);
      const theta = (store.num(SIM_K.poseTheta, 0) * Math.PI) / 180;

      const tr = trail.current;
      const lastT = tr[tr.length - 1];
      if (!lastT || Math.hypot(px - lastT[0], py - lastT[1]) > 0.02) {
        tr.push([px, py]);
        if (tr.length > 400) tr.splice(0, tr.length - 400);
      }
      if (tr.length >= 2) {
        ctx.strokeStyle = "rgba(129, 199, 132, 0.5)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(toX(toLocalX(tr[0][0])), toY(tr[0][1]));
        for (const p of tr) ctx.lineTo(toX(toLocalX(p[0])), toY(p[1]));
        ctx.stroke();
      }

      // 車身畫成三角形，對上實體三顆全向輪：前二後一。**車頭是兩個前輪連成的平邊，
      // 不是尖端**；尖端是單一後輪、指向車尾。圓形只能靠一條線表示方向、歪了不容易
      // 一眼看出；三角形帶方向、歪掉很明顯。
      // heading 0° = 車頭朝 +y、順時針為正（FieldMap.h 的慣例，機器人端與這裡共用），
      // 故車頭單位向量 = (sin θ, cos θ) —— 不是常見的 (cos, sin)。寫成 (cos, sin)
      // 畫出來的車頭會歪 90° 且左右鏡射，看起來「有動」但指向是錯的。
      const nx = Math.sin(theta); // 車頭方向
      const ny = Math.cos(theta);
      // 車身右手邊 = 車頭順時針轉 90°（順時針為正，故 θ+90 → (cos θ, −sin θ)）。
      const rx = ny;
      const ry = -nx;
      // 機體座標 (right, fwd) → 畫布局部座標（已用 lpx 平移過，直接餵 toX 不用再轉一次）。
      // fwd>0 朝車頭、fwd<0 朝車尾。
      const bx = (r: number, f: number) => lpx + r * rx + f * nx;
      const by = (r: number, f: number) => py + r * ry + f * ny;

      ctx.fillStyle = "rgba(255, 183, 77, 0.25)";
      ctx.strokeStyle = "#ffb74d";
      ctx.lineWidth = 2;
      ctx.beginPath();
      // 前左輪 → 前右輪（這條平邊朝 +fwd = 車頭）→ 後輪尖端（−fwd = 車尾）
      ctx.moveTo(toX(bx(-ROBOT_R * 0.85, ROBOT_R * 0.55)), toY(by(-ROBOT_R * 0.85, ROBOT_R * 0.55)));
      ctx.lineTo(toX(bx(ROBOT_R * 0.85, ROBOT_R * 0.55)), toY(by(ROBOT_R * 0.85, ROBOT_R * 0.55)));
      ctx.lineTo(toX(bx(0, -ROBOT_R)), toY(by(0, -ROBOT_R)));
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // 三角形內部的圓 = 光達（X4 裝在底盤中心）。圓內短線畫的是**有效掃描 0°**，
      // 與車頭同向（+fwd）。光達雖是反裝的，但 X4Lidar.cpp 的 kMountOffsetDeg = 180
      // 已經把那 180° 吃掉一次，到 LidarFrame 這層 0° 就是車頭方向 —— SLAM 用的是
      // 這個有效朝向，所以這裡畫 +fwd（畫實體反裝的 −fwd 會與那句慣例自相矛盾）。
      const lidarR = ROBOT_R * 0.32;
      ctx.fillStyle = "rgba(79, 195, 247, 0.18)";
      ctx.strokeStyle = "#4fc3f7";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(toX(lpx), toY(py), lidarR * scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(toX(lpx), toY(py));
      ctx.lineTo(toX(bx(0, lidarR)), toY(by(0, lidarR)));
      ctx.stroke();

      // 標尺
      ctx.fillStyle = "#8b95a7";
      ctx.font = "11px sans-serif";
      // 標尺文字要短到窄面板也不會被畫布右緣切掉；三角形/光達的完整說明放在
      // 「定位建圖」分頁的圖例，那裡會換行。
      ctx.fillText("2 × 4 m｜格線 0.5 m｜平邊 = 車頭（尖端為車尾），內圓 = 光達", toX(0), toY(0) + 16);
    };

    const timer = window.setInterval(draw, 66); // ~15fps
    return () => clearInterval(timer);
  }, []);

  return <canvas ref={canvasRef} className="field-canvas" />;
}
