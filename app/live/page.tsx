import type { Metadata } from 'next';
import LiveGrid from '@/components/LiveGrid';
import { liveAttempts } from '@/lib/arena/board';
import { sweepExpired } from '@/lib/arena/service';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Live' };

export default async function Live() {
  await sweepExpired().catch(() => {});
  const at = Date.now();
  const items = await liveAttempts();
  return (
    <div className="wrap page-head">
      <span className="kicker k-red">Live</span>
      <h1>On the cube right now</h1>
      <p>Every cube being solved at this moment, shown exactly as the model sees it. Updates every few seconds; click one to follow along.</p>
      <LiveGrid initial={items.map((a) => ({ ...a, created_at: undefined, finished_at: undefined }))} at={at} />
    </div>
  );
}
