#!/usr/bin/env node
// Makes coding v2's cubes: the hidden ones (into the database) and the
// practice ones (into each stage's kit). Every cube is a 20·(N−2)-move random
// walk; our reference solvers (grader/v2/ref) then take it through centres,
// edges and finish in the grading image, on the grader's own core, exactly
// as a model's programs run. Each stage's input is where the one before left
// the cube; its reference moves and CPU time set the move cap and CPU limit.
//
//   ADMIN_ENV_FILE=… node scripts/code2-cases.mjs --hidden      10 per size into cube_arena.code_cases (crypto randomness)
//   node scripts/code2-cases.mjs --practice                     3 per size into public/code-kit/{v2,v2-mini}/<stage>/practice.json
//   … --sizes 4,5 --count 2 --dry                               try it without writing anything
//
// Hidden scrambles never leave this machine except into the database.

import { createHash, randomInt } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { CORE, REPO, ensureImage, log, reserveCore, runStage, step } from './grader-lib.mjs';

const { values: opt } = parseArgs({
  options: {
    hidden: { type: 'boolean', default: false },
    practice: { type: 'boolean', default: false },
    sizes: { type: 'string', default: '4,5,6,7,8,9,10' },
    count: { type: 'string' },
    dry: { type: 'boolean', default: false },
    replace: { type: 'boolean', default: false },
  },
});
if (opt.hidden === opt.practice) {
  console.error('say --hidden or --practice');
  process.exit(2);
}

const IMAGE = 'cube-arena-code:v2';
const VERSION = 'v2';
const STAGES = ['centres', 'edges', 'finish'];
const SIZES = opt.sizes.split(',').map(Number);
const COUNT = Number(opt.count ?? (opt.hidden ? 10 : 3));
/** The grading sandbox's limits (lib/arena/code2-rules.ts). */
const LIMITS = { cpus: 1, memoryMb: 2048 };
/** The reference itself may take this long on any cube (it takes under 5 s). */
const REF_CPU_MS = 120_000;
const MINI_SIZES = [4, 5, 6];
const capOf = (ref) => 2 * ref;
const cpuLimitOf = (ms) => Math.min(60_000, Math.max(5_000, Math.round(5 * ms)));

/** Seeded PRNG (mulberry32), as lib/cube/scramble.ts. */
function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const AXIS = { U: 1, D: 1, R: 0, L: 0, F: 2, B: 2 };

/** randomWalk from lib/cube/scramble.ts: outer blocks up to half the cube, never the same axis twice in a row. */
function randomWalk(n, length, random) {
  const pool = [];
  for (const face of 'URFDLB') {
    for (let depth = 1; depth <= Math.max(1, Math.floor(n / 2)); depth++) {
      const base = depth === 1 ? face : `${depth === 2 ? '' : depth}${face}w`;
      for (const sfx of ['', "'", '2']) pool.push({ token: base + sfx, axis: AXIS[face] });
    }
  }
  const out = [];
  let last = -1;
  while (out.length < length) {
    const m = pool[Math.floor(random() * pool.length)];
    if (m.axis === last) continue;
    out.push(m.token);
    last = m.axis;
  }
  return out.join(' ');
}

const solved = (n) => [...'URFDLB'].map((f) => f.repeat(n * n)).join('');
const cryptoRandom = () => randomInt(0, 2 ** 32) / 2 ** 32;
const practiceRandom = (n, i) => mulberry(createHash('sha256').update(`code:${VERSION}:practice:${n}:${i}`).digest().readUInt32BE(0));

/** One cube through the reference chain: each stage's input, moves and CPU time. */
async function chain(n, i, random, empty) {
  const scramble = randomWalk(n, 20 * (n - 2), random);
  const start = step(solved(n), scramble, 'centres');
  if (!start.ok) throw new Error(`scramble: ${start.error}`);
  if (start.done) return null; // centres already solved: no case (vanishingly rare)
  let state = start.state;
  const states = [];
  const refMoves = [];
  const refCpu = [];
  for (const stage of STAGES) {
    states.push(state);
    const run = await runStage(IMAGE, `cube-ref-${n}-${i}-${stage}`, LIMITS, empty, { n, state, cpuLimitMs: REF_CPU_MS, folder: '/ref', script: `solve_${stage}.py` });
    if (run.exit_code !== 0) throw new Error(`reference ${stage} on ${n}x${n} #${i}: ${run.timed_out ? `timed out (${run.timed_out})` : `exit ${run.exit_code}`}\n${run.stderr}`);
    const s = step(state, run.stdout, stage);
    if (!s.ok || !s.done) throw new Error(`reference ${stage} on ${n}x${n} #${i} left the goal unmet: ${s.error ?? ''}`);
    refMoves.push(s.moves);
    refCpu.push(Math.max(1, Math.round(run.cpu_ms)));
    state = s.state;
  }
  return { n, case_no: i, scramble, states, ref_moves: refMoves, ref_cpu_ms: refCpu };
}

ensureImage(IMAGE, 'grader/v2');
const empty = mkdtempSync(join(tmpdir(), 'cube-ref-'));
const own = reserveCore(true);
log(`making ${COUNT} ${opt.hidden ? 'hidden' : 'practice'} cubes for sizes ${SIZES.join(', ')}${CORE ? `, on CPU ${CORE.cpu}${own ? '' : ' (shared: the reservation failed)'}` : ''}`);
const cases = [];
try {
  for (const n of SIZES) {
    for (let i = 0; cases.filter((c) => c.n === n).length < COUNT; i++) {
      const c = await chain(n, cases.filter((x) => x.n === n).length, opt.hidden ? cryptoRandom : practiceRandom(n, i), empty);
      if (c) cases.push(c);
    }
    const mine = cases.filter((c) => c.n === n);
    const mean = (k, j) => Math.round(mine.reduce((a, c) => a + c[k][j], 0) / mine.length);
    log(`${n}x${n}: moves ${STAGES.map((_, j) => mean('ref_moves', j)).join(' / ')}, CPU ms ${STAGES.map((_, j) => mean('ref_cpu_ms', j)).join(' / ')}`);
  }
} finally {
  if (CORE) reserveCore(false);
  rmSync(empty, { recursive: true, force: true });
}

if (opt.dry) {
  log(`dry run: ${cases.length} cubes, nothing written`);
} else if (opt.practice) {
  for (const bench of ['v2', 'v2-mini']) {
    STAGES.forEach((stage, j) => {
      const dir = join(REPO, 'public/code-kit', bench, stage);
      mkdirSync(dir, { recursive: true });
      const list = cases
        .filter((c) => bench === 'v2' || MINI_SIZES.includes(c.n))
        .map((c) => ({
          n: c.n,
          case: c.case_no,
          state: c.states[j],
          ...(j === 0 && { scramble: c.scramble }),
          ref_moves: c.ref_moves[j],
          cap: capOf(c.ref_moves[j]),
          cpu_limit_ms: cpuLimitOf(c.ref_cpu_ms[j]),
        }));
      writeFileSync(join(dir, 'practice.json'), `${JSON.stringify({ version: bench, stage, cases: list }, null, 1)}\n`);
    });
  }
  log('practice.json written for v2 and v2-mini');
} else {
  const { adminSql } = await import('./admin-db.mjs');
  const sql = adminSql();
  try {
    await sql.begin(async (tx) => {
      if (opt.replace) await tx`delete from cube_arena.code_cases where version = ${VERSION} and size in ${tx(SIZES)}`;
      for (const c of cases) {
        await tx`insert into cube_arena.code_cases (version, size, case_no, states, ref_moves, ref_cpu_ms)
                 values (${VERSION}, ${c.n}, ${c.case_no}, ${c.states}, ${c.ref_moves}, ${c.ref_cpu_ms})`;
      }
    });
    log(`${cases.length} hidden cubes stored`);
  } finally {
    await sql.end();
  }
}
