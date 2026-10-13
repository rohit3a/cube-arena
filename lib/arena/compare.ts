// Comparing 2-4 models side by side: everything the Index, the coding board
// and the attempts know about each, at one effort or its best. Built on the
// server for the picks in the URL (/compare?m=gpt-6-astra:max&m=...), so the
// page links and shares as it is.

import { averageByLabel } from './aggregate';
import { type CodeEntry, codeBoard } from './code';
import { codeRank } from './code-rules';
import { UUID, withDb } from './db';
import { type SuiteEntry, suiteEntries } from './index-data';
import { EFFORT_ORDER, effortRank } from './makers';
import { suiteOrder } from './ranking';
import { SUITES, type SuiteKind, suiteTests, testName } from './suites';

export const MAX_PICKS = 4;

/** One side of the comparison as the URL names it: a model, and an effort or null for its best. */
export interface Pick {
  slug: string;
  effort: string | null;
}

/** "gpt-6-astra:max" or "gpt-6-astra" (best effort); repeated, or comma-separated. */
export function parsePicks(m: string | string[] | undefined): Pick[] {
  const raw = (Array.isArray(m) ? m : m ? [m] : []).flatMap((x) => x.split(','));
  const out: Pick[] = [];
  for (const r of raw) {
    const [slug, effort] = r.trim().toLowerCase().split(':');
    if (!slug || !/^[a-z0-9.-]{1,80}$/.test(slug)) continue;
    const e = effort && EFFORT_ORDER.includes(effort) ? effort : null;
    if (!out.some((p) => p.slug === slug && p.effort === e)) out.push({ slug, effort: e });
    if (out.length === MAX_PICKS) break;
  }
  return out;
}

export const pickParam = (p: Pick) => (p.effort ? `${p.slug}:${p.effort}` : p.slug);

/** A model that can be picked: anything with a finished result on a board or the coding board. */
export interface ModelOption {
  slug: string;
  model: string;
  maker: string;
  color: string;
  board: 'verified' | 'community';
  /** Efforts it has any result at, low to high (empty: no effort setting). */
  efforts: string[];
}

/** Every try at one ladder level: the first is the same cube for every model. */
export interface LevelTries {
  level: number;
  tries: { status: string; moves: number; secs: number; attempt: string }[];
}

export interface TestDetail {
  test: string;
  name: string;
  /** Fast's 4×4 Gauntlet, played only after a perfect score on the other tests. */
  gauntlet: boolean;
  /** Ladder top, or null for a full scramble. */
  max: number | null;
  score: number | null;
  best_level: number | null;
  end_reason: string | null;
  levels: LevelTries[];
}

export interface SuiteSide {
  kind: SuiteKind;
  version: string;
  /** The average when this effort was run more than once. */
  avg: SuiteEntry;
  /** Each run at this effort, best first. */
  runs: { id: string; score: number | null; finished_at: string | null; run_by: string }[];
  /** Place among every model and effort on this board and version, and how many there are. */
  rank: number;
  of: number;
  /** The run the level-by-level detail comes from: the best. */
  detail_id: string;
  tests: TestDetail[];
}

export interface CodingSide {
  /** The best graded run at the effort shown, or at the model's best effort when it has none there. */
  best: CodeEntry;
  /** True when no run matched the effort shown, so this is the model's best at another. */
  other_effort: boolean;
  runs: CodeEntry[];
  mean_score: number | null;
  rank: number;
  of: number;
}

export interface Side {
  pick: Pick;
  slug: string;
  model: string;
  maker: string;
  color: string;
  board: 'verified' | 'community';
  /** The effort shown: the one asked for, or the one with its best Fast result. */
  effort: string | null;
  efforts: string[];
  fast: SuiteSide | null;
  thorough: SuiteSide | null;
  /** Fast score at every effort it has, for the effort curve. */
  curve: { effort: string; score: number; n: number }[];
  coding: CodingSide | null;
  /** Nothing found for this pick. */
  missing: boolean;
}

const finishedCurrent = (e: SuiteEntry) => e.status === 'finished' && e.version === SUITES[e.kind].version;

/** The models that can be picked, Verified first, then Community-only ones. */
export async function compareOptions(): Promise<ModelOption[]> {
  const [entries, code] = await Promise.all([suiteEntries(), codeBoard()]);
  const by = new Map<string, ModelOption>();
  const add = (slug: string, model: string, maker: string, color: string, board: 'verified' | 'community', effort: string | null) => {
    const prev = by.get(slug);
    if (prev && prev.board === 'verified' && board === 'community') return;
    const o = prev && prev.board === board ? prev : { slug, model, maker, color, board, efforts: [] };
    if (effort && !o.efforts.includes(effort)) o.efforts.push(effort);
    by.set(slug, o);
  };
  for (const e of entries.filter(finishedCurrent).sort((a, b) => (a.board === b.board ? 0 : a.board === 'verified' ? -1 : 1)))
    add(e.slug, e.model, e.maker, e.color, e.board, e.effort);
  for (const c of code.graded) add(c.slug, c.model, c.maker, c.color, 'verified', c.effort);
  for (const o of by.values()) o.efforts.sort((a, b) => effortRank(a) - effortRank(b));
  return [...by.values()].sort((a, b) => (a.board === b.board ? a.model.localeCompare(b.model) : a.board === 'verified' ? -1 : 1));
}

/** Everything about each pick. */
export async function compare(picks: Pick[]): Promise<Side[]> {
  if (picks.length === 0) return [];
  const [entries, code] = await Promise.all([suiteEntries(), codeBoard()]);
  const done = entries.filter(finishedCurrent);

  const sides = picks.map((pick) => {
    const mine = done.filter((e) => e.slug === pick.slug);
    const verified = mine.filter((e) => e.board === 'verified');
    const board: 'verified' | 'community' = verified.length || !mine.length ? 'verified' : 'community';
    const pool = board === 'verified' ? verified : mine;
    const coding = code.graded.filter((c) => c.slug === pick.slug);
    const any = pool[0] ?? coding[0];
    const efforts = [...new Set([...pool.map((e) => e.effort), ...coding.map((c) => c.effort)].filter((x): x is string => !!x))].sort(
      (a, b) => effortRank(a) - effortRank(b),
    );

    // Fast at each effort (averaged), for the curve and to find the best effort.
    const fastByEffort = averageByLabel(pool.filter((e) => e.kind === 'fast')).sort(suiteOrder);
    const effort = pick.effort ?? fastByEffort[0]?.effort ?? [...coding].sort(codeRank)[0]?.effort ?? efforts.at(-1) ?? null;
    const atEffort = (e: { effort: string | null }) => e.effort === effort || (effort === null && e.effort === null);

    return {
      pick,
      slug: pick.slug,
      model: any?.model ?? pick.slug,
      maker: any?.maker ?? '',
      color: any?.color ?? 'var(--slate)',
      board,
      effort,
      efforts,
      fast: null as SuiteSide | null,
      thorough: null as SuiteSide | null,
      curve: fastByEffort
        .filter((e) => e.effort)
        .map((e) => ({ effort: e.effort as string, score: e.score ?? 0, n: e.n }))
        .sort((a, b) => effortRank(a.effort) - effortRank(b.effort)),
      coding: coding.some(atEffort)
        ? codingSide(coding.filter(atEffort).sort(codeRank), code.graded, false)
        : codingSide(coding.filter((c) => c.effort === [...coding].sort(codeRank)[0]?.effort).sort(codeRank), code.graded, true),
      missing: !any,
      _suites: (kind: SuiteKind) => pool.filter((e) => e.kind === kind && atEffort(e)),
      _board: (kind: SuiteKind) => averageByLabel(done.filter((e) => e.kind === kind && e.board === board)).sort(suiteOrder),
    };
  });

  // Level-by-level detail for the best run of each side, in one query.
  const kinds: SuiteKind[] = ['fast', 'thorough'];
  const best = new Map<string, SuiteEntry>();
  for (const s of sides)
    for (const k of kinds) {
      const b = [...s._suites(k)].sort(suiteOrder)[0];
      if (b) best.set(`${s.slug}|${s.effort}|${k}`, b);
    }
  const levels = await levelDetail([...best.values()].map((e) => e.id));

  return sides.map(({ _suites, _board, ...s }) => {
    for (const k of kinds) {
      const runs = _suites(k);
      const b = best.get(`${s.slug}|${s.effort}|${k}`);
      if (!b) continue;
      const [avg] = averageByLabel(runs);
      const board = _board(k);
      const at = board.findIndex((e) => e.label === avg.label);
      s[k] = {
        kind: k,
        version: SUITES[k].version,
        avg,
        runs: [...runs].sort(suiteOrder).map((e) => ({ id: e.id, score: e.score, finished_at: e.finished_at, run_by: e.contributor?.name ?? e.run_by[0] })),
        rank: at + 1,
        of: board.length,
        detail_id: b.id,
        tests: testDetail(b, levels.get(b.id) ?? []),
      };
    }
    return s;
  });
}

function codingSide(mine: CodeEntry[], all: CodeEntry[], other_effort: boolean): CodingSide | null {
  if (!mine.length) return null;
  const scores = mine.map((c) => c.score).filter((x): x is number => x !== null);
  const ranked = [...all].sort(codeRank);
  return {
    best: mine[0],
    other_effort,
    runs: mine,
    mean_score: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
    rank: ranked.findIndex((c) => c.id === mine[0].id) + 1,
    of: ranked.length,
  };
}

interface AttemptRow {
  suite_id: string;
  slot: number;
  attempt: string;
  level: number | null;
  status: string;
  moves: number;
  secs: number;
}

async function levelDetail(ids: string[]): Promise<Map<string, AttemptRow[]>> {
  const out = new Map<string, AttemptRow[]>();
  const ok = ids.filter((id) => UUID.test(id));
  if (!ok.length) return out;
  const rows = await withDb(
    (sql) => sql<AttemptRow[]>`
      select r.suite_id, r.suite_slot as slot, a.id as attempt, a.level, a.status, a.move_count as moves,
             extract(epoch from (coalesce(a.finished_at, now()) - a.created_at))::int as secs
      from cube_arena.attempts a join cube_arena.runs r on r.id = a.run_id
      where r.suite_id = any(${sql.array(ok)}::uuid[]) and not r.hidden
      order by r.suite_slot, a.seq`,
  );
  for (const r of rows) out.set(r.suite_id, [...(out.get(r.suite_id) ?? []), r]);
  return out;
}

function testDetail(e: SuiteEntry, rows: AttemptRow[]): TestDetail[] {
  const def = SUITES[e.kind];
  return suiteTests(def).map((t) => {
    const mine = rows.filter((r) => t.slots.includes(r.slot));
    const runs = e.runs.filter((r) => t.slots.includes(r.slot));
    const byLevel = new Map<number, LevelTries>();
    for (const r of mine) {
      const level = r.level ?? 0;
      const l = byLevel.get(level) ?? { level, tries: [] };
      l.tries.push({ status: r.status, moves: r.moves, secs: r.secs, attempt: r.attempt });
      byLevel.set(level, l);
    }
    return {
      test: t.test,
      name: testName(t).name,
      gauntlet: t.gauntlet,
      max: t.challenge === 'ladder' ? t.levels : null,
      score: e.tests.find((x) => x.test === t.test)?.score ?? null,
      best_level: runs.length ? Math.max(...runs.map((r) => r.best_level)) : null,
      end_reason: runs[0]?.end_reason ?? null,
      levels: [...byLevel.values()].sort((a, b) => a.level - b.level),
    };
  });
}
