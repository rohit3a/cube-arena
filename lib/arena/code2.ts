// Coding v2's records (the NxN ladder; rules in code2-rules.ts). A v2
// submission is a code_submissions row whose version is its bench, 'v2' or
// 'v2-mini'. The runner uploads each stage's folder as its own bundle after
// that stage's session; once all three are in, the submission waits for the
// grader (scripts/code2-worker.mjs on the ROG). The grader posts what each
// program printed, a size at a time, and this file grades every answer; its
// last post adds up the score.

import { createHash } from 'node:crypto';
import { withDb, transaction } from './db';
import { CODE2, type Bench2, type Case2Status, type Part, type PartScore, type Run2, PARTS, benchScore, cpuLimitMs, gradeChain, gradeStage, isBench2, limits2, moveCap, partScore } from './code2-rules';
import { checkTarGz } from './code';
import { ArenaError } from './service';
import { type Stage, STAGES } from '../cube/stages';

/** How long the grader may hold a v2 submission (490 runs, up to a minute each) before another try may take it. */
const LEASE = '10 hours';
/** Kept of each answer here (the longest answer under any cap is well under it). */
const OUTPUT_KEEP = 32 * 1024;

export async function saveStageBundle(id: string, stage: Stage, gz: Buffer, minutes: number | null, nudged: boolean): Promise<{ status: string; stages: Stage[] }> {
  checkTarGz(gz, CODE2.bundleMaxBytes, `${stage}/`);
  const sha = createHash('sha256').update(gz).digest('hex');
  return transaction(async (tx) => {
    const [s] = await tx<{ status: string; version: string }[]>`select status, version from cube_arena.code_submissions where id = ${id} for update`;
    if (!s || !isBench2(s.version)) throw new ArenaError('not_v2', 'That submission is not a v2 one.');
    if (s.status !== 'coding') throw new ArenaError('frozen', 'That submission is not taking code any more (already in, or abandoned).');
    const added = await tx`
      insert into cube_arena.code_bundles (submission_id, stage, bundle, sha256, bytes, minutes, nudged)
      values (${id}, ${stage}, ${gz}, ${sha}, ${gz.length}, ${minutes}, ${nudged})
      on conflict do nothing returning stage`;
    if (!added.length) throw new ArenaError('frozen', `${stage}/ is already in.`);
    const rows = await tx<{ stage: Stage; sha256: string; bytes: number }[]>`
      select stage, sha256, bytes from cube_arena.code_bundles where submission_id = ${id}`;
    const stages = STAGES.filter((st) => rows.some((r) => r.stage === st));
    if (stages.length === STAGES.length) {
      // The submission's digest covers the three bundles in stage order.
      const all = createHash('sha256').update(STAGES.map((st) => rows.find((r) => r.stage === st)!.sha256).join('\n')).digest('hex');
      const bytes = rows.reduce((a, r) => a + r.bytes, 0);
      await tx`update cube_arena.code_submissions set status = 'queued', queued_at = now(), updated_at = now(), bundle_sha256 = ${all}, bundle_bytes = ${bytes}
               where id = ${id}`;
      return { status: 'queued', stages };
    }
    await tx`update cube_arena.code_submissions set updated_at = now() where id = ${id}`;
    return { status: 'coding', stages };
  });
}

export async function stageBundle(id: string, stage: Stage): Promise<Buffer | null> {
  const [row] = await withDb((sql) => sql<{ bundle: Buffer }[]>`
    select bundle from cube_arena.code_bundles where submission_id = ${id} and stage = ${stage}`);
  return row?.bundle ?? null;
}

// ---------------------------------------------------------------------------
// The cases

interface CaseRow {
  size: number;
  case_no: number;
  states: string[];
  ref_moves: number[];
  ref_cpu_ms: number[];
}

async function casesFor(bench: Bench2): Promise<CaseRow[]> {
  const sizes = CODE2.benches[bench].sizes as readonly number[];
  const rows = await withDb((sql) => sql<CaseRow[]>`
    select size, case_no, states, ref_moves, ref_cpu_ms from cube_arena.code_cases
    where version = ${CODE2.caseVersion} and size in ${sql(sizes as number[])} and case_no < ${CODE2.casesPerSize}
    order by size, case_no`);
  if (rows.length !== sizes.length * CODE2.casesPerSize) throw new ArenaError('no_cases', `the ${bench} cases are not all in (found ${rows.length})`);
  return rows;
}

// ---------------------------------------------------------------------------
// The grader

export interface Code2Job {
  id: string;
  version: Bench2;
  limits: ReturnType<typeof limits2>;
  bundles: Record<Stage, string>;
  /** Each hidden cube: its stage inputs (scrambled, centres done, edges done) and each stage's CPU limit. */
  cases: { n: number; case_no: number; inputs: string[]; cpu_limit_ms: number[] }[];
}

/** Hands the oldest waiting v2 submission to the grader (or one whose grading stalled), or null. */
export async function nextJob2(): Promise<Code2Job | null> {
  const job = await transaction(async (tx) => {
    const [row] = await tx<{ id: string; version: Bench2 }[]>`
      select id, version from cube_arena.code_submissions
      where version in ${tx(['v2', 'v2-mini'])} and (status = 'queued' or (status = 'grading' and lease_until < now()))
      order by queued_at limit 1 for update skip locked`;
    if (!row) return null;
    const bundles = await tx<{ stage: Stage; sha256: string }[]>`select stage, sha256 from cube_arena.code_bundles where submission_id = ${row.id}`;
    await tx`delete from cube_arena.code2_results where submission_id = ${row.id}`;
    await tx`update cube_arena.code_submissions set status = 'grading', lease_until = now() + ${LEASE}::interval, updated_at = now() where id = ${row.id}`;
    return { id: row.id, version: row.version, bundles: Object.fromEntries(bundles.map((b) => [b.stage, b.sha256])) as Record<Stage, string> };
  });
  if (!job) return null;
  const cases = await casesFor(job.version);
  return {
    ...job,
    limits: limits2(job.version),
    cases: cases.map((c) => ({ n: c.size, case_no: c.case_no, inputs: c.states, cpu_limit_ms: c.ref_cpu_ms.map(cpuLimitMs) })),
  };
}

export type Report2 =
  | { part: Stage; n: number; case_no: number; run: Run2 & { stderr?: string } }
  | { part: 'e2e'; n: number; case_no: number; runs: (Run2 & { stderr?: string })[]; inputs: string[] };

interface ResultRow {
  submission_id: string;
  part: Part;
  size: number;
  case_no: number;
  status: Case2Status;
  moves: number | null;
  cpu_ms: number | null;
  ref_moves: number;
  cap: number;
  cpu_limit_ms: number;
  value: number;
  output: string | null;
  detail: string | null;
}

const keep = (run: Run2 & { stderr?: string }) =>
  run.stdout.slice(0, OUTPUT_KEEP) + (run.stderr && (run.exit_code !== 0 || run.timed_out) ? `\n[stderr]\n${run.stderr.slice(-2000)}` : '');

/** Grades a batch of the grader's runs and keeps each outcome. */
export async function saveResults2(id: string, reports: Report2[]): Promise<number> {
  const [s] = await withDb((sql) => sql<{ status: string; version: string }[]>`select status, version from cube_arena.code_submissions where id = ${id}`);
  if (s?.status !== 'grading' || !isBench2(s.version)) throw new ArenaError('not_grading', `That submission is ${s?.status ?? 'missing'}, not being graded.`);
  const cases = new Map((await casesFor(s.version)).map((c) => [`${c.size}:${c.case_no}`, c]));
  const rows: ResultRow[] = reports.map((r) => {
    const c = cases.get(`${r.n}:${r.case_no}`);
    if (!c) throw new ArenaError('bad_case', `no case ${r.n}:${r.case_no} in ${s.version}`);
    if (r.part === 'e2e') {
      const ref = c.ref_moves.reduce((a, b) => a + b, 0);
      const o = gradeChain(r.n, c.states[0], r.runs, c.ref_moves, c.ref_cpu_ms);
      // The grader fed each program what the one before left; it must agree with this engine.
      if (o.states.some((st, i) => r.inputs[i] !== st)) throw new ArenaError('chain_mismatch', `the grader's chain for ${r.n}:${r.case_no} differs from the server's`);
      return {
        submission_id: id, part: 'e2e', size: r.n, case_no: r.case_no, ...o, ref_moves: ref, cap: moveCap(ref),
        cpu_limit_ms: c.ref_cpu_ms.map(cpuLimitMs).reduce((a, b) => a + b, 0), output: r.runs.map(keep).join('\n[next]\n'),
      };
    }
    const i = STAGES.indexOf(r.part);
    const o = gradeStage(r.part, r.n, c.states[i], r.run, c.ref_moves[i], c.ref_cpu_ms[i]);
    return {
      submission_id: id, part: r.part, size: r.n, case_no: r.case_no, ...o, ref_moves: c.ref_moves[i], cap: moveCap(c.ref_moves[i]),
      cpu_limit_ms: cpuLimitMs(c.ref_cpu_ms[i]), output: keep(r.run),
    };
  });
  if (!rows.length) return 0;
  const cols = ['submission_id', 'part', 'size', 'case_no', 'status', 'moves', 'cpu_ms', 'ref_moves', 'cap', 'cpu_limit_ms', 'value', 'output', 'detail'] as const;
  await withDb((sql) => sql`
    insert into cube_arena.code2_results ${sql(rows.map((r) => Object.fromEntries(cols.map((k) => [k, r[k]]))), ...cols)}
    on conflict (submission_id, part, size, case_no) do update set
      status = excluded.status, moves = excluded.moves, cpu_ms = excluded.cpu_ms, ref_moves = excluded.ref_moves, cap = excluded.cap,
      cpu_limit_ms = excluded.cpu_limit_ms, value = excluded.value, output = excluded.output, detail = excluded.detail`);
  return rows.length;
}

export interface Build2 {
  ok: boolean;
  ms: number;
  log: string;
}

/**
 * The grader is done: every case it did not post counts 0 (a failed build, or
 * an earlier stage that failed in the chain), and the score is added up.
 */
export async function finishJob2(id: string, grader: string, builds: Partial<Record<Stage, Build2>>): Promise<Record<string, unknown>> {
  const [s] = await withDb((sql) => sql<{ status: string; version: string }[]>`select status, version from cube_arena.code_submissions where id = ${id}`);
  if (s?.status !== 'grading' || !isBench2(s.version)) throw new ArenaError('not_grading', `That submission is ${s?.status ?? 'missing'}, not being graded.`);
  const bench = s.version;
  const cases = await casesFor(bench);
  const have = await withDb((sql) => sql<{ part: Part; size: number; case_no: number; status: Case2Status; value: string; moves: number | null; cpu_ms: number | null }[]>`
    select part, size, case_no, status, value, moves, cpu_ms from cube_arena.code2_results where submission_id = ${id}`);
  const key = (p: string, n: number, k: number) => `${p}:${n}:${k}`;
  const got = new Set(have.map((r) => key(r.part, r.size, r.case_no)));
  const missing: ResultRow[] = [];
  for (const part of PARTS) {
    for (const c of cases) {
      if (got.has(key(part, c.size, c.case_no))) continue;
      const failed = part === 'e2e' ? STAGES.filter((st) => !builds[st]?.ok) : builds[part]?.ok ? [] : [part];
      const i = STAGES.indexOf(part as Stage);
      const ref = i < 0 ? c.ref_moves.reduce((a, b) => a + b, 0) : c.ref_moves[i];
      missing.push({
        submission_id: id, part, size: c.size, case_no: c.case_no, status: 'crash', moves: null, cpu_ms: null, ref_moves: ref, cap: moveCap(ref),
        cpu_limit_ms: i < 0 ? c.ref_cpu_ms.map(cpuLimitMs).reduce((a, b) => a + b, 0) : cpuLimitMs(c.ref_cpu_ms[i]), value: 0, output: null,
        detail: failed.length ? `the ${failed.join(', ')} build failed` : 'not run',
      });
    }
  }
  const all = [...have.map((r) => ({ ...r, value: Number(r.value) })), ...missing];
  const sizes = CODE2.benches[bench].sizes as readonly number[];
  const parts = Object.fromEntries(PARTS.map((p) => [p, partScore(all.filter((r) => r.part === p), sizes)])) as Record<Part, PartScore>;
  const e2e = all.filter((r) => r.part === 'e2e' && r.status === 'solved');
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const buildsOut = Object.fromEntries(STAGES.map((st) => [st, builds[st] ? { ok: builds[st]!.ok, ms: Math.round(builds[st]!.ms) } : null]));
  const buildLog = STAGES.map((st) => `== ${st} ==\n${(builds[st]?.log ?? '').slice(-6000)}`).join('\n');
  return transaction(async (tx) => {
    if (missing.length) {
      const cols = ['submission_id', 'part', 'size', 'case_no', 'status', 'moves', 'cpu_ms', 'ref_moves', 'cap', 'cpu_limit_ms', 'value', 'output', 'detail'] as const;
      await tx`insert into cube_arena.code2_results ${tx(missing.map((r) => Object.fromEntries(cols.map((k) => [k, r[k]]))), ...cols)}
               on conflict do nothing`;
    }
    const [row] = await tx<{ id: string; score: string; solved: number; cases: number }[]>`
      update cube_arena.code_submissions
      set status = 'graded', graded_at = now(), updated_at = now(), lease_until = null, grader = ${grader.slice(0, 200)},
          build_ok = ${STAGES.every((st) => builds[st]?.ok)}, build_ms = ${Math.round(STAGES.reduce((a, st) => a + (builds[st]?.ms ?? 0), 0))},
          build_log = ${buildLog}, builds = ${tx.json(buildsOut)}, parts = ${tx.json(parts as never)},
          cases = ${all.length}, solved = ${all.filter((r) => r.status === 'solved').length}, score = ${benchScore(parts)},
          mean_moves = ${mean(e2e.map((r) => r.moves ?? 0))}, mean_ms = ${mean(e2e.map((r) => r.cpu_ms ?? 0))}, error = null
      where id = ${id} and status = 'grading'
      returning id, score, solved, cases`;
    if (!row) throw new ArenaError('not_grading', 'That submission is no longer being graded.');
    return { id: row.id, score: Number(row.score), solved: row.solved, cases: row.cases, parts };
  });
}

/** Each case's outcome per part: status, moves, CPU and the limits, never the moves themselves. */
export async function code2CaseRows(id: string) {
  return withDb((sql) => sql<{ part: Part; size: number; case_no: number; status: Case2Status; moves: number | null; cpu_ms: number | null; ref_moves: number; cap: number; cpu_limit_ms: number; value: string; detail: string | null }[]>`
    select part, size, case_no, status, moves, cpu_ms, ref_moves, cap, cpu_limit_ms, value, detail
    from cube_arena.code2_results where submission_id = ${id} order by part, size, case_no`);
}

/** The bundles' stage, size, session minutes and whether the time-left message went out. */
export async function stageBundles(id: string) {
  return withDb((sql) => sql<{ stage: Stage; sha256: string; bytes: number; minutes: string | null; nudged: boolean }[]>`
    select stage, sha256, bytes, minutes, nudged from cube_arena.code_bundles where submission_id = ${id}`);
}
