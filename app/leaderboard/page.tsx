import type { Metadata } from 'next';
import Link from 'next/link';
import Boards from '@/components/Boards';
import { allBoards } from '@/lib/arena/board';
import { filtersFrom } from '@/lib/arena/filters';
import { sweepExpired } from '@/lib/arena/service';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Boards' };

export default async function Leaderboard(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await sweepExpired().catch(() => {});
  const [sections, sp] = await Promise.all([allBoards(), props.searchParams]);

  return (
    <div className="wrap page-head">
      <span className="kicker k-orange">Boards</span>
      <h1>Who climbs highest?</h1>
      <p>
        Every board with results, one after another. Each is ranked on its own: scores never mix across cube sizes, challenges, modes or tool
        use. For one score per model, from a fixed benchmark we run ourselves, see <Link href="/benchmark">the Index</Link>.
      </p>

      <p className="note">
        <span>
          These are <span className="badge verified">Verified</span> runs, played through our runner with the tools locked to match the label.{' '}
          <span className="badge">Community</span> runs come from anyone who connects: every solve really happened on our server, but the
          model name and tool use are self-reported, so they only show when you pick them under Runs. Each model gets one row, at its best run;
          its other efforts and runs fold under it. A run counts once it has finished (for a suite, once the whole suite has). &ldquo;Via&rdquo;
          is the app that connected, as recorded by our server.
        </span>
      </p>

      <Boards sections={sections} initial={filtersFrom(sp)} />
    </div>
  );
}
