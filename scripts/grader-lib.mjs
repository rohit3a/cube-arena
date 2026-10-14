// What the ROG's graders share: the core they keep to themselves, Docker
// runs with a time limit, and the locked-down sandbox every untrusted step
// runs in. Used by code-worker.mjs (which grades v1 and v2) and
// code2-cases.mjs (which times our reference solvers the same way).

import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { cpus, hostname, userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
/** The grader's containers go here, beside system.slice and user.slice rather than in them. */
const SLICE = 'grader.slice';
const { uid, gid } = userInfo();
export const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

/** "0-2,4,6-7" → [0, 1, 2, 4, 6, 7] */
const cpuList = (s) =>
  s.trim().split(',').filter(Boolean).flatMap((part) => {
    const [a, b = a] = part.split('-').map(Number);
    return Array.from({ length: b - a + 1 }, (_, i) => a + i);
  });

/** The last core (or the one CODE_GRADER_CPU is on): the thread the cubes run on, both its threads, and every other CPU. */
function pickCore() {
  try {
    const online = cpuList(readFileSync('/sys/devices/system/cpu/online', 'utf8'));
    const cpu = Number(process.env.CODE_GRADER_CPU ?? online.at(-1));
    const threads = cpuList(readFileSync(`/sys/devices/system/cpu/cpu${cpu}/topology/thread_siblings_list`, 'utf8'));
    const others = online.filter((c) => !threads.includes(c));
    return others.length ? { cpu: threads[0], threads, others } : null;
  } catch {
    return null;
  }
}
export const CORE = pickCore();

/** Keeps everything else off the grader's core (true), or gives it back (false). Reports whether every slice took it. */
export function reserveCore(on) {
  if (!CORE) return false;
  let ok = true;
  for (const slice of ['system.slice', 'user.slice']) {
    const r = spawnSync('sudo', ['systemctl', 'set-property', '--runtime', slice, `AllowedCPUs=${on ? CORE.others.join(',') : ''}`], {
      encoding: 'utf8',
      timeout: 120_000,
    });
    if (r.status !== 0) {
      ok = false;
      log(`could not ${on ? 'reserve' : 'give back'} CPUs ${CORE.threads.join('+')} on ${slice}: ${(r.stderr || r.error?.message || `exit ${r.status}`).trim().slice(0, 200)}`);
    }
  }
  return ok;
}

/** Runs docker; resolves with its exit code and output. Past `timeoutMs` the named container is killed. */
export function docker(args, { input, timeoutMs, name, maxOut = 1 << 20 }) {
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

/** A fresh, locked-down container of `image` with `dir` mounted at /solver. */
export const sandbox = (image, name, limits, dir, mode) => [
  'run', '--rm', '-i', '--name', name,
  '--network', 'none',
  '--cgroup-parent', SLICE,
  ...(CORE ? ['--cpuset-cpus', String(CORE.cpu)] : []),
  '--cpus', String(limits.cpus),
  '--memory', `${limits.memoryMb}m`, '--memory-swap', `${limits.memoryMb}m`,
  '--pids-limit', '256',
  '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
  '--read-only', '--tmpfs', '/tmp:rw,exec,size=512m',
  '--ulimit', 'nofile=1024:1024',
  '--user', `${uid}:${gid}`, '-e', 'HOME=/tmp',
  '--init',
  '-v', `${dir}:/solver:${mode}`, '-w', '/solver',
  image,
];

export function folderBytes(dir) {
  const r = spawnSync('du', ['-sb', dir], { encoding: 'utf8' });
  return Number(r.stdout.split('\t')[0]) || 0;
}

/** Builds `image` from `context` (relative to the repo) if this machine doesn't have it. */
export function ensureImage(image, context) {
  if (spawnSync('docker', ['image', 'inspect', image], { stdio: 'ignore' }).status === 0) return;
  log(`building ${image}`);
  const r = spawnSync('docker', ['build', '-t', image, join(REPO, context)], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`could not build ${image}`);
}

export function graderName(image, ownCore) {
  const id = spawnSync('docker', ['image', 'inspect', image, '--format', '{{.Id}}'], { encoding: 'utf8' }).stdout.trim();
  return `${hostname()} · ${image} ${id.slice(7, 19)} · ${cpus()[0]?.model ?? 'cpu'} · ${ownCore ? 'own core' : 'shared core'}`;
}

/** Where an answer leaves the cube (grader/v2/step.py, on the host): {ok, state, moves, done} or {ok: false, error}. */
export function step(state, moves, stage) {
  const r = spawnSync('python3', [join(REPO, 'grader/v2/step.py')], { input: JSON.stringify({ state, moves, stage }), encoding: 'utf8', maxBuffer: 16 << 20 });
  try {
    return JSON.parse(r.stdout);
  } catch {
    return { ok: false, error: `step.py: ${(r.stderr || `exit ${r.status}`).slice(-300)}` };
  }
}

/**
 * Runs one stage program on one cube in the sandbox, through run_stage.py
 * (CPU-time limit from the container's own cgroup). Resolves with what
 * run_stage.py reports: stdout, truncated, stderr, exit_code, timed_out, cpu_ms, wall_ms.
 */
export async function runStage(image, name, limits, dir, { n, state, cpuLimitMs, folder = '/solver', script = 'solve.py' }) {
  const secs = cpuLimitMs / 1000;
  const wallMs = (Math.max(3 * secs, secs + 30) + 60) * 1000;
  const r = await docker([...sandbox(image, name, limits, dir, 'ro'), 'python3', '/grade/run_stage.py', String(secs), folder, script], {
    input: `${n}\n${state}\n`,
    timeoutMs: wallMs,
    name,
    maxOut: 4 << 20,
  });
  try {
    return JSON.parse(r.stdout.trim().split('\n').pop() ?? '');
  } catch {
    // The wrapper died with it (memory, or the host's timeout): no answer.
    return { stdout: '', truncated: false, stderr: r.stderr.slice(-2000), exit_code: r.timedOut ? null : (r.code ?? null), timed_out: r.timedOut ? 'wall' : null, cpu_ms: 0, wall_ms: wallMs };
  }
}
