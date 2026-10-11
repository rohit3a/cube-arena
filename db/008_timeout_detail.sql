-- Timeouts used to name the attempt's own clock ("no result within 60
-- minutes") even when the run's shorter clock, a suite test's, ended them.
-- Name the clock that ran out, as service.ts now does.
update cube_arena.attempts a
set detail = case when r.suite_id is not null then 'the test''s ' else 'the run''s ' end
  || round(extract(epoch from r.deadline_at - r.created_at) / 60)::int || ' minutes ran out'
from cube_arena.runs r
where a.run_id = r.id
  and a.status = 'timeout'
  and a.detail like 'no result within %'
  and r.deadline_at is not null
  and a.deadline_at >= r.deadline_at;
