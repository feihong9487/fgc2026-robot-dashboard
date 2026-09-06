// TuneTable（§3.3 #24）：21 項白名單的雙欄四態。
//
// 為什麼一定要雙欄：從手指到機器人再回到眼睛這條鏈路上有三道會**默默吃掉你的值**
// 的關卡——白名單（DashParams.java:37-46）、範圍夾限（:58-76）、MATCH 拒絕
// （DashWs.java:44-47）。單欄 UI 會讓三道全部隱形，因為它們在畫面上長得一模一樣：
// 都是「數字沒變」。左欄是我送出去的（/FGC/Tune/*），右欄是機器人回讀的
// （/FGC/Param/*），兩欄不一致本身就是診斷。
//
// 鐵律：樂觀更新只准套 /FGC/Tune/*，絕不可套 /FGC/Param/*（在 RobotClient.set 裡）。
// 右欄一旦被自己送出的值蓋掉，對帳就變成自欺。
//
// 非 PIT：整張表改成純文字（.ro-value），輸入元件**不存在**而不是 disabled。

import { Fragment, useMemo, useState, useSyncExternalStore } from "react";
import { PanelShell } from "../shell/PanelShell";
import { LogStore, liveLog } from "../../lib/LogStore";
import {
  TUNABLES,
  TUNE_GROUPS,
  clampTune,
  paramKey,
  tuneKey,
  uiMaxOf,
  type Tunable,
} from "../../lib/fgcKeys";
import { FGC } from "../../lib/profile";
import { useTick } from "../../lib/hooks";
import { client } from "../../../lib/RobotClient";
import { setLedger } from "./setLedgerStore";

interface Props {
  log?: LogStore;
  allowInputs?: boolean;
}

/** 四態 +「被夾限」：狀態機在這裡是視覺語彙的來源，不只是 class 名稱。 */
type RowState = "idle" | "draft" | "sent" | "late" | "ok" | "rejected" | "clamped";

const GREEN_MS = 1200; // 綠勾淡出
const EPS = 1e-6;

function numOf(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  return null;
}

function fmtVal(v: number | null, t: Tunable): string {
  if (v === null) return "—";
  if (t.kind === "bool") return v >= 0.5 ? "ON" : "OFF";
  return String(parseFloat(v.toPrecision(8)));
}

export function TuneTable({ log = liveLog, allowInputs }: Props) {
  // 送出後的每一個轉場都是時間驅動的（300 ms 轉橘、1 s 轉紅、1.2 s 綠勾淡出），
  // 沒有這個心跳，畫面會停在「送出的那一瞬間」不動。
  useTick(250);
  useSyncExternalStore(setLedger.subscribe, setLedger.getVersion, setLedger.getVersion);
  useSyncExternalStore(log.subscribe, log.getVersion, log.getVersion);

  const [draft, setDraft] = useState<Record<string, string>>({});
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const [q, setQ] = useState("");

  const groups = useMemo(() => {
    const needle = q.trim().toUpperCase();
    return TUNE_GROUPS.map((g) => ({
      name: g,
      items: TUNABLES.filter((t) => t.group === g && (!needle || t.name.includes(needle))),
    })).filter((g) => g.items.length > 0);
  }, [q]);

  const now = Date.now();

  const rowOf = (t: Tunable) => {
    const tk = tuneKey(t.name);
    const pk = paramKey(t.name);
    const tuneV = numOf(log.latest.get(tk));
    const paramV = numOf(log.latest.get(pk));
    const rec = setLedger.lastFor(t.name);
    const pendMs = client.pendingSince(t.name);
    const d = draft[t.name];

    // 送出的值剛好等於機器人已經有的值時，機器人**不會**有任何回推
    // （DashHub.put 值相同直接 return，而 hello 只在訂閱時送一次）。
    // 沒有這一行，「把 1965 再送一次」會永遠停在紅色的「未確認」——那是假警報。
    const echoed = tuneV !== null && paramV !== null && Math.abs(tuneV - paramV) <= EPS;

    let state: RowState = "idle";
    if (d !== undefined) state = "draft";
    else if (pendMs !== null && !echoed) state = pendMs > FGC.echoFailMs ? "late" : "sent";
    else if (rec && !rec.ok) state = "rejected";
    else if (rec && rec.ok && now - rec.at < GREEN_MS) state = "ok";
    else if (!echoed && tuneV !== null && paramV !== null) state = "clamped";

    return { t, tk, pk, tuneV, paramV, rec, pendMs, d, state };
  };

  const commit = (t: Tunable, raw: string) => {
    const v = parseFloat(raw);
    setDraft((s) => {
      const n = { ...s };
      delete n[t.name];
      return n;
    });
    if (!Number.isFinite(v)) return;

    // **打字的值不做靜默夾限。** 前端把 4000 夾成 3000 再送出去，畫面上會顯示
    // 「回讀 3000 ✓」——那正是這張雙欄表存在要對付的「默默吃掉你的值」。
    // 機器人端的 MIN[]/MAX[] 由機器人自己回答，err 進帳本，使用者才看得到真相。
    //
    // 唯一的例外是 G13 的幾何上限（uiMax 嚴於機器人的 MAX[]）：那是規則不是偏好，
    // 前端不提供越過它的路徑。但擋下來要有回饋，所以照樣進帳本。
    if (t.uiMax !== undefined && v > uiMaxOf(t)) {
      setLedger.pushLocal({
        at: Date.now(),
        key: tuneKey(t.name),
        name: t.name,
        from: null,
        to: v,
        ok: false,
        why: "超過前端幾何上限 " + uiMaxOf(t) + "（G13" + (t.uiMaxWhy ? "：" + t.uiMaxWhy : "") + "）",
        echoMs: null,
      });
      return;
    }
    client.set(tuneKey(t.name), v);
  };

  const drag = (t: Tunable, raw: string) => {
    setDraft((s) => ({ ...s, [t.name]: raw }));
    const v = parseFloat(raw);
    if (Number.isFinite(v)) client.setThrottled(tuneKey(t.name), clampTune(t, v));
  };

  const dirty = TUNABLES.filter((t) => {
    const tv = numOf(log.latest.get(tuneKey(t.name)));
    const pv = numOf(log.latest.get(paramKey(t.name)));
    return tv !== null && pv !== null && Math.abs(tv - pv) > EPS;
  }).length;

  return (
    <PanelShell
      title="參數雙欄（21 項白名單）"
      note={allowInputs ? "左欄送出 /FGC/Tune/* · 右欄回讀 /FGC/Param/*" : "非 PIT：唯讀"}
      tools={
        allowInputs ? (
          <input
            className="tt-search"
            placeholder="搜尋 /"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            title="依名稱過濾"
          />
        ) : (
          <span className="ro-value">{dirty} 項左右不一致</span>
        )
      }
      flush
    >
      <div className="tt">
        {groups.map((g) => {
          const open = !closed[g.name];
          return (
            <section key={g.name} className="tt-group">
              <button
                className="tt-ghead"
                onClick={() => setClosed((s) => ({ ...s, [g.name]: open }))}
                title="收合這一組"
              >
                <span className="caret">{open ? "▾" : "▸"}</span>
                {g.name}
                <span className="cnt">{g.items.length}</span>
              </button>

              {open && (
                <table className="fgc-table tt-table">
                  <tbody>
                    {g.items.map((t) => {
                      const r = rowOf(t);
                      const shownLeft =
                        r.d !== undefined ? r.d : r.tuneV === null ? "" : String(parseFloat(r.tuneV.toPrecision(8)));
                      const uiMax = uiMaxOf(t);
                      return (
                        <Fragment key={t.name}>
                          <tr className={"tt-row " + r.state}>
                            <td className="nm">
                              <span className="mark">{r.state === "draft" ? "*" : r.state === "clamped" ? "!" : ""}</span>
                              {t.name}
                            </td>

                            <td className="in">
                              {!allowInputs ? (
                                <span className="ro-value">{fmtVal(r.tuneV, t)}</span>
                              ) : t.kind === "bool" ? (
                                <button
                                  className={r.tuneV !== null && r.tuneV >= 0.5 ? "sig-bool on" : "sig-bool"}
                                  onClick={() => client.set(r.tk, !(r.tuneV !== null && r.tuneV >= 0.5))}
                                >
                                  {r.tuneV !== null && r.tuneV >= 0.5 ? "ON" : "OFF"}
                                </button>
                              ) : (
                                <input
                                  className={r.state === "draft" ? "sig-input editing" : "sig-input"}
                                  type="number"
                                  step={t.step}
                                  min={t.min}
                                  max={uiMax}
                                  value={shownLeft}
                                  onChange={(e) => setDraft((s) => ({ ...s, [t.name]: e.target.value }))}
                                  onBlur={(e) => r.d !== undefined && commit(t, e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") commit(t, (e.target as HTMLInputElement).value);
                                    if (e.key === "Escape")
                                      setDraft((s) => {
                                        const n = { ...s };
                                        delete n[t.name];
                                        return n;
                                      });
                                  }}
                                />
                              )}
                            </td>

                            <td className="arrow">→</td>
                            <td className="rb">{fmtVal(r.paramV, t)}</td>
                            <td className="unit">{t.unit}</td>
                            <td className="st" title={r.rec?.why || ""}>
                              {r.state === "ok" && <span className="ok">✓ {r.rec?.echoMs != null ? r.rec.echoMs + "ms" : ""}</span>}
                              {r.state === "rejected" && <span className="err">✗ 被拒</span>}
                              {r.state === "sent" && <span className="warn">◌ 送出</span>}
                              {r.state === "late" && <span className="err">◌ 未確認</span>}
                              {r.state === "draft" && <span className="warn">草稿</span>}
                              {r.state === "clamped" && <span className="warn">被夾限</span>}
                            </td>
                          </tr>

                          {allowInputs && t.kind === "num" && (
                            <tr className="tt-slider">
                              <td />
                              <td colSpan={5}>
                                <span className="lo">{t.min}</span>
                                <input
                                  type="range"
                                  min={t.min}
                                  max={uiMax}
                                  step={t.step}
                                  value={r.d !== undefined ? r.d : (r.tuneV ?? t.def)}
                                  onChange={(e) => drag(t, e.target.value)}
                                  onMouseUp={(e) => commit(t, (e.target as HTMLInputElement).value)}
                                  onKeyUp={(e) => commit(t, (e.target as HTMLInputElement).value)}
                                />
                                <span className="hi" title={t.uiMaxWhy ?? "機器人端 MAX[]"}>
                                  {uiMax}
                                  {t.uiMax !== undefined ? "*" : ""}
                                </span>
                              </td>
                            </tr>
                          )}

                          {r.state === "rejected" && r.rec && (
                            <tr className="tt-why">
                              <td />
                              <td colSpan={5}>err: “{r.rec.why}”</td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </section>
          );
        })}

        {allowInputs && (
          <div className="tt-foot">
            滑桿上限標 * 者是幾何上限（G13），比機器人端 MAX[] 更嚴：
            {TUNABLES.filter((t) => t.uiMax !== undefined)
              .map((t) => ` ${t.name} ≤ ${uiMaxOf(t)}`)
              .join(" ·")}
            （{TUNABLES.find((t) => t.uiMaxWhy)?.uiMaxWhy ?? ""}）
          </div>
        )}
      </div>
    </PanelShell>
  );
}
