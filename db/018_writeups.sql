-- Writeups: our model blogs, effort and round reviews and one line per cube, written by the comms worker from
-- /api/admin/comms facts and checked before they arrive here. Every version is kept: pages show the newest
-- published one, and a blog's earlier versions stay readable with their date.
create table if not exists cube_arena.writeups (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('blog', 'effort', 'round', 'cube')),
  -- blog: model slug; effort: suite id; round: run id; cube: attempt id
  subject     text not null,
  version     int not null check (version > 0),
  body        text not null,
  status      text not null default 'published' check (status in ('published', 'held', 'withdrawn')),
  -- Who wrote and judged it, under which style guide, after how many drafts, from which facts.
  writer      text,
  judge       text,
  style       text,
  drafts      int,
  facts_hash  text,
  problems    jsonb,
  created_at  timestamptz not null default now(),
  unique (kind, subject, version)
);
create index if not exists writeups_subject on cube_arena.writeups (kind, subject, version desc);
alter table cube_arena.writeups enable row level security;
