// Renders one of our writeups (lib/arena/writeups.ts): "# " title, "## " headings, paragraphs, `moves`, live
// placeholders filled with today's values, and in blogs the chart, cube and replay lines the writer placed.
import Link from 'next/link';
import type { ReactNode } from 'react';
import { BarChart } from '@/components/charts';
import ReplayPlayer from '@/components/ReplayPlayer';
import { averageByLabel } from '@/lib/arena/aggregate';
import { replay } from '@/lib/arena/board';
import { type SuiteEntry, suiteEntries } from '@/lib/arena/index-data';
import { withDb } from '@/lib/arena/db';
import { effortRank } from '@/lib/arena/makers';
import { SUITES, testName } from '@/lib/arena/suites';

type Live = Map<string, string>;

function inline(text: string, live: Live): ReactNode[] {
  return text.split(/(\{\{[^}]*\}\}|`[^`]+`)/g).map((part, i) => {
    if (part.startsWith('{{'))
      return (
        <span key={i} className="live-num">
          {live.get(part) ?? '–'}
        </span>
      );
    if (part.startsWith('`') && part.endsWith('`') && part.length > 1) return <code key={i}>{part.slice(1, -1)}</code>;
    return part;
  });
}

const fmtMin = (secs: number) => (secs < 90 ? `${Math.round(secs)}s` : secs < 5400 ? `${Math.round(secs / 60)}m` : `${(secs / 3600).toFixed(1)}h`);

async function ScoreByEffort({ slug, entries }: { slug: string; entries: SuiteEntry[] }) {
  const mine = entries.filter(
    (e) => e.slug === slug && e.kind === 'fast' && e.version === SUITES.fast.version && e.status === 'finished' && e.board === 'verified',
  );
  const rows = averageByLabel(mine).sort((a, b) => effortRank(a.effort) - effortRank(b.effort));
  if (!rows.length) return null;
  return (
    <figure className="wu-fig">
      <BarChart
        height={160}
        items={rows.map((e) => ({
          key: e.id,
          label: e.effort ?? e.model,
          value: e.score,
          color: e.color,
          href: e.n > 1 ? `/models/${slug}#fast` : `/suites/${e.id}`,
        }))}
      />
      <figcaption>
        {rows[0].model}, Fast {SUITES.fast.version} score at each effort.
      </figcaption>
    </figure>
  );
}

async function TimeByLevel({ suiteId, test, entries }: { suiteId: string; test: string; entries: SuiteEntry[] }) {
  const e = entries.find((x) => x.id === suiteId);
  const slots = SUITES[e?.kind ?? 'fast'].slots
    .map((s, i) => ({ s, i }))
    .filter((x) => x.s.test === test)
    .map((x) => x.i);
  const run = e?.runs.find((r) => slots.includes(r.slot));
  if (!e || !run) return null;
  const rows = await withDb(
    (sql) => sql<
      {
        id: string;
        level: number | null;
        seq: number;
        status: string;
        secs: number;
      }[]
    >`
    select id, level, seq, status, (extract(epoch from (finished_at - created_at)) - paused_secs)::int as secs
    from cube_arena.attempts where run_id = ${run.run_id} and finished_at is not null order by seq`,
  );
  if (!rows.length) return null;
  return (
    <figure className="wu-fig">
      <BarChart
        height={160}
        format={fmtMin}
        items={rows.map((a) => ({
          key: a.id,
          label: a.level === null ? `#${a.seq}` : `L${a.level}`,
          sub: a.status === 'solved' ? null : 'miss',
          value: a.secs,
          color: a.status === 'solved' ? e.color : 'var(--slate)',
          href: `/replay/${a.id}`,
          hatch: a.status !== 'solved',
        }))}
      />
      <figcaption>
        Time on each cube: {e.label}, {testName(SUITES[e.kind].slots[slots[0]]).name}. Hatched bars are misses.
      </figcaption>
    </figure>
  );
}

async function CubeShot({ id }: { id: string }) {
  const r = await replay(id);
  if (!r) return null;
  const { attempt: a } = r;
  return (
    <figure className="wu-fig">
      <Link href={`/replay/${a.id}`} prefetch={false}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/image/${a.id}?m=0`}
          alt={`The ${a.size}×${a.size} cube${a.level ? ` at level ${a.level}` : ''}, as the model got it`}
          width={1400}
          height={800}
          loading="lazy"
        />
      </Link>
      <figcaption>
        {a.level ? `Level ${a.level}` : 'The cube'}, as the model got it. <Link href={`/replay/${a.id}`}>Replay</Link>
      </figcaption>
    </figure>
  );
}

async function ReplayEmbed({ id }: { id: string }) {
  const r = await replay(id);
  if (!r || r.attempt.status === 'active') return null;
  const { attempt: a } = r;
  return (
    <figure className="wu-fig wu-replay">
      <ReplayPlayer compact attemptId={a.id} n={a.size} initial={a.initial_state} moves={a.moves} solved={a.status === 'solved'} checkpoints={[]} />
      <figcaption>
        {a.level ? `Level ${a.level}` : 'The cube'}, {a.move_count} moves, {a.status === 'solved' ? 'solved' : 'not solved'}.{' '}
        <Link href={`/replay/${a.id}`}>Full replay</Link>
      </figcaption>
    </figure>
  );
}

export default async function Writeup({
  body,
  live,
  slug,
  titleAs = 'h2',
  className = '',
}: {
  body: string;
  live: Live;
  slug?: string;
  titleAs?: 'h2' | 'h3';
  className?: string;
}) {
  const entries = /<\?chart /.test(body) ? await suiteEntries() : [];
  const blocks: ReactNode[] = [];
  const paras = body.trim().split(/\n\s*\n/);
  for (const [i, para] of paras.entries()) {
    for (const [j, line] of para.split('\n').entries()) {
      const t = line.trim();
      const key = `${i}-${j}`;
      const d = t.match(/^<\?(chart score-by-effort|chart time-by-level ([0-9a-f-]{36}) (\S+)|cube ([0-9a-f-]{36})|replay ([0-9a-f-]{36}))\?>$/);
      if (d) {
        if (d[1] === 'chart score-by-effort' && slug) blocks.push(<ScoreByEffort key={key} slug={slug} entries={entries} />);
        else if (d[2]) blocks.push(<TimeByLevel key={key} suiteId={d[2]} test={d[3]} entries={entries} />);
        else if (d[4]) blocks.push(<CubeShot key={key} id={d[4]} />);
        else if (d[5]) blocks.push(<ReplayEmbed key={key} id={d[5]} />);
      }
    }
    const text = para
      .split('\n')
      .filter((l) => !/^<\?/.test(l.trim()))
      .join(' ')
      .trim();
    if (!text) continue;
    const Title = titleAs;
    const Sub = titleAs === 'h2' ? 'h3' : 'h4';
    if (text.startsWith('# '))
      blocks.push(
        <Title key={i} className="wu-title">
          {inline(text.slice(2), live)}
        </Title>,
      );
    else if (text.startsWith('## ')) blocks.push(<Sub key={i}>{inline(text.slice(3), live)}</Sub>);
    else
      blocks.push(
        <p key={i} className={i === 1 && paras[0].startsWith('# ') ? 'wu-standfirst' : undefined}>
          {inline(text, live)}
        </p>,
      );
  }
  return <div className={`writeup ${className}`.trim()}>{blocks}</div>;
}
