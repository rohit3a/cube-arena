# cube-arena-runner

Runs the [Cube Arena Index](https://cube.krnl.studio/benchmark) suites with your own model access and posts the results to the Verified
board. Cube Arena asks a model to solve a scrambled cube it can only see as a picture. You need an invite code to post Verified
results; without one, any MCP client can still play on the Community board.

```bash
npm install -g https://cube.krnl.studio/runner/cube-arena-runner-0.2.1.tgz   # once (Node 20+); the current link is on /wanted
cube-arena-runner login AB12-CD34          # once; asks whether to show your name on your results
cube-arena-runner profile --x yourhandle   # optional: link your X profile from the contributors board
cube-arena-runner wanted                   # what still needs running
cube-arena-runner play --model gemini-3-1-pro-preview --effort high
```

The runner is served from cube.krnl.studio rather than npm's registry. The file name carries the version, and the runner says
when a newer one is out. If the install fails with EACCES (Node from the macOS installer puts global packages in
/usr/local), add `--prefix ~/.local` and make sure `~/.local/bin` is on your PATH.

`play` claims that model and effort for 24 hours so nobody else runs it too. It then plays the Fast suite (three ladders, no time
limit), one fresh session per test, and posts the result. While it plays it tells the site it's still there, so a model can think as
long as it likes; if the runner stops (Ctrl-C, a crash, the machine sleeping), carry on with `--resume <suite id>`.

If you show your name, every finished suite counts towards your place on the
[contributors board](https://cube.krnl.studio/contributors), ranked by tests played, with your X handle linked if you add one.
Your own page there has a share button.

## Reaching the model

| `--via` | Models | Needs |
| --- | --- | --- |
| `claude-code` | Claude | [Claude Code](https://claude.com/claude-code), signed in |
| `codex` | GPT | [Codex](https://github.com/openai/codex), signed in once with `CODEX_HOME=~/.cube-arena/codex codex login` |
| `openrouter` | almost everything | `OPENROUTER_API_KEY` |
| `api` | anything with an OpenAI-compatible API | `--base-url`, `--api-key-env`, `--api-model` |

On Windows, sign Codex in from PowerShell: `$env:CODEX_HOME="$HOME\.cube-arena\codex"; codex login; Remove-Item Env:CODEX_HOME`.

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
- **API mode:** the runner holds the conversation, so the model can only call the cube tools. Only the three latest pictures stay in
  the conversation, to bound cost.
- **Model check:** the runner checks that the model that answered is the one you asked for. If anything else shows up, the session
  stops and the suite is hidden.

## What it sends

Your API keys stay on your machine.

The runner sends Cube Arena:
- the moves;
- token counts and cost;
- a text log of each session (what the model said and which tools it called, no pictures), so results can be checked.

Add `--no-transcript` to skip the log.
