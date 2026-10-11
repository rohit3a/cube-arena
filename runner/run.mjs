#!/usr/bin/env node
// Verified runner: plays one Cube Arena run with an official command-line
// agent, Claude Code or Codex, with its tools locked to the label (see
// agent.mjs). Runs land on the Verified board because the operator token
// rides along as an MCP header. For the index, use suite.mjs.
//
//   node --env-file=.env.local runner/run.mjs --model claude-opus-5-5 [--effort high] \
//     [--size 3] [--mode interactive|one_shot] [--challenge ladder|scramble] \
//     [--url https://cube.krnl.studio/mcp]
//   node --env-file=.env.local runner/run.mjs --model gpt-6-astra --effort xhigh
//
// The board name is worked out from the exact model id and effort
// ("Claude Opus 5.5 (high)", "GPT-6-Astra (xhigh)"), so it cannot be mistyped,
// and aliases like "opus" are refused, as are efforts a model does not have.
//
// Needs CUBE_OPERATOR_TOKEN. Nothing times the model out. If the agent stops
// before the run is over (a crash, or it just quits), the run is stopped.
// Transcripts go to runner/out/ (gitignored), with image data left out.

import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { playSession } from './agent.mjs';
import { resolveModel } from './models.mjs';

const { values: opt } = parseArgs({
  options: {
    model: { type: 'string' },
    effort: { type: 'string', default: 'high' },
    size: { type: 'string', default: '3' },
    mode: { type: 'string', default: 'interactive' },
    challenge: { type: 'string', default: 'ladder' },
    url: { type: 'string', default: 'https://cube.krnl.studio/mcp' },
    name: { type: 'string', default: 'Cube Arena' },
    'codex-home': { type: 'string', default: join(homedir(), '.codex-bench') },
    probe: { type: 'boolean', default: false },
  },
});

const fail = (msg) => {
  console.error(msg);
  process.exit(2);
};
const token = process.env.CUBE_OPERATOR_TOKEN;
if (!token) fail('CUBE_OPERATOR_TOKEN is not set (run with --env-file=.env.local)');
if (!opt.model) fail('--model is required: the full model id, e.g. claude-opus-5-5 or gpt-6-astra');
if (!['2', '3', '4', '5'].includes(opt.size)) fail('--size must be 2, 3, 4 or 5');
if (!['interactive', 'one_shot'].includes(opt.mode)) fail('--mode must be interactive or one_shot');
if (!['ladder', 'scramble'].includes(opt.challenge)) fail('--challenge must be ladder or scramble');
const m = resolveModel(opt.model, opt.effort, opt['codex-home']);
if (m.error) fail(m.error);

const out = join(dirname(fileURLToPath(import.meta.url)), 'out');
mkdirSync(out, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const logPath = join(out, `${stamp}-${opt.model}-${m.effort ?? 'default'}-${opt.size}x${opt.size}-${opt.mode}-${opt.challenge}.jsonl`);

const prompt = opt.probe
  ? 'Call the get_rules tool once, then reply with one line: how many images it returned and the first sentence of its text.'
  : `Let's play Cube Arena. First call get_rules. Then call start_run with size ${opt.size}, mode "${opt.mode}", challenge "${opt.challenge}", ` +
    `tool_use "model_only", and any display_name and model_name (the server fills them in for this run). ` +
    `Solve each cube from the pictures only. Keep going until the run ends, then reply with your result in one line.`;

console.log(`${m.label} [${opt.model}, ${m.agent}]: ${opt.size}×${opt.size} ${opt.mode} ${opt.challenge} → ${opt.url}`);
console.log(`transcript: ${logPath}`);

const r = await playSession({
  agent: m.agent,
  model: opt.model,
  effort: m.effort,
  prompt,
  headers: { 'x-arena-model': m.label, 'x-arena-tool-use': 'model_only', 'x-arena-name': opt.name },
  url: opt.url,
  token,
  codexHome: opt['codex-home'],
  logPath,
});

console.log(`\nexit ${r.code} after ${r.minutes.toFixed(1)} min, ${r.calls} tool calls`);
if (r.final) console.log(`final: ${r.final.slice(0, 400)}`);
if (r.last) console.log(`result: best level ${r.last.best_level}, replay ${r.last.replay_url ?? '-'}`);
process.exitCode = r.breach ? 3 : r.code ?? 1;
