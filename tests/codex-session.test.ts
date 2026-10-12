import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { sessionUsage, takeCodexSession } from '../runner/codex-session.mjs';

// Lines as Codex 0.162 writes them to a session file.
const tokenCount = (input: number, cached: number, output: number, reasoning: number) =>
  JSON.stringify({
    timestamp: '2026-10-12T14:56:28.000Z',
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: {
        total_token_usage: { input_tokens: input, cached_input_tokens: cached, cache_write_input_tokens: 0, output_tokens: output, reasoning_output_tokens: reasoning, total_tokens: input + output },
        last_token_usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1, reasoning_output_tokens: 0, total_tokens: 2 },
        model_context_window: 258400,
      },
      rate_limits: null,
    },
  });
const meta = JSON.stringify({ type: 'session_meta', payload: { id: 'x' } });

describe('sessionUsage', () => {
  it('takes the last running total', () => {
    const text = [meta, tokenCount(1000, 800, 50, 20), tokenCount(5000, 4000, 300, 120), ''].join('\n');
    expect(sessionUsage(text)).toEqual({ input_tokens: 5000, cached_input_tokens: 4000, output_tokens: 300, reasoning_tokens: 120 });
  });

  it('skips a last line cut off by the kill', () => {
    const text = [tokenCount(1000, 800, 50, 20), tokenCount(5000, 4000, 300, 120).slice(0, 80)].join('\n');
    expect(sessionUsage(text)).toEqual({ input_tokens: 1000, cached_input_tokens: 800, output_tokens: 50, reasoning_tokens: 20 });
  });

  it('is null with no token count', () => {
    expect(sessionUsage(`${meta}\n`)).toBeNull();
    expect(sessionUsage(JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: null } }))).toBeNull();
  });
});

describe('takeCodexSession', () => {
  let home = '';
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  it("reads the thread's session file and deletes it, leaving other threads", () => {
    home = mkdtempSync(join(tmpdir(), 'codex-home-'));
    const day = join(home, 'sessions', '2026', '10', '12');
    mkdirSync(day, { recursive: true });
    const thread = '01a1309d-6d51-7b92-9a43-0fff6e810331';
    const mine = join(day, `rollout-2026-10-12T20-26-27-${thread}.jsonl`);
    const other = join(day, 'rollout-2026-10-12T20-30-00-01a130a0-9815-7293-804d-15c2c10bd568.jsonl');
    writeFileSync(mine, `${meta}\n${tokenCount(13637, 11008, 5, 0)}\n`);
    writeFileSync(other, `${tokenCount(1, 1, 1, 1)}\n`);
    expect(takeCodexSession(home, thread)).toEqual({ input_tokens: 13637, cached_input_tokens: 11008, output_tokens: 5, reasoning_tokens: 0 });
    expect(existsSync(mine)).toBe(false);
    expect(existsSync(other)).toBe(true);
  });

  it('is null without a thread', () => {
    expect(takeCodexSession('/nowhere', null)).toBeNull();
  });
});
