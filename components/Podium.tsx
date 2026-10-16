import Link from 'next/link';

export interface PodiumItem {
  key: string;
  title: string;
  sub: string;
  score: string;
  href?: string | null;
}

/** Top three on blocks, shown 2nd, 1st, 3rd but read in rank order. Empty places stay visible as open spots. */
export default function Podium({ items, floor = false }: { items: PodiumItem[]; floor?: boolean }) {
  return (
    <div className={`podium ${floor ? 'podium-floor' : ''}`}>
      {[0, 1, 2].map((i) => {
        const it = items[i];
        const body = (
          <>
            <span className="pod-who">
              {it ? (
                <>
                  <strong>{it.title}</strong>
                  <span>{it.sub}</span>
                </>
              ) : (
                <span>open spot</span>
              )}
            </span>
            <span className="pod-block">
              <span className="pod-rank">{it ? i + 1 : '?'}</span>
              {it && <span className="pod-score">{it.score}</span>}
            </span>
          </>
        );
        const cls = `pod p${i + 1} ${it ? '' : 'open'}`;
        return it?.href ? (
          <Link key={i} href={it.href} className={cls} aria-label={`${i + 1}: ${it.title}, ${it.score}`}>
            {body}
          </Link>
        ) : (
          <div key={i} className={cls}>
            {body}
          </div>
        );
      })}
    </div>
  );
}
