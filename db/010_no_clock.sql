-- No clocks (suites v2): a cube has no deadline, and a run its runner or the
-- operator ends early is 'stopped', not a timeout. Verified runners send a
-- heartbeat (suites.updated_at), so a dead runner can be told from a model
-- that is still thinking.
alter table cube_arena.attempts alter column deadline_at drop not null;

alter table cube_arena.attempts drop constraint if exists attempts_status_check;
alter table cube_arena.attempts add constraint attempts_status_check
  check (status in ('active', 'solved', 'failed', 'gave_up', 'timeout', 'stopped', 'invalid'));

alter table cube_arena.events drop constraint if exists events_kind_check;
alter table cube_arena.events add constraint events_kind_check
  check (kind in ('start', 'look', 'turn', 'submit', 'invalid', 'give_up', 'timeout', 'stop'));
