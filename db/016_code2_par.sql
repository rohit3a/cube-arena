-- Coding v2: par. A solved case is worth 0.5 + 0.5 x min(1, par / moves),
-- where par is the fewest moves any graded program has used on that hidden
-- cube for that part (never more than our reference's). Set from the graded
-- runs (lib/arena/code2.ts setPars2), then kept fixed for the case set, so
-- scores stay comparable; the source is the submission that set it.
create table if not exists cube_arena.code2_pars (
  version    text not null,
  size       int not null,
  case_no    int not null,
  part       text not null check (part in ('centres', 'edges', 'finish', 'e2e')),
  par_moves  int not null check (par_moves > 0),
  source     text not null,
  set_at     timestamptz not null default now(),
  primary key (version, size, case_no, part)
);

-- The par each result was valued against (null: graded before par, against the reference).
alter table cube_arena.code2_results add column if not exists par_moves int;

alter table cube_arena.code2_pars enable row level security;
drop policy if exists cube_app_all on cube_arena.code2_pars;
create policy cube_app_all on cube_arena.code2_pars for all to cube_app using (true) with check (true);
grant select, insert, update, delete on cube_arena.code2_pars to cube_app;
