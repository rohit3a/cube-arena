import type { Metadata } from 'next';
import { applicationFor } from '@/lib/arena/applications';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Application', robots: { index: false } };

type Props = { searchParams: Promise<{ id?: string; t?: string; failed?: string }> };

/** Where the operator's email links: the application, and buttons to approve or decline it. */
export default async function Decide({ searchParams }: Props) {
  const { id = '', t = '', failed } = await searchParams;
  const app = await applicationFor(id, t);
  if (!app) {
    return (
      <div className="wrap page-head">
        <h1>That link doesn&apos;t work</h1>
        <p>It may be cut short. Open it from the email again.</p>
      </div>
    );
  }
  return (
    <div className="wrap page-head apply">
      <span className="kicker">Application</span>
      <h1>{app.name}</h1>
      <dl className="facts">
        <div>
          <dt>X</dt>
          <dd>
            <a href={`https://x.com/${app.x_handle}`}>@{app.x_handle}</a>
          </dd>
        </div>
        <div>
          <dt>Email</dt>
          <dd>{app.email}</dd>
        </div>
        <div>
          <dt>Applied</dt>
          <dd>{new Date(app.created_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })} UTC</dd>
        </div>
        {app.note && (
          <div>
            <dt>Note</dt>
            <dd>{app.note}</dd>
          </div>
        )}
      </dl>
      {failed && <p className="apply-error">That didn&apos;t go through: the email to them failed, so nothing changed. Try again in a moment.</p>}
      {app.status === 'pending' ? (
        <form method="post" action="/api/apply/decide" className="apply-actions">
          <input type="hidden" name="id" value={app.id} />
          <input type="hidden" name="t" value={t} />
          <button type="submit" name="action" value="approve" className="btn btn-primary">
            Approve and email the code
          </button>
          <button type="submit" name="action" value="decline" className="btn">
            Decline
          </button>
        </form>
      ) : (
        <p className="apply-status">
          {app.status === 'approved'
            ? `Approved ${app.decided_at ? new Date(app.decided_at).toLocaleDateString('en-GB', { timeZone: 'UTC' }) : ''}: the invite code went to ${app.email}.`
            : 'Declined. Nothing was sent to them.'}
        </p>
      )}
    </div>
  );
}
