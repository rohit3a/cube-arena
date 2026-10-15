# Coding v2: build plan and progress

Spec page (decided with Rohit, 14 Oct 2026): https://claude.ai/artifact/FDNfebfUx9TMdMsT1D97UF

Shipping: deployed to production as it is built, hidden (unlisted pages, not on any board).
Calibration (3 full Sonnet 5.5 medium runs) waits for Rohit's go after the mini runs.

## Decisions (locked)

NxN ladder
- Sizes 4..10, one run per model. Three fresh sessions, each its own workspace:
  centres 1h30, edges 1h30, finish 1h. Nothing carries over between stages.
- Stage inputs come from our reference chain (scramble -> ref centres -> ref edges -> ref finish).
- End to end: no session; the grader chains the model's three programs on the scramble.
- 10 hidden cases per size per stage (70 per stage, 280 in all); one scramble per (size, case) feeds all four.
- Scramble: 20*(N-2) moves of randomWalk (outer blocks up to half the cube), weight w = N (sum 49).
- cap = 2 x reference moves; cpu_limit = clamp(5 x reference CPU, 5 s, 60 s).
- case value = 0 if unsolved / over cap / over CPU, else 0.5 + 0.5*min(1, par/moves).
  par (per case and part, e2e included) = min(reference moves, fewest moves any graded run used on it),
  set per case set from the graded runs (scripts/code2-par.mjs --set), then frozen; past runs rescored
  (--rescore). Practice cubes get a par too, from rerunning the best programs (--practice).
  2026-10-15: first set from the mini runs; reset once (06:29 UTC) after the full ladder (12 runs: Sol and
  Astra at medium, high and max, 2-3 each), every v2 run rescored; frozen since. Practice par from the top 3
  full programs of each stage.
  (Was 0.9 + 0.1*min(1, ref/moves): our reference is weak on moves, so the move term saturated: Sol scored ~100.)
- stage score = sum N*mean_N / 49; bench = 100*(centres+edges+finish+e2e)/4.
- Early stop: > 10% of stage time left -> the same message, up to 5 times a stage (session resumed):
  "You have X min left in this stage. Keep working on <stage>/ until the time is up; it is submitted then."
  A stop with less left, or after the fifth message, submits. (Was: > 25%, once, with "or reply DONE":
  in the first mini runs every message got an immediate DONE, once with the stage unfinished.)
- Interface: <stage>/solve.py (stdin: N, then 6N^2 letters URFDLB), prints moves; optional build.py (10 min).
- Python 3.12 + gcc 12 stdlib; 2 GB; 3 MB gzipped per stage folder.
- Kit per stage: SPEC.md, cube.py (NxN), check.py, practice.json (30 per size, ref moves + cap + cpu limit;
  check.py runs 10 per size by default, --held-out the other 20).

Subagent bench
- 30 tasks x 20 min, one try each, fresh workspace from a fixed starter commit.
- 5 kinds x 6: implement to spec, fix a planted bug, extend a module, meet a budget, wire modules.
- Hidden tests decide pass. Score = share passed (+ cost per success). No "time left" nudge.

Shared
- Claude Code and Codex keep their own sandboxes (subscription logins never enter a container).
  API-key harnesses (OpenCode, Cursor/Muse with API keys) run in the container with an allowlist proxy.
- One coding run per machine; grading on the ROG's reserved core with CPU-time limits.
- v1 board kept as "v1 (5x5)".

## Layout

- grader/v2/cube.py            NxN engine (also shipped in every kit as cube.py)
- grader/v2/ref/               reference solvers: nxn.py (centre and wing commutators), finish.py (3x3 + parity), solve_<stage>.py
- grader/v2/run_stage.py       per-case wrapper in the grading image (CPU-time limit from the container's cgroup)
- grader/v2/step.py            host helper: where an answer leaves the cube (grader chain, case maker)
- grader/v2/kit/check.py       the kit's checker (copied into every stage kit)
- scripts/grader-lib.mjs       shared by the worker and the case maker: reserved core, sandbox, runStage
- scripts/code2-cases.mjs      hidden cubes (crypto, into cube_arena.code_cases) and practice cubes (into the kits)
- scripts/code2-kit.mjs        writes public/code-kit/{v2,v2-mini}/<stage>/ (SPEC.md, cube.py, check.py)
- scripts/code-worker.mjs      grades v1 and v2 (v2: per-stage builds, stage cases, end-to-end chain)
- lib/arena/code2-rules.ts     v2 limits and scoring; lib/arena/code2.ts records; lib/cube/stages.ts stage checks
- db/015_code_v2.sql           code_cases, code_bundles, code2_results; code_submissions.parts/builds
- runner/code2.mjs             stage sessions, the time-left message (session resumed), per-stage upload
- (private) cube-arena-subagent  subagent bench: starter codebase, tasks, hidden tests, solutions, run.mjs.
                               Kept out of this public repo; runner/code.mjs takes `denyRead` so its sessions can't read it.
- runner/container/            image + allowlist proxy for API-key harnesses

## Progress

- [x] Python NxN engine + stage checks, tested against lib/cube/engine.ts
- [x] Reference centres
- [x] Reference edges
- [x] Reference finish (3x3 + parity)
- [x] Case generation (70 hidden in DB, 3 per size practice in the kits)
- [x] Kits (SPEC.md per stage and bench, check.py)
- [x] DB migration 015 + routes (v2 is operator-only, starts hidden, and is off the v1 board)
- [x] Grader v2 (worker): stages + e2e chain, CPU-time limits
- [x] Runner v2: stage sessions, time-left message, mini mode (`code --bench v2-mini`)
- [x] Reference self-test through the live pipeline (100.00, every part 1.000)
- [ ] Container + proxy (API-key harnesses)
- [x] Subagent bench: starter + 30 tasks + hidden tests (private repo)
- [ ] Mini ladder runs (Sonnet 5.5 medium)
- [ ] Haiku 5.5 subagent runs (several)
- [ ] Ask Rohit before the 3 full Sonnet calibration runs
