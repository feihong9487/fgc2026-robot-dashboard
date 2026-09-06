// 乒乓球定位調參面板 — 滑桿透過 WS 橋接器寫入 NT BallVision/Tuning/*，
// 機器人端 BallVision 即時生效（調色 → 霍夫圓 → 最近球的機器座標）。
// 串流網址從 CameraPublisher/<名稱>/streams 解析（主機名換成輸入的 IP），失敗時退回預設埠。
import { useEffect, useRef, useState } from "react";
import { store } from "../lib/store";
import { client } from "../lib/RobotClient";
import {
  ALL_VISION_PARAMS,
  COLOR_NAMES,
  DEPTH_STREAM_MAX_MM,
  FIELD_VISION_GROUPS,
  VISION_STREAMS,
  VisionParamDef,
  controlKey,
  resultKey,
  tuningKey,
} from "../lib/visionKeys";

function useStore() {
  const [, force] = useState(0);
  useEffect(() => store.subscribe(() => force((n) => n + 1)), []);
}

/** 滑桿拖動期間節流送出（50ms 尾端補送），避免灌爆 WS/NT */
function useThrottledSet() {
  const pending = useRef(new Map<string, number>());
  const timer = useRef<number | null>(null);

  return (key: string, value: number) => {
    pending.current.set(key, value);
    if (timer.current !== null) return;
    timer.current = window.setTimeout(() => {
      timer.current = null;
      pending.current.forEach((v, k) => client.set(k, v));
      pending.current.clear();
    }, 50);
  };
}

/** 取目前參數值：機器人回報值優先，未連線時用預設值 */
function currentParams(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of ALL_VISION_PARAMS) {
    const v = store.num(tuningKey(p.name), p.def);
    out[p.name] = p.int ? Math.round(v) : v;
  }
  return out;
}

function download(filename: string, text: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "application/octet-stream" }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** 產生 BallVisionParams.h — 與機器人端 BallVisionParams.h 相同格式 */
function generateHeader(params: Record<string, number>): string {
  const lines = ALL_VISION_PARAMS.map((p) => {
    const name = "k" + p.name[0].toUpperCase() + p.name.slice(1);
    const v = params[p.name];
    return p.int
      ? `constexpr int    ${name.padEnd(22)} = ${Math.round(v)};`
      : `constexpr double ${name.padEnd(22)} = ${Number.isInteger(v) ? v.toFixed(1) : String(v)};`;
  });
  return (
    "// 此檔案由 VMX Dashboard 匯出產生。\n" +
    "// 參數優先序:NetworkTables 即時值(BallVision/Tuning) > 本檔預設值。\n" +
    "#pragma once\n\n" +
    "namespace ballvisionparams {\n" +
    lines.join("\n") +
    "\n}  // namespace ballvisionparams\n"
  );
}

/** 從 CameraPublisher streams 解析 MJPEG 網址，主機名換成使用者輸入（同 sources.py） */
function resolveStreamUrl(ntName: string, host: string, fallbackPort: number): string {
  const streams = store.strArr(`/CameraPublisher/${ntName}/streams`);
  for (const s of streams) {
    if (!s.startsWith("mjpg:")) continue;
    try {
      const u = new URL(s.slice("mjpg:".length));
      u.hostname = host;
      return u.toString();
    } catch {
      /* 網址格式不符就試下一筆 */
    }
  }
  return `http://${host}:${fallbackPort}/stream.mjpg`;
}

function ParamSlider({ def: p }: { def: VisionParamDef }) {
  const throttledSet = useThrottledSet();
  const [drag, setDrag] = useState<number | null>(null);

  const key = tuningKey(p.name);
  const robotVal = store.num(key, p.def);
  const val = drag ?? robotVal;

  const send = (v: number) => {
    setDrag(v);
    throttledSet(key, v);
  };

  if (p.options) {
    return (
      <label className="v-slider">
        <span className="vs-label">{p.label}</span>
        <select
          value={Math.round(val)}
          onChange={(e) => {
            setDrag(null);
            client.set(key, parseInt(e.target.value, 10));
          }}
        >
          {p.options.map((name, i) => (
            <option key={name} value={i}>{name}</option>
          ))}
        </select>
      </label>
    );
  }

  // 0/1 開關型參數用 checkbox 呈現
  if (p.min === 0 && p.max === 1 && p.step === 1) {
    return (
      <label className="v-slider">
        <span className="vs-label">{p.label}</span>
        <input
          type="checkbox"
          checked={val >= 0.5}
          onChange={(e) => {
            setDrag(null);
            client.set(key, e.target.checked ? 1 : 0);
          }}
        />
        <span className="vs-value">{val >= 0.5 ? "開" : "關"}</span>
      </label>
    );
  }

  const digits = p.step >= 1 ? 0 : p.step >= 0.1 ? 1 : 2;
  return (
    <label className="v-slider">
      <span className="vs-label">{p.label}</span>
      <input
        type="range"
        min={p.min}
        max={p.max}
        step={p.step}
        value={val}
        onChange={(e) => send(parseFloat(e.target.value))}
        onPointerUp={() => {
          // 放開時立即補送最後值（不等節流），再交還給機器人回報值
          if (drag !== null) client.set(key, drag);
          setDrag(null);
        }}
      />
      <span className="vs-value">{val.toFixed(digits)}</span>
    </label>
  );
}

/** 側邊主讀數：最近球的顏色 + 機器座標（比賽時最常盯的兩個值） */
function TargetCard() {
  const has = store.bool(resultKey("HasBall"), false);
  const code = Math.round(store.num(resultKey("Color"), 0));
  const worldOk = store.bool(resultKey("WorldOk"), false);
  const xCm = store.num(resultKey("X_cm"), 0);
  const yCm = store.num(resultKey("Y_cm"), 0);
  const dist = store.num(resultKey("DistMm"), 0);
  const age = store.num(resultKey("AgeFrames"), 0);
  const hasDepth = store.bool(resultKey("HasDepth"), false);
  const depthMode = store.bool(resultKey("DepthMode"), false);

  return (
    <section className="target-card">
      <h3>最近球</h3>
      {!has ? (
        <div className="tc-empty">無目標</div>
      ) : (
        <>
          <div className="tc-color">
            <span className={`tc-swatch c${code}`} />
            <span className="tc-color-name">{COLOR_NAMES[code] ?? "?"}球</span>
            {age > 0 && <span className="tc-stale">coasting {age.toFixed(0)}</span>}
          </div>
          {worldOk ? (
            <div className="tc-xy">
              <div>
                <span className="tc-axis">X（左+）</span>
                <span className="tc-num">{xCm.toFixed(1)}</span>
                <span className="tc-unit">cm</span>
              </div>
              <div>
                <span className="tc-axis">Y（前+）</span>
                <span className="tc-num">{yCm.toFixed(1)}</span>
                <span className="tc-unit">cm</span>
              </div>
            </div>
          ) : (
            // 深度破洞會退用假定高度反投影仍給座標，所以到這裡多半是內參沒注入成功；
            // LifeCam 沒有深度，靠盒底平面交點，缺 camera_calibration.json 才會這樣。
            <div className="tc-nowarn">
              {hasDepth
                ? "無機器座標 —— 相機內參未注入（看 riolog 彩色內參那行）"
                : "無機器座標 —— 缺 deploy/camera_calibration.json"}
            </div>
          )}
          {dist > 0 && (
            <div className="tc-dist">
              距離 {dist.toFixed(0)} mm
              <span className="tc-distsrc">
                {depthMode ? "深度實測" : hasDepth ? "推算（破洞退定高）" : "推算"}
              </span>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/**
 * 深度圖的色階說明。機器人端把 0~DEPTH_STREAM_MAX_MM 映射成 JET 偽彩色後才送出，
 * 光看畫面無從得知藍/紅各代表幾公分 —— 這條色帶就是那個對照表。
 * 上面另外標出深度上下限（會被當遮罩用），一眼看出哪一段的東西才進得了辨識。
 */
function DepthLegend() {
  // OpenCV COLORMAP_JET 的關鍵色停點（0→1）
  const jet =
    "linear-gradient(to right, #00007f 0%, #0000ff 12.5%, #00ffff 37.5%," +
    " #ffff00 62.5%, #ff0000 87.5%, #7f0000 100%)";
  const max = DEPTH_STREAM_MAX_MM;
  const lo = store.num(tuningKey("depthMinMm"), 100);
  const hi = store.num(tuningKey("depthMaxMm"), max);
  const pct = (mm: number) => `${Math.min(100, Math.max(0, (mm / max) * 100))}%`;
  const center = store.num("/SmartDashboard/DepthCamera/CenterDepth_mm", 0);

  return (
    <div className="depth-legend">
      <div className="dl-bar" style={{ background: jet }}>
        {/* 深度帶以外的區域壓暗：那些像素在辨識時已經被閘掉 */}
        <div className="dl-cut" style={{ left: 0, width: pct(lo) }} />
        <div className="dl-cut" style={{ left: pct(hi), right: 0 }} />
        <div className="dl-edge" style={{ left: pct(lo) }} />
        <div className="dl-edge" style={{ left: pct(hi) }} />
      </div>
      <div className="dl-scale">
        <span>0</span>
        <span>{(max / 4).toFixed(0)}</span>
        <span>{(max / 2).toFixed(0)}</span>
        <span>{((max * 3) / 4).toFixed(0)}</span>
        <span>{max} mm</span>
      </div>
      <div className="vision-hint">
        亮起來的一段 = 深度上下限（{lo.toFixed(0)}–{hi.toFixed(0)} mm）內，只有這段的像素會進辨識；
        兩側壓暗處已被深度閘刷掉。畫面中央白十字是測距取樣點
        {center > 0 && <>，目前讀到 <b>{center.toFixed(0)} mm</b></>}。
        黑色 = 沒有深度（破洞：反光、太近或超出量測範圍）。
      </div>
    </div>
  );
}

function ResultsBar() {
  const has = store.bool(resultKey("HasBall"), false);
  const color = COLOR_NAMES[Math.round(store.num(resultKey("Color"), 0))] ?? "?";
  const xNorm = store.num(resultKey("XNorm"), 0);
  const radius = store.num(resultKey("RadiusPx"), 0);
  const dist = store.num(resultKey("DistMm"), 0);
  const worldOk = store.bool(resultKey("WorldOk"), false);
  const xCm = store.num(resultKey("X_cm"), 0);
  const yCm = store.num(resultKey("Y_cm"), 0);
  const count = store.num(resultKey("CircleCount"), 0);
  const raw = store.num(resultKey("RawCircleCount"), 0);
  const age = store.num(resultKey("AgeFrames"), 0);
  // 兩個旗標分開看：hasDepth = 這一幀有深度圖（深度串流活著、D2C 有對齊）；
  // depthMode = 選中的那顆球的距離是深度實測（否則是盒底平面交點推算的）。
  const hasDepth = store.bool(resultKey("HasDepth"), false);
  const depthMode = store.bool(resultKey("DepthMode"), false);

  return (
    <div className="vision-results">
      <span className={has ? "vr-target on" : "vr-target"}>
        {has ? `最近球：${color}` : "無目標"}
      </span>
      {has && (
        <>
          <span>{worldOk ? `機器 (${xCm.toFixed(1)}, ${yCm.toFixed(1)})cm` : "機器座標 —"}</span>
          <span>{dist > 0 ? `距離 ${dist.toFixed(0)}mm${depthMode ? "（深度）" : "（推算）"}` : "距離 —"}</span>
          <span>xNorm {xNorm.toFixed(2)}</span>
          <span>半徑 {radius.toFixed(0)}px</span>
          {age > 0 && <span>coasting {age}</span>}
        </>
      )}
      <span className="spacer" />
      <span className={hasDepth ? "vr-depth on" : "vr-depth"}>
        {hasDepth ? "深度圖 ✓" : "無深度圖"}
      </span>
      <span>候選 {count.toFixed(0)} / {raw.toFixed(0)}</span>
    </div>
  );
}

export function VisionPanel({ host }: { host: string }) {
  useStore();
  const [streamKey, setStreamKey] = useState<string>("result");
  const [imgErr, setImgErr] = useState(false);

  const sim = store.connState === "sim";
  // 用 key 找回退目標，不用索引 —— VISION_STREAMS 插入新分頁時索引會跑掉
  const stream =
    VISION_STREAMS.find((s) => s.key === streamKey) ??
    VISION_STREAMS.find((s) => s.key === "result")!;
  const url = resolveStreamUrl(stream.ntName, host, stream.fallbackPort);

  // 拍照模式:開啟後機器人平常不辨識(省效能),按「拍照」才處理一張。
  // CaptureReq 用遞增的時間戳當序號,機器人端偵測到變動就抓一張。
  const snapshotMode = store.bool(controlKey("SnapshotMode"), false);
  const toggleSnapshot = () => client.set(controlKey("SnapshotMode"), !snapshotMode);
  const captureOne = () => client.set(controlKey("CaptureReq"), Date.now());

  // 一鍵學色:先按「學白球/學黃球」武裝(sampleArm 記住要學哪色),再點串流上的球。
  // 點擊處換成畫面比例座標傳回,機器人取那塊 HSV 統計、自動寫回對應門檻(滑桿會跟著跳)。
  const [sampleArm, setSampleArm] = useState<0 | 1 | 2>(0); // 0=關 1=白 2=黃
  const sampleInfo = store.str(resultKey("SampleInfo"), "");
  const onImgClick = (e: React.MouseEvent<HTMLImageElement>) => {
    if (!sampleArm) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const nx = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const ny = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    client.set(controlKey("SampleColor"), sampleArm);
    client.set(controlKey("SampleX"), nx);
    client.set(controlKey("SampleY"), ny);
    client.set(controlKey("SampleReq"), Date.now());
    setSampleArm(0);
  };

  // 匯出 C++ 標頭:優先 POST 給 dev server 直接覆寫
  // src/main/include/vision/BallVisionParams.h(瀏覽器不能寫絕對路徑)。
  // dev server 不在(Tauri 打包版/純靜態)時退回瀏覽器下載。
  const [exportStatus, setExportStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const exportHeader = async () => {
    const text = generateHeader(currentParams());
    try {
      const res = await fetch("/api/export-vision-header", { method: "POST", body: text });
      const path = (await res.text()).trim();
      // 打包版 app.exe / vite preview 沒有 dev 中介端點,POST 會落到 SPA fallback 回
      // index.html + 200 —— 不能只看 res.ok。dev 端點回傳的是檔案路徑(非 HTML),
      // 以此判定是否真的寫成功,否則退回瀏覽器下載。
      const wrote = res.ok && !/^\s*<(!doctype|html)/i.test(path);
      if (!wrote) throw new Error("no dev endpoint");
      setExportStatus({ ok: true, msg: `已寫入 ${path}` });
    } catch {
      download("BallVisionParams.h", text); // 沒有 dev 寫檔端點(打包版):退回下載,再手動覆寫
      setExportStatus({ ok: false, msg: "非 dev 模式(打包版無寫檔端點),已改為下載 BallVisionParams.h(請手動覆寫,或改用 npm run dev)" });
    }
  };

  return (
    <>
      <div className="vision-left">
        <div className="panel-toolbar">
          {VISION_STREAMS.map((s) => (
            <button
              key={s.key}
              className={s.key === streamKey ? "seg active" : "seg"}
              onClick={() => {
                setStreamKey(s.key);
                setImgErr(false);
              }}
            >
              {s.label}
            </button>
          ))}
          <span className="spacer" />
          <button
            className={snapshotMode ? "seg active" : "seg"}
            onClick={toggleSnapshot}
            title="開啟後機器人平常不辨識,按「拍照」才處理一張,競賽時省效能"
          >
            {snapshotMode ? "拍照模式：開" : "拍照模式：關"}
          </button>
          {snapshotMode && (
            <button className="seg" onClick={captureOne} title="抓一張目前畫面做辨識">
              📷 拍照
            </button>
          )}
          <button
            className={sampleArm === 1 ? "seg active" : "seg"}
            onClick={() => setSampleArm(sampleArm === 1 ? 0 : 1)}
            title="按下後點串流上的白球,自動設定白球門檻"
          >
            學白球
          </button>
          <button
            className={sampleArm === 2 ? "seg active" : "seg"}
            onClick={() => setSampleArm(sampleArm === 2 ? 0 : 2)}
            title="按下後點串流上的黃球,自動設定黃球門檻"
          >
            學黃球
          </button>
        </div>

        <div className="cam-view">
          {sim ? (
            <div className="cam-placeholder">模擬模式無影像串流（參數與辨識結果照常運作）</div>
          ) : imgErr ? (
            <div className="cam-placeholder">
              無法載入「{stream.label}」串流（{url}）。
              確認機器人已部署含 BallVision 的程式且相機已接上。
            </div>
          ) : (
            <img
              key={url}
              src={url}
              alt={stream.label}
              onError={() => setImgErr(true)}
              onClick={onImgClick}
              style={{ cursor: sampleArm ? "crosshair" : "default" }}
            />
          )}
        </div>
        {streamKey === "depth" && <DepthLegend />}
        {sampleArm !== 0 && (
          <div className="vision-hint">
            點一下畫面上的{sampleArm === 1 ? "白" : "黃"}球 → 自動設定
            {sampleArm === 1 ? "白" : "黃"}球門檻(再按一次按鈕取消)
          </div>
        )}
        {sampleInfo && <div className="vision-hint">取色結果:{sampleInfo}</div>}

        <ResultsBar />

        <div className="panel-toolbar vision-files">
          <button className="seg" onClick={exportHeader}>匯出 C++ 標頭</button>
          {exportStatus && (
            <span className={exportStatus.ok ? "export-status ok" : "export-status warn"}>
              {exportStatus.ok ? "✓ " : "⚠ "}
              {exportStatus.msg}
            </span>
          )}
        </div>
        <div className="vision-hint">
          滑桿即時寫入 NetworkTables（BallVision/Tuning），機器人端 BallVision 立即生效。
          調好後可「匯出 C++ 標頭」覆寫 src/main/include/vision/BallVisionParams.h 固化為開機預設。
        </div>
      </div>

      <div className="vision-params">
        <TargetCard />
        {FIELD_VISION_GROUPS.map((g) => (
          <section key={g.title}>
            <h3>{g.title}</h3>
            {g.params.map((p) => (
              <ParamSlider key={p.name} def={p} />
            ))}
          </section>
        ))}
      </div>
    </>
  );
}
