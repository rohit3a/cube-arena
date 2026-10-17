'use client';

// Charts for the index, drawn as SVG at the container's real width (so text
// stays readable on phones), in the site's toy-box style: outlined bars,
// maker colours, mono numbers. No chart library.

import Link from 'next/link';
import { type ReactNode, useId, useLayoutEffect, useRef, useState } from 'react';

/** An in-page link (#…) is left to the browser, so its target lights up (:target); the rest go through Next. */
function Go({ href, children }: { href: string; children: ReactNode }) {
  return href.startsWith('#') ? <a href={href}>{children}</a> : <Link href={href}>{children}</Link>;
}

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
  // Scores keep their quarters; any other measure gets round ticks up to its max.
  const score = max === 100;
  const ticks = score ? [0, 25, 50, 75, 100] : upTicks(max);
  const hi = ticks[ticks.length - 1] || 1;
  const y = (v: number) => top + height - (height * Math.max(0, Math.min(v, hi))) / hi;
  return (
    <div className="chart-scroll">
      {(
        <svg width={W} height={H} className="chart" role="img" aria-label="Bar chart">
          <defs>
            <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="3" height="6" fill="var(--card)" opacity="0.55" />
            </pattern>
          </defs>
          {ticks.map((g) => (
            <g key={g}>
              <line x1={left - 8} x2={W} y1={y(g)} y2={y(g)} className="grid-line" />
              <text x={left - 14} y={y(g) + 4} className="axis-num" textAnchor="end">
                {score ? g : format(g)}
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
              <Go key={it.key} href={it.href}>
                {body}
              </Go>
            ) : (
              <g key={it.key}>{body}</g>
            );
          })}
          {reference && reference.value <= hi && (
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
            <span className="hbar-label">{it.href ? <Go href={it.href}>{name}</Go> : name}</span>
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
  /** Points of one group (a model's efforts) are joined by a line, low x to high. */
  group?: string;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Where each dot's label goes: right, left, above or below the dot, the first spot that stays in the chart and clear
 * of the other labels and dots. Labels that fit nowhere are left to the readout. `first` are placed before the rest.
 */
function placeLabels(
  dots: { key: string; label: string; cx: number; cy: number }[],
  first: Set<string>,
  bounds: Box,
  obstacles: Box[] = [],
): Map<string, Box> {
  const taken: Box[] = [...dots.map((d) => ({ x: d.cx - 8, y: d.cy - 8, w: 16, h: 16 })), ...obstacles];
  const out = new Map<string, Box>();
  const order = [...dots].sort((a, b) => Number(first.has(b.key)) - Number(first.has(a.key)) || a.cy - b.cy);
  for (const d of order) {
    const w = d.label.length * 6.3 + 4;
    const h = 14;
    const spots: Box[] = [
      { x: d.cx + 11, y: d.cy - 8, w, h },
      { x: d.cx - 11 - w, y: d.cy - 8, w, h },
      { x: d.cx - w / 2, y: d.cy - 25, w, h },
      { x: d.cx - w / 2, y: d.cy + 10, w, h },
    ];
    const own = (b: Box) => b.x === d.cx - 8 && b.y === d.cy - 8;
    const spot = spots.find(
      (b) => b.x >= bounds.x && b.x + b.w <= bounds.x + bounds.w && b.y >= bounds.y - 4 && b.y + b.h <= bounds.y + bounds.h && !taken.some((t) => !own(t) && overlaps(b, t)),
    );
    if (spot) {
      taken.push(spot);
      out.set(d.key, spot);
    }
  }
  return out;
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
  // On a phone only the front gets a label; everyone else is in the readout.
  const frontKeys = new Set(front.map((p) => p.key));
  const labels = placeLabels(
    usable.filter((p) => !narrow || frontKeys.has(p.key)).map((p) => ({ key: p.key, label: p.label, cx: sx(p.x), cy: sy(p.y) })),
    frontKeys,
    { x: m.l, y: m.t, w: width - m.l - m.r, h: H - m.t - m.b },
  );
  const groups = new Map<string, Point[]>();
  for (const p of usable) if (p.group) groups.set(p.group, [...(groups.get(p.group) ?? []), p]);
  const [tip, setTip] = useState<TipState | null>(null);
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
          {[...groups.entries()]
            .filter(([, ps]) => ps.length > 1)
            .map(([g, ps]) => (
              <polyline key={g} points={[...ps].sort((a, b) => a.x - b.x).map((p) => `${sx(p.x)},${sy(p.y)}`).join(' ')} stroke={ps[0].color} className="join" />
            ))}
          {usable.map((p) => {
            const cx = sx(p.x);
            const cy = sy(p.y);
            const at = labels.get(p.key);
            const show = () => setTip({ x: cx, y: cy, title: p.label, rows: [{ key: 'y', value: fmt1(p.y), label: yLabel }, { key: 'x', value: xFormat(p.x), label: xLabel }] });
            const dot = (
              <g className="dot-g" tabIndex={0} onPointerEnter={show} onFocus={show} onPointerLeave={() => setTip(null)} onBlur={() => setTip(null)}>
                <circle cx={cx} cy={cy} r={14} className="hit" />
                <circle cx={cx} cy={cy} r={7} fill={p.color} className="dot" />
                {at && (
                  <text x={at.x} y={at.y + 11} className="dot-label">
                    {p.label}
                  </text>
                )}
              </g>
            );
            return p.href ? (
              <Go key={p.key} href={p.href}>
                {dot}
              </Go>
            ) : (
              <g key={p.key}>{dot}</g>
            );
          })}
        </svg>
      )}
      <Tip tip={tip} width={width} />
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

// ---------------------------------------------------------------------------
// The hover readout: one box beside the pointer, values first.

interface TipRow {
  key: string;
  value: string;
  label: string;
  /** A short key in the series colour (and its shade, for a part of a bar). */
  color?: string;
  shade?: number;
}

interface TipState {
  x: number;
  y: number;
  title: string;
  rows: TipRow[];
}

function Tip({ tip, width }: { tip: TipState | null; width: number }) {
  if (!tip) return null;
  const w = 240;
  const left = tip.x + 16 + w > width ? Math.max(0, tip.x - 16 - w) : tip.x + 16;
  return (
    <div className="chart-tip" style={{ left, top: Math.max(0, tip.y - 12) }} role="status">
      <div className="chart-tip-title">{tip.title}</div>
      {tip.rows.map((r) => (
        <div key={r.key} className="chart-tip-row">
          {r.color ? <i style={{ background: r.color, opacity: r.shade ?? 1 }} /> : <i className="none" />}
          <b>{r.value}</b>
          <span>{r.label}</span>
        </div>
      ))}
    </div>
  );
}

/** Axis ticks from 0 to a round number at or above `max`, about five of them. */
function upTicks(max: number): number[] {
  if (!(max > 0)) return [0, 1];
  const raw = max / 5;
  const step = 10 ** Math.floor(Math.log10(raw));
  const nice = [1, 2, 2.5, 5, 10].map((k) => k * step).find((s) => max / s <= 5.5) ?? step * 10;
  const out: number[] = [];
  for (let v = 0; v < max + nice * 0.999; v += nice) out.push(Number(v.toFixed(10)));
  return out;
}

// ---------------------------------------------------------------------------
// Stacked bars: what each model's run took (cost, tokens, time), split into its
// parts. A bar keeps its maker's colour; its parts are shades of it, the main
// part darkest at the baseline. Sorted by the caller (least first).

export interface StackPart {
  key: string;
  label: string;
}

export interface StackItem {
  key: string;
  label: string;
  sub?: string | null;
  color: string;
  href?: string;
  /** One value per part, in the parts' order; null where it wasn't counted. */
  values: (number | null)[];
  /** Instead of parts: the whole, drawn as one block, when it can't be split (say why in `note`). */
  whole?: number;
  /** A note for the readout, e.g. why a part is missing. */
  note?: string;
}

const SHADES: number[][] = [[1], [1], [1, 0.42], [1, 0.62, 0.32], [1, 0.7, 0.45, 0.25]];
const shadeOf = (n: number, i: number) => (SHADES[n] ?? SHADES[4])[i] ?? 0.25;
const totalOf = (it: StackItem) => it.whole ?? it.values.reduce<number>((a, v) => a + (v ?? 0), 0);
/** What a bar draws: its parts, or its whole as the first part. */
const drawn = (it: StackItem) => (it.whole !== undefined ? [it.whole] : it.values);

export function StackedBarChart({
  items,
  parts,
  format,
  height = 240,
  empty,
}: {
  items: StackItem[];
  parts: StackPart[];
  format: (v: number) => string;
  height?: number;
  empty?: ReactNode;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  return (
    <div ref={ref} className="chart-wrap">
      {items.length === 0 ? (
        <div className="chart-empty">{empty ?? 'No results yet.'}</div>
      ) : width > 0 && width < 560 ? (
        <HStack items={items} parts={parts} format={format} />
      ) : (
        width > 0 && <VStack items={items} parts={parts} format={format} height={height} width={width} />
      )}
      {items.length > 0 && parts.length > 1 && (
        <ul className="legend">
          {parts.map((p, i) => (
            <li key={p.key}>
              <i style={{ background: `color-mix(in oklab, var(--text-2) ${Math.round(shadeOf(parts.length, i) * 100)}%, var(--card))` }} />
              {p.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function readout(it: StackItem, parts: StackPart[], format: (v: number) => string): TipRow[] {
  const total = totalOf(it);
  const rows: TipRow[] = [{ key: 'total', value: format(total), label: parts.length > 1 ? 'in all' : parts[0]?.label ?? '' }];
  if (parts.length > 1 && it.whole === undefined) {
    parts.forEach((p, i) => {
      const v = it.values[i];
      if (v === null || v <= 0) return;
      rows.push({ key: p.key, value: format(v), label: `${p.label} · ${Math.round((100 * v) / (total || 1))}%`, color: it.color, shade: shadeOf(parts.length, i) });
    });
  }
  if (it.note) rows.push({ key: 'note', value: '', label: it.note });
  return rows;
}

function VStack({ items, parts, format, height, width }: { items: StackItem[]; parts: StackPart[]; format: (v: number) => string; height: number; width: number }) {
  const uid = useId().replace(/:/g, '');
  const [tip, setTip] = useState<TipState | null>(null);
  const rad = (42 * Math.PI) / 180;
  const len = (it: StackItem) => (it.label.length + (it.sub ? it.sub.length + 1 : 0)) * 6.6;
  const first = items[0] ? len(items[0]) * Math.cos(rad) : 0;
  const longest = Math.max(0, ...items.map(len));
  const slot = Math.max(38, Math.min(76, (width - 70) / items.length));
  const left = Math.max(56, first - slot / 2 + 8);
  const x0 = Math.max(left, (width - slot * items.length) / 2);
  const bar = Math.min(40, slot * 0.64);
  const labelH = Math.min(130, longest * Math.sin(rad) + 28);
  const top = 22;
  const W = Math.max(width, left + slot * items.length);
  const H = top + height + labelH;
  const ticks = upTicks(Math.max(0, ...items.map(totalOf)));
  const max = ticks[ticks.length - 1] || 1;
  const y = (v: number) => top + height - (height * Math.max(0, v)) / max;
  return (
    <div className="chart-scroll chart-box">
      <svg width={W} height={H} className="chart" role="img" aria-label="Stacked bar chart">
        {ticks.map((g) => (
          <g key={g}>
            <line x1={left - 8} x2={W} y1={y(g)} y2={y(g)} className="grid-line" />
            <text x={left - 14} y={y(g) + 4} className="axis-num" textAnchor="end">
              {format(g)}
            </text>
          </g>
        ))}
        {items.map((it, i) => {
          const cx = x0 + slot * i + slot / 2;
          const total = totalOf(it);
          const h = Math.max(top + height - y(total), 2);
          const base = top + height;
          let acc = 0;
          const show = () => setTip({ x: cx + bar / 2, y: base - h, title: `${it.label}${it.sub ? ` (${it.sub})` : ''}`, rows: readout(it, parts, format) });
          const body = (
            <g className="bar-g" tabIndex={0} onPointerEnter={show} onFocus={show} onPointerLeave={() => setTip(null)} onBlur={() => setTip(null)}>
              <clipPath id={`${uid}-${i}`}>
                <rect x={cx - bar / 2} y={base - h} width={bar} height={h} rx={5} />
              </clipPath>
              <rect x={cx - slot / 2} y={top} width={slot} height={height} className="hit" />
              <g clipPath={`url(#${uid}-${i})`}>
                {drawn(it).map((v, k) => {
                  if (v === null || v <= 0) return null;
                  const y1 = y(acc);
                  acc += v;
                  const y2 = y(acc);
                  return <rect key={k} x={cx - bar / 2} y={y2} width={bar} height={Math.max(0, y1 - y2)} fill={it.color} opacity={shadeOf(parts.length, k)} />;
                })}
                {(() => {
                  // The gaps between parts, in the card's colour.
                  let a = 0;
                  return drawn(it).slice(0, -1).map((v, k) => {
                    a += v ?? 0;
                    return v && v > 0 && a < total ? <line key={k} x1={cx - bar / 2} x2={cx + bar / 2} y1={y(a)} y2={y(a)} className="part-gap" /> : null;
                  });
                })()}
              </g>
              <rect x={cx - bar / 2} y={base - h} width={bar} height={h} rx={5} className="bar outline" />
              <text x={cx} y={base - h - 7} textAnchor="middle" className="bar-num">
                {format(total)}
              </text>
              <text transform={`translate(${cx + 4}, ${base + 12}) rotate(-42)`} textAnchor="end" className="bar-label">
                {it.label}
                {it.sub && <tspan className="bar-sub"> {it.sub}</tspan>}
              </text>
            </g>
          );
          return it.href ? (
            <Go key={it.key} href={it.href}>
              {body}
            </Go>
          ) : (
            <g key={it.key}>{body}</g>
          );
        })}
      </svg>
      <Tip tip={tip} width={W} />
    </div>
  );
}

function HStack({ items, parts, format }: { items: StackItem[]; parts: StackPart[]; format: (v: number) => string }) {
  const max = Math.max(0, ...items.map(totalOf)) || 1;
  return (
    <ol className="hbars">
      {items.map((it) => {
        const name = (
          <>
            <span className="hbar-name">{it.label}</span>
            {it.sub && <span className="hbar-sub">{it.sub}</span>}
          </>
        );
        const rows = readout(it, parts, format);
        return (
          <li key={it.key} title={rows.map((r) => `${r.value} ${r.label}`.trim()).join('\n')}>
            <span className="hbar-label">{it.href ? <Go href={it.href}>{name}</Go> : name}</span>
            <span className="hbar-track stack">
              {drawn(it).map((v, k) =>
                v && v > 0 ? (
                  <span
                    key={k}
                    className="hbar-part"
                    style={{ width: `${(100 * v) / max}%`, background: `color-mix(in oklab, ${it.color} ${Math.round(shadeOf(parts.length, k) * 100)}%, var(--card))` }}
                  />
                ) : null,
              )}
            </span>
            <span className="hbar-num wide">{format(totalOf(it))}</span>
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// Level by level: one line per model across a ladder's levels (moves, time).
// Hovering anywhere over the plot reads every line at that level.

export interface XYSeries {
  key: string;
  label: string;
  color: string;
  dash?: string;
  href?: string;
  points: { x: number; y: number }[];
}

export function LevelChart({
  series,
  xLabel,
  yLabel,
  format,
  log = false,
  diagonal,
  ticks,
  empty,
}: {
  series: XYSeries[];
  xLabel: string;
  yLabel: string;
  format: (v: number) => string;
  log?: boolean;
  /** Draws y = x with this label: e.g. the scramble's length, the fewest moves we know of. */
  diagonal?: string;
  /** Y ticks to use instead of round numbers (e.g. 1s, 10s, 1 min, 10 min, 1 h); the axis spans those around the data. */
  ticks?: number[];
  empty?: ReactNode;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const live = series.filter((s) => s.points.some((p) => !log || p.y > 0));
  return (
    <div ref={ref} className="chart-wrap">
      {live.length === 0 ? (
        <div className="chart-empty">{empty ?? 'No results yet.'}</div>
      ) : (
        width > 0 && <Levels series={live} xLabel={xLabel} yLabel={yLabel} format={format} log={log} diagonal={diagonal} ticks={ticks} width={width} />
      )}
    </div>
  );
}

function Levels({
  series,
  xLabel,
  yLabel,
  format,
  log,
  diagonal,
  ticks,
  width,
}: {
  series: XYSeries[];
  xLabel: string;
  yLabel: string;
  format: (v: number) => string;
  log: boolean;
  diagonal?: string;
  ticks?: number[];
  width: number;
}) {
  const [at, setAt] = useState<number | null>(null);
  const narrow = width < 560;
  const H = narrow ? 300 : 400;
  const m = { l: 56, r: narrow ? 16 : 180, t: 16, b: 50 };
  const pts = series.flatMap((s) => s.points.filter((p) => !log || p.y > 0));
  const xs = [...new Set(pts.map((p) => p.x))].sort((a, b) => a - b);
  const xLo = xs[0];
  const xHi = Math.max(xs[xs.length - 1], xLo + 1);
  const yMaxData = Math.max(...pts.map((p) => p.y), diagonal ? xHi : 0);
  let yLo = 0;
  let yHi: number;
  let yTicks: number[];
  const yMinData = Math.min(...pts.map((p) => p.y));
  if (ticks?.length) {
    yLo = [...ticks].reverse().find((t) => t <= yMinData) ?? ticks[0];
    yHi = ticks.find((t) => t >= yMaxData) ?? ticks[ticks.length - 1];
    yTicks = ticks.filter((t) => t >= yLo && t <= yHi);
  } else if (log) {
    yLo = 10 ** Math.floor(Math.log10(yMinData));
    yHi = 10 ** Math.ceil(Math.log10(yMaxData));
    yTicks = niceTicks(yLo, yHi, true);
  } else {
    yTicks = upTicks(yMaxData);
    yHi = yTicks[yTicks.length - 1] || 1;
  }
  const pw = width - m.l - m.r;
  const sx = (v: number) => m.l + (pw * (v - xLo)) / (xHi - xLo);
  const sy = (v: number) =>
    m.t + (H - m.t - m.b) * (1 - (log ? (Math.log10(Math.max(v, yLo)) - Math.log10(yLo)) / (Math.log10(yHi) - Math.log10(yLo)) : v / yHi));
  const step = Math.max(1, Math.ceil((xHi - xLo) / Math.max(1, Math.floor(pw / 34))));
  const xTicks = xs.filter((x) => (x - xLo) % step === 0);
  const lastOf = (s: XYSeries) => s.points.filter((p) => !log || p.y > 0).at(-1) as { x: number; y: number };
  // Lines that reach the last level are labelled in the margin, nudged apart (top to bottom, 15px each).
  const ends = series
    .filter((s) => lastOf(s).x === xHi)
    .map((s) => ({ key: s.key, y: sy(lastOf(s).y) }))
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) ends[i].y = Math.max(ends[i].y, ends[i - 1].y + 15);
  const labelY = new Map(ends.map((e) => [e.key, e.y]));
  // Lines that stop early are labelled where they stop, if there is room clear of the dots and the
  // diagonal's label; the legend and the readout name the rest.
  const dx = Math.min(xHi, yHi);
  const diag = diagonal ? { xm: xLo + 0.45 * (dx - xLo), deg: (Math.atan2(sy(dx) - sy(xLo), sx(dx) - sx(xLo)) * 180) / Math.PI } : null;
  const diagBox = diag && diagonal ? [{ x: sx(diag.xm) - diagonal.length * 3.4, y: sy(diag.xm) + 2, w: diagonal.length * 6.8, h: 18 }] : [];
  const early = narrow
    ? new Map<string, Box>()
    : placeLabels(
        series.filter((s) => lastOf(s).x !== xHi).map((s) => ({ key: s.key, label: s.label, cx: sx(lastOf(s).x), cy: sy(lastOf(s).y) })),
        new Set(),
        { x: m.l, y: m.t, w: width - m.l - 8, h: H - m.t - m.b },
        [
          ...diagBox,
          ...series.flatMap((s) => s.points.filter((p) => p.x !== lastOf(s).x).map((p) => ({ x: sx(p.x) - 5, y: sy(p.y) - 5, w: 10, h: 10 }))),
          ...ends.map((e) => ({ x: width - m.r + 4, y: e.y - 10, w: m.r, h: 14 })),
        ],
      );
  const move = (ev: React.PointerEvent<SVGRectElement>) => {
    const box = ev.currentTarget.getBoundingClientRect();
    const v = xLo + ((ev.clientX - box.left) / box.width) * (xHi - xLo);
    setAt(xs.reduce((best, x) => (Math.abs(x - v) < Math.abs(best - v) ? x : best), xs[0]));
  };
  const rows: TipRow[] =
    at === null
      ? []
      : series
          .flatMap((s) => {
            const p = s.points.find((q) => q.x === at);
            return p ? [{ key: s.key, value: format(p.y), label: s.label, color: s.color, y: p.y }] : [];
          })
          .sort((a, b) => b.y - a.y)
          .map(({ y: _y, ...r }) => r);
  return (
    <div className="chart-box">
      <svg width={width} height={H} className="chart" role="img" aria-label={`${yLabel} by ${xLabel}`}>
        {yTicks.map((g) => (
          <g key={g}>
            <line x1={m.l} x2={width - m.r} y1={sy(g)} y2={sy(g)} className="grid-line" />
            <text x={m.l - 8} y={sy(g) + 4} textAnchor="end" className="axis-num">
              {format(g)}
            </text>
          </g>
        ))}
        {xTicks.map((x) => (
          <text key={x} x={sx(x)} y={H - m.b + 18} textAnchor="middle" className="axis-num">
            {x}
          </text>
        ))}
        <text x={(m.l + width - m.r) / 2} y={H - 10} textAnchor="middle" className="axis-title">
          {xLabel}
        </text>
        <text transform={`translate(14, ${(m.t + H - m.b) / 2}) rotate(-90)`} textAnchor="middle" className="axis-title">
          {yLabel}
        </text>
        {diagonal && (
          <g>
            <line x1={sx(xLo)} y1={sy(xLo)} x2={sx(xHi)} y2={sy(Math.min(xHi, yHi))} className="ref-line" />
            {/* Under the line, along it, part way: clear of the margin labels and of lines riding on it. */}
            {diag && (
              <text transform={`translate(${sx(diag.xm)}, ${sy(diag.xm) + 15}) rotate(${diag.deg})`} textAnchor="middle" className="ref-label">
                {diagonal}
              </text>
            )}
          </g>
        )}
        {at !== null && <line x1={sx(at)} x2={sx(at)} y1={m.t} y2={H - m.b} className="crosshair" />}
        {series.map((s) => {
          const ps = s.points.filter((p) => !log || p.y > 0);
          const last = ps[ps.length - 1];
          const spot = early.get(s.key);
          return (
            <g key={s.key} className="line-g">
              <polyline points={ps.map((p) => `${sx(p.x)},${sy(p.y)}`).join(' ')} stroke={s.color} strokeDasharray={s.dash} className="line thin" />
              {ps.map((p) => (
                <circle key={p.x} cx={sx(p.x)} cy={sy(p.y)} r={p.x === at ? 5.5 : 3.5} fill={s.color} className="dot" />
              ))}
              {!narrow && labelY.has(s.key) && (
                <text x={sx(last.x) + 10} y={(labelY.get(s.key) as number) + 4} className="dot-label">
                  {s.label}
                </text>
              )}
              {spot && (
                <text x={spot.x + 2} y={spot.y + 11} className="dot-label">
                  {s.label}
                </text>
              )}
            </g>
          );
        })}
        <rect x={m.l} y={m.t} width={pw} height={H - m.t - m.b} className="hit" onPointerMove={move} onPointerLeave={() => setAt(null)} />
      </svg>
      {at !== null && rows.length > 0 && <Tip tip={{ x: sx(at), y: m.t + 8, title: `${xLabel.replace(/ \(.*\)$/, '')} ${at}`, rows }} width={width} />}
      <ul className="legend">
        {series.map((s) => (
          <li key={s.key}>
            <i className="line-key" style={{ background: s.color }} />
            {s.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
