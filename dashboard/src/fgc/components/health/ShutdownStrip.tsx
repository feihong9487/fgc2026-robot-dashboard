// #37 關閉路徑三格（清單底部一列）—— 只負責畫；判定在 shutdown.ts 的純函式。
//
// 沒有 (1)(2)(3) 編號：這三格是三種**並列**的關閉方式，不是三個步驟。
// 編號只在內容真的是序列時才帶資訊，否則它只是在暗示一個不存在的順序。

import { buildShutdown, type ShutdownCtx } from "./shutdown";
import { GLYPHS, GLYPH_IDLE } from "../../lib/tone";

export type { ShutdownCell, ShutdownCtx } from "./shutdown";
export { buildShutdown } from "./shutdown";

// ■ = 這條關閉路徑正在生效；□ = 沒生效；○ = 判斷不出來（不是「沒生效」）
const GLYPH_ACTIVE = GLYPHS.err;
const GLYPH_UNKNOWN = GLYPHS.stale;

export function ShutdownStrip({ ctx }: { ctx: ShutdownCtx }) {
  const cells = buildShutdown(ctx);
  return (
    <div className="hw-shutdown">
      <div className="hw-shutdown-label">
        關閉路徑
        <span className="sub">判定依據是可觀測狀態，不是「我按了某個按鈕」</span>
      </div>
      {cells.map((c) => (
        <div key={c.id} className={`hw-sd-cell${c.active ? " on" : ""}${c.active === null ? " unknown" : ""}`}>
          <div className="row1">
            <span className="box">{c.active ? GLYPH_ACTIVE : c.active === null ? GLYPH_UNKNOWN : GLYPH_IDLE}</span>
            <span className="name">{c.name}</span>
          </div>
          <div className="basis">{c.basis}</div>
          <div className="how">{c.how}</div>
        </div>
      ))}
    </div>
  );
}
