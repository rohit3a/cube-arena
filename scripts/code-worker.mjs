#!/usr/bin/env node
// Grades coding benchmark submissions on this machine (the ROG), one at a
// time, so every solver runs on the same hardware. Takes the next queued
// submission from the site, runs its frozen solver/ on the hidden cubes in
// Docker, and posts what it printed for each; the site checks every answer.
//
//   node --env-file=.env.local scripts/code-worker.mjs           keep polling
//   node --env-file=.env.local scripts/code-worker.mjs --once    grade at most one, then exit
//
// The solver is untrusted code. Every step (unpacking, build.py, each cube)
// runs in a fresh container: no network, no capabilities, a read-only root,
// one CPU and the memory limit, as this machine's ordinary user, with only
// that submission's folder mounted (read-only while solving). Its folder may
// not grow past MAX_SOLVER_BYTES. Needs CUBE_OPERATOR_TOKEN and Docker.

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { cpus, hostname, userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const { values: opt } = parseArgs({
  options: { once: { type: 'boolean', default: false }, url: { type: 'string', default: process.env.CUBE_ARENA_SITE ?? 'https://cube.krnl.studio' } },
});
const SITE = opt.url.replace(/\/$/, '');
const TOKEN = process.env.CUBE_OPERATOR_TOKEN;
if (!TOKEN) {
  console.error('CUBE_OPERATOR_TOKEN is not set');
  process.exit(2);
}

const IMAGE = 'cube-arena-code:v1';
const ROOT = process.env.CODE_GRADER_DIR || '/mnt/rog-data/cube-arena-grader';
const POLL_MS = 60_000;
/** What build.py may leave in solver/. */
const MAX_SOLVER_BYTES = 2 * 1024 ** 3;
const { uid, gid } = userInfo();
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function api(path, body) {
  const res = await fetch(`${SITE}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${TOKEN}`, ...(body && { 'Content-Type': 'application/json' }) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return path.includes('kind=bundle') ? Buffer.from(await res.arrayBuffer()) : res.json();
}

/** Runs docker; resolves with its exit code and output. Past `timeoutMs` the named container is killed. */
function docker(args, { input, timeoutMs, name, maxOut = 1 << 20 }) {
  return new Promise((resolve) => {
    const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.on('data', (d) => {
      if (stdout.length < maxOut) stdout += d;
    });
    child.stderr.on('data', (d) => {
      stderr = (stderr + d).slice(-20_000);
    });
    const timer = setTimeout(() => {
      timedOut = true;
      spawnSync('docker', ['kill', name], { stdio: 'ignore' });
    }, timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input ?? '');
  });
}

/** A fresh, locked-down container with the solver folder mounted. */
const sandbox = (name, limits, solverDir, mode) => [
  'run', '--rm', '-i', '--name', name,
  '--network', 'none',
  '--cpus', String(limits.cpus),
  '--memory', `${limits.memoryMb}m`, '--memory-swap', `${limits.memoryMb}m`,
  '--pids-limit', '256',
  '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
  '--read-only', '--tmpfs', '/tmp:rw,exec,size=512m',
  '--ulimit', 'nofile=1024:1024',
  '--user', `${uid}:${gid}`, '-e', 'HOME=/tmp',
  '--init',
  '-v', `${solverDir}:/solver:${mode}`, '-w', '/solver',
  IMAGE,
];

function folderBytes(dir) {
  const r = spawnSync('du', ['-sb', dir], { encoding: 'utf8' });
  return Number(r.stdout.split('\t')[0]) || 0;
}

function ensureImage() {
  if (spawnSync('docker', ['image', 'inspect', IMAGE], { stdio: 'ignore' }).status === 0) return;
  log(`building ${IMAGE}`);
  const here = dirname(fileURLToPath(import.meta.url));
  const r = spawnSync('docker', ['build', '-t', IMAGE, join(here, '..', 'grader')], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`could not build ${IMAGE}`);
}

function graderName() {
  const id = spawnSync('docker', ['image', 'inspect', IMAGE, '--format', '{{.Id}}'], { encoding: 'utf8' }).stdout.trim();
  return `${hostname()} · ${IMAGE} ${id.slice(7, 19)} · ${cpus()[0]?.model ?? 'cpu'}`;
}

async function grade(job) {
  const short = job.id.slice(0, 8);
  const limits = job.limits;
  const dir = join(ROOT, 'jobs', job.id);
  const solver = join(dir, 'solver');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(solver, { recursive: true });
  try {
    const bundle = await api(`/api/code/files?id=${job.id}&kind=bundle`);
    const sha = createHash('sha256').update(bundle).digest('hex');
    if (sha !== job.bundle_sha256) throw new Error(`bundle hash ${sha} is not the frozen ${job.bundle_sha256}`);

    // Unpacked inside a container too: a crafted archive can't reach past its folder.
    const unpack = await docker([...sandbox(`cube-unpack-${short}`, limits, solver, 'rw'), 'tar', '-xzf', '-', '--no-same-owner', '--no-same-permissions', '-C', '/solver'], {
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
      const r = await docker([...sandbox(`cube-build-${short}`, limits, solver, 'rw'), 'python3', 'build.py'], {
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
        const r = await docker([...sandbox(name, limits, solver, 'ro'), 'python3', '/grade/run_case.py', String(limits.solveSecs)], {
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
    const { submission } = await api('/api/code/jobs', { id: job.id, grader: graderName(), build, results });
    log(`${short}: graded: ${submission.solved}/${submission.cases} solved, score ${Number(submission.score).toFixed(2)}`);
  } catch (e) {
    log(`${short}: grader error: ${e.message}`);
    await api('/api/code/jobs', { id: job.id, error: `grader: ${e.message}` }).catch((err) => log(`(could not report it: ${err.message})`));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

ensureImage();
mkdirSync(join(ROOT, 'jobs'), { recursive: true });
log(`grading for ${SITE} with ${IMAGE}${opt.once ? ' (once)' : ''}`);
let stopping = false;
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => (stopping = true));
while (!stopping) {
  let job = null;
  try {
    ({ job } = await api('/api/code/jobs'));
  } catch (e) {
    log(`could not ask for work: ${e.message}`);
  }
  if (job) await grade(job);
  if (opt.once) break;
  if (!job) await new Promise((r) => setTimeout(r, POLL_MS));
}
