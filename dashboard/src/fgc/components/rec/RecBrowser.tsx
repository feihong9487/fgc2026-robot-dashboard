// #30 RecBrowser：GET /dash/rec.json 取清單，點一列拉 /dash/rec.jsonl?name=<檔名> 進 REPLAY。
//
// 三件不可退讓的事：
//
// 1. **?name=live 一律不呼叫。** 那條路徑回的是這一場記憶體 ring 的全部遙測
//    （DashHttp.java RecFile 的 "live" 分支），等同一條繞過「MATCH 不推播」的
//    即時資料旁路。機器人端現在已經給 RecFile 補上 pit() 閘，但前端這一層仍然
//    自律——防線不能只有一層，而且 MATCH 期間任何指向機器人的請求本身就不該發。
//
// 2. **一定要指定 name。** 不給 name 會拿到「最新的檔案」，而 INIT 會開新檔，
//    所以賽後直接拉「最新」拿到的是剛剛那支 OpMode 開的空檔，不是上一場比賽
//    （DashExport.java:25 把這個坑寫在註解裡）。這裡點哪一列就送哪一個 name。
//
// 3. **兩條取檔路徑都要在 UI 上。** Day 1 若 8080 註冊失敗第一條路就沒了，
//    而賽場上不會有時間翻文件。備援是 OnBotJava 的檔案樹 /sdcard/FIRST/fgc-rec。
//
// 載入走 ReadableStream + TextDecoder 逐行（jsonl.ts），不一次 split("\n")：
// 2 MB 的檔案一次切成陣列會在低階筆電上卡住主執行緒好幾百毫秒。

import { useCallback, useEffect, useRef, useState } from "react";
import { Glyph } from "../shell/Glyph";
import { client } from "../../../lib/RobotClient";
import { PATHS, REC_FILE_LABEL, httpBase, httpPort, httpUrl, recFileUrl } from "../../lib/profile";
import { useAppMode } from "../../lib/hooks";
import { parseRecList, robotAcceptsName, fmtSize, fmtTime, type RecFileRow, type RecList } from "./recList";

export { parseRecList, robotAcceptsName } from "./recList";
export type { RecFileRow, RecList } from "./recList";

type ListState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; list: RecList }
  /** MATCH 的 503 不是錯誤，是規則。文案必須講「賽後怎麼拿」而不是「連線失敗」。 */
  | { kind: "locked" }
  | { kind: "disabled" }
  | { kind: "error"; why: string };

export function RecBrowser({ host }: { host: string }) {
  const mode = useAppMode();
  const [state, setState] = useState<ListState>({ kind: "idle" });
  const [busy, setBusy] = useState<string>("");
  const [got, setGot] = useState(0);
  const [loadErr, setLoadErr] = useState("");
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const res = await fetch(httpUrl(host, PATHS.recList), { cache: "no-store" });
      if (!alive.current) return;
      if (res.status === 503) return setState({ kind: "locked" });
      if (res.status === 404) return setState({ kind: "disabled" });
      if (!res.ok) return setState({ kind: "error", why: `HTTP ${res.status}` });
      setState({ kind: "ok", list: parseRecList(await res.json()) });
    } catch (e) {
      if (alive.current) setState({ kind: "error", why: String(e) });
    }
  }, [host]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * 點一列 → streaming 解析成一個獨立的 LogStore 實例 → 整個 App 走 REPLAY 路由。
   * 進度條靠 TransformStream 數位元組，不需要改 RobotClient。
   */
  const load = useCallback(
    async (row: RecFileRow) => {
      if (row.name === "live") {
        setLoadErr("拒絕：?name=live 是即時遙測旁路，不是錄影檔");
        return;
      }
      if (!robotAcceptsName(row.name)) {
        setLoadErr(
          `機器人端不接受這個檔名：DashRec.safeName 只收 rec-*.jsonl，但清單列的是所有 *.jsonl，` +
            `所以「${row.name}」看得到卻拉不下來（會回 400）。請改走備援路徑：OnBotJava 檔案樹 /sdcard/FIRST/fgc-rec`,
        );
        return;
      }
      setBusy(row.name);
      setGot(0);
      setLoadErr("");
      try {
        const res = await fetch(recFileUrl(host, row.name), { cache: "no-store" });
        if (res.status === 503) throw new Error("503：比賽模式，錄影端點已關閉");
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        // 進度條每 256 KB 才更新一次。fetch 的 chunk 通常是 16–64 KB，一份 20 MB
        // 的錄影檔就是上千次 setState，而每一次都是一輪 React 重繪——那等於用進度條
        // 去拖慢自己正在量的那件事。
        let n = 0;
        let shown = 0;
        const STEP = 256 * 1024;
        const counted = res.body.pipeThrough(
          new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, ctrl) {
              n += chunk.byteLength;
              if (n - shown >= STEP) {
                shown = n;
                setGot(n);
              }
              ctrl.enqueue(chunk);
            },
            flush() {
              setGot(n);
            },
          }),
        );
        const ok = await client.startReplay(counted, row.name);
        if (!ok) throw new Error("檔案裡沒有可用的批次（每行要是 {\"t\":秒,\"d\":{…}}）");
        // 成功時 App 會整頁換成 REPLAY，這裡不必再做事
      } catch (e) {
        if (alive.current) setLoadErr(String(e));
      } finally {
        if (alive.current) setBusy("");
      }
    },
    [host],
  );

  return (
    <div className="rec">
      <div className="rec-head">
        <span className="rec-title">機器人上的錄影檔</span>
        <span className="spacer" />
        {mode === "PIT" && (
          <button className="hw-btn" onClick={() => void refresh()} disabled={state.kind === "loading"}>
            重新整理
          </button>
        )}
      </div>

      {state.kind === "loading" && <div className="rec-msg">讀取清單中…</div>}

      {state.kind === "locked" && (
        <div className="rec-msg warn">
          <b>比賽模式：錄影端點已關閉（503）。</b>
          <br />
          這不是故障，是規則。<code>rec.json</code> 與 <code>rec.jsonl</code> 兩條一起關，堵住{" "}
          <code>?name=live</code> 這條即時旁路。
          <br />
          賽後取檔：Driver Hub 跑 <b>Z-DASH-EXPORT</b>（開總開關 + 切 PIT + 螢幕列出最新 6 個檔名）或{" "}
          <b>B1-PIT</b>，再回到這一頁。
        </div>
      )}

      {state.kind === "disabled" && (
        <div className="rec-msg warn">
          <b>404：橋接已停用（Z-DASH-OFF 生效中）。</b>
          <br />
          Driver Hub 跑一次 <b>Z-DASH-ON</b>，或改走下面的備援路徑。
        </div>
      )}

      {state.kind === "error" && (
        <div className="rec-msg err">
          清單讀不到：{state.why}
          <br />
          連不上時第一個要問的是：Control Hub 是不是改名了、或改成 5 GHz 了。
        </div>
      )}

      {state.kind === "ok" && (
        <>
          <div className="rec-dir">
            <span className="pair">
              <span className="k">目錄</span>
              <code>{state.list.dir || "—"}</code>
            </span>
            <span className="pair">
              <span className="k">正在寫的檔</span>
              <code>{state.list.current || "沒有"}</code>
            </span>
            <span className="pair">
              <span className="k">檔案數</span>
              <code>{state.list.files.length}</code>
            </span>
          </div>
          {state.list.error && <div className="rec-msg err">機器人端回報：{state.list.error}</div>}
          {state.list.files.length === 0 ? (
            <div className="rec-msg">
              這台機器人上還沒有錄影檔。跑一次 B1-PIT，頂欄的錄影行數開始動之後就會有。
            </div>
          ) : (
            <table className="rec-table">
              <thead>
                <tr>
                  <th>檔名</th>
                  <th className="num">大小</th>
                  <th className="num">修改時間</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {state.list.files.map((f) => {
                  const isCurrent = f.name === state.list.current;
                  const loading = busy === f.name;
                  const pullable = robotAcceptsName(f.name);
                  return (
                    <tr key={f.name} className={isCurrent ? "current" : undefined}>
                      <td className="name">
                        <code>{f.name}</code>
                        {isCurrent && (
                          <span className="tag" title="這一支 OpMode 正在寫的檔；INIT 會開新檔，所以「最新」不等於「上一場」">
                            錄影中
                          </span>
                        )}
                        {!pullable && (
                          <span
                            className="tag bad"
                            title="機器人端 safeName 只收 rec-*.jsonl，這個檔名拉不下來（會回 400）；請走備援路徑"
                          >
                            <Glyph tone="err" />
                            8080 拉不下來
                          </span>
                        )}
                      </td>
                      <td className="num">{fmtSize(f.size)}</td>
                      <td className="num">{fmtTime(f.mtime)}</td>
                      <td className="act">
                        {mode === "PIT" ? (
                          <button className="rec-load" disabled={!!busy || !pullable} onClick={() => void load(f)}>
                            {loading ? `載入中 ${fmtSize(got)}${f.size ? ` / ${fmtSize(f.size)}` : ""}` : "載入回放"}
                          </button>
                        ) : (
                          <span className="ro">唯讀</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </>
      )}

      {loadErr && <div className="rec-msg err">載入失敗：{loadErr}</div>}

      <div className="rec-paths">
        <div className="rec-path">
          <span className="n">{httpPort()}</span>
          <code>
            GET {httpBase(host)}
            {PATHS.recList}
          </code>
          <span className="why">再 <code>{REC_FILE_LABEL}?name=&lt;檔名&gt;</code>。就是這一頁在做的事</span>
        </div>
        <div className="rec-path">
          <span className="n">備援</span>
          <code>/sdcard/FIRST/fgc-rec</code>
          <span className="why">
            OnBotJava 的檔案樹直接下載。Day 1 若 8080 註冊失敗，第一條路就沒了——賽場上不會有時間翻文件
          </span>
        </div>
        <div className="rec-path">
          <span className="n">不呼叫</span>
          <code>?name=live</code>
          <span className="why">
            它回的是這一場記憶體 ring 的全部遙測，等同一條繞過「MATCH 不推播」的即時資料旁路
          </span>
        </div>
      </div>
    </div>
  );
}
