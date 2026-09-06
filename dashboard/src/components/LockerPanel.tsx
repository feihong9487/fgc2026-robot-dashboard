// 置物櫃顏色辨識調參面板 — 滑桿透過 WS 橋接器寫入 NT LockerVision/Tuning/*，
// 機器人端 LockerVision 即時生效（ROI 切格 → 每格平均 HSV → 黑/藍/紅分類）。
// 點串流上的色塊即可一鍵學色（同乒乓球的學白/黃）。辨識到的「由上到下顏色排序」
// 會同時送到執行狀態頁的「箱色排序」。
import { useEffect, useRef, useState } from "react";
import { store } from "../lib/store";
import { client } from "../lib/RobotClient";
import {
  ALL_LOCKER_PARAMS,
  FIELD_LOCKER_GROUPS,
  LOCKER_STREAMS,
  LockerParamDef,
  lockerControlKey,
  lockerResultKey,
  lockerTuningKey,
} from "../lib/lockerKeys";

// 顏色代碼 → 顯示色票（與 RunPanel 的 CHIP_COLORS/LABELS 對齊）
const CHIP: Record<string, { bg: string; fg: string; label: string }> = {
  BLACK: { bg: "#3a4152", fg: "#fff", label: "黑" },
  BLUE: { bg: "#4fc3f7", fg: "#0a0d12", label: "藍" },
  RED: { bg: "#e57373", fg: "#fff", label: "紅" },
  UNKNOWN: { bg: "#555", fg: "#fff", label: "?" },
};

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
  for (const p of ALL_LOCKER_PARAMS) {
    const v = store.num(lockerTuningKey(p.name), p.def);
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

/** 產生 LockerVisionParams.h — 與機器人端 LockerVisionParams.h 相同格式 */
function generateHeader(params: Record<string, number>): string {
  const lines = ALL_LOCKER_PARAMS.map((p) => {
    const name = "k" + p.name[0].toUpperCase() + p.name.slice(1);
    const v = params[p.name];
    return p.int
      ? `constexpr int    ${name.padEnd(22)} = ${Math.round(v)};`
      : `constexpr double ${name.padEnd(22)} = ${Number.isInteger(v) ? v.toFixed(1) : String(v)};`;
  });
  return (
    "// 此檔案由 VMX Dashboard 匯出產生。\n" +
    "// 參數優先序:NetworkTables 即時值(LockerVision/Tuning) > 本檔預設值。\n" +
    "#pragma once\n\n" +
    "namespace lockervisionparams {\n" +
    lines.join("\n") +
    "\n}  // namespace lockervisionparams\n"
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

function parseOrder(json: string): string[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

function ParamSlider({ def: p }: { def: LockerParamDef }) {
  const throttledSet = useThrottledSet();
  const [drag, setDrag] = useState<number | null>(null);

  const key = lockerTuningKey(p.name);
  const robotVal = store.num(key, p.def);
  const val = drag ?? robotVal;

  const send = (v: number) => {
    setDrag(v);
    throttledSet(key, v);
  };

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

/** 側邊主讀數：由上到下的顏色排序（最上面 = 先夾的那格） */
function OrderCard({ order }: { order: string[] }) {
  return (
    <section className="target-card">
      <h3>置物櫃排序（上→下）</h3>
      {!order.length ? (
        <div className="tc-empty">尚未辨識</div>
      ) : (
        <div className="run-chips" style={{ flexDirection: "column", alignItems: "flex-start", gap: 6 }}>
          {order.map((c, i) => {
            const chip = CHIP[c] ?? CHIP.UNKNOWN;
            return (
              <span key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span
                  style={{
                    background: chip.bg,
                    color: chip.fg,
                    width: 30,
                    height: 30,
                    lineHeight: "30px",
                    textAlign: "center",
                    borderRadius: 6,
                    fontWeight: 700,
                  }}
                  title={c}
                >
                  {chip.label}
                </span>
                <span className="tc-unit">{i === 0 ? "← 先夾" : `第 ${i + 1} 格`}</span>
              </span>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function LockerPanel({ host }: { host: string }) {
  useStore();
  const [streamKey, setStreamKey] = useState<string>("result");
  const [imgErr, setImgErr] = useState(false);

  const sim = store.connState === "sim";
  const stream =
    LOCKER_STREAMS.find((s) => s.key === streamKey) ??
    LOCKER_STREAMS.find((s) => s.key === "result")!;
  const url = resolveStreamUrl(stream.ntName, host, stream.fallbackPort);

  const order = parseOrder(store.str(lockerResultKey("Order"), ""));
  const fps = store.num(lockerResultKey("FPS"), 0);
  const sampleInfo = store.str(lockerResultKey("SampleInfo"), "");

  // 拍照模式:開啟後機器人平常不辨識(省效能),按「拍照」才處理一張。
  const snapshotMode = store.bool(lockerControlKey("SnapshotMode"), false);
  const toggleSnapshot = () => client.set(lockerControlKey("SnapshotMode"), !snapshotMode);
  const captureOne = () => client.set(lockerControlKey("CaptureReq"), Date.now());

  // 一鍵學色:先按「學黑/學藍/學紅」武裝,再點串流上的那格色塊。
  // 點擊處換成畫面比例座標傳回,機器人取那塊 HSV 統計、自動寫回對應門檻(滑桿會跟著跳)。
  const [sampleArm, setSampleArm] = useState<0 | 1 | 2 | 3>(0); // 0=關 1=黑 2=藍 3=紅
  const armLabel: Record<number, string> = { 1: "黑", 2: "藍", 3: "紅" };
  const onImgClick = (e: React.MouseEvent<HTMLImageElement>) => {
    if (!sampleArm) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const nx = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const ny = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    client.set(lockerControlKey("SampleColor"), sampleArm);
    client.set(lockerControlKey("SampleX"), nx);
    client.set(lockerControlKey("SampleY"), ny);
    client.set(lockerControlKey("SampleReq"), Date.now());
    setSampleArm(0);
  };

  // 匯出 C++ 標頭:優先 POST 給 dev server 直接覆寫 LockerVisionParams.h。
  const [exportStatus, setExportStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const exportHeader = async () => {
    const text = generateHeader(currentParams());
    try {
      const res = await fetch("/api/export-locker-header", { method: "POST", body: text });
      const path = (await res.text()).trim();
      const wrote = res.ok && !/^\s*<(!doctype|html)/i.test(path);
      if (!wrote) throw new Error("no dev endpoint");
      setExportStatus({ ok: true, msg: `已寫入 ${path}` });
    } catch {
      download("LockerVisionParams.h", text);
      setExportStatus({ ok: false, msg: "非 dev 模式(打包版無寫檔端點),已改為下載 LockerVisionParams.h(請手動覆寫,或改用 npm run dev)" });
    }
  };

  return (
    <>
      <div className="vision-left">
        <div className="panel-toolbar">
          {LOCKER_STREAMS.map((s) => (
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
          {([1, 2, 3] as const).map((c) => (
            <button
              key={c}
              className={sampleArm === c ? "seg active" : "seg"}
              onClick={() => setSampleArm(sampleArm === c ? 0 : c)}
              title={`按下後點串流上的${armLabel[c]}色格,自動設定${armLabel[c]}色門檻`}
            >
              學{armLabel[c]}
            </button>
          ))}
        </div>

        <div className="cam-view">
          {sim ? (
            <div className="cam-placeholder">模擬模式無影像串流（參數與辨識結果照常運作）</div>
          ) : imgErr ? (
            <div className="cam-placeholder">
              無法載入「{stream.label}」串流（{url}）。
              確認機器人已部署含 LockerVision 的程式且相機已接上。
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
        {sampleArm !== 0 && (
          <div className="vision-hint">
            點一下畫面上的{armLabel[sampleArm]}色格 → 自動設定{armLabel[sampleArm]}色門檻(再按一次按鈕取消)
          </div>
        )}
        {sampleInfo && <div className="vision-hint">取色結果:{sampleInfo}</div>}

        <div className="vision-results">
          <span className={order.length ? "vr-target on" : "vr-target"}>
            {order.length ? `排序（上→下）：${order.map((c) => (CHIP[c] ?? CHIP.UNKNOWN).label).join(" ")}` : "無目標"}
          </span>
          <span className="spacer" />
          <span>FPS {fps.toFixed(0)}</span>
        </div>

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
          滑桿即時寫入 NetworkTables（LockerVision/Tuning），機器人端 LockerVision 立即生效。
          辨識到的顏色排序會同步到「執行狀態」頁的箱色排序。
          調好後可「匯出 C++ 標頭」覆寫 src/main/include/vision/LockerVisionParams.h 固化為開機預設。
        </div>
      </div>

      <div className="vision-params">
        <OrderCard order={order} />
        {FIELD_LOCKER_GROUPS.map((g) => (
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
