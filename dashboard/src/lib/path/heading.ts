// HeadingProfile 的 TypeScript 鏡像 —— 對應 src/main/cpp/lib/path/HeadingProfile.cpp。
// 機身角以「弧長 s」為自變數；梯形形狀把 dθ/ds 的峰值倍率從 1.875 壓到 1/(1−rampFrac)。

import type { PathGeometry, Waypoint } from "./geometry.ts";

const kEps = 1e-9;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

//===角度差折進 [−180, 180)（永遠走短邊）===
export function wrapDeg(d: number): number {
  return d - 360.0 * Math.floor((d + 180.0) / 360.0);
}

// smoothstep 與其在 [0,1] 上的積分
const S5 = (x: number) => x * x * x * (x * (x * 6.0 - 15.0) + 10.0);
const S5Int = (x: number) => {
  const x2 = x * x,
    x4 = x2 * x2;
  return x4 * (x2 - 3.0 * x + 2.5); // S5Int(1) = 0.5
};

export class HeadingProfile {
  private theta0 = 0.0;
  private dTheta = 0.0;
  private len = 0.0;
  private ramp = 0.0;
  // 逐段模式才填（空 = 單段模式）。segTheta 是各 waypoint 的「絕對機身角」，
  // 由起點角累加各段 wrap 後的 Δθ 得到，故可超出 ±180——這是對的，它要與同樣
  // 連續累加的測程航向同一個 frame。
  private segS: number[] = [];
  private segTheta: number[] = [];

  build(wps: Waypoint[], geo: PathGeometry, rampFrac = 0.0, perWaypoint = false): void {
    this.segS = [];
    this.segTheta = [];

    if (wps.length < 2) {
      this.theta0 = this.dTheta = this.len = this.ramp = 0.0;
      return;
    }
    this.theta0 = wps[0].heading_deg;
    this.len = geo.length();
    // 落在 (0, 0.5) 之外一律視為「不用梯形」，走原本的純 smoothstep
    this.ramp = rampFrac > kEps && rampFrac < 0.5 ? rampFrac : 0.0;

    const wpS = geo.wpS;
    // 只有兩個點時逐段與單段完全等價
    if (!perWaypoint || wps.length < 3 || wpS.length !== wps.length || this.len < kEps) {
      this.dTheta = wrapDeg(wps[wps.length - 1].heading_deg - wps[0].heading_deg);
      return;
    }

    // 每段的 Δθ 各自 wrap 成短邊，再累加成各 waypoint 的絕對角
    this.segS = wpS.slice();
    this.segTheta = new Array<number>(wps.length).fill(0);
    this.segTheta[0] = this.theta0;
    for (let i = 1; i < wps.length; i++)
      this.segTheta[i] =
        this.segTheta[i - 1] + wrapDeg(wps[i].heading_deg - wps[i - 1].heading_deg);

    this.dTheta = this.segTheta[this.segTheta.length - 1] - this.segTheta[0];

    // 退化保護：任一段長度為 0 就整個退回單段模式，否則 dθ/ds 會是無限大
    for (let i = 1; i < this.segS.length; i++) {
      if (this.segS[i] - this.segS[i - 1] < kEps) {
        this.segS = [];
        this.segTheta = [];
        this.dTheta = wrapDeg(wps[wps.length - 1].heading_deg - wps[0].heading_deg);
        return;
      }
    }
  }

  //===逐段模式:找 s 落在哪一段===
  private segmentAt(sCm: number): number {
    let i = 0;
    while (i + 2 < this.segS.length && sCm >= this.segS[i + 1]) ++i;
    return i;
  }

  totalTurn(): number {
    return this.dTheta;
  }

  // dθ/ds 的峰值 ÷ 平均值
  peakToMeanTurnRate(): number {
    return this.ramp <= 0.0 ? 1.875 : 1.0 / (1.0 - this.ramp);
  }

  //===形狀函數 S(σ)===
  private shape(sigma: number): number {
    const x = clamp(sigma, 0.0, 1.0);
    if (this.ramp <= 0.0) return S5(x);
    const r = this.ramp;
    const Z = 1.0 - r; // ∫₀¹ g = 2·r·(1/2) + (1−2r) = 1−r
    let G: number;
    if (x < r) G = r * S5Int(x / r);
    else if (x <= 1.0 - r) G = 0.5 * r + (x - r);
    else G = 0.5 * r + (1.0 - 2.0 * r) + r * (0.5 - S5Int((1.0 - x) / r));
    return G / Z;
  }

  //===S'(σ)===
  private shapeDeriv(sigma: number): number {
    const x = clamp(sigma, 0.0, 1.0);
    if (this.ramp <= 0.0) return 30.0 * x * x * (x - 1.0) * (x - 1.0);
    const r = this.ramp;
    const Z = 1.0 - r;
    let g: number;
    if (x < r) g = S5(x / r);
    else if (x <= 1.0 - r) g = 1.0;
    else g = S5((1.0 - x) / r);
    return g / Z;
  }

  //===機身角:單段 θ0+Δθ·S(s/L);逐段則在所屬區間內跑同一條形狀函數===
  headingAt(sCm: number): number {
    if (this.len < kEps) return this.theta0 + this.dTheta;

    if (this.segS.length === 0) return this.theta0 + this.dTheta * this.shape(sCm / this.len);

    const i = this.segmentAt(sCm);
    const span = this.segS[i + 1] - this.segS[i];
    const sig = clamp((sCm - this.segS[i]) / span, 0.0, 1.0);
    return this.segTheta[i] + (this.segTheta[i + 1] - this.segTheta[i]) * this.shape(sig);
  }

  //===轉速密度:兩端為 0;逐段模式下每個 waypoint 處也為 0(故 dθ/ds 連續)===
  dThetaDs(sCm: number): number {
    if (this.len < kEps) return 0.0;
    if (sCm <= 0.0 || sCm >= this.len) return 0.0; // 兩端斜坡的導數本就為 0

    if (this.segS.length === 0)
      return (this.dTheta * this.shapeDeriv(sCm / this.len)) / this.len;

    const i = this.segmentAt(sCm);
    const span = this.segS[i + 1] - this.segS[i];
    const sig = clamp((sCm - this.segS[i]) / span, 0.0, 1.0);
    return ((this.segTheta[i + 1] - this.segTheta[i]) * this.shapeDeriv(sig)) / span;
  }
}
