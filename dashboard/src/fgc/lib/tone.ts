// 形狀語彙（§6.3）與警戒色語意（§6.6）—— 全專案唯一一份。
//
// 為什麼要獨立成一個檔案：這四個字元原本在六個檔案裡各寫了一次
// （alerts.ts / checks.ts / eventDetect.ts / TimeBar.tsx / BackupNudge.tsx /
//  ShutdownStrip.tsx / RecHeartbeat.tsx），只要有一處寫反，
// 「顏色不是唯一通道」這條無障礙保證就在那一個面板上失效，而且沒有人會發現——
// 色盲使用者看到的是一個形狀對不上的燈，其他人看到的是顏色正確所以沒問題。
//
// 語意（不因面板而異）：
//   ok    ● 符合驗收條件      loop p95 < 25 ms、電壓 > 12.0 V、值 = 建置值
//   warn  ▲ 接近界線          電壓 12.0–11.5、loop p95 20–25 ms、視覺 fps < 15
//   err   ■ 超出              電壓 < 11.5、loop p95 > 25、Threads ≠ 1
//   stale ○ 無資料 / 已過期   **永遠不顯示空白**，顯示最後的值與 age
//
// 這裡不含 React，所以純函式層（checks.ts / eventDetect.ts / alerts.ts）也能 import。

/** 全域四態。info 是 stale 在「通知」情境下的別名（沒有好壞，只是一則訊息）。 */
export type Tone = "ok" | "warn" | "err" | "stale";

export const GLYPHS: Record<Tone, string> = {
  ok: "●",
  warn: "▲",
  err: "■",
  stale: "○",
};

/** 關閉路徑三格用的第五個字元：□ =「這條路徑沒有生效」（不是沒資料）。 */
export const GLYPH_IDLE = "□";

/**
 * **模式徽章用的是另一套字母**（▲PIT / ▮MATCH / ▣REPLAY / ○未知，見 ConnectionBar）。
 * 刻意與上面這四個狀態字元分開：徽章回答的是「能不能寫」而不是「好不好」，
 * 混用會讓人把它讀成一顆狀態燈。
 *
 * 同理，「已選取 / 未選取」（訊號樹的釘選、球節奏的顆數）借用 ●／○ 是計數與選取，
 * 不是狀態——它們不在燈的位置上，所以不會被誤讀。
 */

export const TONE_LABEL: Record<Tone, string> = {
  ok: "符合驗收條件",
  warn: "接近界線",
  err: "超出驗收線",
  stale: "無資料或已過期",
};

/** CSS 變數名。Canvas 要用色時走 theme.palette()，不要在這裡回 hex。 */
export const TONE_VAR: Record<Tone, string> = {
  ok: "var(--ok)",
  warn: "var(--warn)",
  err: "var(--err)",
  stale: "var(--stale)",
};

export function glyphOf(tone: Tone): string {
  return GLYPHS[tone];
}

/**
 * 數值 → 三態的共用門檻判定。`worse` 說明方向：
 * "high" 表示越大越糟（loop ms、age），"low" 表示越小越糟（電壓、fps）。
 * 這樣所有面板的「接近界線」都是同一條路徑算出來的，不會這裡 >= 那裡 >。
 */
export function toneByThreshold(
  v: number,
  warnAt: number,
  errAt: number,
  worse: "high" | "low" = "high",
): Tone {
  if (!Number.isFinite(v)) return "stale";
  if (worse === "high") return v > errAt ? "err" : v > warnAt ? "warn" : "ok";
  return v < errAt ? "err" : v < warnAt ? "warn" : "ok";
}

// ── 驗收線（§6.6：全域，不因面板而異）──────────────────────────────
//
// 這幾個數字原本各自寫在三個檔案裡（ConnectionBar 頂欄、checks.ts 燈牆、
// alerts.ts 警報 rail），三處剛好一致——但那是巧合不是保證。
// 只要有人改了其中一處，畫面上就會出現「頂欄說黃燈、燈牆說綠燈」，
// 而使用者唯一能得到的結論是「這個儀表板不可信」。
//
// 電壓與 loop 是本案唯二有數值驗收線的量，所以它們特別值得只有一份。
export const LIMITS = {
  /** 低於這個值射速開始受影響 */
  battWarnV: 12.0,
  /** 低於這個值換電池 */
  battErrV: 11.5,
  /** loop p95（ms）：平均 12 ms 但 p95 40 ms 的機器人手感是頓的 */
  loopWarnMs: 20,
  loopErrMs: 25,
  /** 視覺 fps：低於 15 表示 MJPEG 或 decimation 在吃 CPU */
  visionWarnFps: 15,
  visionErrFps: 10,
  /** ws age（ms）：推播週期 PERIOD_MS=50，250 ms 已經是跳了五拍 */
  wsStaleMs: 250,
  wsDeadMs: 3000,
} as const;
