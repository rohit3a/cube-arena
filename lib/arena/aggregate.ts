// Several Verified suites of the same model and effort (run by different
// people, or again later) count as one result: their average, with how many
// there were. Safe to import from client components.

import type { SuiteEntry } from './index-data';

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const meanOrNull = (xs: (number | null)[]) => (xs.every((x) => x !== null) && xs.length ? mean(xs as number[]) : null);

/** One entry per label (model and effort): the mean of its finished suites. Entries newest first. */
export function averageByLabel(entries: SuiteEntry[]): SuiteEntry[] {
  const groups = new Map<string, SuiteEntry[]>();
  for (const e of entries) groups.set(e.label, [...(groups.get(e.label) ?? []), e]);
  return [...groups.values()].map((es) => {
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
      out_of_output: es.reduce((a, e) => a + e.out_of_output, 0),
      moves: Math.round(moves / es.length),
      solved: Math.round((solved / es.length) * 10) / 10,
      moves_per_solve: solved > 0 ? moves / solved : null,
      secs: Math.round(mean(es.map((e) => e.secs))),
      input_tokens: meanOrNull(es.map((e) => e.input_tokens)),
      output_tokens: meanOrNull(es.map((e) => e.output_tokens)),
      cost_usd: costs.length ? mean(costs) : null,
      cost_estimated: es.some((e) => e.cost_estimated),
      n: es.length,
      ids: es.map((e) => e.id),
      run_by: [...new Set(es.flatMap((e) => e.run_by))],
      contributor: null,
    };
  });
}

/** Where a result links: its suite, or the model page when it averages several. */
export const resultHref = (e: SuiteEntry) => (e.n > 1 ? `/models/${e.slug}#${e.kind}` : `/suites/${e.id}`);
