// Lockdown 頁的三張靜態卡。全部零輸入元件——不是 disabled，是不存在。
//
// M11 對這一頁劃了一條明確的線：
//   可以顯示　機器人自身的健康狀態（build / mode / 錄影行數 / threads / gen）
//   一律不顯示 任何 /FGC/Shooter、/FGC/Vision、/FGC/Drive、/FGC/Aim 的值
// 這條線由程式保證，不是靠記憶：Lockdown 子樹的每一次取值都走
// fgcKeys.lockdownValue()（不在白名單就回 null，整格不 render），而
// tools/fgc-check-2a.ts 斷言 LOCKDOWN_KEYS ⊆ isLockdownSafeKey。
// 往這一頁加一格而忘了想 M11 的人，會在 npm run check 就被擋下來。
// （以前這句註解是假的：isLockdownSafeKey 當時是零呼叫點的死碼，
// 而假的保證比沒有保證更糟，因為它會讓 code review 略過這一頁。）
//
// 導覽卡刻意只列名稱不列數值：它是導覽不是顯示器。寫上「READY / SPINUP」是在告訴
// 隊員「那三個判斷去 Driver Hub 上看」，寫上實際數值就變成了場外遙測。

import { PATHS, REC_FILE_LABEL } from "../../lib/profile";

/** 場上的三個判斷都在 Driver Hub —— 只列名稱。 */
export function DriverHubCard() {
  return (
    <div className="lockdown-card">
      <h3>場上的三個判斷都在 Driver Hub</h3>
      <ul className="lockdown-list">
        <li>READY / SPINUP … telemetry 第 1 行</li>
        <li>TAG range … telemetry</li>
        <li>建議射速 … telemetry</li>
      </ul>
      <div className="lockdown-fine">
        本卡刻意不顯示任何數值：它是導覽，不是顯示器。顯示了就是 M11 要罰的場外教練式通訊。
      </div>
    </div>
  );
}

/** 賽後取檔：兩條路徑都要在 UI 上，因為賽場上不會有時間翻文件。 */
export function PostMatchCard() {
  return (
    <div className="lockdown-card">
      <h3>賽後取檔（比賽結束、切 B1-PIT 之後）</h3>
      <ul className="lockdown-list">
        <li>
          8080　<code>GET {PATHS.recList}</code> → <code>{REC_FILE_LABEL}?name=&lt;檔名&gt;</code>
        </li>
        <li>
          備援　OnBotJava 檔案樹 <code>/sdcard/FIRST/fgc-rec</code>
        </li>
      </ul>
      <div className="lockdown-fine">
        MATCH 期間這兩條 <code>rec.*</code> 都回 503（連 <code>?name=live</code> 一起關）。
        Driver Hub 跑 <b>Z-DASH-EXPORT</b> 或 <b>B1-PIT</b> 才會開。
        <b>一定要指定 name</b>：INIT 會開新檔，「最新的」是剛開的空檔，不是上一場。
        本頁不提供下載按鈕。
      </div>
    </div>
  );
}

/** 從未握手成功時才出現：告訴使用者怎麼在沒有輸入框的情況下換位址。 */
export function OfflineCard({ host, nextRetryInS }: { host: string; nextRetryInS: number | null }) {
  return (
    <div className="lockdown-card">
      <h3>
        <span className="fgc-glyph stale">○</span>
        從未收到 hello
      </h3>
      <div className="lockdown-fine">
        目前 host：<code>{host}</code>
        {nextRetryInS !== null && <> · 下次重試 {nextRetryInS} 秒後</>}
        <br />
        本頁沒有輸入框（M06：場邊不得複雜設定）。要換位址請用網址參數{" "}
        <code>?host=192.168.43.1</code>，或先在 Driver Hub 選 <code>B1-PIT</code> 進 PIT 模式。
        <br />
        連不上時第一個要問的不是「網路壞了嗎」，是<b>「Control Hub 是不是改名了、或改成 5 GHz 了」</b>
        ——TRG Appendix E 預告志工可能在檢錄時改它。差別是 30 分鐘。
      </div>
    </div>
  );
}
