// Several Verified suites of the same model and effort (run by different
// people, or again later) count as one result: their average, with how many
// there were. Safe to import from client components.

import type { CostParts, SuiteEntry } from './index-data';
import { type Waiting, fullEffort, suiteOrder } from './ranking';
import type { SuiteKind } from './suites';

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
/** Averaged suites show the Gauntlet as the least far along of those that unlocked it: a play still to come wins. */
const GAUNTLET_ORDER = ['playing', 'pending', 'done', 'locked'] as const;
const meanOrNull = (xs: (number | null)[]) => (xs.every((x) => x !== null) && xs.length ? mean(xs as number[]) : null);
/** Cost parts averaged part by part; null unless every suite has them. */
function meanParts(ps: (CostParts | null)[]): CostParts | null {
  if (!ps.length || ps.some((p) => p === null)) return null;
  const all = ps as CostParts[];
  return {
    input: mean(all.map((p) => p.input)),
    cached: mean(all.map((p) => p.cached)),
    reasoning: meanOrNull(all.map((p) => p.reasoning)),
    answer: mean(all.map((p) => p.answer)),
  };
}
/** Per-key means over the suites that have the key (a Gauntlet played by some of them only). */
function meanByKey(rs: Record<string, number>[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of new Set(rs.flatMap((r) => Object.keys(r)))) out[k] = mean(rs.filter((r) => k in r).map((r) => r[k]));
  return out;
}
/** A suite whose 4×4 Gauntlet is still to be played: its score isn't final yet. */
export const provisional = (e: SuiteEntry) => e.gauntlet === 'pending' || e.gauntlet === 'playing';

/**
 * One entry per label (model and effort): the mean of its finished suites. Entries newest first.
 * A suite still waiting on its Gauntlet joins the mean once it's played, unless every suite of
 * that label is waiting.
 */
export function averageByLabel(entries: SuiteEntry[]): SuiteEntry[] {
  const groups = new Map<string, SuiteEntry[]>();
  for (const e of entries) groups.set(e.label, [...(groups.get(e.label) ?? []), e]);
  return [...groups.values()].map((group) => {
    const es = group.some((e) => !provisional(e)) ? group.filter((e) => !provisional(e)) : group;
    if (es.length === 1) return es[0];
    const [latest] = es;
    const solved = es.reduce((a, e) => a + e.solved, 0);
    const moves = es.reduce((a, e) => a + e.moves, 0);
    const costs = es.map((e) => e.cost_usd).filter((c): c is number => c !== null);
    return {
      ...latest,
      score: mean(es.map((e) => e.score ?? 0)),
      tests: latest.tests.map((t) => {
        const scores = es.map((e) => e.tests.find((x) => x.test === t.test)?.score ?? null).filter((s): s is number => s !== null);
        return { ...t, score: scores.length ? mean(scores) : null, out_of_output: es.some((e) => e.tests.find((x) => x.test === t.test)?.out_of_output) };
      }),
      gauntlet: GAUNTLET_ORDER.find((g) => es.some((e) => e.gauntlet === g)) ?? latest.gauntlet,
      out_of_output: es.reduce((a, e) => a + e.out_of_output, 0),
      moves: Math.round(moves / es.length),
      solved: Math.round((solved / es.length) * 10) / 10,
      moves_per_solve: solved > 0 ? moves / solved : null,
      secs: Math.round(mean(es.map((e) => e.secs))),
      input_tokens: meanOrNull(es.map((e) => e.input_tokens)),
      output_tokens: meanOrNull(es.map((e) => e.output_tokens)),
      cached_input_tokens: meanOrNull(es.map((e) => e.cached_input_tokens)),
      reasoning_tokens: meanOrNull(es.map((e) => e.reasoning_tokens)),
      cost_usd: costs.length ? mean(costs) : null,
      cost_estimated: es.some((e) => e.cost_estimated),
      cost_parts: meanParts(es.map((e) => e.cost_parts)),
      test_secs: meanByKey(es.map((e) => e.test_secs)),
      n: es.length,
      ids: es.map((e) => e.id),
      run_by: [...new Set(es.flatMap((e) => e.run_by))],
      contributor: null,
    };
  });
}

/** Where a result links: its suite, or the model page when it averages several. */
export const resultHref = (e: SuiteEntry) => (e.n > 1 ? `/models/${e.slug}#${e.kind}` : `/suites/${e.id}`);

/**
 * What the Index ranks for one suite version: Verified, finished, one result per model and effort
 * (averaged), and a model only once it has a result at its top effort.
 */
export function indexPool(entries: SuiteEntry[], kind: SuiteKind, version: string): { ranked: SuiteEntry[]; waiting: Waiting[] } {
  return fullEffort(averageByLabel(entries.filter((e) => e.kind === kind && e.version === version && e.status === 'finished' && e.board === 'verified')));
}

/** Each model once, at its best result, in Index order. */
export function bestPerModel(entries: SuiteEntry[]): SuiteEntry[] {
  const best = new Map<string, SuiteEntry>();
  for (const e of entries) {
    const b = best.get(e.model);
    if (!b || suiteOrder(e, b) < 0) best.set(e.model, e);
  }
  return [...best.values()].sort(suiteOrder);
}

/**
 * Ladder cubes level by level (index-data.ts levelCurves): test ids, and per suite its points as
 * [test index, scramble length, cubes tried, solved, mean moves of the solves or null, mean seconds a try].
 */
export interface LevelData {
  tests: string[];
  suites: Record<string, [number, number, number, number, number | null, number][]>;
}

export interface LevelPoint {
  depth: number;
  tries: number;
  solved: number;
  /** Mean moves of the solved cubes; null when none was solved. */
  moves: number | null;
  /** Mean seconds a try took. */
  secs: number;
}

/** One result's points on one test, its suites pooled (an averaged result stands for several). */
export function levelsOf(data: LevelData, e: SuiteEntry, test: string): LevelPoint[] {
  const t = data.tests.indexOf(test);
  if (t < 0) return [];
  const by = new Map<number, { tries: number; solved: number; moveSum: number; secSum: number }>();
  for (const id of e.ids) {
    for (const [ti, depth, tries, solved, moves, secs] of data.suites[id] ?? []) {
      if (ti !== t) continue;
      const p = by.get(depth) ?? { tries: 0, solved: 0, moveSum: 0, secSum: 0 };
      p.tries += tries;
      p.solved += solved;
      p.moveSum += (moves ?? 0) * solved;
      p.secSum += secs * tries;
      by.set(depth, p);
    }
  }
  return [...by.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([depth, p]) => ({ depth, tries: p.tries, solved: p.solved, moves: p.solved ? p.moveSum / p.solved : null, secs: p.secSum / p.tries }));
}
