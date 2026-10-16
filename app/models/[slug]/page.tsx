import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BarChart } from '@/components/charts';
import Exportable from '@/components/Exportable';
import Writeup from '@/components/Writeup';
import { OUT_OF_OUTPUT, OUT_OF_OUTPUT_WHY, fmtCost, fmtDuration, fmtScore, fmtTokens, heat } from '@/lib/arena/format';
import { averageByLabel, provisional } from '@/lib/arena/aggregate';
import { type CatalogModel, catalogModel, harnessLabel } from '@/lib/arena/catalog';
import { type SuiteEntry, suiteEntries, testNames } from '@/lib/arena/index-data';
import { effortRank } from '@/lib/arena/makers';
import { suiteOrder } from '@/lib/arena/ranking';
import { isRunning, runningLabel } from '@/lib/arena/running';
import { GAUNTLET_TAG } from '@/lib/arena/rules';
import { SUITES, SUITE_KINDS } from '@/lib/arena/suites';
import { commandFor } from '@/lib/arena/wanted';
import { latestWriteup, liveValues, writeupHistory } from '@/lib/arena/writeups';

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
  // Some models (Composer) have no effort setting: one row each, named after the model.
  const hasEffort = es.some((e) => e.effort);
  const invited = es.some((e) => !e.run_by.includes('Cube Arena'));
  const finished = es.filter((e) => e.status === 'finished');
  const best = (kind: string) => finished.filter((e) => e.kind === kind && e.version === SUITES[e.kind].version).sort(suiteOrder)[0];
  // Our blog about the model: only once we've run it ourselves.
  const blog = board === 'verified' ? await latestWriteup('blog', slug) : null;
  const [live, versions] = blog ? await Promise.all([liveValues(), writeupHistory('blog', slug)]) : [new Map<string, string>(), []];

  return (
    <div className="wrap page-head">
      <span className="kicker k-orange">{maker}</span>
      <h1>{model}</h1>
      <p>
        {board === 'verified' ? (
          <>
            <span className="badge verified">Verified</span> Model id <code>{slug}</code>, run{hasEffort ? ' at each effort level it offers' : ''}
            {invited ? ' by us and by people we invited' : ' by us'}.{' '}
            {hasEffort ? 'Runs of the same effort are averaged.' : 'It has no effort setting, so its runs are averaged together.'}
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
              <em>
                {b ? (b.effort ? `at ${b.effort} effort` : 'no effort setting') : 'not run yet'}
                {b && (b.gauntlet === 'pending' || b.gauntlet === 'playing') && ` · ${GAUNTLET_TAG[b.gauntlet]}`}
              </em>
            </div>
          );
        })}
        <div className="kpi">
          <span>Suites run</span>
          <strong>{es.length}</strong>
        </div>
      </div>

      {blog && (
        <article className="card wu-card" id="notes">
          <span className="kicker k-green">
            Our notes · {new Date(blog.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}
          </span>
          <Writeup body={blog.body} live={live} slug={slug} />
          {versions.length > 1 && (
            <p className="faint wu-versions">
              Rewritten as new results came in. <Link href={`/notes/${slug}`}>Earlier versions</Link>
            </p>
          )}
        </article>
      )}

      {SUITE_KINDS.map((k) => {
        const all = finished.filter((e) => e.kind === k && e.version === SUITES[k].version);
        const rows = averageByLabel(all).sort((a, b) => effortRank(a.effort) - effortRank(b.effort));
        if (rows.length === 0) return null;
        const tests = testNames(k);
        // An averaged row points at its runs in the list below, which lights up; a single run at its suite.
        const runsId = (e: SuiteEntry) => `${k}-runs-${e.effort ?? 'all'}`;
        const href = (e: SuiteEntry) => (e.n > 1 ? `#${runsId(e)}` : `/suites/${e.id}`);
        const sorted = [...all].sort((a, b) => effortRank(a.effort) - effortRank(b.effort) || (b.finished_at ?? '').localeCompare(a.finished_at ?? ''));
        const groups = sorted.reduce<SuiteEntry[][]>((gs, e) => {
          const last = gs[gs.length - 1];
          if (last && last[0].effort === e.effort) last.push(e);
          else gs.push([e]);
          return gs;
        }, []);
        // Left out of the average until its Gauntlet is played (aggregate.ts).
        const waiting = (e: SuiteEntry): e is SuiteEntry & { gauntlet: 'pending' | 'playing' } => provisional(e) && all.some((x) => x.label === e.label && !provisional(x));
        return (
          <Exportable key={k} id={k} name={`${model} ${SUITES[k].name} ${SUITES[k].version}`} className="card ix-card">
            <header className="ix-head">
              <h2>
                {SUITES[k].name} {SUITES[k].version}
                {hasEffort && ' by effort'}
              </h2>
              <p>{SUITES[k].blurb}</p>
            </header>
            <BarChart
              height={180}
              items={rows.map((e) => ({
                key: e.id,
                label: e.effort ?? model,
                sub: e.gauntlet === 'pending' || e.gauntlet === 'playing' ? GAUNTLET_TAG[e.gauntlet] : null,
                value: e.score,
                color,
                href: href(e),
              }))}
            />
            <div className="table-wrap flat">
              <table className="heat">
                <thead>
                  <tr>
                    <th>{hasEffort ? 'Effort' : 'Model'}</th>
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
                        {e.n > 1 ? <a href={href(e)}>{e.effort ?? model}</a> : <Link href={href(e)}>{e.effort ?? model}</Link>}
                      </td>
                      <td className="num strong">{fmtScore(e.score)}</td>
                      {tests.map((t) => {
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
              {groups.map((g) => (
                <ul key={runsId(g[0])} id={runsId(g[0])}>
                  {g.map((e) => (
                    <li key={e.id}>
                      <Link href={`/suites/${e.id}`}>
                        <strong>{fmtScore(e.score)}</strong>
                        {e.effort && ` at ${e.effort}`}
                      </Link>{' '}
                      <span className="muted">
                        {waiting(e) && `· ${GAUNTLET_TAG[e.gauntlet]}, not in the average until it's played `}
                        · run by {e.contributor ? <Link href={`/contributors/${e.contributor.slug}`}>{e.contributor.name}</Link> : e.run_by.join(', ')}
                        {e.harness ? ` via ${e.harness}` : ''} ·{' '}
                        <span suppressHydrationWarning>{e.finished_at ? new Date(e.finished_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : ''}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              ))}
            </details>
          </Exportable>
        );
      })}

      {es.some(isRunning) && (
        <p className="ix-running model-running">
          <span className="live-dot" aria-hidden /> Running now:{' '}
          {es
            .filter(isRunning)
            .map((e) => (
              <Link key={e.id} href={`/suites/${e.id}`}>
                {e.label} · {runningLabel(e)}
              </Link>
            ))}
        </p>
      )}

      <p className="board-foot">
        <Link href={`/compare?m=${slug}`}>Compare with other models</Link> · <Link href="/benchmark">The Index</Link> · <Link href="/leaderboard">All boards</Link>
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
