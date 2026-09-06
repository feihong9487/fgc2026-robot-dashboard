// 頂欄：機器人 IP、連線/模擬/回放切換、連線狀態、全域任務狀態（指令/趟次）、
// 電池電壓、遙測延遲、E-Stop 燈、軟體中止鈕。
// 電池/延遲/中止是安全與可信度訊號，常駐頂欄、不被分頁切換蓋掉。
import { useEffect, useRef, useState } from "react";
import { store } from "../lib/store";
import { client } from "../lib/RobotClient";
import { K, SIM_K, RUN_K, STATUS_K } from "../lib/keys";

const LS_KEY = "vmx-dashboard.host";

const STATE_LABEL = {
  disconnected: "未連線",
  connecting: "連線中…",
  connected: "已連線",
  sim: "模擬模式",
  replay: "回放中",
} as const;

export function ConnectionBar({
  host,
  setHost,
}: {
  host: string;
  setHost: (h: string) => void;
}) {
  const [, force] = useState(0);
  useEffect(() => store.subscribe(() => force((n) => n + 1)), []);
  // 遙測斷流時延遲數字也要繼續變舊
  useEffect(() => {
    const t = window.setInterval(() => force((n) => n + 1), 500);
    return () => clearInterval(t);
  }, []);
  const fileRef = useRef<HTMLInputElement>(null);

  const st = store.connState;
  const eStop = store.bool(K.eStop, false);
  const live = st === "connected" || st === "sim" || st === "replay";
  const cmd = String(store.latest.get(SIM_K.currentCommand) ?? "");
  const trip = store.num(SIM_K.tripIndex, 0);
  const state = String(store.latest.get(SIM_K.state) ?? "");
  const fault = state.startsWith("FAULT") || state === "ABORTED";

  const battery = store.num(STATUS_K.battery, 0);
  const ageMs = store.lastBatchAt >= 0 ? (store.now() - store.lastBatchAt) * 1000 : -1;
  const stale = ageMs > 500;

  return (
    <header className="conn-bar">
      <span className="app-title">VMX Dashboard</span>

      <input
        className="host-input"
        value={host}
        onChange={(e) => {
          setHost(e.target.value);
          localStorage.setItem(LS_KEY, e.target.value);
        }}
        placeholder="機器人 IP（如 10.12.34.2）"
        disabled={st === "connected" || st === "connecting"}
      />

      {st === "disconnected" || st === "sim" || st === "replay" ? (
        <button className="btn" onClick={() => client.connect(host)}>
          連線
        </button>
      ) : (
        <button className="btn" onClick={() => client.disconnect()}>
          中斷
        </button>
      )}

      <button
        className={st === "sim" ? "btn sim active" : "btn sim"}
        onClick={() => (st === "sim" ? client.disconnect() : client.startSim())}
      >
        模擬
      </button>

      {st === "replay" ? (
        <button className="btn sim active" onClick={() => client.disconnect()}>
          停止回放
        </button>
      ) : (
        <button className="btn" title="載入 JSONL 記錄檔回放" onClick={() => fileRef.current?.click()}>
          回放
        </button>
      )}
      <button
        className="btn"
        title={`匯出本次記錄（${client.recordedBatches} 批）`}
        disabled={client.recordedBatches === 0}
        onClick={() => client.exportRecording()}
      >
        存檔
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".jsonl,.txt"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) f.text().then((text) => client.startReplay(text));
          e.target.value = "";
        }}
      />

      <span className={`conn-dot ${st}`} />
      <span className="conn-label">{STATE_LABEL[st]}</span>

      <span className="spacer" />

      {live && cmd && (
        <span className={fault ? "task-chip fault" : "task-chip"} title={`State: ${state}`}>
          {cmd}
          {trip > 0 && <span className="task-trip">｜趟 {trip}/3</span>}
        </span>
      )}

      {live && battery > 0 && (
        <span className={battery < 11 ? "vital warn" : "vital"} title="電池電壓（低於 11V 換電池）">
          {battery.toFixed(1)}V
        </span>
      )}
      {live && ageMs >= 0 && (
        <span className={stale ? "vital warn" : "vital"} title="距上一批遙測的時間">
          {ageMs < 9999 ? `${ageMs.toFixed(0)}ms` : "斷流"}
        </span>
      )}

      {live && (
        <span className={eStop ? "estop-badge on" : "estop-badge"}>
          {eStop ? "E-STOP" : "運作正常"}
        </span>
      )}

      {(st === "connected" || st === "sim") && (
        <button className="btn abort" title="軟體中止：清空指令佇列並停機" onClick={() => client.set(RUN_K.abort, true)}>
          中止
        </button>
      )}
    </header>
  );
}

export function loadSavedHost(): string {
  return localStorage.getItem(LS_KEY) ?? "10.0.0.2";
}
