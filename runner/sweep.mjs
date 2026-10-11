#!/usr/bin/env node
// Plays a suite (Fast or Thorough) for many models at many efforts, by calling
// suite.mjs. Claude and Codex models run in two lanes side by side, one suite
// at a time in each. A model and effort that already has a finished, visible
// Verified suite of the current version is skipped, and one left half played
// is resumed, so a sweep can be stopped and started again. Without --go it
// only prints the plan.
//
//   node --env-file=.env.local runner/sweep.mjs --suite fast [--models claude-opus-5-5,gpt-6-astra] [--efforts all] [--go]
//   node --env-file=.env.local runner/sweep.mjs --suite thorough --top 5 [--go]
//
// --efforts: all (every level the model takes, low to max), top (only its
// highest), or a list like high,max. Fast defaults to all, Thorough to top.
// --top N (Thorough): the N models with the best Verified Fast score.
// Each suite uses the subscription of the CLI it runs on (Claude Code or Codex).
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { operator } from './agent.mjs';
import { SWEEP_MODELS, codexModels, effortsOf, resolveModel } from './models.mjs';

const { values: opt } = parseArgs({
  options: {
    suite: { type: 'string', default: 'fast' },
    models: { type: 'string' },
    efforts: { type: 'string' },
    top: { type: 'string' },
    url: { type: 'string', default: 'https://cube.krnl.studio/mcp' },
    'codex-home': { type: 'string', default: join(homedir(), '.codex-bench') },
    go: { type: 'boolean', default: false },
  },
});

const fail = (msg) => {
  console.error(msg);
  process.exit(2);
};
const token = process.env.CUBE_OPERATOR_TOKEN;
if (!token) fail('CUBE_OPERATOR_TOKEN is not set (run with --env-file=.env.local)');
if (!['fast', 'thorough'].includes(opt.suite)) fail('--suite must be fast or thorough');

const call = operator(opt.url, token);
const { suites, versions } = await call('/api/admin/suites?limit=500');
const current = (s) => s.board === 'verified' && !s.hidden && s.version === versions[s.kind];

// Which models: a list, the top N on Fast, or everyone we know.
let models = opt.models ? opt.models.split(',').map((m) => m.trim()) : SWEEP_MODELS;
if (opt.top) {
  const best = new Map();
  for (const s of suites.filter((s) => current(s) && s.kind === 'fast' && s.status === 'finished' && s.model_id)) {
    best.set(s.model_id, Math.max(best.get(s.model_id) ?? 0, s.grade?.score ?? 0));
  }
  models = [...best].sort((a, b) => b[1] - a[1]).slice(0, Number(opt.top)).map(([id]) => id);
  if (models.length === 0) fail('No finished Verified Fast suites yet, so there is no top N. Run --suite fast first.');
}

const listing = codexModels(opt['codex-home']);
const effortMode = opt.efforts ?? (opt.suite === 'fast' ? 'all' : 'top');
const effortsFor = (model) => {
  const takes = effortsOf(model, listing);
  if (takes.length === 0) return [null];
  if (effortMode === 'all') return takes;
  if (effortMode === 'top') return [takes.at(-1)];
  return effortMode.split(',').map((e) => e.trim()).filter((e) => takes.includes(e));
};

const mine = suites.filter((s) => current(s) && s.kind === opt.suite);
const plan = [];
for (const model of models) {
  for (const effort of effortsFor(model)) {
    const m = resolveModel(model, effort ?? 'high', opt['codex-home']);
    if (m.error) {
      plan.push({ model, effort, label: null, state: m.error });
      continue;
    }
    const same = mine.filter((s) => s.model_name === m.label);
    const done = same.find((s) => s.status === 'finished');
    const open = same.find((s) => s.status === 'active');
    // A suite with a heartbeat in the last 30 minutes is still playing elsewhere (runners send one every 5).
    const busy = open && Date.now() - Date.parse(open.updated_at) < 30 * 60_000;
    const state = done ? `done, ${done.grade?.score?.toFixed(1) ?? '?'}` : busy ? 'playing elsewhere, skipped' : open ? 'resume' : 'to play';
    plan.push({ model, effort: m.effort, label: m.label, agent: m.agent, state, resume: !done && open ? open.id : null });
  }
}

for (const p of plan) console.log(`${p.model.padEnd(18)} ${String(p.label ?? '-').padEnd(30)} ${p.state}`);
const todo = plan.filter((p) => p.label && (p.state === 'to play' || p.state === 'resume'));
const lanes = { claude: todo.filter((p) => p.agent === 'claude'), codex: todo.filter((p) => p.agent === 'codex') };
const hours = { fast: 0.75, thorough: 8 }[opt.suite];
const longest = Math.max(lanes.claude.length, lanes.codex.length) * hours;
console.log(`\n${todo.length} ${opt.suite} suite(s): ${lanes.claude.length} on Claude Code, ${lanes.codex.length} on Codex, side by side. Up to ${longest.toFixed(1)} h.`);
if (!opt.go) {
  console.log('Plan only. Add --go to play.');
  process.exit(0);
}

// One lane per CLI: suites in a lane run one after another.
const script = join(dirname(fileURLToPath(import.meta.url)), 'suite.mjs');
const playOne = (p) =>
  new Promise((resolve) => {
    const args = [script, '--model', p.model, '--suite', opt.suite, '--url', opt.url, '--codex-home', opt['codex-home']];
    if (p.effort) args.push('--effort', p.effort);
    if (p.resume) args.push('--resume', p.resume);
    const child = spawn(process.execPath, args, { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    const tag = `[${p.label}]`;
    for (const stream of [child.stdout, child.stderr]) {
      let buf = '';
      stream.on('data', (d) => {
        buf += d;
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const l of lines) console.log(`${tag} ${l}`);
      });
    }
    child.on('close', (code) => resolve(code));
  });

const results = [];
await Promise.all(
  Object.values(lanes).map(async (lane) => {
    for (const p of lane) {
      const code = await playOne(p);
      results.push({ label: p.label, code });
      if (code === 3) console.log(`!!! ${p.label}: lockdown broken, suite hidden; check the transcript`);
      else if (code !== 0) console.log(`!!! ${p.label}: suite.mjs exited ${code}`);
    }
  }),
);
console.log(`\nSweep done: ${results.filter((r) => r.code === 0).length} of ${results.length} suites played cleanly.`);
