# Cube Arena

**Can your AI solve the cube?** Plug any model into [cube.krnl.studio](https://cube.krnl.studio) over MCP. It only ever sees a picture of a
scrambled cube, and has to turn it back to solved. The cube lives on our server, so every move is checked there: no peeking at the state,
no faking the result.

## Play

Add the remote MCP server to any client:

```
https://cube.krnl.studio/mcp
```

- **Claude (web or desktop):** Settings → Connectors → Add custom connector, paste the URL.
- **Claude Code:** `claude mcp add --transport http cube-arena https://cube.krnl.studio/mcp`
- **Codex:** `codex mcp add cube-arena --url https://cube.krnl.studio/mcp`
- **Cursor, ChatGPT, anything else:** any client that speaks MCP over Streamable HTTP.

Then ask it to play:

> Let's play Cube Arena. First call get_rules. Then call start_run with size 3, mode "interactive", challenge "ladder", display_name
> "&lt;your name&gt;", model_name "&lt;your exact model and variant, e.g. GPT-6-Astra or Claude Opus 5.5&gt;", and tool_use "model_only". Solve each cube from the pictures only: don't write or run
> any code. Keep climbing until the run ends, then tell me your best level.

## Rules in short

| | |
| --- | --- |
| **Sizes** | 2×2, 3×3, 4×4, 5×5. Each is ranked separately. |
| **Ladder** | Level N is a cube N moves from solved (proven exact for 2×2 up to level 8 and 3×3 up to level 6). Solve it to go up; a miss costs one of three lives. |
| **Full scramble** | One fully mixed cube (a uniformly random state on 3×3). Ranked by solve rate. |
| **Ranking** | Ladder: highest level, then fewest total moves to get there (failed attempts count), then least time. Full scramble: solve rate, then fewest moves, then least time. Players are told this up front. |
| **One-shot** | Study the picture, submit every move at once. Only the final state counts. |
| **Interactive** | Turn up to 20 moves per call and get a new picture each time. |
| **Tool use** | `model_only`, `code` (own code, no cube solver) or `solver`. Self-reported on the Community board. |

Moves use standard notation: `U R F D L B` (clockwise looking at that face), `'` and `2`, wide turns `Rw`/`3Rw`, inner slices `2R`, middle
layers `M E S` on odd cubes, and free whole-cube rotations `x y z`.

### Two boards

- **Community:** anyone who connects. We can prove each solve happened, but not which model made it or what tools it used, so those are
  self-reported.
- **Verified:** runs we did ourselves with [`runner/run.mjs`](runner/run.mjs), through the official command-line agent (Claude Code or
  Codex), in an empty directory, with no CLAUDE.md, AGENTS.md, plugins or hooks, and with the cube tools as the only tools. The name on
  the board comes from the exact model id and effort, e.g. "Claude Opus 5.5 (high)" or "GPT-6-Astra (xhigh)", and Claude runs check
  that the model that answered is the one asked for.

Every entry also shows **via**: the app that connected, from what our server saw, not from the model.

### The Cube Arena Index

[cube.krnl.studio/benchmark](https://cube.krnl.studio/benchmark) ranks models on two fixed suites of tests, played on the Verified board
at every effort level a model offers:

- **Fast** (45 minutes at most): 2×2 and 3×3 ladders, interactive, and a 3×3 ladder, one-shot. 15 minutes each.
- **Thorough** (up to about 8 hours): every model-only test, 2×2 to 5×5, ladder and full scramble, interactive and one-shot. Ladders get
  30 minutes; each full scramble is two cubes of 15 minutes. It goes to the strongest models from Fast.

Each test scores 0 to 100: a ladder by how far up it climbed (level 7 of 20 is 35), a full scramble 100 for a solve. Up to 20% of each is
for few moves. The index is the mean of the tests, and a test that was never played counts 0. Every model gets the same cubes, fixed per
suite version from a secret only the server knows. Time is not scored directly; it counts through each test's budget. The page also
plots score against moves, time and cost, and each model has a page with every effort it was run at.

Anyone can play a suite with the `start_suite` and `next_test` tools; those results stay on the Community board.

### Invites: Verified results from people we trust

There are more models than we can afford to run, so people we know run some of them for us with
[`cube-arena-runner`](runner/README.md) and an 8-character invite code:
- **Their access:** they use their own model access, through Claude Code, Codex, OpenRouter or any OpenAI-compatible API.
- **Same conditions:** the runner gives every model the same locked-down setup as our own runs.
- **Board:** results go on the Verified board, with the person's name if they choose. Those who show their name are ranked on
  [/contributors](https://cube.krnl.studio/contributors) by tests played, with their X handle (set with `cube-arena-runner profile --x`).
- **What to run:** [cube.krnl.studio/wanted](https://cube.krnl.studio/wanted) lists every current model that can see images, at each
  effort level, taken from [Artificial Analysis](docs/MODELS.md). Starting a suite claims its row for 24 hours, and repeat runs are
  averaged.
- **Audit:** each test session's text log (no pictures) is uploaded so the operator can check it.

Revoking a code can also hide everything it ran.

```bash
node --env-file=.env.local scripts/invite.mjs create "Priya" --note "OpenRouter credits"   # prints the code once
node --env-file=.env.local scripts/invite.mjs list
node --env-file=.env.local scripts/invite.mjs revoke <invite id> --hide
node --env-file=.env.local scripts/invite.mjs x <invite id> priya_runs   # set (or "-" to clear) someone's X handle
node --env-file=.env.local scripts/moderate.mjs transcript <run id>
node scripts/build-catalog.mjs   # refresh data/catalog.json from data/aa-models.json and OpenRouter
node scripts/pack-runner.mjs     # runs before every build: public/runner/cube-arena-runner-<version>.tgz, served for npm install -g
```

## How it works

| Part | Where |
| --- | --- |
| NxN cube engine (moves, rotations, parsing), tested move-for-move against [cubejs](https://github.com/ldez/cubejs) | [`lib/cube`](lib/cube) |
| Ladder scrambles, certified exact by search where feasible | [`lib/cube/scramble.ts`](lib/cube/scramble.ts) |
| The picture models see: unfolded net, two 3D corner views, legend (SVG → PNG) | [`lib/render`](lib/render) |
| Game rules and state, all in Postgres transactions | [`lib/arena`](lib/arena) |
| MCP server (stateless Streamable HTTP) | [`app/mcp/route.ts`](app/mcp/route.ts), [`lib/arena/mcp.ts`](lib/arena/mcp.ts) |
| Suites and their grading | [`lib/arena/suites.ts`](lib/arena/suites.ts) |
| Website: index, leaderboards, live view, 3D replays | [`app`](app), [`components`](components) |

Built with Next.js, the MCP TypeScript SDK, react-three-fiber and Postgres (Supabase).

## Run it yourself

```bash
npm install
cp .env.example .env.local   # fill in the three values
npm run db:migrate           # needs ADMIN_ENV_FILE with the database admin password
npm run dev                  # http://localhost:3060, MCP at /mcp
```

The app connects as a limited `cube_app` role that can only read and write the `cube_arena` schema. Migrations live in [`db`](db).

Checks: `npm run typecheck`, `npm run lint`, `npm test`. `scripts/smoke.mjs` plays a full game against a running server.

### Verified runs

```bash
node --env-file=.env.local runner/suite.mjs --model gpt-6-luna --effort max --suite fast    # one suite, a fresh session per test
node --env-file=.env.local runner/sweep.mjs --suite fast                # every model × effort in runner/models.mjs; add --go to play
node --env-file=.env.local runner/sweep.mjs --suite thorough --top 5    # Thorough for the 5 best on Fast, at their top effort
node --env-file=.env.local runner/run.mjs --model claude-opus-5-5 --effort high --size 3 --mode interactive   # a single run
```

The sweep plays Claude and Codex models side by side, one suite at a time each, skips suites already finished and resumes half-played
ones. Claude models only get the efforts they support (Opus 4.5: low to high; Sonnet 4.5 and Haiku 4.5: none).

Codex runs use their own `CODEX_HOME` (`~/.codex-bench`, signed in once with `CODEX_HOME=~/.codex-bench codex login --device-auth`).
If anything other than the cube tools shows up, the run is stopped and hidden. Transcripts are saved to `runner/out/`.

### Moderation

```bash
node --env-file=.env.local scripts/moderate.mjs list
node --env-file=.env.local scripts/moderate.mjs hide <run or attempt id, or replay URL> --reason "fake model name"
node --env-file=.env.local scripts/moderate.mjs rename <id> "GPT-6-Astra"
```

Hidden runs leave every public page but stay in the database (`unhide` brings them back). Hiding a suite, or any run in it, hides the
whole suite.

## License

[MIT](LICENSE). Cube Arena is a [KRNL Studio](https://krnl.studio) experiment and is not affiliated with any cube brand.
