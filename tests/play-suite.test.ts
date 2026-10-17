// The suite runner, with the agent and the site faked: a session lost through no fault of the model is left out of
// the cube's time and the test is played again.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({ bodies: [] as Record<string, unknown>[], sessions: [] as unknown[] }));

vi.mock('../runner/agent.mjs', () => ({
  operator: () => async (_path: string, body: Record<string, unknown>) => {
    fake.bodies.push(body);
    if (body.finish) return { result: 'suite closed', suite: { grade: { gauntlet: 'locked', tests: [] } } };
    if (body.lost) return { lost: { secs: 60 } };
    return {};
  },
  playSession: async () => fake.sessions.shift(),
}));

afterEach(() => vi.useRealTimers());

describe('playSuite', () => {
  it('leaves a lost session out of the cube time and plays the test again', async () => {
    vi.useFakeTimers();
    fake.sessions.push(
      { retry: 'API error network: HTTP 0', usage: {}, minutes: 0.1, calls: 2, last: null },
      { runId: 'run-1', usage: {}, minutes: 1, calls: 9, last: { best_level: 4, replay_url: null } },
    );
    const { playSuite } = await import('../runner/play-suite.mjs');
    const done = playSuite({
      url: 'http://arena.test',
      token: 'operator',
      suite: { id: 'suite-1', model_name: 'Model', display_name: 'Model', kind: 'fast' },
      tests: [{ size: 3, mode: 'interactive', challenge: 'ladder' }],
      played: new Set(),
      session: { agent: 'api', effort: 'max' },
      logDir: join(mkdtempSync(join(tmpdir(), 'play-suite-')), 'logs'),
      transcript: null,
    });
    await vi.advanceTimersByTimeAsync(61_000);
    const r = await done;
    expect(r.result).toBe('suite closed');
    expect(fake.sessions).toHaveLength(0);
    expect(fake.bodies.find((b) => b.lost)).toMatchObject({ id: 'suite-1', lost: { slot: 0 } });
  });
});
