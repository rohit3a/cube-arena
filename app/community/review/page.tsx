import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { type CommunityItem, communityItems, reviewIds } from '@/lib/arena/community';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Community review', robots: { index: false } };

type Props = { searchParams: Promise<{ ids?: string; t?: string; failed?: string }> };

const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC';

const STATE: Record<string, string> = { approved: 'On the boards', declined: 'Declined: off the boards' };

/** Where the operator's review link goes: community results, each with how far it got, and buttons to approve or decline. */
export default async function Review({ searchParams }: Props) {
  const { ids = '', t = '', failed } = await searchParams;
  const allowed = reviewIds(ids, t);
  if (!allowed) {
    return (
      <div className="wrap page-head">
        <h1>That link doesn&apos;t work</h1>
        <p>It may be cut short. Open it from the message again.</p>
      </div>
    );
  }
  const items = (await communityItems(new Date(0))).filter((x) => allowed.includes(x.id));
  const waiting = items.filter((x) => !x.review);
  const form = (action: 'approve' | 'decline', label: string, only?: string, primary = false) => (
    <form method="post" action="/api/community/review">
      <input type="hidden" name="ids" value={ids} />
      <input type="hidden" name="t" value={t} />
      {only && <input type="hidden" name="only" value={only} />}
      <button type="submit" name="action" value={action} className={primary ? 'btn btn-primary' : 'btn'}>
        {label}
      </button>
    </form>
  );
  return (
    <div className="wrap page-head apply community-review">
      <span className="kicker">Community review</span>
      <h1>{items.length === 1 ? items[0].display_name : `${items.length} community results`}</h1>
      <p>Approved results go on the boards with their scores, and get writeups. Declined ones stay off. Live shows them either way.</p>
      {failed && <p className="apply-error">That didn&apos;t go through. Try again in a moment.</p>}
      {waiting.length > 1 && (
        <div className="apply-actions">
          {form('approve', `Approve all ${waiting.length}`, undefined, true)}
          {form('decline', `Decline all ${waiting.length}`)}
        </div>
      )}
      {items.length < allowed.length && <p className="apply-status">{allowed.length - items.length} of these are hidden or gone, so there is nothing to review.</p>}
      {items.map((x) => (
        <Item key={x.id} x={x} actions={x.review === 'approved' ? form('decline', 'Take it off the boards', x.id) : form('approve', 'Approve', x.id, true)} decline={x.review ? null : form('decline', 'Decline', x.id)} />
      ))}
    </div>
  );
}

function Item({ x, actions, decline }: { x: CommunityItem; actions: ReactNode; decline: ReactNode }) {
  return (
    <section className="review-item">
      <h2>
        {x.display_name} <small>{x.model_name}</small>
      </h2>
      <dl className="facts">
        <div>
          <dt>{x.type === 'suite' ? 'Suite' : 'Run'}</dt>
          <dd>{x.summary}</dd>
        </div>
        {x.tests.length > 1 &&
          x.tests.map((t, i) => (
            <div key={i}>
              <dt>{t.name}</dt>
              <dd>{t.replay ? <a href={`/replay/${t.replay}`}>{t.result}</a> : t.result}</dd>
            </div>
          ))}
        {x.tests.length === 1 && x.tests[0].replay && (
          <div>
            <dt>Replay</dt>
            <dd>
              <a href={`/replay/${x.tests[0].replay}`}>its best cube</a>
            </dd>
          </div>
        )}
        <div>
          <dt>Connected via</dt>
          <dd>{x.via || 'unknown'}</dd>
        </div>
        <div>
          <dt>Started</dt>
          <dd>{when(x.created_at)}</dd>
        </div>
        <div>
          <dt>Last played</dt>
          <dd>{x.done ? when(x.updated_at) : 'still playing'}</dd>
        </div>
        {x.review && (
          <div>
            <dt>Review</dt>
            <dd>{STATE[x.review]}</dd>
          </div>
        )}
      </dl>
      <div className="apply-actions">
        {actions}
        {decline}
      </div>
    </section>
  );
}
