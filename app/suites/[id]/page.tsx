import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { fmtCost, fmtDuration, fmtScore, fmtTokens, heat } from '@/lib/arena/format';
import { suiteEntry, testNames } from '@/lib/arena/index-data';
import { CHALLENGE_LABEL, LADDER_MAX_LEVEL, MODE_LABEL } from '@/lib/arena/rules';
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
  gave_up: 'gave up',
  invalid: 'too many invalid moves',
};

export default async function SuitePage(props: { params: Promise<{ id: string }> }) {
  const e = await suiteEntry((await props.params).id);
  if (!e) notFound();
  const def = SUITES[e.kind];
  const names = testNames(e.kind);
  const total = def.slots.length;

  return (
    <div className="wrap page-head">
      <span className={`kicker ${e.kind === 'fast' ? 'k-green' : 'k-blue'}`}>
        {def.name} suite {e.version}
      </span>
      <h1>{e.label}</h1>
      <p>
        {e.board === 'verified' ? (
          <>
            <span className="badge verified">Verified</span> Run by us through {e.runs[0]?.via ?? 'the official CLI'}, locked to the cube tools.
          </>
        ) : (
          <>
            <span className="badge">Community</span> Played by {e.display_name}; the model name is self-reported.
          </>
        )}{' '}
        {e.status === 'active' ? `In progress: ${e.runs.length} of ${total} tests started.` : `Finished ${new Date(e.finished_at ?? e.created_at).toUTCString().slice(5, 22)} UTC.`}
      </p>

      <div className="kpis">
        <div className="kpi big">
          <span>Index</span>
          <strong>{e.status === 'finished' ? fmtScore(e.score) : '…'}</strong>
          <em>out of 100</em>
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
          return (
            <article key={t.test} className="card test-card">
              <header>
                <h3>{t.name}</h3>
                <span className={`score-chip ${heat(grade?.score ?? null)}`}>
                  {fmtScore(grade?.score ?? null)}
                </span>
              </header>
              <ul>
                {slots.map(({ s, i }) => {
                  const r = e.runs.find((x) => x.slot === i);
                  return (
                    <li key={i}>
                      <span className="faint">
                        Test {i + 1} of {total} · {s.minutes} min
                      </span>
                      {!r ? (
                        <span className="muted">{e.status === 'active' ? 'not started yet' : 'not played (counts 0)'}</span>
                      ) : (
                        <span>
                          {s.challenge === 'ladder' ? (
                            <>
                              best level <strong>{r.best_level}</strong> of {LADDER_MAX_LEVEL[s.size]}
                            </>
                          ) : r.solves > 0 ? (
                            <strong className="ok">solved</strong>
                          ) : (
                            <strong className="no">not solved</strong>
                          )}
                          {' · '}
                          {r.moves} moves · {fmtDuration(r.secs)}
                          {r.status === 'active' ? ' · playing now' : r.end_reason ? ` · ${END[r.end_reason] ?? r.end_reason}` : ''}
                          {r.replay && (
                            <>
                              {' · '}
                              <Link href={`/replay/${r.replay}`}>replay</Link>
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
