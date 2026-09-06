// React 綁定：useSyncExternalStore 的 snapshot 一律回 primitive。
//
// 絕不回傳新建的物件或陣列——那會讓 React 每次都認為變了而無限重繪。
// 這同時修掉既有 16 處 const [,force] = useState(0) 在 React 18 concurrent 下的
// tearing 風險（那個 pattern 在 StrictMode 的雙重 render 下讀到的可能是兩份不同的資料）。

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { LogStore, liveLog } from "./LogStore";
import { cursor } from "./cursorStore";
import { subscribeTheme, palette, type Palette } from "./theme";
import { client, type LinkInfo } from "../../lib/RobotClient";
import { store } from "../../lib/store";
import type { AppMode } from "./profile";

/** 整份 log 的版本號；只有真的要「任何 key 變了就重繪」時才用。 */
export function useLogVersion(log: LogStore = liveLog): number {
  return useSyncExternalStore(log.subscribe, log.getVersion, log.getVersion);
}

/**
 * per-key 訂閱：這一批沒動到你的 key 就不叫醒你。
 * keys 請用模組層級的常數陣列，不要每次 render 現組。
 */
export function useLogKeys(keys: readonly string[], log: LogStore = liveLog): number {
  return useSyncExternalStore(
    (fn) => log.subscribeKeys(keys, fn),
    log.getVersion,
    log.getVersion,
  );
}

export function useCursor(): number {
  return useSyncExternalStore(cursor.subscribe, cursor.getVersion, cursor.getVersion);
}

export function useLink(): LinkInfo {
  useSyncExternalStore(client.subscribeLink, client.getLinkVersion, client.getLinkVersion);
  return client.link;
}

/** store.mode 是獨立欄位，不塞進 ConnState 的五態（§2.1）。 */
export function useAppMode(): AppMode {
  useSyncExternalStore(store.subscribe, () => store.mode, () => store.mode);
  return store.mode;
}

export function usePalette(): Palette {
  useSyncExternalStore(subscribeTheme, tick, tick);
  return palette();
}

let themeTick = 0;
function tick(): number {
  return themeTick;
}
subscribeTheme(() => {
  themeTick++;
});

/**
 * 每 ms 強制重繪一次。頂欄的「年齡」數字必須持續變舊，
 * 否則遙測斷流時畫面會凍在最後一個看起來很健康的數字上。
 */
export function useTick(ms: number): void {
  const [, force] = useForce();
  useEffect(() => {
    const t = window.setInterval(force, ms);
    return () => window.clearInterval(t);
  }, [ms, force]);
}


function useForce(): [number, () => void] {
  const [n, setN] = useState(0);
  const force = useCallback(() => setN((x) => x + 1), []);
  return [n, force];
}
