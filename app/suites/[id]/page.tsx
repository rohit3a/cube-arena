import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PersonName } from '@/components/People';
import { OUT_OF_OUTPUT, OUT_OF_OUTPUT_WHY, fmtCost, fmtDuration, fmtScore, fmtTokens, heat } from '@/lib/arena/format';
import { suiteEntry, testNames } from '@/lib/arena/index-data';
import { CHALLENGE_LABEL, GAUNTLET, GAUNTLET_TAG, LADDER_MAX_LEVEL, MODE_LABEL } from '@/lib/arena/rules';
import { SUITES } from '@/lib/arena/suites';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const e = await suiteEntry((await props.params).id);
  return { title: e ? `${e.label} · ${SUITES[e.kind].name} suite` : 'Suite' };
}

const END: Record<string, string> = {
  cleared: 'cleared every level',
  out_of_lives: 'out of lives',
  solved: 'solved',
  failed: 'not solved',
  timeout: 'time ran out',
  stopped: 'stopped',
  gave_up: 'gave up',
  invalid: 'too many invalid moves',
};

export default async function SuitePage(props: { params: Promise<{ id: string }> }) {
  const e = await suiteEntry((await props.params).id);
  if (!e) notFound();
  const def = SUITES[e.kind];
  const names = testNames(e.kind);
  /** "Test 2 of 3", "Gauntlet test 1 of 2": the Gauntlet is counted apart, since most suites never reach it. */
  const slotLabel = (i: number) => {
    const g = !!def.slots[i].gauntlet;
    const same = def.slots.flatMap((x, j) => (!!x.gauntlet === g ? [j] : []));
    return `${g ? `${GAUNTLET.name} test` : 'Test'} ${same.indexOf(i) + 1} of ${same.length}`;
  };
  const tag = e.gauntlet === 'pending' || e.gauntlet === 'playing' ? GAUNTLET_TAG[e.gauntlet] : null;

  return (
    <div className="wrap page-head">
      <span className={`kicker ${e.kind === 'fast' ? 'k-green' : 'k-blue'}`}>
        {def.name} suite {e.version}
      </span>
      <h1>{e.label}</h1>
      <p>
        {e.board === 'verified' ? (
          <>
            <span className="badge verified">Verified</span> Run by{' '}
            {e.contributor ? <PersonName {...e.contributor} /> : e.run_by[0] === 'Cube Arena' ? 'us' : e.run_by[0]} through{' '}
            {e.harness ?? e.runs[0]?.via ?? 'the official CLI'}, locked to the cube tools.
          </>
        ) : (
          <>
            <span className="badge">Community</span> Played by {e.display_name}; the model name is self-reported.
          </>
        )}{' '}
        {e.status === 'active'
          ? `In progress: ${e.progress.started} of ${e.progress.of} tests started.`
          : `Finished ${new Date(e.finished_at ?? e.created_at).toUTCString().slice(5, 22)} UTC.`}
        {e.gauntlet === 'pending' && ` It scored 100 on all three tests, which unlocks the ${GAUNTLET.size}×${GAUNTLET.size} ${GAUNTLET.name}; it hasn't played it yet.`}
        {e.gauntlet === 'playing' && ` It scored 100 on all three tests and is playing the ${GAUNTLET.size}×${GAUNTLET.size} ${GAUNTLET.name} now.`}
      </p>

      <div className="kpis">
        <div className="kpi big">
          <span>Index</span>
          <strong>{e.status === 'finished' ? fmtScore(e.score) : '…'}</strong>
          <em>{tag ? `out of 100 · ${tag}` : 'out of 100'}</em>
        </div>
        <div className="kpi">
          <span>Cubes solved</span>
          <strong>{e.solved}</strong>
        </div>
        <div className="kpi">
          <span>Moves</span>
          <strong>{e.moves}</strong>
          <em>{e.moves_per_solve === null ? 'none solved' : `${e.moves_per_solve.toFixed(1)} per solve`}</em>
        </div>
        <div className="kpi">
          <span>Time</span>
          <strong>{fmtDuration(e.secs)}</strong>
        </div>
        <div className="kpi">
          <span>Tokens</span>
          <strong>{fmtTokens(e.output_tokens === null ? null : (e.input_tokens ?? 0) + e.output_tokens)}</strong>
          <em>{e.output_tokens === null ? 'not reported' : `${fmtTokens(e.output_tokens)} out`}</em>
        </div>
        <div className="kpi">
          <span>Cost</span>
          <strong>{fmtCost(e.cost_usd)}</strong>
          <em>{e.cost_usd === null ? 'not reported' : e.cost_estimated ? 'at list prices' : 'API-equivalent'}</em>
        </div>
      </div>

      <h2 className="sub-head">Tests</h2>
      <div className="test-grid">
        {names.map((t) => {
          const grade = e.tests.find((x) => x.test === t.test);
          const slots = def.slots.map((s, i) => ({ s, i })).filter((x) => x.s.test === t.test);
          const locked = t.gauntlet && e.gauntlet === 'locked';
          // An unlocked Gauntlet test nobody has started yet counts 0 in the score so far, but it isn't a 0 yet.
          const waiting = t.gauntlet && e.gauntlet !== 'done' && !slots.some(({ i }) => e.runs.some((r) => r.slot === i));
          return (
            <article key={t.test} className={`card test-card${locked ? ' locked' : ''}`}>
              <header>
                <h3>{t.name}</h3>
                <span className={`score-chip ${locked || waiting ? 'chip-off' : heat(grade?.score ?? null)}`}>
                  {locked ? '–' : waiting ? 'pending' : fmtScore(grade?.score ?? null)}
                </span>
              </header>
              <ul>
                {slots.map(({ s, i }) => {
                  const r = e.runs.find((x) => x.slot === i);
                  return (
                    <li key={i}>
                      <span className="faint">{slotLabel(i)}</span>
                      {!r ? (
                        <span className="muted">
                          {s.gauntlet
                            ? e.gauntlet === 'locked'
                              ? e.status === 'active'
                                ? 'unlocks with 100 on the three tests above'
                                : 'locked: it takes 100 on the three tests above'
                              : 'unlocked, not played yet'
                            : e.status === 'active'
                              ? 'not started yet'
                              : 'not played'}
                        </span>
                      ) : (
                        <span>
                          {s.challenge === 'ladder' ? (
                            <>
                              best level <strong>{r.best_level}</strong> of {r.top_level ?? LADDER_MAX_LEVEL[s.size]}
                            </>
                          ) : r.solves > 0 ? (
                            <strong className="ok">solved</strong>
                          ) : (
                            <strong className="no">not solved</strong>
                          )}
                          {' · '}
                          {r.moves} moves · {fmtDuration(r.secs)}
                          {r.status === 'active' ? (
                            ' · playing now'
                          ) : r.out_of_output !== null ? (
                            <>
                              {' · '}
                              <span className="tag tag-oo" title={`The test ended because ${OUT_OF_OUTPUT_WHY}. It keeps the levels it had cleared.`}>
                                {OUT_OF_OUTPUT} on level {r.out_of_output}
                              </span>
                            </>
                          ) : r.end_reason ? (
                            ` · ${END[r.end_reason] ?? r.end_reason}`
                          ) : (
                            ''
                          )}
                          {r.replay && (
                            <>
                              {' · '}
                              <Link prefetch={false} href={`/replay/${r.replay}`}>replay</Link>
                            </>
                          )}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
              <p className="faint test-meta">
                {CHALLENGE_LABEL[slots[0].s.challenge]}, {MODE_LABEL[slots[0].s.mode].toLowerCase()}
              </p>
            </article>
          );
        })}
      </div>

      <p className="board-foot">
        <Link href={`/models/${e.slug}`}>More for {e.model}</Link> · <Link href="/benchmark">The index</Link> · <Link href="/benchmark#method">How it&apos;s graded</Link>
      </p>
    </div>
  );
}
