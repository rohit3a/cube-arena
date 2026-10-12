// How the Index ranks suite results (rules.ts and suites.ts tell the players).
// No server imports: the Index explorer sorts in the browser too.

import { effortRank } from './makers';

/** What the Index ranks suites by. */
export interface Ranked {
  score: number | null;
  moves: number;
  cost_usd: number | null;
  secs: number;
}

/** Ascending, with "no value" last. */
const fewer = (a: number | null, b: number | null) => (a ?? Infinity) - (b ?? Infinity) || 0;

/** Scores compared to a millionth of a point, so averages of equal results tie. */
const points = (score: number | null) => Math.round((score ?? -1) * 1e6);

/** The Index order: score (how far up, what got solved), then the fewest moves, then the lowest cost (unknown last), then the least time. */
export const suiteOrder = (a: Ranked, b: Ranked) =>
  points(b.score) - points(a.score) || a.moves - b.moves || fewer(a.cost_usd, b.cost_usd) || a.secs - b.secs;

/** A model kept off a ranking until it has a result at its top effort. */
export interface Waiting {
  model: string;
  slug: string;
  top: string;
  /** The efforts it has results at, low to high. */
  tested: string[];
}

/**
 * A ranking takes a model only once it has a result at its top effort, so no
 * model is ranked on a weaker setting than it has; a lower effort may still
 * turn out its best. top_effort is null for a model with no effort setting,
 * or one not in the catalog: those always count.
 */
export function fullEffort<T extends { model: string; slug: string; effort: string | null; top_effort: string | null }>(entries: T[]): { ranked: T[]; waiting: Waiting[] } {
  const byModel = new Map<string, T[]>();
  for (const e of entries) byModel.set(e.model, [...(byModel.get(e.model) ?? []), e]);
  const waiting: Waiting[] = [];
  for (const [model, es] of byModel) {
    const top = es.find((e) => e.top_effort)?.top_effort ?? null;
    if (!top || es.some((e) => e.effort === top)) continue;
    const tested = [...new Set(es.map((e) => e.effort).filter((x): x is string => x !== null))];
    tested.sort((a, b) => effortRank(a) - effortRank(b));
    waiting.push({ model, slug: es[0].slug, top, tested });
  }
  const out = new Set(waiting.map((w) => w.model));
  return { ranked: entries.filter((e) => !out.has(e.model)), waiting: waiting.sort((a, b) => a.model.localeCompare(b.model)) };
}
