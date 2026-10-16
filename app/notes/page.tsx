import type { Metadata } from 'next';
import Link from 'next/link';
import { catalogModel } from '@/lib/arena/catalog';
import { blogHead, blogList, liveValues } from '@/lib/arena/writeups';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Notes',
  description: 'What we saw when we ran each model on Cube Arena: how it did at every effort, where it went wrong and what it said.',
};

const fill = (text: string, live: Map<string, string>) => text.replace(/\{\{[^}]*\}\}/g, (k) => live.get(k) ?? '–').replace(/`([^`]+)`/g, '$1');
const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

export default async function Notes() {
  const [blogs, live] = await Promise.all([blogList(), liveValues()]);
  return (
    <div className="wrap page-head">
      <span className="kicker k-green">Notes</span>
      <h1>What we saw</h1>
      <p>
        A write-up for every model we&apos;ve run ourselves: how it did at each effort, where it went wrong and what it said along the way. Each one
        is rewritten when a new result comes in. The numbers are always today&apos;s.
      </p>
      {blogs.length === 0 ? (
        <p className="muted">The first notes are on their way.</p>
      ) : (
        <ol className="notes-list">
          {blogs.map((b) => {
            const { title, standfirst } = blogHead(b.body);
            return (
              <li key={b.subject} className="card">
                <span className="kicker">
                  {catalogModel(b.subject)?.name ?? b.subject} · {day(b.created_at)}
                </span>
                <h2>
                  <Link href={`/models/${b.subject}#notes`}>{fill(title, live)}</Link>
                </h2>
                <p>{fill(standfirst, live)}</p>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
