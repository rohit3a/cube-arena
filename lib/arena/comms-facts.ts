// Facts for Cube Arena comms: what a writeup may say about a suite or a model, all from our own data, for the
// writer that turns them into model blogs, effort and round reviews and one line per cube. Operator only
// (app/api/admin/comms). Numbers that can change later (a suite's score, a model's rank) come with a
// placeholder key ({{score <suite id>}}, {{rank <slug> <kind>}}) that pages fill in live; everything else is fixed.

import { gunzipSync } from 'node:zlib';
import { bestPerModel, indexPool } from './aggregate';
import { catalogModel } from './catalog';
import { type AttemptRow, type Review, type RunRow, withDb } from './db';
import { type SuiteEntry, suiteEntries } from './index-data';
import { effortRank } from './makers';
import { levelDepth, topLevel } from './rules';
import { SUITES, type SuiteKind, suiteTests, testName, testWeights } from './suites';

export interface Live {
  /** The placeholder a piece writes to cite this number; pages fill in its current value. */
  key: string;
  value: number | null;
}

export interface LogLine {
  /** Seconds from the start of its session. */
  t: number;
  session: number;
  kind: 'call' | 'result' | 'say' | 'think' | 'error';
  tool?: string;
  text: string;
}

export interface CubeFacts {
  attempt_id: string;
  seq: number;
  /** Ladder level, or null for a full scramble. */
  level: number | null;
  /** How many random moves from solved the cube was (ladders); the inverse of those solves it. */
  depth: number | null;
  status: string;
  detail: string | null;
  moves: string[];
  move_count: number;
  move_cap: number;
  turns: number;
  looks: number;
  invalid: number;
  /** Time on this cube, any pause of ours left out. */
  secs: number | null;
  paused_secs: number;
  /** The scramble, once the cube is over (replays show it too). */
  scramble: string | null;
  replay: string;
  /** This cube's part of the transcript: calls with their arguments, short results, what the model said. */
  log: LogLine[];
}

export interface RoundFacts {
  run_id: string;
  slot: number;
  test: string;
  name: string;
  /** Share of the suite score, 0-1, under the current weights. */
  weight: number;
  size: number;
  mode: string;
  challenge: string;
  gauntlet: boolean;
  top_level: number | null;
  status: string;
  end_reason: string | null;
  best_level: number;
  lives_left: number;
  solves: number;
  attempts: number;
  secs: number;
  moves: number;
  cost_usd: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  out_of_output: boolean;
  /** How many agent sessions played it (more than one: a fresh session picked the cube up after an API error). */
  sessions: number;
  cubes: CubeFacts[];
}

export interface FieldRow {
  label: string;
  slug: string;
  effort: string | null;
  suite_id: string;
  score: Live;
  /** Best level (ladders) or solved cubes (full scrambles), by test. */
  tests: Record<string, { best: number; of: number } | null>;
  this: boolean;
}

export interface SuiteFacts {
  suite: {
    id: string;
    kind: SuiteKind;
    version: string;
    board: string;
    label: string;
    model: string;
    slug: string;
    effort: string | null;
    top_effort: string | null;
    maker: string;
    harness: string | null;
    run_by: string[];
    status: string;
    created_at: string;
    finished_at: string | null;
    gauntlet: string | null;
    score: Live;
    /** Where the model stands on the Index (its best result, not necessarily this one). */
    model_rank: Live | null;
    ranked_models: number;
    moves: number;
    solved: number;
    moves_per_solve: number | null;
    secs: number;
    cost_usd: number | null;
    cost_estimated: boolean;
    input_tokens: number | null;
    output_tokens: number | null;
  };
  /** The same model's results at every effort, this suite's kind and version. */
  efforts: { effort: string | null; suite_id: string; score: Live; gauntlet: string | null; secs: number; cost_usd: number | null; this: boolean }[];
  /** Every model on the Index for this kind and version, at its best, in Index order. */
  field: FieldRow[];
  tests: { test: string; name: string; weight: number; gauntlet: boolean; levels: number }[];
  rounds: RoundFacts[];
  /** Things we did that a reader must not take for the model's doing (a pause, a test picked up again). */
  notes: string[];
}

export interface ModelFacts {
  model: string;
  slug: string;
  maker: string;
  catalog: { name: string; efforts: string[]; price: unknown } | null;
  rank: Live | null;
  ranked_models: number;
  /** Every finished Verified suite of this model, newest first, summed up (each one's own facts carry the detail). */
  suites: Omit<SuiteFacts, 'field' | 'rounds'>[];
  field: FieldRow[];
}

const scoreKey = (suiteId: string) => `{{score ${suiteId}}}`;
const rankKey = (slug: string, kind: SuiteKind) => `{{rank ${slug} ${kind}}}`;

function short(text: string): string {
  // Results repeat the cube's header and how to play; the first lines say what happened.
  const lines = text.split('\n').filter((l) => l.trim() && !/^(Turn the cube with|Look at it|Cube Arena ·|attempt_id:)/.test(l));
  return lines.slice(0, 2).join(' ').slice(0, 240);
}

/** The run's transcript, split by cube: every call names its attempt, and a result names the next one. */
function splitLog(digest: unknown, attemptIds: string[]): Map<string, LogLine[]> {
  const out = new Map<string, LogLine[]>(attemptIds.map((id) => [id, []]));
  if (!digest || typeof digest !== 'object') return out;
  const d = digest as { sessions?: unknown[]; events?: unknown[] };
  const sessions = (Array.isArray(d.sessions) ? d.sessions : [d]) as { events?: { t: number; kind: string; tool?: string; text?: string }[] }[];
  const known = new Set(attemptIds);
  sessions.forEach((s, si) => {
    let current: string | null = null;
    for (const e of s.events ?? []) {
      const text = e.text ?? '';
      const named = text.match(/attempt_id"?\s*[:=]\s*"?([0-9a-f-]{36})/)?.[1];
      if (e.kind === 'call' && named && known.has(named)) current = named;
      const line: LogLine = { t: e.t, session: si + 1, kind: e.kind as LogLine['kind'], ...(e.tool ? { tool: e.tool } : {}), text: e.kind === 'result' ? short(text) : text.slice(0, 600) };
      if (current) out.get(current)?.push(line);
      // A result that hands over the next cube: what follows belongs to it.
      if (e.kind === 'result' && named && known.has(named) && named !== current) current = named;
    }
  });
  return out;
}

const live = (key: string, value: number | null): Live => ({ key, value });

function fieldOf(entries: SuiteEntry[], kind: SuiteKind, version: string, thisId: string | null, runsBySuite: Map<string, RunRow[]>): FieldRow[] {
  const ranked = bestPerModel(indexPool(entries, kind, version).ranked);
  const tests = suiteTests(SUITES[kind]);
  return ranked.map((e) => {
    const runs = runsBySuite.get(e.id) ?? [];
    const per: FieldRow['tests'] = {};
    for (const t of tests) {
      const rs = runs.filter((r) => t.slots.includes(r.suite_slot ?? -1));
      per[t.test] = rs.length ? { best: t.challenge === 'ladder' ? Math.max(...rs.map((r) => r.best_level)) : rs.reduce((a, r) => a + r.solves, 0), of: t.challenge === 'ladder' ? t.levels : t.slots.length } : null;
    }
    return { label: e.label, slug: e.slug, effort: e.effort, suite_id: e.id, score: live(scoreKey(e.id), e.score), tests: per, this: e.ids.includes(thisId ?? '') };
  });
}

function rankOf(entries: SuiteEntry[], slug: string, kind: SuiteKind, version: string): { rank: Live | null; of: number } {
  const ranked = bestPerModel(indexPool(entries, kind, version).ranked);
  const i = ranked.findIndex((e) => e.slug === slug);
  return { rank: i >= 0 ? live(rankKey(slug, kind), i + 1) : null, of: ranked.length };
}

async function runsOf(suiteIds: string[]): Promise<Map<string, RunRow[]>> {
  const out = new Map<string, RunRow[]>();
  if (!suiteIds.length) return out;
  const rows = await withDb((sql) => sql<RunRow[]>`select * from cube_arena.runs where suite_id = any(${sql.array(suiteIds)}::uuid[]) order by suite_slot`);
  for (const r of rows) out.set(r.suite_id as string, [...(out.get(r.suite_id as string) ?? []), r]);
  return out;
}

function summary(e: SuiteEntry, entries: SuiteEntry[]): Omit<SuiteFacts, 'field' | 'rounds' | 'notes'> {
  const def = SUITES[e.kind];
  const weights = testWeights(def);
  // A Community result isn't on the Index, and isn't one of the model's efforts that we ran.
  const community = e.board === 'community';
  const { rank, of } = community ? { rank: null, of: rankOf(entries, e.slug, e.kind, e.version).of } : rankOf(entries, e.slug, e.kind, e.version);
  const mine = community
    ? []
    : entries
        .filter((x) => x.slug === e.slug && x.kind === e.kind && x.version === e.version && x.status === 'finished' && x.board === 'verified')
        .sort((a, b) => effortRank(a.effort) - effortRank(b.effort));
  return {
    suite: {
      id: e.id,
      kind: e.kind,
      version: e.version,
      board: e.board,
      label: e.label,
      model: e.model,
      slug: e.slug,
      effort: e.effort,
      top_effort: e.top_effort,
      maker: e.maker,
      harness: e.harness,
      run_by: e.run_by,
      status: e.status,
      created_at: e.created_at,
      finished_at: e.finished_at,
      gauntlet: e.gauntlet,
      score: live(scoreKey(e.id), e.score),
      model_rank: rank,
      ranked_models: of,
      moves: e.moves,
      solved: e.solved,
      moves_per_solve: e.moves_per_solve,
      secs: e.secs,
      cost_usd: e.cost_usd,
      cost_estimated: e.cost_estimated,
      input_tokens: e.input_tokens,
      output_tokens: e.output_tokens,
    },
    efforts: mine.map((x) => ({ effort: x.effort, suite_id: x.id, score: live(scoreKey(x.id), x.score), gauntlet: x.gauntlet, secs: x.secs, cost_usd: x.cost_usd, this: x.id === e.id })),
    tests: suiteTests(def).map((t) => ({ test: t.test, name: testName(t).name, weight: weights.get(t.test) ?? 0, gauntlet: t.gauntlet, levels: t.levels })),
  };
}

/** Everything about one suite, down to each cube's part of the transcript. Null if it isn't on the site. */
export async function suiteFacts(id: string): Promise<SuiteFacts | null> {
  const entries = await suiteEntries();
  const e = entries.find((x) => x.id === id);
  if (!e) return null;
  const def = SUITES[e.kind];
  const weights = testWeights(def);
  const field = entries.filter((x) => x.kind === e.kind && x.version === e.version);
  const runsBySuite = await runsOf([...new Set([...bestPerModel(indexPool(field, e.kind, e.version).ranked).flatMap((x) => x.ids), id])]);
  const runs = runsBySuite.get(id) ?? [];
  const runIds = runs.map((r) => r.id);
  const [attempts, transcripts] = await withDb((sql) =>
    Promise.all([
      runIds.length ? sql<AttemptRow[]>`select * from cube_arena.attempts where run_id = any(${sql.array(runIds)}::uuid[]) order by run_id, seq` : [],
      runIds.length ? sql<{ run_id: string; gz: Buffer }[]>`select run_id, gz from cube_arena.transcripts where run_id = any(${sql.array(runIds)}::uuid[])` : [],
    ]),
  );
  const digests = new Map(transcripts.map((t) => [t.run_id, JSON.parse(gunzipSync(t.gz).toString('utf8'))]));
  const notes: string[] = [];

  const rounds: RoundFacts[] = runs.map((r) => {
    const slot = def.slots[r.suite_slot ?? 0];
    const mine = attempts.filter((a) => a.run_id === r.id);
    const digest = digests.get(r.id);
    const logs = splitLog(digest, mine.map((a) => a.id));
    const sessions = digest ? (Array.isArray(digest.sessions) ? digest.sessions.length : 1) : 0;
    const info = e.runs.find((x) => x.run_id === r.id);
    const name = testName(slot).name;
    if (sessions > 1) notes.push(`${name}: played over ${sessions} sessions. A session ended by an API error or by us is not the model's doing; the next one picked the same cube up where it was.`);
    for (const a of mine.filter((x) => x.paused_secs > 0)) {
      notes.push(`${name}, level ${a.level}: ${Math.round(a.paused_secs / 60)} min of this cube's time was not the model's doing (a pause of ours, or sessions lost to API errors). It is left out of every time shown, and the model lost nothing by it.`);
    }
    const u = r.usage as Record<string, number> | null;
    return {
      run_id: r.id,
      slot: r.suite_slot ?? 0,
      test: slot.test,
      name,
      weight: weights.get(slot.test) ?? 0,
      size: r.size,
      mode: r.mode,
      challenge: r.challenge,
      gauntlet: !!slot.gauntlet,
      top_level: r.challenge === 'ladder' ? topLevel(r) : null,
      status: r.status,
      end_reason: r.end_reason,
      best_level: r.best_level,
      lives_left: r.lives,
      solves: r.solves,
      attempts: mine.length,
      secs: info?.secs ?? 0,
      moves: info?.moves ?? 0,
      cost_usd: u?.cost_usd ?? null,
      input_tokens: u?.input_tokens ?? null,
      output_tokens: u?.output_tokens ?? null,
      out_of_output: info?.out_of_output != null,
      sessions,
      cubes: mine.map((a) => ({
        attempt_id: a.id,
        seq: a.seq,
        level: a.level,
        depth: a.level === null ? null : levelDepth(r, a.level),
        status: a.status,
        detail: a.detail,
        moves: a.moves,
        move_count: a.move_count,
        move_cap: a.move_cap,
        turns: a.turns,
        looks: a.looks,
        invalid: a.invalid,
        secs: a.finished_at ? Math.round((new Date(a.finished_at).getTime() - new Date(a.created_at).getTime()) / 1000) - a.paused_secs : null,
        paused_secs: a.paused_secs,
        scramble: a.status === 'active' ? null : a.scramble,
        replay: `/replay/${a.id}`,
        log: logs.get(a.id) ?? [],
      })),
    };
  });

  return { ...summary(e, entries), field: fieldOf(field, e.kind, e.version, id, runsBySuite), rounds, notes };
}

/** One model across its Verified suites, for its blog. Null if it has none finished. */
export async function modelFacts(slug: string): Promise<ModelFacts | null> {
  const entries = await suiteEntries();
  const mine = entries
    .filter((x) => x.slug === slug && x.board === 'verified' && x.status === 'finished')
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  if (!mine.length) return null;
  const { kind, version } = mine[0];
  const field = entries.filter((x) => x.kind === kind && x.version === version);
  const runsBySuite = await runsOf(bestPerModel(indexPool(field, kind, version).ranked).flatMap((x) => x.ids));
  const { rank, of } = rankOf(entries, slug, kind, version);
  const cat = catalogModel(slug);
  return {
    model: mine[0].model,
    slug,
    maker: mine[0].maker,
    catalog: cat ? { name: cat.name, efforts: cat.efforts, price: cat.price ?? null } : null,
    rank,
    ranked_models: of,
    suites: mine.map((e) => ({ ...summary(e, entries), notes: [] })),
    field: fieldOf(field, kind, version, null, runsBySuite),
  };
}

export interface WorkSuite {
  id: string;
  kind: SuiteKind;
  version: string;
  board: 'verified' | 'community';
  review: Review;
  slug: string;
  model: string;
  effort: string | null;
  status: 'active' | 'finished';
  score: number | null;
  finished_at: string | null;
  gauntlet: SuiteEntry['gauntlet'];
  /** Finished, with no Gauntlet waiting or being played: nothing more will change, so its review can be written. */
  done: boolean;
  /** Each run with its finished cubes (attempt ids, in play order). */
  runs: { run_id: string; slot: number; status: string; attempts: string[] }[];
}

/** Everything the comms worker may write about: every suite on the site, its runs and their finished cubes. */
export async function workList(): Promise<WorkSuite[]> {
  const entries = await suiteEntries();
  if (!entries.length) return [];
  const rows = await withDb((sql) => sql<{ run_id: string; id: string }[]>`
    select a.run_id, a.id from cube_arena.attempts a join cube_arena.runs r on r.id = a.run_id
    where r.suite_id = any(${sql.array(entries.map((e) => e.id))}::uuid[]) and a.finished_at is not null
    order by a.run_id, a.seq`);
  const byRun = new Map<string, string[]>();
  for (const r of rows) byRun.set(r.run_id, [...(byRun.get(r.run_id) ?? []), r.id]);
  return entries.map((e) => ({
    id: e.id,
    kind: e.kind,
    version: e.version,
    board: e.board,
    review: e.review,
    slug: e.slug,
    model: e.model,
    effort: e.effort,
    status: e.status,
    score: e.score,
    finished_at: e.finished_at,
    gauntlet: e.gauntlet,
    done: e.status === 'finished' && (e.gauntlet === null || e.gauntlet === 'locked' || e.gauntlet === 'done'),
    runs: e.runs.map((r) => ({ run_id: r.run_id, slot: r.slot, status: r.status, attempts: byRun.get(r.run_id) ?? [] })),
  }));
}
