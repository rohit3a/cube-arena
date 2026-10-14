#!/usr/bin/env node
// Grades coding benchmark submissions on this machine (the ROG), one at a
// time, so every solver runs on the same hardware. Takes the next queued
// submission from the site, runs its frozen solver/ on the hidden cubes in
// Docker, and posts what it printed for each; the site checks every answer.
// v2 (the NxN ladder) the same way, a stage at a time, each run under the
// cube's CPU-time limit (grader/v2/run_stage.py), then the three stage
// programs chained end to end.
//
//   node --env-file=.env.local scripts/code-worker.mjs           keep polling
//   node --env-file=.env.local scripts/code-worker.mjs --once    grade at most one, then exit
//   node scripts/code-worker.mjs --release                      give the grader's core back, then exit
//
// The solver is untrusted code. Every step (unpacking, build.py, each cube)
// runs in a fresh container: no network, no capabilities, a read-only root,
// one CPU and the memory limit, as this machine's ordinary user, with only
// that submission's folder mounted (read-only while solving). Its folder may
// not grow past MAX_SOLVER_BYTES. Needs CUBE_OPERATOR_TOKEN and Docker.
//
// The ROG is shared with other work, so the grader gets a core of its own:
// containers run on one thread of the last core, and while a submission is
// graded everything else (system services, other containers, this user's
// programs) is kept off both of that core's threads. Runtime settings only,
// through sudo; given back after each submission, at start and on stop.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { CORE, docker, ensureImage, folderBytes, graderName, log, reserveCore, runStage, sandbox, step } from './grader-lib.mjs';

const { values: opt } = parseArgs({
  options: {
    once: { type: 'boolean', default: false },
    release: { type: 'boolean', default: false },
    url: { type: 'string', default: process.env.CUBE_ARENA_SITE ?? 'https://cube.krnl.studio' },
  },
});
const SITE = opt.url.replace(/\/$/, '');
const TOKEN = process.env.CUBE_OPERATOR_TOKEN;

const IMAGE = 'cube-arena-code:v1';
const IMAGE2 = 'cube-arena-code:v2';
const ROOT = process.env.CODE_GRADER_DIR || '/mnt/rog-data/cube-arena-grader';
const POLL_MS = 60_000;
/** What build.py may leave in solver/. */
const MAX_SOLVER_BYTES = 2 * 1024 ** 3;
const STAGES = ['centres', 'edges', 'finish'];
/** Kept of each v2 answer, whitespace squeezed (the longest answer under any cap is a fraction of it). */
const ANSWER_KEEP = 64 * 1024;

if (opt.release) {
  process.exit(reserveCore(false) ? 0 : 1);
}
if (!TOKEN) {
  console.error('CUBE_OPERATOR_TOKEN is not set');
  process.exit(2);
}

async function api(path, body) {
  const res = await fetch(`${SITE}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${TOKEN}`, ...(body && { 'Content-Type': 'application/json' }) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return path.includes('kind=bundle') ? Buffer.from(await res.arrayBuffer()) : res.json();
}

async function grade(job) {
  const short = job.id.slice(0, 8);
  const limits = job.limits;
  const dir = join(ROOT, 'jobs', job.id);
  const solver = join(dir, 'solver');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(solver, { recursive: true });
  const ownCore = reserveCore(true);
  if (CORE) log(`${short}: ${ownCore ? `CPU ${CORE.cpu} to itself (CPUs ${CORE.threads.join('+')} kept clear)` : `CPU ${CORE.cpu}, shared: the reservation failed`}`);
  try {
    const bundle = await api(`/api/code/files?id=${job.id}&kind=bundle`);
    const sha = createHash('sha256').update(bundle).digest('hex');
    if (sha !== job.bundle_sha256) throw new Error(`bundle hash ${sha} is not the frozen ${job.bundle_sha256}`);

    // Unpacked inside a container too: a crafted archive can't reach past its folder.
    const unpack = await docker([...sandbox(IMAGE, `cube-unpack-${short}`, limits, solver, 'rw'), 'tar', '-xzf', '-', '--no-same-owner', '--no-same-permissions', '-C', '/solver'], {
      input: bundle,
      timeoutMs: 120_000,
      name: `cube-unpack-${short}`,
    });
    if (unpack.code !== 0) throw new Error(`could not unpack the solver: ${unpack.stderr.slice(-500)}`);

    const build = { ok: true, ms: 0, log: '' };
    if (existsSync(join(solver, 'build.py'))) {
      log(`${short}: build.py`);
      const started = Date.now();
      let tooBig = false;
      const watch = setInterval(() => {
        if (folderBytes(solver) > MAX_SOLVER_BYTES) {
          tooBig = true;
          spawnSync('docker', ['kill', `cube-build-${short}`], { stdio: 'ignore' });
        }
      }, 2000);
      const r = await docker([...sandbox(IMAGE, `cube-build-${short}`, limits, solver, 'rw'), 'python3', 'build.py'], {
        timeoutMs: limits.buildSecs * 1000,
        name: `cube-build-${short}`,
      });
      clearInterval(watch);
      build.ms = Date.now() - started;
      build.log = `${r.stdout}\n${r.stderr}`.slice(-20_000);
      build.ok = r.code === 0 && !r.timedOut && !tooBig;
      if (r.timedOut) build.log += `\n[grader] build.py ran past ${limits.buildSecs} s`;
      if (tooBig) build.log += `\n[grader] solver/ grew past ${MAX_SOLVER_BYTES} bytes`;
    }
    if (!existsSync(join(solver, 'solve.py'))) {
      build.ok = false;
      build.log += '\n[grader] solver/solve.py is missing';
    }
    log(`${short}: build ${build.ok ? 'ok' : 'FAILED'} in ${(build.ms / 1000).toFixed(1)} s`);

    const results = [];
    if (build.ok) {
      for (const c of job.cases) {
        const name = `cube-case-${short}-${c.n}`;
        const r = await docker([...sandbox(IMAGE, name, limits, solver, 'ro'), 'python3', '/grade/run_case.py', String(limits.solveSecs)], {
          input: `${c.state}\n`,
          timeoutMs: (limits.solveSecs + 30) * 1000,
          name,
        });
        let out = null;
        try {
          out = JSON.parse(r.stdout.trim().split('\n').pop() ?? '');
        } catch {
          // The wrapper died with it (memory, or the host's timeout): no answer.
        }
        const res = out
          ? { n: c.n, stdout: out.stdout, exit_code: out.exit_code, timed_out: out.timed_out, ms: out.ms }
          : { n: c.n, stdout: '', exit_code: r.timedOut ? null : (r.code ?? null), timed_out: r.timedOut, ms: r.timedOut ? (limits.solveSecs + 30) * 1000 : 0 };
        results.push(res);
        log(`${short}: cube ${c.n} → ${res.timed_out ? 'timeout' : res.exit_code === 0 ? `${res.stdout.trim().split(/\s+/).filter(Boolean).length} tokens` : `exit ${res.exit_code}`} in ${(res.ms / 1000).toFixed(1)} s`);
      }
    }
    const { submission } = await api('/api/code/jobs', { id: job.id, grader: graderName(IMAGE, ownCore), build, results });
    log(`${short}: graded: ${submission.solved}/${submission.cases} solved, score ${Number(submission.score).toFixed(2)}`);
  } catch (e) {
    log(`${short}: grader error: ${e.message}`);
    await api('/api/code/jobs', { id: job.id, error: `grader: ${e.message}` }).catch((err) => log(`(could not report it: ${err.message})`));
  } finally {
    if (CORE) reserveCore(false);
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Unpacks a bundle into `folder` and runs its build.py (if any): {ok, ms, log}. Every step in the sandbox. */
async function unpackAndBuild(image, name, limits, folder, bundle) {
  // Unpacked inside a container too: a crafted archive can't reach past its folder.
  const unpack = await docker([...sandbox(image, `cube-unpack-${name}`, limits, folder, 'rw'), 'tar', '-xzf', '-', '--no-same-owner', '--no-same-permissions', '-C', '/solver'], {
    input: bundle,
    timeoutMs: 120_000,
    name: `cube-unpack-${name}`,
  });
  if (unpack.code !== 0) return { ok: false, ms: 0, log: `[grader] could not unpack it: ${unpack.stderr.slice(-500)}` };
  const build = { ok: true, ms: 0, log: '' };
  if (existsSync(join(folder, 'build.py'))) {
    const started = Date.now();
    let tooBig = false;
    const watch = setInterval(() => {
      if (folderBytes(folder) > MAX_SOLVER_BYTES) {
        tooBig = true;
        spawnSync('docker', ['kill', `cube-build-${name}`], { stdio: 'ignore' });
      }
    }, 2000);
    const r = await docker([...sandbox(image, `cube-build-${name}`, limits, folder, 'rw'), 'python3', 'build.py'], {
      timeoutMs: limits.buildSecs * 1000,
      name: `cube-build-${name}`,
    });
    clearInterval(watch);
    build.ms = Date.now() - started;
    build.log = `${r.stdout}\n${r.stderr}`.slice(-20_000);
    build.ok = r.code === 0 && !r.timedOut && !tooBig;
    if (r.timedOut) build.log += `\n[grader] build.py ran past ${limits.buildSecs} s`;
    if (tooBig) build.log += `\n[grader] the folder grew past ${MAX_SOLVER_BYTES} bytes`;
  }
  if (!existsSync(join(folder, 'solve.py'))) {
    build.ok = false;
    build.log += '\n[grader] solve.py is missing';
  }
  return build;
}

/** What goes back to the site of one v2 run: the answer with whitespace squeezed, cut at ANSWER_KEEP (then it counts as too long). */
function answer(run) {
  const out = run.stdout.replace(/\s+/g, ' ').trim();
  return {
    stdout: out.slice(0, ANSWER_KEEP),
    truncated: run.truncated || out.length > ANSWER_KEEP,
    stderr: (run.stderr ?? '').slice(-2000),
    exit_code: run.exit_code,
    timed_out: run.timed_out,
    cpu_ms: run.cpu_ms,
  };
}

const failed = (run, limitMs) => run.timed_out || run.exit_code !== 0 || run.truncated || run.cpu_ms > limitMs;

/**
 * Grades a v2 submission: builds each stage's folder, runs each stage program
 * on its stage's input for every hidden cube, then chains the three on every
 * scrambled cube (end to end; the centres run is the stage run, the same
 * program on the same cube). Posts the runs a size at a time; the site grades them.
 */
async function grade2(job) {
  const short = job.id.slice(0, 8);
  const limits = job.limits;
  const dir = join(ROOT, 'jobs', job.id);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const ownCore = reserveCore(true);
  log(`${short}: ${job.version}${CORE ? `, ${ownCore ? `CPU ${CORE.cpu} to itself` : `CPU ${CORE.cpu}, shared: the reservation failed`}` : ''}`);
  const builds = {};
  try {
    for (const stage of STAGES) {
      const folder = join(dir, stage);
      mkdirSync(folder);
      const bundle = await api(`/api/code/files?id=${job.id}&kind=bundle&stage=${stage}`);
      const sha = createHash('sha256').update(bundle).digest('hex');
      if (sha !== job.bundles[stage]) throw new Error(`${stage} bundle hash ${sha} is not the frozen ${job.bundles[stage]}`);
      builds[stage] = await unpackAndBuild(IMAGE2, `${short}-${stage}`, limits, folder, bundle);
      log(`${short}: ${stage} build ${builds[stage].ok ? 'ok' : 'FAILED'} in ${(builds[stage].ms / 1000).toFixed(1)} s`);
    }
    const centres = new Map();
    for (const [i, stage] of STAGES.entries()) {
      if (!builds[stage].ok) continue;
      for (const n of limits.sizes) {
        const batch = [];
        for (const c of job.cases.filter((x) => x.n === n)) {
          const run = await runStage(IMAGE2, `cube2-${short}-${stage}-${n}-${c.case_no}`, limits, join(dir, stage), { n, state: c.inputs[i], cpuLimitMs: c.cpu_limit_ms[i] });
          if (i === 0) centres.set(`${n}:${c.case_no}`, run);
          batch.push({ part: stage, n, case_no: c.case_no, run: answer(run) });
        }
        const { saved } = await api('/api/code/jobs', { id: job.id, results: batch });
        const ok = batch.filter((r) => !failed(r.run, Infinity)).length;
        log(`${short}: ${stage} ${n}x${n}: ${ok}/${batch.length} answered, mean CPU ${(batch.reduce((a, r) => a + r.run.cpu_ms, 0) / batch.length / 1000).toFixed(2)} s (${saved} saved)`);
      }
    }
    if (STAGES.every((st) => builds[st].ok)) {
      for (const n of limits.sizes) {
        const batch = [];
        for (const c of job.cases.filter((x) => x.n === n)) {
          let state = c.inputs[0];
          const runs = [];
          const inputs = [];
          for (const [i, stage] of STAGES.entries()) {
            inputs.push(state);
            const run = i === 0 ? centres.get(`${n}:${c.case_no}`) : await runStage(IMAGE2, `cube2-${short}-e2e-${stage}-${n}-${c.case_no}`, limits, join(dir, stage), { n, state, cpuLimitMs: c.cpu_limit_ms[i] });
            const a = answer(run);
            runs.push(a);
            if (failed(a, c.cpu_limit_ms[i])) break;
            const next = step(state, a.stdout, stage);
            if (!next.ok || !next.done) break;
            state = next.state;
          }
          batch.push({ part: 'e2e', n, case_no: c.case_no, runs, inputs });
        }
        await api('/api/code/jobs', { id: job.id, results: batch });
        log(`${short}: end to end ${n}x${n}: ${batch.filter((r) => r.runs.length === 3).length}/${batch.length} reached finish`);
      }
    }
    const { submission } = await api('/api/code/jobs', { id: job.id, done: true, grader: graderName(IMAGE2, ownCore), builds });
    log(`${short}: graded: score ${Number(submission.score).toFixed(2)} (${['centres', 'edges', 'finish', 'e2e'].map((p) => `${p} ${submission.parts[p].score.toFixed(3)}`).join(', ')})`);
  } catch (e) {
    log(`${short}: grader error: ${e.message}`);
    await api('/api/code/jobs', { id: job.id, error: `grader: ${e.message}` }).catch((err) => log(`(could not report it: ${err.message})`));
  } finally {
    if (CORE) reserveCore(false);
    rmSync(dir, { recursive: true, force: true });
  }
}

ensureImage(IMAGE, 'grader');
ensureImage(IMAGE2, 'grader/v2');
mkdirSync(join(ROOT, 'jobs'), { recursive: true });
// Left reserved by a worker that was killed mid-grade.
if (CORE) reserveCore(false);
log(`grading for ${SITE} with ${IMAGE} and ${IMAGE2}${opt.once ? ' (once)' : ''}${CORE ? `, on CPU ${CORE.cpu}` : ''}`);
let stopping = false;
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => (stopping = true));
while (!stopping) {
  let job = null;
  for (const path of ['/api/code/jobs', '/api/code/jobs?version=v2']) {
    try {
      ({ job } = await api(path));
    } catch (e) {
      log(`could not ask for work: ${e.message}`);
    }
    if (job) break;
  }
  if (job) await (job.version === 'v2' || job.version === 'v2-mini' ? grade2(job) : grade(job));
  if (opt.once) break;
  if (!job) await new Promise((r) => setTimeout(r, POLL_MS));
}
