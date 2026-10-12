// Codex reports a session's tokens only when its turn completes, and a session
// the runner stops (the time limit, a breach) never completes. So Codex keeps
// its session file, which holds the running total, and the runner reads that
// and deletes the session.

import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { commandFor } from './command.mjs';

/** A thread's files: CODEX_HOME/sessions/YYYY/MM/DD/rollout-<time>-<thread>.jsonl. */
function sessionFiles(codexHome, thread) {
  const found = [];
  const walk = (dir, depth) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory() && depth < 3) walk(join(dir, e.name), depth + 1);
      else if (e.isFile() && e.name.startsWith('rollout-') && e.name.endsWith(`-${thread}.jsonl`)) found.push(join(dir, e.name));
    }
  };
  walk(join(codexHome, 'sessions'), 0);
  return found;
}

/** The last token_count in a session file, in the runner's usage fields; null if it has none. */
export function sessionUsage(text) {
  let total = null;
  for (const l of text.split('\n')) {
    if (!l.includes('"token_count"')) continue;
    try {
      const ev = JSON.parse(l);
      if (ev.payload?.type === 'token_count' && ev.payload.info?.total_token_usage) total = ev.payload.info.total_token_usage;
    } catch {
      // a line cut off when the session was killed
    }
  }
  if (!total) return null;
  const usage = {};
  const keep = (k, v) => {
    if (Number.isFinite(v)) usage[k] = v;
  };
  keep('input_tokens', total.input_tokens);
  keep('cached_input_tokens', total.cached_input_tokens);
  keep('output_tokens', total.output_tokens);
  keep('reasoning_tokens', total.reasoning_output_tokens);
  return usage;
}

/** A finished thread's usage from its session file (null if none), then the session deleted. */
export function takeCodexSession(codexHome, thread) {
  if (!codexHome || !thread) return null;
  const files = sessionFiles(codexHome, thread);
  let usage = null;
  for (const f of files) {
    try {
      usage = sessionUsage(readFileSync(f, 'utf8')) ?? usage;
    } catch {
      // unreadable: no usage from it
    }
  }
  // Codex's delete also clears its session database; an older Codex without
  // one fails harmlessly, and the files go either way.
  const run = commandFor('codex', ['delete', '--force', thread]);
  spawnSync(run.file, run.args, { env: { ...process.env, CODEX_HOME: codexHome }, stdio: 'ignore', timeout: 30_000 });
  for (const f of files) rmSync(f, { force: true });
  return usage;
}
