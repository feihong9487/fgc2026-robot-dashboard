// 設定選單（齒輪）：主題 · 密度 · 連線埠 · 匯出/匯入全部設定。
//
// 三個規則面的決定：
//  1. **MATCH／未知模式下整顆齒輪不 render。** 它是輸入元件，而 §8 M06 的示範
//     是「切 MATCH → 螢幕上根本沒有可以按的東西」。主題在 MATCH 由 App 強制成
//     lockdown，本來也沒有可選的東西。
//  2. **這裡沒有任何一顆按鈕會碰 client.set。** 全部只寫 localStorage 與
//     profile 的埠覆寫，機器人端完全不知道有人動過設定。
//  3. **埠改了要重連。** 改完顯示「已套用，正在重連」而不是靜靜地不生效——
//     「我以為改了」與「真的改了」是兩件事（與關閉路徑三格同一個教訓）。
//
// 匯出/匯入解掉兩件事：換筆電要重設 9 個 localStorage 鍵，
// 以及 Tauri 版與瀏覽器版是兩個 origin、localStorage 不互通（§7.7）。

import { useCallback, useEffect, useRef, useState } from "react";
import * as persist from "../../lib/persist";
import { getDensity, getTheme, setDensity, setTheme, type Density, type ThemeName } from "../../lib/theme";
import { FGC, httpPort, portsOverridden, RELAY_PORTS, setPorts, wsPort } from "../../lib/profile";
import { copyText } from "../../lib/clipboard";
import { useFlash } from "../../lib/hooks";

const THEMES: { id: ThemeName; label: string; why: string }[] = [
  { id: "dark", label: "暗色", why: "pit 帳篷、賽後分析" },
  { id: "field", label: "賽場", why: "純黑高對比、字級 1.6 倍、隔 1.5 公尺站著看" },
];

const DENSITIES: { id: Density; label: string; why: string }[] = [
  { id: "compact", label: "緊湊", why: "參數／射手：資訊密集" },
  { id: "normal", label: "標準", why: "駕駛" },
  { id: "loose", label: "寬鬆", why: "賽場、觸控：命中區 ≥ 44 px" },
];

export function SettingsMenu({ onPortsChanged }: { onPortsChanged?: () => void }) {
  const [open, setOpen] = useState(false);
  const [, force] = useState(0);
  const [msg, flash] = useFlash(3000);
  const [httpDraft, setHttpDraft] = useState(String(httpPort()));
  const [wsDraft, setWsDraft] = useState(String(wsPort()));
  const fileRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // 點外面關閉。不用 onBlur——內部有 input，focus 一移動就會誤關。
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  // flash 走 useFlash：會在 unmount 時清掉 timer，也會在下一次 flash 時取消前一個。
  // 六個地方本來各自寫了一份沒存 id 的 setTimeout，連按兩次時第一個 timer 會提前
  // 把第二則訊息清掉——在賽場上會被讀成「按了沒反應」。

  const applyPorts = useCallback(
    (http: number | null, ws: number | null) => {
      setPorts(http, ws);
      setHttpDraft(String(httpPort()));
      setWsDraft(String(wsPort()));
      force((n) => n + 1);
      flash(`已套用 ${httpPort()} / ${wsPort()}，正在重連`);
      onPortsChanged?.();
    },
    [flash, onPortsChanged],
  );

  const onExport = useCallback(() => {
    const json = JSON.stringify(persist.exportAll(), null, 2);
    void copyText(json).then((r) => {
      flash(r === "failed" ? "複製失敗（兩條剪貼簿路徑都被擋）" : `已複製 ${json.length} 位元組的設定 JSON`);
    });
  }, [flash]);

  const onImportFile = useCallback(
    (f: File) => {
      void f.text().then((txt) => {
        try {
          const n = persist.importAll(JSON.parse(txt));
          if (n < 0) flash("格式不對：需要 {schema, entries} 這個形狀");
          else flash(`已匯入 ${n} 項，重新整理後生效`);
        } catch (e) {
          flash("解析失敗：" + String(e));
        }
      });
    },
    [flash],
  );

  const overridden = portsOverridden();

  return (
    <div className="fgc-settings" ref={boxRef}>
      <button
        className={"fgc-gear" + (open ? " on" : "") + (overridden ? " flagged" : "")}
        onClick={() => setOpen((o) => !o)}
        title={overridden ? `埠已被改成 ${httpPort()} / ${wsPort()}（原廠 8080 / 8081）` : "設定：主題、密度、連線埠、匯出設定"}
      >
        ⚙
      </button>

      {open && (
        <div className="fgc-menu">
          <section>
            <h4>主題</h4>
            <div className="seg-row">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  className={getTheme() === t.id ? "seg active" : "seg"}
                  title={t.why}
                  onClick={() => {
                    setTheme(t.id);
                    force((n) => n + 1);
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <p className="hint">lockdown 主題不在這裡：MATCH 進來時自動套上，也不能手動關掉。</p>
          </section>

          <section>
            <h4>密度</h4>
            <div className="seg-row">
              {DENSITIES.map((d) => (
                <button
                  key={d.id}
                  className={getDensity() === d.id ? "seg active" : "seg"}
                  title={d.why}
                  onClick={() => {
                    setDensity(d.id);
                    force((n) => n + 1);
                  }}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </section>

          <section>
            <h4>連線埠</h4>
            <div className="port-row">
              <label>
                HTTP
                <input
                  className="port-in"
                  value={httpDraft}
                  spellCheck={false}
                  onChange={(e) => setHttpDraft(e.target.value)}
                />
              </label>
              <label>
                ws
                <input
                  className="port-in"
                  value={wsDraft}
                  spellCheck={false}
                  onChange={(e) => setWsDraft(e.target.value)}
                />
              </label>
              <button className="seg" onClick={() => applyPorts(Number(httpDraft), Number(wsDraft))}>
                套用
              </button>
            </div>
            <div className="seg-row">
              <button
                className="seg"
                title="Driver Hub 用 adb reverse 中繼時，Control Hub 的 8080/8081 會映到手機本機的 18080/18081"
                onClick={() => applyPorts(RELAY_PORTS.http, RELAY_PORTS.ws)}
              >
                Driver Hub 中繼（18080/18081）
              </button>
              <button className="seg" onClick={() => applyPorts(null, null)}>
                回原廠（{FGC.httpPort}/{FGC.wsPort}）
              </button>
            </div>
            {overridden && <p className="hint warn">埠已改。連不上時先確認是不是這裡設錯了，不要先去查 Wi-Fi。</p>}
          </section>

          <section>
            <h4>設定備份</h4>
            <div className="seg-row">
              <button className="seg" onClick={onExport}>
                複製全部設定
              </button>
              <button className="seg" onClick={() => fileRef.current?.click()}>
                從檔案匯入…
              </button>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onImportFile(f);
                e.target.value = "";
              }}
            />
            <p className="hint">
              換筆電、或 Tauri 版與瀏覽器版之間搬設定用。這裡只有前端偏好，沒有任何機器人參數。
            </p>
          </section>

          {msg && <div className="fgc-menu-msg">{msg}</div>}
        </div>
      )}
    </div>
  );
}
