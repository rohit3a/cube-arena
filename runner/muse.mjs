// Muse Code (Meta's coding agent CLI) for the runner: the command that locks
// a session down to the cube tools, and what the session's export says once
// it is over. Its live stream (muse exec --json) shows tool calls without
// their arguments and only the final reply; the export has the arguments,
// what the model said along the way, its reasoning summaries, the tokens and
// the toolset each request offered.
//
// Lockdown: the toolset is the cube server's tools by name; shell, file
// writes, web tools, subagents, reminder agents and other agents' rules and
// skills are off. Contributor mode is off for every session, so Meta never
// trains on the cubes whatever the account's default. Header values go in as
// ${VAR}: Muse takes no other form for them.

import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { commandFor } from './command.mjs';

/** How Muse names the cube server's tools. */
export const MUSE_CUBE = 'mcp__cube_arena__';
/** Muse caps model steps per session; a long ladder takes thousands. */
const MAX_STEPS = 1_000_000;

/** The `muse exec` arguments and environment for one session. */
export function museCommand(s, sessionId, system) {
  /** @type {Record<string, string>} */
  const env = { CUBE_ARENA_AUTH: `Bearer ${s.token}` };
  /** @type {Record<string, string>} */
  const headers = { Authorization: '${CUBE_ARENA_AUTH}' };
  for (const [i, [k, v]] of Object.entries(s.headers ?? {}).entries()) {
    env[`CUBE_ARENA_H${i}`] = String(v);
    headers[k] = `\${CUBE_ARENA_H${i}}`;
  }
  const args = ['exec', '--json', '--session-id', sessionId, '--model', s.model];
  if (s.effort) args.push('--effort', s.effort);
  args.push('--contributor-mode', 'off');
  args.push('--disable-shell', '--disable-write', '--disable-web-tools', '--disable-reminders', '--no-foreign-personal-context', '--sandbox-network', 'restricted');
  // Only the cube tools exist, so nothing needs approving (or a judge model's look).
  args.push('--approval-mode', 'never', '--approval-judge', 'off', '--max-model-steps', String(MAX_STEPS));
  const set = (key, value) => args.push('-c', `${key}=${JSON.stringify(value)}`);
  set('mcp_servers.cube-arena', { transport: 'streamable_http', url: s.url, headers });
  set('run.toolset', [`${MUSE_CUBE}*`]);
  set('run.system_prompt', system);
  set('run.subagent_delegation_mode', 'off');
  set('run.reminder_roster', []);
  set('context.foreign_personal_rules', false);
  set('context.foreign_personal_skills', false);
  set('telemetry.enabled', false);
  args.push('--', s.prompt);
  return { args, env };
}

/** The model that answered is the one asked for (or a dated snapshot of it, never another variant). */
export const sameMuseModel = (answered, asked) => answered === asked || new RegExp(`^${asked.replace(/[.]/g, '\\.')}-\\d{6,8}$`).test(answered);

/** A Muse failure that waiting won't fix: not signed in, no access to the model. */
export const MUSE_FATAL = /missing meta credentials|does not exist or you lack access|not available on your plan/i;

/** The records of a `muse export` file. */
export const exportRecords = (json) => (json.events ?? []).filter((e) => e.kind === 'record' && e.envelope).map((e) => e.envelope);

/**
 * What a session export says: { usage, events, tools, models, sessionLog }.
 * `events` is the audit digest (t in seconds from `started`); `tools` every
 * tool any request offered; `models` every model that answered.
 */
export function readMuseExport(records, started) {
  const usage = {};
  const events = [];
  const tools = new Set();
  const models = new Set();
  let sessionLog = null;
  const add = (k, v) => {
    if (Number.isFinite(v)) usage[k] = (usage[k] ?? 0) + v;
  };
  for (const r of records) {
    const e = r.payload?.event;
    if (!e) continue;
    const t = Math.max(0, Math.round((r.recorded_at / 1000 - started) / 1000));
    const note = (kind, text, tool) => events.push({ t, kind, ...(tool && { tool }), text: String(text ?? '') });
    if (e.kind === 'model_request_configured') {
      for (const tool of e.toolset?.active_tools ?? []) tools.add(tool);
      const where = (e.run_context_messages ?? []).find((m) => m.id === 'session_identity')?.text.match(/Current session log: (\S+)/);
      if (where) sessionLog = where[1];
    }
    if (e.kind === 'model_completed') {
      if (e.model) models.add(e.model);
      // Input counted the way OpenAI does (cached reads included); output includes reasoning.
      add('input_tokens', e.usage?.input_tokens);
      add('cached_input_tokens', e.usage?.cached_tokens);
      add('output_tokens', e.usage?.output_tokens);
      add('reasoning_tokens', e.usage?.reasoning_tokens);
    }
    if (e.kind === 'reasoning_summary_committed' && e.text) note('think', e.text.slice(0, 2000));
    if (e.kind === 'assistant_message_committed' && e.text) note('say', e.text);
    if (e.kind === 'assistant_tool_calls_committed') {
      for (const c of e.tool_calls ?? []) note('call', c.args ?? '{}', String(c.name ?? '').replace(MUSE_CUBE, ''));
    }
    if (e.kind === 'tool_result_batch_committed') {
      for (const res of e.results ?? []) note('result', String(res.text ?? '').slice(0, 300));
    }
  }
  return { usage, events, tools: [...tools], models: [...models], sessionLog };
}

/** Exports a finished session to `file` and reads it; null if Muse can't. */
export function exportMuseSession(sessionId, file, started) {
  try {
    const run = commandFor('muse', ['export', '--session', sessionId, '--out', file]);
    execFileSync(run.file, run.args, { stdio: 'ignore', timeout: 120_000 });
    return readMuseExport(exportRecords(JSON.parse(readFileSync(file, 'utf8'))), started);
  } catch {
    return null;
  }
}

/** Deletes a session Muse kept (the runner's log has it all): its folder and its view. */
export function forgetMuseSession(sessionId, sessionLog) {
  const dir = sessionLog && dirname(sessionLog);
  if (!dir || basename(dir) !== sessionId) return;
  const sessions = dirname(dirname(dirname(dirname(dir)))); // sessions/YYYY/MM/DD/<id>
  if (basename(sessions) !== 'sessions') return;
  for (const d of [dir, join(sessions, '.msp-view-v1', sessionId)]) rmSync(d, { recursive: true, force: true, maxRetries: 5 });
}
