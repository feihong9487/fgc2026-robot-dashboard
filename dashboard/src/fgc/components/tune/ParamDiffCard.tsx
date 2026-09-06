// ParamDiffCard（§3.3 #26）：目前值 vs 編譯值 + 三顆保住成果的鍵。
//
// 這是防止「白調一天」的唯一機制。21 個參數都是 public static volatile，只活在
// RAM 裡：Restart Robot、換電池、重新 Build 全都會讓它們回到 Constants.java 裡的
// 編譯值，而畫面上不會有任何提示。所以要嘛把值存回機器人的 fgc-tune.json
// （下次開機自動載回），要嘛把 Constants 片段貼回原始碼——兩條路都在這張卡上。
//
// 片段不由前端組：機器人端 DashParams.snippet() 已經把它組好放在
// /FGC/Param/_Snippet，前端只負責複製字串。少一份「格式要跟 Java 一致」的責任。
//
// 剪貼簿的 http fallback 一定要抄（FTC CustomVariable.tsx:79-87）：Control Hub
// 是 http，navigator.clipboard 在非安全來源是 undefined，只走一層必然失敗。

import { useState } from "react";
import { PanelShell } from "../shell/PanelShell";
import { LogStore, liveLog } from "../../lib/LogStore";
import { K, TUNABLES, buildParamKey, paramKey, tuneKey, type Tunable } from "../../lib/fgcKeys";
import { PATHS, httpUrl } from "../../lib/profile";
import { useLink, useLogVersion } from "../../lib/hooks";
import { copyText } from "../graph/Inspector";

interface Props {
  log?: LogStore;
  allowInputs?: boolean;
}

const EPS = 1e-6;

function numOf(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  return null;
}

function show(v: number | null, t: Tunable): string {
  if (v === null) return "—";
  if (t.kind === "bool") return v >= 0.5 ? "ON" : "OFF";
  return String(parseFloat(v.toPrecision(8)));
}

export function ParamDiffCard({ log = liveLog, allowInputs }: Props) {
  useLogVersion(log);
  const link = useLink();
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");

  const rows = TUNABLES.map((t) => {
    const cur = numOf(log.latest.get(paramKey(t.name)));
    const build = numOf(log.latest.get(buildParamKey(t.name)));
    const sent = numOf(log.latest.get(tuneKey(t.name)));
    return {
      t,
      cur,
      build,
      // 「送出了但沒套用」與「跟編譯值不同」是兩件事，圖示要分得開
      applied: cur !== null && sent !== null && Math.abs(cur - sent) <= EPS,
      diff: cur !== null && build !== null && Math.abs(cur - build) > EPS,
    };
  });
  const changed = rows.filter((r) => r.diff);
  const noBuild = rows.every((r) => r.build === null);

  const snippet = log.latestStr(K.snippet, "");
  const saved = log.latestStr(K.saved, "");

  const flash = (s: string) => {
    setMsg(s);
    window.setTimeout(() => setMsg(""), 2500);
  };

  const cmd = async (k: "_save" | "_load", label: string) => {
    if (!link.host) return flash("尚未連線，指令未送出");
    setBusy(k);
    try {
      const res = await fetch(httpUrl(link.host, PATHS.set, { k }), { cache: "no-store" });
      const txt = await res.text();
      let why = "";
      try {
        const j = JSON.parse(txt) as { ok?: boolean; why?: string };
        why = j.why ?? "";
        flash(j.ok ? label + "成功" + (why ? "：" + why : "") : label + "失敗：" + (why || res.status));
      } catch {
        flash(res.ok ? label + "成功" : label + "失敗：HTTP " + res.status);
      }
    } catch (e) {
      flash(label + "失敗：" + String(e).slice(0, 80));
    } finally {
      setBusy("");
    }
  };

  const doCopy = async () => {
    if (!snippet) return flash("機器人尚未發布 /FGC/Param/_Snippet");
    const ok = await copyText(snippet);
    flash(ok ? "已複製 Constants 片段（" + snippet.split("\n").length + " 行）" : "複製失敗：請手動選取下方文字");
  };

  return (
    <PanelShell
      title="目前值 vs 編譯值"
      note={
        noBuild
          ? "機器人未發布 /FGC/Param/Build <NAME>"
          : changed.length === 0
            ? "21 項與編譯值一致"
            : changed.length + " 項不同（Restart Robot 就會回到編譯值）"
      }
    >
      <div className="pd">
        {noBuild ? (
          <div className="pd-empty">
            這一台機器人沒有發布 <code>/FGC/Param/Build &lt;NAME&gt;</code>（DashParams.publishBuild）。
            沒有編譯值就沒有辦法判斷「調完的東西會不會在重開後消失」——請確認機器人端是新版。
          </div>
        ) : changed.length === 0 ? (
          <div className="pd-ok">● 目前值與編譯值全數一致，重開機不會掉任何東西。</div>
        ) : (
          <table className="fgc-table pd-table">
            <tbody>
              {changed.map((r) => (
                <tr key={r.t.name}>
                  <td className="nm">{r.t.name}</td>
                  <td className="num build">{show(r.build, r.t)}</td>
                  <td className="ar">→</td>
                  <td className="num cur">{show(r.cur, r.t)}</td>
                  <td className="unit">{r.t.unit}</td>
                  <td className="st">{r.applied ? "" : "✗ 尚未套用"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {allowInputs ? (
          <div className="pd-btns">
            <button className="tb-btn" onClick={doCopy} title="直接複製 /FGC/Param/_Snippet（機器人端已組好）">
              複製 Constants 片段
            </button>
            <button
              className="tb-btn"
              disabled={busy === "_save"}
              onClick={() => cmd("_save", "存到機器人")}
              title="GET /dash/set?k=_save → 寫進 /sdcard/FIRST/fgc-tune.json，下次開機自動載回"
            >
              存到機器人 fgc-tune.json
            </button>
            <button
              className="tb-btn"
              disabled={busy === "_load"}
              onClick={() => cmd("_load", "從機器人讀回")}
              title="GET /dash/set?k=_load"
            >
              從機器人讀回
            </button>
          </div>
        ) : (
          <div className="pd-ro ro-value">非 PIT：不提供任何寫入路徑</div>
        )}

        <div className="pd-foot">
          {saved ? "_Saved " + saved : "尚未存過 fgc-tune.json"}
          {msg && <span className="pd-msg">{msg}</span>}
        </div>

        {allowInputs && snippet && (
          <details className="pd-snip">
            <summary>片段預覽（{snippet.split("\n").length} 行）</summary>
            <pre>{snippet}</pre>
          </details>
        )}
      </div>
    </PanelShell>
  );
}
