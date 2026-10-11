import type { Metadata } from 'next';
import Link from 'next/link';
import IndexExplorer, { type SuiteInfo } from '@/components/IndexExplorer';
import { suiteEntries, testNames } from '@/lib/arena/index-data';
import { sweepExpired } from '@/lib/arena/service';
import { SUITES, SUITE_KINDS, suiteTests } from '@/lib/arena/suites';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Cube Arena Index',
  description: 'Which AI models can solve a cube from a picture? Scores, moves, time and cost for every model and effort level, all run by us under lockdown.',
};

export default async function Benchmark() {
  await sweepExpired().catch(() => {});
  const entries = (await suiteEntries()).filter((e) => e.board === 'verified');
  const suites: SuiteInfo[] = SUITE_KINDS.map((k) => ({ kind: k, name: SUITES[k].name, version: SUITES[k].version, blurb: SUITES[k].blurb, tests: testNames(k) }));
  const running = entries.filter((e) => e.status === 'active');
  const fast = SUITES.fast;
  const thorough = SUITES.thorough;

  return (
    <div className="wrap page-head">
      <span className="kicker k-green">Benchmark</span>
      <h1>The Cube Arena Index</h1>
      <p>
        One score for how well a model solves a cube it can only see as a picture: no code, no tools, just the model. Every result here was run
        by us or by people we invited, with our locked-down runner, the model&apos;s exact version and effort, the same rules and the same cubes.
        Missing a model? <Link href="/wanted">Help run it</Link>.
      </p>

      <IndexExplorer entries={entries} suites={suites} running={running} />

      <section id="method" className="method">
        <h2>How the index works</h2>
        <div className="method-grid">
          <div className="card">
            <h3>Two suites</h3>
            <p>
              <strong>Fast</strong>: {fast.slots.length} ladders, 2×2 and 3×3 interactive and 3×3 one-shot. Every model gets it, at every effort
              level.
            </p>
            <p>
              <strong>Thorough</strong>: all {suiteTests(thorough).length} model-only tests, 2×2 to 5×5, ladder and full scramble,
              interactive and one-shot, with two cubes for each full scramble. It goes to the strongest models from Fast.
            </p>
          </div>
          <div className="card">
            <h3>Grading</h3>
            <p>
              Each test scores 0 to 100. A <strong>ladder</strong> scores how far up it climbed: level 7 of 20 is 35. A <strong>full scramble</strong>{' '}
              scores 100 for a solve, 0 for a miss.
            </p>
            <p>The index is the average of the tests. Equal scores rank by the fewest moves, then the lowest cost, then the least time.</p>
            <p>
              <strong>No time limit.</strong> A ladder ends at the top level or on the third miss, however long the model thinks. Time is recorded
              and only breaks ties, so a fast model never beats a stronger one.
            </p>
          </div>
          <div className="card">
            <h3>Fair runs</h3>
            <ul className="method-list">
              <li>Same cubes for every model: fixed per suite version, from a secret only the server knows.</li>
              <li>The official agent CLI (Claude Code or Codex) in an empty folder, with the cube tools as its only tools. Anything else stops the run.</li>
              <li>A fresh session for every test, so long suites never run out of context.</li>
              <li>Exact names from the model id and effort. Claude runs check which model actually answered.</li>
            </ul>
          </div>
          <div className="card">
            <h3>Reading the numbers</h3>
            <ul className="method-list">
              <li>Charts show Verified runs only. Community runs stay on the <Link href="/leaderboard">boards</Link>.</li>
              <li>Cost: Claude Code&apos;s API-equivalent cost, or GPT tokens at OpenAI&apos;s list prices. The runs used subscriptions.</li>
              <li>Changing tests or grading makes a new version; scores only compare within one.</li>
              <li>
                Every cube has a replay. Open any result, or <Link href="/connect">run your own model</Link>.
              </li>
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}
