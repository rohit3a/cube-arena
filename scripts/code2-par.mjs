#!/usr/bin/env node
// Coding v2's par: the fewest moves any graded program has used on a cube,
// never more than our reference's. A solved cube is worth
// 0.5 + 0.5 x min(1, par / moves).
//
//   node --env-file=.env.local scripts/code2-par.mjs --set [--replace]   hidden cubes: par from the graded runs (the site keeps them fixed)
//   node --env-file=.env.local scripts/code2-par.mjs --rescore           value every graded v2 submission again against the pars
//   ADMIN_ENV_FILE=… node --env-file=.env.local scripts/code2-par.mjs --practice [--top 3] [--stage centres]
//       practice cubes: run the best graded programs of each stage on them (on
//       every size, a mini program too, until it fails at a size), in the
//       grading sandbox on a core that isn't the grader's (CODE_GRADER_CPU,
//       default 2), and write par_moves into each kit's practice.json; then run
//       code2-kit.mjs.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values: opt } = parseArgs({
  options: {
    set: { type: 'boolean', default: false },
    replace: { type: 'boolean', default: false },
    rescore: { type: 'boolean', default: false },
    practice: { type: 'boolean', default: false },
    top: { type: 'string', default: '3' },
    stage: { type: 'string' },
    url: { type: 'string', default: process.env.CUBE_ARENA_SITE ?? 'https://cube.krnl.studio' },
  },
});
const SITE = opt.url.replace(/\/$/, '');
const TOKEN = process.env.CUBE_OPERATOR_TOKEN;
if (!TOKEN) {
  console.error('CUBE_OPERATOR_TOKEN is not set');
  process.exit(2);
}
// Off the grader's core: its CPU time stays its own while this runs.
process.env.CODE_GRADER_CPU ??= '2';
const { CORE, REPO, ensureImage, log, runStage, step, unpackAndBuild } = await import('./grader-lib.mjs');

async function api(path, body) {
  const res = await fetch(`${SITE}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { authorization: `Bearer ${TOKEN}`, ...(body && { 'content-type': 'application/json' }) },
    body: body && JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${(await res.text()).slice(0, 300)}`);
  return (res.headers.get('content-type') ?? '').includes('json') ? res.json() : Buffer.from(await res.arrayBuffer());
}

if (opt.set) {
  const r = await api('/api/code/par', { set: true, replace: opt.replace });
  log(`${r.pars} pars set, ${r.below_reference} below our reference's moves`);
}

if (opt.rescore) {
  const { ids } = await api('/api/code/par');
  for (const id of ids) {
    const r = await api('/api/code/par', { rescore: id });
    log(`${id.slice(0, 8)}: ${r.before.toFixed(2)} -> ${r.after.toFixed(2)}`);
  }
}

if (opt.practice) {
  const IMAGE = 'cube-arena-code:v2';
  const STAGES = opt.stage ? [opt.stage] : ['centres', 'edges', 'finish'];
  const ROOT = join(process.env.CODE_GRADER_DIR || '/mnt/rog-data/cube-arena-grader', 'par');
  const kit = (bench, stage) => join(REPO, 'public/code-kit', bench, stage, 'practice.json');
  const { adminSql } = await import('./admin-db.mjs');
  const sql = adminSql();
  // Each stage's best programs so far (by that stage's score, which goes by moves against par once pars are set).
  const best = {};
  try {
    for (const stage of STAGES) {
      best[stage] = await sql`
        select id, version, model_id, effort, (parts -> ${stage} ->> 'score')::float as score
        from cube_arena.code_submissions
        where status = 'graded' and version in ('v2', 'v2-mini')
          and coalesce(hidden_reason, '') not like 'runner %' and coalesce(hidden_reason, '') not like 'reference %'
          and (parts -> ${stage} ->> 'score') is not null
        order by (parts -> ${stage} ->> 'score')::float desc limit ${Number(opt.top)}`;
    }
  } finally {
    await sql.end();
  }
  ensureImage(IMAGE, 'grader/v2');
  const limits = { cpus: 1, memoryMb: 2048, buildSecs: 600 };
  log(`practice par: the best ${opt.top} programs per stage, on CPU ${CORE?.cpu ?? 'any'}`);
  for (const stage of STAGES) {
    const file = kit('v2', stage);
    const practice = JSON.parse(readFileSync(file, 'utf8'));
    const fewest = new Map();
    for (const s of best[stage]) {
      const short = s.id.slice(0, 8);
      const folder = join(ROOT, `${short}-${stage}`);
      rmSync(folder, { recursive: true, force: true });
      mkdirSync(folder, { recursive: true });
      try {
        const bundle = await api(`/api/code/files?id=${s.id}&kind=bundle&stage=${stage}`);
        const build = await unpackAndBuild(IMAGE, `par-${short}-${stage}`, limits, folder, bundle);
        if (!build.ok) {
          log(`${short} ${stage}: build failed, skipped`);
          continue;
        }
        // Every size, a mini program's too (any program's moves count), smallest first, until it fails 3 cubes of a size.
        const cases = [...practice.cases].sort((a, b) => a.n - b.n || a.case - b.case);
        const failed = new Map();
        let solved = 0;
        let tried = 0;
        let stopAt = null;
        for (const c of cases) {
          stopAt = [...failed].find(([, k]) => k >= 3)?.[0] ?? null;
          if (stopAt) break;
          tried += 1;
          const run = await runStage(IMAGE, `par-${short}-${stage}-${c.n}-${c.case}`, limits, folder, { n: c.n, state: c.state, cpuLimitMs: c.cpu_limit_ms });
          const r = run.timed_out || run.exit_code !== 0 || run.truncated || run.cpu_ms > c.cpu_limit_ms ? null : step(c.state, run.stdout, stage);
          if (!r?.ok || !r.done || r.moves > c.cap) {
            failed.set(c.n, (failed.get(c.n) ?? 0) + 1);
            continue;
          }
          solved += 1;
          const key = `${c.n}:${c.case}`;
          if (!fewest.has(key) || r.moves < fewest.get(key)) fewest.set(key, r.moves);
        }
        log(`${short} ${stage} (${s.model_id} ${s.effort ?? ''}, ${s.version}): ${solved}/${tried} solved${stopAt ? `, stopped at ${stopAt}x${stopAt}` : ''}`);
      } finally {
        rmSync(folder, { recursive: true, force: true });
      }
    }
    for (const bench of ['v2', 'v2-mini']) {
      const f = kit(bench, stage);
      const p = JSON.parse(readFileSync(f, 'utf8'));
      for (const c of p.cases) c.par_moves = Math.min(c.ref_moves, fewest.get(`${c.n}:${c.case}`) ?? c.ref_moves);
      writeFileSync(f, `${JSON.stringify(p, null, 1)}\n`);
    }
    const all = practice.cases.map((c) => Math.min(c.ref_moves, fewest.get(`${c.n}:${c.case}`) ?? c.ref_moves) / c.ref_moves);
    log(`${stage}: par is ${(100 * all.reduce((a, b) => a + b, 0) / all.length).toFixed(0)}% of our reference's moves on average`);
  }
  log('practice.json updated; now run node scripts/code2-kit.mjs');
}
