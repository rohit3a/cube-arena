// Everything the press desk (cube-arena-comms press/) draws charts and writes posts from, in one answer: every public
// suite, each kind's tests and Index, a result per model and effort, and the ladders level by level. One request a
// draft, however many models or charts it covers; the desk works out the rest itself.

import { averageByLabel, bestPerModel, indexPool } from './aggregate';
import { catalogModel } from './catalog';
import { UUID, withDb } from './db';
import { type SuiteEntry, suiteEntries } from './index-data';
import { SUITES, SUITE_KINDS, type SuiteKind, suiteTests, testName, testWeights } from './suites';

/** Each test of a suite with its best level (ladders) or cubes solved (full scrambles), and a replay to show. */
function withTests(e: SuiteEntry) {
  const def = SUITES[e.kind];
  const tests = suiteTests(def);
  return {
    ...e,
    tests: e.tests.map((t) => {
      const td = tests.find((x) => x.test === t.test);
      const runs = e.runs.filter((r) => def.slots[r.slot]?.test === t.test);
      const ladder = td?.challenge === 'ladder';
      return {
        ...t,
        best: runs.length ? (ladder ? Math.max(...runs.map((r) => r.best_level)) : runs.reduce((a, r) => a + r.solves, 0)) : null,
        of: td ? (ladder ? td.levels : td.slots.length) : null,
        replay: runs.find((r) => r.replay)?.replay ?? null,
      };
    }),
    runs: e.runs.map((r) => ({ ...r, test: def.slots[r.slot]?.test ?? null })),
  };
}

/**
 * Ladders level by level, per suite and test: [test, level, cubes tried, solved, mean moves of the solves or null,
 * mean seconds a try]. By the run's level (not its depth), finished cubes only.
 */
async function ladders(entries: SuiteEntry[]) {
  const ids = entries.map((e) => e.id).filter((id) => UUID.test(id));
  if (!ids.length) return {};
  const rows = await withDb((sql) => sql<{ suite_id: string; kind: SuiteKind; slot: number; level: number; tries: number; solved: number; moves: number | null; secs: number }[]>`
    select r.suite_id, s.kind, r.suite_slot as slot, a.level, count(*)::int as tries,
           count(*) filter (where a.status = 'solved')::int as solved,
           avg(a.move_count) filter (where a.status = 'solved')::float as moves,
           avg(greatest(0, extract(epoch from a.finished_at - a.created_at) - a.paused_secs))::float as secs
    from cube_arena.attempts a
    join cube_arena.runs r on r.id = a.run_id
    join cube_arena.suites s on s.id = r.suite_id
    where r.suite_id = any(${sql.array(ids)}::uuid[]) and not r.hidden and r.challenge = 'ladder'
      and a.finished_at is not null and a.level is not null and a.status <> 'stopped'
    group by r.suite_id, s.kind, r.suite_slot, a.level
    order by r.suite_slot, a.level`);
  const out: Record<string, [string, number, number, number, number | null, number][]> = {};
  const round = (v: number) => Math.round(v * 10) / 10;
  for (const r of rows) {
    const test = SUITES[r.kind].slots[r.slot]?.test;
    if (test) (out[r.suite_id] ??= []).push([test, r.level, r.tries, r.solved, r.moves === null ? null : round(r.moves), round(r.secs)]);
  }
  return out;
}

export async function pressSnapshot() {
  const entries = await suiteEntries();
  const kinds = Object.fromEntries(
    SUITE_KINDS.map((kind) => {
      const def = SUITES[kind];
      const weights = testWeights(def);
      const { ranked, waiting } = indexPool(entries, kind, def.version);
      return [
        kind,
        {
          version: def.version,
          name: def.name,
          tests: suiteTests(def).map((t) => ({
            test: t.test,
            ...testName(t),
            size: t.size,
            challenge: t.challenge,
            mode: t.mode,
            gauntlet: t.gauntlet,
            levels: t.levels,
            cubes: t.slots.length,
            weight: weights.get(t.test) ?? 0,
          })),
          /** One result per model and effort (Verified, finished, this version; several suites averaged). */
          results: averageByLabel(entries.filter((e) => e.kind === kind && e.version === def.version && e.status === 'finished' && e.board === 'verified')).map(withTests),
          /** The Index: labels of those results, best first, each model once. */
          index: bestPerModel(ranked).map((e) => e.label),
          waiting,
        },
      ];
    }),
  );
  const slugs = [...new Set(entries.map((e) => e.slug))];
  return {
    built_at: new Date().toISOString(),
    /** Every suite the public pages show, running ones included, newest first. */
    suites: [...entries].sort((a, b) => b.created_at.localeCompare(a.created_at)).map(withTests),
    kinds,
    ladders: await ladders(entries.filter((e) => e.version === SUITES[e.kind].version)),
    catalog: Object.fromEntries(
      slugs.flatMap((s) => {
        const c = catalogModel(s);
        return c ? [[s, { name: c.name, efforts: c.efforts, price: c.price ?? null }]] : [];
      }),
    ),
  };
}
