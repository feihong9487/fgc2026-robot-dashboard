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
      note={all.length ? okN + " 成功、" + (all.length - okN) + " 失敗" : undefined}
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
                  {/* 空狀態是一個邀請，不是一則公告：先說發生了什麼，再說下一步怎麼做。 */}
                  還沒送出參數。左欄改一個值按 Enter，送出、回讀、被擋下的原因都會記在這裡。
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
                <td className="sl-rs">
                  {/* 形狀 + 顏色兩條通道：● 成功 / ■ 被拒。灰階列印與紅綠色覺辨異下都讀得出來。 */}
                  <span className={r.ok ? "fgc-glyph ok" : "fgc-glyph err"}>{r.ok ? "●" : "■"}</span>
                  {!r.ok && r.why && <div className="why">{r.why}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 交叉驗證：機器人自己記的最後一筆。兩邊不一致 = 我們送出去的東西根本沒到。
          標籤是中文比例字體，值才是等寬——等寬給值，不給標籤。 */}
      <div className="sl-foot">
        <span title="/FGC/Bridge/Last Set：機器人自己記的最後一筆">
          機器人 <b>{log.latestStr(K.lastSet, "—")}</b>
        </span>
        <span className="rej" title="/FGC/Bridge/Last Set Rejected">
          被拒 <b>{log.latestStr(K.lastSetRejected, "—")}</b>
        </span>
      </div>
    </PanelShell>
  );
}
