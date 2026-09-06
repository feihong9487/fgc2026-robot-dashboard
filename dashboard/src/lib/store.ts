// 遙測資料中心：最新值鏡射 + 點雲，附簡單訂閱機制。
//
// **時間序列不在這裡**：那是 fgc/lib/LogStore.ts 的職責（機器人時戳、Float64Array、
// 永不 splice、per-key 訂閱）。這個檔案以前另外維護一份 history ring buffer，
// 每一批對每個變動的 key 各做一次 splice(0,1)（3000 點 × 約 20 個 key × 20 Hz
// ≈ 每秒 240 萬次元素搬移），而且那是同一份遙測的第二份拷貝。已整份移除，
// Chart.tsx 改讀 liveLog.sampleWindow()。
export type NtValue = number | boolean | string | string[];

export type ConnState = "disconnected" | "connecting" | "connected" | "sim" | "replay";

// 模式是獨立欄位，不塞進 ConnState 的五態——否則所有既有 switch 都要跟著改。
// 預設 UNKNOWN 且 UNKNOWN 一律當鎖住：未知即鎖，不是未知即開放。
import type { AppMode } from "../fgc/lib/profile";

class TelemetryStore {
  latest = new Map<string, NtValue>();
  pointCloud: Float32Array = new Float32Array(0); // [x0,y0,x1,y1,...] 公尺
  pointCloudStamp = 0;
  fitLines: Float32Array = new Float32Array(0);   // 牆面擬合線段 [x1,y1,x2,y2,...] 公尺
  fitLinesStamp = 0;
  fitWindows: Float32Array = new Float32Array(0); // 笛卡兒選點窗口，每窗 8 個 float（四個角）公尺
  fitWindowsStamp = 0;
  // Occupancy grid（通道 4）：row-major，每格 0/1/2 = UNKNOWN/FREE/OCCUPIED。**場地座標**，
  // 依 cols(沿長邊 x)、rows(沿短邊 y) 與 2cm 格在 FieldView 還原。
  grid: { cols: number; rows: number; cells: Uint8Array } | null = null;
  gridStamp = 0;
  // 點雲顯示鏡像（持久化；只影響呈現，不動機器人端資料）
  // 預設「上下 + 左右都鏡像」（符合實際安裝方向）；使用者之後手動切換的設定會覆蓋此預設。
  flipV = (localStorage.getItem("vmx.pc.flipV") ?? "1") === "1"; // 上下（前後 x 軸）鏡像
  flipH = (localStorage.getItem("vmx.pc.flipH") ?? "1") === "1"; // 左右（y 軸）鏡像
  connState: ConnState = "disconnected";
  /** 只來自 /FGC/Bridge/Mode；斷線或尚未收到 hello 一律 UNKNOWN（= 鎖住）。 */
  mode: AppMode = "UNKNOWN";
  lastBatchAt = -1; // 最後一次收到遙測的時刻（now() 秒），頂欄延遲指示用

  private listeners = new Set<() => void>();
  private t0 = performance.now();

  now() {
    return (performance.now() - this.t0) / 1000;
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  private emit() {
    this.listeners.forEach((fn) => fn());
  }

  setConnState(s: ConnState) {
    this.connState = s;
    this.emit();
  }

  /**
   * 模式的**唯一**寫入口。名字刻意不叫 setMode：這份程式裡還有別的元件有自己的
   * 「模式」區域 state（統計區間之類），而 §8 M01 說「這一行寫錯，其他全部是裝飾」，
   * 所以 grep "setRobotMode(" 的結果必須永遠只有一種意思。
   *
   * 呼叫者只有 RobotClient，而且它有自己的授權規則（ws 的 /FGC/Bridge/Mode 才准
   * 授予 PIT；health 與輪詢只准降級）。任何 UI 元件都不該出現在這個函式的呼叫點裡。
   */
  setRobotMode(m: AppMode) {
    if (this.mode === m) return;
    this.mode = m;
    this.emit();
  }

  /**
   * @param inbound 這一批是不是真的從機器人收到的。樂觀更新（RobotClient.set 寫進
   *   左欄的那一筆）傳 false：它不是遙測，不可以讓 lastBatchAt 變新鮮。
   *   否則拖一下滑桿就會把頂欄的 ws age 歸零，而模式看門狗也會以為推播還在。
   */
  applyBatch(d: Record<string, NtValue>, inbound = true) {
    if (inbound) this.lastBatchAt = this.now();
    for (const [k, v] of Object.entries(d)) this.latest.set(k, v);
    this.emit();
  }

  setPointCloud(xy: Float32Array) {
    this.pointCloud = xy;
    this.pointCloudStamp = this.now();
    this.emit();
  }

  setFitLines(seg: Float32Array) {
    this.fitLines = seg;
    this.fitLinesStamp = this.now();
    this.emit();
  }

  setFitWindows(quads: Float32Array) {
    this.fitWindows = quads;
    this.fitWindowsStamp = this.now();
    this.emit();
  }

  setGrid(cols: number, rows: number, cells: Uint8Array) {
    this.grid = { cols, rows, cells };
    this.gridStamp = this.now();
    this.emit();
  }

  setFlipV(v: boolean) {
    this.flipV = v;
    localStorage.setItem("vmx.pc.flipV", v ? "1" : "0");
    this.emit();
  }

  setFlipH(v: boolean) {
    this.flipH = v;
    localStorage.setItem("vmx.pc.flipH", v ? "1" : "0");
    this.emit();
  }

  // 套用鏡像後的點雲（顯示用）。未開任何鏡像時回傳原陣列，不額外複製。
  points(): Float32Array {
    return this.applyFlip(this.pointCloud);
  }

  // 套用鏡像後的擬合線段（顯示用）。與點雲用同一組鏡像設定，兩者才會對齊。
  fitSegments(): Float32Array {
    return this.applyFlip(this.fitLines);
  }

  // 套用鏡像後的選點窗口（顯示用）。同樣是 interleaved [x,y,...]，鏡像規則通用；
  // 角點順序被鏡像翻轉後仍是同一個矩形的四個角，繞行方向反過來不影響描邊。
  fitWindowQuads(): Float32Array {
    return this.applyFlip(this.fitWindows);
  }

  // 對 interleaved [x,y,x,y,...] 陣列套用上下/左右鏡像。點雲與線段共用同一套規則。
  private applyFlip(src: Float32Array): Float32Array {
    if (!this.flipV && !this.flipH) return src;
    const out = new Float32Array(src.length);
    const sx = this.flipV ? -1 : 1; // 上下 = x（前後）
    const sy = this.flipH ? -1 : 1; // 左右 = y
    for (let i = 0; i + 1 < src.length; i += 2) {
      out[i] = sx * src[i];
      out[i + 1] = sy * src[i + 1];
    }
    return out;
  }

  num(key: string, def = 0): number {
    const v = this.latest.get(key);
    return typeof v === "number" ? v : def;
  }

  bool(key: string, def = false): boolean {
    const v = this.latest.get(key);
    return typeof v === "boolean" ? v : def;
  }

  str(key: string, def = ""): string {
    const v = this.latest.get(key);
    return typeof v === "string" ? v : def;
  }

  strArr(key: string): string[] {
    const v = this.latest.get(key);
    return Array.isArray(v) ? v : [];
  }
}

export const store = new TelemetryStore();
