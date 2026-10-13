'use client';

// Charts for the index, drawn as SVG at the container's real width (so text
// stays readable on phones), in the site's toy-box style: outlined bars,
// maker colours, mono numbers. No chart library.

import Link from 'next/link';
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)));
    ro.observe(el);
    setW(Math.floor(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

const fmt1 = (v: number) => (v >= 99.95 ? '100' : v.toFixed(v < 10 ? 1 : 0));

// ---------------------------------------------------------------------------
// Bars: one per model, tallest first. Wide screens get upright bars with
// slanted names underneath; narrow ones a list of horizontal bars.

export interface BarItem {
  key: string;
  label: string;
  sub?: string | null;
  value: number | null;
  color: string;
  href?: string;
  /** Drawn hatched: e.g. still running, or self-reported. */
  hatch?: boolean;
}

/** A fixed mark across the bars, e.g. the coding benchmark's 100-point reference. */
export interface Reference {
  value: number;
  label: string;
}

export function BarChart({
  items,
  max = 100,
  format = fmt1,
  height = 230,
  empty,
  reference,
}: {
  items: BarItem[];
  max?: number;
  format?: (v: number) => string;
  height?: number;
  empty?: ReactNode;
  reference?: Reference;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  return (
    <div ref={ref} className="chart-wrap">
      {items.length === 0 ? (
        <div className="chart-empty">{empty ?? 'No results yet.'}</div>
      ) : width > 0 && width < 560 ? (
        <HBars items={items} max={max} format={format} reference={reference} />
      ) : (
        width > 0 && <VBars items={items} max={max} format={format} height={height} width={width} reference={reference} />
      )}
    </div>
  );
}

function VBars({
  items,
  max,
  format,
  height,
  width,
  reference,
}: {
  items: BarItem[];
  max: number;
  format: (v: number) => string;
  height: number;
  width: number;
  reference?: Reference;
}) {
  // Slanted names run down and to the left of their bar: leave room for the
  // first one on the left and for the longest one underneath.
  const rad = (42 * Math.PI) / 180;
  const len = (it: BarItem) => (it.label.length + (it.sub ? it.sub.length + 1 : 0)) * 6.6;
  const first = items[0] ? len(items[0]) * Math.cos(rad) : 0;
  const longest = Math.max(0, ...items.map(len));
  const slot = Math.max(38, Math.min(76, (width - 60) / items.length));
  const left = Math.max(40, first - slot / 2 + 8);
  // A few bars on a wide chart sit in the middle, not bunched at the axis.
  const x0 = Math.max(left, (width - slot * items.length) / 2);
  const bar = Math.min(44, slot * 0.68);
  const labelH = Math.min(130, longest * Math.sin(rad) + 28);
  const top = 18;
  const W = Math.max(width, left + slot * items.length);
  const H = top + height + labelH;
  const y = (v: number) => top + height - (height * Math.max(0, Math.min(v, max))) / max;
  return (
    <div className="chart-scroll">
      {(
        <svg width={W} height={H} className="chart" role="img" aria-label="Bar chart">
          <defs>
            <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="3" height="6" fill="var(--card)" opacity="0.55" />
            </pattern>
          </defs>
          {[0, 25, 50, 75, 100].filter((g) => g <= max).map((g) => (
            <g key={g}>
              <line x1={left - 8} x2={W} y1={y(g)} y2={y(g)} className="grid-line" />
              <text x={left - 14} y={y(g) + 4} className="axis-num" textAnchor="end">
                {g}
              </text>
            </g>
          ))}
          {items.map((it, i) => {
            const cx = x0 + slot * i + slot / 2;
            const v = it.value ?? 0;
            const yTop = y(v);
            const h = Math.max(top + height - yTop, 2);
            const body = (
              <g className="bar-g">
                <title>{`${it.label}${it.sub ? ` · ${it.sub}` : ''}: ${it.value === null ? 'n/a' : format(v)}`}</title>
                <rect x={cx - bar / 2} y={top + height - h} width={bar} height={h} rx={5} fill={it.color} className="bar" />
                {it.hatch && <rect x={cx - bar / 2} y={top + height - h} width={bar} height={h} rx={5} fill="url(#hatch)" className="bar-hatch" />}
                <text x={cx} y={h > 26 ? yTop + 17 : yTop - 6} textAnchor="middle" className={h > 26 ? 'bar-num in' : 'bar-num'}>
                  {it.value === null ? '–' : format(v)}
                </text>
                <text transform={`translate(${cx + 4}, ${top + height + 12}) rotate(-42)`} textAnchor="end" className="bar-label">
                  {it.label}
                  {it.sub && <tspan className="bar-sub"> {it.sub}</tspan>}
                </text>
              </g>
            );
            return it.href ? (
              <Link key={it.key} href={it.href}>
                {body}
              </Link>
            ) : (
              <g key={it.key}>{body}</g>
            );
          })}
          {reference && reference.value <= max && (
            <g className="ref-g">
              <line x1={left - 8} x2={W} y1={y(reference.value)} y2={y(reference.value)} className="ref-line" />
              <text x={W - 4} y={y(reference.value) - 6} textAnchor="end" className="ref-label">
                {reference.label}
              </text>
            </g>
          )}
        </svg>
      )}
    </div>
  );
}

function HBars({ items, max, format, reference }: { items: BarItem[]; max: number; format: (v: number) => string; reference?: Reference }) {
  const refPct = reference && reference.value <= max ? (100 * reference.value) / max : null;
  return (
    <ol className="hbars">
      {refPct !== null && (
        <li className="hbar-ref-note" aria-hidden>
          <span className="hbar-label">
            <span className="hbar-ref-key" /> {reference?.label}
          </span>
        </li>
      )}
      {items.map((it) => {
        const pct = it.value === null ? 0 : (100 * Math.max(0, Math.min(it.value, max))) / max;
        const name = (
          <>
            <span className="hbar-name">{it.label}</span>
            {it.sub && <span className="hbar-sub">{it.sub}</span>}
          </>
        );
        return (
          <li key={it.key}>
            <span className="hbar-label">{it.href ? <Link href={it.href}>{name}</Link> : name}</span>
            <span className="hbar-track">
              <span className={`hbar-fill${it.hatch ? ' hatch' : ''}`} style={{ width: `${Math.max(pct, 1.5)}%`, background: it.color }} />
              {refPct !== null && <i className="hbar-ref" style={{ left: `${refPct}%` }} />}
            </span>
            <span className="hbar-num">{it.value === null ? '–' : format(it.value)}</span>
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// Scatter: score against a cost (moves, time, money). The shaded corner is
// where you want to be: high score for little cost. The dotted line joins
// the models nobody beats on both at once.

export interface Point {
  key: string;
  label: string;
  x: number;
  y: number;
  color: string;
  href?: string;
}

function niceTicks(lo: number, hi: number, log: boolean): number[] {
  if (log) {
    const out: number[] = [];
    for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) {
      for (const m of [1, 2, 5]) {
        const v = m * 10 ** e;
        if (v >= lo * 0.999 && v <= hi * 1.001) out.push(v);
      }
    }
    return out;
  }
  const span = hi - lo || 1;
  const step = 10 ** Math.floor(Math.log10(span / 4));
  const nice = [1, 2, 5, 10].map((m) => m * step).find((s) => span / s <= 6) ?? step * 10;
  const out: number[] = [];
  for (let v = Math.ceil(lo / nice) * nice; v <= hi + 1e-9; v += nice) out.push(Number(v.toFixed(10)));
  return out;
}

export function ScatterChart({ points, xLabel, yLabel = 'Cube Arena Index', xFormat, log = false, empty }: { points: Point[]; xLabel: string; yLabel?: string; xFormat: (v: number) => string; log?: boolean; empty?: ReactNode }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const usable = points.filter((p) => Number.isFinite(p.x) && (!log || p.x > 0));
  return (
    <div ref={ref} className="chart-wrap">
      {usable.length === 0 ? (
        <div className="chart-empty">{empty ?? 'No results yet.'}</div>
      ) : (
        width > 0 && <Scatter points={usable} xLabel={xLabel} yLabel={yLabel} xFormat={xFormat} log={log} width={width} />
      )}
    </div>
  );
}

function Scatter({ points: usable, xLabel, yLabel, xFormat, log, width }: { points: Point[]; xLabel: string; yLabel: string; xFormat: (v: number) => string; log: boolean; width: number }) {
  const narrow = width < 560;
  const H = narrow ? 320 : 420;
  const m = { l: 52, r: narrow ? 14 : 24, t: 16, b: 52 };
  const xs = usable.map((p) => p.x);
  let lo = Math.min(...xs);
  let hi = Math.max(...xs);
  if (log) {
    lo = 10 ** Math.floor(Math.log10(lo));
    hi = 10 ** Math.ceil(Math.log10(hi));
  } else {
    const pad = (hi - lo || hi || 1) * 0.08;
    lo = Math.max(0, lo - pad);
    hi += pad;
  }
  const yMax = 100;
  const sx = (v: number) =>
    m.l + ((width - m.l - m.r) * (log ? Math.log10(v) - Math.log10(lo) : v - lo)) / (log ? Math.log10(hi) - Math.log10(lo) : hi - lo || 1);
  const sy = (v: number) => m.t + (H - m.t - m.b) * (1 - v / yMax);
  // Nobody beats these on both: lower x and higher y.
  const sorted = [...usable].sort((a, b) => a.x - b.x || b.y - a.y);
  const front: Point[] = [];
  for (const p of sorted) if (!front.length || p.y > front[front.length - 1].y) front.push(p);
  const midX = [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const midY = usable.map((p) => p.y).sort((a, b) => a - b)[Math.floor(usable.length / 2)];
  const labelled = new Set((narrow ? front : usable).map((p) => p.key));
  return (
    <div className="chart-box">
      {(
        <svg width={width} height={H} className="chart" role="img" aria-label={`${yLabel} against ${xLabel}`}>
          {usable.length > 1 && <rect x={m.l} y={m.t} width={Math.max(0, sx(midX) - m.l)} height={Math.max(0, sy(midY) - m.t)} className="sweet-spot" />}
          {[0, 25, 50, 75, 100].map((g) => (
            <g key={g}>
              <line x1={m.l} x2={width - m.r} y1={sy(g)} y2={sy(g)} className="grid-line" />
              <text x={m.l - 8} y={sy(g) + 4} textAnchor="end" className="axis-num">
                {g}
              </text>
            </g>
          ))}
          {niceTicks(lo, hi, log).map((t) => (
            <g key={t}>
              <line x1={sx(t)} x2={sx(t)} y1={m.t} y2={H - m.b} className="grid-line v" />
              <text x={sx(t)} y={H - m.b + 18} textAnchor="middle" className="axis-num">
                {xFormat(t)}
              </text>
            </g>
          ))}
          <text x={(m.l + width - m.r) / 2} y={H - 10} textAnchor="middle" className="axis-title">
            {xLabel}
          </text>
          <text transform={`translate(14, ${(m.t + H - m.b) / 2}) rotate(-90)`} textAnchor="middle" className="axis-title">
            {yLabel}
          </text>
          {front.length > 1 && <polyline points={front.map((p) => `${sx(p.x)},${sy(p.y)}`).join(' ')} className="pareto" />}
          {usable.map((p) => {
            const cx = sx(p.x);
            const cy = sy(p.y);
            const right = cx < width - 150;
            const dot = (
              <g className="dot-g">
                <title>{`${p.label}: ${fmt1(p.y)} at ${xFormat(p.x)}`}</title>
                <circle cx={cx} cy={cy} r={7} fill={p.color} className="dot" />
                {labelled.has(p.key) && (
                  <text x={right ? cx + 11 : cx - 11} y={cy + 4} textAnchor={right ? 'start' : 'end'} className="dot-label">
                    {p.label}
                  </text>
                )}
              </g>
            );
            return p.href ? (
              <Link key={p.key} href={p.href}>
                {dot}
              </Link>
            ) : (
              <g key={p.key}>{dot}</g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lines: score at each effort level, one line per model.

export interface Series {
  key: string;
  label: string;
  color: string;
  dash?: string;
  points: { x: string; y: number }[];
  href?: string;
}

export function LineChart({ series, xs, yLabel = 'Cube Arena Index', empty }: { series: Series[]; xs: string[]; yLabel?: string; empty?: ReactNode }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const live = series.filter((s) => s.points.length > 0);
  return (
    <div ref={ref} className="chart-wrap">
      {live.length === 0 ? (
        <div className="chart-empty">{empty ?? 'No results yet.'}</div>
      ) : (
        width > 0 && <Lines series={live} xs={xs} yLabel={yLabel} width={width} />
      )}
    </div>
  );
}

function Lines({ series: live, xs, yLabel, width }: { series: Series[]; xs: string[]; yLabel: string; width: number }) {
  const narrow = width < 560;
  const H = narrow ? 300 : 380;
  const m = { l: 52, r: narrow ? 16 : 170, t: 16, b: 40 };
  const sx = (x: string) => m.l + ((width - m.l - m.r) * xs.indexOf(x)) / Math.max(1, xs.length - 1);
  const sy = (v: number) => m.t + (H - m.t - m.b) * (1 - v / 100);
  // End labels, nudged apart so they never overlap (top to bottom, 15px each).
  const ends = live
    .map((s) => {
      const pts = [...s.points].sort((a, b) => xs.indexOf(a.x) - xs.indexOf(b.x));
      const last = pts[pts.length - 1];
      return { key: s.key, x: sx(last.x), y: sy(last.y) };
    })
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) ends[i].y = Math.max(ends[i].y, ends[i - 1].y + 15);
  const labelY = new Map(ends.map((e) => [e.key, e.y]));
  return (
    <div className="chart-box">
      {(
        <svg width={width} height={H} className="chart" role="img" aria-label={`${yLabel} by effort`}>
          {[0, 25, 50, 75, 100].map((g) => (
            <g key={g}>
              <line x1={m.l} x2={width - m.r} y1={sy(g)} y2={sy(g)} className="grid-line" />
              <text x={m.l - 8} y={sy(g) + 4} textAnchor="end" className="axis-num">
                {g}
              </text>
            </g>
          ))}
          {xs.map((x) => (
            <text key={x} x={sx(x)} y={H - m.b + 20} textAnchor="middle" className="axis-num">
              {x}
            </text>
          ))}
          <text transform={`translate(14, ${(m.t + H - m.b) / 2}) rotate(-90)`} textAnchor="middle" className="axis-title">
            {yLabel}
          </text>
          {live.map((s) => {
            const pts = [...s.points].sort((a, b) => xs.indexOf(a.x) - xs.indexOf(b.x));
            const last = pts[pts.length - 1];
            return (
              <g key={s.key} className="line-g">
                <title>{`${s.label}: ${pts.map((p) => `${p.x} ${fmt1(p.y)}`).join(', ')}`}</title>
                <polyline points={pts.map((p) => `${sx(p.x)},${sy(p.y)}`).join(' ')} stroke={s.color} strokeDasharray={s.dash} className="line" />
                {pts.map((p) => (
                  <circle key={p.x} cx={sx(p.x)} cy={sy(p.y)} r={5.5} fill={s.color} className="dot" />
                ))}
                {!narrow && (
                  <text x={sx(last.x) + 12} y={(labelY.get(s.key) ?? sy(last.y)) + 4} className="dot-label">
                    {s.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
      {narrow && (
        <ul className="legend">
          {live.map((s) => (
            <li key={s.key}>
              <i style={{ background: s.color }} />
              {s.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
