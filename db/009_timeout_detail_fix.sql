-- 008 again, with a tolerance: an attempt's deadline is the run's passed back
-- through JavaScript, so it lost the run's microseconds and compared lower.
update cube_arena.attempts a
set detail = case when r.suite_id is not null then 'the test''s ' else 'the run''s ' end
  || round(extract(epoch from r.deadline_at - r.created_at) / 60)::int || ' minutes ran out'
from cube_arena.runs r
where a.run_id = r.id
  and a.status = 'timeout'
  and a.detail like 'no result within %'
  and r.deadline_at is not null
  and a.deadline_at >= r.deadline_at - interval '1 second';
