// The homepage's benchmarks, all on one page: the Cube Arena Index as a full
// ranked table (every model, its score, each test, its other efforts, moves
// and cost), then the coding benchmark. Server-rendered, no chart library.

import Link from 'next/link';
import { bestPerModel, indexPool, provisional, resultHref } from '@/lib/arena/aggregate';
import type { LadderRow } from '@/lib/arena/board';
import type { CodeEntry } from '@/lib/arena/code';
import { CODE } from '@/lib/arena/code-rules';
import { OUT_OF_OUTPUT, OUT_OF_OUTPUT_WHY, fmtCost, fmtScore } from '@/lib/arena/format';
import { type SuiteEntry, testNames } from '@/lib/arena/index-data';
import { effortRank, makerOf, splitLabel } from '@/lib/arena/makers';
import { fullEffort } from '@/lib/arena/ranking';
import { isRunning, runningLabel } from '@/lib/arena/running';
import { GAUNTLET_TAG } from '@/lib/arena/rules';
import { SUITES } from '@/lib/arena/suites';
import WaitingNote from './WaitingNote';

/** "87.5", "100", "35". */
const num = (v: number | null) => fmtScore(v).replace(/\.0$/, '');

/** A test tile's fill: the same green, stronger for a higher score. */
const fill = (v: number) => {
  const pct = Math.round(12 + 0.88 * Math.max(0, Math.min(100, v)));
  return { background: `color-mix(in srgb, var(--green) ${pct}%, var(--card))`, color: pct >= 60 ? 'var(--on-color)' : 'var(--text)' };
};

const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** Short column names for Fast's tests, with what each is worth. */
const COLUMN: Record<string, [string, string]> = {
  '2x2-ladder-interactive': ['2×2', 'interactive'],
  '3x3-ladder-interactive': ['3×3', 'interactive'],
  '3x3-ladder-one_shot': ['3×3', 'one-shot'],
  '4x4-gauntlet-interactive': ['4×4 Gauntlet', 'interactive'],
  '4x4-gauntlet-one_shot': ['4×4 Gauntlet', 'one-shot'],
};

/** The tiny label in each tile on phones, where the column heads are gone. */
const TILE_LABEL: Record<string, string> = {
  '2x2-ladder-interactive': '2×2',
  '3x3-ladder-interactive': '3×3',
  '3x3-ladder-one_shot': '3×3 1×',
  '4x4-gauntlet-interactive': 'G int',
  '4x4-gauntlet-one_shot': 'G 1×',
};

function Tile({ e, t }: { e: SuiteEntry; t: { test: string; name: string; short: string; gauntlet: boolean } }) {
  const g = e.tests.find((x) => x.test === t.test);
  const label = (
    <span className="ixb-lab" aria-hidden>
      {TILE_LABEL[t.test] ?? t.short}
    </span>
  );
  if (t.gauntlet && (e.gauntlet === 'locked' || (e.gauntlet !== 'done' && !g?.played))) {
    const playing = e.gauntlet === 'playing';
    const what = e.gauntlet === 'locked' ? 'locked, it takes 100 on the other three' : playing ? 'being played now' : 'unlocked, not played yet';
    return (
      <span className={`ixb-tile ${e.gauntlet === 'locked' ? 'locked' : 'open'}`} title={`${t.name}: ${what}`}>
        {label}
        <span className="sr-only">
          {t.name}: {what}.
        </span>
        <b aria-hidden>{e.gauntlet === 'locked' ? '–' : playing ? 'live' : '…'}</b>
      </span>
    );
  }
  const s = g?.score ?? null;
  // The run that played this test (the latest suite's, for an average): its best solve, else its last try.
  const replay = e.runs.filter((r) => SUITES.fast.slots[r.slot]?.test === t.test && r.replay).at(-1)?.replay;
  const body = (
    <>
      {label}
      <span className="sr-only">{t.name}: </span>
      <b>{num(s)}</b>
      {g?.out_of_output && (
        <sup className="ixb-oo">
          †<span className="sr-only"> ({OUT_OF_OUTPUT})</span>
        </sup>
      )}
      <span className="sr-only">{replay ? '. Watch the replay.' : '.'}</span>
    </>
  );
  const props = { className: 'ixb-tile', style: s === null ? undefined : fill(s), title: `${t.name}: ${s === null ? 'not played' : num(s)}${replay ? ' · replay' : ''}` };
  return replay ? (
    <Link href={`/replay/${replay}`} prefetch={false} {...props}>
      {body}
    </Link>
  ) : (
    <span {...props}>{body}</span>
  );
}

export function IndexBoard({ entries }: { entries: SuiteEntry[] }) {
  const suite = SUITES.fast;
  const tests = testNames('fast');
  const { ranked: pool, waiting } = indexPool(entries, 'fast', suite.version);
  const rows = bestPerModel(pool);
  const running = entries.filter((e) => e.board === 'verified' && isRunning(e));
  const latest = pool.map((e) => e.finished_at).filter((x): x is string => !!x).sort().at(-1);
  const anyOut = rows.some((e) => e.tests.some((t) => t.out_of_output));
  const makers = [...new Map(rows.map((e) => [makerOf(e.model).name, makerOf(e.model)])).values()];

  return (
    <section className="wrap section ixb-section" id="index" aria-labelledby="index-title">
      <div className="section-head">
        <div>
          <span className="kicker k-green">The benchmark</span>
          <h2 id="index-title">The Cube Arena Index</h2>
          <p>
            One score out of 100 for how well a model solves a cube it can only see as a picture. Every result is run by us or people we
            invited, with a locked-down runner: the exact model and effort, the same cubes, the same rules.
          </p>
        </div>
        <Link href="/benchmark" className="btn btn-small">
          Charts and method →
        </Link>
      </div>

      <div className="card ixb">
        <div className="ixb-top">
          <p className="ixb-suite">
            <b>
              {suite.name} {suite.version}
            </b>{' '}
            · {rows.length} models{latest && ` · updated ${day(latest)}`}
          </p>
          <ul className="ixb-makers" aria-label="Colour: who makes the model">
            {makers.map((m) => (
              <li key={m.name}>
                <i style={{ background: m.color }} aria-hidden />
                {m.name}
              </li>
            ))}
          </ul>
          <p className="ixb-key" aria-hidden>
            Tiles: each test out of 100. 1× one-shot, G the 4×4 Gauntlet. Tap one for its replay.
          </p>
          {running.length > 0 && (
            <p className="ixb-running">
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
        </div>

        {rows.length === 0 ? (
          <p className="ixb-empty">The first results are on their way.</p>
        ) : (
          <>
            <div className="ixb-head" aria-hidden>
              <span>#</span>
              <span>Model</span>
              <span>Index</span>
              <span className="ixb-tests">
                {tests.map((t) => (
                  <span key={t.test}>
                    <b>{(COLUMN[t.test] ?? [t.short])[0].replace(' Gauntlet', ' G')}</b>
                    <i>{(COLUMN[t.test] ?? ['', ''])[1]}</i>
                    <em>{suite.weights?.[t.test]}%</em>
                  </span>
                ))}
              </span>
              <span className="ixb-num">Moves/cube</span>
              <span className="ixb-num">Cost</span>
            </div>
            <ol className="ixb-list">
              {rows.map((e, i) => {
                const others = pool.filter((x) => x.model === e.model && x.id !== e.id).sort((a, b) => effortRank(a.effort) - effortRank(b.effort));
                const tag = provisional(e) ? GAUNTLET_TAG[e.gauntlet as 'pending' | 'playing'] : null;
                return (
                  <li key={e.id} className="ixb-row">
                    <span className="ixb-rank">{i + 1}</span>
                    <div className="ixb-model">
                      <Link href={`/models/${e.slug}`} className="ixb-name">
                        <i className="swatch" style={{ background: e.color }} aria-hidden />
                        {e.model}
                      </Link>{' '}
                      {e.effort && <span className="ixb-effort">{e.effort}</span>}
                      {tag && <em className="ixb-tag">{tag}</em>}
                      <span className="sr-only"> by {makerOf(e.model).name}</span>
                      {others.length > 0 && (
                        <span className="ixb-others">
                          Other efforts:{' '}
                          {others.map((o, j) => (
                            <span key={o.id}>
                              {j > 0 && ' · '}
                              <Link href={resultHref(o)}>
                                {o.effort} {num(o.score)}
                              </Link>
                            </span>
                          ))}
                        </span>
                      )}
                    </div>
                    <div className="ixb-score">
                      <span className="sr-only">Index: </span>
                      <b>{num(e.score)}</b>
                      <span className="ixb-bar" aria-hidden>
                        <i style={{ width: `${Math.max(1.5, Math.min(100, e.score ?? 0))}%`, background: e.color }} />
                      </span>
                    </div>
                    <div className="ixb-tests">
                      {tests.map((t) => (
                        <Tile key={t.test} e={e} t={t} />
                      ))}
                    </div>
                    <span className="ixb-num ixb-moves">
                      <span className="ixb-k">Moves per cube </span>
                      {e.moves_per_solve === null ? '–' : (Math.round(e.moves_per_solve * 10) / 10).toString()}
                    </span>
                    <span className="ixb-num ixb-cost">
                      <span className="ixb-k">Cost </span>
                      {fmtCost(e.cost_usd)}
                      {e.cost_estimated && '*'}
                    </span>
                  </li>
                );
              })}
            </ol>
          </>
        )}

        <div className="ixb-foot">
          <p>
            Each model at its best effort; equal scores rank by fewer moves, then lower cost, then less time. The 2×2 ladder is worth 20%, each
            3×3 ladder 30%. 100 on all three unlocks the 4×4 Gauntlet, worth the last 20%; until it&apos;s played the score is out of 80.
            {anyOut && (
              <>
                {' '}
                † {OUT_OF_OUTPUT}: {OUT_OF_OUTPUT_WHY}.
              </>
            )}{' '}
            * Cost from tokens at list prices.
          </p>
          <WaitingNote waiting={waiting} />
        </div>
      </div>
    </section>
  );
}

/** The coding benchmark: each model's best graded solver. */
export function CodeCard({ graded }: { graded: CodeEntry[] }) {
  const ranked = fullEffort(graded).ranked;
  const seen = new Set<string>();
  const rows = ranked.filter((e) => (seen.has(e.model) ? false : (seen.add(e.model), true))).slice(0, 6);
  const max = Math.max(100, ...rows.map((e) => e.score ?? 0));
  return (
    <article className="card bench-card" aria-labelledby="code-title">
      <span className="kicker k-orange">Coding benchmark {CODE.version}</span>
      <h3 id="code-title">Can a model write a 5×5 solver?</h3>
      <p className="bench-blurb">
        {CODE.devHours} hours to write its own solver, then the frozen code faces {CODE.cases} hidden cubes. 100 = {CODE.reference} moves a
        cube, the scramble&apos;s own length; fewer moves score more.
      </p>
      {rows.length === 0 ? (
        <p className="ixb-empty">No solver graded yet.</p>
      ) : (
        <ol className="bench-list">
          {rows.map((e, i) => (
            <li key={e.id}>
              <span className="ixb-rank">{i + 1}</span>
              <span className="bench-name">
                <Link href={`/models/${e.slug}`}>{e.model}</Link>
                {e.effort && <span className="ixb-effort">{e.effort}</span>}
                <span className="bench-sub">
                  {e.solved ?? 0} of {e.cases ?? CODE.cases} solved
                </span>
              </span>
              <b className="bench-score">
                <span className="sr-only">Score: </span>
                {num(e.score)}
              </b>
              <span className="ixb-bar" aria-hidden>
                <i style={{ width: `${Math.max(1.5, (100 * (e.score ?? 0)) / max)}%`, background: e.color }} />
              </span>
            </li>
          ))}
        </ol>
      )}
      <p className="bench-more">
        <Link href="/code">Full coding board →</Link>
      </p>
    </article>
  );
}

/** A board's top climbers (one row per model, at its best run), as bars up to the top level. */
export function BoardCard({ rows, maxLevel }: { rows: LadderRow[]; maxLevel: number }) {
  const top = rows.slice(0, 6);
  return (
    <article className="card bench-card" aria-labelledby="boards-title">
      <span className="kicker k-blue">Boards</span>
      <h3 id="boards-title">Top climbers on the 3×3</h3>
      <p className="bench-blurb">
        The boards rank every ladder and scramble on its own, community runs included. This is the 3×3 interactive ladder (level N is N moves
        from solved), no code allowed, Verified runs only.
      </p>
      {top.length === 0 ? (
        <p className="ixb-empty">Verified runs are on their way.</p>
      ) : (
        <ol className="bench-list">
          {top.map((r, i) => {
            const { model, effort } = splitLabel(r.model_name);
            return (
              <li key={`${r.model_name}|${r.display_name}`}>
                <span className="ixb-rank">{i + 1}</span>
                <span className="bench-name">
                  {r.model_href ? <Link href={r.model_href}>{model}</Link> : model}
                  {effort && <span className="ixb-effort">{effort}</span>}
                  <span className="bench-sub">
                    {r.moves !== null && `${r.moves} moves`}
                    {r.best_attempt && (
                      <>
                        {r.moves !== null && ' · '}
                        <Link href={`/replay/${r.best_attempt}`} prefetch={false} aria-label={`Replay of ${r.model_name}'s best solve`}>
                          replay
                        </Link>
                      </>
                    )}
                  </span>
                </span>
                <b className="bench-score">
                  <span className="sr-only">Best level: </span>
                  {r.best}
                  <small> / {maxLevel}</small>
                </b>
                <span className="ixb-bar" aria-hidden>
                  <i style={{ width: `${Math.max(1.5, (100 * r.best) / maxLevel)}%`, background: makerOf(model).color }} />
                </span>
              </li>
            );
          })}
        </ol>
      )}
      <p className="bench-more">
        <Link href="/leaderboard">All boards →</Link>
        <span>
          Played it yourself in a chat app? <Link href="/leaderboard?board=community#3x3-ladder-interactive-model-only">Community board</Link>
        </span>
      </p>
    </article>
  );
}
