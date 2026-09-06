// FGC 2026 儀表板 —— 模式路由與 App 骨架。
//
// 模式是結構不是狀態（§2.1）：
//   /FGC/Bridge/Mode == "PIT" 且 ws 已連  →  PIT     （唯一可寫回，有分頁）
//   /FGC/Bridge/Mode == "MATCH"           →  MATCH   （Lockdown 單頁，零輸入元件）
//   模式未知 / 尚未收到 hello / ws 斷線   →  MATCH   ← 預設鎖住，不是預設開放
//   使用者載入 jsonl                      →  REPLAY  （不建立 ws，物理上不可寫）
//
// MATCH 下分頁列、host 框、齒輪與快捷鍵都**不存在**，不是 disabled——
// 「不存在」是可以當場示範給檢錄志工看的，「disabled」不是。
//
// 每一頁各包一個 ErrorBoundary：任何一個面板丟例外時，壞的是那一頁，
// 不是整台儀表板——頂欄的 ws age／8080 燈／錄影行數必須活著，
// 因為那三個數字正是「機器人到底怎麼了」的答案。

import { useCallback, useEffect, useState } from "react";
import { ConnectionBar } from "./fgc/components/shell/ConnectionBar";
import { ErrorBoundary } from "./fgc/components/shell/ErrorBoundary";
import { LockdownPage } from "./fgc/pages/LockdownPage";
import { ReplayPage } from "./fgc/pages/ReplayPage";
import { PIT_PAGES, TAB_PAGES, pageByHotkey, findPage } from "./fgc/pages/registry";
import { client } from "./lib/RobotClient";
import {
  DEFAULT_HOST,
  initPorts,
  readUrlParams,
  recFileUrl,
  type RouteMode,
} from "./fgc/lib/profile";
import { useAppMode, useLink, useReplayLog, useWindowWidth } from "./fgc/lib/hooks";
import * as persist from "./fgc/lib/persist";
import { initTheme, setTheme, getTheme, preferredTheme } from "./fgc/lib/theme";

const URLP = readUrlParams();

function initialHost(): string {
  return URLP.host ?? persist.getStr(persist.KEYS.host, DEFAULT_HOST);
}

function initialTab(): string {
  const fromUrl = URLP.tab && findPage(URLP.tab) ? URLP.tab : null;
  const saved = persist.getStr(persist.KEYS.tab, "");
  return fromUrl ?? (findPage(saved) ? saved : (PIT_PAGES[0]?.id ?? ""));
}

export default function App() {
  const [host, setHostState] = useState(initialHost);
  const [tab, setTab] = useState(initialTab);
  const [reconnectN, setReconnectN] = useState(0);
  const mode = useAppMode();
  const link = useLink();
  const winW = useWindowWidth();

  const setHost = useCallback((h: string) => {
    setHostState(h);
    persist.setStr(persist.KEYS.host, h);
  }, []);

  // 開機：schema migration → 埠覆寫 → 主題。
  // 埠一定要在 client.connect 之前定案，否則第一次連線會連到原廠埠再重連一次。
  useEffect(() => {
    persist.migrate();
    initPorts(URLP);
    initTheme(URLP.theme);
  }, []);

  useEffect(() => {
    // ?mode=replay 不建立 ws（回放物理上不可寫），但仍要輪詢 /dash/health：
    // 頂欄的 8080 燈 / 錄影行數 / Thr 是「這台筆電到底有沒有在跟機器人講話」的答案，
    // 而 health 的 mode=MATCH 會把整頁降級成 Lockdown——網址參數蓋不過模式。
    if (URLP.replay) {
      const t0 = window.setTimeout(() => client.watchHealthOnly(host), 150);
      return () => {
        window.clearTimeout(t0);
        client.disconnect();
      };
    }
    const t = window.setTimeout(() => client.connect(host), 150);
    return () => {
      window.clearTimeout(t);
      client.disconnect();
    };
  }, [host, reconnectN]);

  // 齒輪裡改了埠 → 整條連線重來（wsUrl/httpBase 是每次呼叫才算的，
  // 但已經建立的 WebSocket 不會自己換位址）。
  const onPortsChanged = useCallback(() => setReconnectN((n) => n + 1), []);

  // ?mode=replay&file=<rec.json 裡的檔名>：streaming 載入成一個獨立的 LogStore。
  // name=live 由 recFileUrl 自己 throw——那條路徑會回這一場的全部遙測（§8 M01 措施 6），
  // 而這條自律以前是兩份要靠人記得複製的 if，現在是唯一的收口。
  const [replayErr, setReplayErr] = useState("");
  useEffect(() => {
    if (!URLP.replay || !URLP.file) return;
    let alive = true;
    void (async () => {
      try {
        const res = await fetch(recFileUrl(host, URLP.file!), { cache: "no-store" });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        const okLoad = await client.startReplay(res.body, URLP.file!);
        if (alive && !okLoad) setReplayErr("檔案裡沒有可用的批次");
      } catch (e) {
        if (alive) setReplayErr(String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [host]);

  // 決定路由。UNKNOWN 併進 MATCH。
  // replay 走顯式訂閱（useReplayLog），不再依賴 client.replayLog 這個裸欄位剛好
  // 因為 startReplay 尾端的 patchLink 而被順便更新。
  const replay = useReplayLog() !== null;
  const route: RouteMode = replay ? "REPLAY" : mode === "PIT" ? "PIT" : "MATCH";

  // lockdown 主題不由使用者選：比賽日的螢幕被人看到時，
  // 它應該明顯是一台關著的機器，不是一個正在工作的控制台。
  useEffect(() => {
    if (route === "MATCH") {
      if (getTheme() !== "lockdown") setTheme("lockdown", false);
    } else if (getTheme() === "lockdown") {
      // 還原成使用者真正選的那個（theme.ts 記著），不是去讀 localStorage——
      // 開機的第一個 route 一定是 MATCH（模式未知＝鎖住），
      // 讀 localStorage 會把 ?theme=field 這種一次性參數吃掉。
      setTheme(preferredTheme(), false);
    }
  }, [route]);

  const select = useCallback((id: string) => {
    setTab(id);
    persist.setStr(persist.KEYS.tab, id);
  }, []);

  // 分頁快捷鍵。MATCH 全部停用，一顆都不留（M06）。
  // 時間相關的鍵（Space / ←→ / [ ] \ / L / Home / End / 1 2 4）掛在 TimeBar 上，
  // 面板內的鍵（F / Ctrl+. / Ctrl+F / Ctrl+B / Ctrl+C）掛在各自的面板上——
  // 這裡只管「換頁」，才不會兩層互搶。
  useEffect(() => {
    if (route !== "PIT") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable) return;
      const page = pageByHotkey(e.key);
      if (page) {
        e.preventDefault();
        select(page.id);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [route, select]);

  // 「已確認的 MATCH」排在所有東西前面。以前 ?mode=replay 的早退分支排在 MATCH
  // 判斷之前，等於用一個網址參數就能跳過 Lockdown 路由——實測是安全的，但那是靠
  // ConnectionBar 自己又檢查了一次 mode === "PIT" 的第二層防守，不是這個分支自己的
  // 性質。UNKNOWN + ?mode=replay 仍走載入分支（那時我們刻意沒有 ws，判斷不出模式，
  // 而 rec.jsonl 在 MATCH 一律 503，載也載不到）。
  if (mode === "MATCH") {
    return (
      <div className="fgc-app">
        <ConnectionBar host={host} setHost={setHost} />
        <div className="fgc-body">
          <ErrorBoundary where="比賽鎖定">
            <LockdownPage host={host} />
          </ErrorBoundary>
        </div>
      </div>
    );
  }

  if (route === "REPLAY") {
    return (
      <div className="fgc-app">
        <ConnectionBar host={host} setHost={setHost} onPortsChanged={onPortsChanged} />
        <div className="fgc-body">
          <ErrorBoundary where="回放">
            <ReplayPage />
          </ErrorBoundary>
        </div>
      </div>
    );
  }

  if (URLP.replay) {
    // ?mode=replay 但檔案還沒載完（或載失敗）：不建立 ws，也不掉回 Lockdown
    return (
      <div className="fgc-app">
        <ConnectionBar host={host} setHost={setHost} onPortsChanged={onPortsChanged} />
        <div className="fgc-body" style={{ padding: "calc(var(--u) * 3)", color: "var(--text-dim)" }}>
          {replayErr ? `載入失敗：${replayErr}` : `載入回放檔 ${URLP.file ?? "（未指定 file）"} …`}
        </div>
      </div>
    );
  }

  if (route === "MATCH") {
    // 這裡剩下的只有 UNKNOWN（未知即鎖，不是未知即開放）。
    // 分頁列與齒輪都不傳 = 整條不 render；這裡沒有 tabs 這個變數可以被誤用，
    // 也沒有任何輸入元件的入口。
    return (
      <div className="fgc-app">
        <ConnectionBar host={host} setHost={setHost} />
        <div className="fgc-body">
          <ErrorBoundary where="比賽鎖定">
            <LockdownPage host={host} />
          </ErrorBoundary>
        </div>
      </div>
    );
  }

  const page = findPage(tab) ?? PIT_PAGES[0];
  const tabs = (
    <nav className="fgc-tabs">
      {TAB_PAGES.map((p) => {
        const narrow = p.minWidth !== undefined && winW < p.minWidth;
        return (
          <button
            key={p.id}
            className={
              (p.id === page?.id ? "fgc-tab active" : "fgc-tab") + (narrow ? " narrow" : "")
            }
            title={narrow ? `${p.hint ?? p.label}（這一頁需要 ≥ ${p.minWidth} 寬的視窗，目前 ${winW}）` : p.hint}
            onClick={() => select(p.id)}
          >
            {p.label}
            <span className="hk">{p.hotkey}</span>
          </button>
        );
      })}
    </nav>
  );

  return (
    <div className="fgc-app">
      <ConnectionBar host={host} setHost={setHost} tabs={tabs} onPortsChanged={onPortsChanged} />
      <div className="fgc-body">
        {page ? (
          // key = 分頁 id：換頁時重建邊界，才不會帶著上一頁的錯誤狀態過去
          <ErrorBoundary key={page.id} where={page.label}>
            <page.Component />
          </ErrorBoundary>
        ) : (
          <div style={{ padding: "calc(var(--u) * 3)", color: "var(--text-dim)" }}>
            分頁註冊表是空的（registry.ts 的 PIT_PAGES）。
            {link.lastError && <div style={{ marginTop: 8 }}>最後一個連線錯誤：{link.lastError}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
