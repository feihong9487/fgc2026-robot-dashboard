// SetLedger（§3.3 #25）：寫回帳本。
//
// 為什麼需要它：寫回失敗有四種原因——不在白名單、超出範圍、MATCH 拒絕、斷線——
// 而沒有帳本時它們在 UI 上長得**一模一樣**，都是「數字沒變」。四種的處置方式
// 完全不同（改 key／改值／切模式／查網路），分不出來就只能一個一個猜。
//
// 資料不需要新協定：ws 的 err（{k,why}，DashHub.errJson）已經存在，前端只要
// 補上時戳與回讀延遲。機器人自己的 /FGC/Bridge/Last Set 與 Last Set Rejected
// 一起顯示在頁尾當交叉驗證：兩邊不一致就表示我們送出去的東西根本沒到。

import { useEffect, useRef, useSyncExternalStore } from "react";
import { PanelShell } from "../shell/PanelShell";
import { LogStore, liveLog } from "../../lib/LogStore";
import { K } from "../../lib/fgcKeys";
import { useLogKeys } from "../../lib/hooks";
import type { NtValue } from "../../../lib/store";
import { setLedger } from "./setLedgerStore";

interface Props {
  log?: LogStore;
  allowInputs?: boolean;
  /** 顯示幾筆（§3.3 #25 規定最近 20 筆）。 */
  rows?: number;
}

const FOOT_KEYS = [K.lastSet, K.lastSetRejected] as const;

function fmtV(v: NtValue | null): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return String(parseFloat(v.toPrecision(8)));
  if (typeof v === "boolean") return v ? "ON" : "OFF";
  if (Array.isArray(v)) return "[" + v.length + " 項]";
  return v;
}

function hhmmss(at: number): string {
  return new Date(at).toLocaleTimeString("zh-TW", { hour12: false });
}

export function SetLedger({ log = liveLog, allowInputs, rows = 20 }: Props) {
  useSyncExternalStore(setLedger.subscribe, setLedger.getVersion, setLedger.getVersion);
  useLogKeys(FOOT_KEYS, log);

  const boxRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const all = setLedger.records;
  const shown = all.slice(Math.max(0, all.length - rows));

  // 「已在底部才自動捲」（抄 FTC CustomVirtualGrid.tsx:87-105 的 scrollUpdateWasRequested）：
  // 使用者往上捲去看剛剛那一筆被拒的時候，新的一筆不可以把他拉回底部。
  useEffect(() => {
    const el = boxRef.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [all.length]);

  const onScroll = () => {
    const el = boxRef.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  };

  const okN = all.filter((r) => r.ok).length;

  return (
    <PanelShell
      title={"寫回帳本（最近 " + rows + " 筆）"}
      note={all.length ? okN + " 成功 / " + (all.length - okN) + " 失敗" : "尚無寫回"}
      tools={
        allowInputs && all.length > 0 ? (
          <button className="tb-btn" onClick={() => setLedger.clear()} title="只清畫面，不影響機器人">
            清空
          </button>
        ) : undefined
      }
      flush
      className="sl-shell"
    >
      <div className="sl" ref={boxRef} onScroll={onScroll}>
        <table className="fgc-table sl-table">
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td colSpan={5} className="empty">
                  還沒有任何 set。被硬閘擋下的（MATCH／未連線／不在白名單）也會記在這裡——
                  絕不靜默丟棄。
                </td>
              </tr>
            )}
            {shown.map((r, i) => (
              <tr key={r.at + "-" + r.name + "-" + i} className={r.ok ? "ok" : "bad"}>
                <td className="tm">{hhmmss(r.at)}</td>
                <td className="nm" title={r.key}>
                  {r.name || "(無 key)"}
                </td>
                <td className="vv">
                  {fmtV(r.from)}
                  <span className="ar">→</span>
                  {fmtV(r.to)}
                </td>
                <td className="ms">{r.echoMs === null ? "——" : "回讀 " + r.echoMs + "ms"}</td>
                <td className="rs">
                  {r.ok ? "✓" : "✗"}
                  {!r.ok && r.why && <div className="why">why: {r.why}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="sl-foot">
        <span title="/FGC/Bridge/Last Set：機器人自己記的最後一筆">
          機器人：{log.latestStr(K.lastSet, "—")}
        </span>
        <span className="rej" title="/FGC/Bridge/Last Set Rejected">
          被拒：{log.latestStr(K.lastSetRejected, "—")}
        </span>
      </div>
    </PanelShell>
  );
}
