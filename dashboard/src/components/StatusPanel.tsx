// 機器狀態分頁 — Go/No-Go 燈牆。
// 檢錄後上場前只有幾分鐘：要的是一排綠燈，不是切八個分頁逐項肉眼確認。
// 每一項 = 一張卡片（LED + 名稱 + 當下讀值），全綠頂部亮 READY。
import { useEffect, useState } from "react";
import { store } from "../lib/store";
import {
  K, STATUS_K, DBG_K, CAL_K, lineRawKey, NUM_LINE_SENSORS, LINE_SENSOR_LABELS,
  motorKey, NUM_MOTORS,
} from "../lib/keys";
import { resultKey } from "../lib/visionKeys";

function useStore() {
  const [, force] = useState(0);
  useEffect(() => store.subscribe(() => force((n) => n + 1)), []);
  // 沒有遙測時也要每秒刷新一次（延遲/點雲年齡會持續變舊）
  useEffect(() => {
    const t = window.setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
}

interface Check {
  name: string;
  ok: boolean;
  detail: string;
  hint?: string; // 不通過時的處置提示
}

function buildChecks(): Check[] {
  const battery = store.num(STATUS_K.battery, 0);
  const cpuTemp = store.num(STATUS_K.cpuTemp, 0);
  const loopMs = store.num(STATUS_K.loopMs, 0);
  const lineRaws = Array.from({ length: NUM_LINE_SENSORS }, (_, i) =>
    store.num(lineRawKey(i), -1),
  );
  const lineAlive = lineRaws.every((v) => v > 5); // 斷線/短路時 raw 貼 0
  const encAlive = Array.from({ length: NUM_MOTORS }, (_, i) =>
    store.latest.has(motorKey(i, "CurrentAngle")),
  ).every(Boolean);
  const lidarAge = store.now() - store.pointCloudStamp;
  const fps = store.num(resultKey("FPS"), 0);

  return [
    {
      name: "constants.json 已載入",
      ok: store.bool(STATUS_K.constantsOk),
      detail: store.bool(STATUS_K.constantsOk) ? "檔案讀取成功" : "讀檔失敗或未實作",
      hint: "機器人將使用 code 內建 fallback — 到常數表 VERIFY 確認",
    },
    {
      name: "電池電壓",
      ok: battery >= 11.0,
      detail: `${battery.toFixed(1)} V（須 ≥ 11.0）`,
      hint: "低電壓下馬達行為改變，調好的 PID 會漂 — 換電池",
    },
    {
      name: "CPU 溫度",
      ok: cpuTemp > 0 && cpuTemp < 70,
      detail: `${cpuTemp.toFixed(0)} °C（須 < 70）`,
      hint: "Raspberry Pi 熱節流會直接反映在規劃耗時 — 檢查散熱",
    },
    {
      name: "控制迴圈週期",
      ok: loopMs > 0 && loopMs < 25,
      detail: `${loopMs.toFixed(1)} ms（標稱 20）`,
      hint: "週期抖動代表 CPU 過載 — 檢查視覺/光達執行緒",
    },
    {
      name: "陀螺儀",
      ok: store.bool(STATUS_K.gyroOk),
      detail: `Yaw ${store.num(K.yaw).toFixed(1)}°`,
      hint: "navX 未回應或未歸零 — 重新上電並靜置歸零",
    },
    {
      name: "馬達 + Encoder",
      ok: store.bool(STATUS_K.motorsOk) && encAlive,
      detail: encAlive ? "Titan CAN 回應中，Encoder 有回報" : "Encoder 無回報",
      hint: "檢查 CAN 線與 Titan 電源",
    },
    {
      name: "Z 軸已 Home",
      ok: store.bool(DBG_K.zHomed),
      detail: `高度 ${store.num(DBG_K.zHeight).toFixed(1)} cm`,
      hint: "到初始化除錯分頁按 Home",
    },
    {
      name: "急停未觸發",
      ok: !store.bool(K.eStop),
      detail: store.bool(K.eStop) ? "E-STOP 觸發中" : "正常",
      hint: "旋開急停鈕後重新致能",
    },
    {
      name: `黑線 ${NUM_LINE_SENSORS} 顆有讀值`,
      ok: lineAlive,
      detail: lineRaws
        .map((v, i) => `${LINE_SENSOR_LABELS[i]}:${v < 0 ? "—" : v.toFixed(0)}`)
        .join(" "),
      hint: "raw 貼 0 = 接線脫落或短路 — 檢查類比通道",
    },
    {
      name: "黑線門檻已標定",
      ok: store.bool(CAL_K.lineContrastOk),
      detail: store.bool(CAL_K.lineContrastOk) ? "對比充足" : "未標定或對比不足",
      hint: "地墊材質變更後必做 — 初始化除錯分頁一鍵標定",
    },
    {
      name: "相機串流",
      ok: store.bool(STATUS_K.cameraOk) || fps > 5,
      detail: fps > 0 ? `視覺 ${fps.toFixed(0)} FPS` : "無串流",
      hint: "檢查 CameraServer 與 USB 相機",
    },
    {
      name: "光達",
      ok: store.bool(STATUS_K.lidarOk) || (store.pointCloudStamp > 0 && lidarAge < 2),
      detail:
        store.pointCloudStamp > 0
          ? `點雲 ${lidarAge < 60 ? lidarAge.toFixed(1) + " 秒前" : "已停止"}`
          : "無點雲",
      hint: "檢查光達供電與驅動程式",
    },
  ];
}

export function StatusPanel() {
  useStore();
  const offline = store.connState === "disconnected" || store.connState === "connecting";
  const checks = buildChecks();
  const fails = checks.filter((c) => !c.ok);
  const ready = fails.length === 0;

  if (offline) {
    return (
      <div className="cam-placeholder">
        未連線。連上機器人（或按頂欄「模擬」）後，此頁逐項檢查
        constants／感測器／馬達／急停／相機／光達，全綠才上場。
      </div>
    );
  }

  return (
    <div className="status-panel">
      <div className={ready ? "gonogo ready" : "gonogo notready"}>
        {ready ? "READY — 全項通過，可以上場" : `NOT READY — ${fails.length} 項未通過`}
      </div>
      <div className="status-grid">
        {checks.map((c) => (
          <div key={c.name} className={c.ok ? "check-card ok" : "check-card fail"}>
            <div className="check-head">
              <span className={c.ok ? "lv-led on ok" : "lv-led on err"} />
              <span className="check-name">{c.name}</span>
            </div>
            <div className="check-detail">{c.detail}</div>
            {!c.ok && c.hint && <div className="check-hint">{c.hint}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
