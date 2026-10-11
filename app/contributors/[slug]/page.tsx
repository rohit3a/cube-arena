import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import CopyButton from '@/components/CopyButton';
import { Handle, fmtDate } from '@/components/People';
import { contributor, contributorBoard } from '@/lib/arena/contributors';
import { fmtDuration, fmtScore, fmtTokens, heat } from '@/lib/arena/format';
import { SUITES } from '@/lib/arena/suites';
import { SITE_URL } from '@/lib/site';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const p = await contributor((await props.params).slug);
  if (!p) return { title: 'Contributor' };
  const description = `${p.name}${p.x ? ` (@${p.x})` : ''} ran ${p.tests} tests on ${p.models} ${p.models === 1 ? 'model' : 'models'} for the Cube Arena Index.`;
  // These replace the layout's openGraph and twitter objects rather than merging, so they repeat the card type.
  return {
    title: `${p.name} · Contributors`,
    description,
    openGraph: { siteName: 'Cube Arena', type: 'profile', description },
    twitter: { card: 'summary_large_image', description, creator: p.x ? `@${p.x}` : undefined },
  };
}

export default async function Profile(props: { params: Promise<{ slug: string }> }) {
  const slug = (await props.params).slug;
  const [p, { people }] = await Promise.all([contributor(slug), contributorBoard()]);
  if (!p) notFound();
  const url = `${SITE_URL}/contributors/${p.slug}`;
  const firsts = new Set(p.first_ids);
  const text = `I've run ${p.tests} tests on ${p.models} ${p.models === 1 ? 'model' : 'models'} for the Cube Arena Index, where AI models solve a cube from pictures only.`;
  const share = `https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;

  return (
    <div className="wrap page-head">
      <span className="kicker k-orange">
        Contributor #{p.rank} of {people.length}
      </span>
      <h1>{p.name}</h1>
      <p>
        {p.x ? (
          <>
            <Handle x={p.x} /> on X.{' '}
          </>
        ) : null}
        Ran Verified suites for the Cube Arena Index with their own model access, from {fmtDate(p.first_at)} to {fmtDate(p.last_at)}.
      </p>

      <div className="share-row">
        <a className="btn btn-primary btn-small" href={share} rel="noopener" target="_blank">
          Share on X
        </a>
        <CopyButton text={url} label="Copy link" />
        <Link href="/contributors" className="btn btn-small">
          All contributors
        </Link>
      </div>

      <div className="kpis">
        <div className="kpi big">
          <span>Tests played</span>
          <strong>{p.tests}</strong>
          <em>
            {p.fast} Fast, {p.thorough} Thorough
          </em>
        </div>
        <div className="kpi">
          <span>New results</span>
          <strong>{p.firsts}</strong>
          <em>first on the Index</em>
        </div>
        <div className="kpi">
          <span>Models</span>
          <strong>{p.models}</strong>
          <em>{p.makers.join(', ')}</em>
        </div>
        <div className="kpi">
          <span>On the cube</span>
          <strong>{fmtDuration(p.secs)}</strong>
          <em>{p.tokens ? `${fmtTokens(p.tokens)} tokens` : 'model time'}</em>
        </div>
      </div>

      <section className="card ix-card">
        <header className="ix-head">
          <h2>Their suites</h2>
          <p>Each one is a full suite on the Verified board. Open one for every test and replay.</p>
        </header>
        <div className="table-wrap flat">
          <table>
            <thead>
              <tr>
                <th>Model</th>
                <th>Suite</th>
                <th className="num">Index</th>
                <th className="opt">Finished</th>
              </tr>
            </thead>
            <tbody>
              {p.suites.map((e) => (
                <tr key={e.id}>
                  <td className="model-cell">
                    <Link href={`/suites/${e.id}`} className="model-link">
                      <i className="swatch" style={{ background: e.color }} />
                      {e.label}
                    </Link>
                    {firsts.has(e.id) && (
                      <span className="badge new" title="The first finished run of this model and effort on this suite">
                        New result
                      </span>
                    )}
                  </td>
                  <td>{SUITES[e.kind].name}</td>
                  <td className={`num heat-cell ${heat(e.score)}`}>{fmtScore(e.score)}</td>
                  <td className="faint opt">{fmtDate(e.finished_at as string)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
