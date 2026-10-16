// The homepage's Index card: the top models on Fast, ranked exactly as the
// Index ranks them (aggregate.ts), as plain bars that render on the server.

import Link from 'next/link';
import { bestPerModel, indexPool, provisional } from '@/lib/arena/aggregate';
import { fmtScore } from '@/lib/arena/format';
import type { SuiteEntry } from '@/lib/arena/index-data';
import { makerOf } from '@/lib/arena/makers';
import { GAUNTLET_TAG } from '@/lib/arena/rules';
import { SUITES } from '@/lib/arena/suites';

export default function IndexTop({ entries, top = 8 }: { entries: SuiteEntry[]; top?: number }) {
  const suite = SUITES.fast;
  const ranked = bestPerModel(indexPool(entries, 'fast', suite.version).ranked);
  const rows = ranked.slice(0, top);
  const makers = [...new Map(rows.map((e) => [makerOf(e.model).name, makerOf(e.model)])).values()];

  return (
    <section className="card ix-top" aria-labelledby="ix-top-title">
      <header className="ix-top-head">
        <h2 id="ix-top-title">Cube Arena Index</h2>
        <p>
          {suite.name} {suite.version} · {ranked.length > top ? `top ${top} of ${ranked.length} models` : `${ranked.length} models`} · out of 100
        </p>
      </header>
      {rows.length === 0 ? (
        <p className="ix-top-empty">The first results are on their way.</p>
      ) : (
        <ol className="ix-top-list">
          {rows.map((e, i) => {
            const tag = provisional(e) ? GAUNTLET_TAG[e.gauntlet as 'pending' | 'playing'] : null;
            const score = fmtScore(e.score);
            return (
              <li key={e.id}>
                <Link
                  href={`/models/${e.slug}`}
                  className="ix-top-row"
                  aria-label={`${i + 1}. ${e.model}${e.effort ? ` at ${e.effort} effort` : ''}: ${score}${tag ? `, ${tag}` : ''}`}
                >
                  <span className="ix-top-rank">{i + 1}</span>
                  <span className="ix-top-name">
                    <b>{e.model}</b>
                    {e.effort && <small>{e.effort}</small>}
                    {tag && <em>{tag}</em>}
                  </span>
                  <span className="ix-top-score">{score}</span>
                  <span className="ix-top-bar" aria-hidden>
                    <i style={{ width: `${Math.max(1.5, Math.min(100, e.score ?? 0))}%`, background: e.color }} />
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
      <footer className="ix-top-foot">
        <ul className="ix-top-makers" aria-label="Bar colour is the model's maker">
          {makers.map((m) => (
            <li key={m.name}>
              <i style={{ background: m.color }} aria-hidden />
              {m.name}
            </li>
          ))}
        </ul>
        <Link href="/benchmark" className="ix-top-more">
          Full Index →
        </Link>
      </footer>
    </section>
  );
}
