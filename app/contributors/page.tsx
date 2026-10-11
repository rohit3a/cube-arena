import type { Metadata } from 'next';
import Link from 'next/link';
import { Handle, PersonName, fmtDate } from '@/components/People';
import { contributorBoard } from '@/lib/arena/contributors';
import { fmtDuration, fmtTokens } from '@/lib/arena/format';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Contributors',
  description: 'The people who ran Verified Cube Arena Index suites with their own model access, ranked by tests played.',
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export default async function Contributors() {
  const { people, anonymous, ours } = await contributorBoard();
  const tests = people.reduce((a, p) => a + p.tests, 0);
  const suites = people.reduce((a, p) => a + p.suites.length, 0);
  const tokens = people.reduce((a, p) => a + p.tokens, 0);
  const firsts = people.reduce((a, p) => a + p.firsts, 0);

  return (
    <div className="wrap page-head">
      <span className="kicker k-orange">Contributors</span>
      <h1>The people behind the Index</h1>
      <p>
        Everyone here ran Verified suites with an invite code and their own model access, and chose to show their name. Ranked by tests
        played; new results, a model and effort nobody had run before, break ties.
      </p>

      <div className="kpis">
        <div className="kpi big">
          <span>Contributors</span>
          <strong>{people.length}</strong>
          <em>{plural(suites, 'suite')} between them</em>
        </div>
        <div className="kpi">
          <span>Tests played</span>
          <strong>{tests}</strong>
          <em>{plural(firsts, 'new result')}</em>
        </div>
        <div className="kpi">
          <span>Tokens</span>
          <strong>{fmtTokens(tokens)}</strong>
          <em>on their own keys</em>
        </div>
      </div>

      {people.length === 0 ? (
        <section className="card ix-card">
          <p className="chart-empty">
            Nobody yet. The first invited tester to finish a suite with their name shown goes here. See <Link href="/wanted">Wanted</Link> for
            what still needs running.
          </p>
        </section>
      ) : (
        <>
          <ol className="people-top">
            {people.slice(0, 3).map((p) => (
              <li key={p.slug} className={`person-card r${p.rank}`}>
                <span className={`medal m${p.rank}`}>{p.rank}</span>
                <Link href={`/contributors/${p.slug}`} className="person-card-name">
                  {p.name}
                </Link>
                <Handle x={p.x} />
                <span className="person-card-stats">
                  <b>{p.tests}</b> tests · <b>{p.firsts}</b> new · <b>{p.models}</b> {p.models === 1 ? 'model' : 'models'}
                </span>
              </li>
            ))}
          </ol>

          <section className="card ix-card">
            <header className="ix-head">
              <h2>Everyone</h2>
              <p>Finished Verified suites only. A new result is the first finished run of a model and effort on a suite.</p>
            </header>
            <div className="table-wrap flat">
              <table className="people">
                <thead>
                  <tr>
                    <th className="rank">#</th>
                    <th>Contributor</th>
                    <th className="num">Tests</th>
                    <th className="num">New</th>
                    <th className="num opt">Models</th>
                    <th className="num opt">Suites</th>
                    <th className="num opt opt-md">Time</th>
                    <th className="num opt opt-md">Tokens</th>
                    <th className="opt opt-md">Last run</th>
                  </tr>
                </thead>
                <tbody>
                  {people.map((p) => (
                    <tr key={p.slug}>
                      <td className="rank">
                        <span className={`medal ${p.rank <= 3 ? `m${p.rank}` : ''}`}>{p.rank}</span>
                      </td>
                      <td className="model-cell">
                        <PersonName slug={p.slug} name={p.name} x={p.x} />
                        <span>{p.makers.join(', ')}</span>
                      </td>
                      <td className="num">
                        <strong>{p.tests}</strong>
                      </td>
                      <td className="num">{p.firsts}</td>
                      <td className="num opt">{p.models}</td>
                      <td className="num opt" title={`${p.fast} Fast, ${p.thorough} Thorough`}>
                        {p.suites.length}
                      </td>
                      <td className="num opt opt-md">{fmtDuration(p.secs)}</td>
                      <td className="num opt opt-md">{p.tokens ? fmtTokens(p.tokens) : '–'}</td>
                      <td className="faint opt opt-md">{fmtDate(p.last_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="ix-foot">
              {anonymous > 0 && `Plus ${plural(anonymous, 'suite')} from invited testers who chose not to show their name. `}
              {ours > 0 && `Cube Arena ran ${plural(ours, 'suite')} itself. `}
              Invites are handed out by hand; see <Link href="/wanted">Wanted</Link> for how a run works and what still needs doing.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
