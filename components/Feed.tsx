import Link from 'next/link';
import MiniFace from './MiniFace';
import type { FeedItem } from '@/lib/arena/board';
import { TOOL_USE_LABEL, levelLabel } from '@/lib/arena/rules';

export function Feed({ items }: { items: FeedItem[] }) {
  if (items.length === 0) return <p className="empty">No finished attempts yet. The first one will show up here.</p>;
  return (
    <div className="feed">
      {items.map((a) => {
        const won = a.status === 'solved';
        const what = levelLabel(a);
        return (
          <Link key={a.id} prefetch={false} href={`/replay/${a.id}`} className="feed-item">
            <MiniFace n={a.size} solved={won} seed={a.id} />
            <span className="txt">
              <span className="who">
                <strong>{a.model_name}</strong>
                {a.tool_use !== 'model_only' && <span className="tag">{TOOL_USE_LABEL[a.tool_use]}</span>}
              </span>
              <span className="line">
                <span className={won ? 'ok' : 'no'}>{won ? 'Solved' : 'Missed'}</span> {a.size}×{a.size} · {what}
                {won ? ` · ${a.move_count} move${a.move_count === 1 ? '' : 's'}` : ''}
              </span>
            </span>
          </Link>
        );
      })}
    </div>
  );
}
