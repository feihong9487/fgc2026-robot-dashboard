// 執行狀態分頁 — 上場那三趟唯一要開的畫面。
// 大場地圖 + State/趟次大字 + 計時器 + Z 軸 + 辨識結果（箱色/12球色排序）
// + S-curve 波形（原 Demo 波形頁移入）+ 超大中止鈕。
// 設計原則：緊張的時候沒有人有餘裕在調參介面裡找按鈕。
import { useEffect, useState } from "react";
import { store } from "../lib/store";
import { client } from "../lib/RobotClient";
import { K, SIM_K, RUN_K, DBG_K, Z_MAX_CM, motorKey } from "../lib/keys";
import { FieldView } from "./FieldView";
import { Chart } from "./Chart";
import { BarMeter, Led } from "./controls";

const MOTOR_COLORS = ["#4fc3f7", "#ffb74d", "#81c784"];

// 箱色/球色 → 顯示用色票
const CHIP_COLORS: Record<string, string> = {
  RED: "#e57373",
  BLUE: "#4fc3f7",
  BLACK: "#3a4152",
  WHITE: "#e8ecf3",
  YELLOW: "#ffd54f",
};
const CHIP_LABELS: Record<string, string> = {
  RED: "紅",
  BLUE: "藍",
  BLACK: "黑",
  WHITE: "白",
  YELLOW: "黃",
};

function parseColors(json: string): string[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

function ColorChips({ colors, size = 26 }: { colors: string[]; size?: number }) {
  if (!colors.length) return <span className="run-none">（尚未辨識）</span>;
  return (
    <span className="run-chips">
      {colors.map((c, i) => (
        <span
          key={i}
          className="run-chip"
          style={{
            background: CHIP_COLORS[c] ?? "#555",
            color: c === "WHITE" || c === "YELLOW" ? "#0a0d12" : "#fff",
            width: size,
            height: size,
            lineHeight: `${size}px`,
          }}
          title={c}
        >
          {CHIP_LABELS[c] ?? "?"}
        </span>
      ))}
    </span>
  );
}

function useStore() {
  const [, force] = useState(0);
  useEffect(() => store.subscribe(() => force((n) => n + 1)), []);
}

export function RunPanel() {
  useStore();

  const state = String(store.latest.get(SIM_K.state) ?? "—");
  const cmd = String(store.latest.get(SIM_K.currentCommand) ?? "—");
  const trip = store.num(SIM_K.tripIndex, 0);
  const fault = state.startsWith("FAULT") || state === "ABORTED";
  const timer = store.num(RUN_K.matchTimer, 0);
  const zH = store.num(DBG_K.zHeight);
  const gripOpen = store.bool(DBG_K.gripperOpen);
  const gripAngle = store.num(DBG_K.gripperAngle);
  const trayAngle = store.num(DBG_K.trayAngle);
  const boxOrder = parseColors(String(store.latest.get(RUN_K.boxOrder) ?? ""));
  const ballColors = parseColors(String(store.latest.get(RUN_K.ballColors) ?? ""));
  const aborted = state === "ABORTED";
  const offline = store.connState === "disconnected" || store.connState === "connecting";

  if (offline) {
    return (
      <div className="cam-placeholder">
        未連線。連上機器人（或按頂欄「模擬」）後，此頁顯示賽中監控：
        場地圖、狀態機、計時、辨識結果與中止鈕。
      </div>
    );
  }

  const mm = Math.floor(timer / 60);
  const ss = Math.floor(timer % 60);

  return (
    <>
      <div className="run-left">
        <div className="field-wrap">
          <FieldView />
        </div>
        <Chart
          title="S-Curve 規劃（位置 / 速度 / 加速度）"
          windowSec={20}
          height={170}
          series={[
            { key: K.wavePos, label: "位置", color: "#4fc3f7" },
            { key: K.waveVel, label: "速度", color: "#ffb74d" },
            { key: K.waveAcc, label: "加速度", color: "#e57373" },
          ]}
        />
      </div>

      <div className="run-side">
        <div className={fault ? "run-state fault" : "run-state"}>
          <div className="run-state-name">{state}</div>
          <div className="run-cmd">{cmd}</div>
        </div>

        <div className="run-row">
          <span className="run-timer">
            {mm}:{String(ss).padStart(2, "0")}
          </span>
          <span className="run-trips">
            {[1, 2, 3].map((t) => (
              <span key={t} className={t <= trip ? "trip-dot big on" : "trip-dot big"}>
                {t}
              </span>
            ))}
          </span>
        </div>

        <div className="run-block">
          <div className="run-block-title">Z 軸</div>
          <BarMeter value={zH} max={Z_MAX_CM} unit="cm" />
        </div>

        <div className="run-block">
          <div className="run-block-title">夾爪 / 托盤</div>
          <div className="run-mech-row">
            <Led on={gripOpen} label={gripOpen ? "夾爪 開啟" : "夾爪 閉合"} color="accent" />
            <span className="run-mech-val">{gripAngle.toFixed(0)}°</span>
          </div>
          <BarMeter label="托盤" value={trayAngle} max={180} unit="°" />
        </div>

        <div className="run-block">
          <div className="run-block-title">箱色排序（視覺辨識）</div>
          <ColorChips colors={boxOrder} size={30} />
        </div>

        <div className="run-block">
          <div className="run-block-title">12 球顏色排序</div>
          <ColorChips colors={ballColors} size={22} />
        </div>

        <div className="run-block">
          <div className="run-block-title">馬達追蹤誤差</div>
          <Chart
            title=""
            windowSec={15}
            height={110}
            series={[0, 1, 2].map((i) => ({
              key: motorKey(i, "Error"),
              label: `M${i}`,
              color: MOTOR_COLORS[i],
            }))}
          />
        </div>

        {aborted ? (
          <button className="run-abort resume" onClick={() => client.set(RUN_K.reset, true)}>
            復歸（回出發區重新待命）
          </button>
        ) : (
          <button className="run-abort" onClick={() => client.set(RUN_K.abort, true)}>
            中止 ABORT
          </button>
        )}
      </div>
    </>
  );
}
