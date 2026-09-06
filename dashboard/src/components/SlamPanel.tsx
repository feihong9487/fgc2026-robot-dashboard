// 定位建圖分頁 — 把「建圖」與「定位」看到的同一件事合在一張圖上：左邊場地圖疊
// 即時 occupancy grid + 機器人（三角形車身、內圓為光達），右邊只留場地座標與清圖鍵。
//
// 為什麼右邊這麼空：這頁是上場/巡場時看的，要能一眼判斷「地圖有沒有畫歪、機器人
// 在不在它以為的位置」。調機用的殘差/gate/streak 遙測不在這裡，在「定位診斷」分頁；
// 建圖的 Enable/靜態層等切換收在下面的折疊區，平常不必展開。
import { useEffect, useState } from "react";
import { store } from "../lib/store";
import { client } from "../lib/RobotClient";
import { MAP_K, SIM_K } from "../lib/keys";
import { FieldView } from "./FieldView";
import { Toggle, Collapse } from "./controls";

function useStore() {
  const [, force] = useState(0);
  useEffect(() => store.subscribe(() => force((n) => n + 1)), []);
}

const LEGEND: [string, string][] = [
  ["rgba(229, 115, 115, 0.6)", "障礙 OCCUPIED"],
  ["rgba(79, 195, 247, 0.10)", "空 FREE"],
  ["transparent", "未知 UNKNOWN"],
];

export function SlamPanel() {
  useStore();
  const offline = store.connState === "disconnected" || store.connState === "connecting";

  const enable = store.bool(MAP_K.enable, true);
  const staticLayer = store.bool(MAP_K.staticLayer, false);
  const occupied = store.num(MAP_K.occupied, 0);
  const scans = store.num(MAP_K.scans, 0);

  // 整合閘門：移動中不累積掃描。狀態放在主區塊（不收進折疊區）——地圖「停住不長」
  // 是操作時第一眼會嚇到的現象，必須當場看得到原因是「閘門擋著」而不是「壞了」。
  const gateEnable = store.bool(MAP_K.gateEnable, true);
  const gated = store.bool(MAP_K.gated, false);
  const gateReason = store.str(MAP_K.gateReason, "—");
  const skippedScans = store.num(MAP_K.skippedScans, 0);
  const speckleFilter = store.bool(MAP_K.speckleFilter, true);
  const speckleRemoved = store.num(MAP_K.speckleRemoved, 0);
  // 移動中建圖：deskew 逐射線對齊位姿；sweepSpan 是它修掉的誤差量的直接讀數。
  const deskew = store.bool(MAP_K.deskew, true);
  const sweepSpan = store.num(MAP_K.sweepSpan, 0);
  const sweepPoints = store.num(MAP_K.sweepPoints, 0);

  // 位姿取 SIM_K（公尺）：這是 MappingSubsystem 每拍與 grid 一起發的同一份 odometry，
  // 左邊 FieldView 也是讀它。若改讀 LOC_K/TD_K（公分）會與畫面上的機器人不同步。
  // 場地座標慣例是公分（FieldMap.h），所以這裡 ×100 再顯示。
  const xCm = store.num(SIM_K.poseX, 0) * 100;
  const yCm = store.num(SIM_K.poseY, 0) * 100;
  const headingDeg = store.num(SIM_K.poseTheta, 0);

  // 直接測距定位：X = −d270、Y = d0，就這樣。與上面的 odometry 並排顯示而不是取代
  // 它——兩個數字擺在一起才看得出漂移多少，只留一個就沒有對照組了。
  const dirD0 = store.num(MAP_K.dirD0, 0);
  const dirD90 = store.num(MAP_K.dirD90, 0);
  const dirD180 = store.num(MAP_K.dirD180, 0);
  const dirD270 = store.num(MAP_K.dirD270, 0);
  const dirX = store.num(MAP_K.dirX, 0);
  const dirY = store.num(MAP_K.dirY, 0);
  // 0 = 該角度無回波。距離本身不可能是 0，所以拿它當「沒資料」的哨兵是安全的。
  const fmtDist = (d: number) => (d > 0 ? `${d.toFixed(1)} cm` : "無回波");

  if (offline) {
    return (
      <div className="cam-placeholder">
        未連線。連上機器人後，此頁左側即時顯示 Occupancy grid 建圖疊在場地圖上
        （紅=障礙、淡藍=空、透明=未知），機器人以三角形表示、內圓為光達；右側顯示
        機器人在場地中的座標與清圖鍵。
      </div>
    );
  }

  return (
    <>
      <div className="run-left">
        <div className="field-wrap field-wrap-fit">
          <FieldView />
        </div>
      </div>

      <div className="run-side">
        <div className="run-block">
          <div className="run-block-title">場地座標</div>
          <div className="run-mech-row">
            <span>X（沿長邊，原點右下角，左為負）</span>
            <span className="run-mech-val">{xCm.toFixed(1)} cm</span>
          </div>
          <div className="run-mech-row">
            <span>Y（沿短邊，上為正）</span>
            <span className="run-mech-val">{yCm.toFixed(1)} cm</span>
          </div>
          {/* 0° = 車頭朝 +y、順時針為正（FieldMap.h），不是常見的「0°=+x、逆時針」 */}
          <div className="run-mech-row">
            <span>朝向（0° = 車頭朝 +Y）</span>
            <span className="run-mech-val">{headingDeg.toFixed(1)}°</span>
          </div>

          <div className="run-mech-row">
            <span>建圖狀態</span>
            <span className="run-mech-val" style={{ color: gated ? "#ffb74d" : "#81c784" }}>
              {!gateEnable ? "累積中（閘門關閉）" : gated ? `暫停 · ${gateReason}` : "累積中"}
            </span>
          </div>
        </div>

        <div className="run-block">
          <div className="run-block-title">光達直接測距定位</div>
          <div className="lv-hint">
            不做牆面擬合，單一角度的距離讀數直接就是座標：<b>X = −d270、Y = d0</b>。
          </div>
          <div className="run-mech-row">
            <span>X（= −270°）</span>
            <span className="run-mech-val">{dirD270 > 0 ? `${dirX.toFixed(1)} cm` : "—"}</span>
          </div>
          <div className="run-mech-row">
            <span>Y（= 0°）</span>
            <span className="run-mech-val">{dirD0 > 0 ? `${dirY.toFixed(1)} cm` : "—"}</span>
          </div>

          <div className="run-block-title" style={{ marginTop: 10 }}>原始距離讀數</div>
          {/* 刻意不在標籤上寫死「哪個角度被中柱擋住」：現場說法與實測讀數目前對不上，
              寫死等於把一個未確認的結論當成事實掛在畫面上。讓讀數自己講。 */}
          <div className="run-mech-row">
            <span>前 0°</span>
            <span className="run-mech-val">{fmtDist(dirD0)}</span>
          </div>
          <div className="run-mech-row">
            <span>90°</span>
            <span className="run-mech-val">{fmtDist(dirD90)}</span>
          </div>
          <div className="run-mech-row">
            <span>180°</span>
            <span className="run-mech-val">{fmtDist(dirD180)}</span>
          </div>
          <div className="run-mech-row">
            <span>270°</span>
            <span className="run-mech-val">{fmtDist(dirD270)}</span>
          </div>
          <div className="lv-hint">
            單一射線沒有多點平均，噪聲直接進到座標；讀到的是<b>沿射線</b>的距離，
            只有車身與牆平行時才等於垂距（偏 10° 約多算 1.5%）。也分不出打到的是牆
            還是障礙物——所以請在乾淨的牆角量。
          </div>

          <button
            className="btn accent"
            style={{ marginTop: 10, width: "100%" }}
            onClick={() => client.set(MAP_K.reset, true)}
          >
            重置地圖（清圖 + 錨定出發區）
          </button>
          <div className="lv-hint">
            重置會一併把 odometry 錨回右下角出發區，所以按之前要先把機器人實際擺回去。
          </div>
        </div>

        <Collapse title="進階（建圖控制與圖例）" defaultOpen={false}>
          <Toggle
            label="累積掃描 Enable"
            on={enable}
            onChange={(v) => client.set(MAP_K.enable, v)}
          />
          <Toggle
            label="靜態層（真賽場才開）"
            on={staticLayer}
            onChange={(v) => client.set(MAP_K.staticLayer, v)}
          />
          <div className="run-mech-row">
            <span>OCCUPIED 格</span>
            <span className="run-mech-val">{occupied.toFixed(0)}</span>
          </div>
          <div className="run-mech-row">
            <span>已累積掃描</span>
            <span className="run-mech-val">{scans.toFixed(0)}</span>
          </div>
          <Toggle
            label="移動中不建圖（stop-and-scan）"
            on={gateEnable}
            onChange={(v) => client.set(MAP_K.gateEnable, v)}
          />
          <div className="run-mech-row">
            <span>已丟棄掃描（移動中）</span>
            <span className="run-mech-val">{skippedScans.toFixed(0)}</span>
          </div>
          <Toggle
            label="逐射線對齊位姿（deskew）"
            on={deskew}
            onChange={(v) => client.set(MAP_K.deskew, v)}
          />
          <div className="run-mech-row">
            <span>本圈 heading 掃掠</span>
            <span className="run-mech-val">{sweepSpan.toFixed(1)}°</span>
          </div>
          <div className="run-mech-row">
            <span>本圈有效點數</span>
            <span className="run-mech-val">{sweepPoints.toFixed(0)}</span>
          </div>
          <Toggle
            label="孤點濾波"
            on={speckleFilter}
            onChange={(v) => client.set(MAP_K.speckleFilter, v)}
          />
          <div className="run-mech-row">
            <span>本次濾掉孤點</span>
            <span className="run-mech-val">{speckleRemoved.toFixed(0)}</span>
          </div>
          <div className="lv-hint">
            <b>要在移動中建圖：</b>deskew 開著、把「移動中不建圖」關掉。一圈掃描要 83ms，
            車在這段時間裡會動，deskew 讓每條射線各用**自己採集當下**的位姿反投影；
            沒有它的話旋轉最傷（90°/s → 一圈轉 7.5°，2m 遠就偏 26cm ＝ 13 格），
            同一面牆每圈落在不同位置，聯集起來就是「東西被畫得比實際大」。
            「本圈 heading 掃掠」是 deskew 修掉多少誤差的直接讀數：靜止 ≈0°（此時它本來
            就沒事做），原地轉時最大。
          </div>
          <div className="lv-hint">
            兩個開關都可以單獨關掉做 A/B 對照——**同一個場景各跑一次**，比較牆的厚度。
            deskew 消掉的是「一圈之內」的位姿誤差，消不掉 odometry 自己的漂移；移動中
            建圖的品質上限因此就是 odometry 的品質，漂移要靠「定位」分頁那條線處理。
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
            {LEGEND.map(([c, l]) => (
              <span key={l} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span
                  style={{
                    width: 14,
                    height: 14,
                    background: c,
                    border: "1px solid #2e3950",
                    display: "inline-block",
                  }}
                />
                {l}
              </span>
            ))}
          </div>
          <div className="lv-hint">
            機器人畫成三角形，對上實體三顆全向輪（前二後一）：兩個前輪連成的**平邊**
            就是車頭（heading 0° = 車頭朝 +Y），尖端是單一後輪、指向車尾。三角形內的
            圓是光達，圓內短線畫的是它的**有效掃描 0°**，與車頭同向。光達雖是反裝的，
            但 X4Lidar.cpp 的 kMountOffsetDeg 已經把那 180° 吃掉一次，到 LidarFrame 那層
            0° 就是車頭方向 —— SLAM 用的就是這個有效朝向。
          </div>
          <div className="lv-hint">
            用法：擺好機器人 → 重置地圖 → 原地或慢慢自轉 → 看紅格是否落在真實牆／物體
            位置（可對照「光達」分頁的原始點雲）。自轉時地圖若歪掉／變兩層，先跑
            tools/mathtest/build.ps1 frames：那組測試鎖住 heading 慣例（0° = 車頭朝 +y、
            順時針為正），它綠的話問題就在 odometry 漂移或光達安裝角，不是座標慣例。
            殘差、gate、連續採用幀數等調機遙測在「定位診斷」分頁。
          </div>
        </Collapse>
      </div>
    </>
  );
}
