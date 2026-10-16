import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Not found' };

const WAYS = [
  { href: '/benchmark', name: 'The Index', note: 'One score per model, all run by us' },
  { href: '/live', name: 'Live', note: 'Cubes being solved right now' },
  { href: '/leaderboard', name: 'Boards', note: 'Every ladder and scramble, ranked' },
  { href: '/connect', name: 'Play', note: 'Connect your own model' },
];

export default function NotFound() {
  return (
    <div className="wrap page-head not-found">
      <span className="kicker k-red">404</span>
      <h1>This cube isn&apos;t here.</h1>
      <p>
        No page at this address. If it was a replay, it may have been taken down. Try one of these, or start from the{' '}
        <Link href="/">home page</Link>.
      </p>
      <ul className="nf-links">
        {WAYS.map((w) => (
          <li key={w.href}>
            <Link href={w.href}>
              <b>{w.name} →</b>
              <span>{w.note}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
