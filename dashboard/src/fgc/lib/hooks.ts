// React 綁定：useSyncExternalStore 的 snapshot 一律回 primitive。
//
// 絕不回傳新建的物件或陣列——那會讓 React 每次都認為變了而無限重繪。
// 這同時修掉既有 16 處 const [,force] = useState(0) 在 React 18 concurrent 下的
// tearing 風險（那個 pattern 在 StrictMode 的雙重 render 下讀到的可能是兩份不同的資料）。

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
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
 *
 * snapshot 必須也是 per-key 的。以前它回 log.getVersion()——整份 log 的全域版本，
 * 20 Hz 一直在動——而 useSyncExternalStore 除了在訂閱回呼時比對 snapshot，
 * 還會在每次 render 之後的 effect 裡再比對一次；所以任何用 useLogKeys 的元件只要
 * 因為別的理由 render 一次，就會立刻被強制再 render 第二次，per-key 訂閱只發揮了
 * 一半效果。改成這些 key 各自 version 的和（LogStore.keyVersion 本來是死碼）。
 */
export function useLogKeys(keys: readonly string[], log: LogStore = liveLog): number {
  const subscribe = useCallback((fn: () => void) => log.subscribeKeys(keys, fn), [keys, log]);
  const snapshot = useCallback(() => {
    let sum = 0;
    for (const k of keys) sum += log.keyVersion(k);
    return sum;
  }, [keys, log]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/**
 * 目前載入的回放檔（null = 即時）。
 *
 * 路由讀的是 client.replayLog。它以前是個裸欄位，能正確更新只是因為 startReplay /
 * exitReplay 尾端剛好都呼叫了 patchLink()——路由的正確性依賴「另一件事的副作用剛好
 * 排在後面」，而那件事沒有任何編譯期或執行期的徵兆保護它。
 */
export function useReplayLog(): LogStore | null {
  useSyncExternalStore(client.subscribeReplay, client.getReplayVersion, client.getReplayVersion);
  return client.replayLog;
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
  useTickN(ms);
}

/** 同上，但回傳計數器——可以直接當 useMemo 的相依（「每 N ms 才重算一次」）。 */
export function useTickN(ms: number): number {
  const [n, force] = useForce();
  useEffect(() => {
    const t = window.setInterval(force, ms);
    return () => window.clearInterval(t);
  }, [ms, force]);
  return n;
}


function useForce(): [number, () => void] {
  const [n, setN] = useState(0);
  const force = useCallback(() => setN((x) => x + 1), []);
  return [n, force];
}

/**
 * 視窗寬度，帶 debounce。
 *
 * 以前 App / driveModel.useBreakpoint / TunePage 各自掛一個沒有 debounce 的
 * resize 監聽器，各自 setState：拖視窗邊框時每一個 resize 事件都會讓三棵子樹
 * 一起重繪，而底下還有十幾個 rAF Canvas 迴圈在跑。canvas.ts:27 與 timeAxis.ts:59
 * 早就為 ResizeObserver 加了同樣的 100 ms（「賽場上有人在拖視窗邊界時不該每 1 px
 * 重配一次 backing store」），window resize 這條只是漏了。
 */
export function useWindowWidth(debounceMs = 100): number {
  const [w, setW] = useState(() => window.innerWidth);
  useEffect(() => {
    let timer = 0;
    const on = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setW(window.innerWidth), debounceMs);
    };
    window.addEventListener("resize", on);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("resize", on);
    };
  }, [debounceMs]);
  return w;
}

/**
 * 會自己淡出的一行訊息。
 *
 * 六個地方本來各自寫了一份「setTimeout 清掉訊息」而且都沒存 id：unmount 後仍會
 * setState（React 18 不再警告所以沒人發現），而且連按兩次時第一個 timer 會提前
 * 把第二則訊息清掉——例如連按「存到機器人」再按「從機器人讀回」，第二則結果只會
 * 顯示不到一秒，在賽場上會被讀成「按了沒反應」。
 */
export function useFlash(ms = 2500): [string, (text: string) => void] {
  const [msg, setMsg] = useState("");
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const flash = useCallback(
    (text: string) => {
      window.clearTimeout(timer.current);
      setMsg(text);
      timer.current = window.setTimeout(() => setMsg(""), ms);
    },
    [ms],
  );
  return [msg, flash];
}

/** 語意糖：把一組 key 綁成穩定的陣列 identity（useLogKeys 的相依要求）。 */
export function useKeys(...keys: string[]): readonly string[] {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => keys, keys);
}
