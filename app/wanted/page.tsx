import type { Metadata } from 'next';
import Link from 'next/link';
import WantedTable, { type WantedItem } from '@/components/WantedTable';
import CopyButton from '@/components/CopyButton';
import { CATALOG_BUILT, harnessLabel } from '@/lib/arena/catalog';
import { CLAIM_HOURS } from '@/lib/arena/claims';
import { sweepExpired } from '@/lib/arena/service';
import { SUITES } from '@/lib/arena/suites';
import { THOROUGH_TOP, type WantedRow, wantedRows } from '@/lib/arena/wanted';
import { RUNNER_INSTALL } from '@/lib/site';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Help wanted',
  description: 'Every current model that can see a picture, at every effort, and which ones still need a Verified Cube Arena run.',
};

const item = (r: WantedRow): WantedItem => ({
  key: `${r.model.id}|${r.effort ?? ''}|${r.kind}`,
  model_id: r.model.id,
  name: r.model.name,
  maker: r.model.maker,
  effort: r.effort,
  runs: r.runs,
  mean: r.mean,
  via: Object.keys(r.model.via).map((h) => harnessLabel(h) as string),
  claim: r.claim && { by: r.claim.by, expires_at: r.claim.expires_at },
  command: r.command,
});

export default async function Wanted() {
  await sweepExpired().catch(() => {});
  const { rows } = await wantedRows();
  const fast = rows.filter((r) => r.kind === 'fast');
  const thorough = rows.filter((r) => r.kind === 'thorough');
  const done = fast.filter((r) => r.runs > 0).length;
  const claimed = rows.filter((r) => r.claim).length;
  const models = new Set(fast.map((r) => r.model.id)).size;
  const setup = `${RUNNER_INSTALL}\ncube-arena-runner login AB12-CD34`;

  return (
    <div className="wrap page-head">
      <span className="kicker k-blue">Help wanted</span>
      <h1>Run a model for the Index</h1>
      <p>
        There are too many models and effort levels for us to run alone. If we gave you an invite code, you can run any of these with your own
        API keys or subscriptions. Your results go on the Verified board, run by the same locked-down runner we use.
      </p>

      <div className="kpis">
        <div className="kpi big">
          <span>Fast results</span>
          <strong>
            {done} / {fast.length}
          </strong>
          <em>model × effort pairs, {models} models</em>
        </div>
        <div className="kpi">
          <span>Claimed now</span>
          <strong>{claimed}</strong>
          <em>for {CLAIM_HOURS} h each</em>
        </div>
        <div className="kpi">
          <span>Thorough</span>
          <strong>
            {thorough.filter((r) => r.runs > 0).length} / {thorough.length || THOROUGH_TOP}
          </strong>
          <em>the top {THOROUGH_TOP} on Fast</em>
        </div>
      </div>

      <section className="card ix-card">
        <header className="ix-head">
          <h2>How to help</h2>
        </header>
        <ol className="steps">
          <li>
            <strong>Install the runner and save your invite code</strong> (once, needs Node 20+). Login asks whether to show your name next to
            your results. The runner comes from this site, not npm&apos;s registry; it tells you when there&apos;s a newer one.
            <div className="codebox">
              <pre>{setup}</pre>
              <CopyButton text={setup} />
            </div>
          </li>
          <li>
            <strong>Pick a row below and run its command.</strong> It claims that model and effort for {CLAIM_HOURS} hours, plays the{' '}
            {SUITES.fast.name} suite (about 45 minutes), and posts the result. Claude models run through Claude Code, GPT models through Codex,
            and anything else through OpenRouter (<code>OPENROUTER_API_KEY</code>) or another OpenAI-compatible API (<code>--via api</code>).
          </li>
          <li>
            <strong>That&apos;s it.</strong> The result shows up on <Link href="/benchmark">the Index</Link>. If two people run the same thing, the
            Index shows the average. The runner also uploads a text log of each session (no pictures) so we can check it. If you show your name,
            you go on the <Link href="/contributors">contributors board</Link>, with your X handle if you add one (
            <code>cube-arena-runner profile --x yourhandle</code>).
          </li>
        </ol>
        <p className="ix-foot">
          No invite? You can still play any suite on the Community board: see <Link href="/connect">Connect</Link>. Models come from{' '}
          <Link href="https://artificialanalysis.ai/leaderboards/models">Artificial Analysis</Link>&apos;s current list (as of {CATALOG_BUILT}), kept to
          those that can read an image and call tools.
        </p>
      </section>

      <section className="card ix-card">
        <header className="ix-head">
          <h2>{SUITES.fast.name} suite</h2>
          <p>Every current model that can see the cube, at every effort it offers.</p>
        </header>
        <WantedTable items={fast.map(item)} empty="Everything here has a result or a claim. Thank you!" />
      </section>

      <section className="card ix-card">
        <header className="ix-head">
          <h2>{SUITES.thorough.name} suite</h2>
          <p>
            Up to about 8 hours, so only the {THOROUGH_TOP} best models on Fast, at their top effort. This list fills in as Fast results arrive.
          </p>
        </header>
        <WantedTable items={thorough.map(item)} empty="Nothing yet: Thorough opens up once models have Fast results." />
      </section>
    </div>
  );
}
