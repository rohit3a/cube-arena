import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PersonName } from '@/components/People';
import { codeCaseRows, codeEntry } from '@/lib/arena/code';
import { CODE, caseScore } from '@/lib/arena/code-rules';
import { fmtCost, fmtDuration, fmtMs, fmtScore, fmtTokens } from '@/lib/arena/format';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const e = await codeEntry((await props.params).id);
  return { title: e ? `${e.label} · coding benchmark` : 'Coding benchmark' };
}

const STATUS: Record<string, string> = {
  coding: 'The model is writing its solver.',
  queued: 'The solver is frozen and waiting for the grader.',
  grading: 'The grader is running it on the hidden cubes now.',
};
const CASE: Record<string, string> = { solved: 'solved', unsolved: 'not solved', illegal: 'unreadable answer', timeout: 'out of time', crash: 'crashed' };

export default async function CodeSubmissionPage(props: { params: Promise<{ id: string }> }) {
  const id = (await props.params).id;
  const e = await codeEntry(id);
  if (!e) notFound();
  const cases = e.status === 'graded' ? await codeCaseRows(id) : [];
  const counts = cases.reduce<Record<string, number>>((a, c) => ({ ...a, [c.status]: (a[c.status] ?? 0) + 1 }), {});

  return (
    <div className="wrap page-head">
      <span className="kicker k-orange">Coding benchmark {CODE.version}</span>
      <h1>{e.label}</h1>
      <p>
        <span className="badge verified">Verified</span> Written by the model through {e.harness ?? 'its CLI'}, sandboxed with no network; run by{' '}
        {e.contributor ? <PersonName {...e.contributor} /> : e.run_by === 'Cube Arena' ? 'us' : e.run_by}.{' '}
        {e.status === 'graded' ? `Graded ${new Date(e.graded_at ?? e.created_at).toUTCString().slice(5, 22)} UTC.` : STATUS[e.status]}{' '}
        <Link href="/code">All solvers</Link>
      </p>

      <div className="kpis">
        <div className="kpi big">
          <span>Score</span>
          <strong>{e.status === 'graded' ? fmtScore(e.score) : '…'}</strong>
          <em>100 = {CODE.reference} moves a cube</em>
        </div>
        <div className="kpi">
          <span>Solved</span>
          <strong>{e.solved ?? '–'}</strong>
          <em>of {e.cases ?? CODE.cases} hidden cubes</em>
        </div>
        <div className="kpi">
          <span>Moves</span>
          <strong>{e.mean_moves === null ? '–' : e.mean_moves.toFixed(1)}</strong>
          <em>per cube solved</em>
        </div>
        <div className="kpi">
          <span>Per cube</span>
          <strong>{fmtMs(e.mean_ms)}</strong>
          <em>limit {CODE.solveSecs} s</em>
        </div>
        <div className="kpi">
          <span>Coding</span>
          <strong>{e.dev_minutes === null ? '–' : fmtDuration(e.dev_minutes * 60)}</strong>
          <em>of {CODE.devHours} h</em>
        </div>
        <div className="kpi">
          <span>Cost</span>
          <strong>{fmtCost(e.cost_usd)}</strong>
          <em>{e.output_tokens === null ? 'not reported' : `${fmtTokens((e.input_tokens ?? 0) + e.output_tokens)} tokens${e.cost_estimated ? ', at list prices' : ''}`}</em>
        </div>
      </div>

      {e.status === 'graded' && (
        <section className="card ix-card">
          <header className="ix-head">
            <h2>The {cases.length} hidden cubes</h2>
            <p>
              {Object.entries(counts)
                .map(([k, n]) => `${n} ${CASE[k] ?? k}`)
                .join(' · ')}
              {e.build_ok === false && ' · the build failed, so nothing ran'}
            </p>
          </header>
          <ol className="case-grid">
            {cases.map((c) => (
              <li key={c.case_no} className={`case case-${c.status}`} title={`Cube ${c.case_no + 1}: ${CASE[c.status]}${c.moves !== null ? `, ${c.moves} moves` : ''}${c.ms !== null ? `, ${fmtMs(c.ms)}` : ''}${c.detail && c.status !== 'solved' ? ` (${c.detail})` : ''}`}>
                <span className="case-n">{c.case_no + 1}</span>
                <strong>{c.status === 'solved' ? c.moves : '✕'}</strong>
                <span className="case-s">{c.status === 'solved' ? fmtScore(caseScore(c)) : CASE[c.status]}</span>
              </li>
            ))}
          </ol>
          <p className="muted small-note">
            Moves for each cube solved, and its score (100 × {CODE.reference} ÷ moves). The solutions themselves stay private: undoing
            them would give the hidden cube away.
          </p>
        </section>
      )}

      {e.bundle_sha256 && (
        <section className="card ix-card">
          <header className="ix-head">
            <h2>The solver</h2>
          </header>
          <p>
            Frozen when the model stopped: {e.bundle_bytes !== null ? `${(e.bundle_bytes / 1024).toFixed(0)} KB gzipped` : ''}, sha256{' '}
            <code>{e.bundle_sha256.slice(0, 16)}…</code>.{' '}
            {e.status === 'graded' ? (
              <a href={`/api/code/files?id=${e.id}&kind=bundle`}>Download the code</a>
            ) : (
              'The code is published once it has been graded.'
            )}
          </p>
        </section>
      )}
    </div>
  );
}
