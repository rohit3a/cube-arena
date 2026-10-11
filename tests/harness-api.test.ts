// The direct-API harness against two local mocks: an MCP server with the cube
// tools and an OpenAI-compatible Chat Completions server that plays a script.
// Offline: no real API keys, nothing outside localhost.

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { type IncomingHttpHeaders, type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { SYSTEM } from '../runner/agent.mjs';
import { playApiSession, sameModel } from '../runner/harness-api.mjs';

// A real 16×16 PNG with noisy pixels, so its base64 is long enough to be slimmed from the log.
function png(): string {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(16, 0);
  ihdr.writeUInt32BE(16, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  const raw = Buffer.alloc(16 * (1 + 16 * 3));
  let seed = 7;
  for (let i = 0; i < raw.length; i++) raw[i] = i % 49 === 0 ? 0 : (seed = (seed * 1103515245 + 12345) & 0x7fffffff) & 0xff;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]).toString('base64');
}
const PNG = png();

const listen = (server: Server) =>
  new Promise<string>((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
const shut = (server: Server) =>
  new Promise<void>((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  });

// --- Mock MCP server: stateless, a fresh McpServer per request like the real one.
const mcpSeen: IncomingHttpHeaders[] = [];
let turns = 0;
const mcp = createServer(async (req, res) => {
  mcpSeen.push(req.headers);
  const server = new McpServer({ name: 'mock-cube', version: '0.0.1' });
  server.registerTool('get_rules', { description: 'The rules.', inputSchema: {} }, async () => ({ content: [{ type: 'text', text: 'Rules: turn faces.' }] }));
  server.registerTool('turn', { description: 'Turn some faces.', inputSchema: { moves: z.string() } }, async ({ moves }) => {
    turns += 1;
    const data = { run_id: 'r1', run_status: moves === 'done' ? 'finished' : 'active', turn: turns };
    return {
      content: [
        { type: 'text', text: `Turned ${moves}.\n\n${JSON.stringify(data)}` },
        { type: 'image', data: PNG, mimeType: 'image/png' },
      ],
    };
  });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res);
});

// --- Mock Chat Completions server: answers each request from the current script.
type Msg = { role: string; content?: unknown; tool_calls?: unknown[]; [k: string]: unknown };
type Body = { model: string; messages: Msg[]; tools: { function: { name: string } }[]; [k: string]: unknown };
type Reply = { status?: number; headers?: Record<string, string>; body: unknown; delayMs?: number };
const requests: { path?: string; headers: IncomingHttpHeaders; body: Body }[] = [];
let script: (body: Body, n: number) => Reply = () => ({ status: 500, body: { error: { message: 'no script' } } });
const api = createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', async () => {
    const body = JSON.parse(raw) as Body;
    // Later turns mutate history in place (old pictures dropped), so keep a copy.
    requests.push({ path: req.url, headers: req.headers, body: structuredClone(body) });
    const r = script(body, requests.length);
    if (r.delayMs) await new Promise((resolve) => setTimeout(resolve, r.delayMs));
    if (res.destroyed) return;
    res.writeHead(r.status ?? 200, { 'content-type': 'application/json', ...r.headers });
    res.end(JSON.stringify(r.body));
  });
});

const call = (id: string, name: string, args: unknown) => ({ id, type: 'function', function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) } });
const answer = (message: Record<string, unknown>, model = 'openai/gpt-6-astra-20260903', usage?: unknown): Reply => ({
  body: {
    id: 'gen-1',
    object: 'chat.completion',
    model,
    choices: [{ index: 0, finish_reason: message.tool_calls ? 'tool_calls' : 'stop', message: { role: 'assistant', content: null, ...message } }],
    usage,
  },
});
const images = (body: Body) => body.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((p) => p.type === 'image_url');
const removed = (body: Body) => body.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((p) => p.text === '[older picture removed]');

let mcpUrl = '';
let apiUrl = '';
let dir = '';
let n = 0;
const session = (over: Record<string, unknown> = {}, api: Record<string, unknown> = {}) =>
  playApiSession({
    model: 'openai/gpt-6-astra',
    effort: 'high',
    prompt: "Let's play Cube Arena.",
    headers: { 'x-arena-model': 'GPT-6-Astra (high)', 'x-arena-tool-use': 'model_only' },
    url: `${mcpUrl}/mcp`,
    token: 'op-token',
    logPath: join(dir, `session-${++n}.jsonl`),
    api: { baseUrl: `${apiUrl}/api/v1/`, apiKey: 'sk-test', provider: 'openrouter', ...api },
    ...over,
  } as Parameters<typeof playApiSession>[0]);

beforeAll(async () => {
  mcpUrl = await listen(mcp);
  apiUrl = await listen(api);
  dir = mkdtempSync(join(tmpdir(), 'cube-harness-api-'));
});
afterAll(async () => {
  await Promise.all([shut(mcp), shut(api)]);
  rmSync(dir, { recursive: true, force: true });
});
afterEach(() => {
  requests.length = 0;
  mcpSeen.length = 0;
  turns = 0;
});

describe('Direct API harness', () => {
  it('plays a scripted game over OpenRouter: tools, pictures, reasoning, usage and log', async () => {
    const details = [{ type: 'reasoning.encrypted', data: 'opaque' }];
    script = (_body, i) =>
      i === 1
        ? answer({ tool_calls: [call('c1', 'get_rules', '')], reasoning: 'Read the rules first.', reasoning_details: details }, undefined, {
            prompt_tokens: 100,
            completion_tokens: 20,
            completion_tokens_details: { reasoning_tokens: 15 },
            cost: 0.01,
          })
        : i === 2
          ? answer({ content: 'Let me turn.', tool_calls: [call('c2', 'turn', { moves: 'R U' })] }, undefined, {
              prompt_tokens: 200,
              prompt_tokens_details: { cached_tokens: 100 },
              completion_tokens: 10,
              cost: 0.02,
            })
          : answer({ content: 'Reached level 1.' }, undefined, { prompt_tokens: 300, completion_tokens: 5, cost: 0.03 });

    const out = await session();

    expect(out).toMatchObject({ runId: 'r1', runOver: false, calls: 2, breach: null, stopReason: null, final: 'Reached level 1.', code: 0 });
    expect(out.last).toMatchObject({ run_id: 'r1', turn: 1 });
    expect(out.usage).toEqual({ input_tokens: 600, cached_input_tokens: 100, output_tokens: 35, reasoning_tokens: 15, cost_usd: expect.closeTo(0.06, 9) });
    expect(out.events.map((e) => e.kind)).toEqual(['think', 'call', 'result', 'say', 'call', 'result', 'say']);
    expect(out.events[4]).toMatchObject({ kind: 'call', tool: 'turn', text: '{"moves":"R U"}' });
    expect(out.events[5].text.startsWith('Turned R U.')).toBe(true);

    // The cube server saw the operator token and the arena headers on every request.
    expect(mcpSeen.length).toBeGreaterThan(0);
    for (const h of mcpSeen) expect(h).toMatchObject({ authorization: 'Bearer op-token', 'x-arena-model': 'GPT-6-Astra (high)', 'x-arena-tool-use': 'model_only' });

    expect(requests).toHaveLength(3);
    const [first, second, third] = requests;
    expect(first.path).toBe('/api/v1/chat/completions');
    expect(first.headers).toMatchObject({ authorization: 'Bearer sk-test', 'http-referer': 'https://cube.krnl.studio', 'x-title': 'Cube Arena' });
    expect(first.body).toMatchObject({ model: 'openai/gpt-6-astra', tool_choice: 'auto', reasoning: { effort: 'high' }, usage: { include: true } });
    expect(first.body.reasoning_effort).toBeUndefined();
    expect(first.body.messages).toEqual([
      { role: 'system', content: SYSTEM },
      { role: 'user', content: "Let's play Cube Arena." },
    ]);
    expect(first.body.tools.map((t) => t.function.name).sort()).toEqual(['get_rules', 'turn']);
    expect(first.body.tools.find((t) => t.function.name === 'turn')).toMatchObject({
      type: 'function',
      function: { description: 'Turn some faces.', parameters: { type: 'object', properties: { moves: { type: 'string' } }, required: ['moves'] } },
    });
    for (const t of first.body.tools) expect(t.function).not.toHaveProperty(['parameters', '$schema']);

    // Reasoning goes back with the assistant turn; the tool reply follows it.
    expect(second.body.messages.slice(2)).toEqual([
      { role: 'assistant', content: null, tool_calls: [call('c1', 'get_rules', '')], reasoning: 'Read the rules first.', reasoning_details: details },
      { role: 'tool', tool_call_id: 'c1', content: 'Rules: turn faces.' },
    ]);

    // After the turn call: its text as the tool reply, then one user message with the picture.
    const tail = third.body.messages.slice(-3);
    expect(tail[0]).toMatchObject({ role: 'assistant', content: 'Let me turn.', tool_calls: [call('c2', 'turn', { moves: 'R U' })] });
    expect(tail[1]).toMatchObject({ role: 'tool', tool_call_id: 'c2' });
    expect(String(tail[1].content)).toMatch(/^Turned R U\.\n\n\{"run_id":"r1","run_status":"active","turn":1\}$/);
    expect(tail[2]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'Picture from the turn call:' },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${PNG}` } },
      ],
    });

    // The log has a line per request, response and tool result, and no picture data.
    const log = readFileSync(join(dir, `session-${n}.jsonl`), 'utf8');
    const lines = log.trim().split('\n').map((l) => JSON.parse(l));
    const count = (type: string) => lines.filter((l) => l.type === type).length;
    expect([count('request'), count('response'), count('tool')]).toEqual([3, 3, 2]);
    expect(PNG.length).toBeGreaterThan(200);
    expect(log).not.toContain(PNG.slice(0, 100));
    expect(log).toContain(`<${PNG.length} base64 chars>`);
    expect(log).not.toContain('sk-test');
  });

  it('keeps only the 3 latest pictures, and uses reasoning_effort on other endpoints', async () => {
    script = (_body, i) =>
      i <= 6
        ? answer({ tool_calls: [call(`t${i}`, 'turn', { moves: i === 6 ? 'done' : 'R' })] }, 'gemini-4-pro-001')
        : answer({ content: 'Done.' }, 'gemini-4-pro-001');

    const out = await session({ model: 'google/gemini-4-pro', effort: 'low' }, { provider: 'openai-compatible' });

    expect(out).toMatchObject({ calls: 6, runOver: true, breach: null, final: 'Done.', code: 0 });
    expect(requests).toHaveLength(7);
    const last = requests[6];
    expect(last.body.reasoning_effort).toBe('low');
    expect(last.body.reasoning).toBeUndefined();
    expect(last.body.usage).toBeUndefined();
    expect(last.headers['http-referer']).toBeUndefined();
    expect(last.headers['x-title']).toBeUndefined();
    // Six pictures were sent over the game; the request after the sixth carries the latest three.
    expect(requests.map((r) => images(r.body).length)).toEqual([0, 1, 2, 3, 3, 3, 3]);
    expect(removed(last.body)).toHaveLength(3);
    const pictureMessages = last.body.messages.filter((m) => m.role === 'user' && Array.isArray(m.content));
    expect(pictureMessages).toHaveLength(6);
    expect(pictureMessages.slice(0, 3).every((m) => (m.content as { type: string }[]).every((p) => p.type === 'text'))).toBe(true);
    expect(pictureMessages.slice(3).every((m) => (m.content as { type: string }[]).some((p) => p.type === 'image_url'))).toBe(true);
  });

  it('answers bad arguments and unknown tools with an error, without a breach', async () => {
    script = (_body, i) =>
      i === 1
        ? answer({ tool_calls: [call('b1', 'turn', '{"moves": "R'), call('b2', 'bash', { cmd: 'ls' }), call('b3', 'turn', '[1]')] })
        : answer({ content: 'Giving up.' });

    const out = await session();

    expect(out).toMatchObject({ breach: null, stopReason: null, calls: 3, runId: null, code: 0, final: 'Giving up.' });
    expect(turns).toBe(0);
    const replies = requests[1].body.messages.filter((m) => m.role === 'tool');
    expect(replies.map((m) => m.tool_call_id)).toEqual(['b1', 'b2', 'b3']);
    expect(replies[0].content).toMatch(/^Error: the arguments for turn were not a JSON object/);
    expect(replies[1].content).toMatch(/^Error: there is no tool called "bash"/);
    expect(replies[2].content).toMatch(/^Error: the arguments for turn were not a JSON object/);
  });

  it('stops on a substituted model, keeping the usage it cost', async () => {
    script = () => answer({ tool_calls: [call('s1', 'get_rules', '{}')] }, 'openai/gpt-6-astra-mini', { prompt_tokens: 50, completion_tokens: 5, cost: 0.001 });

    const out = await session();

    expect(out.breach).toBe('asked for openai/gpt-6-astra, openai/gpt-6-astra-mini answered');
    expect(out.stopReason).toBe('lockdown broken: asked for openai/gpt-6-astra, openai/gpt-6-astra-mini answered');
    expect(out).toMatchObject({ calls: 0, code: 0, usage: { input_tokens: 50, output_tokens: 5, cost_usd: 0.001 } });
    expect(requests).toHaveLength(1);
  });

  it('retries 429 and upstream errors, then carries on', async () => {
    script = (_body, i) =>
      i === 1
        ? { status: 429, body: { error: { message: 'Rate limited', code: 429 } } }
        : i === 2
          ? { status: 200, headers: { 'retry-after': '0' }, body: { error: { message: 'Upstream overloaded', code: 502 } } }
          : answer({ content: 'Hello.' });

    const out = await session();

    expect(out).toMatchObject({ final: 'Hello.', code: 0, stopReason: null });
    expect(requests).toHaveLength(3);
    expect(out.events.filter((e) => e.kind === 'error').map((e) => e.text)).toEqual([
      'API 429: Rate limited (try 1 of 5)',
      'API 502: Upstream overloaded (try 2 of 5)',
    ]);
  });

  it('stops on any other 4xx with code 1', async () => {
    script = () => ({ status: 400, body: { error: { message: 'tools are not supported for this model', code: 400 } } });

    const out = await session();

    expect(out).toMatchObject({ code: 1, stopReason: 'API error 400: tools are not supported for this model', final: null });
    expect(requests).toHaveLength(1);
  });

  it('refuses the OpenRouter web-search variant before calling anything', async () => {
    const out = await session({ model: 'openai/gpt-6-astra:online' });
    expect(out.breach).toMatch(/web-search variant/);
    expect(requests).toHaveLength(0);
  });
});

describe('Model check', () => {
  it('accepts the model asked for, with a date or version suffix', () => {
    expect(sameModel('openai/gpt-6-astra', 'openai/gpt-6-astra', 'openrouter')).toBe(true);
    expect(sameModel('openai/gpt-6-astra', 'openai/gpt-6-astra-20260903', 'openrouter')).toBe(true);
    expect(sameModel('openai/gpt-6-astra', 'openai/gpt-6-astra-2026-09-03', 'openrouter')).toBe(true);
    expect(sameModel('x-ai/grok-6', 'x-ai/grok-6-0709', 'openrouter')).toBe(true);
    expect(sameModel('anthropic/claude-opus-5-5', 'anthropic/claude-opus-5-5@20260101', 'openrouter')).toBe(true);
    expect(sameModel('mistral-large', 'mistral-large-2607', 'openai-compatible')).toBe(true);
    expect(sameModel('openai/gpt-6-astra:free', 'openai/gpt-6-astra', 'openrouter')).toBe(true);
  });

  it('tolerates a dropped vendor prefix only on a provider endpoint', () => {
    expect(sameModel('google/gemini-4-pro', 'gemini-4-pro', 'openai-compatible')).toBe(true);
    expect(sameModel('gemini-4-pro', 'models/gemini-4-pro', 'openai-compatible')).toBe(true);
    expect(sameModel('openai/gpt-6-astra', 'gpt-6-astra', 'openrouter')).toBe(false);
  });

  it('refuses any other model', () => {
    expect(sameModel('openai/gpt-6-astra', 'openai/gpt-6-astra-mini', 'openrouter')).toBe(false);
    expect(sameModel('openai/gpt-6', 'openai/gpt-6-astra', 'openrouter')).toBe(false);
    expect(sameModel('openai/gpt-6-astra', 'anthropic/gpt-6-astra', 'openrouter')).toBe(false);
    expect(sameModel('openai/gpt-6-astra', 'openai/gpt-6', 'openrouter')).toBe(false);
    expect(sameModel('openai/gpt-6-astra', '', 'openrouter')).toBe(false);
    expect(sameModel('openai/gpt-6-astra', undefined, 'openrouter')).toBe(false);
    expect(sameModel('gemini-4-pro', 'gemini-4-pro-preview', 'openai-compatible')).toBe(false);
  });
});
