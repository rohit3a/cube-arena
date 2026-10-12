// The coding benchmark's records: submissions from the runner, the grader's
// jobs on the ROG, and the board. The rules and grading live in code-rules.ts.
//
// The runner makes a submission, keeps it alive while the model codes, then
// uploads the solver/ folder, which freezes it. The grader (scripts/
// code-worker.mjs, on the ROG) takes queued submissions one at a time, runs
// them on the hidden cubes in a sandbox, and posts what each run printed;
// this file checks every answer itself and keeps the score.

import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { unstable_cache } from 'next/cache';
import type { Auth } from './auth';
import { type Harness, HARNESSES, catalogCost, catalogModel, harnessLabel, labelOf, listCost, topEffort } from './catalog';
import { type Usage, UUID, transaction, withDb } from './db';
import { contributorSlug } from './invites';
import { estimateCost, makerOf, slugOf } from './makers';
import { CODE, type CaseRun, type CaseStatus, codeRank, gradeCase, hiddenCases, summarize } from './code-rules';
import { ArenaError } from './service';

export type CodeStatus = 'coding' | 'queued' | 'grading' | 'graded' | 'failed';

export interface CodeSubmission {
  id: string;
  created_at: Date;
  updated_at: Date;
  version: string;
  display_name: string;
  model_name: string;
  model: string | null;
  model_id: string | null;
  effort: string | null;
  agent: string | null;
  harness: string | null;
  invite_id: string | null;
  credit: boolean;
  status: CodeStatus;
  hidden: boolean;
  hidden_reason: string | null;
  dev_minutes: number | null;
  usage: Usage | null;
  bundle_sha256: string | null;
  bundle_bytes: number | null;
  queued_at: Date | null;
  graded_at: Date | null;
  grader: string | null;
  build_ok: boolean | null;
  build_ms: number | null;
  cases: number | null;
  solved: number | null;
  score: number | null;
  mean_moves: number | null;
  mean_ms: number | null;
  error: string | null;
}

const COLUMNS = [
  'id', 'created_at', 'updated_at', 'version', 'display_name', 'model_name', 'model', 'model_id', 'effort', 'agent', 'harness',
  'invite_id', 'credit', 'status', 'hidden', 'hidden_reason', 'dev_minutes', 'usage', 'bundle_sha256', 'bundle_bytes', 'queued_at',
  'graded_at', 'grader', 'build_ok', 'build_ms', 'cases', 'solved', 'score', 'mean_moves', 'mean_ms', 'error',
] as const;

/** numeric columns come back as strings. */
function clean(row: Record<string, unknown>): CodeSubmission {
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return { ...row, dev_minutes: num(row.dev_minutes), score: num(row.score), mean_moves: num(row.mean_moves), mean_ms: num(row.mean_ms) } as CodeSubmission;
}

/** How long the runner may go quiet while its model codes before the submission counts as abandoned. */
const RUNNER_QUIET = '30 minutes';
/** How long the grader may hold a submission before another try may take it. */
const LEASE = '3 hours';
export const CODE_TRANSCRIPT_MAX_BYTES = 2 * 1024 * 1024;

export async function getSubmission(id: string): Promise<CodeSubmission | null> {
  if (!UUID.test(id)) return null;
  const [row] = await withDb((sql) => sql`select ${sql(COLUMNS)} from cube_arena.code_submissions where id = ${id}`);
  return row ? clean(row) : null;
}

/** The operator owns everything; an invitee its own submissions. */
export const ownsSubmission = (auth: Auth, s: CodeSubmission) => auth.role === 'operator' || s.invite_id === auth.invite.id;

/** Starts a submission for a catalog model, an effort it takes, and a way to reach it. */
export async function createSubmission(auth: Auth, body: { model_id?: unknown; effort?: unknown; harness?: unknown; credit?: unknown }, client: string | null): Promise<CodeSubmission> {
  const model = catalogModel(typeof body.model_id === 'string' ? body.model_id : '');
  if (!model) throw new ArenaError('bad_model', 'model_id is not in the catalog (GET /api/catalog lists them)');
  const effort = typeof body.effort === 'string' && body.effort ? body.effort.slice(0, 16) : null;
  if (model.efforts.length ? !effort || !model.efforts.includes(effort) : effort) {
    throw new ArenaError('bad_effort', model.efforts.length ? `${model.name} takes effort ${model.efforts.join(', ')}` : `${model.name} has no effort setting; leave it out`);
  }
  // Coding needs a coding agent: Claude Code or Codex, each sandboxed by the runner.
  const harness = typeof body.harness === 'string' ? body.harness : '';
  if (!['claude-code', 'codex'].includes(harness) || !HARNESSES.includes(harness as Harness) || !model.via[harness as Harness]) {
    throw new ArenaError('bad_harness', `harness must be one of ${Object.keys(model.via).filter((h) => h !== 'openrouter').join(', ') || 'claude-code, codex'} (the coding benchmark needs a coding agent)`);
  }
  const credit = auth.role === 'invite' && body.credit === true;
  const display = auth.role === 'operator' ? 'Cube Arena' : credit ? auth.invite.name.slice(0, 32).padEnd(2, '.') : 'Invited tester';
  const [row] = await withDb((sql) => sql`
    insert into cube_arena.code_submissions (version, display_name, model_name, model, model_id, effort, agent, harness, client, invite_id, credit)
    values (${CODE.version}, ${display}, ${labelOf(model, effort)}, ${model.name}, ${model.id}, ${effort}, ${harness === 'codex' ? 'codex' : 'claude'},
            ${harness}, ${client}, ${auth.role === 'invite' ? auth.invite.id : null}, ${credit})
    returning ${sql(COLUMNS)}`);
  return clean(row);
}

/** The runner is still coding. False once the code is in (or the submission was given up). */
export async function codeHeartbeat(id: string): Promise<boolean> {
  const rows = await withDb((sql) => sql`
    update cube_arena.code_submissions set updated_at = now() where id = ${id} and status = 'coding' returning id`);
  return rows.length > 0;
}

/**
 * Adds one coding session's tokens and cost (worked out from list prices when
 * the harness reports only tokens), and sets the total coding time so far.
 */
export async function saveCoding(id: string, usage: Usage, devMinutes: number | null): Promise<boolean> {
  return transaction(async (tx) => {
    const [row] = await tx<{ usage: Usage | null; model_id: string | null }[]>`
      select usage, model_id from cube_arena.code_submissions where id = ${id} for update`;
    if (!row) return false;
    let u = usage;
    if (u.cost_usd === undefined) {
      const cost = row.model_id ? listCost(catalogModel(row.model_id), u) : null;
      if (cost !== null) u = { ...u, cost_usd: cost };
    }
    const total: Record<string, number> = { ...(row.usage as Record<string, number> | null) };
    for (const [k, v] of Object.entries(u)) if (Number.isFinite(v)) total[k] = (total[k] ?? 0) + v;
    await tx`update cube_arena.code_submissions set usage = ${tx.json(total)}, updated_at = now(),
             dev_minutes = coalesce(${devMinutes}, dev_minutes) where id = ${id}`;
    return true;
  });
}

/**
 * Freezes the solver: a gzipped tar of solver/. Only once, while coding; the
 * submission then waits for the grader.
 */
export async function saveBundle(id: string, gz: Buffer): Promise<CodeSubmission> {
  if (gz.length > CODE.bundleMaxBytes) throw new ArenaError('too_big', `solver over ${CODE.bundleMaxBytes} bytes gzipped; build big tables in build.py instead`);
  let tar: Buffer;
  try {
    tar = gunzipSync(gz, { maxOutputLength: 64 * 1024 * 1024 });
  } catch {
    throw new ArenaError('bad_bundle', 'the solver must be a gzipped tar (unpacked under 64 MB)');
  }
  if (tar.length < 512 || tar.subarray(257, 262).toString('latin1') !== 'ustar') throw new ArenaError('bad_bundle', 'the solver must be a gzipped tar');
  const sha = createHash('sha256').update(gz).digest('hex');
  const [row] = await withDb((sql) => sql`
    update cube_arena.code_submissions
    set bundle = ${gz}, bundle_sha256 = ${sha}, bundle_bytes = ${gz.length}, status = 'queued', queued_at = now(), updated_at = now()
    where id = ${id} and status = 'coding'
    returning ${sql(COLUMNS)}`);
  if (!row) throw new ArenaError('frozen', 'That submission is not taking code any more (already in, or abandoned).');
  return clean(row);
}

export async function saveCodeTranscript(id: string, gz: Buffer): Promise<boolean> {
  if (gz.length > CODE_TRANSCRIPT_MAX_BYTES) throw new ArenaError('too_big', `transcript over ${CODE_TRANSCRIPT_MAX_BYTES} bytes gzipped`);
  const rows = await withDb((sql) => sql`update cube_arena.code_submissions set transcript_gz = ${gz} where id = ${id} returning id`);
  return rows.length > 0;
}

export async function codeFile(id: string, kind: 'bundle' | 'transcript'): Promise<Buffer | null> {
  if (!UUID.test(id)) return null;
  const [row] = await withDb((sql) =>
    kind === 'bundle'
      ? sql<{ gz: Buffer | null }[]>`select bundle as gz from cube_arena.code_submissions where id = ${id}`
      : sql<{ gz: Buffer | null }[]>`select transcript_gz as gz from cube_arena.code_submissions where id = ${id}`,
  );
  return row?.gz ?? null;
}

// ---------------------------------------------------------------------------
// The grader

export interface CodeJob {
  id: string;
  version: string;
  bundle_sha256: string;
  limits: typeof CODE;
  cases: { n: number; state: string }[];
}

/** Hands the oldest waiting submission to the grader (or one whose grading stalled), or null. */
export async function nextJob(): Promise<CodeJob | null> {
  return transaction(async (tx) => {
    const [row] = await tx<{ id: string; version: string; bundle_sha256: string }[]>`
      select id, version, bundle_sha256 from cube_arena.code_submissions
      where status = 'queued' or (status = 'grading' and lease_until < now())
      order by queued_at limit 1 for update skip locked`;
    if (!row) return null;
    if (row.version !== CODE.version) {
      await tx`update cube_arena.code_submissions set status = 'failed', error = ${`made for ${row.version}; this grader runs ${CODE.version}`} where id = ${row.id}`;
      return null;
    }
    await tx`update cube_arena.code_submissions set status = 'grading', lease_until = now() + ${LEASE}::interval, updated_at = now() where id = ${row.id}`;
    return { ...row, limits: CODE, cases: hiddenCases().map(({ n, state }) => ({ n, state })) };
  });
}

export interface JobReport {
  grader: string;
  build: { ok: boolean; ms: number; log: string };
  results: ({ n: number } & CaseRun)[];
}

/** Grades what the solver printed for each hidden cube and records the result. */
export async function finishJob(id: string, report: JobReport): Promise<CodeSubmission> {
  const cases = hiddenCases();
  const byN = new Map(report.results.map((r) => [r.n, r]));
  const outcomes = cases.map((c) => {
    const run = byN.get(c.n);
    if (!run) return { n: c.n, status: 'crash' as CaseStatus, moves: null, detail: report.build.ok ? 'not run' : 'the build failed', ms: null, output: null };
    const o = gradeCase(c.state, run);
    return { n: c.n, ...o, ms: Math.round(run.ms), output: run.stdout.slice(0, CODE.outputMaxBytes) };
  });
  const sum = summarize(outcomes);
  return transaction(async (tx) => {
    const [cur] = await tx<{ status: string }[]>`select status from cube_arena.code_submissions where id = ${id} for update`;
    if (cur?.status !== 'grading') throw new ArenaError('not_grading', `That submission is ${cur?.status ?? 'missing'}, not being graded.`);
    await tx`delete from cube_arena.code_results where submission_id = ${id}`;
    for (const o of outcomes) {
      await tx`insert into cube_arena.code_results (submission_id, case_no, status, moves, ms, output, detail)
               values (${id}, ${o.n}, ${o.status}, ${o.moves}, ${o.ms}, ${o.output}, ${o.detail})`;
    }
    const [row] = await tx`
      update cube_arena.code_submissions
      set status = 'graded', graded_at = now(), updated_at = now(), lease_until = null, grader = ${report.grader.slice(0, 200)},
          build_ok = ${report.build.ok}, build_ms = ${Math.round(report.build.ms)}, build_log = ${report.build.log.slice(-20_000)},
          cases = ${sum.cases}, solved = ${sum.solved}, score = ${sum.score}, mean_moves = ${sum.mean_moves}, mean_ms = ${sum.mean_ms}, error = null
      where id = ${id}
      returning ${tx(COLUMNS)}`;
    return clean(row);
  });
}

/** The grader could not run it at all (not the solver's fault): kept aside for the operator. */
export async function failJob(id: string, error: string): Promise<boolean> {
  const rows = await withDb((sql) => sql`
    update cube_arena.code_submissions set status = 'failed', error = ${error.slice(0, 2000)}, lease_until = null, updated_at = now()
    where id = ${id} and status = 'grading' returning id`);
  return rows.length > 0;
}

/** Operator: grade it again (after a grader fix). */
export async function requeue(id: string): Promise<boolean> {
  const rows = await withDb((sql) => sql`
    update cube_arena.code_submissions set status = 'queued', error = null, lease_until = null, updated_at = now()
    where id = ${id} and bundle is not null and status in ('graded', 'failed', 'grading') returning id`);
  return rows.length > 0;
}

export async function setCodeHidden(id: string, hidden: boolean, reason: string | null): Promise<boolean> {
  const rows = await withDb((sql) => sql`
    update cube_arena.code_submissions set hidden = ${hidden}, hidden_reason = ${hidden ? reason : null} where id = ${id} returning id`);
  return rows.length > 0;
}

/** A runner that went quiet before its code was in says nothing about the model: that submission is dropped from view. */
export async function sweepCode(): Promise<void> {
  await withDb((sql) => sql`
    update cube_arena.code_submissions
    set status = 'failed', hidden = true, hidden_reason = coalesce(hidden_reason, 'abandoned: the runner stopped before the code was in'),
        error = coalesce(error, 'abandoned while coding')
    where status = 'coding' and updated_at < now() - ${RUNNER_QUIET}::interval`);
}

/** Operator: recent submissions, hidden ones included. */
export async function listSubmissions(limit = 50): Promise<CodeSubmission[]> {
  const rows = await withDb((sql) => sql`
    select ${sql(COLUMNS)} from cube_arena.code_submissions order by created_at desc limit ${Math.min(Math.max(limit, 1), 200)}`);
  return rows.map(clean);
}

// ---------------------------------------------------------------------------
// The board

export interface CodeEntry {
  id: string;
  label: string;
  model: string;
  slug: string;
  effort: string | null;
  /** The model's top effort (catalog.ts topEffort): the ranking waits for a result at it. */
  top_effort: string | null;
  maker: string;
  color: string;
  status: CodeStatus;
  created_at: string;
  graded_at: string | null;
  cases: number | null;
  solved: number | null;
  score: number | null;
  mean_moves: number | null;
  mean_ms: number | null;
  dev_minutes: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  cost_estimated: boolean;
  bundle_bytes: number | null;
  bundle_sha256: string | null;
  build_ok: boolean | null;
  harness: string | null;
  run_by: string;
  contributor: { slug: string; name: string; x: string | null } | null;
}

async function codeEntriesQuery(): Promise<CodeEntry[]> {
  const rows = await withDb((sql) => sql<(CodeSubmission & { invite_name: string | null; invite_x: string | null })[]>`
    select ${sql(COLUMNS.map((c) => `s.${c}`))}, i.name as invite_name, i.x_handle as invite_x
    from cube_arena.code_submissions s left join cube_arena.invites i on i.id = s.invite_id
    where not s.hidden and s.status <> 'failed'
    order by s.created_at desc limit 500`);
  return rows.map((raw) => {
    const s = { ...clean(raw as never), invite_name: raw.invite_name, invite_x: raw.invite_x };
    const model = s.model ?? s.model_name;
    const maker = makerOf(model);
    const reported = s.usage?.cost_usd;
    const est = s.usage ? (estimateCost(s.model_id, s.usage) ?? catalogCost(s.model_id, s.usage)) : null;
    return {
      id: s.id,
      label: s.model_name,
      model,
      slug: s.model_id ?? slugOf(model),
      effort: s.effort,
      top_effort: topEffort(s.model_id ?? slugOf(model), model),
      maker: maker.name,
      color: maker.color,
      status: s.status,
      created_at: new Date(s.created_at).toISOString(),
      graded_at: s.graded_at ? new Date(s.graded_at).toISOString() : null,
      cases: s.cases,
      solved: s.solved,
      score: s.score,
      mean_moves: s.mean_moves,
      mean_ms: s.mean_ms,
      dev_minutes: s.dev_minutes,
      input_tokens: s.usage?.input_tokens ?? null,
      output_tokens: s.usage?.output_tokens ?? null,
      cost_usd: Number.isFinite(reported) ? (reported as number) : est,
      cost_estimated: !Number.isFinite(reported) && est !== null,
      bundle_bytes: s.bundle_bytes,
      bundle_sha256: s.bundle_sha256,
      build_ok: s.build_ok,
      harness: harnessLabel(s.harness ?? s.agent),
      run_by: !s.invite_id ? 'Cube Arena' : s.credit && s.invite_name ? s.invite_name : 'an invited tester',
      contributor: s.invite_id && s.credit && s.invite_name ? { slug: contributorSlug(s.invite_id, s.invite_x), name: s.invite_name, x: s.invite_x } : null,
    };
  });
}

const cachedCodeEntries = unstable_cache(codeEntriesQuery, ['cube-arena', 'codeEntries'], { revalidate: 30 });

/** Graded submissions, best first, then the ones still coding or waiting. */
export async function codeBoard(): Promise<{ graded: CodeEntry[]; pending: CodeEntry[] }> {
  const all = await cachedCodeEntries();
  return { graded: all.filter((e) => e.status === 'graded').sort(codeRank), pending: all.filter((e) => e.status !== 'graded') };
}

export async function codeEntry(id: string): Promise<CodeEntry | null> {
  if (!UUID.test(id)) return null;
  return (await cachedCodeEntries()).find((e) => e.id === id) ?? null;
}

/** Each hidden cube's outcome: status, moves and time, never the moves themselves. */
export async function codeCaseRows(id: string): Promise<{ case_no: number; status: CaseStatus; moves: number | null; ms: number | null; detail: string | null }[]> {
  if (!UUID.test(id)) return [];
  return withDb((sql) => sql<{ case_no: number; status: CaseStatus; moves: number | null; ms: number | null; detail: string | null }[]>`
    select case_no, status, moves, ms, detail from cube_arena.code_results where submission_id = ${id} order by case_no`);
}

/** Operator: the build log and each case's full answer. */
export async function codeGradingDetail(id: string): Promise<{ build_log: string | null; results: { case_no: number; status: string; output: string | null }[] } | null> {
  if (!UUID.test(id)) return null;
  return withDb(async (sql) => {
    const [s] = await sql<{ build_log: string | null }[]>`select build_log from cube_arena.code_submissions where id = ${id}`;
    if (!s) return null;
    const results = await sql<{ case_no: number; status: string; output: string | null }[]>`
      select case_no, status, output from cube_arena.code_results where submission_id = ${id} order by case_no`;
    return { build_log: s.build_log, results };
  });
}
