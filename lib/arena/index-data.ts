// The Cube Arena Index: every suite with its grade, moves, time, tokens and
// cost, for the index charts, model pages and suite pages. Cached like the
// boards (board.ts): dates arrive as strings after the round trip.

import { unstable_cache } from 'next/cache';
import { catalogCost, harnessLabel } from './catalog';
import { clientLabel } from './clients';
import { type SuiteRow, type Usage, UUID, withDb } from './db';
import { contributorSlug } from './invites';
import { estimateCost, makerOf, slugOf, splitLabel } from './makers';
import { gradeSuites } from './suite-data';
import { SUITES, type SuiteKind, suiteTests } from './suites';

export interface SuiteRunInfo {
  slot: number;
  run_id: string;
  status: string;
  end_reason: string | null;
  best_level: number;
  solves: number;
  /** Every move made in the run, failed attempts included. */
  moves: number;
  secs: number;
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
  /** The name on the boards, e.g. "GPT-6-Luna (max)". */
  label: string;
  /** Without the effort, e.g. "GPT-6-Luna". */
  model: string;
  /** For model pages: the CLI id on Verified ("gpt-6-luna"), else built from the name. */
  slug: string;
  effort: string | null;
  maker: string;
  color: string;
  display_name: string;
  status: 'active' | 'finished';
  created_at: string;
  finished_at: string | null;
  /** 0-100; null while unfinished. */
  score: number | null;
  /** out_of_output: a reply hit the model's output limit before it answered, which ended this test. */
  tests: { test: string; score: number | null; played: number; cubes: number; out_of_output: boolean }[];
  /** Tests that ended because a reply hit the model's output limit. */
  out_of_output: number;
  moves: number;
  /** Cubes solved, and moves per solved cube (null with none). */
  solved: number;
  moves_per_solve: number | null;
  secs: number;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  /** True when the cost comes from token counts at list prices, not from the CLI. */
  cost_estimated: boolean;
  runs: SuiteRunInfo[];
  /** Tests started so far, of how many: "test 2 of 3" while it runs. */
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
            'best_level', r.best_level, 'solves', r.solves, 'usage', r.usage, 'client', r.client,
            'moves', coalesce(a.moves, 0), 'secs', coalesce(a.secs, 0), 'replay', a.replay, 'out_of_output', a.out_of_output
          ) order by r.suite_slot)
          from cube_arena.runs r
          left join lateral (
            select sum(x.move_count)::int as moves,
                   extract(epoch from (max(coalesce(x.finished_at, now())) - min(x.created_at)))::int as secs,
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
      const tokens = (k: 'input_tokens' | 'output_tokens') => {
        const xs = s.runs.map((r) => r.usage?.[k]).filter((v): v is number => Number.isFinite(v));
        return xs.length ? xs.reduce((a, b) => a + b, 0) : null;
      };
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
        maker: maker.name,
        color: maker.color,
        display_name: s.display_name,
        status: s.status,
        created_at: new Date(s.created_at).toISOString(),
        finished_at: s.finished_at ? new Date(s.finished_at).toISOString() : null,
        score: s.status === 'finished' ? (grade?.score ?? 0) : null,
        tests: (grade?.tests ?? []).map((t) => ({ test: t.test, score: t.score, played: t.played, cubes: t.cubes, out_of_output: ranOut.has(t.test) })),
        out_of_output: s.runs.filter((r) => r.out_of_output !== null).length,
        moves,
        solved,
        moves_per_solve: solved > 0 ? moves / solved : null,
        secs: s.runs.reduce((a, r) => a + r.secs, 0),
        input_tokens: tokens('input_tokens'),
        output_tokens: tokens('output_tokens'),
        cost_usd: s.runs.length ? cost : null,
        cost_estimated: estimated,
        runs: s.runs.map(({ usage: _u, client, ...r }) => ({ ...r, via: clientLabel(client) })),
        progress: {
          started: new Set(s.runs.map((r) => SUITES[s.kind].slots[r.slot]?.test)).size,
          of: suiteTests(SUITES[s.kind]).length,
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

export async function suiteEntries(): Promise<SuiteEntry[]> {
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

/** Test ids in a suite, in order, with readable names. */
export function testNames(kind: SuiteKind): { test: string; name: string; short: string }[] {
  return suiteTests(SUITES[kind]).map((t) => {
    const what = t.challenge === 'ladder' ? 'ladder' : 'scramble';
    const mode = t.mode === 'one_shot' ? 'one-shot' : 'interactive';
    return { test: t.test, name: `${t.size}×${t.size} ${what}, ${mode}`, short: `${t.size}×${t.size} ${what === 'ladder' ? 'L' : 'S'} ${mode === 'one-shot' ? '1×' : 'int'}` };
  });
}
