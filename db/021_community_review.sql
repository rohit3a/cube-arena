-- Community results wait for the operator's review before they reach the boards (scores and writeups).
-- Null means not reviewed yet; Verified results never need one. Live shows everything that isn't hidden.
alter table cube_arena.suites add column if not exists review text check (review in ('approved', 'declined'));
alter table cube_arena.suites add column if not exists reviewed_at timestamptz;
alter table cube_arena.runs add column if not exists review text check (review in ('approved', 'declined'));
alter table cube_arena.runs add column if not exists reviewed_at timestamptz;
create index if not exists runs_unreviewed_idx on cube_arena.runs (created_at) where board = 'community' and review is null;
