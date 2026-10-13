-- Fast v3 plays the v2 tests with the same cubes (suites.ts seedVersion) and
-- adds the Gauntlet, so v2 results carry over: regraded with the v3 weights,
-- they stay on the boards. Applied right after the v3 code is deployed (the
-- code seeds a 'v2' suite's cubes the same way, so suites in play are safe).
update cube_arena.suites set version = 'v3' where kind = 'fast' and version = 'v2';
