// Our writeups: model blogs, effort reviews (one suite), round reviews (one test run) and cube lines (one attempt).
// The comms worker writes them from /api/admin/comms facts and stores them through /api/admin/writeups; pages show
// the newest published version. Scores and ranks in them are placeholders filled in here with today's values.

import { bestPerModel, indexPool } from './aggregate';
import { type Tx, transaction, withDb } from './db';
import { fmtScore } from './format';
import { type SuiteEntry, suiteEntries } from './index-data';
import { SUITES, SUITE_KINDS } from './suites';

export type WriteupKind = 'blog' | 'effort' | 'round' | 'cube';
export const WRITEUP_KINDS: WriteupKind[] = ['blog', 'effort', 'round', 'cube'];

export interface Writeup {
  kind: WriteupKind;
  subject: string;
  version: number;
  body: string;
  status: 'published' | 'held' | 'withdrawn';
  writer: string | null;
  created_at: string;
}

export interface WriteupIn {
  kind: WriteupKind;
  subject: string;
  body: string;
  status?: 'published' | 'held';
  writer?: string | null;
  judge?: string | null;
  style?: string | null;
  drafts?: number | null;
  facts_hash?: string | null;
  problems?: unknown;
}

const row = (r: Writeup): Writeup => ({ ...r, created_at: new Date(r.created_at).toISOString() });

/** Stores a new version. Returns its version number. */
export async function saveWriteup(w: WriteupIn): Promise<number> {
  return transaction(async (tx: Tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${`${w.kind}:${w.subject}`}))`;
    const [{ v }] = await tx<{ v: number }[]>`select coalesce(max(version), 0) + 1 as v from cube_arena.writeups where kind = ${w.kind} and subject = ${w.subject}`;
    await tx`
      insert into cube_arena.writeups (kind, subject, version, body, status, writer, judge, style, drafts, facts_hash, problems)
      values (${w.kind}, ${w.subject}, ${v}, ${w.body}, ${w.status ?? 'published'}, ${w.writer ?? null}, ${w.judge ?? null}, ${w.style ?? null},
              ${w.drafts ?? null}, ${w.facts_hash ?? null}, ${w.problems === undefined ? null : tx.json(w.problems as never)})`;
    return v;
  });
}

/** Takes a version off the pages (the one before it shows again, if any). */
export async function withdrawWriteup(kind: WriteupKind, subject: string, version: number): Promise<boolean> {
  const rows = await withDb((sql) => sql`
    update cube_arena.writeups set status = 'withdrawn' where kind = ${kind} and subject = ${subject} and version = ${version} returning id`);
  return rows.length > 0;
}

/** The newest published writeup for each subject asked for. */
export async function latestWriteups(kind: WriteupKind, subjects: string[]): Promise<Map<string, Writeup>> {
  if (!subjects.length) return new Map();
  const rows = await withDb((sql) => sql<Writeup[]>`
    select distinct on (subject) kind, subject, version, body, status, writer, created_at
    from cube_arena.writeups where kind = ${kind} and subject = any(${sql.array(subjects)}) and status = 'published'
    order by subject, version desc`);
  return new Map(rows.map((r) => [r.subject, row(r)]));
}

export async function latestWriteup(kind: WriteupKind, subject: string): Promise<Writeup | null> {
  return (await latestWriteups(kind, [subject])).get(subject) ?? null;
}

/** Every published version of one writeup, newest first. */
export async function writeupHistory(kind: WriteupKind, subject: string): Promise<Writeup[]> {
  const rows = await withDb((sql) => sql<Writeup[]>`
    select kind, subject, version, body, status, writer, created_at from cube_arena.writeups
    where kind = ${kind} and subject = ${subject} and status = 'published' order by version desc`);
  return rows.map(row);
}

/** For the worker: what's stored for a subject (every status), so it knows what to write next. */
export async function writeupState(kind: WriteupKind, subjects: string[]) {
  if (!subjects.length) return [];
  return withDb((sql) => sql<{ subject: string; version: number; status: string; facts_hash: string | null; created_at: Date }[]>`
    select distinct on (subject) subject, version, status, facts_hash, created_at from cube_arena.writeups
    where kind = ${kind} and subject = any(${sql.array(subjects)}) order by subject, version desc`);
}

/** The newest published blog of each model, newest first, for /notes. */
export async function blogList(): Promise<Writeup[]> {
  const rows = await withDb((sql) => sql<Writeup[]>`
    select * from (
      select distinct on (subject) kind, subject, version, body, status, writer, created_at
      from cube_arena.writeups where kind = 'blog' and status = 'published' order by subject, version desc
    ) b order by created_at desc`);
  return rows.map(row);
}

const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

/** Today's value of every placeholder a writeup may use: {{score <suite id>}}, {{rank <slug> <kind>}}. */
export async function liveValues(entries?: SuiteEntry[]): Promise<Map<string, string>> {
  const es = entries ?? (await suiteEntries());
  const out = new Map<string, string>();
  for (const e of es) out.set(`{{score ${e.id}}}`, fmtScore(e.score));
  for (const k of SUITE_KINDS) {
    bestPerModel(indexPool(es, k, SUITES[k].version).ranked).forEach((e, i) => out.set(`{{rank ${e.slug} ${k}}}`, ordinal(i + 1)));
  }
  return out;
}

/** A writeup's title (a blog's "# " line) and its first paragraph, for lists. */
export function blogHead(body: string): { title: string; standfirst: string } {
  const lines = body.trim().split('\n').map((l) => l.trim());
  const title = (lines.find((l) => l.startsWith('# ')) ?? '').slice(2);
  const standfirst = lines.find((l) => l && !l.startsWith('#') && !l.startsWith('<?')) ?? '';
  return { title, standfirst };
}
