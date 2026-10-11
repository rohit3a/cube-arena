// Operator moderation (list, hide, rename runs and suites; invites; audit
// transcripts), plus the few calls an invitee's runner may make on its own
// suites. Reached through app/api/admin/*.

import { catalogModel, listCost } from './catalog';
import { clientLabel } from './clients';
import { type SuiteRow, type Usage, UUID, transaction, withDb } from './db';
import { formatCode, hashCode, newCode } from './invites';
import { gradeSuites } from './suite-data';
import type { SuiteGrade } from './suites';

export interface AdminRun {
  id: string;
  created_at: Date;
  board: string;
  model_name: string;
  display_name: string;
  tool_use: string;
  size: number;
  mode: string;
  challenge: string;
  status: string;
  best_level: number;
  solves: number;
  via: string;
  hidden: boolean;
  hidden_reason: string | null;
  suite_id: string | null;
  suite_slot: number | null;
}

const COLUMNS = [
  'id', 'created_at', 'board', 'model_name', 'display_name', 'tool_use', 'size', 'mode', 'challenge', 'status', 'best_level', 'solves', 'client',
  'hidden', 'hidden_reason', 'suite_id', 'suite_slot',
];

export async function listRuns(limit: number, onlyHidden: boolean): Promise<AdminRun[]> {
  const rows = await withDb((sql) => sql<(AdminRun & { client: string | null })[]>`
    select ${sql(COLUMNS)} from cube_arena.runs where (${onlyHidden}::boolean = false or hidden) order by created_at desc limit ${limit}`);
  return rows.map(({ client, ...r }) => ({ ...r, via: clientLabel(client) }));
}

/** Changes the run that `id` names (a run id or any of its attempt ids). */
async function change(id: string, set: Partial<Pick<AdminRun, 'hidden' | 'hidden_reason' | 'model_name'>>): Promise<AdminRun | null> {
  if (!UUID.test(id)) return null;
  const [row] = await withDb((sql) => sql<(AdminRun & { client: string | null })[]>`
    update cube_arena.runs set ${sql(set)}
    where id = coalesce((select run_id from cube_arena.attempts where id = ${id}), ${id}::uuid)
    returning ${sql(COLUMNS)}`);
  if (!row) return null;
  const { client, ...r } = row;
  return { ...r, via: clientLabel(client) };
}

/**
 * Hides or unhides a run (by run or attempt id) or a whole suite (by suite id).
 * Part of a suite hides all of it: a suite score without some of its tests
 * would be wrong.
 */
export async function setHidden(id: string, hidden: boolean, reason: string | null): Promise<AdminRun | null> {
  if (!UUID.test(id)) return null;
  const why = hidden ? reason : null;
  const suiteId = await withDb(async (sql) => {
    const [row] = await sql<{ suite_id: string }[]>`
      select id as suite_id from cube_arena.suites where id = ${id}
      union all
      select suite_id from cube_arena.runs
      where suite_id is not null and id = coalesce((select run_id from cube_arena.attempts where id = ${id}), ${id}::uuid)
      limit 1`;
    return row?.suite_id ?? null;
  });
  if (!suiteId) return change(id, { hidden, hidden_reason: why });
  await transaction(async (tx) => {
    await tx`update cube_arena.suites set hidden = ${hidden}, hidden_reason = ${why} where id = ${suiteId}`;
    await tx`update cube_arena.runs set hidden = ${hidden}, hidden_reason = ${why} where suite_id = ${suiteId}`;
  });
  const [first] = await withDb((sql) => sql<(AdminRun & { client: string | null })[]>`
    select ${sql(COLUMNS)} from cube_arena.runs where suite_id = ${suiteId} order by suite_slot limit 1`);
  if (!first) return null;
  const { client, ...r } = first;
  return { ...r, via: clientLabel(client) };
}

/**
 * Records the tokens and cost the runner measured for a run. Without a cost
 * (Codex counts only tokens), it is worked out from the suite model's list price.
 */
export async function setUsage(id: string, usage: Usage): Promise<boolean> {
  if (!UUID.test(id)) return false;
  return withDb(async (sql) => {
    let u = usage;
    if (u.cost_usd === undefined) {
      const [s] = await sql<{ model_id: string | null }[]>`
        select s.model_id from cube_arena.runs r join cube_arena.suites s on s.id = r.suite_id where r.id = ${id}`;
      const cost = s?.model_id ? listCost(catalogModel(s.model_id), u) : null;
      if (cost !== null) u = { ...u, cost_usd: cost };
    }
    const rows = await sql`update cube_arena.runs set usage = ${sql.json(u as Record<string, number>)} where id = ${id} returning id`;
    return rows.length > 0;
  });
}

export interface AdminSuite extends SuiteRow {
  grade: SuiteGrade | null;
  /** Slots that have a run (started or finished). */
  slots_played?: number[];
}

/** Recent suites; only one invite's when `inviteId` is given. */
export async function listSuites(limit: number, inviteId?: string): Promise<AdminSuite[]> {
  return withDb(async (sql) => {
    const suites = await sql<SuiteRow[]>`
      select * from cube_arena.suites where (${inviteId ?? null}::uuid is null or invite_id = ${inviteId ?? null}::uuid)
      order by created_at desc limit ${limit}`;
    const grades = await gradeSuites(sql, suites);
    return suites.map((s) => ({ ...s, grade: grades.get(s.id) ?? null }));
  });
}

export async function getSuite(id: string): Promise<AdminSuite | null> {
  if (!UUID.test(id)) return null;
  return withDb(async (sql) => {
    const [suite] = await sql<SuiteRow[]>`select * from cube_arena.suites where id = ${id}`;
    if (!suite) return null;
    const slots = await sql<{ suite_slot: number }[]>`select suite_slot from cube_arena.runs where suite_id = ${id} and status = 'finished'`;
    return { ...suite, grade: (await gradeSuites(sql, [suite])).get(suite.id) ?? null, slots_played: slots.map((r) => r.suite_slot) };
  });
}

/** Fixes a run's model name, e.g. a vague "GPT-6" once we know it was GPT-6-Astra. */
export const rename = (id: string, modelName: string) => change(id, { model_name: modelName });

/**
 * The suite a suite, run or attempt id belongs to, and the invite it was made
 * under (null for the operator's own). Null when the id names nothing.
 */
export async function suiteOf(id: string): Promise<{ suiteId: string | null; inviteId: string | null } | null> {
  if (!UUID.test(id)) return null;
  const [row] = await withDb((sql) => sql<{ suite_id: string | null; invite_id: string | null }[]>`
    select s.id as suite_id, s.invite_id from cube_arena.suites s where s.id = ${id}
    union all
    select r.suite_id, s.invite_id from cube_arena.runs r left join cube_arena.suites s on s.id = r.suite_id
    where r.id = coalesce((select run_id from cube_arena.attempts where id = ${id}), ${id}::uuid)
    limit 1`);
  return row ? { suiteId: row.suite_id, inviteId: row.invite_id } : null;
}

// ---------------------------------------------------------------------------
// Invites

export interface AdminInvite {
  id: string;
  created_at: Date;
  name: string;
  note: string | null;
  code_hint: string;
  expires_at: Date | null;
  revoked_at: Date | null;
  last_used_at: Date | null;
  x_handle: string | null;
  suites: number;
  finished: number;
}

export async function listInvites(): Promise<AdminInvite[]> {
  return withDb((sql) => sql<AdminInvite[]>`
    select i.id, i.created_at, i.name, i.note, i.code_hint, i.expires_at, i.revoked_at, i.last_used_at, i.x_handle,
           count(s.id)::int as suites, count(s.id) filter (where s.status = 'finished' and not s.hidden)::int as finished
    from cube_arena.invites i left join cube_arena.suites s on s.invite_id = i.id
    group by i.id order by i.created_at desc`);
}

/** Makes an invite and returns its code: the only time the code is shown. */
export async function createInvite(name: string, note: string | null, expiresAt: Date | null): Promise<{ invite: AdminInvite; code: string }> {
  const code = newCode();
  const [row] = await withDb((sql) => sql<AdminInvite[]>`
    insert into cube_arena.invites (name, note, code_hash, code_hint, expires_at)
    values (${name}, ${note}, ${hashCode(code)}, ${code.slice(-2)}, ${expiresAt})
    returning id, created_at, name, note, code_hint, expires_at, revoked_at, last_used_at, x_handle, 0 as suites, 0 as finished`);
  return { invite: row, code: formatCode(code) };
}

/** A new code for the same person; the old one stops working. */
export async function rotateInvite(id: string): Promise<string | null> {
  if (!UUID.test(id)) return null;
  const code = newCode();
  const rows = await withDb((sql) => sql`
    update cube_arena.invites set code_hash = ${hashCode(code)}, code_hint = ${code.slice(-2)}, revoked_at = null where id = ${id} returning id`);
  return rows.length ? formatCode(code) : null;
}

/** Stops a code working; optionally hides every suite made with it. Returns how many suites were hidden. */
export async function revokeInvite(id: string, hideSuites: boolean): Promise<number | null> {
  if (!UUID.test(id)) return null;
  return transaction(async (tx) => {
    const rows = await tx`update cube_arena.invites set revoked_at = coalesce(revoked_at, now()) where id = ${id} returning id`;
    if (!rows.length) return null;
    await tx`update cube_arena.claims set released_at = now() where invite_id = ${id} and released_at is null`;
    if (!hideSuites) return 0;
    const why = 'invite revoked';
    const suites = await tx`update cube_arena.suites set hidden = true, hidden_reason = ${why} where invite_id = ${id} and not hidden returning id`;
    await tx`update cube_arena.runs set hidden = true, hidden_reason = ${why}
             where suite_id in (select id from cube_arena.suites where invite_id = ${id})`;
    return suites.length;
  });
}

// ---------------------------------------------------------------------------
// Audit transcripts: gzipped JSON digests of each test session, no pictures.

export const TRANSCRIPT_MAX_BYTES = 512 * 1024;

export async function saveTranscript(runId: string, gz: Buffer): Promise<boolean> {
  if (!UUID.test(runId)) return false;
  const rows = await withDb((sql) => sql`
    insert into cube_arena.transcripts (run_id, bytes, gz) values (${runId}, ${gz.length}, ${gz})
    on conflict (run_id) do update set gz = excluded.gz, bytes = excluded.bytes, created_at = now()
    returning run_id`);
  return rows.length > 0;
}

export async function getTranscript(runId: string): Promise<Buffer | null> {
  if (!UUID.test(runId)) return null;
  const [row] = await withDb((sql) => sql<{ gz: Buffer }[]>`select gz from cube_arena.transcripts where run_id = ${runId}`);
  return row?.gz ?? null;
}
