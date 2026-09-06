// #37 關閉路徑三格（燈牆底部一列）—— 只負責畫；判定在 shutdown.ts 的純函式。

import { buildShutdown, type ShutdownCtx } from "./shutdown";

export type { ShutdownCell, ShutdownCtx } from "./shutdown";
export { buildShutdown } from "./shutdown";

const GLYPH_ACTIVE = "■";
const GLYPH_IDLE = "□";
const GLYPH_UNKNOWN = "○";

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
            <span className="n">{c.n}</span>
            <span className="name">{c.name}</span>
          </div>
          <div className="basis">{c.basis}</div>
          <div className="how">{c.how}</div>
        </div>
      ))}
    </div>
  );
}
