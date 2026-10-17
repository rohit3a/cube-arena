-- Tokens and cost of a run's sessions that ended through no fault of the model (an API error, an outage, a safeguard
-- flag, a fault of ours). Kept apart from usage, so cost counts only what the test needed, as time already does.
alter table cube_arena.runs add column if not exists lost_usage jsonb;
