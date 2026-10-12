import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MUSE_FATAL, exportRecords, forgetMuseSession, museCommand, readMuseExport, sameMuseModel } from '../runner/muse.mjs';

const session = {
  model: 'muse-wonder-1.0',
  effort: 'high',
  prompt: '-starts like a flag',
  url: 'https://cube.krnl.studio/mcp',
  token: 'SECRET-TOKEN',
  headers: { 'x-arena-model': 'Muse Wonder (high)', 'x-arena-suite-slot': '0' },
};

describe('Muse Code command', () => {
  const { args, env } = museCommand(session, '7f1c0f4e-0000-4000-8000-000000000000', 'SYSTEM TEXT');
  const settings = Object.fromEntries(args.flatMap((a, i) => (args[i - 1] === '-c' ? [a.split(/=(.*)/s).slice(0, 2)] : [])));

  it('turns contributor mode off and everything but the cube tools', () => {
    expect(args.slice(0, 2)).toEqual(['exec', '--json']);
    expect(args[args.indexOf('--contributor-mode') + 1]).toBe('off');
    expect(args[args.indexOf('--model') + 1]).toBe('muse-wonder-1.0');
    expect(args[args.indexOf('--effort') + 1]).toBe('high');
    for (const flag of ['--disable-shell', '--disable-write', '--disable-web-tools', '--disable-reminders', '--no-foreign-personal-context']) expect(args).toContain(flag);
    expect(JSON.parse(settings['run.toolset'])).toEqual(['mcp__cube_arena__*']);
    expect(JSON.parse(settings['run.subagent_delegation_mode'])).toBe('off');
    expect(JSON.parse(settings['context.foreign_personal_rules'])).toBe(false);
    expect(JSON.parse(settings['run.system_prompt'])).toBe('SYSTEM TEXT');
  });

  it('keeps the invite code and header values out of the arguments', () => {
    const server = JSON.parse(settings['mcp_servers.cube-arena']);
    expect(server).toMatchObject({ transport: 'streamable_http', url: session.url });
    for (const v of Object.values(server.headers)) expect(v).toMatch(/^\$\{[A-Z0-9_]+\}$/);
    expect(args.join(' ')).not.toContain('SECRET-TOKEN');
    expect(env[server.headers.Authorization.slice(2, -1)]).toBe('Bearer SECRET-TOKEN');
    expect(env[server.headers['x-arena-model'].slice(2, -1)]).toBe('Muse Wonder (high)');
  });

  it('passes the prompt after --, so it is never read as a flag', () => {
    expect(args.slice(-2)).toEqual(['--', '-starts like a flag']);
  });
});

describe('Muse model check', () => {
  it('accepts the model asked for or a dated snapshot of it, and nothing else', () => {
    expect(sameMuseModel('muse-wonder-1.0', 'muse-wonder-1.0')).toBe(true);
    expect(sameMuseModel('muse-wonder-1.0-20261012', 'muse-wonder-1.0')).toBe(true);
    expect(sameMuseModel('muse-wonder-1.0-contributor', 'muse-wonder-1.0')).toBe(false);
    expect(sameMuseModel('muse-spark-1.3', 'muse-wonder-1.0')).toBe(false);
    expect(sameMuseModel('muse-wonder-1x0', 'muse-wonder-1.0')).toBe(false);
  });

  it('knows the failures waiting will not fix', () => {
    expect(MUSE_FATAL.test('missing meta credentials: run `muse login` or set META_API_KEY')).toBe(true);
    expect(MUSE_FATAL.test('model muse-wonder-full-1.0 does not exist or you lack access')).toBe(true);
    expect(MUSE_FATAL.test('429 rate limited, retry later')).toBe(false);
  });
});

// Records as `muse export` writes them (Muse Code 1.4.6), trimmed.
const T0 = 1_791_830_640_000; // ms
const rec = (s: number, event: object) => ({ kind: 'record', recorded_at: (T0 + s * 1000) * 1000, envelope: { recorded_at: (T0 + s * 1000) * 1000, payload: { event } } });
const EXPORT = {
  events: [
    { kind: 'retained_frame', envelope: { children: [] } },
    rec(1, {
      kind: 'model_request_configured',
      toolset: { active_tools: ['mcp__cube_arena__get_rules', 'mcp__cube_arena__turn'], mode: 'named' },
      run_context_messages: [{ id: 'session_identity', text: 'Current session id: abc\nCurrent session log: /home/x/.local/share/muse/sessions/2026/10/13/abc/session.jsonl\n' }],
    }),
    rec(3, { kind: 'model_completed', model: 'muse-wonder-1.0', usage: { input_tokens: 7108, cached_tokens: 0, output_tokens: 191, reasoning_tokens: 53 } }),
    rec(3, { kind: 'assistant_tool_calls_committed', tool_calls: [{ args: '{"size":2}', call_id: 'c1', name: 'mcp__cube_arena__start_run' }] }),
    rec(4, { kind: 'tool_result_batch_committed', results: [{ text: 'Run started.\n[MCP image content: media_type=image/png, bytes=78993]' }] }),
    rec(10, { kind: 'reasoning_summary_committed', text: 'Reading the faces.' }),
    rec(10, { kind: 'assistant_message_committed', text: 'White on top.' }),
    rec(11, { kind: 'model_completed', model: 'muse-wonder-1.0', usage: { input_tokens: 9256, cached_tokens: 7025, output_tokens: 692, reasoning_tokens: 548 } }),
  ],
};

describe('Muse session export', () => {
  const x = readMuseExport(exportRecords(EXPORT), T0);

  it('adds up the tokens, cached reads inside input as OpenAI counts them', () => {
    expect(x.usage).toEqual({ input_tokens: 16364, cached_input_tokens: 7025, output_tokens: 883, reasoning_tokens: 601 });
  });

  it('rebuilds the digest with the arguments the live stream leaves out', () => {
    expect(x.events).toEqual([
      { t: 3, kind: 'call', tool: 'start_run', text: '{"size":2}' },
      { t: 4, kind: 'result', text: 'Run started.\n[MCP image content: media_type=image/png, bytes=78993]' },
      { t: 10, kind: 'think', text: 'Reading the faces.' },
      { t: 10, kind: 'say', text: 'White on top.' },
    ]);
  });

  it('lists the tools offered, the models that answered and where the session lives', () => {
    expect(x.tools).toEqual(['mcp__cube_arena__get_rules', 'mcp__cube_arena__turn']);
    expect(x.models).toEqual(['muse-wonder-1.0']);
    expect(x.sessionLog).toBe('/home/x/.local/share/muse/sessions/2026/10/13/abc/session.jsonl');
  });
});

describe('forgetting a Muse session', () => {
  let root = '';
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const setUp = () => {
    root = mkdtempSync(join(tmpdir(), 'muse-test-'));
    const sessions = join(root, 'sessions');
    for (const d of [join(sessions, '2026/10/13/abc'), join(sessions, '2026/10/13/other'), join(sessions, '.msp-view-v1/abc')]) mkdirSync(d, { recursive: true });
    writeFileSync(join(sessions, '2026/10/13/abc/session.jsonl'), '{}\n');
    return sessions;
  };

  it('deletes that session and its view, nothing else', () => {
    const sessions = setUp();
    forgetMuseSession('abc', join(sessions, '2026/10/13/abc/session.jsonl'));
    expect(existsSync(join(sessions, '2026/10/13/abc'))).toBe(false);
    expect(existsSync(join(sessions, '.msp-view-v1/abc'))).toBe(false);
    expect(existsSync(join(sessions, '2026/10/13/other'))).toBe(true);
  });

  it('leaves everything alone when the path is not that session', () => {
    const sessions = setUp();
    forgetMuseSession('abc', join(sessions, '2026/10/13/other/session.jsonl'));
    forgetMuseSession('abc', join(root, 'abc/session.jsonl'));
    forgetMuseSession('abc', null);
    expect(existsSync(join(sessions, '2026/10/13/abc'))).toBe(true);
    expect(existsSync(join(sessions, '2026/10/13/other'))).toBe(true);
  });
});
