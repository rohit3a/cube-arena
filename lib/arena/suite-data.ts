// Loading suite results for grading: the runs and attempts of many suites in
// one query, graded with the rules in suites.ts.

import type { Tx } from './db';
import { type GradedAttempt, type GradedRun, SUITES, type SuiteGrade, type SuiteKind, gradeSuite } from './suites';

interface SlotRow extends GradedRun {
  suite_id: string;
  suite_slot: number;
  attempts: GradedAttempt[];
}

export async function gradeSuites(sql: Tx, suites: { id: string; kind: SuiteKind; status: string }[]): Promise<Map<string, SuiteGrade>> {
  const out = new Map<string, SuiteGrade>();
  if (suites.length === 0) return out;
  const rows = await sql<SlotRow[]>`
    select r.suite_id, r.suite_slot, r.size, r.challenge, r.best_level, r.top_level, r.status,
           coalesce(json_agg(json_build_object('level', a.level, 'status', a.status, 'move_count', a.move_count) order by a.seq)
                    filter (where a.id is not null), '[]'::json) as attempts
    from cube_arena.runs r
    left join cube_arena.attempts a on a.run_id = r.id
    where r.suite_id = any(${sql.array(suites.map((s) => s.id))}::uuid[])
    group by r.id`;
  for (const s of suites) {
    const slots = new Map<number, GradedRun>(rows.filter((r) => r.suite_id === s.id).map((r) => [r.suite_slot, r]));
    out.set(s.id, gradeSuite(SUITES[s.kind], slots, s.status === 'finished'));
  }
  return out;
}
