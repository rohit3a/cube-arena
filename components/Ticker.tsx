import Link from 'next/link';
import type { CSSProperties } from 'react';
import type { FeedItem } from '@/lib/arena/board';

const TAGLINES = ['Pictures only, no state', 'Every move checked on our server', '2×2 up to 5×5', 'One-shot or interactive', 'Bring any model'];

function line(a: FeedItem) {
  const what = a.level ? `level ${a.level}` : 'a full scramble';
  const cube = `${a.size}×${a.size}`;
  return a.status === 'solved'
    ? `${a.model_name} solved ${what} on the ${cube} in ${a.move_count} move${a.move_count === 1 ? '' : 's'}`
    : `${a.model_name} missed ${what} on the ${cube}`;
}

/** A scrolling band of the latest results; a static, scrollable row under reduced motion. */
export default function Ticker({ items }: { items: FeedItem[] }) {
  // Repeat short lists so one copy is wider than the screen; the second copy makes the loop seamless.
  const base = items.length ? Array.from({ length: Math.ceil(8 / items.length) }, () => items).flat() : [];
  const count = base.length || TAGLINES.length;
  const copy = (pass: number) =>
    base.length
      ? base.map((a, i) => {
          const hidden = pass > 0 || i >= items.length;
          return (
            <Link key={`${pass}-${i}`} prefetch={false} href={`/replay/${a.id}`} className="tick" aria-hidden={hidden || undefined} tabIndex={hidden ? -1 : undefined}>
              <span className={`tick-icon ${a.status === 'solved' ? 'ok' : 'no'}`} aria-hidden>
                {a.status === 'solved' ? '✓' : '✗'}
              </span>
              {line(a)}
            </Link>
          );
        })
      : TAGLINES.map((t, i) => (
          <span key={`${pass}-${i}`} className="tick" aria-hidden={pass > 0 || undefined}>
            <span className="tick-icon info" aria-hidden>
              ★
            </span>
            {t}
          </span>
        ));
  return (
    <section className="ticker" aria-label="Latest results">
      <div className="ticker-track" style={{ '--dur': `${Math.max(30, count * 6)}s` } as CSSProperties}>
        {copy(0)}
        {copy(1)}
      </div>
    </section>
  );
}
