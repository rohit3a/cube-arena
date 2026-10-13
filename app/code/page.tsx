import type { Metadata } from 'next';
import Link from 'next/link';
import { BarChart } from '@/components/charts';
import CopyButton from '@/components/CopyButton';
import Exportable from '@/components/Exportable';
import WaitingNote from '@/components/WaitingNote';
import { PersonName } from '@/components/People';
import { type CodeEntry, codeBoard, sweepCode } from '@/lib/arena/code';
import { CODE } from '@/lib/arena/code-rules';
import { fmtCost, fmtDuration, fmtMs, fmtScore } from '@/lib/arena/format';
import { fullEffort } from '@/lib/arena/ranking';
import { RUNNER_INSTALL } from '@/lib/site';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Coding benchmark',
  description: `Models write their own 5×5 cube solver; the frozen code then solves ${CODE.cases} hidden cubes. 100 points = ${CODE.reference} moves a cube, the scramble's own length.`,
};

const PENDING: Record<string, string> = { coding: 'writing its solver', queued: 'waiting for the grader', grading: 'being graded' };

function RunBy({ e }: { e: CodeEntry }) {
  return e.contributor ? <PersonName {...e.contributor} /> : <>{e.run_by === 'Cube Arena' ? 'us' : e.run_by}</>;
}

export default async function CodeBoardPage() {
  await sweepCode().catch(() => {});
  const board = await codeBoard();
  // A model counts once it has a solver from its top effort.
  const { ranked: graded, waiting } = fullEffort(board.graded);
  const { pending } = board;
  const best = graded[0] ?? null;
  const max = Math.max(125, Math.ceil((Math.max(0, ...graded.map((e) => e.score ?? 0)) * 1.1) / 25) * 25);
  const command = `${RUNNER_INSTALL}\ncube-arena-runner login AB12-CD34\ncube-arena-runner code --model claude-opus-5-5 --effort max`;

  return (
    <div className="wrap page-head">
      <span className="kicker k-orange">Coding benchmark {CODE.version}</span>
      <h1>Can a model write a 5×5 solver?</h1>
      <p>
        Each model gets the rules, a reference cube, {CODE.practice} practice cubes and {CODE.devHours} hours to write its own 5×5 solver,
        with no internet and no libraries. Then its code is frozen and run on {CODE.cases} cubes it has never seen, on our machine, and
        every answer is checked. Every cube was scrambled with {CODE.reference} random moves, so undoing the scramble would take{' '}
        {CODE.reference}: that scores <strong>100</strong>. Fewer moves score more; an unsolved cube scores 0.
      </p>

      <div className="kpis">
        <div className="kpi big">
          <span>Best score</span>
          <strong>{best ? fmtScore(best.score) : '–'}</strong>
          <em>{best ? best.label : 'no solver graded yet'}</em>
        </div>
        <div className="kpi">
          <span>Reference</span>
          <strong>100</strong>
          <em>{CODE.reference} moves a cube</em>
        </div>
        <div className="kpi">
          <span>Solvers graded</span>
          <strong>{graded.length}</strong>
          <em>{pending.length ? `${pending.length} in progress` : `${CODE.cases} hidden cubes each`}</em>
        </div>
      </div>

      <Exportable name="Cube Arena coding benchmark" className="card ix-card">
        <header className="ix-head">
          <h2>Score</h2>
          <p>Mean over the {CODE.cases} hidden cubes: 100 × {CODE.reference} ÷ moves for each one solved, 0 for the rest.</p>
        </header>
        <BarChart
          items={graded.map((e) => ({
            key: e.id,
            label: e.model,
            sub: e.effort,
            value: e.score,
            color: e.color,
            href: `/code/${e.id}`,
          }))}
          max={max}
          reference={{ value: 100, label: `100 = ${CODE.reference} moves, the scramble's length` }}
          empty="No solver has been graded yet."
        />
        <WaitingNote waiting={waiting} />
      </Exportable>

      {graded.length > 0 && (
        <>
          <h2 className="sub-head">Leaderboard</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="rank">#</th>
                  <th>Model</th>
                  <th className="num" title={`Hidden cubes solved, of ${CODE.cases}`}>
                    Solved
                  </th>
                  <th className="num">Score</th>
                  <th className="num" title="Mean moves over the cubes it solved">
                    Moves
                  </th>
                  <th className="num opt" title="Mean time the solver took per cube">
                    Per cube
                  </th>
                  <th className="num opt opt-md" title="Time the model spent writing its solver">
                    Coding
                  </th>
                  <th className="num opt" title="What writing the solver cost, API-equivalent">
                    Cost
                  </th>
                </tr>
              </thead>
              <tbody>
                {graded.map((e, i) => (
                  <tr key={e.id}>
                    <td className="rank">{i + 1}</td>
                    <td className="model-cell">
                      <strong>
                        <Link href={`/code/${e.id}`}>{e.label}</Link>
                      </strong>
                      <span>
                        run by <RunBy e={e} />
                        {e.harness ? ` · ${e.harness}` : ''}
                      </span>
                    </td>
                    <td className="num">
                      <strong>{e.solved}</strong>
                      <span className="faint"> / {e.cases}</span>
                    </td>
                    <td className="num">
                      <strong>{fmtScore(e.score)}</strong>
                    </td>
                    <td className="num">{e.mean_moves === null ? '–' : e.mean_moves.toFixed(1)}</td>
                    <td className="num opt">{fmtMs(e.mean_ms)}</td>
                    <td className="num opt opt-md">{e.dev_minutes === null ? '–' : fmtDuration(e.dev_minutes * 60)}</td>
                    <td className="num opt">
                      {fmtCost(e.cost_usd)}
                      {e.cost_estimated && <span className="faint">*</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small-note">
            Ranked by cubes solved, then score. Moves are averaged over the cubes each solver solved; the score averages per-cube scores, so
            the two can rank differently. One coding run each so far: read small gaps with care.
            {graded.some((e) => e.cost_estimated) && ' * Worked out from token counts at list prices.'}
          </p>
        </>
      )}

      {pending.length > 0 && (
        <>
          <h2 className="sub-head">In progress</h2>
          <ul className="code-pending">
            {pending.map((e) => (
              <li key={e.id}>
                <strong>{e.label}</strong> <span className="muted">{PENDING[e.status] ?? e.status}</span>{' '}
                <span className="faint">
                  · run by <RunBy e={e} />
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      <section className="card ix-card">
        <header className="ix-head">
          <h2>How it works</h2>
        </header>
        <ol className="steps">
          <li>
            <strong>Same start for every model.</strong> The <a href={`/code-kit/${CODE.version}/SPEC.md`}>spec</a> (the sticker format,
            the notation, how moves are counted), a <a href={`/code-kit/${CODE.version}/cube.py`}>reference cube</a> in Python,{' '}
            {CODE.practice} practice cubes with their scrambles, and a <a href={`/code-kit/${CODE.version}/check.py`}>checker</a> that runs
            the solver the way the grader does.
          </li>
          <li>
            <strong>{CODE.devHours} hours to write it.</strong> Claude Code or Codex, with files and a shell in its own folder and nothing else:
            no network, so no packages and no downloaded solvers, and only the Python and C/C++ standard libraries. It stops when it&apos;s
            happy, or when time runs out.
          </li>
          <li>
            <strong>Frozen, then graded on our machine.</strong> The solver folder is sent in and can&apos;t change. Our grader runs it on{' '}
            {CODE.cases} hidden cubes, made from a secret and never shown to anyone, each in a fresh sandbox: Linux, Python 3.12, gcc 12, 1
            CPU core that nothing else on the machine may use while it&apos;s graded, {CODE.memoryMb / 1024} GB of memory, no network, {CODE.solveSecs} s per cube (plus {CODE.buildSecs / 60} minutes once to build).
          </li>
          <li>
            <strong>Every answer checked.</strong> The server replays each solution on its cube. A solved cube scores 100 × {CODE.reference} ÷
            moves; half turns and wide turns count 1, whole-cube rotations are free. The code is published with the result.
          </li>
        </ol>
        <p className="muted small-note">
          This measures designing, building, debugging and tuning a search program in one domain, not software engineering in general.
          The hidden scrambles are never revealed: undoing them would skip the actual problem.
        </p>
      </section>

      <section className="card ix-card">
        <header className="ix-head">
          <h2>Run a model</h2>
          <p>
            With an invite code (<Link href="/apply">apply for one</Link>), on macOS or Linux with Claude Code or Codex:
          </p>
        </header>
        <div className="codebox">
          <pre>{command}</pre>
          <CopyButton text={command} />
        </div>
      </section>
    </div>
  );
}
