// One benchmark session against a model called directly over an
// OpenAI-compatible Chat Completions API (OpenRouter, or a provider's own
// endpoint). The counterpart of playSession in agent.mjs for models that have
// no official command-line agent.
//
// Lockdown: our code holds the conversation and offers only the cube tools, so
// the model cannot reach anything else; a bad or unknown tool call just gets an
// error back. What is left to check is that the model that answered is the one
// asked for (a provider or router can quietly serve another).
//
// The caller makes the operator calls afterwards (end an open run, record
// usage, hide a breach), as playSession does for itself.

import { createWriteStream } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { setTimeout as sleep } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SYSTEM } from './system.mjs';

const MAX_TURNS = 20_000; // assistant replies per session: a runaway guard only. The server already caps moves, looks and bad requests per cube.
const MAX_TRIES = 5; // per request, for 429, 5xx and network errors
// Only the most recent pictures stay in the conversation; older ones become a
// short note. This bounds context and cost over hundreds of turns, but it is a
// harness choice that affects play: the model cannot look back further than
// this many pictures. (The CLI agents keep or compact history their own way.)
const KEEP_IMAGES = 3;

// Transcripts keep everything but the pictures, which the site can redraw.
const slim = (line) =>
  line
    .replace(/"data":"[A-Za-z0-9+/=]{200,}"/g, (m) => `"data":"<${m.length - 9} base64 chars>"`)
    .replace(/;base64,[A-Za-z0-9+/=]{200,}/g, (m) => `;base64,<${m.length - 8} base64 chars>`);

/**
 * True when `got` (a response's model field) is the model asked for: the same
 * id, perhaps with a date or version suffix (gpt-6-astra → gpt-6-astra-20260903),
 * and on a provider's own endpoint perhaps without the vendor prefix
 * (google/gemini-4-pro → gemini-4-pro). An OpenRouter variant (:free, :nitro)
 * need not be echoed back. Anything else is another model.
 * @param {string} asked
 * @param {unknown} got
 * @param {string} provider
 */
export function sameModel(asked, got, provider) {
  if (typeof got !== 'string' || !got) return false;
  const variant = /:[a-z][a-z-]*$/;
  let a = asked.toLowerCase().replace(variant, '');
  let g = got.toLowerCase().replace(variant, '');
  if (provider !== 'openrouter') {
    a = a.slice(a.lastIndexOf('/') + 1);
    g = g.slice(g.lastIndexOf('/') + 1);
  }
  if (g === a) return true;
  // -20260903, -2026-09-03, -001, -0709, -05-20, @20260903, -v2, -v1:0; never -mini, -pro.
  return g.startsWith(a) && /^[-@](\d{2,8}([-.:]\d{1,4})*|v\d+([-.:]\d+)*)$/.test(g.slice(a.length));
}

class ApiError extends Error {
  /** @param {number} status 0 for a network error @param {string} message */
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// node:http rather than fetch: fetch gives up when response headers take more
// than 5 minutes, and a non-streamed answer at high effort can take longer.
// Nothing here times out: a model may think as long as it likes.
function post(url, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = (u.protocol === 'https:' ? https : http).request(
      u,
      { method: 'POST', headers: { ...headers, 'Content-Length': Buffer.byteLength(body) } },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('error', reject);
        res.on('close', () => {
          if (!res.complete) return reject(new Error('connection closed mid-response'));
          resolve({ status: res.statusCode ?? 0, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') });
        });
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

// Error bodies differ by provider: {error: {message}}, {error: "..."}, [{error: {...}}] (Google), {detail}.
function errorMessage(data) {
  const d = Array.isArray(data) ? data[0] : data;
  if (!d || typeof d !== 'object') return '';
  const e = d.error ?? d.choices?.[0]?.error;
  const m = typeof e === 'string' ? e : (e?.message ?? d.message ?? d.detail);
  return m === undefined ? JSON.stringify(d).slice(0, 300) : typeof m === 'string' ? m : JSON.stringify(m).slice(0, 300);
}

function retryAfterMs(headers) {
  const n = Number(headers?.['retry-after']);
  return headers?.['retry-after'] !== undefined && Number.isFinite(n) && n >= 0 ? Math.min(n * 1000, 60_000) : null;
}

const textOf = (content) =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content
          .filter((p) => p?.type === 'text')
          .map((p) => p.text)
          .join('\n')
      : '';

// Readable reasoning, where the API returns any (OpenRouter `reasoning` or
// `reasoning_details`, some providers `reasoning_content`). Encrypted parts have no text.
function reasoningText(msg) {
  for (const k of ['reasoning', 'reasoning_content']) if (typeof msg[k] === 'string' && msg[k]) return msg[k];
  return (Array.isArray(msg.reasoning_details) ? msg.reasoning_details : [])
    .map((d) => d?.text ?? d?.summary)
    .filter((t) => typeof t === 'string' && t)
    .join('\n');
}

/** Arguments as an object, or null when they are not a JSON object. Empty means none. */
function parseArgs(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw !== 'string') return null;
  if (!raw.trim()) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

function forgetOldPictures(messages) {
  let seen = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const c = messages[i].content;
    if (!Array.isArray(c)) continue;
    for (let j = c.length - 1; j >= 0; j--) {
      if (c[j].type === 'image_url' && ++seen > KEEP_IMAGES) c[j] = { type: 'text', text: '[older picture removed]' };
    }
  }
}

/**
 * Plays one session over the API.
 * @param {{ model: string, effort?: string | null, prompt: string, headers: Record<string, string>,
 *   url: string, token: string, logPath: string,
 *   api: { baseUrl: string, apiKey: string, provider?: 'openrouter' | 'openai-compatible' } }} s
 * @returns {Promise<{ runId: string | null, runOver: boolean, last: any, calls: number, breach: string | null,
 *   stopReason: string | null, quit: boolean, final: string | null, usage: Record<string, number>, code: number | null,
 *   minutes: number, events: { t: number, kind: 'say' | 'think' | 'call' | 'result' | 'error', tool?: string, text: string }[] }>}
 */
export async function playApiSession(s) {
  const started = Date.now();
  const secs = () => Math.round((Date.now() - started) / 1000);
  const base = s.api.baseUrl.replace(/\/+$/, '');
  const provider = s.api.provider ?? (/openrouter\.ai/.test(base) ? 'openrouter' : 'openai-compatible');
  const openrouter = provider === 'openrouter';

  /** @type {Awaited<ReturnType<typeof playApiSession>>} */
  const out = { runId: null, runOver: false, last: null, calls: 0, breach: null, stopReason: null, quit: false, final: null, usage: {}, code: null, minutes: 0, events: [] };
  const log = createWriteStream(s.logPath);
  const write = (type, data) => log.write(`${slim(JSON.stringify({ t: secs(), type, ...data }))}\n`);
  const note = (kind, text, tool) => out.events.push(tool === undefined ? { t: secs(), kind, text } : { t: secs(), kind, tool, text });

  function stop(reason) {
    if (out.stopReason) return;
    out.stopReason = reason;
    console.log(`  stopping: ${reason}`);
  }


  function seeReply(text) {
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

  function addUsage(u) {
    if (!u) return;
    const add = (k, v) => {
      if (Number.isFinite(v)) out.usage[k] = (out.usage[k] ?? 0) + v;
    };
    add('input_tokens', u.prompt_tokens);
    add('cached_input_tokens', u.prompt_tokens_details?.cached_tokens);
    add('output_tokens', u.completion_tokens);
    add('reasoning_tokens', u.completion_tokens_details?.reasoning_tokens);
    add('cost_usd', u.cost);
  }

  const apiHeaders = { Authorization: `Bearer ${s.api.apiKey}`, 'Content-Type': 'application/json', 'Accept-Encoding': 'identity' };
  if (openrouter) Object.assign(apiHeaders, { 'HTTP-Referer': 'https://cube.krnl.studio', 'X-Title': 'Cube Arena' });

  /** One completion, retrying rate limits, server errors and dropped connections. */
  async function complete(body) {
    const payload = JSON.stringify(body);
    for (let attempt = 1; ; attempt++) {
      let status = 0;
      let message = '';
      let data = null;
      let headers;
      try {
        const res = await post(`${base}/chat/completions`, apiHeaders, payload);
        ({ status, headers } = res);
        try {
          data = JSON.parse(res.text);
        } catch {
          message = res.text.trim().slice(0, 200) || 'no body';
        }
      } catch (e) {
        message = e.message;
      }
      // OpenRouter reports an upstream failure inside a 200.
      const err = data?.error ?? data?.choices?.[0]?.error;
      if (status >= 200 && status < 300 && err) status = Number(err.code) >= 400 ? Number(err.code) : 502;
      if (status >= 200 && status < 300 && !data?.choices?.length) {
        status = 502;
        message ||= 'no choices in the response';
      }
      if (status >= 200 && status < 300) return data;
      message = errorMessage(data) || message || `HTTP ${status}`;
      const what = status ? `API ${status}` : 'API network error';
      write('error', { attempt, status, message, body: data });
      if (!(status === 0 || status === 429 || status >= 500) || attempt >= MAX_TRIES) throw new ApiError(status, message);
      const wait = retryAfterMs(headers) ?? 2000 * 2 ** (attempt - 1);
      console.log(`  [${secs()}s] ${what}: ${message.slice(0, 160)}; retrying in ${wait / 1000}s`);
      note('error', `${what}: ${message.slice(0, 300)} (try ${attempt} of ${MAX_TRIES})`);
      await sleep(wait);
    }
  }

  const client = new Client({ name: 'cube-arena-runner', version: '0.1.0' });
  try {
    if (/:online$/i.test(s.model)) {
      // OpenRouter's :online variant adds web search results: not model only.
      out.breach = `asked for ${s.model}, a web-search variant`;
      note('error', out.breach);
      stop(`lockdown broken: ${out.breach}`);
      out.code = 0;
      return out;
    }

    const transport = new StreamableHTTPClientTransport(new URL(s.url), {
      requestInit: { headers: { Authorization: `Bearer ${s.token}`, ...s.headers } },
    });
    await client.connect(transport);
    const listed = [];
    let cursor;
    do {
      const page = await client.listTools(cursor ? { cursor } : undefined);
      listed.push(...page.tools);
      cursor = page.nextCursor;
    } while (cursor);
    // The schema's $schema line goes: it says nothing to the model, and some
    // endpoints (Gemini's) refuse keys they don't know in parameters.
    const tools = listed.map((t) => {
      const parameters = { ...t.inputSchema };
      delete parameters.$schema;
      return { type: 'function', function: { name: t.name, description: t.description ?? '', parameters } };
    });
    const names = new Set(listed.map((t) => t.name));
    write('tools', { tools });

    const extra = {};
    if (s.effort) Object.assign(extra, openrouter ? { reasoning: { effort: s.effort } } : { reasoning_effort: s.effort });
    // Only providers that honour every parameter (the effort above), so none can quietly drop it.
    if (openrouter) Object.assign(extra, { usage: { include: true }, provider: { require_parameters: true } });

    // Claude Code and Codex show the model the server's instructions too.
    const instructions = client.getInstructions();
    const messages = [
      { role: 'system', content: instructions ? `${SYSTEM}\n\n${instructions}` : SYSTEM },
      { role: 'user', content: s.prompt },
    ];
    let logged = 0; // messages already in the log; each request line carries only the new ones

    for (let turn = 1; ; turn++) {
      if (turn > MAX_TURNS) {
        stop(`the runner's ${MAX_TURNS}-turn limit`);
        out.quit = true;
        break;
      }
      write('request', { turn, model: s.model, tool_choice: 'auto', ...extra, messages: messages.slice(logged) });
      logged = messages.length;
      const data = await complete({ model: s.model, messages, tools, tool_choice: 'auto', ...extra });
      write('response', { turn, data });
      addUsage(data.usage);

      if (!sameModel(s.model, data.model, provider)) {
        out.breach = `asked for ${s.model}, ${data.model || 'an unnamed model'} answered`;
        note('error', `lockdown broken: ${out.breach}`);
        stop(`lockdown broken: ${out.breach}`);
        break;
      }

      // The assistant message goes back as returned. Reasoning stays with it:
      // some models need their reasoning_details back to keep using tools.
      const msg = data.choices[0].message ?? {};
      const calls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
      const kept = { role: 'assistant', content: msg.content ?? null };
      if (calls.length) kept.tool_calls = calls;
      for (const k of ['reasoning', 'reasoning_details']) if (msg[k] != null) kept[k] = msg[k];
      messages.push(kept);

      const think = reasoningText(msg);
      if (think) note('think', think.slice(0, 2000));
      const said = textOf(msg.content);
      if (said.trim()) {
        out.final = said;
        console.log(`  [${secs()}s] says: ${said.replace(/\s+/g, ' ').slice(0, 160)}`);
        note('say', said);
      }
      if (!calls.length) {
        // An answer with no tool call: the model chose to stop.
        out.final = said;
        out.quit = true;
        break;
      }

      const pictures = [];
      for (const [i, tc] of calls.entries()) {
        tc.id ??= `call_${turn}_${i}`; // the tool reply must name its call
        const name = String(tc.function?.name ?? '');
        const raw = tc.function?.arguments ?? '';
        const rawText = typeof raw === 'string' ? raw : JSON.stringify(raw);
        const args = parseArgs(raw);
        out.calls += 1;
        console.log(`  [${secs()}s] ${name} ${(args ? JSON.stringify(args) : rawText).slice(0, 120)}`);
        note('call', rawText || '{}', name);

        let reply;
        let result = null;
        if (!names.has(name)) reply = `Error: there is no tool called "${name}". The tools are: ${[...names].join(', ')}.`;
        else if (!args) reply = `Error: the arguments for ${name} were not a JSON object: ${rawText.slice(0, 200)}`;
        else {
          try {
            result = await client.callTool({ name, arguments: args }, undefined, { timeout: 120_000 });
            const content = Array.isArray(result.content) ? result.content : [];
            const text = content
              .filter((c) => c.type === 'text')
              .map((c) => c.text)
              .join('\n');
            reply = result.isError ? `Error: ${text}` : text;
            const images = content.filter((c) => c.type === 'image' && c.data);
            if (images.length) {
              pictures.push({ type: 'text', text: `Picture from the ${name} call:` });
              for (const im of images) pictures.push({ type: 'image_url', image_url: { url: `data:${im.mimeType ?? 'image/png'};base64,${im.data}` } });
            }
          } catch (e) {
            reply = `Error: the ${name} call failed: ${e.message}`;
          }
        }
        seeReply(reply);
        note('result', reply.slice(0, 300), name);
        write('tool', { turn, id: tc.id, name, result: result ?? { error: reply } });
        messages.push({ role: 'tool', tool_call_id: tc.id, content: reply });
      }
      // Tool messages carry text only, so the turn's pictures follow in one user message.
      if (pictures.length) {
        messages.push({ role: 'user', content: pictures });
        forgetOldPictures(messages);
      }
    }
    out.code = 0;
  } catch (e) {
    if (e instanceof ApiError) {
      stop(`API error ${e.status || 'network'}: ${e.message}`);
      note('error', out.stopReason ?? e.message);
      out.code = 1;
    } else {
      stop(`harness error: ${e.message}`);
      note('error', out.stopReason ?? e.message);
      out.code = 1;
    }
  } finally {
    await client.close().catch(() => {});
    out.minutes = (Date.now() - started) / 60_000;
    write('end', { stopReason: out.stopReason, breach: out.breach, calls: out.calls, usage: out.usage, code: out.code });
    await new Promise((resolve) => log.end(resolve));
  }
  return out;
}
