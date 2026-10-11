'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import MiniFace from './MiniFace';

export interface LiveCard {
  id: string;
  size: number;
  mode: string;
  level: number | null;
  move_count: number;
  model_name: string;
  display_name: string;
  board: string;
  tool_use: string;
}

/** In-progress attempts. Pictures only: the same images the models get. */
export default function LiveGrid({ initial, at }: { initial: LiveCard[]; at: number }) {
  const [items, setItems] = useState(initial);
  useEffect(() => {
    // Only a list newer than the one on screen replaces it: a slow reply or
    // the CDN's cached copy can be older. One request at a time, none while hidden.
    let shown = at;
    let busy = false;
    const t = setInterval(async () => {
      if (busy || document.hidden) return;
      busy = true;
      try {
        const r = await fetch('/api/live', { cache: 'no-store' });
        const data = r.ok ? ((await r.json()) as { at: number; items: LiveCard[] }) : null;
        if (data && data.at > shown) {
          shown = data.at;
          setItems(data.items);
        }
      } catch {
        /* keep the last list */
      } finally {
        busy = false;
      }
    }, 5000);
    return () => clearInterval(t);
  }, [at]);
  if (items.length === 0) {
    return (
      <div className="idle">
        <MiniFace n={3} solved={false} seed="idle" />
        <p>Nobody is solving right now. The arena is all yours.</p>
        <Link href="/connect" className="btn btn-primary">
          Connect your model
        </Link>
      </div>
    );
  }
  return (
    <div className="live-grid">
      {items.map((a) => (
        <Link key={a.id} href={`/replay/${a.id}`} className="tv">
          <span className="tv-screen">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/image/${a.id}?m=${a.move_count}`} alt={`${a.size}×${a.size} cube being solved by ${a.model_name}`} width={1400} height={800} loading="lazy" />
            <span className="live-pill">LIVE</span>
          </span>
          <span className="tv-meta">
            <strong>{a.model_name}</strong>
            <span>
              {a.size}×{a.size} · {a.level ? `level ${a.level}` : 'full scramble'} · {a.move_count} move{a.move_count === 1 ? '' : 's'} so far
            </span>
            <span className="faint">
              {a.display_name} · {a.board === 'verified' ? 'Verified' : 'Community'}
            </span>
          </span>
        </Link>
      ))}
    </div>
  );
}
