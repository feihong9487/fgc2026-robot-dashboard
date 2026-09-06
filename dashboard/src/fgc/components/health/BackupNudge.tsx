// #38 BackupNudge：PIT 角落徽章。
//
// 要備份的是 /sdcard/FIRST/settings（硬體組態，9 個裝置）——重建要 20 分鐘且最容易
// 錯，而志工可能在檢錄時重設 Hub。R18 要求連續五晚把機器人留在 pit，所以這件事
// 每天都會被忘記一次。
//
// 文案刻意不寫「你還沒備份」（會被無視），寫「距上次備份 26 小時 · 明天第一場 09:40」
// ——帶後果的句子才會讓人現在就去做。這是全目錄成本最低的高價值元件之一。
//
// 這裡只有兩個輸入元件（打卡鍵與下一場時間），兩者都只寫 localStorage，
// 從來不碰 client.set，所以與 M01 的寫回路徑完全無關。

import { useCallback, useState } from "react";
import * as persist from "../../lib/persist";
import { useTick } from "../../lib/hooks";

const NEXT_MATCH_KEY = "nextMatch";
const WARN_H = 20;
const ERR_H = 30;

export function BackupNudge() {
  useTick(60_000);
  const [last, setLast] = useState<number>(() => persist.get<number>(persist.KEYS.lastBackup, 0));
  const [next, setNext] = useState<string>(() => persist.getStr(NEXT_MATCH_KEY, ""));
  const [editing, setEditing] = useState(false);

  const stamp = useCallback(() => {
    const now = Date.now();
    persist.set(persist.KEYS.lastBackup, now);
    setLast(now);
  }, []);

  const saveNext = useCallback((v: string) => {
    setNext(v);
    persist.setStr(NEXT_MATCH_KEY, v);
  }, []);

  const hours = last > 0 ? (Date.now() - last) / 3_600_000 : Infinity;
  const tone = hours >= ERR_H ? "err" : hours >= WARN_H ? "warn" : "ok";
  const glyph = tone === "err" ? "■" : tone === "warn" ? "▲" : "●";

  const headline =
    last === 0
      ? "沒有備份記錄"
      : hours < 1
        ? `距上次備份 ${Math.round(hours * 60)} 分鐘`
        : `距上次備份 ${Math.round(hours)} 小時`;

  return (
    <div className={`hw-backup ${tone}`}>
      <span className={`fgc-glyph ${tone}`}>{glyph}</span>
      <div className="text">
        <div className="head">
          {headline}
          {next && <span className="next"> · 下一場 {next}</span>}
        </div>
        <div className="sub">
          <code>/sdcard/FIRST/settings</code> —— 9 個裝置重建 20 分鐘，志工可能在檢錄時重設 Hub
        </div>
      </div>
      {editing ? (
        <input
          className="hw-backup-input"
          autoFocus
          value={next}
          placeholder="明天第一場 09:40"
          spellCheck={false}
          onChange={(e) => saveNext(e.target.value)}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "Escape") setEditing(false);
          }}
        />
      ) : (
        <button className="hw-btn ghost" onClick={() => setEditing(true)} title="只存在這台筆電的 localStorage">
          下一場…
        </button>
      )}
      <button className="hw-btn" onClick={stamp} title="按下去只寫 localStorage，不會碰機器人">
        已備份完成
      </button>
    </div>
  );
}
