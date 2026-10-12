import Link from 'next/link';
import type { Waiting } from '@/lib/arena/ranking';

/** The models a ranking leaves out until they're run at their top effort (ranking.ts fullEffort). */
export default function WaitingNote({ waiting }: { waiting: Waiting[] }) {
  if (waiting.length === 0) return null;
  return (
    <p className="ix-waiting">
      Not ranked until run at their top effort:{' '}
      {waiting.map((w, i) => (
        <span key={w.model}>
          {i > 0 && ', '}
          <Link href={`/models/${w.slug}`}>{w.model}</Link> ({w.top}
          {w.tested.length > 0 && `; ${w.tested.join(', ')} so far`})
        </span>
      ))}
      .
    </p>
  );
}
