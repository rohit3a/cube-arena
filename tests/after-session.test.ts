// What the runner tells the site once a session is over: a test left open or ended, and where its usage goes.
// The session itself is faked; the site is a stubbed fetch.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({ out: {} as Record<string, unknown> }));
vi.mock('../runner/harness-api.mjs', () => ({ playApiSession: async () => ({ ...fake.out }) }));

import { playSession } from '../runner/agent.mjs';

const OUT_OF_OUTPUT = "a reply over the model's output token limit";
const base = { runId: 'run-1', runOver: false, last: null, calls: 3, breach: null, stopReason: null, apiError: null, quit: false, retry: null, final: null, code: 0, minutes: 1, events: [] };
const session = { agent: 'api', model: 'm', prompt: 'p', url: 'https://site.test/mcp', token: 't', logPath: '/dev/null' };

let calls: { path: string; body: Record<string, unknown> }[] = [];
beforeEach(() => {
  calls = [];
  vi.stubGlobal('fetch', async (url: string, init: { body?: string }) => {
    calls.push({ path: new URL(url).pathname, body: init.body ? JSON.parse(init.body) : {} });
    return new Response('{}', { status: 200 });
  });
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const usagePosts = () => calls.filter((c) => c.body.usage);
const stops = () => calls.filter((c) => c.body.stop);

describe('After a session', () => {
  it('counts the usage of a test the model played to its end', async () => {
    fake.out = { ...base, runOver: true, usage: { cost_usd: 2 } };
    const r = await playSession(session);
    expect(r.retry).toBeNull();
    expect(usagePosts()).toEqual([{ path: '/api/admin/runs', body: { id: 'run-1', usage: { cost_usd: 2 }, lost: false } }]);
  });

  it('keeps a session lost to an API error out of cost, and leaves its test open', async () => {
    fake.out = { ...base, apiError: 'API error network: HTTP 0', usage: { cost_usd: 1.5 } };
    const r = await playSession(session);
    expect(r.retry).toBe('API error network: HTTP 0');
    expect(stops()).toEqual([]);
    expect(usagePosts()[0].body).toMatchObject({ usage: { cost_usd: 1.5 }, lost: true });
  });

  it('ends the test on a reply over the output limit, counting its usage', async () => {
    fake.out = { ...base, quit: true, stopReason: OUT_OF_OUTPUT, usage: { cost_usd: 3 } };
    const r = await playSession(session);
    expect(r.retry).toBeNull();
    expect(stops()[0].body).toMatchObject({ id: 'run-1', stop: true, quit: true });
    expect(usagePosts()[0].body).toMatchObject({ lost: false });
  });

  it('picks the test up again when a safeguard flags the reply after one over the output limit', async () => {
    fake.out = { ...base, quit: true, stopReason: OUT_OF_OUTPUT, apiError: 'API Error: the reply was flagged by a safeguard', usage: { cost_usd: 4 } };
    const r = await playSession(session);
    expect(r.retry).toBe('API Error: the reply was flagged by a safeguard');
    expect(stops()).toEqual([]);
    expect(usagePosts()[0].body).toMatchObject({ usage: { cost_usd: 4 }, lost: true });
  });
});
