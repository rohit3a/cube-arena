// Read-only queries for the site: leaderboards, stats, feeds, replays.
//
// The database is shared with other KRNL apps, so page reads are cached for a
// few seconds across all servers: a traffic spike costs a handful of queries,
// not one per visitor. Cached values round-trip through JSON, so dates arrive
// as strings (the UI always wraps them in new Date()).

import { unstable_cache } from 'next/cache';
import { cache } from 'react';
import { clientLabel } from './clients';
import { type AttemptRow, type EventRow, type RunRow, UUID, withDb } from './db';
import type { Board, Challenge, Mode, Size, ToolUse } from './rules';

// ---------------------------------------------------------------------------
// Every board at once. Verified and Community rows are ranked together (each
// row says which); nothing else mixes.
//
// Ranking, which the players are told up front (rules.ts SCORING):
//   ladder:   highest level, then fewest moves to get there, then least time
//   scramble: solve rate, then fewest moves, then least time
// "To get there" counts every attempt up to the solve that set the best
// level, failed ones included. Time is how long each cube was in front of
// the player (attempt start to finish).

export interface LadderRow {
  model_name: string;
  display_name: string;
  /** Set on the combined boards, where Verified and Community rows rank together. */
  board?: Board;
  best: number;
  /** The app that connected for the best run, from its User-Agent (see clients.ts). */
  via: string;
  /** Moves and seconds the best run took to reach its best level; null if it never solved one. */
  moves: number | null;
  secs: number | null;
  runs: number;
  last: Date;
  best_attempt: string | null;
}

export interface ScrambleRow {
  model_name: string;
  display_name: string;
  board?: Board;
  runs: number;
  solved: number;
  via: string;
  median_moves: number | null;
  median_secs: number | null;
  last: Date;
  best_attempt: string | null;
}

export interface BoardSection {
  /** Anchor on the page, e.g. "3x3-ladder-interactive-model-only". */
  id: string;
  challenge: Challenge;
  size: Size;
  mode: Mode;
  toolUse: ToolUse;
  ladder: LadderRow[];
  scramble: ScrambleRow[];
}

type Keyed<T> = T & { size: Size; mode: Mode; tool_use: ToolUse; board: Board; client?: string | null };

const ORDER = {
  tool: ['model_only', 'code', 'solver'] as ToolUse[],
  challenge: ['ladder', 'scramble'] as Challenge[],
  size: [3, 2, 4, 5] as Size[],
  mode: ['interactive', 'one_shot'] as Mode[],
};
const verifiedFirst = (a: { board?: Board }, b: { board?: Board }) => (a.board === b.board ? 0 : a.board === 'verified' ? -1 : 1);
const rate = (r: ScrambleRow) => r.solved / r.runs;
/** Ascending, with "no value" last. */
const fewer = (a: number | null, b: number | null) => (a ?? Infinity) - (b ?? Infinity) || 0;

export const ladderOrder = (a: LadderRow, b: LadderRow) =>
  b.best - a.best || fewer(a.moves, b.moves) || fewer(a.secs, b.secs) || verifiedFirst(a, b) || b.runs - a.runs;
export const scrambleOrder = (a: ScrambleRow, b: ScrambleRow) =>
  rate(b) - rate(a) || b.solved - a.solved || fewer(a.median_moves, b.median_moves) || fewer(a.median_secs, b.median_secs) || verifiedFirst(a, b);

async function allBoardsQuery(): Promise<BoardSection[]> {
  const [ladder, scramble] = await withDb(async (sql) => {
    const l = await sql<Keyed<LadderRow>[]>`
      with best as (
        -- per run: the solve that set its best level, and what reaching it cost
        select r.id, r.size, r.mode, r.tool_use, r.board, r.model_name, r.display_name, r.best_level, r.updated_at, r.client, b.id as best_attempt,
               (select sum(a.move_count) from cube_arena.attempts a where a.run_id = r.id and a.seq <= b.seq)::int as moves,
               (select sum(extract(epoch from a.finished_at - a.created_at)) from cube_arena.attempts a
                 where a.run_id = r.id and a.seq <= b.seq)::float as secs
        from cube_arena.runs r
        left join lateral (
          select a.id, a.seq from cube_arena.attempts a
          where a.run_id = r.id and a.status = 'solved' and a.level = r.best_level order by a.seq limit 1
        ) b on true
        where r.challenge = 'ladder' and not r.hidden
      )
      select size, mode, tool_use, board, model_name, display_name,
             max(best_level)::int as best, count(*)::int as runs, max(updated_at) as last,
             (array_agg(moves order by best_level desc, moves asc nulls last, secs asc nulls last))[1] as moves,
             (array_agg(secs order by best_level desc, moves asc nulls last, secs asc nulls last))[1] as secs,
             (array_agg(best_attempt order by best_level desc, moves asc nulls last, secs asc nulls last))[1] as best_attempt,
             (array_agg(client order by best_level desc, moves asc nulls last, secs asc nulls last))[1] as client
      from best group by size, mode, tool_use, board, model_name, display_name`;
    const s = await sql<Keyed<ScrambleRow>[]>`
      select r.size, r.mode, r.tool_use, r.board, r.model_name, r.display_name, count(*)::int as runs,
             count(*) filter (where a.status = 'solved')::int as solved,
             (percentile_cont(0.5) within group (order by a.move_count) filter (where a.status = 'solved'))::float as median_moves,
             (percentile_cont(0.5) within group (order by extract(epoch from a.finished_at - a.created_at))
               filter (where a.status = 'solved'))::float as median_secs,
             max(r.updated_at) as last,
             (array_agg(a.id order by a.move_count, a.finished_at - a.created_at) filter (where a.status = 'solved'))[1] as best_attempt,
             coalesce((array_agg(r.client order by a.move_count) filter (where a.status = 'solved'))[1], max(r.client)) as client
      from cube_arena.runs r join cube_arena.attempts a on a.run_id = r.id
      where r.challenge = 'scramble' and r.status = 'finished' and not r.hidden
      group by r.size, r.mode, r.tool_use, r.board, r.model_name, r.display_name`;
    return [l, s] as const;
  });

  const sections = new Map<string, BoardSection>();
  const section = (challenge: Challenge, r: { size: Size; mode: Mode; tool_use: ToolUse }) => {
    const id = `${r.size}x${r.size}-${challenge}-${r.mode.replace('_', '-')}-${r.tool_use.replace('_', '-')}`;
    let s = sections.get(id);
    if (!s) sections.set(id, (s = { id, challenge, size: r.size, mode: r.mode, toolUse: r.tool_use, ladder: [], scramble: [] }));
    return s;
  };
  // Only the readable label leaves the server, not the raw User-Agent.
  for (const { client, ...r } of ladder) section('ladder', r).ladder.push({ ...r, via: clientLabel(client) });
  for (const { client, ...r } of scramble) section('scramble', r).scramble.push({ ...r, via: clientLabel(client) });

  for (const s of sections.values()) {
    s.ladder.sort(ladderOrder);
    s.scramble.sort(scrambleOrder);
  }
  const rank = (s: BoardSection) => [
    ORDER.tool.indexOf(s.toolUse), ORDER.challenge.indexOf(s.challenge), ORDER.size.indexOf(s.size), ORDER.mode.indexOf(s.mode),
  ];
  return [...sections.values()].sort((a, b) => {
    const [x, y] = [rank(a), rank(b)];
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2] || x[3] - y[3];
  });
}

export interface Stats {
  runs: number;
  solves: number;
  models: number;
  best3: number;
  live: number;
}

async function statsQuery(): Promise<Stats> {
  const [s] = await withDb((sql) => sql<Stats[]>`
    with r as (select * from cube_arena.runs where not hidden),
         a as (select a.* from cube_arena.attempts a join r on r.id = a.run_id)
    select (select count(*) from r)::int as runs,
           (select count(*) from a where status = 'solved')::int as solves,
           (select count(distinct lower(model_name)) from r)::int as models,
           coalesce((select max(best_level) from r where size = 3 and challenge = 'ladder'), 0)::int as best3,
           (select count(*) from a where status = 'active' and deadline_at > now())::int as live`);
  return s;
}

export interface FeedItem {
  id: string;
  status: AttemptRow['status'];
  size: number;
  mode: Mode;
  level: number | null;
  move_count: number;
  finished_at: Date | null;
  created_at: Date;
  model_name: string;
  display_name: string;
  board: Board;
  tool_use: ToolUse;
  challenge: Challenge;
}

async function recentFinishedQuery(limit = 12): Promise<FeedItem[]> {
  return withDb((sql) => sql<FeedItem[]>`
    select a.id, a.status, a.size, a.mode, a.level, a.move_count, a.finished_at, a.created_at,
           r.model_name, r.display_name, r.board, r.tool_use, r.challenge
    from cube_arena.attempts a join cube_arena.runs r on r.id = a.run_id
    where a.status in ('solved', 'failed', 'invalid') and not r.hidden
    order by a.finished_at desc nulls last limit ${limit}`);
}

/**
 * Cubes being solved now. Not cached here: unstable_cache hands out its stale
 * copy while it refreshes, and copies of different ages made /live jump back
 * to older states. The API's 3-second CDN cache keeps the load down.
 */
export async function liveAttempts(limit = 24): Promise<FeedItem[]> {
  return withDb((sql) => sql<FeedItem[]>`
    select a.id, a.status, a.size, a.mode, a.level, a.move_count, a.finished_at, a.created_at,
           r.model_name, r.display_name, r.board, r.tool_use, r.challenge
    from cube_arena.attempts a join cube_arena.runs r on r.id = a.run_id
    where a.status = 'active' and a.deadline_at > now() and not r.hidden
    order by a.created_at desc limit ${limit}`);
}

export interface Replay {
  attempt: AttemptRow;
  run: RunRow;
  events: Pick<EventRow, 'kind' | 'move_count' | 'solved' | 'at' | 'error' | 'moves'>[];
  /** Other attempts in the same run, for navigation. */
  siblings: Pick<AttemptRow, 'id' | 'seq' | 'level' | 'status'>[];
}

async function replayQuery(id: string): Promise<Replay | null> {
  if (!UUID.test(id)) return null;
  return withDb(async (sql) => {
    const [attempt] = await sql<AttemptRow[]>`select * from cube_arena.attempts where id = ${id}`;
    if (!attempt) return null;
    const [run] = await sql<RunRow[]>`select * from cube_arena.runs where id = ${attempt.run_id}`;
    if (run.hidden) return null;
    const events = await sql<Replay['events']>`
      select kind, move_count, solved, at, error, moves from cube_arena.events
      where attempt_id = ${id} and kind <> 'look' order by id`;
    const siblings = await sql<Replay['siblings']>`
      select id, seq, level, status from cube_arena.attempts where run_id = ${run.id} order by seq`;
    return { attempt, run, events, siblings };
  });
}

export const allBoards = unstable_cache(allBoardsQuery, ['cube-arena', 'allBoards'], { revalidate: 20 });
export const stats = unstable_cache(statsQuery, ['cube-arena', 'stats'], { revalidate: 20 });
export const recentFinished = unstable_cache(recentFinishedQuery, ['cube-arena', 'recentFinished'], { revalidate: 10 });

/** Deduped per request (metadata and page both ask). Not cached across requests: live attempts change. */
export const replay = cache(replayQuery);
