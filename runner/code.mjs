// The coding benchmark from the runner's side: a model writes its own 5x5
// solver in a workspace on this machine, then the solver/ folder is frozen and
// sent to Cube Arena, which grades it on hidden cubes on its own machine.
//
// The model works in Claude Code or Codex with files and a shell, sandboxed by
// the CLI itself: it can write only inside its workspace, and its commands get
// no network (no packages, no downloaded solvers). No web tools, no MCP, no
// subagents; anything else showing up stops the session and hides the
// submission. It has CODE.devHours of wall-clock time over one or more
// sessions: the model ending its session ends the coding (that is its call); a
// session cut off any other way (an API error, a usage limit, a crash) is
// picked up again after a wait, with the files as they were and the time
// spent waiting not counted.

import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { MAX_OUTPUT_TOKENS, OUTPUT_CAP, SYNTHETIC, operator, slim } from './agent.mjs';
import { WORKSPACE_ENV, endLeftovers, tieToRunner, treeKiller } from './children.mjs';
import { takeCodexSession } from './codex-session.mjs';
import { commandFor } from './command.mjs';
import { listFiles, tarGz } from './tar.mjs';

const RETRY_MINUTES = [1, 5, 15, 30, 60];
const RETRY_HOURS = 12;
const HEARTBEAT_MS = 5 * 60_000;

/** Claude Code tools the model gets, and the harmless helpers it may also see. */
const CLAUDE_TOOLS = ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'TodoWrite'];
const CLAUDE_OK = new Set([...CLAUDE_TOOLS, 'MultiEdit', 'LS', 'BashOutput', 'KillShell', 'KillBash']);
/** Codex items expected in a coding session; a web search or any MCP call means the lockdown failed. */
const CODEX_OK = new Set(['agent_message', 'reasoning', 'command_execution', 'file_change', 'todo_list', 'error']);
const CODEX_OFF = [
  'memories', 'apps', 'browser_use', 'browser_use_external', 'computer_use', 'image_generation', 'multi_agent', 'plugins',
  'in_app_browser', 'hooks', 'view_image', 'tool_suggest', 'skill_search', 'goals', 'skill_mcp_dependency_install', 'workspace_dependencies',
];

/** Kept from the model's commands and file tools: your keys and the runner's invite code. */
const PRIVATE = ['~/.ssh', '~/.aws', '~/.gnupg', '~/.config/gcloud', '~/.cube-arena/config.json'];

/**
 * Claude Code's sandbox, strict: commands write only in the workspace (and
 * temp), reach no network at all, and Claude Code refuses to start rather than
 * run them unsandboxed when the sandbox can't (it would otherwise fall open).
 */
const CLAUDE_SETTINGS = {
  sandbox: {
    enabled: true,
    failIfUnavailable: true,
    autoAllowBashIfSandboxed: true,
    allowUnsandboxedCommands: false,
    network: { allowedDomains: [], strictAllowlist: true },
    filesystem: { denyRead: PRIVATE },
  },
  permissions: { deny: ['WebFetch', 'WebSearch', ...PRIVATE.map((p) => `Read(${p}/**)`), ...PRIVATE.map((p) => `Read(${p})`)] },
  disableClaudeAiConnectors: true,
};

/**
 * Why Claude Code's sandbox can't run commands here, or null. On Linux it
 * needs bubblewrap and socat, and user namespaces inside user namespaces,
 * which Ubuntu 24.04 and later block by default (AppArmor).
 */
export function claudeSandboxProblem() {
  if (process.platform === 'darwin') return null;
  if (process.platform !== 'linux') return "Claude Code's sandbox runs on macOS and Linux only (on Windows, use WSL2).";
  const ok = (cmd, args) => spawnSync(cmd, args, { stdio: 'ignore' }).status === 0;
  if (!ok('bwrap', ['--version']) || !ok('socat', ['-V'])) return "Claude Code's sandbox needs bubblewrap and socat: sudo apt install bubblewrap socat";
  const nested = ['--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--unshare-user', '--', 'bwrap', '--ro-bind', '/', '/', '--dev', '/dev', '--unshare-user', '--', 'true'];
  if (!ok('bwrap', nested)) {
    return (
      "Claude Code's sandbox can't run commands on this machine: it blocks user namespaces inside user namespaces " +
      '(Ubuntu 24.04+ does by default, through AppArmor). Use --via codex, or a Mac, or allow bubblewrap user namespaces in AppArmor.'
    );
  }
  return null;
}

/**
 * One coding run per machine at a time: the model's builds and tests share the
 * CPU with whatever else runs there (Opus 5.5 xhigh coded beside two other runs
 * on 2026-10-14). Holds `file` until the runner exits. Returns null, or
 * { pid, id } of the run already holding it.
 */
export function claimMachine(file, id) {
  for (;;) {
    try {
      writeFileSync(file, `${JSON.stringify({ pid: process.pid, id })}\n`, { flag: 'wx' });
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let held = null;
      try {
        held = JSON.parse(readFileSync(file, 'utf8'));
      } catch {
        // half written or gone: claim it
      }
      if (held && alive(held.pid)) return held;
      rmSync(file, { force: true });
    }
  }
  process.on('exit', () => {
    try {
      if (JSON.parse(readFileSync(file, 'utf8')).pid === process.pid) rmSync(file);
    } catch {
      // gone already
    }
  });
  return null;
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

/** Puts the kit in the workspace: the spec, the reference cube, the checker, the practice cubes, and an empty solver/. */
export async function setUpWorkspace(site, dir) {
  mkdirSync(join(dir, 'solver'), { recursive: true });
  const res = await fetch(`${site}/api/code`);
  if (!res.ok) throw new Error(`could not get the kit: ${res.status}`);
  const kit = await res.json();
  if (!existsSync(join(dir, 'practice.json'))) {
    writeFileSync(join(dir, 'practice.json'), `${JSON.stringify({ version: kit.version, limits: kit.limits, practice: kit.practice }, null, 1)}\n`);
  }
  for (const url of kit.files) {
    const name = url.split('/').pop();
    if (existsSync(join(dir, name))) continue;
    const f = await fetch(url);
    if (!f.ok) throw new Error(`could not get ${name}: ${f.status}`);
    writeFileSync(join(dir, name), await f.text());
  }
  return kit;
}

const hm = (ms) => {
  const min = Math.round(ms / 60_000);
  return `${Math.floor(min / 60)} h ${min % 60} min`;
};

function promptFor(first, remainingMs, limits) {
  const deadline = new Date(Date.now() + remainingMs).toISOString().slice(0, 16).replace('T', ' ');
  const time = `You have ${hm(remainingMs)} left (until ${deadline} UTC; \`date -u\` tells the time).`;
  // Models that ended a message with a question for us took it as a pause, not the end (Haiku 5.5, 2026-10-13).
  const alone =
    'Nobody will reply during the run: ending your turn ends it and submits solver/. ' +
    'A cube solved in any number of moves beats an unsolved one (the board ranks by cubes solved first).';
  if (!first) {
    return (
      'Your last session was cut off by an error that was not your doing. Your files are exactly as you left them. ' +
      `Carry on with the Cube Arena coding benchmark (SPEC.md) where you were. ${time} ` +
      'When you are done, make sure `python3 check.py` passes, then stop: solver/ is submitted as it stands. ' +
      alone
    );
  }
  return (
    "You're taking the Cube Arena coding benchmark. Read SPEC.md in this folder first. " +
    'Write a 5x5 cube solver in solver/ that solves cubes it has never seen in as few moves as you can: ' +
    `it is graded on ${limits.cases} hidden cubes, and every move counts. Work on your own, with no internet access; ` +
    `test with \`python3 check.py\` and keep improving the move count while you have time. ${time} ` +
    'When you stop, solver/ is frozen and submitted as it stands. ' +
    alone
  );
}

const UNPACKED_MAX = 64 * 1024 * 1024;
/** Sessions the model gets to make an oversized solver/ fit, and the least time each one has. */
const PACK_FIXES = 2;
const PACK_GRACE_MS = 15 * 60_000;
const mb = (n) => `${(n / 1e6).toFixed(1)} MB`;

/** solver/ as a gzipped tar ({ gz }), or why it can't be sent and its biggest files ({ problem, biggest }). */
export function packSolver(solver, limits) {
  const files = listFiles(solver).filter((f) => !f.dir);
  const total = files.reduce((a, f) => a + f.size, 0);
  const sorted = [...files].sort((a, b) => b.size - a.size);
  const biggest = sorted.filter((f) => f.size >= 100_000).slice(0, 8);
  if (!biggest.length) biggest.push(...sorted.slice(0, 3));
  if (total > UNPACKED_MAX) return { problem: `${mb(total)} before compression`, biggest };
  try {
    const gz = tarGz(solver, UNPACKED_MAX);
    if (gz.length > limits.bundleMaxBytes) return { problem: `${mb(gz.length)} gzipped`, biggest };
    return { gz };
  } catch (e) {
    return { problem: e.message, biggest };
  }
}

export function packPrompt(packed, budgetMs, limits) {
  const deadline = new Date(Date.now() + budgetMs).toISOString().slice(0, 16).replace('T', ' ');
  return (
    `Cube Arena coding benchmark (SPEC.md): your solver/ folder can't be submitted as it stands. It is ${packed.problem}; ` +
    `the limit is ${mb(limits.bundleMaxBytes)} gzipped. Its biggest files: ${packed.biggest.map((f) => `${f.path} (${mb(f.size)})`).join(', ')}. ` +
    'build.py runs again on the grader before any cube, so the files it makes need not be in solver/: delete them, and anything else ' +
    'build.py and solve.py do not need. `python3 check.py` builds into solver/, so delete them after your last check. ' +
    `You have ${hm(budgetMs)} (until ${deadline} UTC). When solver/ fits, stop: it is then submitted as it stands.`
  );
}

function claudeCommand(s) {
  // --tools is the whole set of built-in tools; dontAsk denies anything else
  // instead of waiting on a prompt nobody can answer. No MCP, no CLAUDE.md or
  // memories from this machine.
  const args = ['-p', s.prompt, '--model', s.model, '--tools', CLAUDE_TOOLS.join(',')];
  if (s.effort) args.push('--effort', s.effort);
  args.push('--permission-mode', 'dontAsk', '--permission-prompts', 'none', '--settings', JSON.stringify(CLAUDE_SETTINGS));
  args.push('--allowedTools', ...CLAUDE_TOOLS, '--disallowedTools', 'WebFetch', 'WebSearch', 'Agent', 'NotebookEdit', 'mcp__*');
  args.push('--strict-mcp-config', '--setting-sources', 'local', '--output-format', 'stream-json', '--verbose');
  // Kept only when the runner may pick the session up again (v2's time-left message).
  if (s.resume) args.push('--resume', s.resume);
  else if (!s.persist) args.push('--no-session-persistence');
  const env = { ...process.env, [WORKSPACE_ENV]: s.dir, CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(MAX_OUTPUT_TOKENS), CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' };
  return { cmd: 'claude', args, env };
}

function codexCommand(s) {
  const toml = JSON.stringify;
  // Not --ephemeral: the session file has the tokens if the session is stopped (codex-session.mjs).
  // Picking a session up again takes no -s or -C: the sandbox goes in as config, and it runs in the workspace.
  const args = s.resume
    ? ['exec', 'resume', '--json', '--skip-git-repo-check', '--ignore-user-config', '--ignore-rules', '-c', 'sandbox_mode="workspace-write"']
    : ['exec', '--json', '--skip-git-repo-check', '--ignore-user-config', '--ignore-rules', '-s', 'workspace-write', '-C', s.dir];
  args.push('-m', s.model);
  if (s.effort) args.push('-c', `model_reasoning_effort=${toml(s.effort)}`);
  for (const f of CODEX_OFF) args.push('--disable', f);
  args.push('-c', 'agents.enabled=false', '-c', 'web_search="disabled"', '-c', 'project_doc_max_bytes=0', '-c', 'sandbox_workspace_write.network_access=false');
  if (s.resume) args.push(s.resume);
  args.push(s.prompt);
  return { cmd: 'codex', args, env: { ...process.env, [WORKSPACE_ENV]: s.dir, CODEX_HOME: s.codexHome } };
}

const short = (v, n) => {
  const t = typeof v === 'string' ? v : JSON.stringify(v ?? {});
  return t.length > n ? `${t.slice(0, n)}… (${t.length} chars)` : t;
};

/**
 * One coding session in the workspace, cut off after `budgetMs`. Resolves with
 * { quit, deadline, apiError, stopReason, breach, code, ms, usage, events }.
 */
export function codingSession(s) {
  const { cmd, args, env } = s.agent === 'claude' ? claudeCommand(s) : codexCommand(s);
  const log = createWriteStream(s.logPath);
  const started = Date.now();
  const secs = () => `${Math.round((Date.now() - started) / 1000)}s`;
  const run = commandFor(cmd, args);
  const child = spawn(run.file, run.args, { cwd: s.dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const untie = tieToRunner(treeKiller(child, false));
  const out = { quit: false, deadline: false, apiError: null, stopReason: null, breach: null, harnessError: null, code: null, ms: 0, usage: {}, events: [], sessionId: s.resume ?? null };
  const note = (kind, text, tool) => out.events.push({ t: Math.round((Date.now() - started) / 1000), kind, ...(tool && { tool }), text: String(text ?? '') });
  const claudeUsage = new Map();
  let claudeTotal = null;
  let codexThread = null;
  let codexReported = false;

  function stop(reason) {
    if (out.stopReason) return;
    out.stopReason = reason;
    console.log(`  stopping: ${reason}`);
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }).on('error', () => child.kill());
    else {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 10_000).unref();
    }
  }
  const timer = setTimeout(() => {
    out.deadline = true;
    stop(`the ${hm(s.budgetMs)} left of coding time ran out`);
  }, s.budgetMs);
  child.on('error', (e) => {
    out.stopReason ??= `could not start ${cmd}: ${e.message}`;
    console.log(`  ${out.stopReason}`);
  });
  function lockdown(what) {
    if (out.breach) return;
    out.breach = what;
    note('error', `lockdown broken: ${what}`);
    stop(`lockdown broken: ${what}`);
  }
  const say = (text) => {
    note('say', text);
    console.log(`  [${secs()}] says: ${text.replace(/\s+/g, ' ').slice(0, 160)}`);
  };

  function onClaude(ev) {
    if (ev.type === 'system' && ev.subtype === 'init') {
      if (ev.session_id) out.sessionId = ev.session_id;
      if (ev.model !== s.model) lockdown(`asked for ${s.model}, the CLI started ${ev.model}`);
      const extra = (ev.tools ?? []).filter((t) => !CLAUDE_OK.has(t));
      if (extra.length) lockdown(`tools besides files and the shell: ${extra.join(', ')}`);
      if ((ev.mcp_servers ?? []).length) lockdown(`MCP servers: ${ev.mcp_servers.map((m) => m.name).join(', ')}`);
    }
    if (ev.type === 'assistant' && ev.message?.model === SYNTHETIC) {
      const text = (ev.message.content ?? []).map((p) => p.text ?? '').join(' ').trim();
      note('error', text);
      console.log(`  [${secs()}] Claude Code: ${text.slice(0, 200)}`);
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
      if (ev.type === 'assistant' && part.type === 'text' && part.text) say(part.text);
      if (ev.type === 'assistant' && part.type === 'thinking' && part.thinking) note('think', part.thinking.slice(0, 2000));
      if (part.type === 'tool_use') {
        if (!CLAUDE_OK.has(part.name)) lockdown(`called ${part.name}`);
        const what = part.name === 'Bash' ? part.input?.command : part.input?.file_path ?? part.input?.pattern ?? part.input;
        note('call', part.name === 'Bash' || part.name === 'Read' || part.name === 'Glob' || part.name === 'Grep' ? short(what, 2000) : short(part.input, 3000), part.name);
        console.log(`  [${secs()}] ${part.name} ${short(what, 110).replace(/\s+/g, ' ')}`);
      }
      if (part.type === 'tool_result') {
        const text = Array.isArray(part.content) ? part.content.map((c) => c.text ?? '').join('\n') : String(part.content ?? '');
        note('result', text.slice(0, 600));
        // The sandbox failing on every command is this machine's problem, not the model's: stop before it gives up.
        if (/apply-seccomp|nested userns is capability-restricted|No permissions to create a new namespace/.test(text)) {
          out.harnessError ??= "Claude Code's sandbox can't run commands on this machine";
          stop(out.harnessError);
        }
      }
    }
    if (ev.type === 'result') {
      if (ev.subtype === 'success' && !ev.is_error) out.quit = true;
      if (Number.isFinite(ev.total_cost_usd)) out.usage.cost_usd = ev.total_cost_usd;
      if (ev.usage) claudeTotal = ev.usage;
    }
  }

  function onCodex(ev) {
    const item = ev.item;
    if (ev.type === 'thread.started') codexThread = out.sessionId = ev.thread_id;
    if (ev.type === 'item.started' || ev.type === 'item.completed') {
      if (!CODEX_OK.has(item.type)) return lockdown(`a ${item.type} item`);
    }
    if (ev.type === 'item.started' && item.type === 'command_execution') {
      note('call', short(item.command, 2000), 'shell');
      console.log(`  [${secs()}] $ ${short(item.command, 120).replace(/\s+/g, ' ')}`);
    }
    if (ev.type === 'item.completed') {
      if (item.type === 'command_execution') note('result', `exit ${item.exit_code ?? '?'}: ${String(item.aggregated_output ?? '').slice(0, 600)}`, 'shell');
      if (item.type === 'file_change') {
        const files = (item.changes ?? []).map((c) => `${c.kind} ${c.path}`).join(', ');
        note('call', files, 'edit');
        console.log(`  [${secs()}] edit ${short(files, 120)}`);
      }
      if (item.type === 'reasoning' && item.text) note('think', item.text.slice(0, 2000));
      if (item.type === 'agent_message') say(item.text);
    }
    if (ev.type === 'turn.completed') {
      out.quit = true;
      if (ev.usage) codexReported = true;
      const u = ev.usage ?? {};
      const add = (k, v) => {
        if (Number.isFinite(v)) out.usage[k] = (out.usage[k] ?? 0) + v;
      };
      add('input_tokens', u.input_tokens);
      add('cached_input_tokens', u.cached_input_tokens);
      add('output_tokens', u.output_tokens);
      add('reasoning_tokens', u.reasoning_output_tokens);
    }
    if (ev.type === 'turn.failed') {
      out.quit = false;
      out.apiError ??= short(ev.error?.message ?? ev.error, 300);
    }
    if (ev.type === 'turn.failed' || ev.type === 'error') {
      note('error', JSON.stringify(ev.error ?? ev.message));
      console.log(`  [${secs()}] ${ev.type}: ${short(ev.error ?? ev.message, 200)}`);
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
      else onCodex(ev);
    }
  });
  child.stderr.on('data', (chunk) => {
    const text = String(chunk)
      .split('\n')
      .filter((l) => l && !/Reading additional input from stdin/.test(l))
      .join('\n');
    if (text) process.stderr.write(`${text}\n`);
  });

  return new Promise((resolve) => {
    child.on('close', (code) => {
      clearTimeout(timer);
      untie();
      log.end();
      out.code = code;
      out.ms = Date.now() - started;
      if (s.agent === 'claude') {
        for (const u of claudeTotal ? [claudeTotal] : claudeUsage.values()) {
          out.usage.input_tokens = (out.usage.input_tokens ?? 0) + (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
          out.usage.cached_input_tokens = (out.usage.cached_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
          out.usage.output_tokens = (out.usage.output_tokens ?? 0) + (u.output_tokens ?? 0);
        }
        const thinking = claudeTotal?.output_tokens_details?.thinking_tokens;
        if (Number.isFinite(thinking)) out.usage.reasoning_tokens = thinking;
      } else {
        // Stopped before its turn completed, Codex reported no tokens: its session file has them.
        // A session kept to be picked up again is the caller's to take (its file totals every turn).
        const saved = s.persist ? null : takeCodexSession(s.codexHome, codexThread);
        if (!codexReported && saved) Object.assign(out.usage, saved);
        out.codexReported = codexReported;
      }
      // Killed at the deadline, or ended by the model: either way the coding is over.
      if (out.deadline) out.quit = true;
      resolve(out);
    });
  });
}

/**
 * Codes, submits and (with `wait`) waits for the grade.
 * p: { site, token, submission, session: { agent, model, effort, codexHome }, dir, stateFile, logDir, limits, transcript, wait }
 * Returns { breach } | { stopped } | { submission }.
 */
export async function playCoding(p) {
  const call = operator(p.site, p.token);
  const id = p.submission.id;
  const budget = p.limits.devHours * 3_600_000;
  const state = existsSync(p.stateFile) ? JSON.parse(readFileSync(p.stateFile, 'utf8')) : { usedMs: 0, sessions: 0 };
  const eventsFile = `${p.stateFile.replace(/\.json$/, '')}.events.jsonl`;
  const save = () => writeFileSync(p.stateFile, `${JSON.stringify(state)}\n`);
  mkdirSync(p.logDir, { recursive: true });

  const beat = () => call('/api/code/submissions', { id, alive: true }).catch((e) => console.log(`  (heartbeat failed: ${e.message})`));
  beat();
  const heart = setInterval(beat, HEARTBEAT_MS);
  // Nothing the model started runs on after its session, or after the runner.
  const sweep = (when) => {
    const ended = endLeftovers(p.dir);
    if (!ended.length) return;
    const what = ended.map((e) => short(e.command, 80)).join('; ');
    console.log(`  ended ${ended.length} program${ended.length > 1 ? 's' : ''} the model left running ${when}: ${what}`);
    appendFileSync(eventsFile, `${JSON.stringify({ session: state.sessions, t: 0, kind: 'note', text: `ended what it left running ${when}: ${what}` })}\n`);
  };
  const untie = tieToRunner(() => endLeftovers(p.dir));
  sweep('from an earlier session');
  let waited = 0;
  // One session of the agent, its time, usage and events recorded. Returns { r }, or { end } when that ends the run.
  const runSession = async (prompt, budgetMs) => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const r = await codingSession({
      ...p.session,
      dir: p.dir,
      prompt,
      budgetMs,
      logPath: join(p.logDir, `${stamp}-${p.session.model}-${p.session.effort ?? 'default'}-code-${state.sessions + 1}.jsonl`),
    });
    state.usedMs += r.ms;
    state.sessions += 1;
    save();
    for (const e of r.events) appendFileSync(eventsFile, `${JSON.stringify({ session: state.sessions, ...e })}\n`);
    sweep('when the session ended');
    const cost = r.usage.cost_usd !== undefined ? `, $${r.usage.cost_usd.toFixed(2)}` : '';
    console.log(`  session over after ${(r.ms / 60_000).toFixed(1)} min${cost} (${hm(state.usedMs)} used of ${p.limits.devHours} h)`);
    await call('/api/code/submissions', { id, usage: r.usage, dev_minutes: state.usedMs / 60_000 }).catch((e) => console.log(`  (could not record usage: ${e.message})`));

    if (r.breach) {
      await call('/api/code/submissions', { id, hidden: true, reason: `runner lockdown: ${r.breach}` }).catch(() => {});
      await uploadTranscript(call, id, p, eventsFile, state);
      console.log(`!!! lockdown broken (${r.breach}); the submission is hidden. Stopping.`);
      return { end: { breach: r.breach } };
    }
    if (r.harnessError) {
      console.log(`!!! ${r.harnessError}. Stopping; fix that and carry on within 30 minutes with --resume ${id}`);
      return { end: { stopped: r.harnessError } };
    }
    return { r };
  };

  const solver = join(p.dir, 'solver');
  let packed;
  try {
    for (let tries = 0; !state.ended; tries++) {
      const remaining = budget - state.usedMs;
      if (remaining < 60_000) break;
      console.log(`\n=== coding session ${state.sessions + 1}: ${hm(remaining)} left ===`);
      const { r, end } = await runSession(promptFor(state.sessions === 0, remaining, p.limits), remaining);
      if (end) return end;
      if (r.quit && !r.apiError) {
        state.ended = true;
        save();
        break;
      }
      // Not the model's doing: the files wait as they are, and a fresh session carries on.
      const why = r.apiError ?? r.stopReason ?? `the agent ended unexpectedly (exit ${r.code})`;
      const wait = RETRY_MINUTES[Math.min(tries, RETRY_MINUTES.length - 1)];
      if (waited + wait > RETRY_HOURS * 60) {
        console.log(`!!! still failing after ${RETRY_HOURS} h (${why}). Stopping; carry on within 30 minutes with --resume ${id}`);
        return { stopped: why };
      }
      console.log(`  not the model's doing (${why}). Carrying on in ${wait} min; the files stay as they are.`);
      await new Promise((res) => setTimeout(res, wait * 60_000));
      waited += wait;
    }

    // solver/ goes as it stands, unless it's too big to send: usually tables
    // and binaries from build.py, which check.py runs in place. The model gets
    // a session to clear them, from its own time or, once that's gone, a few
    // minutes past it.
    packed = packSolver(solver, p.limits);
    for (let fix = 1; packed.problem && fix <= PACK_FIXES; fix++) {
      const budgetMs = Math.max(budget - state.usedMs, PACK_GRACE_MS);
      console.log(`\n=== solver/ is too big to send (${packed.problem}). Session ${state.sessions + 1} to fix that: ${hm(budgetMs)} ===`);
      const { end } = await runSession(packPrompt(packed, budgetMs, p.limits), budgetMs);
      if (end) return end;
      packed = packSolver(solver, p.limits);
    }
  } finally {
    clearInterval(heart);
    untie();
  }

  await uploadTranscript(call, id, p, eventsFile, state);
  if (packed.problem) {
    console.log(`!!! solver/ is still too big to send (${packed.problem}). Delete what build.py makes, then carry on within 30 minutes with --resume ${id}`);
    return { stopped: `solver/ is too big: ${packed.problem}` };
  }
  const gz = packed.gz;
  // The solver is published: never with the runner's invite code in it.
  if (p.token && gunzipSync(gz).includes(Buffer.from(p.token))) {
    console.log('!!! solver/ contains your invite code. Not sending it; remove it and carry on with --resume.');
    return { stopped: 'the invite code is in solver/' };
  }
  if (!existsSync(join(solver, 'solve.py'))) console.log('  note: there is no solver/solve.py, so every cube will score 0.');
  const { submission } = await call(`/api/code/files?id=${id}&kind=bundle`, gz);
  console.log(`\nsolver/ frozen and sent (${gz.length} bytes, sha256 ${submission.bundle_sha256.slice(0, 12)}). Grading happens on our machine.`);
  return { submission: p.wait ? await waitForGrade(call, id, p.wait) : submission };
}

async function uploadTranscript(call, id, p, eventsFile, state) {
  if (!p.transcript || !existsSync(eventsFile)) return;
  const events = readFileSync(eventsFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const digest = { model: p.session.model, effort: p.session.effort ?? null, agent: p.session.agent, minutes: state.usedMs / 60_000, sessions: state.sessions, events };
  let gz = gzipSync(JSON.stringify(digest));
  if (gz.length > 2_000_000) gz = gzipSync(JSON.stringify({ ...digest, events: events.map((e) => ({ ...e, text: e.text.slice(0, 300) })) }));
  await call(`/api/code/files?id=${id}&kind=transcript`, gz).catch((e) => console.log(`  (could not upload the transcript: ${e.message})`));
}

/** Polls until the grader is done (or `minutes` pass). */
export async function waitForGrade(call, id, minutes) {
  const until = Date.now() + minutes * 60_000;
  let last = '';
  for (;;) {
    const { submission } = await call(`/api/code/submissions?id=${id}`).catch(() => ({ submission: null }));
    if (submission && submission.status !== last) {
      last = submission.status;
      console.log(`  ${new Date().toISOString().slice(11, 19)} ${last}`);
    }
    if (submission && ['graded', 'failed'].includes(submission.status)) return submission;
    if (Date.now() > until) return submission;
    await new Promise((r) => setTimeout(r, 30_000));
  }
}
