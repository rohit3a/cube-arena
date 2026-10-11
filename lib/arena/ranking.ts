// How the Index ranks suite results (rules.ts and suites.ts tell the players).
// No server imports: the Index explorer sorts in the browser too.

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
