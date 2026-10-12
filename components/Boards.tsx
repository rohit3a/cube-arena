'use client';

import Link from 'next/link';
import { useState } from 'react';
import Podium, { type PodiumItem } from '@/components/Podium';
import { LadderTable, ScrambleTable } from '@/components/Tables';
import type { BoardSection } from '@/lib/arena/board';
import { DEFAULT, type Filters, applyFilters, byModel, filtersQuery } from '@/lib/arena/filters';
import { CHALLENGE_LABEL, LADDER_MAX_LEVEL, MAX_TURN_BATCH, MODE_LABEL, SIZES, TOOL_USE_HELP, type ToolUse } from '@/lib/arena/rules';

// Model-only first (the real test), then own code, then solver.
const GROUPS: { tool: ToolUse; title: string; blurb: string; kicker: string }[] = [
  { tool: 'model_only', title: 'Model only', blurb: `The real test. ${TOOL_USE_HELP.model_only}`, kicker: 'k-green' },
  { tool: 'code', title: 'With its own code', blurb: TOOL_USE_HELP.code, kicker: 'k-blue' },
  { tool: 'solver', title: 'With a solver', blurb: TOOL_USE_HELP.solver, kicker: 'k-orange' },
];

const TOGGLES: { key: keyof Filters; label: string; options: [string, string][]; all?: string }[] = [
  { key: 'board', label: 'Runs', options: [['verified', 'Verified'], ['community', 'Community']], all: 'Verified + Community' },
  { key: 'size', label: 'Cube', options: SIZES.map((s) => [String(s), `${s}×${s}`]) },
  { key: 'challenge', label: 'Challenge', options: [['ladder', 'Ladder'], ['scramble', 'Full scramble']] },
  { key: 'mode', label: 'Mode', options: [['interactive', 'Interactive'], ['one_shot', 'One-shot']] },
  { key: 'tools', label: 'Tools', options: [['model_only', 'Model only'], ['code', 'Code'], ['solver', 'Solver']] },
];

const title = (s: BoardSection) => `${s.size}×${s.size} ${CHALLENGE_LABEL[s.challenge]} · ${MODE_LABEL[s.mode]}`;

function rule(s: BoardSection) {
  const how = s.mode === 'one_shot' ? 'Every move submitted at once.' : `Up to ${MAX_TURN_BATCH} moves a turn, a new picture each time.`;
  return s.challenge === 'ladder'
    ? `Level N is a cube N moves from solved, up to ${LADDER_MAX_LEVEL[s.size]}; three lives a run. Highest level wins; ties go to fewer moves, then less time. ${how}`
    : `One fully mixed cube a run. Solve rate wins; ties go to fewer moves, then less time. ${how}`;
}

/** The top three models (each at its best run). */
function podium(s: BoardSection): PodiumItem[] {
  const rows =
    s.challenge === 'ladder'
      ? byModel(s.ladder).map(({ lead: r }) => ({ ...r, score: `level ${r.best}` }))
      : byModel(s.scramble).map(({ lead: r }) => ({ ...r, score: `${Math.round((100 * r.solved) / r.runs)}% solved` }));
  return rows.slice(0, 3).map((r) => ({
    key: `${r.board}|${r.model_name}|${r.display_name}`,
    title: r.model_name,
    sub: r.display_name,
    score: r.score,
    href: r.best_attempt ? `/replay/${r.best_attempt}` : null,
  }));
}

export default function Boards({ sections, initial }: { sections: BoardSection[]; initial: Filters }) {
  const [f, setF] = useState(initial);
  const visible = applyFilters(sections, f);
  const groups = GROUPS.map((g) => ({ ...g, sections: visible.filter((s) => s.toolUse === g.tool) })).filter((g) => g.sections.length > 0);
  const filtered = filtersQuery(f) !== '';

  const update = (next: Filters) => {
    setF(next);
    const q = filtersQuery(next);
    window.history.replaceState(null, '', q ? `?${q}` : window.location.pathname);
  };

  return (
    <>
      <div className="filterbar" role="group" aria-label="Filter the boards">
        {TOGGLES.map((t) => {
          const value = String(f[t.key]);
          return (
            <label key={t.key} className={`toggle ${value === String(DEFAULT[t.key]) ? '' : 'on'}`}>
              <span className="toggle-key">{t.label}</span>
              <span className="toggle-value">{t.options.find(([v]) => v === value)?.[1] ?? t.all ?? 'All'}</span>
              <select
                aria-label={t.label}
                value={value}
                onChange={(e) => {
                  const v = e.target.value;
                  update({ ...f, [t.key]: t.key === 'size' && v !== 'all' ? Number(v) : v });
                }}
              >
                <option value="all">{t.all ?? 'All'}</option>
                {t.options.map(([v, text]) => (
                  <option key={v} value={v}>
                    {text}
                  </option>
                ))}
              </select>
            </label>
          );
        })}
        <span className="filter-count" aria-live="polite">
          {visible.length} board{visible.length === 1 ? '' : 's'}
        </span>
        {filtered && (
          <button type="button" className="filter-reset" onClick={() => update(DEFAULT)}>
            Reset
          </button>
        )}
      </div>

      {sections.length === 0 ? (
        <div className="card empty">
          No results yet. <Link href="/connect">Connect your model</Link> and be the first on the board.
        </div>
      ) : visible.length === 0 ? (
        <div className="card empty">
          {f.board === 'verified' ? 'No Verified runs on this combination yet.' : 'Nobody has played this combination yet.'}{' '}
          {f.board === 'verified' && (
            <button type="button" className="filter-reset" onClick={() => update({ ...f, board: 'all' })}>
              Include Community runs
            </button>
          )}{' '}
          <button type="button" className="filter-reset" onClick={() => update(DEFAULT)}>
            Reset filters
          </button>
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.tool} className="board-group" id={g.tool.replace('_', '-')}>
            <header className="group-head">
              <span className={`kicker ${g.kicker}`}>{g.title}</span>
              <p>{g.blurb}</p>
            </header>
            {g.sections.map((s) => (
              <article key={s.id} className="board" id={s.id}>
                <header className="board-head">
                  <h2>
                    <a href={`#${s.id}`}>{title(s)}</a>
                  </h2>
                  <p>{rule(s)}</p>
                </header>
                {s === visible[0] && <Podium items={podium(s)} floor />}
                {s.challenge === 'ladder' ? <LadderTable rows={s.ladder} maxLevel={LADDER_MAX_LEVEL[s.size]} /> : <ScrambleTable rows={s.scramble} />}
              </article>
            ))}
          </section>
        ))
      )}

      {sections.length > 0 && (
        <p className="board-foot">
          Boards nobody has played yet are hidden: 2×2 to 5×5, ladder or full scramble, one-shot or interactive.{' '}
          <Link href="/connect">Connect your model</Link> to open one.
        </p>
      )}
    </>
  );
}
