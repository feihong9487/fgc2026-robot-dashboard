// 光達點雲檢視器：Canvas 2D，滾輪縮放、拖曳平移、格線 + 機器人圖示
import { useEffect, useRef, useState } from "react";
import { store } from "../lib/store";

export function PointCloudPanel() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const view = useRef({ scale: 120, cx: 0, cy: 0 }); // scale: px/公尺
  const drag = useRef<{ x: number; y: number } | null>(null);
  const [stale, setStale] = useState(true);
  const [, force] = useState(0); // 鏡像鈕切換後重繪按鈕狀態

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const { scale, cx, cy } = view.current;
      // 世界(公尺, x前 y左) → 螢幕：前方朝上
      const toX = (mx: number, my: number) => w / 2 - (my - cy) * scale;
      const toY = (mx: number, my: number) => h / 2 - (mx - cx) * scale;

      // 格線（每 0.5m）
      ctx.strokeStyle = "#232a38";
      ctx.lineWidth = 1;
      const range = Math.max(w, h) / scale;
      const step = scale > 200 ? 0.25 : scale > 60 ? 0.5 : 1;
      const startX = Math.floor((cx - range) / step) * step;
      const startY = Math.floor((cy - range) / step) * step;
      for (let m = startX; m < cx + range; m += step) {
        ctx.beginPath();
        ctx.moveTo(toX(m, cy - range), toY(m, cy - range));
        ctx.lineTo(toX(m, cy + range), toY(m, cy + range));
        ctx.stroke();
      }
      for (let m = startY; m < cy + range; m += step) {
        ctx.beginPath();
        ctx.moveTo(toX(cx - range, m), toY(cx - range, m));
        ctx.lineTo(toX(cx + range, m), toY(cx + range, m));
        ctx.stroke();
      }

      // 距離圈（1m / 2m / 3m，以機器人為圓心）
      ctx.strokeStyle = "#2e3950";
      for (const r of [1, 2, 3]) {
        ctx.beginPath();
        ctx.arc(toX(0, 0), toY(0, 0), r * scale, 0, Math.PI * 2);
        ctx.stroke();
      }

      // 笛卡兒選點窗口（細綠框）：TLS 實際採納的點就落在這個框裡。畫在點雲之前，
      // 讓點蓋在框上。同時畫 perpRef 中線（紅色）：框近邊與遠邊的中點連線，
      // 也就是深度閘門的中心，標出 perpRef 定位到的牆深。
      const win = store.fitWindowQuads();
      const winFresh = store.now() - store.fitWindowsStamp < 1.5;
      if (winFresh && win.length >= 8) {
        for (let i = 0; i + 7 < win.length; i += 8) {
          ctx.strokeStyle = "#4caf50";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(toX(win[i], win[i + 1]), toY(win[i], win[i + 1]));
          for (let k = 2; k < 8; k += 2)
            ctx.lineTo(toX(win[i + k], win[i + k + 1]), toY(win[i + k], win[i + k + 1]));
          ctx.closePath();
          ctx.stroke();

          // perpRef 中線：角0-角1 中點 → 角2-角3 中點
          const ax = (win[i] + win[i + 2]) / 2;
          const ay = (win[i + 1] + win[i + 3]) / 2;
          const bx = (win[i + 4] + win[i + 6]) / 2;
          const by = (win[i + 5] + win[i + 7]) / 2;
          ctx.strokeStyle = "#ff5252";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(toX(ax, ay), toY(ax, ay));
          ctx.lineTo(toX(bx, by), toY(bx, by));
          ctx.stroke();
        }
      }

      // 點雲；套用鏡像設定
      const pc = store.points();
      const fresh = store.now() - store.pointCloudStamp < 1.5;
      ctx.fillStyle = fresh ? "#4fc3f7" : "#546274";
      const sz = Math.max(2, scale * 0.02);
      for (let i = 0; i + 1 < pc.length; i += 2) {
        ctx.fillRect(toX(pc[i], pc[i + 1]) - sz / 2, toY(pc[i], pc[i + 1]) - sz / 2, sz, sz);
      }

      // 牆面擬合線（紅色）：TLS 擬合出的前牆／左牆線段，與點雲同座標框。
      const seg = store.fitSegments();
      const fitFresh = store.now() - store.fitLinesStamp < 1.5;
      if (fitFresh && seg.length >= 4) {
        ctx.strokeStyle = "#ff5252";
        ctx.lineWidth = 2.5;
        for (let i = 0; i + 3 < seg.length; i += 4) {
          ctx.beginPath();
          ctx.moveTo(toX(seg[i], seg[i + 1]), toY(seg[i], seg[i + 1]));
          ctx.lineTo(toX(seg[i + 2], seg[i + 3]), toY(seg[i + 2], seg[i + 3]));
          ctx.stroke();
        }
        ctx.lineWidth = 1;
      }

      // 機器人（三角形，朝上 = x 正方向）
      const rx = toX(0, 0);
      const ry = toY(0, 0);
      const s = Math.max(10, scale * 0.12);
      ctx.fillStyle = "#ffb74d";
      ctx.beginPath();
      ctx.moveTo(rx, ry - s);
      ctx.lineTo(rx - s * 0.6, ry + s * 0.7);
      ctx.lineTo(rx + s * 0.6, ry + s * 0.7);
      ctx.closePath();
      ctx.fill();

      // 比例尺
      ctx.fillStyle = "#8b95a7";
      ctx.font = "12px sans-serif";
      ctx.fillText(`格線 ${step}m｜點數 ${pc.length / 2}`, 10, h - 10);
    };

    const timer = window.setInterval(() => {
      draw();
      setStale(store.now() - store.pointCloudStamp > 1.5);
    }, 66); // ~15fps
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="pointcloud-wrap">
      <div className="pc-controls">
        <button
          className={"pc-toggle" + (store.flipV ? " active" : "")}
          onClick={() => { store.setFlipV(!store.flipV); force((k) => k + 1); }}
        >
          上下鏡像
        </button>
        <button
          className={"pc-toggle" + (store.flipH ? " active" : "")}
          onClick={() => { store.setFlipH(!store.flipH); force((k) => k + 1); }}
        >
          左右鏡像
        </button>
      </div>
      {stale && (
        <div className="pc-overlay">
          等待點雲資料…（機器人端呼叫 DashboardBridge::PublishPointCloud）
        </div>
      )}
      <canvas
        ref={canvasRef}
        className="pointcloud-canvas"
        onWheel={(e) => {
          const v = view.current;
          v.scale = Math.min(800, Math.max(20, v.scale * (e.deltaY < 0 ? 1.15 : 0.87)));
        }}
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, y: e.clientY };
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const v = view.current;
          v.cy += (e.clientX - drag.current.x) / v.scale;
          v.cx += (e.clientY - drag.current.y) / v.scale;
          drag.current = { x: e.clientX, y: e.clientY };
        }}
        onPointerUp={() => (drag.current = null)}
        onDoubleClick={() => {
          view.current = { scale: 120, cx: 0, cy: 0 };
        }}
      />
      <div className="pc-hint">滾輪縮放｜拖曳平移｜雙擊重置</div>
    </div>
  );
}
