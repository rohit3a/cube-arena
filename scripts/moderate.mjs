#!/usr/bin/env node
// Hide junk or fake runs from every public page (boards, live, replays, images),
// or fix a run's model name. Nothing is deleted: a hidden run can be unhidden. Talks to /api/admin/runs
// with the operator token.
//
//   node --env-file=.env.local scripts/moderate.mjs list [--limit 30] [--hidden]
//   node --env-file=.env.local scripts/moderate.mjs hide <run id | attempt id | replay URL> [--reason "fake model name"]
//   node --env-file=.env.local scripts/moderate.mjs unhide <run id | attempt id | replay URL>
//   node --env-file=.env.local scripts/moderate.mjs rename <run id | attempt id | replay URL> "GPT-6-Astra"
//   node --env-file=.env.local scripts/moderate.mjs transcript <run id>    what the model said and called in that test
//
// --url defaults to https://cube.krnl.studio. Boards catch up within ~20 s.
import { parseArgs } from 'node:util';

const { values: opt, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    url: { type: 'string', default: 'https://cube.krnl.studio' },
    limit: { type: 'string', default: '30' },
    hidden: { type: 'boolean', default: false },
    reason: { type: 'string' },
  },
});

const token = process.env.CUBE_OPERATOR_TOKEN;
if (!token) {
  console.error('CUBE_OPERATOR_TOKEN is not set (run with --env-file=.env.local)');
  process.exit(2);
}
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
if (process.env.VERCEL_PROTECTION_BYPASS) headers['x-vercel-protection-bypass'] = process.env.VERCEL_PROTECTION_BYPASS;
const api = `${opt.url.replace(/\/$/, '')}/api/admin/runs`;

async function call(init, query = '') {
  const res = await fetch(api + query, { ...init, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`${res.status}: ${body.error ?? res.statusText}`);
    process.exit(1);
  }
  return body;
}

const line = (r) =>
  [
    r.id,
    new Date(r.created_at).toISOString().slice(0, 16).replace('T', ' '),
    r.board.padEnd(9),
    `${r.size}x${r.size} ${r.challenge} ${r.mode} ${r.tool_use}`.padEnd(34),
    `${r.model_name} (${r.display_name}) via ${r.via}`,
    r.challenge === 'ladder' ? `best ${r.best_level}` : `${r.solves} solved`,
    r.status,
    r.hidden ? `HIDDEN${r.hidden_reason ? `: ${r.hidden_reason}` : ''}` : '',
  ]
    .filter(Boolean)
    .join('  ');

// Accepts a bare id or anything containing one (a /replay/<attempt id> URL).
const idFrom = (s) => s?.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];

const [cmd, target, newName] = positionals;
if (cmd === 'transcript') {
  const res = await fetch(`${opt.url.replace(/\/$/, '')}/api/admin/transcripts?run_id=${idFrom(target) ?? ''}`, { headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`${res.status}: ${body.error ?? res.statusText}`);
    process.exit(1);
  }
  console.log(`${body.model} (${body.effort ?? 'default'}) via ${body.agent}, ${body.minutes?.toFixed(1)} min${body.breach ? `, BREACH: ${body.breach}` : ''}`);
  for (const e of body.events ?? []) {
    const text = e.text.replace(/\s+/g, ' ');
    console.log(`[${String(e.t).padStart(4)}s] ${e.kind.padEnd(6)} ${e.tool ? `${e.tool} ` : ''}${e.kind === 'think' ? text.slice(0, 300) : text}`);
  }
} else if (cmd === 'list') {
  const { runs } = await call({ method: 'GET' }, `?limit=${Number(opt.limit) || 30}${opt.hidden ? '&hidden=1' : ''}`);
  for (const r of runs) console.log(line(r));
  if (runs.length === 0) console.log(opt.hidden ? 'no hidden runs' : 'no runs');
} else if (cmd === 'hide' || cmd === 'unhide') {
  const id = idFrom(target);
  if (!id) {
    console.error(`${cmd} needs a run id, attempt id or replay URL`);
    process.exit(2);
  }
  const { run } = await call({ method: 'POST', body: JSON.stringify({ id, hidden: cmd === 'hide', reason: opt.reason }) });
  console.log(line(run));
} else if (cmd === 'rename') {
  const id = idFrom(target);
  if (!id || !newName?.trim()) {
    console.error('rename needs a run id, attempt id or replay URL, then the exact model name');
    process.exit(2);
  }
  const { run } = await call({ method: 'POST', body: JSON.stringify({ id, model_name: newName }) });
  console.log(line(run));
} else {
  console.error('usage: moderate.mjs list [--limit N] [--hidden] | hide <id> [--reason text] | unhide <id> | rename <id> "Exact Model"');
  process.exit(2);
}
