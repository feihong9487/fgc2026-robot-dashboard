// #37 關閉路徑三格的判定（純函式；畫的部分在 ShutdownStrip.tsx）。
//
// 核心主張：**判定依據是可觀測狀態，不是「我按了某個按鈕」。**
// ENABLED 常數摺疊那個坑證明了「我以為關了」與「真的關了」是兩件事，
// 所以這三格全部從外部現象反推，沒有任何一格是靠前端自己記得的旗標。
//
//   · 未連筆電          8080 與 8081 都沒有回應 → 這台筆電現在對機器人沒有任何路徑
//   · Z-DASH-OFF 生效    GET /dash/health 回 404（DashBridge.java:143-149，薄殼對所有
//                       註冊路徑回 404 "dash disabled"）。這一格同時是 8080 連通性燈，
//                       不必再寫第二個輪詢
//   · Z-FALLBACK-v2      這一格沒有直接證據可用：FGC2026_TeleOp_v2 完全不碰 DashHub
//                       （它的存在理由就是「不吃儀表板」），所以它不會回報自己。
//                       能觀測到的是「橋接活著（health 200、enabled=1）但沒有人在推
//                       遙測、錄影行數也停了」。任何不吃儀表板的 OpMode（含根本沒有
//                       OpMode 在跑）都會落在這一格，UI 必須把這個歧義寫出來而不是
//                       假裝自己知道跑的是哪一支。
//
// 三格都可能是「不知道」（active = null）。把不知道畫成「沒生效」是這個元件唯一
// 會造成實害的錯誤——它會讓人以為關閉路徑失敗而去做第二次、更粗暴的關閉。

import { PATHS } from "../../lib/profile";
import type { HealthState } from "../../lib/health";
import { REC_WINDOW_S, type RecTrend } from "./checks";

export interface ShutdownCell {
  id: string;
  name: string;
  /** 這條關閉路徑目前是否生效。null = 判斷不出來（樣本不足或缺證據）。 */
  active: boolean | null;
  /** 判定依據：一定要寫出來，這是這個元件的全部價值。 */
  basis: string;
  /** 怎麼觸發它。 */
  how: string;
}

export interface ShutdownCtx {
  health: HealthState | null;
  /** 最後一批遙測的年齡（ms）；-1 = 從未收到。 */
  wsAgeMs: number;
  recTrend: RecTrend;
}

export function buildShutdown(ctx: ShutdownCtx): ShutdownCell[] {
  const h = ctx.health;
  const hOk = h?.kind === "ok" ? h.info : null;
  const hDisabled = h?.kind === "disabled";
  const hDead = !h || h.kind === "error";
  const wsDead = ctx.wsAgeMs < 0 || ctx.wsAgeMs > 5000;

  const t = ctx.recTrend;
  const trendKnown = Number.isFinite(t.delta) && t.windowS >= REC_WINDOW_S - 5;
  const recStopped = trendKnown && t.delta <= 0;

  return [
    {
      id: "unplugged",
      name: "未連筆電",
      active: hDead && wsDead,
      basis: `8080 ${hDead ? "無回應" : hDisabled ? "404" : "200"} · 8081 ${wsDead ? "無資料" : "推播中"}`,
      how: "拔掉 Wi-Fi 或關掉這個分頁，0 秒生效",
    },
    {
      id: "dashoff",
      name: "Z-DASH-OFF 已生效",
      active: !!hDisabled,
      basis: hDisabled
        ? `GET ${PATHS.health} 回 404`
        : hOk
          ? `GET ${PATHS.health} 回 200（enabled=${hOk.enabled ? 1 : 0}）`
          : `GET ${PATHS.health} 無回應：分不出停用還是斷線`,
      how: "Driver Hub 跑一次 Z-DASH-OFF；恢復跑 Z-DASH-ON",
    },
    {
      id: "fallback",
      name: "Z-FALLBACK-v2 執行中",
      active: hOk && hOk.enabled ? (trendKnown ? wsDead && recStopped : null) : false,
      basis: !hOk
        ? "8080 沒通，判斷不出來"
        : !trendKnown
          ? `觀察中 ${t.windowS.toFixed(0)}/${REC_WINDOW_S} s`
          : wsDead && recStopped
            ? "橋接活著但遙測與錄影都停了"
            : "遙測仍在推播",
      how: "Driver Hub 選 Z-FALLBACK-v2（它完全不碰 DashHub，所以不會回報自己）",
    },
  ];
}
