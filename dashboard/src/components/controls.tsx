// LabVIEW 風格控件庫 — 對應 Front Panel 控件分類：
// Numeric / Ring & Enum / Boolean(LED・Switch) / Array / Matrix / Cluster /
// String & Path / Bar Graph / Container(Collapse)
// 全部為「草稿-送出」模式：編輯中不被機器人回報值蓋掉，Enter/失焦才 commit。
import { ReactNode, useState } from "react";

/** 數值控件：本地值 + onCommit。編輯中框線變色提示尚未送出 */
export function NumBox({
  value,
  onCommit,
  step = 1,
  width = 90,
  disabled,
}: {
  value: number;
  onCommit: (v: number) => void;
  step?: number;
  width?: number;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const editing = draft !== null;
  const commit = () => {
    if (draft === null) return;
    const v = parseFloat(draft);
    if (!Number.isNaN(v)) onCommit(v);
    setDraft(null);
  };
  return (
    <input
      type="number"
      step={step}
      disabled={disabled}
      className={editing ? "lv-num editing" : "lv-num"}
      style={{ width }}
      value={editing ? draft : String(parseFloat(value.toPrecision(6)))}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setDraft(null);
      }}
    />
  );
}

/** 附標籤的數值欄位（常數表/除錯面板的標準列） */
export function LabeledNum({
  label,
  value,
  onCommit,
  step,
  unit,
}: {
  label: string;
  value: number;
  onCommit: (v: number) => void;
  step?: number;
  unit?: string;
}) {
  return (
    <label className="lv-row">
      <span className="lv-label">{label}</span>
      <span className="lv-row-right">
        <NumBox value={value} onCommit={onCommit} step={step} />
        {unit && <span className="lv-unit">{unit}</span>}
      </span>
    </label>
  );
}

/** Ring & Enum：下拉選單，值為 options 內的字串 */
export function Ring({
  label,
  value,
  options,
  optionLabels,
  onCommit,
}: {
  label?: string;
  value: string;
  options: readonly string[];
  optionLabels?: readonly string[];
  onCommit: (v: string) => void;
}) {
  const sel = (
    <select
      className="lv-ring"
      value={value}
      onChange={(e) => onCommit(e.target.value)}
    >
      {options.map((o, i) => (
        <option key={o} value={o}>
          {optionLabels?.[i] ?? o}
        </option>
      ))}
    </select>
  );
  if (!label) return sel;
  return (
    <label className="lv-row">
      <span className="lv-label">{label}</span>
      {sel}
    </label>
  );
}

/** LED 指示燈（Boolean indicator） */
export function Led({
  on,
  label,
  color = "ok",
}: {
  on: boolean;
  label?: string;
  color?: "ok" | "warn" | "err" | "accent";
}) {
  return (
    <span className="lv-led-wrap" title={label}>
      <span className={on ? `lv-led on ${color}` : "lv-led"} />
      {label && <span className="lv-led-label">{label}</span>}
    </span>
  );
}

/** 開關（Boolean control） */
export function Toggle({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label?: string;
}) {
  return (
    <label className="lv-row">
      {label && <span className="lv-label">{label}</span>}
      <button
        className={on ? "lv-toggle on" : "lv-toggle"}
        onClick={() => onChange(!on)}
      >
        <span className="lv-toggle-knob" />
      </button>
    </label>
  );
}

/** 滑桿 + 數值框（拖動即時回報，數值框精確輸入） */
export function SliderCtl({
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="lv-row">
      <span className="lv-label">{label}</span>
      <input
        type="range"
        className="lv-slider"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
      <span className="lv-row-right">
        <NumBox value={value} onCommit={onChange} step={step} width={64} />
        {unit && <span className="lv-unit">{unit}</span>}
      </span>
    </label>
  );
}

/** 1D 數值陣列控件（黑線門檻等）：一列 N 格 */
export function ArrayCtl({
  label,
  values,
  onCommit,
  readOnly,
}: {
  label?: string;
  values: number[];
  onCommit?: (index: number, v: number) => void;
  readOnly?: boolean;
}) {
  return (
    <div className="lv-array">
      {label && <span className="lv-label">{label}</span>}
      <div className="lv-array-cells">
        {values.map((v, i) =>
          readOnly ? (
            <span key={i} className="lv-array-cell ro" title={`[${i}]`}>
              {parseFloat(v.toPrecision(4))}
            </span>
          ) : (
            <span key={i} className="lv-array-cell" title={`[${i}]`}>
              <NumBox value={v} onCommit={(nv) => onCommit?.(i, nv)} width={54} />
            </span>
          ),
        )}
      </div>
    </div>
  );
}

/** 2D 矩陣控件（HSV 3×6、球座標 12×2）：附列/欄標題 */
export function MatrixCtl({
  rowLabels,
  colLabels,
  values,
  onCommit,
}: {
  rowLabels: readonly string[];
  colLabels: readonly string[];
  values: number[][];
  onCommit: (row: number, col: number, v: number) => void;
}) {
  return (
    <table className="lv-matrix">
      <thead>
        <tr>
          <th />
          {colLabels.map((c) => (
            <th key={c}>{c}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {values.map((row, r) => (
          <tr key={r}>
            <th>{rowLabels[r]}</th>
            {row.map((v, c) => (
              <td key={c}>
                <NumBox value={v} onCommit={(nv) => onCommit(r, c, nv)} width={58} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Pose Cluster：x / y / θ 三欄位一組（LabVIEW cluster 概念） */
export function PoseCluster({
  label,
  pose,
  onCommit,
  unit = "m",
}: {
  label: string;
  pose: { x: number; y: number; theta: number };
  onCommit: (p: { x: number; y: number; theta: number }) => void;
  unit?: string;
}) {
  return (
    <div className="lv-cluster">
      <span className="lv-label">{label}</span>
      <span className="lv-cluster-fields">
        <span className="lv-unit">x</span>
        <NumBox value={pose.x} onCommit={(v) => onCommit({ ...pose, x: v })} step={0.01} width={66} />
        <span className="lv-unit">y</span>
        <NumBox value={pose.y} onCommit={(v) => onCommit({ ...pose, y: v })} step={0.01} width={66} />
        <span className="lv-unit">θ</span>
        <NumBox value={pose.theta} onCommit={(v) => onCommit({ ...pose, theta: v })} step={1} width={56} />
        <span className="lv-unit">{unit}/°</span>
      </span>
    </div>
  );
}

/** String & Path：等寬字型路徑欄（唯讀顯示檔案路徑或可編輯） */
export function PathBox({
  value,
  onCommit,
  readOnly,
}: {
  value: string;
  onCommit?: (v: string) => void;
  readOnly?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  if (readOnly) return <span className="lv-path ro">{value}</span>;
  const editing = draft !== null;
  const commit = () => {
    if (draft !== null) onCommit?.(draft);
    setDraft(null);
  };
  return (
    <input
      type="text"
      className={editing ? "lv-path editing" : "lv-path"}
      value={editing ? draft : value}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setDraft(null);
      }}
    />
  );
}

/** 單條水平量條（0~max），可加警示門檻 */
export function BarMeter({
  value,
  max,
  threshold,
  label,
  unit,
}: {
  value: number;
  max: number;
  threshold?: number;
  label?: string;
  unit?: string;
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const over = threshold !== undefined && value > threshold;
  return (
    <div className="lv-bar-row">
      {label && <span className="lv-label">{label}</span>}
      <div className="lv-bar">
        <div className={over ? "lv-bar-fill warn" : "lv-bar-fill"} style={{ width: `${pct}%` }} />
        {threshold !== undefined && (
          <div className="lv-bar-thresh" style={{ left: `${(threshold / max) * 100}%` }} />
        )}
      </div>
      <span className="lv-bar-val">
        {value.toFixed(0)}
        {unit}
      </span>
    </div>
  );
}

/** 垂直 Bar 陣列（黑線感測器 raw 值，如 2 灰度 + 2 紅外線）+ 門檻線 + 二值化 LED */
export function BarArray({
  values,
  thresholds,
  bins,
  labels,
  max = 1023,
}: {
  values: number[];
  thresholds?: number[];
  bins?: boolean[];
  labels?: readonly string[];
  max?: number;
}) {
  return (
    <div className="lv-bararray">
      {values.map((v, i) => {
        const pct = Math.max(0, Math.min(100, (v / max) * 100));
        const th = thresholds?.[i];
        return (
          <div key={i} className="lv-bararray-col">
            <div className="lv-bararray-track">
              <div className="lv-bararray-fill" style={{ height: `${pct}%` }} />
              {th !== undefined && th > 0 && (
                <div className="lv-bararray-thresh" style={{ bottom: `${(th / max) * 100}%` }} />
              )}
            </div>
            <span className="lv-bararray-num">{v.toFixed(0)}</span>
            {bins && <span className={bins[i] ? "lv-led on accent" : "lv-led"} />}
            <span className="lv-unit">{labels?.[i] ?? i}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Container：可折疊區塊（標題列 + 內容），預設展開 */
export function Collapse({
  title,
  children,
  defaultOpen = true,
  badge,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  badge?: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="lv-collapse">
      <header className="lv-collapse-head" onClick={() => setOpen(!open)}>
        <span className="lv-collapse-arrow">{open ? "▾" : "▸"}</span>
        <h3>{title}</h3>
        {badge}
      </header>
      {open && <div className="lv-collapse-body">{children}</div>}
    </section>
  );
}
