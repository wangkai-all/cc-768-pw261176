import { useMemo, useState } from 'react';
import type { Rat } from '../core/rational';
import { cmp, sub, toDecimalString, toFraction, toNumber } from '../core/rational';

export interface DistBar {
  label: string;
  value: Rat;
  /** Draw as hollow (not attainable, displayed only for comparison). */
  hollow?: boolean;
  note?: string;
}

interface Props {
  title: string;
  subtitle?: string;
  bars: DistBar[];
  xLabel: string;
  yFormat?: 'percent' | 'decimal';
  height?: number;
  /** Optional horizontal range marker, e.g. the certified outer bound. */
  marker?: { value: Rat; label: string };
  /** Bar colour; defaults to series-1. */
  color?: string;
  showLegend?: boolean;
  /** Force a shared vertical scale across side-by-side charts. */
  yMax?: Rat;
}

const PAD = { left: 46, right: 14, top: 12, bottom: 40 };
const BAR_MAX = 24;

export function DistributionChart({
  title,
  subtitle,
  bars,
  xLabel,
  yFormat = 'percent',
  height = 220,
  marker,
  color = 'var(--series-1)',
  showLegend = true,
  yMax,
}: Props) {
  const [hover, setHover] = useState<{ x: number; y: number; bar: DistBar } | null>(null);
  const width = 640;
  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const maxVal = useMemo(() => {
    let m = yMax ? toNumber(yMax) : 0;
    for (const b of bars) if (toNumber(b.value) > m) m = toNumber(b.value);
    if (marker && toNumber(marker.value) > m) m = toNumber(marker.value);
    return m > 0 ? m : 1;
  }, [bars, marker, yMax]);
  const niceMax = niceCeil(maxVal, yFormat === 'percent');
  const band = plotW / Math.max(1, bars.length);
  const barW = Math.min(BAR_MAX, band * 0.5);
  const y = (v: number) => PAD.top + plotH - (v / niceMax) * plotH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * niceMax);
  const fmt = (v: number) => {
    if (yFormat !== 'percent') return trim(v);
    const pct = v * 100;
    return `${Number.isInteger(pct) ? pct : pct.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}%`;
  };
  const markerX =
    marker !== undefined ? PAD.left + (toNumber(marker.value) / niceMax) * plotW : null;

  if (bars.length === 0) {
    return (
      <div className="chart-card">
        <div className="chart-head">
          <h4>{title}</h4>
        </div>
        <div className="empty">暂无数据。</div>
      </div>
    );
  }

  return (
    <div className="chart-card">
      <div className="chart-head">
        <h4>{title}</h4>
        {subtitle && <span className="sub">{subtitle}</span>}
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${title} 的分布柱状图`}
        style={{ width: '100%', height: 'auto', display: 'block' }}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={width - PAD.right}
              y1={y(t)}
              y2={y(t)}
              stroke="var(--gridline)"
              strokeWidth={1}
            />
            <text
              x={PAD.left - 8}
              y={y(t) + 4}
              textAnchor="end"
              fontSize={10.5}
              fill="var(--text-muted)"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {fmt(t)}
            </text>
          </g>
        ))}
        {markerX !== null && marker && (
          <g>
            <line
              x1={markerX}
              x2={markerX}
              y1={PAD.top}
              y2={PAD.top + plotH}
              stroke="var(--series-2)"
              strokeWidth={2}
              strokeDasharray="4 3"
            />
            <text
              x={markerX + (markerX > width - 150 ? -6 : 6)}
              y={PAD.top + 11}
              textAnchor={markerX > width - 150 ? 'end' : 'start'}
              fontSize={10.5}
              fill="var(--series-2)"
            >
              {marker.label}
            </text>
          </g>
        )}
        {bars.map((b, i) => {
          const v = toNumber(b.value);
          const cx = PAD.left + band * (i + 0.5);
          const h = Math.max(v > 0 ? 1 : 0, (v / niceMax) * plotH);
          const top = PAD.top + plotH - h;
          const showLabel =
            v > 0 && h > 18 && barW >= 26 ? fmt(v) : null;
          return (
            <g key={b.label || i}>
              <rect
                x={cx - band / 2}
                y={PAD.top}
                width={band}
                height={plotH}
                fill="transparent"
                onMouseMove={(e) =>
                  setHover({ x: e.clientX, y: e.clientY, bar: b })
                }
                onMouseLeave={() => setHover(null)}
                onFocus={() => undefined}
              />
              <rect
                x={cx - barW / 2}
                y={top}
                width={barW}
                height={h}
                rx={4}
                ry={4}
                fill={b.hollow ? 'transparent' : color}
                stroke={b.hollow ? color : 'none'}
                strokeWidth={b.hollow ? 1.5 : 0}
                strokeDasharray={b.hollow ? '3 2' : undefined}
                pointerEvents="none"
                opacity={hover && hover.bar !== b ? 0.78 : 1}
              />
              {showLabel && (
                <text
                  x={cx}
                  y={top - 5}
                  textAnchor="middle"
                  fontSize={10}
                  fill="var(--text-secondary)"
                  pointerEvents="none"
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {showLabel}
                </text>
              )}
              <text
                x={cx}
                y={PAD.top + plotH + 16}
                textAnchor="middle"
                fontSize={10.5}
                fill="var(--text-muted)"
                pointerEvents="none"
              >
                {b.label}
              </text>
            </g>
          );
        })}
        <line
          x1={PAD.left}
          x2={width - PAD.right}
          y1={PAD.top + plotH}
          y2={PAD.top + plotH}
          stroke="var(--baseline)"
          strokeWidth={1}
        />
        <text
          x={PAD.left + plotW / 2}
          y={height - 6}
          textAnchor="middle"
          fontSize={10.5}
          fill="var(--text-muted)"
        >
          {xLabel}
        </text>
      </svg>
      {hover && (
        <div
          className="tooltip"
          style={{
            left: Math.min(hover.x + 12, window.innerWidth - 270),
            top: Math.max(hover.y - 52, 8),
          }}
        >
          <div className="tt-value">
            <span
              className="tt-key"
              style={{ background: color, height: 8, width: 8, borderRadius: 2 }}
            />
            {yFormat === 'percent'
              ? `${(toNumber(hover.bar.value) * 100).toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}%`
              : toDecimalString(hover.bar.value, 8)}
          </div>
          <div className="tt-label">{hover.bar.label}</div>
          {hover.bar.note && <div className="tt-label">{hover.bar.note}</div>}
          <div className="tt-label mono" style={{ fontSize: 11 }}>
            {toFraction(hover.bar.value)}
          </div>
        </div>
      )}
      {showLegend && (
        <div className="legend">
          <span>
            <i className="swatch" style={{ background: color }} />
            概率质量
          </span>
          {marker && (
            <span>
              <i
                className="swatch"
                style={{ background: 'var(--series-2)', width: 12, height: 2 }}
              />
              {marker.label}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function trim(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

/**
 * Pick an axis maximum such that the four interior gridlines land on round
 * percentage steps (15 % means 0/15/30/45/60 %). Without this, quartering an
 * arbitrary maximum gives labels like 56.25 %.
 */
function niceCeil(v: number, percent: boolean): number {
  if (!(v > 0)) return 1;
  if (!percent) {
    if (v >= 1) return Math.ceil(v * 10) / 10;
    const cand = [0.05, 0.1, 0.2, 0.25, 0.5, 0.75, 1];
    for (const c of cand) if (v <= c + 1e-12) return c;
    return Math.ceil(v * 10) / 10;
  }
  const pct = v * 100;
  const steps = [5, 10, 15, 20, 25, 30, 40, 50, 60, 75];
  for (const step of steps) {
    if (step * 4 >= pct - 1e-9) return (step * 4) / 100;
  }
  return Math.ceil(pct / 100);
}

/** Interval chart: horizontal interval with min/max ends, used for bounds. */
export function IntervalBar({
  lo,
  hi,
  outerLo,
  outerHi,
  fmt,
  loLabel,
  hiLabel,
}: {
  lo: Rat;
  hi: Rat;
  outerLo?: Rat;
  outerHi?: Rat;
  fmt: (r: Rat) => string;
  loLabel: string;
  hiLabel: string;
}) {
  const min = Math.min(
    toNumber(lo),
    outerLo !== undefined ? toNumber(outerLo) : Infinity,
  );
  const max = Math.max(
    toNumber(hi),
    outerHi !== undefined ? toNumber(outerHi) : -Infinity,
  );
  const span = Math.max(max - min, 1e-9);
  const pad = span * 0.15;
  const scale = (v: number) => ((v - (min - pad)) / (span + 2 * pad)) * 100;
  return (
    <div style={{ marginTop: 8 }}>
      <div
        style={{
          position: 'relative',
          height: 10,
          background: 'var(--gridline)',
          borderRadius: 5,
        }}
        role="img"
        aria-label={`区间 ${loLabel} 到 ${hiLabel}`}
      >
        <div
          style={{
            position: 'absolute',
            left: `${scale(toNumber(lo))}%`,
            width: `${Math.max(0.8, scale(toNumber(hi)) - scale(toNumber(lo)))}%`,
            top: 0,
            bottom: 0,
            background: 'var(--series-1)',
            borderRadius: 5,
          }}
        />
        {outerLo !== undefined && outerHi !== undefined && (
          <div
            style={{
              position: 'absolute',
              left: `${scale(toNumber(outerLo))}%`,
              width: `${Math.max(0.6, scale(toNumber(outerHi)) - scale(toNumber(outerLo)))}%`,
              top: -4,
              bottom: -4,
              border: '1.5px dashed var(--series-2)',
              borderRadius: 6,
              opacity: cmp(outerLo, lo) === 0 && cmp(outerHi, hi) === 0 ? 0 : 1,
            }}
          />
        )}
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 11.5,
          color: 'var(--text-muted)',
          marginTop: 4,
        }}
      >
        <span className="mono">{fmt(lo)}</span>
        <span className="mono">{fmt(hi)}</span>
      </div>
    </div>
  );
}

export function MiniSpan({ a, b }: { a: Rat; b: Rat }) {
  return (
    <span className="mono">
      [{toDecimalString(a, 6)}, {toDecimalString(b, 6)}]
      {cmp(sub(b, a), a) === 0 ? '' : ''}
    </span>
  );
}
