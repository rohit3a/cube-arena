// The Cube Arena Index: every suite with its grade, moves, time, tokens and
// cost, for the index charts, model pages and suite pages. Cached like the
// boards (board.ts): dates arrive as strings after the round trip.

import { unstable_cache } from 'next/cache';
import { catalogCost, catalogModel, harnessLabel, topEffort } from './catalog';
import { clientLabel } from './clients';
import { type Review, type SuiteRow, type Usage, UUID, withDb } from './db';
import { contributorSlug } from './invites';
import { PRICES, estimateCost, makerOf, slugOf, splitLabel } from './makers';
import type { LevelData } from './aggregate';
import { gradeSuites } from './suite-data';
import { type GauntletState, SUITES, type SuiteKind, suiteTests, testName } from './suites';

export interface SuiteRunInfo {
  slot: number;
  run_id: string;
  status: string;
  end_reason: string | null;
  best_level: number;
  /** Its top level when not the size's usual one (a Gauntlet's 20). */
  top_level: number | null;
  solves: number;
  /** Every move made in the run, failed attempts included. */
  moves: number;
  secs: number;
  /** Time left out of `secs` that wasn't the model's doing: a pause of ours, sessions lost to API errors. */
  paused_secs: number;
  /** The attempt to show for this run: its best solve, else its last try. */
  replay: string | null;
  via: string;
  /** The level it ran out of output on (format.ts outOfOutput), when that's how it ended. */
  out_of_output: number | null;
}

export interface SuiteEntry {
  id: string;
  kind: SuiteKind;
  version: string;
  board: 'verified' | 'community';
  /** Community only: the operator's review; only approved ones reach the boards. */
  review: Review;
  /** The name on the boards, e.g. "GPT-6-Luna (max)". */
  label: string;
  /** Without the effort, e.g. "GPT-6-Luna". */
  model: string;
  /** For model pages: the CLI id on Verified ("gpt-6-luna"), else built from the name. */
  slug: string;
  effort: string | null;
  /** The model's top effort (catalog.ts topEffort): rankings wait for a result at it. */
  top_effort: string | null;
  maker: string;
  color: string;
  display_name: string;
  status: 'active' | 'finished';
  created_at: string;
  finished_at: string | null;
  /** 0-100; null while unfinished. */
  score: number | null;
  /** out_of_output: a reply hit the model's output limit before it answered, which ended this test. */
  tests: { test: string; gauntlet: boolean; score: number | null; played: number; cubes: number; out_of_output: boolean }[];
  /**
   * Fast's 4×4 Gauntlet: locked (no perfect score on the other tests), pending (unlocked, not played yet: the score so
   * far is all there is), playing, or done. Null for suites without one.
   */
  gauntlet: GauntletState | null;
  /** Tests that ended because a reply hit the model's output limit. */
  out_of_output: number;
  moves: number;
  /** Cubes solved, and moves per solved cube (null with none). */
  solved: number;
  moves_per_solve: number | null;
  secs: number;
  /** Time left out of `secs` that wasn't the model's doing: a pause of ours, sessions lost to API errors. */
  paused_secs: number;
  /** Everything read, cached reads included (input_tokens), and everything written, reasoning included (output_tokens). */
  input_tokens: number | null;
  output_tokens: number | null;
  /** Of input_tokens, those read from the cache. */
  cached_input_tokens: number | null;
  /** Of output_tokens, those spent reasoning; null when the harness doesn't count them (Cursor). */
  reasoning_tokens: number | null;
  cost_usd: number | null;
  /** True when the cost comes from token counts at list prices, not from the CLI. */
  cost_estimated: boolean;
  /** cost_usd split by token type at the model's list prices; null without prices or token counts. */
  cost_parts: CostParts | null;
  /** Time on each test, by test id (paused time left out). */
  test_secs: Record<string, number>;
  runs: SuiteRunInfo[];
  /** Tests started so far, of how many, the Gauntlet aside: "test 2 of 3" while it runs. */
  progress: { started: number; of: number };
  /** Suites this entry stands for: 1, or more once averaged (aggregate.ts). */
  n: number;
  ids: string[];
  /** Who ran it: "Cube Arena", an invitee who chose to show their name, or "an invited tester". */
  run_by: string[];
  /** How the model was reached: "Claude Code", "Codex", "OpenRouter", an API host. */
  harness: string | null;
  /** The invitee who ran it, when they chose to show their name (contributors.ts). */
  contributor: { slug: string; name: string; x: string | null } | null;
}

/**
 * What a suite's cost went on: uncached input, cache hits, reasoning and the answers written. The shares come from
 * the model's list prices and are scaled to the cost reported, so they always add up to it. `reasoning` is null when
 * the harness doesn't count reasoning tokens, and `answer` is then all the output.
 */
export interface CostParts {
  input: number;
  cached: number;
  reasoning: number | null;
  answer: number;
}

function listPrice(modelId: string | null): { input: number; cached: number; output: number } | null {
  if (!modelId) return null;
  const p = PRICES[modelId] ?? catalogModel(modelId)?.price;
  if (!p || p.input == null || p.output == null) return null;
  return { input: p.input, cached: p.cached ?? p.input, output: p.output };
}

function costParts(
  modelId: string | null,
  cost: number | null,
  t: { input: number | null; cached: number | null; output: number | null; reasoning: number | null },
): CostParts | null {
  const p = listPrice(modelId);
  if (!p || cost === null || t.input === null || t.output === null) return null;
  const cached = Math.min(t.cached ?? 0, t.input);
  const reasoning = t.reasoning === null ? null : Math.min(t.reasoning, t.output);
  const raw = {
    input: (t.input - cached) * p.input,
    cached: cached * p.cached,
    reasoning: reasoning === null ? null : reasoning * p.output,
    answer: (t.output - (reasoning ?? 0)) * p.output,
  };
  const sum = raw.input + raw.cached + (raw.reasoning ?? 0) + raw.answer;
  if (sum <= 0) return null;
  const k = cost / sum;
  return { input: raw.input * k, cached: raw.cached * k, reasoning: raw.reasoning === null ? null : raw.reasoning * k, answer: raw.answer * k };
}

interface Row extends SuiteRow {
  invite_name: string | null;
  invite_x: string | null;
  runs: (Omit<SuiteRunInfo, 'via'> & { usage: Usage | null; client: string | null })[];
}

async function suiteEntriesQuery(): Promise<SuiteEntry[]> {
  return withDb(async (sql) => {
    const rows = await sql<Row[]>`
      select s.*, i.name as invite_name, i.x_handle as invite_x,
        coalesce((
          select json_agg(json_build_object(
            'slot', r.suite_slot, 'run_id', r.id, 'status', r.status, 'end_reason', r.end_reason,
            'best_level', r.best_level, 'top_level', r.top_level, 'solves', r.solves, 'usage', r.usage, 'client', r.client,
            'moves', coalesce(a.moves, 0), 'secs', coalesce(a.secs, 0), 'paused_secs', coalesce(a.paused_secs, 0), 'replay', a.replay, 'out_of_output', a.out_of_output
          ) order by r.suite_slot)
          from cube_arena.runs r
          left join lateral (
            select sum(x.move_count)::int as moves,
                   (extract(epoch from (max(coalesce(x.finished_at, now())) - min(x.created_at))) - sum(x.paused_secs))::int as secs,
                   sum(x.paused_secs)::int as paused_secs,
                   (array_agg(x.id order by (x.status = 'solved') desc, x.level desc nulls last, x.seq desc))[1] as replay,
                   -- the runner's reason for a reply over the output limit (format.ts outOfOutput)
                   max(x.level) filter (where x.status = 'gave_up' and x.detail ilike '%output token limit%') as out_of_output
            from cube_arena.attempts x where x.run_id = r.id
          ) a on true
          where r.suite_id = s.id
        ), '[]'::json) as runs
      from cube_arena.suites s left join cube_arena.invites i on i.id = s.invite_id
      where not s.hidden
      order by s.created_at desc
      limit 1000`;
    const grades = await gradeSuites(sql, rows);
    return rows.map((s) => {
      const { model, effort } = s.model ? { model: s.model, effort: s.effort } : splitLabel(s.model_name);
      const maker = makerOf(model);
      const grade = grades.get(s.id);
      const tokens = (k: 'input_tokens' | 'output_tokens' | 'cached_input_tokens') => {
        const xs = s.runs.map((r) => r.usage?.[k]).filter((v): v is number => Number.isFinite(v));
        return xs.length ? xs.reduce((a, b) => a + b, 0) : null;
      };
      // Reasoning only when every run that counted tokens counted it too: a part-count would understate it.
      const counted = s.runs.filter((r) => Number.isFinite(r.usage?.output_tokens));
      const reasoning = counted.length && counted.every((r) => Number.isFinite(r.usage?.reasoning_tokens)) ? counted.reduce((a, r) => a + (r.usage?.reasoning_tokens ?? 0), 0) : null;
      const testSecs: Record<string, number> = {};
      for (const r of s.runs) {
        const test = SUITES[s.kind].slots[r.slot]?.test;
        if (test) testSecs[test] = (testSecs[test] ?? 0) + Math.max(0, r.secs);
      }
      // Cost: what the CLI reported, else tokens at list prices; null if any run lacks both.
      let cost: number | null = 0;
      let estimated = false;
      for (const r of s.runs) {
        const reported = r.usage?.cost_usd;
        const est = r.usage ? (estimateCost(s.model_id, r.usage) ?? catalogCost(s.model_id, r.usage)) : null;
        if (Number.isFinite(reported)) cost = (cost ?? 0) + (reported as number);
        else if (est !== null) {
          cost = (cost ?? 0) + est;
          estimated = true;
        } else cost = null;
        if (cost === null) break;
      }
      const solved = s.runs.reduce((a, r) => a + r.solves, 0);
      const moves = s.runs.reduce((a, r) => a + r.moves, 0);
      const ranOut = new Set(s.runs.filter((r) => r.out_of_output !== null).map((r) => SUITES[s.kind].slots[r.slot]?.test));
      return {
        id: s.id,
        kind: s.kind,
        version: s.version,
        board: s.board,
        label: s.model_name,
        model,
        slug: s.model_id ?? slugOf(model),
        effort,
        top_effort: topEffort(s.model_id ?? slugOf(model), model),
        maker: maker.name,
        color: maker.color,
        display_name: s.display_name,
        review: s.review,
        status: s.status,
        created_at: new Date(s.created_at).toISOString(),
        finished_at: s.finished_at ? new Date(s.finished_at).toISOString() : null,
        score: s.status === 'finished' ? (grade?.score ?? 0) : null,
        tests: (grade?.tests ?? []).map((t) => ({
          test: t.test,
          gauntlet: t.gauntlet,
          score: t.score,
          played: t.played,
          cubes: t.cubes,
          out_of_output: ranOut.has(t.test),
        })),
        gauntlet: grade?.gauntlet ?? null,
        out_of_output: s.runs.filter((r) => r.out_of_output !== null).length,
        moves,
        solved,
        moves_per_solve: solved > 0 ? moves / solved : null,
        secs: s.runs.reduce((a, r) => a + r.secs, 0),
        paused_secs: s.runs.reduce((a, r) => a + (r.paused_secs ?? 0), 0),
        input_tokens: tokens('input_tokens'),
        output_tokens: tokens('output_tokens'),
        cached_input_tokens: tokens('cached_input_tokens'),
        reasoning_tokens: reasoning,
        cost_usd: s.runs.length ? cost : null,
        cost_estimated: estimated,
        cost_parts: costParts(s.model_id, s.runs.length ? cost : null, {
          input: tokens('input_tokens'),
          cached: tokens('cached_input_tokens'),
          output: tokens('output_tokens'),
          reasoning,
        }),
        test_secs: testSecs,
        runs: s.runs.map(({ usage: _u, client, ...r }) => ({ ...r, via: clientLabel(client) })),
        progress: {
          started: new Set(s.runs.filter((r) => !SUITES[s.kind].slots[r.slot]?.gauntlet).map((r) => SUITES[s.kind].slots[r.slot]?.test)).size,
          of: suiteTests(SUITES[s.kind]).filter((t) => !t.gauntlet).length,
        },
        n: 1,
        ids: [s.id],
        run_by: [s.board === 'community' ? s.display_name : !s.invite_id ? 'Cube Arena' : s.credit && s.invite_name ? s.invite_name : 'an invited tester'],
        harness: harnessLabel(s.harness ?? s.agent),
        contributor:
          s.board === 'verified' && s.invite_id && s.credit && s.invite_name
            ? { slug: contributorSlug(s.invite_id, s.invite_x), name: s.invite_name, x: s.invite_x }
            : null,
      };
    });
  });
}

const cachedEntries = unstable_cache(suiteEntriesQuery, ['cube-arena', 'suiteEntries'], { revalidate: 30 });

/** What the public pages show: Verified suites, and Community ones the operator approved. */
export async function suiteEntries(): Promise<SuiteEntry[]> {
  return (await allSuiteEntries()).filter((e) => e.board === 'verified' || e.review === 'approved');
}

/** Every suite that isn't hidden, reviewed or not: for the operator's review. */
export async function allSuiteEntries(): Promise<SuiteEntry[]> {
  const real = await cachedEntries();
  if (process.env.NODE_ENV !== 'production' && process.env.CUBE_DEMO_INDEX) {
    const { demoEntries } = await import('./demo-index');
    return [...real, ...demoEntries()];
  }
  return real;
}

export async function suiteEntry(id: string): Promise<SuiteEntry | null> {
  if (!UUID.test(id)) return null;
  return (await suiteEntries()).find((s) => s.id === id) ?? null;
}

/**
 * Ladder cubes level by level, for the Index's level charts: per suite, one point per test and scramble length with
 * the cubes tried there, how many were solved, the mean moves of the solves and the mean time of a try (paused time
 * left out). Finished cubes only.
 */
export async function levelCurves(suiteIds: string[]): Promise<LevelData> {
  const ids = suiteIds.filter((id) => UUID.test(id));
  if (!ids.length) return { tests: [], suites: {} };
  const rows = await withDb((sql) => sql<{ suite_id: string; kind: SuiteKind; slot: number; depth: number; tries: number; solved: number; moves: number | null; secs: number }[]>`
    select r.suite_id, s.kind, r.suite_slot as slot, a.level + r.level_offset as depth, count(*)::int as tries,
           count(*) filter (where a.status = 'solved')::int as solved,
           avg(a.move_count) filter (where a.status = 'solved')::float as moves,
           avg(greatest(0, extract(epoch from a.finished_at - a.created_at) - a.paused_secs))::float as secs
    from cube_arena.attempts a
    join cube_arena.runs r on r.id = a.run_id
    join cube_arena.suites s on s.id = r.suite_id
    where r.suite_id = any(${sql.array(ids)}::uuid[]) and not r.hidden and r.challenge = 'ladder'
      and a.finished_at is not null and a.level is not null
    group by r.suite_id, s.kind, r.suite_slot, a.level + r.level_offset
    order by r.suite_slot, depth`);
  const tests: string[] = [];
  const suites: LevelData['suites'] = {};
  for (const r of rows) {
    const test = SUITES[r.kind].slots[r.slot]?.test;
    if (!test) continue;
    if (!tests.includes(test)) tests.push(test);
    const round = (v: number) => Math.round(v * 10) / 10;
    (suites[r.suite_id] ??= []).push([tests.indexOf(test), r.depth, r.tries, r.solved, r.moves === null ? null : round(r.moves), round(r.secs)]);
  }
  return { tests, suites };
}

/** Test ids in a suite, in order, with readable names; `gauntlet` marks Fast's 4×4 Gauntlet tests. */
export function testNames(kind: SuiteKind): { test: string; name: string; short: string; gauntlet: boolean }[] {
  return suiteTests(SUITES[kind]).map((t) => ({ test: t.test, ...testName(t), gauntlet: t.gauntlet }));
}
