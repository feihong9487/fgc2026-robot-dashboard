// 常數表編輯器 — 整個 HMI 的核心。
// 「Dashboard 是編輯器，檔案是真相」：本面板編輯的是本地草稿，
// 「套用」推到 NT、「儲存到機器人」才落地 deploy/constants.json（不自動存檔）、
// 「VERIFY」讀回檔案實際內容並與草稿逐欄比對 —— 填錯一個對應三趟全錯，核對必做。
import { useEffect, useRef, useState } from "react";
import { store, NtValue } from "../lib/store";
import { client } from "../lib/RobotClient";
import {
  Constants, defaultConstants, flattenConstants, unflattenConstants,
  diffConstants,
  CONST_CTRL, CONST_PREFIX, LIVE_KEY_MAP,
  BOX_COLORS, BOX_COLOR_LABELS, BALL_PAIRS, BALL_PAIR_LABELS, SHELVES, SHELF_LABELS,
  Hsv,
} from "../lib/constantsSchema";
import {
  LabeledNum, Ring, PoseCluster, ArrayCtl, MatrixCtl, PathBox, Collapse,
} from "./controls";

const HSV_COLS = ["hLo", "hHi", "sLo", "sHi", "vLo", "vHi"] as const;

// 具名 profile：練習場與賽場的場地座標/任務對應不同，賽前套錯檔比沒存檔更危險。
// 每個 profile 的草稿各自存 localStorage，切換時先存後載。
export const PROFILES = ["practice", "match-day"] as const;
const PROFILE_LABELS = ["練習場", "賽場 match-day"];
const LS_PROFILE = "vmx-dashboard.constants.profile";
const profileKey = (p: string) => `vmx-dashboard.constants.${p}`;

function loadProfileName(): string {
  const p = localStorage.getItem(LS_PROFILE);
  return PROFILES.some((x) => x === p) ? (p as string) : "practice";
}

function loadProfileDraft(profile: string): Constants {
  try {
    const raw = localStorage.getItem(profileKey(profile));
    if (raw) return unflattenConstants(jsonToMap(JSON.parse(raw)), defaultConstants());
  } catch {
    /* 壞檔退回預設 */
  }
  return defaultConstants();
}

// 草稿存活於模組層級：切換分頁（元件卸載）不會遺失未儲存的編輯
let draftCache: Constants | null = null;

function useStore() {
  const [, force] = useState(0);
  useEffect(() => store.subscribe(() => force((n) => n + 1)), []);
}

/** 巢狀 JSON → NT 路徑 Map（VERIFY 讀回與檔案匯入共用） */
function jsonToMap(obj: unknown): Map<string, NtValue> {
  const map = new Map<string, NtValue>();
  const walk = (v: unknown, path: string) => {
    if (typeof v === "number" || typeof v === "string") map.set(path, v);
    else if (Array.isArray(v)) v.forEach((item, i) => walk(item, `${path}/${i}`));
    else if (v && typeof v === "object")
      for (const [k, sub] of Object.entries(v)) walk(sub, `${path}/${k}`);
  };
  walk(obj, CONST_PREFIX);
  return map;
}

function download(filename: string, text: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function ConstantsPanel() {
  useStore();
  const [profile, setProfile] = useState(loadProfileName);
  const [draft, setDraftState] = useState<Constants>(
    () => draftCache ?? loadProfileDraft(loadProfileName()),
  );
  const [verifyOpen, setVerifyOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const setDraft = (c: Constants) => {
    draftCache = c;
    setDraftState(c);
    localStorage.setItem(profileKey(profile), JSON.stringify(c));
  };

  const switchProfile = (p: string) => {
    localStorage.setItem(profileKey(profile), JSON.stringify(draft)); // 先存目前
    localStorage.setItem(LS_PROFILE, p);
    setProfile(p);
    draftCache = loadProfileDraft(p);
    setDraftState(draftCache);
  };

  const edit = (fn: (c: Constants) => void) => {
    const next: Constants = JSON.parse(JSON.stringify(draft));
    fn(next);
    setDraft(next);
  };

  // 與機器人 NT 值的差異數（草稿尚未套用的欄位）
  const flatDraft = flattenConstants(draft);
  let unsynced = 0;
  for (const [k, v] of Object.entries(flatDraft)) {
    const rv = store.latest.get(k);
    const eq = typeof v === "number" && typeof rv === "number"
      ? Math.abs(v - rv) < 1e-9
      : v === rv;
    if (!eq) unsynced++;
  }

  const connected = store.connState === "connected" || store.connState === "sim";
  const status = String(store.latest.get(CONST_CTRL.status) ?? "");
  const verifyJson = String(store.latest.get(CONST_CTRL.verifyJson) ?? "");

  // VERIFY 讀回內容 → 與草稿逐欄比對
  let verifyDiffs: string[] | null = null;
  let fileConstants: Constants | null = null;
  if (verifyJson) {
    try {
      fileConstants = unflattenConstants(jsonToMap(JSON.parse(verifyJson)), defaultConstants());
      verifyDiffs = diffConstants(draft, fileConstants);
    } catch {
      verifyDiffs = null;
    }
  }

  const pull = () => setDraft(unflattenConstants(store.latest, draft));
  const push = () => {
    for (const [k, v] of Object.entries(flatDraft)) client.set(k, v);
    // 底盤 PID / S-curve 同步寫入既有 Chassis live entry，調參即時生效
    for (const [get, liveKey] of LIVE_KEY_MAP) client.set(liveKey, get(draft));
  };
  const save = () => {
    push();
    client.set(CONST_CTRL.save, true);
  };
  const verify = () => {
    client.set(CONST_CTRL.verify, true);
    setVerifyOpen(true);
  };

  const importFile = (f: File) => {
    f.text().then((text) => {
      try {
        setDraft(unflattenConstants(jsonToMap(JSON.parse(text)), defaultConstants()));
      } catch {
        alert("JSON 格式錯誤（需為 deploy/constants.json 格式）");
      }
    });
  };

  return (
    <div className="constants-panel">
      {/* 工具列：檔案真相路徑 + 動作按鈕 */}
      <div className="const-toolbar">
        <Ring
          value={profile}
          options={PROFILES}
          optionLabels={PROFILE_LABELS}
          onCommit={switchProfile}
        />
        <PathBox value="VMX-pi:/home/lvuser/deploy/constants.json" readOnly />
        <button className="btn" onClick={pull} disabled={!connected} title="把機器人目前 NT 值讀進草稿">
          讀取
        </button>
        <button className="btn" onClick={push} disabled={!connected} title="把草稿全部推到 NT（不寫檔）">
          套用 {unsynced > 0 && `(${unsynced})`}
        </button>
        <button className="btn btn-save" onClick={save} disabled={!connected}>
          儲存到機器人
        </button>
        <button className="btn" onClick={verify} disabled={!connected}>
          VERIFY
        </button>
        <span className="spacer" />
        <button className="btn" onClick={() => download("constants.json", JSON.stringify(draft, null, 2))}>
          匯出
        </button>
        <button className="btn" onClick={() => fileRef.current?.click()}>
          匯入
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) importFile(f);
            e.target.value = "";
          }}
        />
      </div>
      {(status || unsynced > 0) && (
        <div className="const-status">
          {unsynced > 0 && (
            <span className="const-dirty">草稿有 {unsynced} 項尚未套用到機器人</span>
          )}
          {status && <span className="const-ok">{status}</span>}
        </div>
      )}

      <div className="const-grid">
        <Collapse title="任務對應（練習前公布 → 填入，填錯三趟全錯）">
          <div className="const-two-col">
            <div>
              <div className="lv-subhead">箱色 → 球色</div>
              {BOX_COLORS.map((c) => (
                <Ring
                  key={c}
                  label={BOX_COLOR_LABELS[c]}
                  value={draft.colorMap[c]}
                  options={BALL_PAIRS}
                  optionLabels={BALL_PAIR_LABELS}
                  onCommit={(v) => edit((d) => (d.colorMap[c] = v))}
                />
              ))}
            </div>
            <div>
              <div className="lv-subhead">箱色 → 櫃位</div>
              {BOX_COLORS.map((c) => (
                <Ring
                  key={c}
                  label={BOX_COLOR_LABELS[c]}
                  value={draft.shelfMap[c]}
                  options={SHELVES}
                  optionLabels={SHELF_LABELS}
                  onCommit={(v) => edit((d) => (d.shelfMap[c] = v))}
                />
              ))}
            </div>
          </div>
        </Collapse>

        <Collapse title="場地座標（m / °）">
          <PoseCluster
            label="理貨區"
            pose={draft.field.sortingZone}
            onCommit={(p) => edit((d) => (d.field.sortingZone = p))}
          />
          <PoseCluster
            label="倉儲櫃"
            pose={draft.field.shelfPose}
            onCommit={(p) => edit((d) => (d.field.shelfPose = p))}
          />
          <PoseCluster
            label="取球區"
            pose={draft.field.ballZone}
            onCommit={(p) => edit((d) => (d.field.ballZone = p))}
          />
          <div className="lv-hint">
            取球只存「機器人站位」：取完一顆球其餘 11 顆會滾動移位，
            逐球座標由視覺每次重新定位，不進常數表。
          </div>
        </Collapse>

        <Collapse title="Z 軸（升降）">
          <div className="const-two-col">
            <div>
              <div className="lv-subhead">取箱高度 cm（依趟次）</div>
              {(["trip1", "trip2", "trip3"] as const).map((t, i) => (
                <LabeledNum
                  key={t}
                  label={`趟 ${i + 1}`}
                  value={draft.lift.pickHeights[t]}
                  onCommit={(v) => edit((d) => (d.lift.pickHeights[t] = v))}
                  unit="cm"
                />
              ))}
              <div className="lv-subhead">放置高度 cm（依櫃位）</div>
              {SHELVES.map((s, i) => (
                <LabeledNum
                  key={s}
                  label={SHELF_LABELS[i].split(" ")[0]}
                  value={draft.lift.placeHeights[s]}
                  onCommit={(v) => edit((d) => (d.lift.placeHeights[s] = v))}
                  unit="cm"
                />
              ))}
            </div>
            <div>
              <div className="lv-subhead">位置環（ProfiledPID）</div>
              <LabeledNum label="ticks/cm" value={draft.lift.ticksPerCm} step={0.01}
                onCommit={(v) => edit((d) => (d.lift.ticksPerCm = v))} />
              <LabeledNum label="kP" value={draft.lift.kP} step={0.001}
                onCommit={(v) => edit((d) => (d.lift.kP = v))} />
              <LabeledNum label="kI" value={draft.lift.kI} step={0.001}
                onCommit={(v) => edit((d) => (d.lift.kI = v))} />
              <LabeledNum label="kD" value={draft.lift.kD} step={0.001}
                onCommit={(v) => edit((d) => (d.lift.kD = v))} />
              <LabeledNum label="maxVel" value={draft.lift.maxVel} step={10}
                onCommit={(v) => edit((d) => (d.lift.maxVel = v))} />
              <LabeledNum label="maxAccel" value={draft.lift.maxAccel} step={10}
                onCommit={(v) => edit((d) => (d.lift.maxAccel = v))} />
            </div>
          </div>
        </Collapse>

        <Collapse title="底盤">
          <div className="const-two-col">
            <div>
              <div className="lv-subhead">幾何 / 編碼器</div>
              <LabeledNum label="輪半徑" value={draft.drive.wheelRadiusMm} step={0.1}
                onCommit={(v) => edit((d) => (d.drive.wheelRadiusMm = v))} unit="mm" />
              <LabeledNum label="底盤半徑" value={draft.drive.baseRadiusMm} step={0.1}
                onCommit={(v) => edit((d) => (d.drive.baseRadiusMm = v))} unit="mm" />
              <LabeledNum label="ticks/圈" value={draft.drive.ticksPerRev} step={1}
                onCommit={(v) => edit((d) => (d.drive.ticksPerRev = v))} />
            </div>
            <div>
              <div className="lv-subhead">速度環 / 航向環（套用後即時生效）</div>
              <LabeledNum label="kP" value={draft.drive.kP} step={0.001}
                onCommit={(v) => edit((d) => (d.drive.kP = v))} />
              <LabeledNum label="kI" value={draft.drive.kI} step={0.001}
                onCommit={(v) => edit((d) => (d.drive.kI = v))} />
              <LabeledNum label="kD" value={draft.drive.kD} step={0.0001}
                onCommit={(v) => edit((d) => (d.drive.kD = v))} />
              <LabeledNum label="kF" value={draft.drive.kF} step={0.001}
                onCommit={(v) => edit((d) => (d.drive.kF = v))} />
              <LabeledNum label="航向 kP" value={draft.drive.headingKp} step={0.01}
                onCommit={(v) => edit((d) => (d.drive.headingKp = v))} />
              <LabeledNum label="航向 kD" value={draft.drive.headingKd} step={0.01}
                onCommit={(v) => edit((d) => (d.drive.headingKd = v))} />
              <div className="lv-subhead">S-curve（套用後即時生效）</div>
              <LabeledNum label="vMax" value={draft.scurve.vMax} step={10}
                onCommit={(v) => edit((d) => (d.scurve.vMax = v))} />
              <LabeledNum label="aMax" value={draft.scurve.aMax} step={10}
                onCommit={(v) => edit((d) => (d.scurve.aMax = v))} />
              <LabeledNum label="jMax" value={draft.scurve.jMax} step={50}
                onCommit={(v) => edit((d) => (d.scurve.jMax = v))} />
            </div>
          </div>
          <div className="lv-hint">
            原 Demo「駕駛調參」分頁併入此處：改完按「套用」即時寫入
            /Shuffleboard/Chassis 生效，滿意後「儲存到機器人」落地檔案。
            S-curve 波形圖在「執行狀態」分頁觀察。
          </div>
        </Collapse>

        <Collapse title="黑線陣列">
          <ArrayCtl
            label="門檻 ×4"
            values={draft.lineSensor.thresholds}
            onCommit={(i, v) => edit((d) => (d.lineSensor.thresholds[i] = v))}
          />
          <LabeledNum
            label="感測器間距"
            value={draft.lineSensor.spacingMm}
            step={0.5}
            onCommit={(v) => edit((d) => (d.lineSensor.spacingMm = v))}
            unit="mm"
          />
          <div className="lv-hint">門檻建議用「初始化除錯」分頁的標定精靈自動取得，不要手填。</div>
        </Collapse>

        <Collapse title="視覺 HSV 門檻（箱色辨識）">
          <MatrixCtl
            rowLabels={BOX_COLORS.map((c) => BOX_COLOR_LABELS[c])}
            colLabels={HSV_COLS}
            values={(["hsvRed", "hsvBlue", "hsvBlack"] as const).map((k) =>
              HSV_COLS.map((col) => draft.vision[k][col]),
            )}
            onCommit={(r, c, v) =>
              edit((d) => {
                const key = (["hsvRed", "hsvBlue", "hsvBlack"] as const)[r];
                d.vision[key][HSV_COLS[c] as keyof Hsv] = v;
              })
            }
          />
        </Collapse>

        <Collapse title="VERIFY — 檔案讀回核對" defaultOpen={verifyOpen}>
          {!verifyJson ? (
            <div className="lv-hint">
              按上方「VERIFY」讓機器人讀回 constants.json 實際內容，於此逐欄核對。
              任務對應填錯一項，三趟全錯 —— 存檔後必做。
            </div>
          ) : (
            <>
              {verifyDiffs && verifyDiffs.length === 0 ? (
                <div className="status-row ok">✓ 檔案內容與草稿完全一致（{Object.keys(flatDraft).length} 欄）</div>
              ) : verifyDiffs ? (
                <>
                  <div className="status-row estop">✗ 與草稿有 {verifyDiffs.length} 項差異（草稿 → 檔案）</div>
                  <div className="const-diff-list">
                    {verifyDiffs.map((line) => (
                      <div key={line} className="const-diff">{line}</div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="status-row estop">讀回內容無法解析</div>
              )}
              <textarea className="const-verify-text" readOnly value={verifyJson} />
            </>
          )}
        </Collapse>
      </div>
    </div>
  );
}
