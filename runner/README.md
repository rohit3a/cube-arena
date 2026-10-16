# cube-arena-runner

Runs the [Cube Arena Index](https://cube.krnl.studio/benchmark) suites with your own model access and posts the results to the Verified
board. Cube Arena asks a model to solve a scrambled cube it can only see as a picture. You need an invite code to post Verified
results; without one, any MCP client can still play on the Community board.

```bash
npm install -g https://cube.krnl.studio/runner/cube-arena-runner-0.6.1.tgz   # once (Node 20+); the current link is on /wanted
cube-arena-runner login AB12-CD34          # once; asks whether to show your name on your results
cube-arena-runner profile --x yourhandle   # optional: link your X profile from the contributors board
cube-arena-runner wanted                   # what still needs running
cube-arena-runner play --model gemini-3-1-pro-preview --effort high
```

The runner is served from cube.krnl.studio rather than npm's registry. The file name carries the version, and the runner says
when a newer one is out. If the install fails with EACCES (Node from the macOS installer puts global packages in
/usr/local), add `--prefix ~/.local` and make sure `~/.local/bin` is on your PATH.

`play` claims that model and effort for 24 hours so nobody else runs it too. It then plays the Fast suite (three ladders, no time
limit), one fresh session per test, and posts the result. A model that scores 100 on all three goes straight on to the 4×4 Gauntlet,
two 4×4 ladders of 20 levels, worth the last 40 points; the others stop after the three. While it plays it tells
the site it's still there, so a model can think as long as it likes; if the runner stops (Ctrl-C, a crash, the machine sleeping),
carry on with `--resume <suite id>`. The same `--resume` plays a Gauntlet a suite unlocked but never played (`wanted` lists yours).

If you show your name, every finished suite counts towards your place on the
[contributors board](https://cube.krnl.studio/contributors), ranked by tests played, with your X handle linked if you add one.
Your own page there has a share button.

## The coding benchmark

```bash
cube-arena-runner code --model claude-opus-5-5 --effort max
```

The model gets a workspace with the [spec](https://cube.krnl.studio/code-kit/v1/SPEC.md), a reference cube, 20 practice cubes and
a checker, and up to 4 hours to write its own 5×5 solver in `solver/`. When it stops, `solver/` is frozen and sent to Cube Arena,
which runs it on 50 hidden cubes on its own machine and checks every answer. A cube solved in 60 moves (the scramble's length)
scores 100; fewer moves score more. Results are on [/code](https://cube.krnl.studio/code). `solver/` may be 3 MB gzipped; if it's
bigger when the model stops (usually tables or binaries its `build.py` makes, which the grader builds again anyway), the model gets
one more short session to clear them.

It runs through Claude Code or Codex on macOS or Linux (Windows: use WSL). The model can read and write files and run commands in
its workspace only, sandboxed by the CLI with no network, so it can't install packages or download a solver. On Linux, Claude
Code's sandbox needs `bubblewrap` and `socat`. If the session is cut off by something that isn't the model's doing (an API error,
a usage limit), the runner carries on after a wait; if the runner itself stops, carry on with `--resume <submission id>` within
30 minutes.

Run it on a machine that is otherwise quiet: the model's builds and tests share the CPU with everything else, so a busy machine
costs it time (the grade itself is measured on Cube Arena's machine). One coding run goes at a time on each machine, and anything
the model leaves running in the background is ended when its session ends.

## Reaching the model

| `--via` | Models | Needs |
| --- | --- | --- |
| `claude-code` | Claude | [Claude Code](https://claude.com/claude-code), signed in |
| `codex` | GPT | [Codex](https://github.com/openai/codex), signed in once with `CODEX_HOME=~/.cube-arena/codex codex login` |
| `cursor` | what your Cursor plan has: Claude, GPT, Gemini, Grok, Kimi, Composer… | [Cursor's CLI](https://cursor.com/cli), signed in with `cursor-agent login` (macOS or Linux) |
| `muse` | Meta's Muse models | [Muse Code](https://dev.meta.ai), signed in with `muse login` |
| `openrouter` | almost everything | `OPENROUTER_API_KEY` |
| `api` | anything with an OpenAI-compatible API | `--base-url`, `--api-key-env`, `--api-model` |

On Windows, sign Codex in from PowerShell: `$env:CODEX_HOME="$HOME\.cube-arena\codex"; codex login; Remove-Item Env:CODEX_HOME`.

With `--via cursor`, the run uses your Cursor plan's usage; the runner finds the model's Cursor id for the effort you ask for
(`cursor-agent models` lists what your plan has). With `--via muse`, it uses your Muse Code plan (or `META_API_KEY`, if set,
billed per token), with contributor mode off for every session so Meta doesn't train on the cubes.

Without `--via` it picks the first that works on your machine. For example, Grok through xAI's own API:

```bash
XAI_API_KEY=… cube-arena-runner play --model grok-4-7 --effort high \
  --via api --base-url https://api.x.ai/v1 --api-key-env XAI_API_KEY --api-model grok-4.7
```

## What it locks down

- **Claude Code and Codex:**
  - run in an empty folder;
  - the cube server is their only tool;
  - your settings, CLAUDE.md, AGENTS.md, plugins, hooks, skills and memories are not loaded (Codex gets a home of its own).
- **Cursor:** its own tools can't be switched off, so the session's permissions block them all (shell, file reads and writes, web,
  other MCP servers) and allow only the cube server. A blocked attempt is noted in the log; one that gets through stops the session
  and hides the suite. Cursor's searches by file name can't be blocked, but with reading blocked they show names only, so one
  outside the session's folder is noted and play goes on. Cursor's config, chats and default model live in `~/.cube-arena/cursor`, so yours are left alone. Your
  Cursor user rules and plugins still load; keep them about code, not cubes.
- **Muse Code:** runs in an empty folder with the cube tools as its whole toolset: no shell, file writes, web, subagents or reminder
  agents, and no Claude Code or Codex rules or skills. The runner checks the session's record afterwards too (every tool offered,
  every model that answered), then deletes the session from Muse's folder. Your own Muse rules still load; keep them about code,
  not cubes.
- **API mode:** the runner holds the conversation, so the model can only call the cube tools. Only the three latest pictures stay in
  the conversation, to bound cost.
- **Model check:** the runner checks that the model that answered is the one you asked for. If anything else shows up, the session
  stops and the suite is hidden.
- **Coding benchmark:** files and a shell in the workspace only, no network for commands, no web tools, MCP or subagents.

## What it sends

Your API keys stay on your machine.

The runner sends Cube Arena:
- the moves (for the coding benchmark, the finished `solver/` folder);
- token counts and cost;
- a text log of each session (what the model said and which tools it called, no pictures), so results can be checked.

Add `--no-transcript` to skip the log.
