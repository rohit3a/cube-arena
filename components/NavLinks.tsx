'use client';

// The header's links. Wide screens show them inline; phones get Play, the
// theme toggle and a menu button that opens a panel under the header.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import ThemeToggle from '@/components/ThemeToggle';

const LINKS = [
  { href: '/benchmark', label: 'Index', note: 'Scores, moves, time and cost for every model', also: ['/models', '/suites'] },
  { href: '/code', label: 'Coding', note: 'Models write their own 5×5 solver, graded on hidden cubes' },
  { href: '/leaderboard', label: 'Boards', note: 'Verified and community leaderboards' },
  { href: '/wanted', label: 'Wanted', note: 'Models and efforts that still need a run' },
  { href: '/contributors', label: 'Contributors', note: 'The people running models for the Index' },
  { href: '/live', label: 'Live', note: 'Games being played right now' },
  { href: '/connect', label: 'Play', note: 'Connect your model over MCP, and the rules' },
];

export default function NavLinks({ github }: { github: string }) {
  const path = usePathname();
  const at = (p: string) => path === p || path.startsWith(`${p}/`);
  const here = (l: (typeof LINKS)[number]) => ([l.href, ...(l.also ?? [])].some(at) ? 'page' : undefined);

  // Open for one path only: following a link closes the menu by itself.
  const [openAt, setOpenAt] = useState<string | null>(null);
  const open = openAt === path;
  const button = useRef<HTMLButtonElement>(null);
  const close = (refocus = false) => {
    setOpenAt(null);
    if (refocus) button.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpenAt(null);
      button.current?.focus();
    };
    const onWide = (e: MediaQueryListEvent) => e.matches && setOpenAt(null);
    const wide = window.matchMedia('(min-width: 761px)');
    document.addEventListener('keydown', onKey);
    wide.addEventListener('change', onWide);
    return () => {
      document.removeEventListener('keydown', onKey);
      wide.removeEventListener('change', onWide);
    };
  }, [open]);

  const play = LINKS[LINKS.length - 1];
  const rest = LINKS.slice(0, -1);
  return (
    <>
      <nav className="nav-links" aria-label="Main">
        {rest.map((l) => (
          <Link key={l.href} href={l.href} className="nav-link" aria-current={here(l)}>
            {l.label}
          </Link>
        ))}
        <Link href={play.href} className="nav-cta" aria-current={here(play)}>
          {play.label}
        </Link>
      </nav>
      <ThemeToggle />
      <button
        ref={button}
        type="button"
        className="menu-btn"
        aria-expanded={open}
        aria-controls="site-menu"
        aria-label={open ? 'Close menu' : 'Open menu'}
        onClick={() => setOpenAt(open ? null : path)}
      >
        <span aria-hidden />
        <span aria-hidden />
        <span aria-hidden />
      </button>
      <div className="menu-backdrop" hidden={!open} onClick={() => close()} />
      <nav id="site-menu" className="menu-panel" aria-label="Menu" hidden={!open}>
        <ul>
          {LINKS.map((l) => (
            <li key={l.href}>
              <Link href={l.href} aria-current={here(l)} onClick={() => close()}>
                <b>{l.label}</b>
                <span>{l.note}</span>
              </Link>
            </li>
          ))}
          <li>
            <a href={github} onClick={() => close()}>
              <b>GitHub</b>
              <span>The source, the runner and the MCP server</span>
            </a>
          </li>
        </ul>
      </nav>
    </>
  );
}
