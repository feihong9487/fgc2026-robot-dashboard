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

/**
 * 單一的 lazy AudioContext，建立之後**不 close**。
 *
 * 以前每次嗶都 new 一個再用 800 ms 的 setTimeout 去 close()。瀏覽器對同時存在的
 * AudioContext 有數量上限（Chromium 約 6 個）而每個還會起一條音訊執行緒；只要
 * close() 因為任何理由失敗（catch 裡是靜默吞掉的）或分頁在背景讓 timer 被延後，
 * 就會一路累積到瀏覽器拒絕再建——之後警報就永遠不出聲，而且不會有任何徵兆。
 * 重用還順便讓第一次嗶不必付建 context 的延遲。
 */
let audio: AudioContext | null = null;

function audioCtx(): AudioContext | null {
  if (audio) return audio;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    audio = new Ctor();
  } catch {
    return null;
  }
  return audio;
}

function beep(): void {
  try {
    const ac = audioCtx();
    if (!ac) return;
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
        {list.length === 0 && <div className="alert-empty">目前沒有警報。</div>}
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
      <span className="ac-glyph fgc-glyph">{GLYPH[a.level]}</span>
      <span className="ac-body">
        <span className="ac-title">{a.title}</span>
        <span className="ac-desc">{a.desc}</span>
      </span>
      <span className="ac-age fgc-num">{held >= 0.1 ? `已 ${held.toFixed(1)} s` : ""}</span>
    </div>
  );
}
