'use client';

// The comparison page: a picker for 2-4 models (each at an effort or its
// best), then the same facts for each side by side. Every card saves as an
// image (Exportable). The picks live in the URL, so a comparison is a link.

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type CSSProperties, type ReactNode, useTransition } from 'react';
import { BarChart, LineChart, type Series } from '@/components/charts';
import CopyButton from '@/components/CopyButton';
import Exportable from '@/components/Exportable';
import type { LevelTries, ModelOption, Pick, Side, SuiteSide } from '@/lib/arena/compare';
import { fmtCost, fmtDuration, fmtMs, fmtScore, fmtTokens, heat } from '@/lib/arena/format';
import { EFFORT_ORDER } from '@/lib/arena/makers';

const MAX = 4;
/** One colour per side, so two models from one maker still tell apart. */
const SIDE_COLORS = ['var(--orange)', 'var(--blue)', 'var(--green)', 'var(--purple)'];
const pickParam = (p: Pick) => (p.effort ? `${p.slug}:${p.effort}` : p.slug);
const href = (picks: Pick[]) => `/compare?${picks.map((p) => `m=${encodeURIComponent(pickParam(p))}`).join('&')}`;

type TestName = { test: string; name: string; short: string };

const labelOf = (s: Side) => (s.effort ? `${s.model} (${s.effort})` : s.model);

export default function CompareView({ sides, options, fastTests, thoroughTests }: { sides: Side[]; options: ModelOption[]; fastTests: TestName[]; thoroughTests: TestName[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const picks = sides.map((s) => s.pick);
  const go = (next: Pick[]) => start(() => router.push(href(next), { scroll: false }));
  const colored = sides.map((s, i) => ({ ...s, color: SIDE_COLORS[i % SIDE_COLORS.length], label: labelOf(s) }));
  const title = colored.map((s) => s.label).join(' vs ');

  return (
    <div className={`cmp ${pending ? 'cmp-pending' : ''}`}>
      <div className="cmp-picker card" role="group" aria-label="Models to compare">
        {colored.map((s, i) => (
          <SlotPicker
            key={`${i}-${pickParam(s.pick)}`}
            side={s}
            options={options}
            onChange={(p) => go(picks.map((x, j) => (j === i ? p : x)))}
            onRemove={sides.length > 1 ? () => go(picks.filter((_, j) => j !== i)) : undefined}
          />
        ))}
        {sides.length < MAX && (
          <label className="cmp-add">
            <span aria-hidden>+</span>
            <select
              aria-label="Add a model"
              value=""
              onChange={(e) => {
                if (e.target.value) go([...picks, { slug: e.target.value, effort: null }]);
              }}
            >
              <option value="">Add a model</option>
              <ModelOptions options={options} />
            </select>
          </label>
        )}
        <div className="cmp-share">
          <CopyButton text={typeof window === 'undefined' ? href(picks) : `${window.location.origin}${href(picks)}`} label="Copy link" />
        </div>
      </div>

      {sides.length === 0 ? (
        <div className="card chart-empty">Pick a model to start.</div>
      ) : (
        <>
          <Cards sides={colored} title={title} />
          <HeadToHead sides={colored} fastTests={fastTests} title={title} />
          <FastByTest sides={colored} fastTests={fastTests} title={title} />
          <Levels sides={colored} fastTests={fastTests} title={title} />
          <EffortCurve sides={colored} title={title} />
          <Coding sides={colored} title={title} />
          <Thorough sides={colored} tests={thoroughTests} title={title} />
          <p className="board-foot">
            {colored.map((s, i) => (
              <span key={s.slug + i}>
                {i > 0 && ' · '}
                <Link href={`/models/${s.slug}`}>{s.model}</Link>
              </span>
            ))}{' '}
            · <Link href="/benchmark">The Index</Link> · <Link href="/code">Coding board</Link>
          </p>
        </>
      )}
    </div>
  );
}

type Colored = Side & { color: string; label: string };

function ModelOptions({ options }: { options: ModelOption[] }) {
  const groups = [
    ['Verified', options.filter((o) => o.board === 'verified')],
    ['Community (self-reported)', options.filter((o) => o.board === 'community')],
  ] as const;
  return groups.map(([name, os]) =>
    os.length ? (
      <optgroup key={name} label={name}>
        {os.map((o) => (
          <option key={o.slug} value={o.slug}>
            {o.model}
          </option>
        ))}
      </optgroup>
    ) : null,
  );
}

function SlotPicker({ side, options, onChange, onRemove }: { side: Colored; options: ModelOption[]; onChange: (p: Pick) => void; onRemove?: () => void }) {
  const opt = options.find((o) => o.slug === side.slug);
  const efforts = opt?.efforts ?? side.efforts;
  return (
    <div className="cmp-slot" style={{ '--side': side.color } as CSSProperties}>
      <i className="cmp-dot" aria-hidden />
      <select aria-label="Model" value={side.slug} onChange={(e) => onChange({ slug: e.target.value, effort: null })}>
        {!opt && <option value={side.slug}>{side.model}</option>}
        <ModelOptions options={options} />
      </select>
      {efforts.length > 0 && (
        <select aria-label="Effort" value={side.pick.effort ?? ''} onChange={(e) => onChange({ slug: side.slug, effort: e.target.value || null })}>
          <option value="">Best{side.pick.effort === null && side.effort ? ` (${side.effort})` : ''}</option>
          {efforts.map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
      )}
      {onRemove && (
        <button type="button" className="cmp-x" onClick={onRemove} aria-label={`Remove ${side.label}`}>
          ×
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// One card per side: the headline numbers, each card its own image.

function Cards({ sides, title }: { sides: Colored[]; title: string }) {
  return (
    <Exportable name={`${title} overview`} caption={title} className="cmp-cards-wrap">
      <div className="cmp-cards" style={{ '--n': sides.length } as CSSProperties}>
        {sides.map((s) => (
          <Exportable as="article" key={s.slug + s.effort} name={`${s.label} card`} caption={s.label} className="card cmp-card">
            <header style={{ '--side': s.color } as CSSProperties}>
              <i className="cmp-dot" aria-hidden />
              <div>
                <h2>{s.model}</h2>
                <p className="muted">
                  {s.maker}
                  {s.effort ? ` · ${s.effort} effort` : ''} {s.board === 'community' ? <span className="badge">Community</span> : <span className="badge verified">Verified</span>}
                </p>
              </div>
            </header>
            {s.missing ? (
              <p className="muted">No results for this model yet.</p>
            ) : (
              <dl>
                <Stat label="Fast Index" big value={s.fast ? fmtScore(s.fast.avg.score) : '–'} note={s.fast ? `#${s.fast.rank} of ${s.fast.of}${s.fast.avg.n > 1 ? ` · avg of ${s.fast.avg.n}` : ''}` : 'not run at this effort'} />
                <Stat label="Thorough" value={s.thorough ? fmtScore(s.thorough.avg.score) : '–'} note={s.thorough ? `#${s.thorough.rank} of ${s.thorough.of}` : 'not run'} />
                <Stat
                  label="Coding"
                  value={s.coding ? fmtScore(s.coding.best.score) : '–'}
                  note={
                    s.coding
                      ? `#${s.coding.rank} of ${s.coding.of}${s.coding.other_effort ? ` · at ${s.coding.best.effort}` : ''}${s.coding.runs.length > 1 ? ` · ${s.coding.runs.length} runs` : ''}`
                      : 'not run'
                  }
                />
                <Stat label="Moves / solve" value={num1(s.fast?.avg.moves_per_solve ?? null)} note={s.fast ? `${s.fast.avg.solved} cubes solved` : ''} />
                <Stat label="Cost (Fast)" value={s.fast ? fmtCost(s.fast.avg.cost_usd) : '–'} note={s.fast ? fmtDuration(s.fast.avg.secs) : ''} />
              </dl>
            )}
          </Exportable>
        ))}
      </div>
    </Exportable>
  );
}

function Stat({ label, value, note, big }: { label: string; value: string; note?: string; big?: boolean }) {
  return (
    <div className={`cmp-stat ${big ? 'big' : ''}`}>
      <dt>{label}</dt>
      <dd>
        <strong>{value}</strong>
        {note && <em>{note}</em>}
      </dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Head to head: one row per measure, the best side marked.

interface Row {
  label: string;
  get: (s: Colored) => number | null;
  show?: (s: Colored) => string;
  better?: 'high' | 'low';
  title?: string;
}

function HeadToHead({ sides, fastTests, title }: { sides: Colored[]; fastTests: TestName[]; title: string }) {
  const f = (s: Colored) => s.fast?.avg ?? null;
  const { moves: shared, levels: sharedLevels } = sharedCubes(sides);
  const fastRows: Row[] = [
    { label: 'Fast Index', get: (s) => f(s)?.score ?? null, show: (s) => fmtScore(f(s)?.score ?? null), better: 'high' },
    { label: 'Rank on the Fast Index', get: (s) => s.fast?.rank ?? null, show: (s) => (s.fast ? `#${s.fast.rank} of ${s.fast.of}` : '–'), better: 'low' },
    ...fastTests.map<Row>((t) => ({
      label: t.name,
      get: (s) => f(s)?.tests.find((x) => x.test === t.test)?.score ?? null,
      show: (s) => {
        const d = s.fast?.tests.find((x) => x.test === t.test);
        const v = f(s)?.tests.find((x) => x.test === t.test)?.score ?? null;
        return d?.max && d.best_level !== null ? `${fmtScore(v)} · L${d.best_level}/${d.max}` : fmtScore(v);
      },
      better: 'high',
      title: 'Test score out of 100, and the best level reached (in the best run)',
    })),
    { label: 'Cubes solved', get: (s) => f(s)?.solved ?? null, better: 'high' },
    {
      label: 'Moves on the shared cubes',
      get: (s) => shared.get(s) ?? null,
      show: (s) => (shared.has(s) ? `${shared.get(s)} on ${sharedLevels} levels` : '–'),
      better: 'low',
      title: 'Total moves on the levels every model here solved on its first try: the same cubes for all of them',
    },
    // Raw totals depend on how far each got, so they get no star; per point does.
    { label: 'Moves per cube solved', get: (s) => f(s)?.moves_per_solve ?? null, show: (s) => num1(f(s)?.moves_per_solve ?? null), title: 'Lower is not better on its own: a model that stops early solves only short cubes' },
    { label: 'Time', get: (s) => f(s)?.secs ?? null, show: (s) => (f(s) ? fmtDuration(f(s)?.secs ?? 0) : '–') },
    { label: 'Input tokens', get: (s) => f(s)?.input_tokens ?? null, show: (s) => fmtTokens(f(s)?.input_tokens ?? null) },
    { label: 'Output tokens', get: (s) => f(s)?.output_tokens ?? null, show: (s) => fmtTokens(f(s)?.output_tokens ?? null) },
    { label: 'Cost', get: (s) => f(s)?.cost_usd ?? null, show: (s) => costOf(f(s)?.cost_usd ?? null, !!f(s)?.cost_estimated) },
    {
      label: 'Cost per Index point',
      get: (s) => perPoint(f(s)?.cost_usd ?? null, f(s)?.score ?? null),
      show: (s) => fmtCost(perPoint(f(s)?.cost_usd ?? null, f(s)?.score ?? null)),
      better: 'low',
    },
    {
      label: 'Minutes per Index point',
      get: (s) => perPoint(f(s) ? (f(s)?.secs ?? 0) / 60 : null, f(s)?.score ?? null),
      show: (s) => num1(perPoint(f(s) ? (f(s)?.secs ?? 0) / 60 : null, f(s)?.score ?? null)),
      better: 'low',
    },
    { label: 'Runs averaged', get: (s) => f(s)?.n ?? null },
  ];
  if (sides.some((s) => (s.fast?.runs.length ?? 0) > 1))
    fastRows.push({
      label: 'Score range over runs',
      get: () => null,
      show: (s) => {
        const xs = (s.fast?.runs ?? []).map((r) => r.score ?? 0);
        return xs.length > 1 ? `${fmtScore(Math.min(...xs))}–${fmtScore(Math.max(...xs))}` : xs.length ? 'one run' : '–';
      },
    });

  const thoroughRows: Row[] = sides.some((s) => s.thorough)
    ? [
        { label: 'Thorough Index', get: (s) => s.thorough?.avg.score ?? null, show: (s) => fmtScore(s.thorough?.avg.score ?? null), better: 'high' },
        { label: 'Thorough cost', get: (s) => s.thorough?.avg.cost_usd ?? null, show: (s) => fmtCost(s.thorough?.avg.cost_usd ?? null), better: 'low' },
      ]
    : [];

  const c = (s: Colored) => s.coding?.best ?? null;
  const codingRows: Row[] = sides.some((s) => s.coding)
    ? [
        {
          label: 'Coding score',
          get: (s) => c(s)?.score ?? null,
          show: (s) => (c(s) ? `${fmtScore(c(s)?.score ?? null)}${s.coding?.other_effort ? ` (${c(s)?.effort})` : ''}` : '–'),
          better: 'high',
          title: 'Its best graded solver at this effort, or at its best effort when it has none here (effort in brackets)',
        },
        ...(sides.some((s) => (s.coding?.runs.length ?? 0) > 1)
          ? [{ label: 'Coding score, mean of runs', get: (s: Colored) => s.coding?.mean_score ?? null, show: (s: Colored) => fmtScore(s.coding?.mean_score ?? null), better: 'high' as const }]
          : []),
        { label: 'Rank on the coding board', get: (s) => s.coding?.rank ?? null, show: (s) => (s.coding ? `#${s.coding.rank} of ${s.coding.of}` : '–'), better: 'low' },
        { label: 'Hidden cubes solved', get: (s) => c(s)?.solved ?? null, show: (s) => (c(s) ? `${c(s)?.solved}/${c(s)?.cases}` : '–'), better: 'high' },
        { label: 'Moves per cube (solver)', get: (s) => c(s)?.mean_moves ?? null, show: (s) => num1(c(s)?.mean_moves ?? null), better: 'low' },
        { label: 'Solve time per cube', get: (s) => c(s)?.mean_ms ?? null, show: (s) => fmtMs(c(s)?.mean_ms ?? null), better: 'low' },
        { label: 'Coding time used', get: (s) => c(s)?.dev_minutes ?? null, show: (s) => (c(s)?.dev_minutes ? fmtDuration((c(s)?.dev_minutes ?? 0) * 60) : '–'), better: 'low' },
        { label: 'Coding cost', get: (s) => c(s)?.cost_usd ?? null, show: (s) => costOf(c(s)?.cost_usd ?? null, !!c(s)?.cost_estimated), better: 'low' },
      ]
    : [];

  const groups: [string, Row[]][] = [
    ['Fast suite', fastRows],
    ['Thorough suite', thoroughRows],
    ['Coding benchmark', codingRows],
  ];
  const all = groups.flatMap(([, rs]) => rs);
  const wins = sides.map((_, i) => all.filter((r) => winners(r, sides).includes(i)).length);

  return (
    <Exportable name={`${title} head to head`} caption={title} className="card ix-card">
      <header className="ix-head">
        <h2>Head to head</h2>
        <p>Every measure side by side; the best on each row is marked. Averages where an effort was run more than once.</p>
      </header>
      <div className="table-wrap flat">
        <table className="cmp-table">
          <thead>
            <tr>
              <th>Measure</th>
              {sides.map((s, i) => (
                <th key={i} className="num" style={{ '--side': s.color } as CSSProperties}>
                  <span className="cmp-th">
                    <i className="cmp-dot" aria-hidden />
                    {s.label}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="cmp-wins">
              <td>Rows won</td>
              {wins.map((w, i) => (
                <td key={i} className="num">
                  <strong>{w}</strong>
                </td>
              ))}
            </tr>
            {groups.map(([name, rows]) =>
              rows.length ? (
                <RowGroup key={name} name={name} rows={rows} sides={sides} />
              ) : null,
            )}
          </tbody>
        </table>
      </div>
      <p className="ix-foot">Costs marked * are estimated from tokens at list prices. Ties share the mark.</p>
    </Exportable>
  );
}

function RowGroup({ name, rows, sides }: { name: string; rows: Row[]; sides: Colored[] }) {
  return (
    <>
      <tr className="cmp-group">
        <th colSpan={sides.length + 1}>{name}</th>
      </tr>
      {rows.map((r) => {
        const win = winners(r, sides);
        return (
          <tr key={r.label}>
            <td title={r.title}>{r.label}</td>
            {sides.map((s, i) => (
              <td key={i} className={`num ${win.includes(i) ? 'cmp-win' : ''}`}>
                {r.show ? r.show(s) : fmtNum(r.get(s))}
              </td>
            ))}
          </tr>
        );
      })}
    </>
  );
}

/** Which sides have the best value on a row: none when fewer than two have one, or all tie. */
function winners(r: Row, sides: Colored[]): number[] {
  if (!r.better) return [];
  const vs = sides.map((s) => r.get(s));
  const have = vs.filter((v): v is number => v !== null);
  if (have.length < 2) return [];
  const best = r.better === 'high' ? Math.max(...have) : Math.min(...have);
  const at = vs.flatMap((v, i) => (v !== null && Math.abs(v - best) < 1e-9 ? [i] : []));
  return at.length === have.length ? [] : at;
}

/**
 * Moves on the levels every side with a Fast run solved on its first try:
 * the same cubes for all of them (from each side's best run).
 */
function sharedCubes(sides: Colored[]): { moves: Map<Colored, number>; levels: number } {
  const have = sides.filter((s) => s.fast);
  const moves = new Map<Colored, number>();
  if (have.length < 2) return { moves, levels: 0 };
  let levels = 0;
  const tests = have[0].fast?.tests.map((t) => t.test) ?? [];
  for (const test of tests) {
    const per = have.map((s) => s.fast?.tests.find((t) => t.test === test)?.levels ?? []);
    for (const lv of per[0]) {
      const firsts = per.map((ls) => ls.find((x) => x.level === lv.level)?.tries[0]);
      if (!firsts.every((t) => t?.status === 'solved')) continue;
      levels++;
      have.forEach((s, i) => moves.set(s, (moves.get(s) ?? 0) + (firsts[i]?.moves ?? 0)));
    }
  }
  return levels ? { moves, levels } : { moves: new Map(), levels: 0 };
}

const num1 = (v: number | null) => (v === null ? '–' : String(Math.round(v * 10) / 10));
const fmtNum = (v: number | null) => (v === null ? '–' : Number.isInteger(v) ? String(v) : num1(v));
const perPoint = (cost: number | null, score: number | null) => (cost === null || !score ? null : cost / score);
const costOf = (v: number | null, est: boolean) => (v === null ? '–' : `${fmtCost(v)}${est ? '*' : ''}`);

// ---------------------------------------------------------------------------
// Fast, test by test: one bar per side.

function FastByTest({ sides, fastTests, title }: { sides: Colored[]; fastTests: TestName[]; title: string }) {
  const have = sides.filter((s) => s.fast);
  if (!have.length) return null;
  const tests = [{ test: 'index', name: 'Fast Index', short: 'Index' }, ...fastTests];
  return (
    <Exportable name={`${title} fast by test`} caption={title} className="card ix-card">
      <header className="ix-head">
        <h2>Fast, test by test</h2>
        <p>Each test out of 100. The Index weighs the 2×2 ladder 20% and each 3×3 ladder 40%.</p>
      </header>
      <div className="cmp-bars">
        {tests.map((t) => (
          <div key={t.test} className="cmp-bar-group">
            <h3>{t.name}</h3>
            {have.map((s, i) => {
              const v = t.test === 'index' ? (s.fast?.avg.score ?? null) : (s.fast?.avg.tests.find((x) => x.test === t.test)?.score ?? null);
              return (
                <div key={i} className="cmp-bar" style={{ '--side': s.color } as CSSProperties}>
                  <span className="cmp-bar-name">{s.label}</span>
                  <span className="cmp-bar-track">
                    <span className="cmp-bar-fill" style={{ width: `${Math.max(0, Math.min(100, v ?? 0))}%` }} />
                  </span>
                  <span className="cmp-bar-value">{fmtScore(v)}</span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </Exportable>
  );
}

// ---------------------------------------------------------------------------
// Level by level: every try on every ladder level, from each side's best run.
// The first try at a level is the same cube for everyone, so move counts there
// compare directly.

function Levels({ sides, fastTests, title }: { sides: Colored[]; fastTests: TestName[]; title: string }) {
  const have = sides.filter((s) => s.fast);
  if (!have.length) return null;
  return (
    <section className="card ix-card">
      <header className="ix-head">
        <h2>Level by level</h2>
        <p>
          Every level of each ladder, from each model&apos;s best run. The number is the moves it took; red marks are missed tries. Everyone gets the same
          cube on a level&apos;s first try, so the fewest moves there is starred. Click a level for its replay.
        </p>
      </header>
      {fastTests.map((t) => (
        <Exportable as="div" key={t.test} name={`${title} ${t.name} levels`} caption={`${title} · ${t.name}`} className="cmp-levels">
          <LevelGrid test={t} sides={have} />
        </Exportable>
      ))}
      <ul className="legend cmp-legend">
        <li>
          <i className="lv lv-ok" /> solved first try
        </li>
        <li>
          <i className="lv lv-retry" /> solved after a miss
        </li>
        <li>
          <i className="lv lv-fail" /> missed, the ladder ended
        </li>
        <li>
          <i className="lv" /> not reached
        </li>
      </ul>
    </section>
  );
}

function LevelGrid({ test, sides }: { test: TestName; sides: Colored[] }) {
  const details = sides.map((s) => s.fast?.tests.find((x) => x.test === test.test) ?? null);
  const max = Math.max(...details.map((d) => d?.max ?? 0), ...details.map((d) => d?.levels.at(-1)?.level ?? 0));
  if (!max) return null;
  const levels = Array.from({ length: max }, (_, i) => i + 1);
  // Fewest moves on the shared first-try cube, per level.
  const star = new Map<number, number>();
  for (const l of levels) {
    const firsts = details.map((d) => {
      const t = d?.levels.find((x) => x.level === l)?.tries[0];
      return t?.status === 'solved' ? t.moves : null;
    });
    const got = firsts.filter((v): v is number => v !== null);
    if (got.length >= 2) {
      const best = Math.min(...got);
      if (firsts.filter((v) => v === best).length < got.length) star.set(l, best);
    }
  }
  return (
    <>
      <h3 className="cmp-levels-head">{test.name}</h3>
      <div className="cmp-lv-wrap">
        <table className="cmp-lv-table">
          <thead>
            <tr>
              <th />
              {levels.map((l) => (
                <th key={l} className="num">
                  {l}
                </th>
              ))}
              <th className="num">Score</th>
            </tr>
          </thead>
          <tbody>
            {sides.map((s, i) => {
              const d = details[i];
              return (
                <tr key={i} style={{ '--side': s.color } as CSSProperties}>
                  <th scope="row">
                    <span className="cmp-lv-name">
                      <i className="cmp-dot" aria-hidden />
                      {s.model}
                      {s.effort && <small>{s.effort}</small>}
                    </span>
                  </th>
                  {levels.map((l) => (
                    <td key={l}>
                      <LevelCell lv={d?.levels.find((x) => x.level === l)} starred={star.get(l)} />
                    </td>
                  ))}
                  <td className={`num cmp-lv-score${(d?.score ?? 0) < 100 ? ' lo' : ''}`}>{fmtScore(d?.score ?? null)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function LevelCell({ lv, starred }: { lv?: LevelTries; starred?: number }) {
  if (!lv) return <span className="lv" aria-label="not reached" />;
  const solved = lv.tries.find((t) => t.status === 'solved');
  const misses = lv.tries.filter((t) => t.status !== 'solved' && t.status !== 'active').length;
  const first = lv.tries[0];
  const star = solved === first && solved?.moves === starred;
  const cls = solved ? (misses ? 'lv lv-retry' : 'lv lv-ok') : lv.tries.some((t) => t.status === 'active') ? 'lv lv-live' : 'lv lv-fail';
  const what = solved
    ? `Solved in ${solved.moves} moves${misses ? ` after ${misses} miss${misses > 1 ? 'es' : ''}` : ''}, ${fmtDuration(solved.secs)}`
    : `Not solved (${lv.tries.map((t) => t.status.replace('_', ' ')).join(', ')})`;
  const body: ReactNode = (
    <>
      {solved ? solved.moves : '✕'}
      {star && <sup>★</sup>}
      {misses > 0 && solved && <span className="lv-miss">{'•'.repeat(Math.min(misses, 3))}</span>}
    </>
  );
  const target = solved ?? lv.tries.at(-1);
  return target ? (
    <Link href={`/replay/${target.attempt}`} className={cls} title={what}>
      {body}
    </Link>
  ) : (
    <span className={cls} title={what}>
      {body}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Effort: the Fast Index at each effort each model was run at.

function EffortCurve({ sides, title }: { sides: Colored[]; title: string }) {
  const series: Series[] = sides
    .filter((s) => s.curve.length > 0)
    .map((s, i) => ({ key: `${s.slug}-${i}`, label: s.model, color: s.color, points: s.curve.map((p) => ({ x: p.effort, y: p.score })), href: `/models/${s.slug}` }));
  if (!series.length) return null;
  return (
    <Exportable name={`${title} effort`} caption={title} className="card ix-card">
      <header className="ix-head">
        <h2>Does more effort help?</h2>
        <p>The Fast Index at every effort each model has been run at, whichever effort is picked above.</p>
      </header>
      <LineChart series={series} xs={EFFORT_ORDER} empty="No effort results yet." />
      <ul className="legend">
        {series.map((s) => (
          <li key={s.key}>
            <i style={{ background: s.color }} />
            {s.label}
          </li>
        ))}
      </ul>
    </Exportable>
  );
}

// ---------------------------------------------------------------------------
// The coding benchmark.

function Coding({ sides, title }: { sides: Colored[]; title: string }) {
  const have = sides.filter((s) => s.coding);
  if (!have.length) return null;
  const top = Math.max(...have.map((s) => s.coding?.best.score ?? 0));
  const max = Math.max(100, Math.ceil((top * 1.1) / 25) * 25);
  return (
    <Exportable name={`${title} coding`} caption={title} className="card ix-card">
      <header className="ix-head">
        <h2>Coding benchmark</h2>
        <p>Each model writes its own 5×5 solver in a few hours, then the frozen code solves hidden cubes. 100 = the 60-move reference; an unsolved cube scores 0.</p>
      </header>
      <BarChart
        height={200}
        max={max}
        reference={{ value: 100, label: '60-move reference' }}
        items={have.map((s) => ({ key: s.slug + s.effort, label: s.model, sub: s.coding?.best.effort ?? null, value: s.coding?.best.score ?? null, color: s.color, href: `/code/${s.coding?.best.id}` }))}
      />
      {have.some((s) => (s.coding?.runs.length ?? 0) > 1) && (
        <p className="ix-foot">
          Each run:{' '}
          {have
            .filter((s) => (s.coding?.runs.length ?? 0) > 1)
            .map((s) => `${s.label} ${(s.coding?.runs ?? []).map((r) => fmtScore(r.score)).join(', ')}`)
            .join(' · ')}
        </p>
      )}
    </Exportable>
  );
}

// ---------------------------------------------------------------------------
// Thorough, test by test, for the sides that have it.

function Thorough({ sides, tests, title }: { sides: Colored[]; tests: TestName[]; title: string }) {
  const have = sides.filter((s): s is Colored & { thorough: SuiteSide } => !!s.thorough);
  if (!have.length) return null;
  return (
    <Exportable name={`${title} thorough`} caption={title} className="card ix-card">
      <header className="ix-head">
        <h2>Thorough suite</h2>
        <p>Every model-only test, 2×2 to 5×5. Only models run on Thorough appear.</p>
      </header>
      <div className="table-wrap flat">
        <table className="heat">
          <thead>
            <tr>
              <th>Test</th>
              {have.map((s, i) => (
                <th key={i} className="num" style={{ '--side': s.color } as CSSProperties}>
                  <span className="cmp-th">
                    <i className="cmp-dot" aria-hidden />
                    {s.label}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <strong>Thorough Index</strong>
              </td>
              {have.map((s, i) => (
                <td key={i} className="num strong">
                  {fmtScore(s.thorough.avg.score)}
                </td>
              ))}
            </tr>
            {tests.map((t) => (
              <tr key={t.test}>
                <td>{t.name}</td>
                {have.map((s, i) => {
                  const v = s.thorough.avg.tests.find((x) => x.test === t.test)?.score ?? null;
                  return (
                    <td key={i} className={`num heat-cell ${heat(v)}`}>
                      {fmtScore(v)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Exportable>
  );
}
