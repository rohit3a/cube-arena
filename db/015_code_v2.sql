-- Coding v2: the NxN ladder. A submission's version is its bench ('v2' or
-- 'v2-mini'). The model writes three stage programs, one per session; each
-- goes up as its own bundle, and the submission is queued once all three are in.
--
-- The hidden cubes live here, not in code: one scramble per (size, case),
-- made from crypto randomness by scripts/code2-cases.mjs, with our reference
-- chain's states after each stage (the next stage's input) and its moves and
-- CPU time per stage (which set the move cap and the CPU limit).
create table if not exists cube_arena.code_cases (
  version     text not null,
  size        int not null,
  case_no     int not null,
  -- [scrambled, centres done, edges done]: the input of each stage, in order.
  states      text[] not null,
  ref_moves   int[] not null,
  ref_cpu_ms  int[] not null,
  created_at  timestamptz not null default now(),
  primary key (version, size, case_no)
);

create table if not exists cube_arena.code_bundles (
  submission_id  uuid not null references cube_arena.code_submissions (id) on delete cascade,
  stage          text not null check (stage in ('centres', 'edges', 'finish')),
  bundle         bytea not null,
  sha256         text not null,
  bytes          int not null,
  -- Wall-clock minutes of that stage's session, and whether it got the time-left message.
  minutes        numeric,
  nudged         boolean not null default false,
  created_at     timestamptz not null default now(),
  primary key (submission_id, stage)
);

-- One row per hidden case per part (the three stages and end to end). The
-- output can rebuild the hidden state, so it is never shown publicly.
create table if not exists cube_arena.code2_results (
  submission_id  uuid not null references cube_arena.code_submissions (id) on delete cascade,
  part           text not null check (part in ('centres', 'edges', 'finish', 'e2e')),
  size           int not null,
  case_no        int not null,
  status         text not null check (status in ('solved', 'unsolved', 'over_cap', 'illegal', 'timeout', 'crash')),
  moves          int,
  cpu_ms         int,
  ref_moves      int not null,
  cap            int not null,
  cpu_limit_ms   int not null,
  value          numeric not null,
  output         text,
  detail         text,
  primary key (submission_id, part, size, case_no)
);

-- Per part: score, solved, cases, mean value per size; and per stage build results.
alter table cube_arena.code_submissions add column if not exists parts jsonb;
alter table cube_arena.code_submissions add column if not exists builds jsonb;

alter table cube_arena.code_cases enable row level security;
alter table cube_arena.code_bundles enable row level security;
alter table cube_arena.code2_results enable row level security;
drop policy if exists cube_app_all on cube_arena.code_cases;
drop policy if exists cube_app_all on cube_arena.code_bundles;
drop policy if exists cube_app_all on cube_arena.code2_results;
create policy cube_app_all on cube_arena.code_cases for all to cube_app using (true) with check (true);
create policy cube_app_all on cube_arena.code_bundles for all to cube_app using (true) with check (true);
create policy cube_app_all on cube_arena.code2_results for all to cube_app using (true) with check (true);
grant select, insert, update, delete on cube_arena.code_cases, cube_arena.code_bundles, cube_arena.code2_results to cube_app;
