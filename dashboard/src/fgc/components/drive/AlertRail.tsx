// #17 AlertRail —— DRIVE 右下的告警 rail，最多 3 條。
//
// ERROR 附 WebAudio 兩短嗶：駕駛的眼睛在場上不在螢幕，一張卡片不會被看到。
// **MATCH 絕不出聲也不顯示**——這一頁在 MATCH 根本不會被 render（DRIVE 只登記在
// PIT_PAGES），但這裡再加一道 mode 檢查：規則防線不靠「上層應該不會叫我」。
//
// 全頁零按鈕，所以卡片沒有關閉鍵。ERROR 跟著條件活：過流停了、電壓回來了，
// 卡片自己走。這比一顆關閉鍵誠實——你關掉的是卡片，不是問題。

import { useEffect, useRef, useSyncExternalStore } from "react";
import { liveLog } from "../../lib/LogStore";
import { useAppMode, useTick } from "../../lib/hooks";
import { client } from "../../../lib/RobotClient";
import { store } from "../../../lib/store";
import { PanelShell } from "../shell/PanelShell";
import { alerts, GLYPH, type Alert } from "./alerts";

/** 兩短嗶之間至少隔這麼久，避免一連串過流把 pit 變成警報器。 */
const BEEP_COOLDOWN_MS = 3000;

function beep(): void {
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ac = new Ctor();
    // 沒有使用者手勢時瀏覽器會讓 context 停在 suspended：resume 失敗就安靜地放棄，
    // 絕不讓「提示音」變成一個例外。
    if (ac.state === "suspended") void ac.resume().catch(() => undefined);
    const now = ac.currentTime;
    for (let i = 0; i < 2; i++) {
      const t0 = now + i * 0.16;
      const osc = ac.createOscillator();
      const g = ac.createGain();
      osc.type = "square";
      osc.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.08, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.1);
      osc.connect(g);
      g.connect(ac.destination);
      osc.start(t0);
      osc.stop(t0 + 0.12);
    }
    window.setTimeout(() => {
      try {
        void ac.close();
      } catch {
        /* 關不掉就讓 GC 處理 */
      }
    }, 800);
  } catch {
    /* 沒有音效不是錯誤，卡片還在 */
  }
}

export function AlertRail() {
  const mode = useAppMode();
  const pit = mode === "PIT";
  useSyncExternalStore(alerts.subscribe, alerts.getVersion, alerts.getVersion);
  useTick(500); // 讓「已 N.N s」持續變舊；數字凍住等於在說謊
  const lastBeep = useRef(0);

  // 機器人主動通知
  useEffect(() => {
    if (!pit) return;
    return client.onNotifyMsg((n) => alerts.onNotify(n));
  }, [pit]);

  // 前端自產：5 Hz 重算。放 setInterval 而不是 rAF——它不是視覺，是判斷。
  useEffect(() => {
    if (!pit) {
      alerts.clear();
      return;
    }
    const tick = () => {
      const ageMs = store.lastBatchAt >= 0 ? (store.now() - store.lastBatchAt) * 1000 : -1;
      alerts.evaluate(liveLog, ageMs);
      if (alerts.takeBeep()) {
        const now = Date.now();
        if (now - lastBeep.current > BEEP_COOLDOWN_MS) {
          lastBeep.current = now;
          beep();
        }
      }
    };
    tick();
    const id = window.setInterval(tick, 200);
    return () => window.clearInterval(id);
  }, [pit]);

  // MATCH／未知模式：不出聲也不顯示（M11／M06）
  if (!pit) return null;

  const list = alerts.list(3);
  const extra = alerts.count() - list.length;

  return (
    <PanelShell title="警報" note="ERROR 會響兩短嗶；條件解除卡片自己收" flush className="drive-alerts">
      <div className="alert-rail">
        {list.length === 0 && <div className="alert-empty">目前沒有告警</div>}
        {list.map((a) => (
          <AlertCard key={a.key} a={a} />
        ))}
        {extra > 0 && <div className="alert-more">另有 {extra} 條未顯示（rail 只留最嚴重的 3 條）</div>}
      </div>
    </PanelShell>
  );
}

function AlertCard({ a }: { a: Alert }) {
  const held = (Date.now() - a.at) / 1000;
  return (
    <div className={`alert-card ${a.level.toLowerCase()}`}>
      <span className="ac-glyph">{GLYPH[a.level]}</span>
      <span className="ac-body">
        <span className="ac-title">{a.title}</span>
        <span className="ac-desc">{a.desc}</span>
      </span>
      <span className="ac-age fgc-num">{held >= 0.1 ? `已 ${held.toFixed(1)} s` : ""}</span>
    </div>
  );
}
