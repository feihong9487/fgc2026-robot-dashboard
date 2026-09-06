// FGC 2026 儀表板 —— 模式路由與 App 骨架。
//
// 模式是結構不是狀態（§2.1）：
//   /FGC/Bridge/Mode == "PIT" 且 ws 已連  →  PIT     （唯一可寫回，有分頁）
//   /FGC/Bridge/Mode == "MATCH"           →  MATCH   （Lockdown 單頁，零輸入元件）
//   模式未知 / 尚未收到 hello / ws 斷線   →  MATCH   ← 預設鎖住，不是預設開放
//   使用者載入 jsonl                      →  REPLAY  （不建立 ws，物理上不可寫）
//
// MATCH 下分頁列、host 框、滑桿與快捷鍵都**不存在**，不是 disabled——
// 「不存在」是可以當場示範給檢錄志工看的，「disabled」不是。

import { useCallback, useEffect, useState } from "react";
import { ConnectionBar } from "./fgc/components/shell/ConnectionBar";
import { LockdownPage } from "./fgc/pages/LockdownPage";
import { ReplayPage } from "./fgc/pages/ReplayPage";
import { PIT_PAGES, pageByHotkey, findPage } from "./fgc/pages/registry";
import { client } from "./lib/RobotClient";
import { store } from "./lib/store";
import { DEFAULT_HOST, PATHS, httpUrl, readUrlParams, type RouteMode } from "./fgc/lib/profile";
import { useAppMode, useLink } from "./fgc/lib/hooks";
import * as persist from "./fgc/lib/persist";
import { initTheme, setTheme, getTheme, type ThemeName } from "./fgc/lib/theme";

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
  const mode = useAppMode();
  const link = useLink();

  const setHost = useCallback((h: string) => {
    setHostState(h);
    persist.setStr(persist.KEYS.host, h);
  }, []);

  // 開機：schema migration → 主題 → 連線
  useEffect(() => {
    persist.migrate();
    initTheme(URLP.theme);
  }, []);

  useEffect(() => {
    if (URLP.replay) return; // ?mode=replay 不建立 ws（回放物理上不可寫）
    const t = window.setTimeout(() => client.connect(host), 150);
    return () => {
      window.clearTimeout(t);
      client.disconnect();
    };
  }, [host]);

  // ?mode=replay&file=<rec.json 裡的檔名>：streaming 載入成一個獨立的 LogStore。
  // name=live 一律拒絕——那條路徑會回這一場的全部遙測（§8 M01 措施 6）。
  const [replayErr, setReplayErr] = useState("");
  useEffect(() => {
    if (!URLP.replay || !URLP.file) return;
    if (URLP.file === "live") {
      setReplayErr("拒絕載入 name=live：那是即時遙測旁路，不是錄影檔");
      return;
    }
    let alive = true;
    void (async () => {
      try {
        const res = await fetch(httpUrl(host, PATHS.recFile, { name: URLP.file! }), { cache: "no-store" });
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
  const replay = client.replayLog !== null;
  const route: RouteMode = replay ? "REPLAY" : mode === "PIT" ? "PIT" : "MATCH";

  // lockdown 主題不由使用者選：比賽日的螢幕被人看到時，
  // 它應該明顯是一台關著的機器，不是一個正在工作的控制台。
  useEffect(() => {
    if (route === "MATCH") {
      if (getTheme() !== "lockdown") setTheme("lockdown", false);
    } else if (getTheme() === "lockdown") {
      const saved = persist.getStr(persist.KEYS.theme, "dark");
      setTheme((saved === "field" ? "field" : "dark") as ThemeName, false);
    }
  }, [route]);

  const select = useCallback((id: string) => {
    setTab(id);
    persist.setStr(persist.KEYS.tab, id);
  }, []);

  // 快捷鍵。MATCH 全部停用，一顆都不留（M06）。
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

  if (route === "REPLAY") {
    return (
      <div className="fgc-app">
        <ConnectionBar host={host} setHost={setHost} />
        <div className="fgc-body">
          <ReplayPage />
        </div>
      </div>
    );
  }

  if (URLP.replay) {
    // ?mode=replay 但檔案還沒載完（或載失敗）：不建立 ws，也不掉回 Lockdown
    return (
      <div className="fgc-app">
        <ConnectionBar host={host} setHost={setHost} />
        <div className="fgc-body" style={{ padding: "calc(var(--u) * 3)", color: "var(--text-dim)" }}>
          {replayErr ? `載入失敗：${replayErr}` : `載入回放檔 ${URLP.file ?? "（未指定 file）"} …`}
        </div>
      </div>
    );
  }

  if (route === "MATCH") {
    // 分頁列不傳 = 整條不 render。這裡沒有 tabs 這個變數可以被誤用。
    return (
      <div className="fgc-app">
        <ConnectionBar host={host} setHost={setHost} />
        <div className="fgc-body">
          <LockdownPage host={host} />
        </div>
      </div>
    );
  }

  const page = findPage(tab) ?? PIT_PAGES[0];
  const tabs = (
    <nav className="fgc-tabs">
      {PIT_PAGES.map((p) => (
        <button
          key={p.id}
          className={p.id === page?.id ? "fgc-tab active" : "fgc-tab"}
          title={p.hint}
          onClick={() => select(p.id)}
        >
          {p.label}
          <span className="hk">{p.hotkey}</span>
        </button>
      ))}
    </nav>
  );

  return (
    <div className="fgc-app">
      <ConnectionBar host={host} setHost={setHost} tabs={tabs} />
      <div className="fgc-body">
        {page ? (
          <page.Component />
        ) : (
          <div style={{ padding: "calc(var(--u) * 3)", color: "var(--text-dim)" }}>
            尚未登記任何 PIT 分頁（後續階段各自 export 一個 PageDef 到 registry.ts）。
            {link.lastError && <div style={{ marginTop: 8 }}>最後一個連線錯誤：{link.lastError}</div>}
            {store.connState}
          </div>
        )}
      </div>
    </div>
  );
}
