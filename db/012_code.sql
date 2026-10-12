-- The coding benchmark: a model writes its own 5x5 solver; the ROG runs the
-- frozen code on hidden cubes; the server checks every answer.
--
-- A submission is one coding session (or several, picked up after an API
-- error): coding → queued (code uploaded) → grading (the grader holds it) →
-- graded, or failed when the grader could not run it at all.
create table if not exists cube_arena.code_submissions (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  version         text not null,
  board           text not null default 'verified' check (board in ('verified')),
  display_name    text not null,
  model_name      text not null,
  model           text,
  model_id        text,
  effort          text,
  agent           text,
  harness         text,
  client          text,
  invite_id       uuid references cube_arena.invites (id) on delete set null,
  credit          boolean not null default false,
  status          text not null default 'coding' check (status in ('coding', 'queued', 'grading', 'graded', 'failed')),
  hidden          boolean not null default false,
  hidden_reason   text,
  -- Coding: wall-clock minutes of the sessions, and what they cost.
  dev_minutes     numeric,
  usage           jsonb,
  -- The frozen solver (a gzipped tar of solver/) and the audit digest.
  bundle          bytea,
  bundle_sha256   text,
  bundle_bytes    int,
  transcript_gz   bytea,
  queued_at       timestamptz,
  -- Grading.
  lease_until     timestamptz,
  graded_at       timestamptz,
  grader          text,
  build_ok        boolean,
  build_ms        int,
  build_log       text,
  cases           int,
  solved          int,
  score           numeric,
  mean_moves      numeric,
  mean_ms         numeric,
  error           text
);
create index if not exists code_submissions_status_idx on cube_arena.code_submissions (status, queued_at);
create index if not exists code_submissions_created_idx on cube_arena.code_submissions (created_at desc);

-- One row per hidden cube. The output can rebuild the hidden state (undo the
-- moves from solved), so it is never shown publicly; the move count is.
create table if not exists cube_arena.code_results (
  submission_id  uuid not null references cube_arena.code_submissions (id) on delete cascade,
  case_no        int not null,
  status         text not null check (status in ('solved', 'unsolved', 'illegal', 'timeout', 'crash')),
  moves          int,
  ms             int,
  output         text,
  detail         text,
  primary key (submission_id, case_no)
);

alter table cube_arena.code_submissions enable row level security;
alter table cube_arena.code_results enable row level security;
drop policy if exists cube_app_all on cube_arena.code_submissions;
drop policy if exists cube_app_all on cube_arena.code_results;
create policy cube_app_all on cube_arena.code_submissions for all to cube_app using (true) with check (true);
create policy cube_app_all on cube_arena.code_results for all to cube_app using (true) with check (true);
grant select, insert, update, delete on cube_arena.code_submissions, cube_arena.code_results to cube_app;
