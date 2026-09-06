// 初始化除錯分頁 — 機器組裝好之後的第一站。
// 上半：單一子系統隔離測試（抓接線錯誤/馬達反轉/編碼器方向），
// 下半：標定精靈（嚴格步驟順序：黑線門檻 → 里程計係數）。
// 機構（2026-07-15 確認）：一個 Z 軸 + 上下極限開關，無觸鬚。
import { useEffect, useState } from "react";
import { store } from "../lib/store";
import { client } from "../lib/RobotClient";
import {
  K, DBG_K, CAL_K, Z_PRESETS, Z_MAX_CM,
  lineRawKey, lineBinKey, NUM_LINE_SENSORS, LINE_SENSOR_LABELS,
  motorKey, NUM_MOTORS,
} from "../lib/keys";
import { CONST_PREFIX } from "../lib/constantsSchema";
import {
  SliderCtl, Toggle, Led, BarMeter, BarArray, ArrayCtl, Collapse, LabeledNum,
} from "./controls";

function useStore() {
  const [, force] = useState(0);
  useEffect(() => store.subscribe(() => force((n) => n + 1)), []);
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="cal-progress">
      <div className="cal-progress-fill" style={{ width: `${Math.min(100, value * 100)}%` }} />
    </div>
  );
}

/** 移動指令欄位（底盤試跑：沿用既有 Chassis entries） */
function MoveField({ label, ntKey, step = 1 }: { label: string; ntKey: string; step?: number }) {
  return (
    <LabeledNum
      label={label}
      value={store.num(ntKey)}
      step={step}
      onCommit={(v) => client.set(ntKey, v)}
    />
  );
}

export function DebugPanel() {
  useStore();

  const zH = store.num(DBG_K.zHeight);
  const zT = store.num(DBG_K.zTarget, 10);
  const zErr = zT - zH;
  const gripOpen = store.bool(DBG_K.gripperOpen);
  const driveEnable = store.bool(DBG_K.driveEnable);
  const started = store.bool(K.start, false);

  const lineRaws = Array.from({ length: NUM_LINE_SENSORS }, (_, i) =>
    store.num(lineRawKey(i)),
  );
  const lineBins = Array.from({ length: NUM_LINE_SENSORS }, (_, i) =>
    store.bool(lineBinKey(i)),
  );
  const lineThs = Array.from({ length: NUM_LINE_SENSORS }, (_, i) =>
    store.num(`${CONST_PREFIX}/lineSensor/thresholds/${i}`, 0),
  );

  const lineRunning = store.bool(CAL_K.lineRun);
  const odomRunning = store.bool(CAL_K.odomRun);

  return (
    <div className="debug-grid">
      <Collapse title="Z 軸（升降）">
        <SliderCtl
          label="目標高度"
          value={zT}
          min={0}
          max={Z_MAX_CM}
          step={0.1}
          unit="cm"
          onChange={(v) => client.set(DBG_K.zTarget, v)}
        />
        <div className="btn-row">
          <button className="btn accent" onClick={() => client.set(DBG_K.zGo, true)}>
            Go
          </button>
          <button className="btn" onClick={() => client.set(DBG_K.zHome, true)}>
            Home
          </button>
          <Led on={store.bool(DBG_K.zHomed)} label="已歸零" />
          <Led on={store.bool(DBG_K.zUpperLim)} label="上極限" color="warn" />
          <Led on={store.bool(DBG_K.zLowerLim)} label="下極限" color="warn" />
        </div>
        <div className="btn-row wrap">
          {Z_PRESETS.map((p) => (
            <button
              key={p.cm}
              className="btn preset"
              onClick={() => {
                client.set(DBG_K.zTarget, p.cm);
                client.set(DBG_K.zGo, true);
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
        <BarMeter label="當前" value={zH} max={Z_MAX_CM} unit="cm" />
        <div className={Math.abs(zErr) > 0.5 ? "status-row estop" : "status-row ok"}>
          誤差：{zErr.toFixed(2)} cm（須 &lt; 0.5cm）
        </div>
      </Collapse>

      <Collapse title="底盤 Drive（jog）">
        <Toggle label="致能" on={driveEnable} onChange={(v) => client.set(DBG_K.driveEnable, v)} />
        <SliderCtl label="vx" value={store.num(DBG_K.driveVx)} min={-0.5} max={0.5} step={0.01}
          unit="m/s" onChange={(v) => client.set(DBG_K.driveVx, v)} />
        <SliderCtl label="vy" value={store.num(DBG_K.driveVy)} min={-0.5} max={0.5} step={0.01}
          unit="m/s" onChange={(v) => client.set(DBG_K.driveVy, v)} />
        <SliderCtl label="ω" value={store.num(DBG_K.driveOmega)} min={-90} max={90} step={1}
          unit="°/s" onChange={(v) => client.set(DBG_K.driveOmega, v)} />
        <button
          className="btn danger"
          onClick={() => {
            client.set(DBG_K.driveVx, 0);
            client.set(DBG_K.driveVy, 0);
            client.set(DBG_K.driveOmega, 0);
            client.set(DBG_K.driveEnable, false);
          }}
        >
          全停
        </button>
        <div className="status-row">
          里程計：({store.num(DBG_K.odomX).toFixed(2)}, {store.num(DBG_K.odomY).toFixed(2)}) m，
          θ {store.num(DBG_K.odomTheta).toFixed(1)}°
        </div>
        <table className="lv-matrix compact">
          <thead>
            <tr><th /><th>目標</th><th>實際</th><th>誤差</th></tr>
          </thead>
          <tbody>
            {Array.from({ length: NUM_MOTORS }, (_, i) => (
              <tr key={i}>
                <th>M{i}</th>
                <td>{store.num(motorKey(i, "TargetAngle")).toFixed(1)}</td>
                <td>{store.num(motorKey(i, "CurrentAngle")).toFixed(1)}</td>
                <td>{store.num(motorKey(i, "Error")).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Collapse>

      <Collapse title="底盤試跑（S-curve 移動指令）">
        <MoveField label="X cm" ntKey={K.x} />
        <MoveField label="Y cm" ntKey={K.y} />
        <MoveField label="θ deg" ntKey={K.theta} />
        <button
          className={started ? "btn-start running" : "btn-start"}
          onClick={() => client.set(K.start, !started)}
        >
          {started ? "停止" : "開始移動"}
        </button>
        <div className="status-row">
          陀螺儀 Yaw：{store.num(K.yaw).toFixed(2)}°｜航向誤差：{store.num(K.headingErr).toFixed(2)}°
        </div>
        <div className="lv-hint">
          PID / S-curve 參數在「常數表」分頁調（套用即時生效），
          波形在「執行狀態」分頁看。
        </div>
      </Collapse>

      <Collapse title="黑線陣列 LineSensor">
        <BarArray values={lineRaws} thresholds={lineThs} bins={lineBins} labels={LINE_SENSOR_LABELS} max={1023} />
        <div className="lv-hint">
          上：raw 值（橫線 = 常數表門檻）；下：二值化 LED。門檻用下方標定精靈一鍵取得。
        </div>
      </Collapse>

      <Collapse title="夾爪 Gripper">
        <div className="btn-row">
          <button
            className={gripOpen ? "btn accent" : "btn"}
            onClick={() => client.set(DBG_K.gripperOpen, true)}
          >
            開
          </button>
          <button
            className={!gripOpen ? "btn accent" : "btn"}
            onClick={() => client.set(DBG_K.gripperOpen, false)}
          >
            合
          </button>
          <Led on={gripOpen} label={gripOpen ? "開啟" : "閉合"} color="accent" />
        </div>
        <SliderCtl label="Servo 角度" value={store.num(DBG_K.gripperAngle, 30)} min={0} max={180}
          step={1} unit="°" onChange={(v) => client.set(DBG_K.gripperAngle, v)} />
      </Collapse>

      <Collapse title="托盤 Tray">
        <SliderCtl label="角度" value={store.num(DBG_K.trayAngle)} min={0} max={180} step={1}
          unit="°" onChange={(v) => client.set(DBG_K.trayAngle, v)} />
      </Collapse>

      <Collapse title="標定精靈 1：黑線門檻（地墊材質變更後必做）">
        <button
          className={lineRunning ? "btn-start running" : "btn-start"}
          onClick={() => client.set(CAL_K.lineRun, !lineRunning)}
        >
          {lineRunning ? "中止" : "Calibrate Line"}
        </button>
        <div className="status-row">{String(store.latest.get(CAL_K.lineStep) ?? "待命")}</div>
        <ProgressBar value={store.num(CAL_K.lineProgress)} />
        <div className="btn-row">
          <Led on={store.bool(CAL_K.lineContrastOk)} label="Contrast OK（黑白對比充足）" />
        </div>
        <ArrayCtl label="計算出的門檻" values={lineThs} readOnly />
        <div className="lv-hint">
          流程：白區採樣 100 次 → 黑線採樣 100 次 → 門檻 =（白均+黑均）/2 →
          對比不足會亮紅燈。完成後門檻寫入常數表草稿，記得到常數表「儲存到機器人」。
        </div>
      </Collapse>

      <Collapse title="標定精靈 2：里程計（地墊摩擦變更後必做）">
        <button
          className={odomRunning ? "btn-start running" : "btn-start"}
          onClick={() => client.set(CAL_K.odomRun, !odomRunning)}
        >
          {odomRunning ? "中止" : "Calibrate Odometry"}
        </button>
        <div className="status-row">{String(store.latest.get(CAL_K.odomStep) ?? "待命")}</div>
        <ProgressBar value={store.num(CAL_K.odomProgress)} />
        <LabeledNum
          label="捲尺實測位移"
          value={store.num(CAL_K.odomMeasured, 2000)}
          step={1}
          unit="mm"
          onCommit={(v) => client.set(CAL_K.odomMeasured, v)}
        />
        <div className="btn-row">
          <button className="btn accent" onClick={() => client.set(CAL_K.odomConfirm, true)}>
            確認實測值
          </button>
          <span className="status-row" style={{ margin: 0 }}>
            修正係數 k = {store.num(CAL_K.odomFactor, 1).toFixed(4)}
          </span>
        </div>
        <div className="lv-hint">
          建議 +X 平移、+Y 平移、原地旋轉各做一次；三方向 k 差異 &gt; 5% 代表機構歪斜，
          不要用軟體補。完成後 wheelRadius 修正寫入常數表草稿。
        </div>
      </Collapse>
    </div>
  );
}
