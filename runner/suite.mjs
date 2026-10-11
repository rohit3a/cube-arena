#!/usr/bin/env node
// Plays a whole suite (the Cube Arena Index) on the Verified board: creates
// the suite, then plays each test in a fresh agent session that may only
// touch that test, so hours of pictures never pile up in one context.
//
//   node --env-file=.env.local runner/suite.mjs --model gpt-6-luna --effort max --suite fast
//   node --env-file=.env.local runner/suite.mjs --resume <suite id> --model gpt-6-luna --effort max
//
// A lockdown breach hides the whole suite and stops. Tests the agent never
// started count 0. Needs CUBE_OPERATOR_TOKEN.

import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { operator } from './agent.mjs';
import { playSuite } from './play-suite.mjs';
import { resolveModel } from './models.mjs';

const { values: opt } = parseArgs({
  options: {
    model: { type: 'string' },
    effort: { type: 'string', default: 'max' },
    suite: { type: 'string', default: 'fast' },
    resume: { type: 'string' },
    url: { type: 'string', default: 'https://cube.krnl.studio/mcp' },
    name: { type: 'string', default: 'Cube Arena' },
    'codex-home': { type: 'string', default: join(homedir(), '.codex-bench') },
  },
});

const fail = (msg) => {
  console.error(msg);
  process.exit(2);
};
const token = process.env.CUBE_OPERATOR_TOKEN;
if (!token) fail('CUBE_OPERATOR_TOKEN is not set (run with --env-file=.env.local)');
if (!opt.model) fail('--model is required: the full model id, e.g. claude-opus-5-5 or gpt-6-luna');
if (!['fast', 'thorough'].includes(opt.suite)) fail('--suite must be fast or thorough');
const m = resolveModel(opt.model, opt.effort, opt['codex-home']);
if (m.error) fail(m.error);

// The tests come from the server: lib/arena/suites.ts.
const call = operator(opt.url, token);
let suite;
let slots;
let played = new Set();
if (opt.resume) {
  ({ suite, tests: slots } = await call(`/api/admin/suites?id=${opt.resume}`));
  if (suite.model_name !== m.label || suite.kind !== opt.suite) fail(`That suite is ${suite.kind} for ${suite.model_name}, not ${opt.suite} for ${m.label}.`);
  played = new Set(suite.slots_played ?? []);
} else {
  ({ suite, tests: slots } = await call('/api/admin/suites', {
    kind: opt.suite,
    model_name: m.label,
    model: m.name,
    model_id: opt.model,
    effort: m.effort,
    agent: m.agent,
    display_name: opt.name,
  }));
}

console.log(`${m.label} [${opt.model}, ${m.agent}]: ${opt.suite} suite ${suite.version}, ${slots.length} tests → ${opt.url}`);
console.log(`suite ${suite.id}`);
const r = await playSuite({
  url: opt.url,
  token,
  suite,
  tests: slots,
  played,
  session: { agent: m.agent, model: opt.model, effort: m.effort, codexHome: opt['codex-home'] },
  logDir: join(dirname(fileURLToPath(import.meta.url)), 'out'),
  transcript: true,
});
if (r.breach) process.exit(3);
