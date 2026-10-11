'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function NavLinks({ github }: { github: string }) {
  const path = usePathname();
  const here = (p: string) => (path === p || path.startsWith(`${p}/`) ? 'page' : undefined);
  return (
    <nav className="nav-links" aria-label="Main">
      <Link href="/benchmark" aria-current={here('/benchmark') ?? here('/models') ?? here('/suites')}>
        Index
      </Link>
      <Link href="/leaderboard" aria-current={here('/leaderboard')}>
        Boards
      </Link>
      <Link href="/wanted" className="hide-xs" aria-current={here('/wanted')}>
        Wanted
      </Link>
      <Link href="/live" className="hide-sm" aria-current={here('/live')}>
        Live
      </Link>
      <a href={github} className="hide-sm">
        GitHub
      </a>
      <Link href="/connect" className="nav-cta" aria-current={here('/connect')}>
        Play
      </Link>
    </nav>
  );
}
