-- Fast v3: the 4×4 Gauntlet. A model that scores 100 on all three Fast
-- ladders unlocks two 4×4 ladders whose level 1 starts 7 moves from solved.
--
-- A ladder run may now start above 1 move from solved and stop short of the
-- size's usual top level: level N of the run is (N + level_offset) moves from
-- solved, and top_level (when set) is its last level. Applied before the code
-- that reads them is deployed.
alter table cube_arena.runs
  add column if not exists level_offset smallint not null default 0,
  add column if not exists top_level smallint;
