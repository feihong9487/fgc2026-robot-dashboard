// PathGeometry 的 TypeScript 鏡像 —— 對應 src/main/cpp/lib/path/PathGeometry.cpp。
// waypoint → 直線段 + 五次貝茲倒角 → 等弧長取樣表。
//
// 移植時逐行對照 C++，包含所有邊界處理（重複點、共線、折返、尖角的「同位置不同
// 切線」雙推點）。任何一處偷懶都會讓瀏覽器裡畫的路徑跟機器實跑的不一樣。

const kEps = 1e-9;
const kBezierSubdiv = 512;
const kCosStraight = 0.999999;
const kCosReverse = -0.999999;

// 曲率自適應取樣：step_cm 是「最粗可以到多粗」，實際間距還會依最緊的彎收細。
// 固定 1cm 在 R=1.46cm 的急彎會變成每格轉 39°，那個密度下切線與曲率表本身就
// 不可信。做法是「整條路徑改用一個更細的均勻間距」而非真的變間距——
// VelocityProfile 的前後掃描吃的是單一純量 Δs。
const kMaxTurnPerSampleRad = 0.05235987755982988; // 3.0 度
// 近乎折返的轉角所需半徑趨近 0，不設上限會算出幾萬點
const kMaxSamples = 6000;

export interface Waypoint {
  x_cm: number;
  y_cm: number;
  heading_deg: number;
}

export interface PathPoint {
  s_cm: number;
  x_cm: number;
  y_cm: number;
  tanX: number;
  tanY: number;
  curvature: number; // 帶號曲率 κ = 1/R（1/cm）；直線為 0
}

// 倒角深度的決定方式，欄位與 C++ 的 BlendSpec 一一對應
export interface BlendSpec {
  manual_cm: number; // >= 0 → 固定深度；< 0 → 自動
  vCorner_cm_s: number;
  aLatMax_cm_s2: number;
  minRadius_cm: number;
  gapFrac: number;
}

// wpIndex >= 0 代表這一段身上帶著某個輸入 waypoint 的「代表位置」：
//   直線 → 終點就是該 waypoint（尖角，路徑真的經過它）
//   倒角 → 取 u=0.5 的中點（路徑被倒角切掉，不會真的經過角點）
interface Segment {
  isLine: boolean;
  cx: number[];
  cy: number[];
  wpIndex: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

//===五次貝茲單軸的值與一二階導數(Bernstein 基底)===
function evalQuintic(c: number[], u: number): [number, number, number] {
  const v = 1.0 - u;
  const v2 = v * v,
    v3 = v2 * v,
    v4 = v3 * v;
  const u2 = u * u,
    u3 = u2 * u,
    u4 = u3 * u;

  const p =
    c[0] * v4 * v +
    c[1] * 5.0 * u * v4 +
    c[2] * 10.0 * u2 * v3 +
    c[3] * 10.0 * u3 * v2 +
    c[4] * 5.0 * u4 * v +
    c[5] * u4 * u;

  const e0 = c[1] - c[0],
    e1 = c[2] - c[1],
    e2 = c[3] - c[2],
    e3 = c[4] - c[3],
    e4 = c[5] - c[4];
  const d1 =
    5.0 * (e0 * v4 + e1 * 4.0 * u * v3 + e2 * 6.0 * u2 * v2 + e3 * 4.0 * u3 * v + e4 * u4);

  const f0 = c[2] - 2.0 * c[1] + c[0],
    f1 = c[3] - 2.0 * c[2] + c[1],
    f2 = c[4] - 2.0 * c[3] + c[2],
    f3 = c[5] - 2.0 * c[4] + c[3];
  const d2 = 20.0 * (f0 * v3 + f1 * 3.0 * u * v2 + f2 * 3.0 * u2 * v + f3 * u3);

  return [p, d1, d2];
}

//===倒角峰值曲率的單位深度係數 κ_max·d,只與轉角 φ 有關===
// 把控制多邊形整體放大 d 倍，曲率就縮小 d 倍，故 κ_max·d 是純 φ 函數。
// 用 d=1 數值掃出來而非解析近似：曲率峰值未必落在 u=0.5（φ=30° 時差 22%）。
function blendKappaUnit(phiRad: number): number {
  const ox = Math.cos(phiRad),
    oy = Math.sin(phiRad);
  const cx = new Array<number>(6).fill(0);
  const cy = new Array<number>(6).fill(0);
  const k = [1.0, 2.0 / 3.0, 1.0 / 3.0];
  for (let j = 0; j < 3; j++) {
    cx[j] = -k[j];
    cy[j] = 0.0;
    cx[5 - j] = k[j] * ox;
    cy[5 - j] = k[j] * oy;
  }
  const kProbe = 256;
  let best = 0.0;
  for (let i = 0; i <= kProbe; i++) {
    const u = i / kProbe;
    const [, dx, ddx] = evalQuintic(cx, u);
    const [, dy, ddy] = evalQuintic(cy, u);
    const sp = Math.hypot(dx, dy);
    if (sp < kEps) continue;
    best = Math.max(best, Math.abs((dx * ddy - dy * ddx) / (sp * sp * sp)));
  }
  return best;
}

function depthForRadius(phiRad: number, targetRadiusCm: number): number {
  const kUnit = blendKappaUnit(phiRad);
  if (kUnit < kEps) return 1e9;
  return targetRadiusCm * kUnit;
}

//===兩個取樣點之間的線性內插(切線內插後重新正規化)===
function lerpPoint(a: PathPoint, b: PathPoint, t: number, s: number): PathPoint {
  let tx = a.tanX + t * (b.tanX - a.tanX);
  let ty = a.tanY + t * (b.tanY - a.tanY);
  const m = Math.hypot(tx, ty);
  if (m > kEps) {
    tx /= m;
    ty /= m;
  } else {
    tx = a.tanX;
    ty = a.tanY;
  }
  return {
    s_cm: s,
    x_cm: a.x_cm + t * (b.x_cm - a.x_cm),
    y_cm: a.y_cm + t * (b.y_cm - a.y_cm),
    curvature: a.curvature + t * (b.curvature - a.curvature),
    tanX: tx,
    tanY: ty,
  };
}

export class PathGeometry {
  pts: PathPoint[] = [];
  /** 每個輸入 waypoint 落在路徑上的弧長（cm），嚴格遞增。供逐段 heading 用。 */
  wpS: number[] = [];
  ds = 0.0;
  corners = 0;

  length(): number {
    return this.pts.length === 0 ? 0.0 : this.pts[this.pts.length - 1].s_cm;
  }
  step(): number {
    return this.ds;
  }

  //===waypoint→直線與倒角基元→稠密取樣→等弧長重取樣===
  build(wps: Waypoint[], spec: BlendSpec, stepCm = 1.0): boolean {
    this.pts = [];
    this.wpS = [];
    this.ds = 0.0;
    this.corners = 0;

    const n = wps.length;
    if (n < 2 || stepCm <= kEps) return false;

    // ── 各段的方向與長度 ──
    const dir: { x: number; y: number }[] = [];
    const len: number[] = [];
    for (let i = 0; i + 1 < n; i++) {
      const dx = wps[i + 1].x_cm - wps[i].x_cm;
      const dy = wps[i + 1].y_cm - wps[i].y_cm;
      const L = Math.hypot(dx, dy);
      if (L < kEps) return false; // 重複的 waypoint
      len.push(L);
      dir.push({ x: dx / L, y: dy / L });
    }

    // ── 各角點的倒角深度 ──
    const manual = spec.manual_cm >= 0.0;
    const legFrac = manual ? 0.5 : spec.gapFrac;
    let targetR = 0.0;
    if (!manual) {
      const aLat = Math.max(spec.aLatMax_cm_s2, kEps);
      targetR = Math.max((spec.vCorner_cm_s * spec.vCorner_cm_s) / aLat, spec.minRadius_cm);
    }

    const blend = new Array<number>(n).fill(0.0);
    if (manual ? spec.manual_cm > kEps : true) {
      for (let i = 1; i + 1 < n; i++) {
        const cosT = clamp(dir[i - 1].x * dir[i].x + dir[i - 1].y * dir[i].y, -1.0, 1.0);
        if (cosT > kCosStraight || cosT < kCosReverse) continue;
        const want = manual ? spec.manual_cm : depthForRadius(Math.acos(cosT), targetR);
        blend[i] = Math.min(want, legFrac * Math.min(len[i - 1], len[i]));
        if (blend[i] > kEps) ++this.corners;
      }
    }

    // ── 串出基元序列 ──
    const segs: Segment[] = [];
    let cur = { x: wps[0].x_cm, y: wps[0].y_cm };

    const pushLine = (
      a: { x: number; y: number },
      b: { x: number; y: number },
      wpIndex = -1,
    ) => {
      if (Math.hypot(b.x - a.x, b.y - a.y) < kEps) return;
      segs.push({
        isLine: true,
        cx: [a.x, b.x, 0, 0, 0, 0],
        cy: [a.y, b.y, 0, 0, 0, 0],
        wpIndex,
      });
    };

    for (let i = 1; i + 1 < n; i++) {
      const P = { x: wps[i].x_cm, y: wps[i].y_cm };
      if (blend[i] <= kEps) {
        pushLine(cur, P, i); // 尖角：直接走到角點
        cur = P;
        continue;
      }
      const d = blend[i];
      const ui = dir[i - 1];
      const uo = dir[i];
      pushLine(cur, { x: P.x - d * ui.x, y: P.y - d * ui.y });

      const cx = new Array<number>(6).fill(0);
      const cy = new Array<number>(6).fill(0);
      const k = [1.0, 2.0 / 3.0, 1.0 / 3.0];
      for (let j = 0; j < 3; j++) {
        cx[j] = P.x - k[j] * d * ui.x;
        cy[j] = P.y - k[j] * d * ui.y;
        cx[5 - j] = P.x + k[j] * d * uo.x;
        cy[5 - j] = P.y + k[j] * d * uo.y;
      }
      segs.push({ isLine: false, cx, cy, wpIndex: i }); // 代表位置 = 倒角中點
      cur = { x: cx[5], y: cy[5] };
    }
    pushLine(cur, { x: wps[n - 1].x_cm, y: wps[n - 1].y_cm });
    if (segs.length === 0) return false;

    // ── 稠密取樣（弧長由弦長累加）──
    const dense: PathPoint[] = [];
    let s = 0.0;
    const push = (x: number, y: number, tx: number, ty: number, kap: number) => {
      if (dense.length > 0) {
        const p = dense[dense.length - 1];
        s += Math.hypot(x - p.x_cm, y - p.y_cm);
      }
      dense.push({ s_cm: s, x_cm: x, y_cm: y, tanX: tx, tanY: ty, curvature: kap });
    };

    // 每一段都要推入自己的起點，即使與前一段終點位置重合：弧長相同但切線不同，
    // 尖角就是靠這對「同位置、不同切線」表達瞬間轉向。省略會讓重取樣把轉折
    // 線性內插到整條下一段直線上。
    // 各 waypoint 的代表弧長；頭尾直接是 0 與總長，中繼點在下面掃描時填。
    this.wpS = new Array<number>(n).fill(0.0);

    for (const sg of segs) {
      if (sg.isLine) {
        const dx = sg.cx[1] - sg.cx[0];
        const dy = sg.cy[1] - sg.cy[0];
        const L = Math.hypot(dx, dy);
        const tx = dx / L,
          ty = dy / L;
        push(sg.cx[0], sg.cy[0], tx, ty, 0.0);
        push(sg.cx[1], sg.cy[1], tx, ty, 0.0);
        if (sg.wpIndex > 0) this.wpS[sg.wpIndex] = s; // 終點即該 waypoint
      } else {
        for (let k = 0; k <= kBezierSubdiv; k++) {
          const u = k / kBezierSubdiv;
          const [x, dx, ddx] = evalQuintic(sg.cx, u);
          const [y, dy, ddy] = evalQuintic(sg.cy, u);
          const sp = Math.hypot(dx, dy);
          if (sp < kEps) {
            push(x, y, 0.0, 0.0, 0.0);
            continue;
          }
          push(x, y, dx / sp, dy / sp, (dx * ddy - dy * ddx) / (sp * sp * sp));
          // 倒角中點當作該角點的代表位置
          if (sg.wpIndex > 0 && k === kBezierSubdiv / 2) this.wpS[sg.wpIndex] = s;
        }
      }
    }

    const L = dense[dense.length - 1].s_cm;
    if (L < kEps || dense.length < 2) return false;

    // 頭尾補上並強制嚴格遞增（退化幾何可能算出非遞增值，逐段 heading 會除以 0）
    this.wpS[0] = 0.0;
    this.wpS[n - 1] = L;
    for (let i = 1; i < n; i++) this.wpS[i] = clamp(this.wpS[i], this.wpS[i - 1], L);

    // ── 等弧長重取樣（每格完全等寬，VelocityProfile 才能用固定 Δs）──
    // 先看最緊的彎需要多細：每格轉角 = κ_max·ds，要它不超過 kMaxTurnPerSampleRad。
    // 曲率取稠密表的最大值（解析微分算出來的，還沒經過任何內插）。
    let kappaMax = 0.0;
    for (const d of dense) kappaMax = Math.max(kappaMax, Math.abs(d.curvature));

    let wantStep = stepCm;
    if (kappaMax > kEps) wantStep = Math.min(wantStep, kMaxTurnPerSampleRad / kappaMax);

    let nSeg = Math.max(1, Math.ceil(L / wantStep));
    nSeg = Math.min(nSeg, kMaxSamples);
    this.ds = L / nSeg;

    let j = 0;
    for (let k = 0; k <= nSeg; k++) {
      const target = k === nSeg ? L : k * this.ds;
      while (j + 2 < dense.length && dense[j + 1].s_cm < target) ++j;
      const span = dense[j + 1].s_cm - dense[j].s_cm;
      const t = span > kEps ? clamp((target - dense[j].s_cm) / span, 0.0, 1.0) : 0.0;
      this.pts.push(lerpPoint(dense[j], dense[j + 1], t, target));
    }
    return true;
  }

  //===任意弧長取樣(間距均勻,故可直接算索引)===
  sample(sCm: number): PathPoint {
    if (this.pts.length === 0)
      return { s_cm: 0, x_cm: 0, y_cm: 0, tanX: 1, tanY: 0, curvature: 0 };
    if (sCm <= 0.0) return this.pts[0];
    if (sCm >= this.length() || this.ds < kEps) return this.pts[this.pts.length - 1];

    const f = sCm / this.ds;
    const i = Math.floor(f);
    if (i + 1 >= this.pts.length) return this.pts[this.pts.length - 1];
    return lerpPoint(this.pts[i], this.pts[i + 1], f - i, sCm);
  }
}
