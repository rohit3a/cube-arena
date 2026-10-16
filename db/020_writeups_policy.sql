-- The app's role reads and writes writeups (019 granted the table; RLS also needs its policy).
do $$ begin
  create policy cube_app_all on cube_arena.writeups for all to cube_app using (true) with check (true);
exception when duplicate_object then null; end $$;
