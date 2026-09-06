// 黑線定位調參面板 — 滑桿透過 WS 橋接器寫入 NT Line/Tuning/*，
// 機器人端 Line 即時生效（二值化 → 找輪廓 → 離相機最近的黑線點的機器座標）。
// 串流網址從 CameraPublisher/<名稱>/streams 解析（主機名換成輸入的 IP），失敗時退回預設埠。
import { useEffect, useRef, useState } from "react";
import { store } from "../lib/store";
import { client } from "../lib/RobotClient";
import {
  ALL_LINE_PARAMS,
  FIELD_LINE_GROUPS,
  LINE_STREAMS,
  LineParamDef,
  lineControlKey,
  lineResultKey,
  lineTuningKey,
} from "../lib/lineKeys";

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
  for (const p of ALL_LINE_PARAMS) {
    const v = store.num(lineTuningKey(p.name), p.def);
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

/** 產生 LineVisionParams.h — 與機器人端 LineVisionParams.h 相同格式 */
function generateHeader(params: Record<string, number>): string {
  const lines = ALL_LINE_PARAMS.map((p) => {
    const name = "k" + p.name[0].toUpperCase() + p.name.slice(1);
    const v = params[p.name];
    return p.int
      ? `constexpr int    ${name.padEnd(22)} = ${Math.round(v)};`
      : `constexpr double ${name.padEnd(22)} = ${Number.isInteger(v) ? v.toFixed(1) : String(v)};`;
  });
  return (
    "// 此檔案由 VMX Dashboard 匯出產生。\n" +
    "// 參數優先序:NetworkTables 即時值(Line/Tuning) > 本檔預設值。\n" +
    "#pragma once\n\n" +
    "namespace linevisionparams {\n" +
    lines.join("\n") +
    "\n}  // namespace linevisionparams\n"
  );
}

/** 從 CameraPublisher streams 解析 MJPEG 網址，主機名換成使用者輸入（同 VisionPanel） */
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

function ParamSlider({ def: p }: { def: LineParamDef }) {
  const throttledSet = useThrottledSet();
  const [drag, setDrag] = useState<number | null>(null);

  const key = lineTuningKey(p.name);
  const robotVal = store.num(key, p.def);
  const val = drag ?? robotVal;

  const send = (v: number) => {
    setDrag(v);
    throttledSet(key, v);
  };

  // 0/1 開關型參數用 checkbox 呈現（同 VisionPanel）
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

/** 側邊主讀數：離相機最近的黑線點的機器座標（比賽時最常盯的值） */
function TargetCard() {
  const has = store.bool(lineResultKey("HasLine"), false);
  const worldOk = store.bool(lineResultKey("WorldOk"), false);
  const xCm = store.num(lineResultKey("X_cm"), 0);
  const yCm = store.num(lineResultKey("Y_cm"), 0);
  const dist = store.num(lineResultKey("DistMm"), 0);
  const age = store.num(lineResultKey("AgeFrames"), 0);

  return (
    <section className="target-card">
      <h3>最近黑線點</h3>
      {!has ? (
        <div className="tc-empty">無目標</div>
      ) : (
        <>
          {age > 0 && <div className="tc-color"><span className="tc-stale">coasting {age.toFixed(0)}</span></div>}
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
            <div className="tc-nowarn">
              無機器座標 —— 相機內參未注入,或缺 deploy/camera_calibration.json
            </div>
          )}
          {dist > 0 && <div className="tc-dist">距離 {dist.toFixed(0)} mm</div>}
        </>
      )}
    </section>
  );
}

function ResultsBar() {
  const has = store.bool(lineResultKey("HasLine"), false);
  const xNorm = store.num(lineResultKey("XNorm"), 0);
  const dist = store.num(lineResultKey("DistMm"), 0);
  const worldOk = store.bool(lineResultKey("WorldOk"), false);
  const xCm = store.num(lineResultKey("X_cm"), 0);
  const yCm = store.num(lineResultKey("Y_cm"), 0);
  const count = store.num(lineResultKey("ContourCount"), 0);
  const age = store.num(lineResultKey("AgeFrames"), 0);
  const fps = store.num(lineResultKey("FPS"), 0);

  return (
    <div className="vision-results">
      <span className={has ? "vr-target on" : "vr-target"}>
        {has ? "偵測到黑線" : "無目標"}
      </span>
      {has && (
        <>
          <span>{worldOk ? `機器 (${xCm.toFixed(1)}, ${yCm.toFixed(1)})cm` : "機器座標 —"}</span>
          <span>{dist > 0 ? `距離 ${dist.toFixed(0)}mm` : "距離 —"}</span>
          <span>xNorm {xNorm.toFixed(2)}</span>
          {age > 0 && <span>coasting {age}</span>}
        </>
      )}
      <span className="spacer" />
      <span>輪廓數 {count.toFixed(0)}</span>
      <span>FPS {fps.toFixed(0)}</span>
    </div>
  );
}

export function LinePanel({ host }: { host: string }) {
  useStore();
  const [streamKey, setStreamKey] = useState<string>("result");
  const [imgErr, setImgErr] = useState(false);

  const sim = store.connState === "sim";
  const stream =
    LINE_STREAMS.find((s) => s.key === streamKey) ??
    LINE_STREAMS.find((s) => s.key === "result")!;
  const url = resolveStreamUrl(stream.ntName, host, stream.fallbackPort);

  // 拍照模式:開啟後機器人平常不辨識(省效能),按「拍照」才處理一張。
  // CaptureReq 用遞增的時間戳當序號,機器人端偵測到變動就抓一張。
  const snapshotMode = store.bool(lineControlKey("SnapshotMode"), false);
  const toggleSnapshot = () => client.set(lineControlKey("SnapshotMode"), !snapshotMode);
  const captureOne = () => client.set(lineControlKey("CaptureReq"), Date.now());

  // 匯出 C++ 標頭:優先 POST 給 dev server 直接覆寫
  // src/main/include/vision/LineVisionParams.h(瀏覽器不能寫絕對路徑)。
  // dev server 不在(Tauri 打包版/純靜態)時退回瀏覽器下載。
  const [exportStatus, setExportStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const exportHeader = async () => {
    const text = generateHeader(currentParams());
    try {
      const res = await fetch("/api/export-line-header", { method: "POST", body: text });
      const path = (await res.text()).trim();
      // 打包版 app.exe / vite preview 沒有 dev 中介端點,POST 會落到 SPA fallback 回
      // index.html + 200 —— 不能只看 res.ok。dev 端點回傳的是檔案路徑(非 HTML),
      // 以此判定是否真的寫成功,否則退回瀏覽器下載。
      const wrote = res.ok && !/^\s*<(!doctype|html)/i.test(path);
      if (!wrote) throw new Error("no dev endpoint");
      setExportStatus({ ok: true, msg: `已寫入 ${path}` });
    } catch {
      download("LineVisionParams.h", text); // 沒有 dev 寫檔端點(打包版):退回下載,再手動覆寫
      setExportStatus({ ok: false, msg: "非 dev 模式(打包版無寫檔端點),已改為下載 LineVisionParams.h(請手動覆寫,或改用 npm run dev)" });
    }
  };

  return (
    <>
      <div className="vision-left">
        <div className="panel-toolbar">
          {LINE_STREAMS.map((s) => (
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
        </div>

        <div className="cam-view">
          {sim ? (
            <div className="cam-placeholder">模擬模式無影像串流（參數與辨識結果照常運作）</div>
          ) : imgErr ? (
            <div className="cam-placeholder">
              無法載入「{stream.label}」串流（{url}）。
              確認機器人已部署含 Line 的程式且相機已接上。
            </div>
          ) : (
            <img key={url} src={url} alt={stream.label} onError={() => setImgErr(true)} />
          )}
        </div>

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
          滑桿即時寫入 NetworkTables（Line/Tuning），機器人端 Line 立即生效。
          調好後可「匯出 C++ 標頭」覆寫 src/main/include/vision/LineVisionParams.h 固化為開機預設。
        </div>
      </div>

      <div className="vision-params">
        <TargetCard />
        {FIELD_LINE_GROUPS.map((g) => (
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
