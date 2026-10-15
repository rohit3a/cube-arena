// Coding v2's rules: the NxN ladder. A model writes three stage programs
// (centres, edges, finish), each in its own fresh session, for every size in
// the bench; each runs on hidden cubes whose inputs come from our reference
// solvers (grader/v2/ref), so a failure in one stage never spills into the
// next. End to end, the grader chains the model's three programs.
// Pure (no database), so the grader, the pages and the tests share it.
//
// The score is the full solve (end to end), as in v1: a cube is worth
// scramble length / moves, where the scramble length is the 20 x (N - 2) random
// moves that mixed it (undoing them solves it, so 1 is that many moves; beating
// it is worth more than 1), and 0 when a program fails, runs over its CPU limit
// (5 x our reference's CPU time, 5 to 60 s) or the three together run over the
// cap (2 x our reference's moves). The bench is 100 x the size-weighted mean
// (weight N). Since 15 Oct 2026; before, it was 100 x the mean of the three
// stages and end to end, each against par.
//
// The stages are a breakdown, not in the score: each case is worth
// 0.5 + 0.5 x min(1, par / moves), where par is the fewest moves any graded
// program has used on that cube (never more than our reference's;
// cube_arena.code2_pars, fixed for the case set).

import { MoveError, applyMoves, moveCost, parseMoves, stateFromString, stateToString } from '../cube/engine';
import { type Stage, STAGES, stageDone } from '../cube/stages';

export type Bench2 = 'v2' | 'v2-mini';
export const BENCHES2: Bench2[] = ['v2', 'v2-mini'];
export type Part = Stage | 'e2e';
export const PARTS: Part[] = [...STAGES, 'e2e'];

export const CODE2 = {
  /** Where the hidden and practice cases come from: one set, the mini bench uses its small sizes. */
  caseVersion: 'v2',
  casesPerSize: 10,
  /** In each kit's practice.json; check.py runs the first 10 per size (the hidden count) and holds out the rest. */
  practicePerSize: 30,
  buildSecs: 600,
  cpus: 1,
  memoryMb: 2048,
  /** Each stage folder, gzipped. Bigger tables can be built by build.py. */
  bundleMaxBytes: 3_000_000,
  /** Kept of each answer (a longer one is over the cap anyway). */
  outputMaxBytes: 512 * 1024,
  capFactor: 2,
  /** Stage breakdown: a solved case is worth at least this; the rest goes by moves against par. */
  solvedFloor: 0.5,
  cpuFactor: 5,
  cpuMinMs: 5_000,
  cpuMaxMs: 60_000,
  /** A stage ended with more than this share of its time left gets the "time left" message, up to nudgeMax times. */
  nudgeShare: 0.1,
  nudgeMax: 5,
  benches: {
    v2: { sizes: [4, 5, 6, 7, 8, 9, 10], minutes: { centres: 90, edges: 90, finish: 60 } },
    'v2-mini': { sizes: [4, 5, 6], minutes: { centres: 30, edges: 30, finish: 20 } },
  } satisfies Record<Bench2, { sizes: number[]; minutes: Record<Stage, number> }>,
} as const;

export const isBench2 = (v: unknown): v is Bench2 => typeof v === 'string' && (BENCHES2 as string[]).includes(v);
export const isStage = (v: unknown): v is Stage => typeof v === 'string' && (STAGES as string[]).includes(v);
export const scrambleLength = (n: number) => 20 * (n - 2);
export const moveCap = (refMoves: number) => CODE2.capFactor * refMoves;
export const cpuLimitMs = (refCpuMs: number) => Math.min(CODE2.cpuMaxMs, Math.max(CODE2.cpuMinMs, Math.round(CODE2.cpuFactor * refCpuMs)));

/** The early-stop message, word for word the same for every model. */
export const nudgeText = (minutesLeft: number, stage: Stage) =>
  `You have ${minutesLeft} min left in this stage. Keep working on ${stage}/ until the time is up; it is submitted then.`;

/** The text of the time-left message the runner sends, and the share of time left that triggers it. */
export function limits2(bench: Bench2) {
  const b = CODE2.benches[bench];
  return {
    bench,
    sizes: b.sizes,
    minutes: b.minutes,
    casesPerSize: CODE2.casesPerSize,
    buildSecs: CODE2.buildSecs,
    cpus: CODE2.cpus,
    memoryMb: CODE2.memoryMb,
    bundleMaxBytes: CODE2.bundleMaxBytes,
    outputMaxBytes: CODE2.outputMaxBytes,
    capFactor: CODE2.capFactor,
    solvedFloor: CODE2.solvedFloor,
    cpuFactor: CODE2.cpuFactor,
    cpuMinMs: CODE2.cpuMinMs,
    cpuMaxMs: CODE2.cpuMaxMs,
    nudgeShare: CODE2.nudgeShare,
    nudgeMax: CODE2.nudgeMax,
  };
}

export type Case2Status = 'solved' | 'unsolved' | 'over_cap' | 'illegal' | 'timeout' | 'crash';

export interface Run2 {
  stdout: string;
  exit_code: number | null;
  /** 'cpu' or 'wall' when it was stopped for time. */
  timed_out: string | boolean | null;
  cpu_ms: number;
  truncated?: boolean;
}

export interface Outcome2 {
  status: Case2Status;
  moves: number | null;
  cpu_ms: number | null;
  value: number;
  detail: string | null;
}

/** A stage case's value (the breakdown): at least solvedFloor once solved, the rest by moves against par. */
export const caseValue = (status: Case2Status, moves: number | null, parMoves: number) =>
  status === 'solved' ? CODE2.solvedFloor + (1 - CODE2.solvedFloor) * Math.min(1, parMoves / Math.max(1, moves ?? 0)) : 0;

/** A full solve's value, what the score counts: scramble length / moves, no upper limit. */
export const solveValue = (status: Case2Status, moves: number | null, n: number) =>
  status === 'solved' ? scrambleLength(n) / Math.max(1, moves ?? 0) : 0;

/** A case's value: the full solve against the scramble length, a stage against its par. */
export const partValue = (part: Part, status: Case2Status, moves: number | null, n: number, parMoves: number) =>
  part === 'e2e' ? solveValue(status, moves, n) : caseValue(status, moves, parMoves);

type Played = { ok: true; end: Uint8Array; count: number } | { ok: false; status: Case2Status; detail: string };

/** Runs a program's answer on a state: its moves and where they leave the cube, or why it doesn't count. */
export function play(n: number, state: string, run: Run2, cpuLimit: number): Played {
  if (run.timed_out || run.cpu_ms > cpuLimit) return { ok: false, status: 'timeout', detail: `over the CPU limit of ${(cpuLimit / 1000).toFixed(1)} s` };
  if (run.exit_code !== 0) return { ok: false, status: 'crash', detail: `exit code ${run.exit_code ?? 'none (killed)'}` };
  if (run.truncated) return { ok: false, status: 'over_cap', detail: 'the answer was longer than the grader keeps' };
  let moves;
  try {
    moves = parseMoves(run.stdout.trim(), n);
  } catch (e) {
    if (e instanceof MoveError) return { ok: false, status: 'illegal', detail: e.message.slice(0, 200) };
    throw e;
  }
  return { ok: true, end: applyMoves(stateFromString(state, n), n, moves), count: moveCost(moves) };
}

/** Grades one stage case: the program's answer for `input`; our reference's moves and CPU time set the limits, par the value. */
export function gradeStage(stage: Stage, n: number, input: string, run: Run2, refMoves: number, refCpuMs: number, parMoves = refMoves): Outcome2 {
  const p = play(n, input, run, cpuLimitMs(refCpuMs));
  const cpu = Math.round(run.cpu_ms);
  if (!p.ok) return { status: p.status, moves: null, cpu_ms: cpu, value: 0, detail: p.detail };
  if (!stageDone(stage, p.end, n)) return { status: 'unsolved', moves: p.count, cpu_ms: cpu, value: 0, detail: `the ${stage} goal isn't met after these moves` };
  if (p.count > moveCap(refMoves)) return { status: 'over_cap', moves: p.count, cpu_ms: cpu, value: 0, detail: `${p.count} moves, over the cap of ${moveCap(refMoves)}` };
  return { status: 'solved', moves: p.count, cpu_ms: cpu, value: caseValue('solved', p.count, parMoves), detail: null };
}

/**
 * Grades an end-to-end case: the model's centres, edges and finish programs
 * one after another, each on what the one before left. `runs` holds the runs
 * that happened: the grader stops at the first program that fails or leaves
 * its stage's goal unmet (the next program's spec promises it that goal). The
 * cap is twice our reference's three stages together; each program has its
 * own stage's CPU limit. Worth scramble length / moves. `states` are the
 * inputs the programs got, in order.
 */
export function gradeChain(n: number, scrambled: string, runs: Run2[], refMoves: number[], refCpuMs: number[]): Outcome2 & { states: string[] } {
  let state = scrambled;
  let total = 0;
  let cpu = 0;
  const states: string[] = [];
  const ref = refMoves.reduce((a, b) => a + b, 0);
  for (let i = 0; i < STAGES.length; i++) {
    const run = runs[i];
    if (!run) return { status: 'crash', moves: null, cpu_ms: cpu, value: 0, detail: `${STAGES[i]} did not run`, states };
    states.push(state);
    cpu += Math.round(run.cpu_ms);
    const p = play(n, state, run, cpuLimitMs(refCpuMs[i]));
    if (!p.ok) return { status: p.status, moves: null, cpu_ms: cpu, value: 0, detail: `${STAGES[i]}: ${p.detail}`, states };
    total += p.count;
    if (!stageDone(STAGES[i], p.end, n)) return { status: 'unsolved', moves: total, cpu_ms: cpu, value: 0, detail: `${STAGES[i]}: the goal isn't met after its moves`, states };
    state = stateToString(p.end);
  }
  if (total > moveCap(ref)) return { status: 'over_cap', moves: total, cpu_ms: cpu, value: 0, detail: `${total} moves, over the cap of ${moveCap(ref)}`, states };
  return { status: 'solved', moves: total, cpu_ms: cpu, value: solveValue('solved', total, n), detail: null, states };
}

export interface PartScore {
  score: number;
  solved: number;
  cases: number;
  /** Mean case value per size. */
  by_size: Record<string, number>;
}

/** A part's score: the mean case value per size, weighted by N. */
export function partScore(results: { size: number; status: Case2Status; value: number }[], sizes: readonly number[]): PartScore {
  const by: Record<string, number> = {};
  let num = 0;
  let den = 0;
  for (const n of sizes) {
    const rs = results.filter((r) => r.size === n);
    const mean = rs.length ? rs.reduce((a, r) => a + r.value, 0) / rs.length : 0;
    by[n] = mean;
    num += n * mean;
    den += n;
  }
  return { score: den ? num / den : 0, solved: results.filter((r) => r.status === 'solved').length, cases: results.length, by_size: by };
}

/** 100 x the full solve's score; the stages are a breakdown. */
export const benchScore = (parts: Partial<Record<Part, PartScore>>) => 100 * (parts.e2e?.score ?? 0);
