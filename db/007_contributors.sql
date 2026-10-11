-- Contributors: an invitee's X handle, linked from the contributors board when
-- they chose to show their name. Set by them through the runner, or by Rohit.
alter table cube_arena.invites add column if not exists x_handle text
  check (x_handle ~ '^[A-Za-z0-9_]{1,15}$');
-- One handle per person, so a profile URL means one contributor.
create unique index if not exists invites_x_handle_idx on cube_arena.invites (lower(x_handle)) where x_handle is not null;
