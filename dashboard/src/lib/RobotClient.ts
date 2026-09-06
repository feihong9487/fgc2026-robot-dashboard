// 機器人連線管理：WebSocket + 自動重連；亦可切換為本機模擬模式或回放模式。
// 連線／模擬期間自動把每一批遙測錄成 JSONL（{"t":秒,"d":{...}} 一行一批），
// 「匯出記錄」下載檔案、「回放」載入檔案依原時間軸餵回 store ——
// 所有分頁（場地圖/波形/狀態機）自動變成回放器，賽後追查「剛剛那趟」用。
import { store, NtValue } from "./store";
import { SimSource } from "./sim";

const PORT = 5800;
const MAX_RECORD_BATCHES = 30_000; // 50ms 一批 ≈ 25 分鐘，超過丟最舊的

interface RecordedBatch {
  t: number; // 距記錄開始的秒數
  d: Record<string, NtValue>;
}

class RobotClient {
  private ws: WebSocket | null = null;
  private sim: SimSource | null = null;
  private reconnectTimer: number | null = null;
  private wantHost: string | null = null;

  // 記錄／回放
  private recording: RecordedBatch[] = [];
  private recordT0 = 0;
  private replayTimer: number | null = null;

  connect(host: string) {
    this.disconnect();
    this.wantHost = host;
    this.open();
  }

  private open() {
    if (!this.wantHost) return;
    store.setConnState("connecting");
    const ws = new WebSocket(`ws://${this.wantHost}:${PORT}`);
    ws.binaryType = "arraybuffer";
    this.ws = ws;

    ws.onopen = () => {
      store.clearHistory();
      this.startRecording();
      store.setConnState("connected");
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data === "string") {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.op === "nt" || msg.op === "hello") {
            const d = msg.d as Record<string, NtValue>;
            this.record(d);
            store.applyBatch(d);
          }
        } catch {
          /* 忽略格式錯誤的訊息 */
        }
      } else {
        this.onBinary(ev.data as ArrayBuffer);
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return; // 已被新連線取代
      this.ws = null;
      if (this.wantHost) {
        store.setConnState("connecting");
        this.reconnectTimer = window.setTimeout(() => this.open(), 1000);
      } else {
        store.setConnState("disconnected");
      }
    };
    ws.onerror = () => ws.close();
  }

  private onBinary(buf: ArrayBuffer) {
    const view = new DataView(buf);
    if (buf.byteLength < 5) return;
    const channel = view.getUint8(0);
    if (channel === 1) {
      const n = view.getUint32(1, true);
      if (buf.byteLength < 5 + n * 8) return;
      // float 資料從 byte 5 起，但 Float32Array 要求 byteOffset 為 4 的倍數；
      // 5 不是 → new Float32Array(buf, 5, ...) 會丟 RangeError。改用 slice 複製成
      // 對齊(offset 0)的新 buffer 再建立。
      store.setPointCloud(new Float32Array(buf.slice(5, 5 + n * 8)));
    } else if (channel === 2) {
      // 通道 2 = 牆面擬合線段，每段 4 個 float [x1,y1,x2,y2]。
      // n 段 → n*16 bytes。n=0 是合法的「清空」訊息（擬合失效時清掉舊紅線）。
      const n = view.getUint32(1, true);
      if (buf.byteLength < 5 + n * 16) return;
      store.setFitLines(new Float32Array(buf.slice(5, 5 + n * 16)));
    } else if (channel === 3) {
      // 通道 3 = 笛卡兒選點窗口，每窗 8 個 float（四個角）→ n*32 bytes。
      // 與通道 2 同樣用 slice 避開 Float32Array 的 byteOffset 對齊限制。
      const n = view.getUint32(1, true);
      if (buf.byteLength < 5 + n * 32) return;
      store.setFitWindows(new Float32Array(buf.slice(5, 5 + n * 32)));
    } else if (channel === 4) {
      // 通道 4 = Occupancy grid（RLE）。訊框：[u16 cols][u16 rows][u32 runCount]
      // 後接 runCount×(u8 值, u16 長度)，全 LE。展開成 cols*rows 的三態陣列。
      if (buf.byteLength < 9) return;
      const cols = view.getUint16(1, true);
      const rows = view.getUint16(3, true);
      const runCount = view.getUint32(5, true);
      const cells = new Uint8Array(cols * rows);
      let p = 9;
      let idx = 0;
      for (let r = 0; r < runCount; r++) {
        if (p + 3 > buf.byteLength) break;
        const v = view.getUint8(p);
        const len = view.getUint16(p + 1, true);
        p += 3;
        for (let k = 0; k < len && idx < cells.length; k++) cells[idx++] = v;
      }
      store.setGrid(cols, rows, cells);
    }
  }

  /** 調參／按鈕寫回機器人（模擬模式時由 SimSource 接手；回放模式唯讀） */
  set(key: string, value: NtValue) {
    if (store.connState === "replay") return;
    if (this.sim) {
      this.sim.set(key, value);
      return;
    }
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ op: "set", k: key, v: value }));
      // 樂觀更新：立刻反映在 UI，機器人回推後會再覆蓋一次
      store.applyBatch({ [key]: value });
    }
  }

  /** 路徑規劃分頁下傳路徑：[[x,y,θ],...]（公尺／度）。機器人端依序 Plan() 執行 */
  sendPath(pts: [number, number, number][]): boolean {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ op: "path", pts }));
      return true;
    }
    return false; // 模擬/離線：僅編輯與存檔，不下傳
  }

  startSim() {
    this.disconnect();
    store.clearHistory();
    this.startRecording();
    this.sim = new SimSource((d) => this.record(d));
    this.sim.start();
    store.setConnState("sim");
  }

  // ── 記錄 ───────────────────────────────────────────────────
  private startRecording() {
    this.recording = [];
    this.recordT0 = performance.now();
  }

  record(d: Record<string, NtValue>) {
    this.recording.push({ t: (performance.now() - this.recordT0) / 1000, d });
    if (this.recording.length > MAX_RECORD_BATCHES)
      this.recording.splice(0, this.recording.length - MAX_RECORD_BATCHES);
  }

  get recordedBatches() {
    return this.recording.length;
  }

  /** 匯出 JSONL 記錄檔（vmx-rec-*.jsonl） */
  exportRecording() {
    if (!this.recording.length) return;
    const text = this.recording.map((b) => JSON.stringify(b)).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "application/x-ndjson" }));
    const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
    a.download = `vmx-rec-${stamp}.jsonl`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ── 回放 ───────────────────────────────────────────────────
  startReplay(text: string) {
    this.disconnect();
    const batches: RecordedBatch[] = [];
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        const b = JSON.parse(line);
        if (typeof b.t === "number" && b.d && typeof b.d === "object") batches.push(b);
      } catch {
        /* 跳過壞行 */
      }
    }
    if (!batches.length) return false;
    store.clearHistory();
    store.setConnState("replay");
    const t0 = performance.now();
    let idx = 0;
    this.replayTimer = window.setInterval(() => {
      const now = (performance.now() - t0) / 1000;
      while (idx < batches.length && batches[idx].t <= now) {
        store.applyBatch(batches[idx].d);
        idx++;
      }
      if (idx >= batches.length) this.disconnect(); // 播畢自動停
    }, 40);
    return true;
  }

  disconnect() {
    this.wantHost = null;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.replayTimer !== null) {
      clearInterval(this.replayTimer);
      this.replayTimer = null;
    }
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      ws.onclose = null;
      ws.close();
    }
    if (this.sim) {
      this.sim.stop();
      this.sim = null;
    }
    store.setConnState("disconnected");
  }
}

export const client = new RobotClient();
