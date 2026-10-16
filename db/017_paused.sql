-- Time an attempt spent paused by the operator (the runner's session frozen, its heartbeat still going), in seconds.
-- Every time shown subtracts it, so a pause never counts as the model's time. The timestamps stay as they happened.
alter table cube_arena.attempts add column if not exists paused_secs int not null default 0 check (paused_secs >= 0);
