-- Invites: a code for someone Rohit trusts. Their runner posts suites to the
-- Verified board under the code, and they can claim what they're running.
create table if not exists cube_arena.invites (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  name         text not null check (char_length(name) between 1 and 40),
  note         text,
  -- HMAC of the code; the code itself is shown once, when it's made.
  code_hash    text not null unique,
  -- The code's last two characters, to tell codes apart in lists.
  code_hint    text not null,
  expires_at   timestamptz,
  revoked_at   timestamptz,
  last_used_at timestamptz
);

alter table cube_arena.suites add column if not exists invite_id uuid references cube_arena.invites (id);
-- Whether the invitee chose to show their name on this suite's results.
alter table cube_arena.suites add column if not exists credit boolean not null default false;
-- How the model was reached: claude-code, codex, openrouter or another API host.
alter table cube_arena.suites add column if not exists harness text;
create index if not exists suites_invite_idx on cube_arena.suites (invite_id) where invite_id is not null;

-- Claims: "I'm running this model at this effort" for 24 hours, so two people
-- don't spend tokens on the same thing. Expired claims are released lazily.
create table if not exists cube_arena.claims (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  invite_id   uuid references cube_arena.invites (id) on delete cascade,
  model_id    text not null,
  effort      text not null default '',
  kind        text not null check (kind in ('fast', 'thorough')),
  -- Show the invitee's name on the wanted list, as they chose.
  credit      boolean not null default false,
  expires_at  timestamptz not null,
  released_at timestamptz,
  suite_id    uuid references cube_arena.suites (id) on delete set null
);
create unique index if not exists claims_open_idx on cube_arena.claims (model_id, effort, kind) where released_at is null;

-- Audit digests of each test session (what the model said and called, no
-- pictures), gzipped. Operator-only.
create table if not exists cube_arena.transcripts (
  run_id     uuid primary key references cube_arena.runs (id) on delete cascade,
  created_at timestamptz not null default now(),
  bytes      int not null,
  gz         bytea not null
);

alter table cube_arena.invites enable row level security;
drop policy if exists cube_app_all on cube_arena.invites;
create policy cube_app_all on cube_arena.invites for all to cube_app using (true) with check (true);
grant select, insert, update on cube_arena.invites to cube_app;

alter table cube_arena.claims enable row level security;
drop policy if exists cube_app_all on cube_arena.claims;
create policy cube_app_all on cube_arena.claims for all to cube_app using (true) with check (true);
grant select, insert, update on cube_arena.claims to cube_app;

alter table cube_arena.transcripts enable row level security;
drop policy if exists cube_app_all on cube_arena.transcripts;
create policy cube_app_all on cube_arena.transcripts for all to cube_app using (true) with check (true);
grant select, insert, update on cube_arena.transcripts to cube_app;
