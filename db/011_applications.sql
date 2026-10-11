-- Applications to become a Verified contributor. Someone fills in /apply, the
-- operator gets an email with a link to approve or decline, and approving
-- makes their invite and emails them the code. Only a hash of the link's
-- secret is kept.
create table if not exists cube_arena.applications (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  name        text not null check (char_length(name) between 2 and 32),
  x_handle    text not null check (x_handle ~ '^[A-Za-z0-9_]{1,15}$'),
  email       text not null check (char_length(email) between 3 and 254),
  note        text check (char_length(note) <= 500),
  ip_hash     text,
  token_hash  text not null,
  status      text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  decided_at  timestamptz,
  invite_id   uuid references cube_arena.invites (id) on delete set null
);
create index if not exists applications_ip_idx on cube_arena.applications (ip_hash, created_at desc);
create index if not exists applications_handle_idx on cube_arena.applications (lower(x_handle), status);

alter table cube_arena.applications enable row level security;
drop policy if exists cube_app_all on cube_arena.applications;
create policy cube_app_all on cube_arena.applications for all to cube_app using (true) with check (true);
grant select, insert, update, delete on cube_arena.applications to cube_app;
