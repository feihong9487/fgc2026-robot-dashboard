// CamPane（§3.3 #27）：相機三態 —— 串流 / 單張輪詢 / **暫停（預設）**。
//
// 為什麼預設是暫停：MJPEG 是這整套儀表板裡唯一會回頭影響機器人 loop 時間的東西
// （DashMjpeg 每一格都要編碼 JPEG，而 loop p95 > 25 ms 就是驗收線）。把代價
// 「開串流後 loop p95 +N ms · 視覺 fps −N%」直接印在按鈕旁邊，是為了讓「要不要
// 開」這個決定跟它的後果出現在同一個視野裡，而不是等到比賽時才發現機器人變頓。
//
// 三重閘（PIT 且 分頁可見 且 在視窗內）不成立時 src="" **真斷連**，不是
// display:none——隱藏起來的 <img> 照樣在收 chunked multipart。
//
// 機器人端併發上限已經是 1（DashMjpeg.java）：第二處開串流會拿到 503，
// 這裡要顯示「已被另一個串流佔用」而不是無限轉圈。

import { useEffect, useMemo, useRef, useState } from "react";
import { PanelShell } from "../shell/PanelShell";
import { LogStore, liveLog } from "../../lib/LogStore";
import { K, paramKey } from "../../lib/fgcKeys";
import { PATHS, httpUrl } from "../../lib/profile";
import { percentile } from "../../lib/stats";
import { useAppMode, useLink, useLogKeys } from "../../lib/hooks";

interface Props {
  log?: LogStore;
  allowInputs?: boolean;
}

type CamMode = "off" | "stream" | "snap";

/** 代價量測視窗：太短會被單一長尾騙，太長會反應不過來。 */
const COST_WIN_S = 10;
const COST_MS = 1000;

/** 只訂閱相機相關的少數幾個 key：整份 log 的 20 Hz 廣播不該把 <img> 的容器叫醒。 */
const CAM_KEYS = [
  "/CameraPublisher/C270/streams",
  K.camClients,
  K.camFrameKB,
  K.camLastError,
  K.visionFps,
] as const;

/**
 * 從 /CameraPublisher/C270/streams 取串流網址（真機 DashBoot.java:64 的做法）。
 * 值長成 ["mjpg:http://192.168.43.1:8080/dash/stream.mjpg"]。
 *
 * 機器人回報的位址可能是它自己看到的 IP（或假伺服器的 127.0.0.1），而我們連的是
 * link.host，兩者不一致時以 link.host 為準——否則志工改名之後這條路就斷了。
 */
function streamUrlFrom(log: LogStore, host: string, fps: number, q: number): { url: string; from: string } {
  const raw = log.latest.get("/CameraPublisher/C270/streams");
  let path: string = PATHS.stream;
  let from = "profile";
  const first = Array.isArray(raw) ? raw[0] : typeof raw === "string" ? raw : "";
  if (first) {
    const s = first.replace(/^mjpg:/i, "");
    try {
      const u = new URL(s);
      path = u.pathname;
      from = "CameraPublisher";
    } catch {
      /* 網址壞掉就退回 profile 的寫死路徑 */
    }
  }
  return { url: httpUrl(host, path, { fps, q }), from };
}

function fmtKB(v: number): string {
  return Number.isFinite(v) ? v.toFixed(0) + " KB" : "— KB";
}

export function CamPane({ log = liveLog, allowInputs }: Props) {
  const mode = useAppMode();
  const link = useLink();
  useLogKeys(CAM_KEYS, log);
  const [cam, setCam] = useState<CamMode>("off");
  const [visible, setVisible] = useState(() => document.visibilityState === "visible");
  const [inView, setInView] = useState(false);
  const [err, setErr] = useState("");
  const [snapTs, setSnapTs] = useState(0);
  const [cost, setCost] = useState<{ dLoop: number; dFps: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<{ p95: number; fps: number } | null>(null);

  // 閘一：分頁可見
  useEffect(() => {
    const on = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);

  // 閘二：捲進視窗
  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver((es) => setInView(es.some((e) => e.isIntersecting)), { threshold: 0.05 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // 閘三：PIT。三個都成立才算 live——任何一個不成立就 src=""
  const live = cam !== "off" && visible && inView && mode === "PIT" && !!link.host;

  const fps = Math.round(log.valueAt(paramKey("MJPEG_FPS"), log.tMax) ?? 10);
  const q = Math.round(log.valueAt(paramKey("MJPEG_Q"), log.tMax) ?? 40);
  const { url, from } = useMemo(
    () => streamUrlFrom(log, link.host || "127.0.0.1", fps, q),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [log, link.host, fps, q, log.getVersion()],
  );

  // 代價：暫停時持續採基線，開啟時算差值。兩個數字都來自機器人自己回報的量測，
  // 不是估算——「+6 ms」這種話只有在它是量出來的時候才有資格印在按鈕旁邊。
  useEffect(() => {
    const t = window.setInterval(() => {
      const tMax = log.tMax;
      const v = log.valuesInWindow(K.loopMs, tMax - COST_WIN_S, tMax);
      const p95 = percentile(v, 0.95);
      const vf = log.latestNum(K.visionFps, NaN);
      if (!live) {
        if (Number.isFinite(p95)) baseRef.current = { p95, fps: vf };
        setCost(null);
      } else if (baseRef.current && Number.isFinite(p95)) {
        setCost({
          dLoop: p95 - baseRef.current.p95,
          dFps:
            Number.isFinite(vf) && Number.isFinite(baseRef.current.fps) && baseRef.current.fps > 0
              ? ((vf - baseRef.current.fps) / baseRef.current.fps) * 100
              : NaN,
        });
      }
    }, COST_MS);
    return () => window.clearInterval(t);
  }, [log, live]);

  // 單張輪詢：只有這一種模式需要自己敲節奏，串流是機器人推的
  useEffect(() => {
    if (cam !== "snap" || !live) return;
    const period = Math.max(200, Math.round(1000 / Math.max(1, Math.min(10, fps))));
    const t = window.setInterval(() => setSnapTs(Date.now()), period);
    return () => window.clearInterval(t);
  }, [cam, live, fps]);

  const src = !live
    ? ""
    : cam === "stream"
      ? url
      : httpUrl(link.host, PATHS.snapshot, { q, t: snapTs });

  const gateWhy = !allowInputs
    ? "非 PIT：相機不可用"
    : cam === "off"
      ? "暫停中 · 省 CPU"
      : !visible
        ? "分頁不可見 → 已斷連"
        : !inView
          ? "捲出視窗 → 已斷連"
          : !link.host
            ? "尚未連線"
            : "";

  return (
    <PanelShell
      title="相機"
      note={cam === "stream" ? "來源 " + from + " · fps " + fps + " · q " + q : "併發上限 1"}
      tools={
        allowInputs ? (
          <>
            <button className={cam === "stream" ? "tb-btn on" : "tb-btn"} onClick={() => { setErr(""); setCam("stream"); }}>
              ▶ 開串流
            </button>
            <button className={cam === "snap" ? "tb-btn on" : "tb-btn"} onClick={() => { setErr(""); setCam("snap"); }}>
              單張
            </button>
            <button className={cam === "off" ? "tb-btn on" : "tb-btn"} onClick={() => { setErr(""); setCam("off"); }}>
              ◉ 暫停
            </button>
          </>
        ) : undefined
      }
      flush
      className="cam-shell"
    >
      <div className="cam" ref={boxRef}>
        <div className="cam-view">
          {src ? (
            <img
              src={src}
              alt="相機"
              onError={() => {
                // MJPEG 併發上限 1：第二處要看的時候機器人直接回 503。
                // 這裡停下來並說明原因，不做自動重試——重試只會變成敲門風暴。
                setErr("已被另一個串流佔用（併發上限 1），或串流不可用");
                setCam("off");
              }}
            />
          ) : (
            <div className="cam-off">
              <div className="big">{gateWhy || "已斷連"}</div>
              {allowInputs && cam === "off" && (
                <div className="hint">
                  開串流預估：loop p95{" "}
                  {baseRef.current && Number.isFinite(baseRef.current.p95)
                    ? "目前 " + baseRef.current.p95.toFixed(1) + " ms"
                    : "尚無基線"}
                  {" · 視覺 fps "}
                  {baseRef.current && Number.isFinite(baseRef.current.fps) ? baseRef.current.fps.toFixed(0) : "—"}
                </div>
              )}
              {err && <div className="cam-err">{err}</div>}
            </div>
          )}
        </div>

        <div className="cam-cost">
          {live && cost ? (
            <>
              <span className={cost.dLoop > 3 ? "err" : cost.dLoop > 1 ? "warn" : "ok"}>
                loop p95 {cost.dLoop >= 0 ? "+" : ""}
                {cost.dLoop.toFixed(1)} ms
              </span>
              <span className={Number.isFinite(cost.dFps) && cost.dFps < -10 ? "warn" : ""}>
                視覺 fps {Number.isFinite(cost.dFps) ? (cost.dFps >= 0 ? "+" : "") + cost.dFps.toFixed(0) + "%" : "—"}
              </span>
              <span className="sub">
                相機 clients {log.latestNum(K.camClients, 0)} · frame {fmtKB(log.latestNum(K.camFrameKB, NaN))}
              </span>
            </>
          ) : (
            <span className="sub">
              基線量測中（最近 {COST_WIN_S} s 的 /FGC/Status/Loop ms）
              {log.latestStr(K.camLastError, "") ? " · 相機錯誤：" + log.latestStr(K.camLastError, "") : ""}
            </span>
          )}
        </div>
      </div>
    </PanelShell>
  );
}
