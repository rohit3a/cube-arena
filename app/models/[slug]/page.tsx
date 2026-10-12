import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BarChart } from '@/components/charts';
import { OUT_OF_OUTPUT, OUT_OF_OUTPUT_WHY, fmtCost, fmtDuration, fmtScore, fmtTokens, heat } from '@/lib/arena/format';
import { averageByLabel, resultHref } from '@/lib/arena/aggregate';
import { type CatalogModel, catalogModel, harnessLabel } from '@/lib/arena/catalog';
import { type SuiteEntry, suiteEntries, testNames } from '@/lib/arena/index-data';
import { effortRank } from '@/lib/arena/makers';
import { suiteOrder } from '@/lib/arena/ranking';
import { SUITES, SUITE_KINDS } from '@/lib/arena/suites';
import { commandFor } from '@/lib/arena/wanted';

export const dynamic = 'force-dynamic';

async function entriesFor(slug: string): Promise<SuiteEntry[]> {
  const all = (await suiteEntries()).filter((e) => e.slug === slug);
  const verified = all.filter((e) => e.board === 'verified');
  return verified.length ? verified : all;
}

export async function generateMetadata(props: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const slug = (await props.params).slug;
  const es = await entriesFor(slug);
  return { title: es[0]?.model ?? catalogModel(slug)?.name ?? 'Model' };
}

export default async function ModelPage(props: { params: Promise<{ slug: string }> }) {
  const slug = (await props.params).slug;
  const es = await entriesFor(slug);
  const listed = catalogModel(slug);
  if (es.length === 0) {
    if (!listed) notFound();
    return <NotRunYet slug={slug} />;
  }
  const { model, maker, color, board } = es[0];
  const invited = es.some((e) => !e.run_by.includes('Cube Arena'));
  const finished = es.filter((e) => e.status === 'finished');
  const best = (kind: string) => finished.filter((e) => e.kind === kind && e.version === SUITES[e.kind].version).sort(suiteOrder)[0];

  return (
    <div className="wrap page-head">
      <span className="kicker k-orange">{maker}</span>
      <h1>{model}</h1>
      <p>
        {board === 'verified' ? (
          <>
            <span className="badge verified">Verified</span> Model id <code>{slug}</code>, run at each effort level it offers
            {invited ? ' by us and by people we invited' : ' by us'}. Runs of the same effort are averaged.
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
        const all = finished.filter((e) => e.kind === k && e.version === SUITES[k].version);
        const rows = averageByLabel(all).sort((a, b) => effortRank(a.effort) - effortRank(b.effort));
        if (rows.length === 0) return null;
        const tests = testNames(k);
        return (
          <section key={k} id={k} className="card ix-card">
            <header className="ix-head">
              <h2>
                {SUITES[k].name} {SUITES[k].version} by effort
              </h2>
              <p>{SUITES[k].blurb}</p>
            </header>
            <BarChart
              height={180}
              items={rows.map((e) => ({ key: e.id, label: e.effort ?? 'default', value: e.score, color, href: resultHref(e) }))}
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
                    <th className="num">Runs</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((e) => (
                    <tr key={e.id}>
                      <td>
                        <Link href={e.n > 1 ? `#${k}-runs` : `/suites/${e.id}`}>{e.effort ?? 'default'}</Link>
                      </td>
                      <td className="num strong">{fmtScore(e.score)}</td>
                      {tests.map((t) => {
                        const g = e.tests.find((x) => x.test === t.test);
                        const s = g?.score ?? null;
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
                      <td className="num">{e.moves}</td>
                      <td className="num">{fmtDuration(e.secs)}</td>
                      <td className="num">{fmtTokens(e.output_tokens === null ? null : (e.input_tokens ?? 0) + e.output_tokens)}</td>
                      <td className="num">{fmtCost(e.cost_usd)}</td>
                      <td className="num">{e.n}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rows.some((e) => e.out_of_output > 0) && (
              <p className="ix-foot">
                † Ran out of output: {OUT_OF_OUTPUT_WHY}, so the test ended on that level. It keeps the levels it had cleared.{' '}
                <Link href="/benchmark#method">Why</Link>
              </p>
            )}
            <details id={`${k}-runs`} className="runs-list" open={all.length > rows.length}>
              <summary>
                Every run ({all.length})
              </summary>
              <ul>
                {all
                  .sort((a, b) => effortRank(a.effort) - effortRank(b.effort) || (b.finished_at ?? '').localeCompare(a.finished_at ?? ''))
                  .map((e) => (
                    <li key={e.id}>
                      <Link href={`/suites/${e.id}`}>
                        <strong>{fmtScore(e.score)}</strong> at {e.effort ?? 'default'}
                      </Link>{' '}
                      <span className="muted">
                        · run by {e.contributor ? <Link href={`/contributors/${e.contributor.slug}`}>{e.contributor.name}</Link> : e.run_by.join(', ')}
                        {e.harness ? ` via ${e.harness}` : ''} ·{' '}
                        <span suppressHydrationWarning>{e.finished_at ? new Date(e.finished_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : ''}</span>
                      </span>
                    </li>
                  ))}
              </ul>
            </details>
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

/** A catalog model nobody has run yet: what it is and how to run it. */
function NotRunYet({ slug }: { slug: string }) {
  const m = catalogModel(slug) as CatalogModel;
  const efforts = m.efforts.length ? m.efforts : [null];
  return (
    <div className="wrap page-head">
      <span className="kicker k-orange">{m.maker}</span>
      <h1>{m.name}</h1>
      <p>
        Not run yet. {m.efforts.length ? `It takes effort ${m.efforts.join(', ')}.` : 'It has no effort setting.'} Reached via{' '}
        {Object.keys(m.via).map((h) => harnessLabel(h)).join(', ')}.
      </p>
      <section className="card ix-card">
        <header className="ix-head">
          <h2>Run it</h2>
          <p>
            With an invite code, each of these plays the Fast suite and posts it to the Verified board. See <Link href="/wanted">what&apos;s wanted</Link>.
          </p>
        </header>
        <div className="codebox">
          <pre>{efforts.map((e) => commandFor(m.id, e, 'fast')).join('\n')}</pre>
        </div>
      </section>
      <p className="board-foot">
        <Link href="/benchmark">Compare with every model</Link> · <Link href="/wanted">Wanted</Link>
      </p>
    </div>
  );
}
