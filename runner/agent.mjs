// One agent session against Cube Arena: Claude Code, Codex or a model called
// directly over an API (harness-api.mjs), locked down to the cube tools and
// watched as it plays. Used by run.mjs (one run) and play-suite.mjs (one fresh
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

import { spawn } from 'node:child_process';
import { createWriteStream, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { commandFor } from './command.mjs';
import { playApiSession } from './harness-api.mjs';
import { SYSTEM } from './system.mjs';

export { SYSTEM } from './system.mjs';

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
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': raw ? 'application/gzip' : 'application/json' },
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
  'shell_tool', 'unified_exec', 'unified_exec_tty', 'apps', 'browser_use', 'browser_use_external', 'computer_use', 'image_generation',
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
  const args = ['exec', '--json', '--ephemeral', '--skip-git-repo-check', '--ignore-user-config', '--ignore-rules', '-s', 'read-only'];
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

// Transcripts keep everything but the pictures, which the site can redraw.
/** The model name on messages Claude Code writes itself: API errors, usage limits. */
const SYNTHETIC = '<synthetic>';
/** More than any Claude model's output limit, so each gets its own. */
const MAX_OUTPUT_TOKENS = 1_000_000;
/** Claude Code's notice that one reply ran past the model's output token maximum. */
const OUTPUT_CAP = /exceeded the \d+ output token maximum/i;

const slim = (line) => line.replace(/"data":"[A-Za-z0-9+/=]{200,}"/g, (m) => `"data":"<${m.length - 9} base64 chars>"`);

/**
 * Plays one session. `s`: { agent ('claude' | 'codex' | 'api'), model, effort,
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
  const work = mkdtempSync(join(tmpdir(), 'cube-runner-'));
  const { cmd, args, env } = s.agent === 'claude' ? claudeCommand(s, work) : codexCommand(s, work);
  const log = createWriteStream(s.logPath);
  const started = Date.now();
  const secs = () => `${Math.round((Date.now() - started) / 1000)}s`;
  const run = commandFor(cmd, args);
  const child = spawn(run.file, run.args, { cwd: work, env, stdio: ['ignore', 'pipe', 'pipe'] });

  const out = { runId: null, runOver: false, last: null, calls: 0, breach: null, stopReason: null, apiError: null, quit: false, retry: null, final: null, usage: {}, code: null, minutes: 0, events: [] };
  // The audit digest: what the model said and called, no pictures.
  const note = (kind, text, tool) => out.events.push({ t: Math.round((Date.now() - started) / 1000), kind, ...(tool && { tool }), text: String(text ?? '') });
  // Claude Code's session totals come with its result event. Each assistant
  // event carries its message's usage from before it streamed (output near
  // zero, thinking not counted), so those only stand in when the runner
  // stopped the session and no result came.
  const claudeUsage = new Map(); // message id → usage (stream-json repeats a message per content block)
  let claudeTotal = null;

  function stop(reason) {
    if (out.stopReason) return;
    out.stopReason = reason;
    console.log(`  stopping: ${reason}`);
    if (process.platform === 'win32') {
      // No signals on Windows: end the whole tree (Codex runs a native binary under Node).
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }).on('error', () => child.kill());
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
    console.log(`  [${secs()}] ${tool} ${JSON.stringify(input ?? {}).slice(0, 120)}`);
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
      else onCodex(ev);
    }
  });
  child.stderr.on('data', (chunk) => {
    // Codex logs its disabled code-mode host on every start; that is expected.
    const text = String(chunk)
      .split('\n')
      .filter((l) => l && !/code-mode host is disabled|Reading additional input from stdin/.test(l))
      .join('\n');
    if (text) process.stderr.write(`${text}\n`);
  });

  return new Promise((resolve) => {
    child.on('close', (code) => {
      log.end();
      rmSync(work, { recursive: true, force: true, maxRetries: 5 });
      out.code = code;
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
      }
      resolve(out);
    });
  });
}
