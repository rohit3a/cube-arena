import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BarChart } from '@/components/charts';
import { fmtCost, fmtDuration, fmtScore, fmtTokens, heat } from '@/lib/arena/format';
import { type SuiteEntry, suiteEntries, testNames } from '@/lib/arena/index-data';
import { effortRank } from '@/lib/arena/makers';
import { SUITES, SUITE_KINDS } from '@/lib/arena/suites';

export const dynamic = 'force-dynamic';

async function entriesFor(slug: string): Promise<SuiteEntry[]> {
  const all = (await suiteEntries()).filter((e) => e.slug === slug);
  const verified = all.filter((e) => e.board === 'verified');
  return verified.length ? verified : all;
}

export async function generateMetadata(props: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const es = await entriesFor((await props.params).slug);
  return { title: es[0]?.model ?? 'Model' };
}

export default async function ModelPage(props: { params: Promise<{ slug: string }> }) {
  const slug = (await props.params).slug;
  const es = await entriesFor(slug);
  if (es.length === 0) notFound();
  const { model, maker, color, board } = es[0];
  const finished = es.filter((e) => e.status === 'finished');
  const best = (kind: string) => finished.filter((e) => e.kind === kind && e.version === SUITES[e.kind].version).sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];

  return (
    <div className="wrap page-head">
      <span className="kicker k-orange">{maker}</span>
      <h1>{model}</h1>
      <p>
        {board === 'verified' ? (
          <>
            <span className="badge verified">Verified</span> Model id <code>{slug}</code>, run by us at each effort level it offers.
          </>
        ) : (
          <>
            <span className="badge">Community</span> Self-reported runs; we haven&apos;t run this model ourselves yet.
          </>
        )}
      </p>

      <div className="kpis">
        {SUITE_KINDS.map((k) => {
          const b = best(k);
          return (
            <div key={k} className={`kpi ${k === 'fast' ? 'big' : ''}`}>
              <span>Best {SUITES[k].name}</span>
              <strong>{b ? fmtScore(b.score) : '–'}</strong>
              <em>{b ? (b.effort ? `at ${b.effort} effort` : 'no effort setting') : 'not run yet'}</em>
            </div>
          );
        })}
        <div className="kpi">
          <span>Suites run</span>
          <strong>{es.length}</strong>
        </div>
      </div>

      {SUITE_KINDS.map((k) => {
        const rows = latestPerEffort(finished.filter((e) => e.kind === k && e.version === SUITES[k].version));
        if (rows.length === 0) return null;
        const tests = testNames(k);
        return (
          <section key={k} className="card ix-card">
            <header className="ix-head">
              <h2>
                {SUITES[k].name} {SUITES[k].version} by effort
              </h2>
              <p>{SUITES[k].blurb}</p>
            </header>
            <BarChart
              height={180}
              items={rows.map((e) => ({ key: e.id, label: e.effort ?? 'default', value: e.score, color, href: `/suites/${e.id}` }))}
            />
            <div className="table-wrap flat">
              <table className="heat">
                <thead>
                  <tr>
                    <th>Effort</th>
                    <th className="num">Index</th>
                    {tests.map((t) => (
                      <th key={t.test} className="num" title={t.name}>
                        {k === 'fast' ? t.name : t.short}
                      </th>
                    ))}
                    <th className="num">Moves</th>
                    <th className="num">Time</th>
                    <th className="num">Tokens</th>
                    <th className="num">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((e) => (
                    <tr key={e.id}>
                      <td>
                        <Link href={`/suites/${e.id}`}>{e.effort ?? 'default'}</Link>
                      </td>
                      <td className="num strong">{fmtScore(e.score)}</td>
                      {tests.map((t) => {
                        const s = e.tests.find((x) => x.test === t.test)?.score ?? null;
                        return (
                          <td key={t.test} className={`num heat-cell ${heat(s)}`}>
                            {fmtScore(s)}
                          </td>
                        );
                      })}
                      <td className="num">{e.moves}</td>
                      <td className="num">{fmtDuration(e.secs)}</td>
                      <td className="num">{fmtTokens(e.output_tokens === null ? null : (e.input_tokens ?? 0) + e.output_tokens)}</td>
                      <td className="num">{fmtCost(e.cost_usd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}

      {es.some((e) => e.status === 'active') && (
        <p className="ix-running model-running">
          <span className="live-dot" aria-hidden /> Running now:{' '}
          {es
            .filter((e) => e.status === 'active')
            .map((e) => (
              <Link key={e.id} href={`/suites/${e.id}`}>
                {e.label} · {SUITES[e.kind].name}, test {Math.max(1, e.progress.started)} of {e.progress.of}
              </Link>
            ))}
        </p>
      )}

      <p className="board-foot">
        <Link href="/benchmark">Compare with every model</Link> · <Link href="/leaderboard">All boards</Link>
      </p>
    </div>
  );
}

/** One row per effort, the most recent result for each, low to max. */
function latestPerEffort(es: SuiteEntry[]): SuiteEntry[] {
  const seen = new Map<string, SuiteEntry>();
  for (const e of es) if (!seen.has(e.effort ?? '')) seen.set(e.effort ?? '', e);
  return [...seen.values()].sort((a, b) => effortRank(a.effort) - effortRank(b.effort));
}
