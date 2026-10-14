import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { playSession } from '../runner/agent.mjs';

const dir = mkdtempSync(join(tmpdir(), 'cube-arena-cursor-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// A stand-in for Cursor's CLI that prints the given stream-json events and exits.
function fakeCursor(events: object[]) {
  const bin = join(dir, `cursor-${Math.random().toString(36).slice(2)}`);
  const lines = events.map((e) => JSON.stringify(e)).join('\n');
  writeFileSync(bin, `#!/bin/sh\ncat <<'EOF'\n${lines}\nEOF\n`);
  chmodSync(bin, 0o755);
  return bin;
}
const done = (kind: string, args: object) => ({ type: 'tool_call', subtype: 'completed', tool_call: { [kind]: { args, result: { success: {} } } } });
const play = (events: object[]) =>
  playSession({
    agent: 'cursor',
    cursorBin: fakeCursor([...events, { type: 'result', subtype: 'success', result: 'done' }]),
    cursorHome: join(dir, 'home'),
    model: 'grok-4.7',
    prompt: 'play',
    url: 'http://127.0.0.1:9/mcp',
    token: 'test',
    headers: {},
    logPath: join(dir, 'log.jsonl'),
  });

describe.skipIf(process.platform === 'win32')('the Cursor lockdown', () => {
  it('notes a search for file names outside the folder and plays on', async () => {
    const out = await play([done('globToolCall', { targetDirectory: '/tmp', globPattern: '**/*.png' }), done('lsToolCall', { path: '/' })]);
    expect(out.breach).toBeNull();
    expect(out.events.filter((e: { kind: string }) => e.kind === 'blocked')).toHaveLength(2);
  });

  it('breaks on reading or searching inside files outside the folder', async () => {
    expect((await play([done('readToolCall', { path: '/etc/hosts' })])).breach).toMatch(/^Cursor ran read/);
    expect((await play([done('grepToolCall', { path: '/tmp', pattern: 'cube' })])).breach).toMatch(/^Cursor ran grep/);
  });
});
