import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import Writeup from '@/components/Writeup';
import { catalogModel } from '@/lib/arena/catalog';
import { blogHead, liveValues, writeupHistory } from '@/lib/arena/writeups';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ v?: string }> };

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { slug } = await props.params;
  return { title: `Notes: ${catalogModel(slug)?.name ?? slug}` };
}

const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** Every version of a model's notes: the blog is rewritten as results come in, and the old ones stay readable. */
export default async function ModelNotes(props: Props) {
  const { slug } = await props.params;
  const { v } = await props.searchParams;
  const versions = await writeupHistory('blog', slug);
  if (!versions.length) notFound();
  const shown = versions.find((x) => String(x.version) === v) ?? versions[0];
  const live = await liveValues();
  const name = catalogModel(slug)?.name ?? slug;
  return (
    <div className="wrap page-head">
      <span className="kicker k-green">
        <Link href="/notes">Notes</Link> · {name}
      </span>
      <nav className="notes-versions" aria-label="Versions">
        {versions.map((x) => (
          <Link key={x.version} href={x === versions[0] ? `/notes/${slug}` : `/notes/${slug}?v=${x.version}`} aria-current={x === shown ? 'page' : undefined} className="chip">
            {day(x.created_at)}
            {x === versions[0] ? ' · latest' : ''}
          </Link>
        ))}
      </nav>
      <article className="card wu-card">
        {shown !== versions[0] && (
          <p className="faint">
            An earlier version, from {day(shown.created_at)}: &ldquo;{blogHead(versions[0].body).title}&rdquo; replaced it. Scores and ranks show today&apos;s values.
          </p>
        )}
        <Writeup body={shown.body} live={live} slug={slug} />
      </article>
      <p className="board-foot">
        <Link href={`/models/${slug}`}>{name}: every result</Link> · <Link href="/notes">All notes</Link>
      </p>
    </div>
  );
}
