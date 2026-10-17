'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { BarChart, LineChart, ScatterChart, type Series } from '@/components/charts';
import Exportable from '@/components/Exportable';
import { LevelsCard, SpendCard, laddersOf } from '@/components/RunCharts';
import WaitingNote from '@/components/WaitingNote';
import { OUT_OF_OUTPUT, OUT_OF_OUTPUT_WHY, fmtCost, fmtDuration, fmtScore, fmtTokens, heat } from '@/lib/arena/format';
import { type LevelData, bestPerModel, indexPool, resultHref } from '@/lib/arena/aggregate';
import type { SuiteEntry } from '@/lib/arena/index-data';
import { EFFORT_ORDER } from '@/lib/arena/makers';
import { suiteOrder } from '@/lib/arena/ranking';
import { runningLabel } from '@/lib/arena/running';
import { FAST_WEIGHTING, GAUNTLET, GAUNTLET_TAG } from '@/lib/arena/rules';
import type { SuiteKind } from '@/lib/arena/suites';

export interface SuiteInfo {
  kind: SuiteKind;
  name: string;
  version: string;
  blurb: string;
  tests: { test: string; name: string; short: string; gauntlet?: boolean }[];
}

/** The tag beside a Fast score while its Gauntlet is unlocked and not played to the end. */
const gauntletTag = (e: SuiteEntry) => (e.gauntlet === 'pending' || e.gauntlet === 'playing' ? GAUNTLET_TAG[e.gauntlet] : null);

/** Bars whose score still has the Gauntlet's 20 points to come (kept out of the bar labels, which are rotated and short). */
function GauntletNote({ rows }: { rows: SuiteEntry[] }) {
  const open = rows.filter((e) => gauntletTag(e));
  if (open.length === 0) return null;
  return (
    <p className="ix-waiting">
      100 on all three tests, so the {GAUNTLET.size}×{GAUNTLET.size} {GAUNTLET.name} is unlocked and the score isn&apos;t final yet:{' '}
      {open.map((e, i) => (
        <span key={e.id}>
          {i > 0 && ', '}
          <Link href={resultHref(e)}>{e.label}</Link>
          {e.gauntlet === 'playing' && ' (playing it now)'}
        </span>
      ))}
      .
    </p>
  );
}

type EffortMode = 'best' | 'all' | (typeof EFFORT_ORDER)[number];

const SERIES_COLORS = ['var(--orange)', 'var(--green)', 'var(--blue)', 'var(--red)', 'var(--purple)', 'var(--teal)', 'var(--pink)', 'var(--yellow)', 'var(--slate)'];
const DASHES = [undefined, '7 5', '2 4'];

const SECTIONS = [
  ['index', 'Index'],
  ['tests', 'By test'],
  ['tradeoffs', 'Score vs cost'],
  ['spend', 'Cost, tokens, time'],
  ['levels', 'Level by level'],
  ['effort', 'Effort'],
  ['table', 'All results'],
  ['method', 'Method'],
] as const;

export default function IndexExplorer({
  entries,
  suites,
  running,
  levels,
}: {
  entries: SuiteEntry[];
  suites: SuiteInfo[];
  running: SuiteEntry[];
  levels: LevelData;
}) {
  const [kind, setKind] = useState<SuiteKind>('fast');
  const [effort, setEffort] = useState<EffortMode>('best');
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [tradeoff, setTradeoff] = useState<'moves' | 'time' | 'cost'>('moves');
  const suite = suites.find((s) => s.kind === kind) as SuiteInfo;

  // One result per model and effort, this suite version: the average when it was run more than once.
  // A model counts once it has a result at its top effort.
  const { ranked: pool, waiting } = useMemo(() => indexPool(entries, kind, suite.version), [entries, kind, suite.version]);

  const models = useMemo(() => [...new Set(pool.map((e) => e.model))].sort(), [pool]);
  const shown = pool.filter((e) => !hidden.has(e.model));

  const rows = useMemo(() => {
    let out: SuiteEntry[];
    if (effort === 'best') out = bestPerModel(shown);
    else if (effort === 'all') out = shown;
    else out = shown.filter((e) => e.effort === effort || e.effort === null);
    return out.sort(suiteOrder);
  }, [shown, effort]);

  const efforts = useMemo(() => EFFORT_ORDER.filter((x) => pool.some((e) => e.effort === x)), [pool]);
  const bars = rows.map((e) => ({
    key: e.id,
    label: e.model,
    sub: e.effort,
    value: e.score,
    color: e.color,
    href: `/models/${e.slug}`,
  }));

  // Every effort: each model's efforts are joined by a line, so its curve from cheap to dear shows.
  const point = (e: SuiteEntry, x: number | null) =>
    x === null ? [] : [{ key: e.id, label: e.label, x, y: e.score ?? 0, color: e.color, href: resultHref(e), group: effort === 'all' ? e.model : undefined }];
  const scatter = {
    moves: {
      points: rows.flatMap((e) => point(e, e.moves_per_solve)),
      xLabel: 'Moves per cube solved (fewer is better)',
      xFormat: (v: number) => String(Math.round(v * 10) / 10),
      log: false,
      empty: 'No cube solved yet, so no move counts to compare.',
    },
    time: {
      points: rows.flatMap((e) => point(e, e.secs / 60)),
      xLabel: 'Minutes for the whole suite (less is better)',
      xFormat: (v: number) => `${Math.round(v)}`,
      log: false,
      empty: 'No finished suites yet.',
    },
    cost: {
      points: rows.flatMap((e) => point(e, e.cost_usd)),
      xLabel: 'Cost of the suite in USD, log scale (less is better)',
      xFormat: (v: number) => (v < 1 ? `$${v.toFixed(v < 0.1 ? 2 : 1)}` : `$${v}`),
      log: true,
      empty: 'No costs yet: they appear once a run reports its tokens.',
    },
  }[tradeoff];

  // A line's colour belongs to its model, given in index order over the whole suite, so hiding models or
  // changing the effort never repaints the others.
  const paint = useMemo(() => {
    const out = new Map<string, { color: string; dash?: string }>();
    bestPerModel(pool)
      .sort(suiteOrder)
      .forEach((e, i) => out.set(e.model, { color: SERIES_COLORS[i % SERIES_COLORS.length], dash: DASHES[Math.floor(i / SERIES_COLORS.length) % DASHES.length] }));
    return out;
  }, [pool]);

  const series: Series[] = useMemo(() => {
    const byModel = new Map<string, SuiteEntry[]>();
    for (const e of shown) if (e.effort) byModel.set(e.model, [...(byModel.get(e.model) ?? []), e]);
    return [...byModel.entries()]
      .sort((a, b) => suiteOrder([...a[1]].sort(suiteOrder)[0], [...b[1]].sort(suiteOrder)[0]))
      .map(([model, es]) => ({
        key: model,
        label: model,
        ...(paint.get(model) ?? { color: SERIES_COLORS[0] }),
        points: es.map((e) => ({ x: e.effort as string, y: e.score ?? 0 })),
        href: `/models/${es[0].slug}`,
      }));
  }, [shown, paint]);

  // Level by level: one line per model (its best effort when every effort is shown), the top few by index.
  const ladders = useMemo(() => laddersOf(suite.tests, levels, pool), [suite, levels, pool]);
  const lineRows = (effort === 'all' ? bestPerModel(rows).sort(suiteOrder) : rows).slice(0, MAX_LINES);
  const moreLines = (effort === 'all' ? bestPerModel(rows) : rows).length - lineRows.length;

  const toggleModel = (m: string) =>
    setHidden((h) => {
      const next = new Set(h);
      if (next.has(m)) next.delete(m);
      else next.add(m);
      return next;
    });

  return (
    <div className="ix">
      <aside className="ix-side" aria-label="Sections">
        <nav>
          {SECTIONS.map(([id, name]) => (
            <a key={id} href={`#${id}`}>
              {name}
            </a>
          ))}
        </nav>
      </aside>

      <div className="ix-main">
        <div className="filterbar ix-controls" role="group" aria-label="Choose what the charts show">
          <div className="seg" role="tablist" aria-label="Suite">
            {suites.map((s) => (
              <button key={s.kind} type="button" role="tab" aria-selected={kind === s.kind} className={kind === s.kind ? 'on' : ''} onClick={() => setKind(s.kind)}>
                {s.name}
              </button>
            ))}
          </div>
          <label className={`toggle ${effort === 'best' ? '' : 'on'}`}>
            <span className="toggle-key">Effort</span>
            <span className="toggle-value">{effort === 'best' ? 'Best per model' : effort === 'all' ? 'Every effort' : effort}</span>
            <select aria-label="Effort" value={effort} onChange={(e) => setEffort(e.target.value as EffortMode)}>
              <option value="best">Best per model</option>
              {EFFORT_ORDER.map((x) => (
                <option key={x} value={x} disabled={!efforts.includes(x)}>
                  {x}
                </option>
              ))}
              <option value="all">Every effort</option>
            </select>
          </label>
          <details className="picker">
            <summary className={`toggle ${hidden.size ? 'on' : ''}`}>
              <span className="toggle-key">Models</span>
              <span className="toggle-value">
                {models.length - models.filter((m) => hidden.has(m)).length} of {models.length}
              </span>
            </summary>
            <div className="picker-menu">
              <div className="picker-actions">
                <button type="button" onClick={() => setHidden(new Set())}>
                  All
                </button>
                <button type="button" onClick={() => setHidden(new Set(models))}>
                  None
                </button>
              </div>
              {models.map((m) => (
                <label key={m}>
                  <input type="checkbox" checked={!hidden.has(m)} onChange={() => toggleModel(m)} /> {m}
                </label>
              ))}
            </div>
          </details>
        </div>

        {running.length > 0 && (
          <p className="ix-running">
            <span className="live-dot" aria-hidden /> Running now:{' '}
            {running.map((r, i) => (
              <span key={r.id}>
                {i > 0 && ', '}
                <Link href={`/suites/${r.id}`}>
                  {r.label} · {runningLabel(r)}
                </Link>
              </span>
            ))}
          </p>
        )}

        <Exportable id="index" name={`Cube Arena Index ${suite.name} ${suite.version}`} className="card ix-card">
          <header className="ix-head">
            <h2>Cube Arena Index</h2>
            <p>
              {suite.name} {suite.version}: {suite.blurb} Score out of 100, higher is better. Verified runs only.
            </p>
          </header>
          <BarChart items={bars} empty={<EmptyIndex kind={kind} />} />
          <Legend entries={rows} />
          <GauntletNote rows={rows} />
          <WaitingNote waiting={waiting} />
        </Exportable>

        <Exportable id="tests" name={`Cube Arena ${suite.name} score by test`} className="card ix-card">
          <header className="ix-head">
            <h2>Score by test</h2>
            <p>
              Each test out of 100. Ladders: how far up the model climbed; moves only break ties. Full scrambles: whether it solved the cube.
              {kind === 'fast' && ` ${FAST_WEIGHTING}`}
            </p>
          </header>
          {rows.length === 0 ? (
            <div className="chart-empty">No results yet.</div>
          ) : (
            <div className="table-wrap flat">
              <table className="heat">
                <thead>
                  <tr>
                    <th>Model</th>
                    <th className="num">Index</th>
                    {suite.tests.map((t) => (
                      <th key={t.test} className="num" title={t.name}>
                        {kind === 'fast' ? t.name : t.short}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((e) => (
                    <tr key={e.id}>
                      <td>
                        <Link href={resultHref(e)} className="model-link">
                          <i className="swatch" style={{ background: e.color }} />
                          {e.label}
                        </Link>
                      </td>
                      <td className="num strong">{fmtScore(e.score)}</td>
                      {suite.tests.map((t) => {
                        const g = e.tests.find((x) => x.test === t.test);
                        const s = g?.score ?? null;
                        if (t.gauntlet && (e.gauntlet === 'locked' || (e.gauntlet !== 'done' && !g?.played))) {
                          return (
                            <td key={t.test} className="num faint" title={e.gauntlet === 'locked' ? 'Locked: it takes 100 on the other three tests' : 'Unlocked, not played yet'}>
                              {e.gauntlet === 'locked' ? '–' : 'pending'}
                            </td>
                          );
                        }
                        return (
                          <td key={t.test} className={`num heat-cell ${heat(s)}`}>
                            {fmtScore(s)}
                            {g?.out_of_output && (
                              <sup className="oo-mark" title={`${OUT_OF_OUTPUT}: ${OUT_OF_OUTPUT_WHY}`}>
                                †
                              </sup>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {rows.some((e) => e.out_of_output > 0) && (
            <p className="ix-foot">
              † Ran out of output: {OUT_OF_OUTPUT_WHY}, so the test ended on that level. It keeps the levels it had cleared.{' '}
              <Link href="/benchmark#method">Why</Link>
            </p>
          )}
        </Exportable>

        <Exportable id="tradeoffs" name={`Cube Arena ${suite.name} index vs ${tradeoff}`} className="card ix-card">
          <header className="ix-head">
            <h2>What the score costs</h2>
            <p>Top left is where you want to be: a high score for few moves, little time or little money. The dotted line joins the models nobody beats on both.</p>
          </header>
          <div className="tab-row" role="tablist">
            {(
              [
                ['moves', 'Index vs moves'],
                ['time', 'Index vs time'],
                ['cost', 'Index vs cost'],
              ] as const
            ).map(([k, name]) => (
              <button key={k} type="button" role="tab" aria-selected={tradeoff === k} className={`tab ${tradeoff === k ? 'on' : ''}`} onClick={() => setTradeoff(k)}>
                {name}
              </button>
            ))}
          </div>
          <ScatterChart points={scatter.points} xLabel={scatter.xLabel} xFormat={scatter.xFormat} log={scatter.log} empty={scatter.empty} />
          {tradeoff === 'cost' && (
            <p className="ix-foot">
              The cost a CLI or API reports when it does (Claude Code, OpenRouter); otherwise the tokens used at list prices, marked *. Many runs
              themselves used subscriptions.
            </p>
          )}
        </Exportable>

        <SpendCard subject={`Cube Arena ${suite.name}`} rows={rows} kind={kind} tests={suite.tests} name={(e) => ({ label: e.model, sub: e.effort })} />

        <LevelsCard
          subject={`Cube Arena ${suite.name}`}
          rows={lineRows}
          levels={levels}
          ladders={ladders}
          line={(e) => ({ label: e.label, ...(paint.get(e.model) ?? { color: SERIES_COLORS[0] }) })}
          foot={moreLines > 0 && `The top ${MAX_LINES} by index; ${moreLines} more under Models above.`}
        />

        <Exportable id="effort" name={`Cube Arena ${suite.name} effort`} className="card ix-card">
          <header className="ix-head">
            <h2>Does more effort help?</h2>
            <p>
              The same model at each reasoning effort, low to max. A flat line means thinking longer doesn&apos;t help it see the cube; a drop at the
              top often means the model thought past its output limit and never answered († in Score by test).
            </p>
          </header>
          <LineChart series={series} xs={EFFORT_ORDER} empty="Effort curves appear once a model has been run at two or more efforts." />
        </Exportable>

        <Exportable id="table" name={`Cube Arena ${suite.name} all results`} className="card ix-card">
          <header className="ix-head">
            <h2>All results</h2>
            <p>
              Every Verified {suite.name} result shown above. A model and effort run more than once shows the average. Click a score for each test and its
              replays, or a model for all its efforts.
            </p>
          </header>
          {rows.length === 0 ? (
            <div className="chart-empty">No results yet.</div>
          ) : (
            <div className="table-wrap flat">
              <table>
                <thead>
                  <tr>
                    <th className="rank">#</th>
                    <th>Model</th>
                    <th>Maker</th>
                    <th className="num">Index</th>
                    <th className="num">Solved</th>
                    <th className="num">Moves</th>
                    <th className="num">Time</th>
                    <th className="num">Tokens</th>
                    <th className="num">Cost</th>
                    <th className="num" title="Suites averaged into this result">Runs</th>
                    <th>Run by</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((e, i) => (
                    <tr key={e.id}>
                      <td className="rank">{i + 1}</td>
                      <td>
                        <Link href={`/models/${e.slug}`} className="model-link">
                          <i className="swatch" style={{ background: e.color }} />
                          {e.label}
                        </Link>
                        {gauntletTag(e) && (
                          <span className="tag tag-gauntlet" title="100 on all three tests unlocked the 4×4 Gauntlet, worth the last 20 points">
                            {gauntletTag(e)}
                          </span>
                        )}
                        {e.out_of_output > 0 && (
                          <span
                            className="tag tag-oo"
                            title={`${e.out_of_output} test${e.out_of_output > 1 ? 's' : ''} ended because ${OUT_OF_OUTPUT_WHY}`}
                          >
                            {OUT_OF_OUTPUT}
                          </span>
                        )}
                      </td>
                      <td className="muted">{e.maker}</td>
                      <td className="num strong">
                        <Link href={resultHref(e)} title={e.n > 1 ? `The average of ${e.n} runs` : 'Every test, with replays'}>
                          {fmtScore(e.score)}
                        </Link>
                      </td>
                      <td className="num">{e.solved}</td>
                      <td className="num">{e.moves}</td>
                      <td className="num">{fmtDuration(e.secs)}</td>
                      <td className="num">{fmtTokens(e.output_tokens === null ? null : (e.input_tokens ?? 0) + e.output_tokens)}</td>
                      <td className="num">
                        {fmtCost(e.cost_usd)}
                        {e.cost_estimated && <sup title="Estimated from tokens at list prices">*</sup>}
                      </td>
                      <td className="num">{e.n}</td>
                      <td className="muted">
                        {e.run_by.join(', ')}
                        {e.harness && <span className="via-note"> · via {e.harness}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Exportable>
      </div>
    </div>
  );
}

/** How many lines the level chart draws before it gets hard to read. */
const MAX_LINES = 8;

function Legend({ entries }: { entries: SuiteEntry[] }) {
  const makers = [...new Map(entries.map((e) => [e.maker, e.color])).entries()];
  if (makers.length === 0) return null;
  return (
    <ul className="legend">
      {makers.map(([name, color]) => (
        <li key={name}>
          <i style={{ background: color }} />
          {name}
        </li>
      ))}
    </ul>
  );
}

function EmptyIndex({ kind }: { kind: SuiteKind }) {
  return (
    <span>
      No Verified {kind === 'fast' ? 'Fast' : 'Thorough'} results yet. The first models are being run now; check back soon, or{' '}
      <Link href="/connect">run your own</Link>.
    </span>
  );
}
