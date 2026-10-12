// Leaderboard filters, kept in the URL (?size=3&tools=model_only). The page
// opens on Verified runs across every board that has them; Community runs
// (self-reported) are one filter away (?board=community or ?board=all).

import type { BoardSection } from './board';
import { splitLabel } from './makers';
import { type Board, type Challenge, type Mode, SIZES, type Size, type ToolUse } from './rules';

export interface Filters {
  board: Board | 'all';
  size: Size | 'all';
  challenge: Challenge | 'all';
  mode: Mode | 'all';
  tools: ToolUse | 'all';
}

/** What the page shows with nothing in the URL. */
export const DEFAULT: Filters = { board: 'verified', size: 'all', challenge: 'all', mode: 'all', tools: 'all' };

const pick = <T extends string>(v: unknown, allowed: readonly T[]): T | 'all' => (allowed.includes(v as T) ? (v as T) : 'all');

export function filtersFrom(sp: Record<string, string | string[] | undefined>): Filters {
  const size = Number(sp.size);
  return {
    board: sp.board === 'community' || sp.board === 'all' ? sp.board : 'verified',
    size: SIZES.includes(size as Size) ? (size as Size) : 'all',
    challenge: pick<Challenge>(sp.challenge, ['ladder', 'scramble']),
    mode: pick<Mode>(sp.mode, ['interactive', 'one_shot']),
    tools: pick<ToolUse>(sp.tools, ['model_only', 'code', 'solver']),
  };
}

export function filtersQuery(f: Filters): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v !== DEFAULT[k as keyof Filters]) q.set(k, String(v));
  return q.toString();
}

const rows = (s: BoardSection) => (s.challenge === 'ladder' ? s.ladder.length : s.scramble.length);

/** The boards that match, in page order. The board filter drops rows, so ranks restart within it. */
export function applyFilters(sections: BoardSection[], f: Filters): BoardSection[] {
  return sections
    .filter(
      (s) =>
        (f.size === 'all' || s.size === f.size) &&
        (f.challenge === 'all' || s.challenge === f.challenge) &&
        (f.mode === 'all' || s.mode === f.mode) &&
        (f.tools === 'all' || s.toolUse === f.tools),
    )
    .map((s) =>
      f.board === 'all' ? s : { ...s, ladder: s.ladder.filter((r) => r.board === f.board), scramble: s.scramble.filter((r) => r.board === f.board) },
    )
    .filter((s) => rows(s) > 0);
}

/** A model's rows on one board: the one it ranks by, then its other efforts and runs. */
export interface ModelGroup<T> {
  lead: T;
  more: T[];
}

/**
 * One entry per model, efforts and players together, in rank order. Rows
 * arrive ranked, so a model's first row is its best; the rest fold under it.
 */
export function byModel<T extends { model_name: string }>(rows: T[]): ModelGroup<T>[] {
  const groups = new Map<string, ModelGroup<T>>();
  for (const r of rows) {
    const key = splitLabel(r.model_name).model.toLowerCase().replace(/\s+/g, ' ').trim();
    const g = groups.get(key);
    if (g) g.more.push(r);
    else groups.set(key, { lead: r, more: [] });
  }
  return [...groups.values()];
}
