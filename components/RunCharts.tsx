'use client';

// What runs took (cost, tokens, time) and how they went level by level: the same two cards on the Index, one
// bar or line per model, and on a model's page, one per effort.

import Link from 'next/link';
import { type ReactNode, useState } from 'react';
import { LevelChart, StackedBarChart, type StackItem, type StackPart, type XYSeries } from '@/components/charts';
import Exportable from '@/components/Exportable';
import { type LevelData, levelsOf, resultHref } from '@/lib/arena/aggregate';
import { fmtCost, fmtTokens } from '@/lib/arena/format';
import type { SuiteEntry } from '@/lib/arena/index-data';
import { GAUNTLET } from '@/lib/arena/rules';
import type { SuiteKind } from '@/lib/arena/suites';

export interface TestInfo {
  test: string;
  name: string;
}

type Resource = 'cost' | 'tokens' | 'time';
type Per = 'suite' | 'solve';

export const sizeOf = (test: string) => Number(test.split('x')[0]);

const SPEND_BLURB: Record<Resource, string> = {
  cost: 'What the run cost, split into what the tokens were for: thinking, answers (moves and tool calls), fresh input, and input read back from cache. Sessions its API cut off are left out.',
  tokens: 'Tokens the model wrote: its thinking, then its answers (moves and tool calls). Sessions its API cut off are left out.',
  time: 'Wall-clock time the model spent, by cube size. Time its API was down is left out.',
};

const SPEND_TITLE: Record<Resource, string> = { cost: 'cost', tokens: 'output tokens', time: 'time' };

const SPEND_EMPTY: Record<Resource, string> = {
  cost: 'No costs yet: they appear once a run reports its tokens.',
  tokens: 'No token counts yet.',
  time: 'No finished suites yet.',
};

const money = (v: number) => (v === 0 ? '$0' : fmtCost(v));
const round1 = (v: number) => String(Number(v.toFixed(v < 100 ? 1 : 0)));
/** Seconds, read in the unit that suits them. */
const span = (secs: number) => (secs < 60 ? `${Math.round(secs)}s` : secs < 3600 ? `${round1(secs / 60)} min` : `${round1(secs / 3600)} h`);
const SPAN_TICKS = [1, 10, 60, 600, 3600, 36_000];

const total = (it: StackItem) => it.whole ?? it.values.reduce<number>((a, v) => a + (v ?? 0), 0);

interface Spend {
  parts: StackPart[];
  items: StackItem[];
  format: (v: number) => string;
  axisFormat?: (v: number) => string;
  /** Results left out, and why. */
  left: { e: SuiteEntry; why: string }[];
  foot?: string;
}

/** The stacked bars for one measure: each result split into its parts. */
function spend(rows: SuiteEntry[], what: Resource, per: Per, sizes: number[], kind: SuiteKind, name: (e: SuiteEntry) => { label: string; sub: string | null }): Spend {
  const left: Spend['left'] = [];
  const items: StackItem[] = [];
  let estimated = false;
  for (const e of rows) {
    const d = per === 'solve' ? e.solved : 1;
    if (!d) {
      left.push({ e, why: 'no cube solved' });
      continue;
    }
    const base = { key: e.id, ...name(e), color: e.color, href: resultHref(e) };
    const split = (vs: (number | null)[]) => vs.map((v) => (v === null ? null : v / d));
    if (what === 'cost') {
      if (e.cost_usd === null) {
        left.push({ e, why: 'no cost reported' });
        continue;
      }
      estimated ||= e.cost_estimated;
      const p = e.cost_parts;
      const notes = [e.cost_estimated && 'Estimated from tokens at list prices.', p && p.reasoning === null && 'Its CLI doesn’t count thinking apart, so it is in answers.']
        .filter(Boolean)
        .join(' ');
      items.push(
        p
          ? { ...base, values: split([p.reasoning, p.answer, p.input, p.cached]), note: notes || undefined }
          : { ...base, values: [], whole: e.cost_usd / d, note: 'Not split: no list prices for this model.' },
      );
    } else if (what === 'tokens') {
      if (e.output_tokens === null) {
        left.push({ e, why: 'no tokens reported' });
        continue;
      }
      items.push(
        e.reasoning_tokens === null
          ? { ...base, values: [], whole: e.output_tokens / d, note: 'Its CLI doesn’t count thinking apart: this is all it wrote.' }
          : { ...base, values: split([e.reasoning_tokens, Math.max(0, e.output_tokens - e.reasoning_tokens)]) },
      );
    } else {
      const bySize = sizes.map((s) => Object.entries(e.test_secs).reduce((a, [t, v]) => a + (sizeOf(t) === s ? v : 0), 0));
      items.push(bySize.some((v) => v > 0) ? { ...base, values: split(bySize) } : { ...base, values: [], whole: e.secs / d });
    }
  }

  if (what === 'cost') {
    return {
      parts: [
        { key: 'reasoning', label: 'Thinking' },
        { key: 'answer', label: 'Answers' },
        { key: 'input', label: 'Input' },
        { key: 'cached', label: 'Cached input' },
      ],
      items,
      format: money,
      axisFormat: (v) => `$${Number(v.toPrecision(3))}`,
      left,
      foot: `Split at the model’s list prices, scaled to what the run cost.${estimated ? ' Some costs are estimated from tokens at list prices.' : ''} Many runs themselves used subscriptions.`,
    };
  }
  if (what === 'tokens') {
    return {
      parts: [
        { key: 'reasoning', label: 'Thinking' },
        { key: 'answer', label: 'Answers' },
      ],
      items,
      format: (v) => (v === 0 ? '0' : fmtTokens(Math.round(v))),
      left,
    };
  }
  // Time reads in the unit that suits the longest bar.
  const longest = Math.max(0, ...items.map(total));
  const [unit, fmt] = longest >= 2 * 3600 ? [3600, (v: number) => `${round1(v)} h`] : longest >= 120 ? [60, (v: number) => `${round1(v)} min`] : [1, (v: number) => `${Math.round(v)}s`];
  const scale = (v: number | null) => (v === null ? null : v / unit);
  return {
    parts: sizes.map((s) => ({ key: `s${s}`, label: kind === 'fast' && s === GAUNTLET.size ? `${s}×${s} ${GAUNTLET.name}` : `${s}×${s}` })),
    items: items.map((it) => ({ ...it, values: it.values.map(scale), whole: it.whole === undefined ? undefined : (scale(it.whole) as number) })),
    format: fmt,
    left,
  };
}

function Tabs<K extends string>({ value, set, options, label }: { value: K; set: (k: K) => void; options: readonly (readonly [K, string])[]; label: string }) {
  return (
    <div className="tab-row" role="tablist" aria-label={label}>
      {options.map(([k, name]) => (
        <button key={k} type="button" role="tab" aria-selected={value === k} className={`tab ${value === k ? 'on' : ''}`} onClick={() => set(k)}>
          {name}
        </button>
      ))}
    </div>
  );
}

function Seg<K extends string>({ value, set, options, label }: { value: K; set: (k: K) => void; options: readonly (readonly [K, string])[]; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(([k, name]) => (
        <button key={k} type="button" aria-pressed={value === k} onClick={() => set(k)}>
          {name}
        </button>
      ))}
    </div>
  );
}

/**
 * "What it took": cost, output tokens or time for each result, split into parts, for the whole suite or per cube
 * solved, on a linear or log scale. `least` sorts the bars least first; otherwise they keep the given order.
 */
export function SpendCard({
  id = 'spend',
  subject,
  rows,
  kind,
  tests,
  name,
  least = true,
}: {
  id?: string;
  /** Leads the saved image's title: "Cube Arena Fast", "Claude Opus 5.5 Fast". */
  subject: string;
  rows: SuiteEntry[];
  kind: SuiteKind;
  tests: TestInfo[];
  name: (e: SuiteEntry) => { label: string; sub: string | null };
  least?: boolean;
}) {
  // The first measure anything here has: a model whose CLI reports no cost opens on its tokens or time.
  const [resource, setResource] = useState<Resource>(() =>
    rows.some((e) => e.cost_usd !== null) ? 'cost' : rows.some((e) => e.output_tokens !== null) ? 'tokens' : 'time',
  );
  const [per, setPer] = useState<Per>('suite');
  const [log, setLog] = useState(false);
  const sizes = [...new Set(tests.map((t) => sizeOf(t.test)))].sort((a, b) => a - b);
  const spent = spend(rows, resource, per, sizes, kind, name);
  const items = least ? [...spent.items].sort((a, b) => total(a) - total(b)) : spent.items;
  return (
    <Exportable
      id={id}
      name={`${subject}: ${SPEND_TITLE[resource]}${per === 'solve' ? ' per cube solved' : ' for the whole suite'}${log ? ', log scale' : ''}`}
      className="card ix-card"
    >
      <header className="ix-head">
        <h2>What it took</h2>
        <p>
          {SPEND_BLURB[resource]} {per === 'solve' ? 'Divided by the cubes it solved, so solving more spreads it further.' : 'For the whole suite.'}
          {least && ' Least first.'}
          {log && ' Log scale: each bar’s parts show their share of it.'}
        </p>
      </header>
      <div className="ix-subtabs" data-noexport>
        <Tabs
          value={resource}
          set={setResource}
          label="Measure"
          options={[
            ['cost', 'Cost'],
            ['tokens', 'Output tokens'],
            ['time', 'Time'],
          ]}
        />
        <div className="ix-segs">
          <Seg
            value={per}
            set={setPer}
            label="Per"
            options={[
              ['suite', 'Whole suite'],
              ['solve', 'Per cube solved'],
            ]}
          />
          <Seg
            value={log ? 'log' : 'linear'}
            set={(v) => setLog(v === 'log')}
            label="Scale"
            options={[
              ['linear', 'Linear'],
              ['log', 'Log'],
            ]}
          />
        </div>
      </div>
      <StackedBarChart items={items} parts={spent.parts} format={spent.format} axisFormat={spent.axisFormat} log={log} empty={SPEND_EMPTY[resource]} />
      {items.length > 0 && (spent.left.length > 0 || spent.foot) && (
        <p className="ix-foot">
          {spent.foot}
          {spent.foot && spent.left.length > 0 && ' '}
          {spent.left.length > 0 && (
            <>
              Not shown:{' '}
              {spent.left.map(({ e, why }, i) => (
                <span key={e.id}>
                  {i > 0 && ', '}
                  <Link href={resultHref(e)}>{e.label}</Link> ({why})
                </span>
              ))}
              .
            </>
          )}
        </p>
      )}
    </Exportable>
  );
}

/**
 * "Level by level": moves per solve or time per try at each level of a ladder, one line per result. `ladders` are
 * the tests to choose from (with level data); the first 3×3 one shows first.
 */
export function LevelsCard({
  id = 'levels',
  subject,
  rows,
  levels,
  ladders,
  line,
  foot,
}: {
  id?: string;
  subject: string;
  rows: SuiteEntry[];
  levels: LevelData;
  ladders: TestInfo[];
  /** Each result's line: its name and colour. */
  line: (e: SuiteEntry) => { label: string; color: string; dash?: string };
  foot?: ReactNode;
}) {
  const [metric, setMetric] = useState<'moves' | 'time'>('moves');
  const [picked, setPicked] = useState<string | null>(null);
  // The first 3×3 ladder unless another is picked: 2×2s are short, and few models reach the bigger cubes.
  const ladder = ladders.find((t) => t.test === picked) ?? ladders.find((t) => sizeOf(t.test) === 3) ?? ladders[0];
  const series: XYSeries[] = ladder
    ? rows.map((e) => ({
        key: e.id,
        ...line(e),
        href: resultHref(e),
        points: levelsOf(levels, e, ladder.test).flatMap((p) =>
          metric === 'moves' ? (p.moves === null ? [] : [{ x: p.depth, y: p.moves }]) : [{ x: p.depth, y: p.secs }],
        ),
      }))
    : [];
  return (
    <Exportable id={id} name={`${subject}: ${metric === 'moves' ? 'moves per solve' : 'time per try'} by level, ${ladder?.name ?? 'ladders'}`} className="card ix-card">
      <header className="ix-head">
        <h2>Level by level</h2>
        <p>
          {metric === 'moves'
            ? 'The moves each solve took at each level of a ladder. Level N is scrambled N moves from solved, so the diagonal is the scramble undone move by move. A line that jumps off it has switched to a method of its own: longer, but it still works when the scramble is too deep to see.'
            : 'How long a try took at each level of a ladder, on a log scale. Time the model’s API was down is left out.'}
        </p>
      </header>
      <div className="ix-subtabs" data-noexport>
        <Tabs
          value={metric}
          set={setMetric}
          label="Measure"
          options={[
            ['moves', 'Moves per solve'],
            ['time', 'Time per try'],
          ]}
        />
        {ladders.length > 1 && (
          <label className="toggle on">
            <span className="toggle-key">Test</span>
            <span className="toggle-value">{ladder?.name}</span>
            <select aria-label="Test" value={ladder?.test} onChange={(e) => setPicked(e.target.value)}>
              {ladders.map((t) => (
                <option key={t.test} value={t.test}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <LevelChart
        series={series}
        xLabel="Level (moves from solved)"
        yLabel={metric === 'moves' ? 'Moves per solve' : 'Time per try (log scale)'}
        format={metric === 'moves' ? (v) => String(Math.round(v)) : span}
        log={metric === 'time'}
        ticks={metric === 'time' ? SPAN_TICKS : undefined}
        diagonal={metric === 'moves' ? 'Scramble length' : undefined}
        empty={metric === 'moves' ? 'No ladder cube solved yet.' : 'No ladder played yet.'}
      />
      {foot && <p className="ix-foot">{foot}</p>}
    </Exportable>
  );
}

/** The ladder tests that have level data for any of `rows`, in the suite's order. */
export function laddersOf(tests: TestInfo[], levels: LevelData, rows: SuiteEntry[]): TestInfo[] {
  return tests.filter((t) => levels.tests.includes(t.test) && rows.some((e) => levelsOf(levels, e, t.test).length > 0));
}

/**
 * Both cards for one model and suite, one bar and one line per effort, low to high. Effort is ordered, so the lines
 * are shades of the model's colour, the top effort the strongest, and neighbours alternate solid and dashed.
 */
export function ModelRunCharts({
  kind,
  subject,
  rows,
  tests,
  levels,
  model,
}: {
  kind: SuiteKind;
  subject: string;
  rows: SuiteEntry[];
  tests: TestInfo[];
  levels: LevelData;
  model: string;
}) {
  const ladders = laddersOf(tests, levels, rows);
  const n = rows.length;
  const shade = (i: number) => (n < 2 ? 100 : Math.round(30 + (70 * i) / (n - 1)));
  const index = new Map(rows.map((e, i) => [e.id, i]));
  return (
    <>
      <SpendCard id={`${kind}-spend`} subject={subject} rows={rows} kind={kind} tests={tests} name={(e) => ({ label: e.effort ?? model, sub: null })} least={false} />
      {ladders.length > 0 && (
        <LevelsCard
          id={`${kind}-levels`}
          subject={subject}
          rows={rows}
          levels={levels}
          ladders={ladders}
          line={(e) => {
            const i = index.get(e.id) ?? 0;
            return { label: e.effort ?? model, color: `color-mix(in oklab, ${e.color} ${shade(i)}%, var(--text-3))`, dash: (n - 1 - i) % 2 ? '7 5' : undefined };
          }}
        />
      )}
    </>
  );
}
