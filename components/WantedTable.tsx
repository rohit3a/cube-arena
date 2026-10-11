'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import CopyButton from '@/components/CopyButton';
import { fmtScore } from '@/lib/arena/format';

export interface WantedItem {
  key: string;
  model_id: string;
  name: string;
  maker: string;
  effort: string | null;
  runs: number;
  mean: number | null;
  via: string[];
  claim: { by: string | null; expires_at: string } | null;
  command: string;
}

type Show = 'needed' | 'all';

export default function WantedTable({ items, empty }: { items: WantedItem[]; empty: string }) {
  const [show, setShow] = useState<Show>('needed');
  const [maker, setMaker] = useState('all');
  const makers = useMemo(() => [...new Set(items.map((i) => i.maker))].sort(), [items]);
  const rows = items.filter((i) => (show === 'all' || (i.runs === 0 && !i.claim)) && (maker === 'all' || i.maker === maker));

  return (
    <>
      <div className="filterbar ix-controls" role="group" aria-label="Filter the list">
        <div className="seg" role="tablist" aria-label="Show">
          {(
            [
              ['needed', 'Still needed'],
              ['all', 'Everything'],
            ] as const
          ).map(([k, name]) => (
            <button key={k} type="button" role="tab" aria-selected={show === k} onClick={() => setShow(k)}>
              {name}
            </button>
          ))}
        </div>
        <label className={`toggle ${maker === 'all' ? '' : 'on'}`}>
          <span className="toggle-key">Maker</span>
          <span className="toggle-value">{maker === 'all' ? 'All' : maker}</span>
          <select aria-label="Maker" value={maker} onChange={(e) => setMaker(e.target.value)}>
            <option value="all">All</option>
            {makers.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
      </div>
      {rows.length === 0 ? (
        <div className="chart-empty">{empty}</div>
      ) : (
        <div className="table-wrap flat">
          <table className="wanted">
            <thead>
              <tr>
                <th>Model</th>
                <th>Effort</th>
                <th>Status</th>
                <th className="w-via">Reach it via</th>
                <th>Run it</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((i) => (
                <tr key={i.key}>
                  <td className="w-model">
                    <Link href={`/models/${i.model_id}`} className="model-link">
                      {i.name}
                    </Link>
                    <span className="muted"> · {i.maker}</span>
                  </td>
                  <td className="w-effort">{i.effort ?? <span className="faint">–</span>}</td>
                  <td className="w-status">
                    {i.runs > 0 ? (
                      <span className="status done">
                        {i.runs} run{i.runs > 1 ? 's' : ''} · {fmtScore(i.mean)}
                      </span>
                    ) : i.claim ? (
                      <span className="status claimed" suppressHydrationWarning>
                        Claimed{i.claim.by ? ` by ${i.claim.by}` : ''} until{' '}
                        {new Date(i.claim.expires_at).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}
                      </span>
                    ) : (
                      <span className="status needed">Needed</span>
                    )}
                    {i.runs > 0 && i.claim && <span className="status claimed"> · running again</span>}
                  </td>
                  <td className="muted w-via">{i.via.join(', ')}</td>
                  <td className="cmd">
                    <span title={i.command}>
                      <CopyButton text={i.command} label="Copy" />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
