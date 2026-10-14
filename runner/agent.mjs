// One agent session against Cube Arena: Claude Code, Codex, Cursor's CLI, Muse
// Code or a model called directly over an API (harness-api.mjs), locked down to the cube
// tools and watched as it plays. Used by run.mjs (one run) and play-suite.mjs (one fresh
// session per suite test).
//
// Lockdown: the agent gets the cube tools and nothing else (no shell, files,
// code or web). Anything else showing up in the stream stops the session and
// hides the run. Claude sessions also check that the model that answered is
// the one asked for (the CLI quietly serves some retired ids with another).
//
// Codex runs use their own CODEX_HOME (default ~/.codex-bench, signed in once
// with `CODEX_HOME=~/.codex-bench codex login --device-auth`), so no
// AGENTS.md, config, skills or memories from this machine reach the model.
//
// Cursor can't take its own tools away, so its sessions get permissions that
// block them (shell, files, web, other servers) and allow only the cube
// server. A blocked attempt is noted in the log; one that went through (a
// shell command, a web search, a file read outside the empty session folder)
// breaks the lockdown. Cursor's file searches can't be blocked; one by name
// (glob, ls) shows names only, since reading is blocked, so it is noted and
// play goes on. Grok 4.7 lost four suites hunting for the picture's file. Its config and data live in the runner's own folder
// (cursor.mjs), and its background worker is stopped with the session.
//
// Muse Code sessions get the cube tools by name and contributor mode off
// (muse.mjs). Its stream names each tool call and the model behind each reply;
// the session's export, read once it ends, has the arguments, the tokens and
// the toolset every request offered, which is checked again.

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createWriteStream, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';
import { tieToRunner, treeKiller } from './children.mjs';
import { takeCodexSession } from './codex-session.mjs';
import { commandFor } from './command.mjs';
import { sameCursorModel } from './cursor.mjs';
import { playApiSession } from './harness-api.mjs';
import { MUSE_CUBE, MUSE_FATAL, exportMuseSession, forgetMuseSession, museCommand, sameMuseModel } from './muse.mjs';
import { SYSTEM } from './system.mjs';

export { SYSTEM } from './system.mjs';

/** Sent with every call to the site, which turns away a runner too old for the suites it serves. */
export const RUNNER_VERSION = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;

/**
 * Calls to the site's runner API with the operator token or an invite code:
 * make and close suites, end, hide or annotate runs. A Buffer body is sent as
 * gzip bytes (transcripts); anything else as JSON.
 */
export function operator(url, token) {
  const site = url.replace(/\/mcp\/?$/, '');
  return async (path, body) => {
    const raw = Buffer.isBuffer(body);
    const res = await fetch(`${site}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': raw ? 'application/gzip' : 'application/json', 'X-Cube-Arena-Runner': RUNNER_VERSION },
      body: raw ? body : body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${path}: ${res.status} ${json.error ?? ''}`);
    return json;
  };
}

function claudeCommand(s, work) {
  const config = join(work, 'mcp.json');
  writeFileSync(
    config,
    JSON.stringify({ mcpServers: { 'cube-arena': { type: 'http', url: s.url, headers: { Authorization: `Bearer ${s.token}`, ...s.headers } } } }),
    { mode: 0o600 },
  );
  // --tools '' leaves no built-in tools; --setting-sources local reads settings
  // only from the (empty) working directory, so no CLAUDE.md, plugins or hooks
  // from this machine reach the model. (--safe-mode would also drop the cube server.)
  const args = ['-p', s.prompt, '--model', s.model, '--system-prompt', SYSTEM, '--tools', ''];
  if (s.effort) args.push('--effort', s.effort);
  args.push('--strict-mcp-config', '--mcp-config', config, '--allowedTools', 'mcp__cube-arena');
  args.push('--output-format', 'stream-json', '--verbose', '--no-session-persistence', '--setting-sources', 'local');
  // Claude Code caps one reply below some models' own maximum (64k for Opus 5.5,
  // which can write 128k). Asking for more than any model allows gets each model
  // its own maximum: Claude Code lowers the value to the model's limit.
  return { cmd: 'claude', args, env: { ...process.env, CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(MAX_OUTPUT_TOKENS) } };
}

// Everything Codex could use besides the cube server, switched off. With
// code_mode_host off, its JavaScript exec tool only returns an error, and the
// cube tools are called directly.
const CODEX_OFF = [
  'memories', 'shell_tool', 'unified_exec', 'unified_exec_tty', 'apps', 'browser_use', 'browser_use_external', 'computer_use', 'image_generation',
  'multi_agent', 'plugins', 'code_mode_host', 'in_app_browser', 'hooks', 'view_image', 'tool_suggest', 'skill_search', 'goals', 'sleep_tool',
  'skill_mcp_dependency_install', 'workspace_dependencies',
];

function codexCommand(s, work) {
  const instructions = join(work, 'instructions.md');
  writeFileSync(instructions, `${SYSTEM}\n`);
  const toml = JSON.stringify; // a JSON string is a valid TOML basic string
  const table = `{${Object.entries(s.headers)
    .map(([k, v]) => `${toml(k)}=${toml(String(v))}`)
    .join(',')}}`;
  // Not --ephemeral: the session file has the tokens if the session is stopped (codex-session.mjs).
  const args = ['exec', '--json', '--skip-git-repo-check', '--ignore-user-config', '--ignore-rules', '-s', 'read-only'];
  args.push('-m', s.model);
  if (s.effort) args.push('-c', `model_reasoning_effort=${toml(s.effort)}`);
  for (const f of CODEX_OFF) args.push('--disable', f);
  args.push('-c', 'agents.enabled=false', '-c', 'web_search="disabled"', '-c', 'project_doc_max_bytes=0');
  args.push('-c', `model_instructions_file=${toml(instructions)}`);
  args.push('-c', 'features.code_mode.direct_only_tool_namespaces=["mcp__cube_arena"]');
  args.push('-c', `mcp_servers.cube-arena.url=${toml(s.url)}`);
  args.push('-c', 'mcp_servers.cube-arena.bearer_token_env_var="CUBE_OPERATOR_TOKEN"');
  args.push('-c', `mcp_servers.cube-arena.http_headers=${table}`);
  args.push(s.prompt);
  return { cmd: 'codex', args, env: { ...process.env, CUBE_OPERATOR_TOKEN: s.token, CODEX_HOME: s.codexHome } };
}

// What a Cursor session may do: the cube server's tools, nothing else.
export const CURSOR_PERMISSIONS = {
  allow: ['Mcp(cube-arena:*)'],
  deny: ['Shell(*)', 'Read(**)', 'Read(/**)', 'Write(**)', 'Write(/**)', 'WebFetch(*)'],
};

function cursorCommand(s, work) {
  // The session folder is the project: its .cursor/ holds the permissions and
  // the cube server. The invite code stays out of the file (${env:...}).
  mkdirSync(join(work, '.cursor'));
  writeFileSync(join(work, '.cursor', 'cli.json'), JSON.stringify({ permissions: CURSOR_PERMISSIONS }));
  const headers = { Authorization: 'Bearer ${env:CUBE_ARENA_TOKEN}', ...s.headers };
  writeFileSync(join(work, '.cursor', 'mcp.json'), JSON.stringify({ mcpServers: { 'cube-arena': { url: s.url, headers } } }));
  // Cursor's global config, in the runner's folder: the same permissions, and
  // whatever Cursor keeps there itself (it remembers the last model).
  const config = join(s.cursorHome, 'config');
  const data = join(s.cursorHome, 'data');
  mkdirSync(config, { recursive: true });
  mkdirSync(data, { recursive: true });
  let kept = {};
  try {
    kept = JSON.parse(readFileSync(join(config, 'cli-config.json'), 'utf8'));
  } catch {
    // first session
  }
  writeFileSync(join(config, 'cli-config.json'), JSON.stringify({ version: 1, ...kept, permissions: CURSOR_PERMISSIONS }), { mode: 0o600 });
  // No system prompt option: the rules lead the prompt.
  const args = ['-p', `${SYSTEM}\n\n${s.prompt}`, '--output-format', 'stream-json', '--model', s.model, '--trust', '--approve-mcps'];
  return { cmd: s.cursorBin, args, env: { ...process.env, CURSOR_CONFIG_DIR: config, CURSOR_DATA_DIR: data, CUBE_ARENA_TOKEN: s.token } };
}

function museCommandFor(s, sessionId) {
  const { args, env } = museCommand(s, sessionId, SYSTEM);
  return { cmd: 'muse', args, env: { ...process.env, ...env } };
}

/** Cursor's bookkeeping tools: they read or write nothing outside the session. */
const CURSOR_HARMLESS = new Set(['getMcpToolsToolCall', 'updateTodosToolCall', 'readTodosToolCall', 'partialToolCall', 'truncatedToolCall']);
/** Cursor's tools that look at files, and the argument naming where. */
const CURSOR_LOOKS = { grepToolCall: 'path', globToolCall: 'targetDirectory', lsToolCall: 'path', readToolCall: 'path', semSearchToolCall: 'path' };
/** Those that see only file names: with reading blocked, they can't reach anything in a file. */
const CURSOR_NAMES_ONLY = new Set(['globToolCall', 'lsToolCall']);

// Transcripts keep everything but the pictures, which the site can redraw.
/** The model name on messages Claude Code writes itself: API errors, usage limits. */
export const SYNTHETIC = '<synthetic>';
/** More than any Claude model's output limit, so each gets its own. */
export const MAX_OUTPUT_TOKENS = 1_000_000;
/** Claude Code's notice that one reply ran past the model's output token maximum. */
export const OUTPUT_CAP = /exceeded the \d+ output token maximum/i;

export const slim = (line) => line.replace(/"data":"[A-Za-z0-9+/=]{200,}"/g, (m) => `"data":"<${m.length - 9} base64 chars>"`);

/**
 * Plays one session. `s`: { agent ('claude' | 'codex' | 'cursor' | 'muse' | 'api'), model, effort,
 * prompt, headers, url, token, codexHome, logPath, api? }. Nothing times the
 * model out. Resolves when the agent is done, after any run it left open is
 * dealt with, its usage is recorded, a lockdown breach is hidden, and (with
 * `s.transcript`) the session's digest is uploaded for audit.
 *
 * A run left open ends as given up when the model ended it (`out.quit`: it
 * stopped playing, or ran past an output or turn limit). Ended any other way
 * (an API error, a crash), the run stays open and `out.retry` says why, so the
 * same test can be picked up again: that ending says nothing about the model.
 */
export async function playSession(s) {
  const out = s.agent === 'api' ? await playApiSession(s) : await playCli(s);
  await afterSession(s, out);
  return out;
}

/** The operator side of a finished session. Failures are reported, not thrown. */
async function afterSession(s, out) {
  const call = operator(s.url, s.token);
  try {
    const quit = out.quit && !out.breach && !out.apiError;
    if (out.runId && !out.runOver && !out.breach && !quit) {
      out.retry = out.apiError ?? out.stopReason ?? `the session ended unexpectedly (exit ${out.code})`;
      console.log(`  left open (${out.retry}): the same test can pick up where the cube was left`);
    } else if (out.runId && !out.runOver) {
      const why = out.breach ? `stopped by ${out.stopReason}` : out.stopReason ? `the model stopped: ${out.stopReason}` : 'the model stopped playing before the test was over';
      await call('/api/admin/runs', { id: out.runId, stop: true, quit, reason: why });
      console.log(`  run over (${why})`);
    } else if (!out.runId && out.apiError) {
      out.retry = out.apiError;
    }
    if (out.runId) await call('/api/admin/runs', { id: out.runId, usage: out.usage });
    if (out.runId && out.breach) {
      await call('/api/admin/runs', { id: out.runId, hidden: true, reason: `runner lockdown: ${out.breach}` });
      console.log('  hidden from the boards');
    }
    if (out.runId && s.transcript) {
      const digest = { model: s.model, effort: s.effort ?? null, agent: s.agent, minutes: out.minutes, stop: out.stopReason, breach: out.breach, usage: out.usage, events: out.events };
      let gz = gzipSync(JSON.stringify(digest));
      // Keep under the server's limit: drop the longest thoughts first.
      if (gz.length > 500_000) gz = gzipSync(JSON.stringify({ ...digest, events: digest.events.map((e) => (e.kind === 'think' ? { ...e, text: e.text.slice(0, 200) } : e)) }));
      await call(`/api/admin/transcripts?run_id=${out.runId}`, gz);
    }
  } catch (e) {
    console.log(`  (operator call failed: ${e.message})`);
  }
}

function playCli(s) {
  const work = realpathSync(mkdtempSync(join(tmpdir(), 'cube-runner-')));
  const cursor = s.agent === 'cursor';
  const muse = s.agent === 'muse';
  const museId = muse ? randomUUID() : null;
  const { cmd, args, env } = s.agent === 'claude' ? claudeCommand(s, work) : cursor ? cursorCommand(s, work) : muse ? museCommandFor(s, museId) : codexCommand(s, work);
  const log = createWriteStream(s.logPath);
  const started = Date.now();
  const secs = () => `${Math.round((Date.now() - started) / 1000)}s`;
  const run = commandFor(cmd, args);
  // Cursor leaves a worker running after it exits: its own process group lets
  // the runner stop the lot.
  const group = cursor && process.platform !== 'win32';
  const child = spawn(run.file, run.args, { cwd: work, env, stdio: ['ignore', 'pipe', 'pipe'], detached: group });
  const untie = tieToRunner(treeKiller(child, group));
  const killGroup = (signal) => {
    try {
      process.kill(-child.pid, signal);
    } catch {
      // already gone
    }
  };

  const out = { runId: null, runOver: false, last: null, calls: 0, breach: null, stopReason: null, apiError: null, quit: false, retry: null, final: null, usage: {}, code: null, minutes: 0, events: [] };
  // The audit digest: what the model said and called, no pictures.
  const note = (kind, text, tool) => out.events.push({ t: Math.round((Date.now() - started) / 1000), kind, ...(tool && { tool }), text: String(text ?? '') });
  // Claude Code's session totals come with its result event. Each assistant
  // event carries its message's usage from before it streamed (output near
  // zero, thinking not counted), so those only stand in when the runner
  // stopped the session and no result came.
  const claudeUsage = new Map(); // message id → usage (stream-json repeats a message per content block)
  let claudeTotal = null;
  let codexThread = null;
  let codexReported = false;

  function stop(reason) {
    if (out.stopReason) return;
    out.stopReason = reason;
    console.log(`  stopping: ${reason}`);
    if (process.platform === 'win32') {
      // No signals on Windows: end the whole tree (Codex runs a native binary under Node).
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }).on('error', () => child.kill());
    } else if (group) {
      killGroup('SIGTERM');
      setTimeout(() => killGroup('SIGKILL'), 10_000).unref();
    } else {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 10_000).unref();
    }
  }
  child.on('error', (e) => {
    out.stopReason ??= `could not start ${cmd}: ${e.message}`;
    console.log(`  ${out.stopReason}`);
  });

  function lockdown(what) {
    if (out.breach) return;
    out.breach = what;
    stop(`lockdown broken: ${what}`);
  }

  function seeReply(text, tool) {
    note('result', text.slice(0, 300), tool);
    const first = text.split('\n')[0];
    if (first) console.log(`      → ${first.slice(0, 140)}`);
    try {
      const data = JSON.parse(text.slice(text.lastIndexOf('\n{') + 1));
      if (data.run_id) out.runId = data.run_id;
      if (data.run_status === 'finished') out.runOver = true;
      if (data.run_status === 'active') out.runOver = false;
      out.last = data;
    } catch {
      // not a game reply
    }
  }

  function seeCall(tool, input) {
    note('call', JSON.stringify(input ?? {}), tool);
    out.calls += 1;
    // Muse's stream names the tool but not its arguments (the reply shows the moves).
    console.log(`  [${secs()}] ${tool}${muse ? '' : ` ${JSON.stringify(input ?? {}).slice(0, 120)}`}`);
  }

  // Claude Code stream-json.
  function onClaude(ev) {
    if (ev.type === 'system' && ev.subtype === 'init') {
      if (ev.model !== s.model) lockdown(`asked for ${s.model}, the CLI started ${ev.model}`);
      const extra = (ev.tools ?? []).filter((t) => !t.startsWith('mcp__cube-arena__'));
      if (extra.length) lockdown(`tools besides the cube: ${extra.join(', ')}`);
    }
    if (ev.type === 'assistant' && ev.message?.model === SYNTHETIC) {
      // Claude Code's own notice (an API error, a usage limit), not a model answering.
      const text = (ev.message.content ?? []).map((p) => p.text ?? '').join(' ').trim();
      note('error', text);
      console.log(`  [${secs()}] Claude Code: ${text.slice(0, 200)}`);
      // A reply past the model's output limit is the model's own doing: the test ends there.
      if (OUTPUT_CAP.test(text)) {
        out.stopReason ??= "a reply over the model's output token limit";
        out.quit = true;
      } else out.apiError ??= text || 'an API error';
      return;
    }
    if (ev.type === 'assistant') {
      if (ev.message?.model && ev.message.model !== s.model) lockdown(`${ev.message.model} answered, not ${s.model}`);
      if (ev.message?.id && ev.message.usage) claudeUsage.set(ev.message.id, ev.message.usage);
    }
    for (const part of ev.message?.content ?? []) {
      if (ev.type === 'assistant' && part.type === 'text' && part.text) note('say', part.text);
      if (ev.type === 'assistant' && part.type === 'thinking' && part.thinking) note('think', part.thinking.slice(0, 2000));
      if (part.type === 'tool_use') {
        if (!part.name.startsWith('mcp__cube-arena__')) lockdown(`called ${part.name}`);
        seeCall(part.name.replace('mcp__cube-arena__', ''), part.input);
      }
      if (part.type === 'tool_result') seeReply((Array.isArray(part.content) ? part.content : []).find((c) => c.type === 'text')?.text ?? '');
    }
    if (ev.type === 'result') {
      // The model finished its turn: it chose to stop here.
      if (ev.subtype === 'success' && !ev.is_error) out.quit = true;
      out.final = String(ev.result ?? '');
      if (Number.isFinite(ev.total_cost_usd)) out.usage.cost_usd = ev.total_cost_usd;
      if (ev.usage) claudeTotal = ev.usage;
    }
  }

  // Codex exec --json. Only these items are expected; a shell command, file
  // change, web search or any other server's tool means the lockdown failed.
  const CODEX_OK = new Set(['agent_message', 'reasoning', 'mcp_tool_call', 'error', 'todo_list']);
  function onCodex(ev) {
    const item = ev.item;
    if (ev.type === 'thread.started') codexThread = ev.thread_id;
    if (ev.type === 'item.started' || ev.type === 'item.completed') {
      if (!CODEX_OK.has(item.type)) return lockdown(`a ${item.type} item`);
      if (item.type === 'mcp_tool_call' && item.server !== 'cube-arena') return lockdown(`called ${item.server}.${item.tool}`);
    }
    if (ev.type === 'item.started' && item.type === 'mcp_tool_call') seeCall(item.tool, item.arguments);
    if (ev.type === 'item.completed') {
      if (item.type === 'mcp_tool_call') {
        if (item.error) console.log(`      → error: ${JSON.stringify(item.error).slice(0, 140)}`);
        seeReply((item.result?.content ?? []).find((c) => c.type === 'text')?.text ?? '', item.tool);
      }
      if (item.type === 'reasoning' && item.text) note('think', item.text.slice(0, 2000));
      if (item.type === 'agent_message') {
        note('say', item.text);
        out.final = item.text;
        console.log(`  [${secs()}] says: ${item.text.replace(/\s+/g, ' ').slice(0, 160)}`);
      }
    }
    if (ev.type === 'turn.completed' && ev.usage) {
      codexReported = true;
      const u = ev.usage;
      const add = (k, v) => {
        if (Number.isFinite(v)) out.usage[k] = (out.usage[k] ?? 0) + v;
      };
      add('input_tokens', u.input_tokens);
      add('cached_input_tokens', u.cached_input_tokens);
      add('output_tokens', u.output_tokens);
      add('reasoning_tokens', u.reasoning_output_tokens);
    }
    // Codex runs one turn: completing it means the model chose to stop.
    if (ev.type === 'turn.completed') out.quit = true;
    if (ev.type === 'turn.failed') out.quit = false;
    if (ev.type === 'turn.failed' || ev.type === 'error') note('error', JSON.stringify(ev.error ?? ev.message));
    if (ev.type === 'turn.failed' || ev.type === 'error') console.log(`  [${secs()}] ${ev.type}: ${JSON.stringify(ev.error ?? ev.message).slice(0, 200)}`);
  }

  // Cursor stream-json. Its tools come in pairs of tool_call events, started
  // and completed; the completed one says whether it went through.
  let thought = '';
  const inWork = (kind, args) => {
    const key = CURSOR_LOOKS[kind];
    if (!key) return false;
    const p = resolve(work, String(args?.[key] ?? '.'));
    return p === work || p.startsWith(work + sep);
  };
  function onCursor(ev) {
    if (ev.type === 'system' && ev.subtype === 'init' && s.modelName && !sameCursorModel(ev.model, s.modelName, s.effort)) {
      lockdown(`asked for ${s.modelName}, Cursor started ${ev.model}`);
    }
    if (ev.type === 'thinking' && ev.subtype === 'delta' && ev.text) thought += ev.text;
    if (ev.type === 'thinking' && ev.subtype === 'completed' && thought) {
      note('think', thought.slice(0, 2000));
      thought = '';
    }
    if (ev.type === 'assistant') {
      const text = (ev.message?.content ?? []).map((p) => p.text ?? '').join('').trim();
      if (text) {
        note('say', text);
        out.final = text;
        console.log(`  [${secs()}] says: ${text.replace(/\s+/g, ' ').slice(0, 160)}`);
      }
    }
    if (ev.type === 'tool_call') {
      const [kind, call] = Object.entries(ev.tool_call ?? {})[0] ?? [];
      if (!kind || CURSOR_HARMLESS.has(kind)) return;
      const cube = kind === 'mcpToolCall' && call?.args?.providerIdentifier === 'cube-arena';
      if (ev.subtype === 'started') {
        if (cube) seeCall(call.args.toolName, call.args.args);
        return;
      }
      if (ev.subtype !== 'completed') return;
      const r = call?.result ?? {};
      if (cube) {
        if (r.success) seeReply((r.success.content ?? []).map((c) => c.text?.text ?? '').find(Boolean) ?? '', call.args.toolName);
        else console.log(`      → ${JSON.stringify(r).slice(0, 160)}`);
        return;
      }
      const what = `${kind.replace(/ToolCall$/, '')} ${JSON.stringify(call?.args ?? {}).slice(0, 120)}`;
      const outside = r.success && !inWork(kind, call?.args);
      if (outside && !CURSOR_NAMES_ONLY.has(kind)) return lockdown(`Cursor ran ${what}`);
      note(r.success && !outside ? 'call' : 'blocked', what);
      console.log(`  [${secs()}] ${outside ? 'looked for file names outside its folder' : r.success ? 'looked in its empty folder' : 'blocked'}: ${what}`);
    }
    if (ev.type === 'result') {
      // The model finished its turn: it chose to stop here.
      if (ev.subtype === 'success' && !ev.is_error) out.quit = true;
      out.final = String(ev.result ?? out.final ?? '');
      const u = ev.usage;
      if (u) {
        // Input counted the way OpenAI does: everything read, cached reads included.
        out.usage.input_tokens = (u.inputTokens ?? 0) + (u.cacheReadTokens ?? 0) + (u.cacheWriteTokens ?? 0);
        out.usage.cached_input_tokens = u.cacheReadTokens ?? 0;
        out.usage.output_tokens = u.outputTokens ?? 0;
      }
    }
  }

  // Muse Code exec --json. Each model reply and each tool call is a task; a
  // tool call that isn't a cube tool, or a reply from another model, breaks
  // the lockdown. Only the final reply streams; the export has the rest.
  const museTasks = new Map(); // task id → task kind
  let museSay = '';
  function onMuse(ev) {
    const p = ev.payload ?? {};
    const e = p.event ?? {};
    if (ev.payload_type !== 'run.output.delta' && museSay) {
      console.log(`  [${secs()}] says: ${museSay.replace(/\s+/g, ' ').slice(0, 160)}`);
      museSay = '';
    }
    if (ev.payload_type === 'run.model.configured' && p.model_id && !sameMuseModel(p.model_id, s.model)) lockdown(`asked for ${s.model}, Muse started ${p.model_id}`);
    if (ev.payload_type === 'task.lifecycle.proposed') {
      museTasks.set(e.task_id, e.task_kind);
      if (e.task_kind?.startsWith('tool.') && !e.task_kind.startsWith(`tool.${MUSE_CUBE}`)) lockdown(`called ${e.task_kind.slice(5)}`);
      else if (e.task_kind?.startsWith('tool.')) seeCall(e.task_kind.slice(5 + MUSE_CUBE.length));
    }
    if (ev.payload_type === 'task.lifecycle.status') {
      const facets = e.details?.facets ?? [];
      const answered = facets.find((f) => f.detail?.kind === 'provider')?.detail?.model;
      if (answered && museTasks.get(e.task_id) === 'model.meta.response' && !sameMuseModel(answered, s.model)) lockdown(`${answered} answered, not ${s.model}`);
      // A failed attempt at the model (a usage limit, an overloaded server): Muse retries it.
      const failed = facets.find((f) => f.kind === 'external_attempt' && f.error_kind && f.error_kind !== 'stream_succeeded');
      if (failed) {
        const why = `${e.message ?? 'model attempt failed'} (${failed.error_kind}${failed.http_status ? ` ${failed.http_status}` : ''})`;
        note('error', why);
        console.log(`  [${secs()}] Muse: ${why.slice(0, 200)}`);
      }
    }
    if (ev.payload_type === 'tool.result') seeReply(String(p.text ?? ''), String(p.correlation_facts?.tool_name ?? '').replace(MUSE_CUBE, ''));
    if (ev.payload_type === 'run.output.delta') museSay += p.text ?? '';
    if (ev.payload_type === 'run.terminal.completed') {
      // The model finished its turn: it chose to stop here.
      out.quit = true;
      out.final = String(p.text ?? '');
    } else if (ev.payload_type?.startsWith('run.terminal.')) {
      const why = String(p.reason ?? p.text ?? ev.payload_type).slice(0, 300);
      note('error', why);
      console.log(`  [${secs()}] Muse: ${why}`);
      if (MUSE_FATAL.test(why)) out.stopReason ??= why;
      else out.apiError ??= why;
    }
  }

  let buf = '';
  child.stdout.on('data', (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      log.write(`${slim(line)}\n`);
      let ev;
      try {
        ev = JSON.parse(line);
      } catch {
        continue;
      }
      if (s.agent === 'claude') onClaude(ev);
      else if (cursor) onCursor(ev);
      else if (muse) onMuse(ev);
      else onCodex(ev);
    }
  });
  let errText = '';
  child.stderr.on('data', (chunk) => {
    // Codex logs its disabled code-mode host on every start; that is expected.
    const text = String(chunk)
      .split('\n')
      .filter((l) => l && !/code-mode host is disabled|Reading additional input from stdin|^muse: (workspace root|Agent delegation: off|Git sandbox relaxation)/.test(l))
      .join('\n');
    if (text) process.stderr.write(`${text}\n`);
    if (text && errText.length < 2000) errText += `${text}\n`;
  });

  /** Muse's export: the digest with arguments and reasoning, the tokens, and the lockdown checked again. */
  function afterMuse(code) {
    if (museSay) console.log(`  [${secs()}] says: ${museSay.replace(/\s+/g, ' ').slice(0, 160)}`);
    const fatal = errText.split('\n').find((l) => MUSE_FATAL.test(l));
    if (fatal) out.stopReason ??= fatal.replace(/^muse: /, '').slice(0, 300);
    const x = exportMuseSession(museId, join(work, 'export.json'), started);
    if (!x) {
      console.log('  (could not read the Muse session export: no token counts for this session)');
    } else {
      Object.assign(out.usage, x.usage);
      if (x.events.length) out.events = [...x.events, ...out.events.filter((e) => e.kind === 'error')].sort((a, b) => a.t - b.t);
      const extra = x.tools.filter((t) => !t.startsWith(MUSE_CUBE));
      if (extra.length) lockdown(`tools besides the cube: ${extra.join(', ')}`);
      const other = x.models.filter((m) => !sameMuseModel(m, s.model));
      if (other.length) lockdown(`${other.join(', ')} answered, not ${s.model}`);
      forgetMuseSession(museId, x.sessionLog);
    }
    // Ended without a final reply and nothing said why: Muse's doing, not the model's.
    if (!out.quit && !out.stopReason && !out.breach && !out.apiError) {
      out.apiError = errText.trim().split('\n').find((l) => /error|limit|usage|denied|failed/i.test(l))?.slice(0, 300) ?? `Muse Code exited ${code}`;
    }
  }

  return new Promise((resolve) => {
    child.on('close', (code) => {
      log.end();
      out.code = code;
      if (muse) afterMuse(code);
      rmSync(work, { recursive: true, force: true, maxRetries: 5 });
      if (cursor && group) killGroup('SIGTERM');
      untie();
      if (cursor) {
        // Cursor's chats and per-folder state for this session: the log has it all.
        for (const d of [join(s.cursorHome, 'config', 'chats'), join(s.cursorHome, 'data', 'projects')]) rmSync(d, { recursive: true, force: true, maxRetries: 5 });
        // No result means Cursor gave up, not the model: a usage limit, a network error.
        if (!out.quit && !out.stopReason && !out.breach) {
          out.apiError ??= errText.trim().split('\n').find((l) => /error|limit|usage|denied|failed/i.test(l))?.slice(0, 300) ?? (errText.trim().split('\n')[0]?.slice(0, 300) || null);
        }
      }
      out.minutes = (Date.now() - started) / 60_000;
      if (s.agent === 'claude') {
        // Input counted the way OpenAI does: everything read, cached reads included.
        for (const u of claudeTotal ? [claudeTotal] : claudeUsage.values()) {
          const read = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
          out.usage.input_tokens = (out.usage.input_tokens ?? 0) + read;
          out.usage.cached_input_tokens = (out.usage.cached_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
          out.usage.output_tokens = (out.usage.output_tokens ?? 0) + (u.output_tokens ?? 0);
        }
        const thinking = claudeTotal?.output_tokens_details?.thinking_tokens;
        if (Number.isFinite(thinking)) out.usage.reasoning_tokens = thinking;
      } else if (!cursor) {
        // Stopped before its turn completed, Codex reported no tokens: its session file has them.
        const saved = takeCodexSession(s.codexHome, codexThread);
        if (!codexReported && saved) Object.assign(out.usage, saved);
      }
      resolve(out);
    });
  });
}
