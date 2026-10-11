import Link from 'next/link';
import type { LadderRow, ScrambleRow } from '@/lib/arena/board';
import { fmtCost } from '@/lib/arena/format';
import type { Board } from '@/lib/arena/rules';

const Rank = ({ i }: { i: number }) => <span className={`medal ${i < 3 ? `m${i + 1}` : ''}`}>{i + 1}</span>;

/** Ten tiles, filled in cube colours as the level climbs. */
const TileBar = ({ value, max }: { value: number; max: number }) => {
  const on = Math.max(value > 0 ? 1 : 0, Math.round((10 * value) / max));
  return (
    <span className="tilebar" aria-hidden>
      {Array.from({ length: 10 }, (_, i) => (
        <i key={i} className={i < on ? 'on' : ''} />
      ))}
    </span>
  );
};

/** Which board a row came from, where Verified and Community share a table. */
const BoardBadge = ({ board }: { board?: Board }) =>
  board === 'verified' ? <span className="badge verified">Verified</span> : board === 'community' ? <span className="badge">Community</span> : null;

/** 42s, 3m 05s, 1h 02m. */
const duration = (secs: number | null) => {
  if (secs === null) return '–';
  const s = Math.round(secs);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`;
};

const ago = (d: Date) => {
  const s = Math.max(1, Math.round((Date.now() - new Date(d).getTime()) / 1000));
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};

export function LadderTable({ rows, maxLevel, compact = false }: { rows: LadderRow[]; maxLevel: number; compact?: boolean }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th className="rank">#</th>
            <th>Model</th>
            <th className="num">
              <span className="wide-only">Best </span>level
            </th>
            <th className="num" title="Moves the best run used to reach its best level, failed attempts included">
              Moves
            </th>
            <th className="num opt" title="What the best run cost, where the runner measured it">
              Cost
            </th>
            <th className="num opt" title="Time the best run took to reach its best level">
              Time
            </th>
            <th className="num opt opt-md">Runs</th>
            {!compact && <th className="opt opt-md">Last played</th>}
            {!compact && <th className="opt">Replay</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.board}|${r.model_name}|${r.display_name}`}>
              <td className="rank">
                <Rank i={i} />
              </td>
              <td className="model-cell">
                <strong>{r.model_name}</strong>
                <span>
                  {r.display_name} · via {r.via} <BoardBadge board={r.board} />
                </span>
                {r.best_attempt && (
                  <Link prefetch={false} href={`/replay/${r.best_attempt}`} className="cell-replay">
                    Best solve →
                  </Link>
                )}
              </td>
              <td className="num">
                <strong>{r.best}</strong>
                <span className="faint"> / {maxLevel}</span>
                <TileBar value={r.best} max={maxLevel} />
              </td>
              <td className="num">{r.moves ?? '–'}</td>
              <td className="num opt">{fmtCost(r.cost)}</td>
              <td className="num opt">{duration(r.secs)}</td>
              <td className="num opt opt-md">{r.runs}</td>
              {!compact && (
                <td className="faint opt opt-md" suppressHydrationWarning>
                  {ago(r.last)}
                </td>
              )}
              {!compact && <td className="opt">{r.best_attempt ? <Link prefetch={false} href={`/replay/${r.best_attempt}`}>best solve →</Link> : <span className="faint">–</span>}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ScrambleTable({ rows }: { rows: ScrambleRow[] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th className="rank">#</th>
            <th>Model</th>
            <th className="num opt opt-md">Solved</th>
            <th className="num">
              Solve<span className="wide-only"> rate</span>
            </th>
            <th className="num" title="Median moves">
              <span className="wide-only">Median </span>moves
            </th>
            <th className="num opt" title="Median cost of a solved cube's run, where the runner measured it">
              <span className="wide-only">Median </span>cost
            </th>
            <th className="num opt">Median time</th>
            <th className="opt opt-md">Last played</th>
            <th className="opt">Replay</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.board}|${r.model_name}|${r.display_name}`}>
              <td className="rank">
                <Rank i={i} />
              </td>
              <td className="model-cell">
                <strong>{r.model_name}</strong>
                <span>
                  {r.display_name} · via {r.via} <BoardBadge board={r.board} />
                </span>
                {r.best_attempt && (
                  <Link prefetch={false} href={`/replay/${r.best_attempt}`} className="cell-replay">
                    Best solve →
                  </Link>
                )}
              </td>
              <td className="num opt opt-md">
                {r.solved} / {r.runs}
              </td>
              <td className="num">
                <strong>{Math.round((100 * r.solved) / r.runs)}%</strong>
              </td>
              <td className="num">{r.median_moves === null ? '–' : Math.round(r.median_moves)}</td>
              <td className="num opt">{fmtCost(r.median_cost)}</td>
              <td className="num opt">{duration(r.median_secs)}</td>
              <td className="faint opt opt-md" suppressHydrationWarning>
                {ago(r.last)}
              </td>
              <td className="opt">{r.best_attempt ? <Link prefetch={false} href={`/replay/${r.best_attempt}`}>best solve →</Link> : <span className="faint">–</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
