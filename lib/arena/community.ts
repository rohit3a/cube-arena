// Community results wait for the operator's review before they reach the boards (scores and writeups); Live
// shows them anyway. The operator's poller says when one starts, and when it ends asks for a review with a link to
// /community/review, signed for exactly those results.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { SITE_URL } from '../site';
import { clientLabel } from './clients';
import { type Review, UUID, transaction, withDb } from './db';
import { allSuiteEntries } from './index-data';
import { SUITES, testName } from './suites';

export interface CommunityTest {
  name: string;
  /** "best level 7 of 20", "solved 3 of 5", "playing" */
  result: string;
  /** The cube to look at: its best solve, else its last try. */
  replay: string | null;
}

export interface CommunityItem {
  type: 'suite' | 'run';
  id: string;
  display_name: string;
  model_name: string;
  via: string;
  status: 'active' | 'finished';
  /** Nothing more will be played: finished, and for a suite no Gauntlet still to come. */
  done: boolean;
  review: Review;
  reviewed_at: string | null;
  created_at: string;
  /** When it was last played. */
  updated_at: string;
  /** "Fast v3, score 92.5", or the run's test and how far it got. */
  summary: string;
  tests: CommunityTest[];
}

interface RunLine {
  id: string;
  suite_id: string | null;
  display_name: string;
  model_name: string;
  client: string | null;
  status: 'active' | 'finished';
  review: Review;
  reviewed_at: Date | null;
  created_at: Date;
  updated_at: Date;
  size: 2 | 3 | 4 | 5;
  mode: 'one_shot' | 'interactive';
  challenge: 'ladder' | 'scramble';
  top_level: number | null;
  best_level: number;
  solves: number;
  attempts: number;
  end_reason: string | null;
  replay: string | null;
}

function result(r: RunLine): string {
  if (r.status === 'active') return 'playing';
  const how = r.end_reason ? ` (${r.end_reason.replace(/_/g, ' ')})` : '';
  if (r.challenge === 'scramble') return `solved ${r.solves} of ${r.attempts}${how}`;
  return `best level ${r.best_level}${r.top_level ? ` of ${r.top_level}` : ''}${how}`;
}

const testOf = (r: RunLine): CommunityTest => ({
  name: testName({ size: r.size, challenge: r.challenge, mode: r.mode, gauntlet: r.top_level !== null }).name,
  result: result(r),
  replay: r.replay,
});

/** Community suites and one-off runs started since `since` (hidden ones aside), newest first. */
export async function communityItems(since: Date): Promise<CommunityItem[]> {
  const [runs, entries] = await Promise.all([
    withDb((sql) => sql<RunLine[]>`
      select r.id, r.suite_id, r.display_name, r.model_name, r.client, r.status, r.review, r.reviewed_at, r.created_at,
             greatest(r.updated_at, coalesce((select max(a.finished_at) from cube_arena.attempts a where a.run_id = r.id), r.updated_at)) as updated_at,
             r.size, r.mode, r.challenge, r.top_level, r.best_level, r.solves, r.attempts, r.end_reason,
             (select a.id from cube_arena.attempts a where a.run_id = r.id
              order by (a.status = 'solved') desc, a.level desc nulls last, a.seq desc limit 1) as replay
      from cube_arena.runs r
      where r.board = 'community' and not r.hidden
        and (r.created_at >= ${since} or (r.suite_id is not null and exists (
          select 1 from cube_arena.suites s where s.id = r.suite_id and s.created_at >= ${since})))
      order by r.suite_slot nulls first, r.created_at`),
    allSuiteEntries(),
  ]);
  const items: CommunityItem[] = [];
  for (const e of entries) {
    if (e.board !== 'community' || new Date(e.created_at) < since) continue;
    const mine = runs.filter((r) => r.suite_id === e.id);
    const last = Math.max(new Date(e.created_at).getTime(), ...mine.map((r) => new Date(r.updated_at).getTime()));
    const def = SUITES[e.kind];
    items.push({
      type: 'suite',
      id: e.id,
      display_name: e.display_name,
      model_name: e.label,
      via: mine[0] ? clientLabel(mine[0].client) : '',
      status: e.status,
      done: e.status === 'finished' && e.gauntlet !== 'pending' && e.gauntlet !== 'playing',
      review: e.review,
      reviewed_at: mine[0]?.reviewed_at ? new Date(mine[0].reviewed_at).toISOString() : null,
      created_at: e.created_at,
      updated_at: new Date(last).toISOString(),
      summary: `${def.name} ${e.version}, ${e.score === null ? 'not finished' : `score ${e.score.toFixed(1)}`}${e.gauntlet === 'pending' ? ', Gauntlet unlocked and not played yet' : ''}`,
      tests: mine.map(testOf),
    });
  }
  for (const r of runs) {
    if (r.suite_id) continue;
    const t = testOf(r);
    items.push({
      type: 'run',
      id: r.id,
      display_name: r.display_name,
      model_name: r.model_name,
      via: clientLabel(r.client),
      status: r.status,
      done: r.status === 'finished',
      review: r.review,
      reviewed_at: r.reviewed_at ? new Date(r.reviewed_at).toISOString() : null,
      created_at: new Date(r.created_at).toISOString(),
      updated_at: new Date(r.updated_at).toISOString(),
      summary: `${t.name}: ${t.result}`,
      tests: [t],
    });
  }
  return items.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/**
 * Approves or declines community results by id (suites with their runs, or one-off runs). Returns the ids
 * it changed; Verified ids and unknown ones are left alone. A decision can be changed later.
 */
export async function setReview(ids: string[], approve: boolean): Promise<string[]> {
  const ok = ids.filter((id) => UUID.test(id));
  if (!ok.length) return [];
  const review = approve ? 'approved' : 'declined';
  return transaction(async (tx) => {
    const suites = await tx<{ id: string }[]>`
      update cube_arena.suites set review = ${review}, reviewed_at = now()
      where id = any(${tx.array(ok)}::uuid[]) and board = 'community' returning id`;
    if (suites.length) {
      await tx`update cube_arena.runs set review = ${review}, reviewed_at = now() where suite_id = any(${tx.array(suites.map((s) => s.id))}::uuid[])`;
    }
    const runs = await tx<{ id: string }[]>`
      update cube_arena.runs set review = ${review}, reviewed_at = now()
      where id = any(${tx.array(ok)}::uuid[]) and board = 'community' and suite_id is null returning id`;
    return [...suites, ...runs].map((x) => x.id);
  });
}

// A review link is signed with the operator token for its exact set of ids, so it can't be stretched to others.
function sign(ids: string[]): string {
  const key = process.env.CUBE_OPERATOR_TOKEN;
  if (!key) throw new Error('CUBE_OPERATOR_TOKEN is not set');
  return createHmac('sha256', key)
    .update(`community-review:${[...ids].sort().join(',')}`)
    .digest('base64url')
    .slice(0, 32);
}

export const reviewUrl = (ids: string[]) => `${SITE_URL}/community/review?ids=${ids.join(',')}&t=${sign(ids)}`;

/** The ids a review link covers, or null when the link is wrong. */
export function reviewIds(idsParam: string, t: string): string[] | null {
  const ids = [...new Set(idsParam.split(',').map((x) => x.trim()).filter(Boolean))];
  if (!ids.length || ids.length > 200 || !ids.every((id) => UUID.test(id)) || !t) return null;
  const [a, b] = [Buffer.from(sign(ids)), Buffer.from(t)];
  return a.length === b.length && timingSafeEqual(a, b) ? ids : null;
}
