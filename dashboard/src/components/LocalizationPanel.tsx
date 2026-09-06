// 定位分頁 — WallPoseCorrector 階段 1(heading)+ 階段 2(position)。
// 機器人端一律先算出「若套用會修正多少」；是否真的寫回 odometry 由 Apply 開關
// 決定，預設關閉。打開後 GetPoseHeading()/GetPoseX()/GetPoseY() 直接餵給
// ContinuousMove 的航向保持與 cross-track 回授——這會真的改變機器人怎麼開，
// 不只是改地圖估計。務必先在 Apply=off 時看過殘差穩定收在 0 附近再打開。
import { useEffect, useState } from "react";
import { store } from "../lib/store";
import { client } from "../lib/RobotClient";
import { LOC_K } from "../lib/keys";
import { Toggle, Led, Collapse } from "./controls";

function useStore() {
  const [, force] = useState(0);
  useEffect(() => store.subscribe(() => force((n) => n + 1)), []);
}

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="run-mech-row">
      <span>{label}</span>
      <span className="run-mech-val">{value}</span>
    </div>
  );
}

function FlagRow({ label, on, warn }: { label: string; on: boolean; warn?: boolean }) {
  return <Led on={on} label={label} color={warn ? (on ? "warn" : "ok") : "accent"} />;
}

export function LocalizationPanel() {
  useStore();
  const offline = store.connState === "disconnected" || store.connState === "connecting";

  const enable = store.bool(LOC_K.enable, true);
  const apply = store.bool(LOC_K.apply, false);

  const rawHeading = store.num(LOC_K.rawHeading, 0);
  const bias = store.num(LOC_K.bias, 0);
  const correctedHeading = store.num(LOC_K.correctedHeading, 0);
  const headingResidual = store.num(LOC_K.headingResidual, 0);
  const headingAccepted = store.bool(LOC_K.headingAccepted, false);
  const headingDisagree = store.bool(LOC_K.headingDisagree, false);
  const headingGated = store.bool(LOC_K.headingGated, false);
  const headingNUsed = store.num(LOC_K.headingNUsed, 0);
  const headingStreak = store.num(LOC_K.headingStreak, 0);

  const xObserved = store.bool(LOC_K.xObserved, false);
  const yObserved = store.bool(LOC_K.yObserved, false);
  const xAccepted = store.bool(LOC_K.xAccepted, false);
  const yAccepted = store.bool(LOC_K.yAccepted, false);
  const xResidual = store.num(LOC_K.xResidual, 0);
  const yResidual = store.num(LOC_K.yResidual, 0);
  const xNudge = store.num(LOC_K.xNudge, 0);
  const yNudge = store.num(LOC_K.yNudge, 0);
  const xNExcluded = store.num(LOC_K.xNExcluded, 0);
  const yNExcluded = store.num(LOC_K.yNExcluded, 0);
  const xDisagree = store.bool(LOC_K.xDisagree, false);
  const yDisagree = store.bool(LOC_K.yDisagree, false);
  const xGated = store.bool(LOC_K.xGated, false);
  const yGated = store.bool(LOC_K.yGated, false);
  const xStreak = store.num(LOC_K.xStreak, 0);
  const yStreak = store.num(LOC_K.yStreak, 0);
  const skippedSkew = store.num(LOC_K.skippedSkew, 0);

  const rawX = store.num(LOC_K.rawX, 0);
  const rawY = store.num(LOC_K.rawY, 0);
  const previewX = store.num(LOC_K.previewX, 0);
  const previewY = store.num(LOC_K.previewY, 0);

  if (offline) {
    return (
      <div className="cam-placeholder">
        未連線。連上機器人後，此頁顯示牆面錨定定位（階段 1 heading + 階段 2
        position）的即時殘差與採用狀態，並可用 Apply 開關決定是否真的寫回
        odometry（預設關閉）。
      </div>
    );
  }

  return (
    <div>
      <Collapse title="總開關">
        <Toggle label="Enable（計算修正量）" on={enable} onChange={(v) => client.set(LOC_K.enable, v)} />
        <div className="lv-hint">
          先在這裡確認符號與收斂行為正確——把機器人擺著不動或原地慢慢自轉，殘差應
          收在 0 附近、不會單調發散；若殘差穩定在誤差的兩倍附近，通常代表 heading
          符號反了。確認無誤後才考慮打開下面的 Apply。
        </div>

        <div
          style={{
            marginTop: 10,
            padding: 10,
            border: `1px solid ${apply ? "#e57373" : "#2e3950"}`,
            borderRadius: 6,
            background: apply ? "rgba(229, 115, 115, 0.08)" : "transparent",
          }}
        >
          <Toggle
            label={apply ? "⚠ Apply（正在寫回 odometry，會改變機器人怎麼開）" : "Apply（寫回 odometry）"}
            on={apply}
            onChange={(v) => client.set(LOC_K.apply, v)}
          />
          <div className="lv-hint">
            打開後：heading bias 每拍持續套用進航向保持回授；position nudge 於每次
            採用時一次性疊加進 cross-track 回授。關閉時（含此開關與上面 Enable 一起
            關閉）機器人端會把 heading bias 立即歸零，保證「關閉」= 零行為影響。
          </div>
        </div>
      </Collapse>

      <Collapse title="階段 1：Heading（牆面錨定航向修正）">
        <Row label="原始 heading（陀螺儀）" value={`${rawHeading.toFixed(2)}°`} />
        <Row label="累積 bias" value={`${bias.toFixed(2)}°`} />
        <Row label="修正後 heading" value={`${correctedHeading.toFixed(2)}°`} />
        <Row label="本幀殘差" value={`${headingResidual.toFixed(2)}°`} />
        <Row label="連續採用幀數" value={headingStreak.toFixed(0)} />
        <Row label="本幀用了幾面牆" value={headingNUsed.toFixed(0)} />
        <div className="run-mech-row" style={{ gap: 12 }}>
          <FlagRow label="Accepted" on={headingAccepted} />
          <FlagRow label="Disagree" on={headingDisagree} warn />
          <FlagRow label="Gated" on={headingGated} warn />
        </div>
      </Collapse>

      <Collapse title="階段 2：Position（牆面錨定位置修正）">
        <div className="run-mech-row" style={{ gap: 24, alignItems: "flex-start" }}>
          <div style={{ flex: 1 }}>
            <div className="run-block-title">X 軸</div>
            <Row label="殘差" value={`${xResidual.toFixed(2)} cm`} />
            <Row label={apply ? "Nudge（已套用）" : "Nudge（未套用）"} value={`${xNudge.toFixed(2)} cm`} />
            <Row label="排除（貼牆物件）" value={xNExcluded.toFixed(0)} />
            <Row label="連續採用幀數" value={xStreak.toFixed(0)} />
            <FlagRow label="Observed" on={xObserved} />
            <FlagRow label="Accepted" on={xAccepted} />
            <FlagRow label="Disagree" on={xDisagree} warn />
            <FlagRow label="Gated" on={xGated} warn />
          </div>
          <div style={{ flex: 1 }}>
            <div className="run-block-title">Y 軸</div>
            <Row label="殘差" value={`${yResidual.toFixed(2)} cm`} />
            <Row label={apply ? "Nudge（已套用）" : "Nudge（未套用）"} value={`${yNudge.toFixed(2)} cm`} />
            <Row label="排除（貼牆物件）" value={yNExcluded.toFixed(0)} />
            <Row label="連續採用幀數" value={yStreak.toFixed(0)} />
            <FlagRow label="Observed" on={yObserved} />
            <FlagRow label="Accepted" on={yAccepted} />
            <FlagRow label="Disagree" on={yDisagree} warn />
            <FlagRow label="Gated" on={yGated} warn />
          </div>
        </div>
        <Row label="方向過斜被丟棄（判不出哪面牆）" value={skippedSkew.toFixed(0)} />
      </Collapse>

      <Collapse title={apply ? "位姿對照：raw odometry vs. 修正後（已套用）" : "位姿對照：raw odometry vs. 修正預覽（未套用）"}>
        <Row label="Raw (x, y)" value={`(${rawX.toFixed(1)}, ${rawY.toFixed(1)}) cm`} />
        <Row
          label={apply ? "修正後（已寫回，下一輪 Raw 會等於這裡）" : "Preview（若套用）"}
          value={`(${previewX.toFixed(1)}, ${previewY.toFixed(1)}) cm`}
        />
        <Row
          label="差距"
          value={`(${(previewX - rawX).toFixed(2)}, ${(previewY - rawY).toFixed(2)}) cm`}
        />
      </Collapse>
    </div>
  );
}
