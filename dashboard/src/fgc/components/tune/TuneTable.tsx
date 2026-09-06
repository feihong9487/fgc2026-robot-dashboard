// TuneTable（§3.3 #24）：21 項白名單的雙欄四態。
//
// 為什麼一定要雙欄：從手指到機器人再回到眼睛這條鏈路上有三道會**默默吃掉你的值**
// 的關卡——白名單（DashParams.java:37-46）、範圍夾限（:58-76）、MATCH 拒絕
// （DashWs.java:44-47）。單欄 UI 會讓三道全部隱形，因為它們在畫面上長得一模一樣：
// 都是「數字沒變」。左欄是我送出去的（/FGC/Tune/*），右欄是機器人回讀的
// （/FGC/Param/*），兩欄不一致本身就是診斷。
//
// 版面是一本帳簿：左頁是你寫的，右頁是機器人讀回來的，中間一條裝訂線。
// 原本每一列尾巴各掛一個 →（21 個），連成一條純裝飾的垂直虛線；改成整張表共用
// 一條 1px 的裝訂線之後，「送出 vs 回讀」這層關係從逐列的裝飾升級成版面本身的
// 結構——而且 21 個字元的噪音一次消失。所以整份清單是**一張** table
// （組標題也是 tr），裝訂線才不會在每個組標題斷掉。
//
// 鐵律：樂觀更新只准套 /FGC/Tune/*，絕不可套 /FGC/Param/*（在 RobotClient.set 裡）。
// 右欄一旦被自己送出的值蓋掉，對帳就變成自欺。
//
// 非 PIT：整張表改成純文字（.ro-value），輸入元件**不存在**而不是 disabled。

import { Fragment, useMemo, useState, useSyncExternalStore, type CSSProperties } from "react";
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

const GREEN_MS = 1200; // ● 淡出
const EPS = 1e-6;

/**
 * 幾何上限（G13）那幾項的說明句，直接由白名單生成，不手寫第二份——
 * 白名單改了而說明句沒改，那句話就會開始說謊。
 */
const UI_MAX_NOTE = (() => {
  const byMax = new Map<number, string[]>();
  for (const t of TUNABLES) {
    if (t.uiMax === undefined) continue;
    const m = uiMaxOf(t);
    byMax.set(m, [...(byMax.get(m) ?? []), t.name]);
  }
  return [...byMax.entries()].map(([m, names]) => names.join("、") + " 最高 " + m).join("；");
})();

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

/**
 * 滑桿已填的比例。Chromium 沒有 ::-webkit-slider-runnable-track 的 progress
 * 偽元素，所以把比例當自訂屬性交給 CSS 畫一條硬邊的兩段軌
 * （兩個色停在同一個位置 = 一條刻度，不是漸層裝飾）。
 */
function fillPct(v: number, t: Tunable, uiMax: number): string {
  const lo = t.min;
  const hi = uiMax;
  if (!Number.isFinite(v) || !(hi > lo)) return "0%";
  return (Math.min(1, Math.max(0, (v - lo) / (hi - lo))) * 100).toFixed(1) + "%";
}

export function TuneTable({ log = liveLog, allowInputs }: Props) {
  // 送出後的每一個轉場都是時間驅動的（300 ms 轉橘、1 s 轉紅、1.2 s ● 淡出），
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
        // 說出實際送出的值，而不是只回一句「超出範圍」——後者要使用者自己回想剛才打了什麼。
        why:
          t.name +
          " 超過幾何上限。可接受 " +
          t.min +
          " 到 " +
          uiMaxOf(t) +
          "，送出的是 " +
          v +
          "。（G13" +
          (t.uiMaxWhy ? "：" + t.uiMaxWhy : "") +
          "）",
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
      // 說明句收在卡片底部。表頭已經標了兩頁各是什麼，這裡只講滑桿上限的 * 是什麼。
      note={
        allowInputs
          ? "上限標 * 的是幾何上限（G13），比機器人端 MAX[] 嚴：" + UI_MAX_NOTE + "。"
          : "非 PIT：整張表唯讀，沒有可寫的欄位。"
      }
      tools={
        allowInputs ? (
          <input
            className="tt-search"
            placeholder="搜尋"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            title="依名稱過濾"
          />
        ) : (
          <span className="ro-value">{dirty} 項左右不一致</span>
        )
      }
      flush
      // 邊框只表示可寫：全站唯一真的能改機器人參數的那張卡才有框。
      className={allowInputs ? "writable" : undefined}
    >
      <div className="tt">
        <table className="fgc-table tt-table">
          <colgroup>
            <col />
            <col className="c-in" />
            <col className="c-rb" />
            <col className="c-unit" />
            <col className="c-st" />
          </colgroup>
          <thead>
            <tr>
              <th colSpan={2}>
                送出 <span className="path">/FGC/Tune/*</span>
              </th>
              <th colSpan={3} className="bind">
                回讀 <span className="path">/FGC/Param/*</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              const open = !closed[g.name];
              return (
                <Fragment key={g.name}>
                  <tr className="tt-ghead">
                    <td colSpan={2}>
                      <button onClick={() => setClosed((s) => ({ ...s, [g.name]: open }))} title="收合這一組">
                        <span className="caret">{open ? "▾" : "▸"}</span>
                        {g.name}
                        <span className="cnt">{g.items.length}</span>
                      </button>
                    </td>
                    <td colSpan={3} className="bind" />
                  </tr>

                  {open &&
                    g.items.map((t) => {
                      const r = rowOf(t);
                      const shownLeft =
                        r.d !== undefined ? r.d : r.tuneV === null ? "" : String(parseFloat(r.tuneV.toPrecision(8)));
                      const uiMax = uiMaxOf(t);
                      const sliderV = r.d !== undefined ? r.d : (r.tuneV ?? t.def);
                      return (
                        <Fragment key={t.name}>
                          <tr className={"tt-row " + r.state}>
                            <td className="nm">{t.name}</td>

                            <td className="in">
                              {!allowInputs ? (
                                <span className="ro-value">{fmtVal(r.tuneV, t)}</span>
                              ) : t.kind === "bool" ? (
                                // 布林與其他 20 個欄位同源：一樣的凹槽底、一樣的框、一樣的等寬右對齊。
                                // 原本的綠底黑字讓它看起來像「被選中的分頁」而不是一個值。
                                <button
                                  className="tt-bool"
                                  onClick={() => client.set(r.tk, !(r.tuneV !== null && r.tuneV >= 0.5))}
                                  title="按一下切換 ON / OFF"
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

                            <td className="rb bind">{fmtVal(r.paramV, t)}</td>
                            <td className="unit">{t.unit}</td>
                            <td className="tt-st" title={r.rec?.why || ""}>
                              {r.state === "draft" && (
                                <span className="mk warn" title="編輯中，按 Enter 送出">
                                  *
                                </span>
                              )}
                              {r.state === "sent" && <span className="spin" title="已送出，等待回讀" />}
                              {r.state === "late" && (
                                <>
                                  <span className="spin bad" title="超過回讀時限" />
                                  <span className="err">未確認</span>
                                </>
                              )}
                              {r.state === "ok" && (
                                <span className="done">
                                  <span className="fgc-glyph ok">●</span>
                                  {r.rec?.echoMs != null ? r.rec.echoMs + " ms" : ""}
                                </span>
                              )}
                              {r.state === "rejected" && (
                                <>
                                  <span className="fgc-glyph err">■</span>
                                  <span className="err">被拒</span>
                                </>
                              )}
                              {r.state === "clamped" && (
                                <>
                                  <span className="fgc-glyph warn">▲</span>
                                  <span className="warn">被夾限</span>
                                </>
                              )}
                            </td>
                          </tr>

                          {allowInputs && t.kind === "num" && (
                            // 滑桿只佔左頁：它是輸入，輸入屬於「你寫的那一頁」。
                            // 原本橫貫整張表的全寬亮軌是整頁最強的視覺，但調參是打數字。
                            <tr className="tt-slider">
                              <td colSpan={2}>
                                <span className="lo">{t.min}</span>
                                <input
                                  type="range"
                                  min={t.min}
                                  max={uiMax}
                                  step={t.step}
                                  value={sliderV}
                                  style={{ "--fill": fillPct(Number(sliderV), t, uiMax) } as CSSProperties}
                                  onChange={(e) => drag(t, e.target.value)}
                                  onMouseUp={(e) => commit(t, (e.target as HTMLInputElement).value)}
                                  onKeyUp={(e) => commit(t, (e.target as HTMLInputElement).value)}
                                />
                                <span className="hi" title={t.uiMaxWhy ?? "機器人端 MAX[]"}>
                                  {uiMax}
                                  {t.uiMax !== undefined ? "*" : ""}
                                </span>
                              </td>
                              <td colSpan={3} className="bind" />
                            </tr>
                          )}

                          {r.state === "rejected" && r.rec && (
                            // 被拒的原因屬於右頁：那句話是機器人說的，不是你寫的。
                            <tr className="tt-why">
                              <td colSpan={2} />
                              <td colSpan={3} className="bind why">
                                {r.rec.why}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </PanelShell>
  );
}
