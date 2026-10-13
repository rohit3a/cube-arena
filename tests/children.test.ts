import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { WORKSPACE_ENV, endLeftovers } from '../runner/children.mjs';
import { claimMachine } from '../runner/code.mjs';

const dir = mkdtempSync(join(tmpdir(), 'cube-arena-ws-'));
const elsewhere = mkdtempSync(join(tmpdir(), 'cube-arena-other-'));
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(elsewhere, { recursive: true, force: true });
});

// Started on its own like a model's background job, so it outlives its parent.
const start = (file: string, cwd: string, env: NodeJS.ProcessEnv = process.env, args = ['60']) => {
  const c = spawn(file, args, { cwd, env, detached: true, stdio: 'ignore' });
  c.unref();
  return c.pid as number;
};
const running = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe.skipIf(process.platform !== 'linux')('endLeftovers', () => {
  it('ends what carries the workspace, runs from it or works in it, and nothing else', async () => {
    // A program of its own, as a model's compiled solver would be (sleep may be a multi-call binary).
    copyFileSync(realpathSync(process.execPath), join(dir, 'solver_bin'));
    const marked = start('sleep', elsewhere, { ...process.env, [WORKSPACE_ENV]: dir });
    const built = start(join(dir, 'solver_bin'), elsewhere, process.env, ['-e', 'setTimeout(() => {}, 60000)']);
    const there = start('sleep', dir);
    const other = start('sleep', elsewhere);
    await new Promise((r) => setTimeout(r, 200));
    const ended = endLeftovers(dir).map((e) => e.pid);
    expect(ended.sort()).toEqual([marked, built, there].sort());
    await new Promise((r) => setTimeout(r, 200));
    expect(running(other)).toBe(true);
    process.kill(other, 'SIGKILL');
    expect(endLeftovers(dir)).toEqual([]);
  });
});

describe('claimMachine', () => {
  it('lets one run hold the machine and frees it from a runner that died', () => {
    const file = join(dir, 'running.json');
    expect(claimMachine(file, 'a')).toBeNull();
    expect(claimMachine(file, 'b')).toEqual({ pid: process.pid, id: 'a' });
    writeFileSync(file, JSON.stringify({ pid: spawnSync('true').pid, id: 'b' }));
    expect(claimMachine(file, 'c')).toBeNull();
  });
});
