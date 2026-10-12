// The coding benchmark's rules: a model writes its own 5x5 solver, and the
// frozen code solves cubes it has never seen. Pure (no database), so the
// grader, the pages and the tests share it.
//
// Every cube starts solved and gets 60 random moves, the 5x5 full scramble.
// Undoing that scramble takes 60 moves, the fixed reference that scores 100:
// a case scores 100 × 60 ÷ the solver's moves (more than 100 is possible),
// and a cube not solved scores 0. Moves are counted as on the rest of Cube
// Arena: any layer turn, half turns and wide turns included, is 1; whole-cube
// rotations are free.

import { createHash, createHmac } from 'node:crypto';
import { MoveError, applyMoves, isSolved, moveCost, parseMoves, solvedState, stateFromString, stateToString } from '../cube/engine';
import { FULL_SCRAMBLE_LENGTH, randomWalk, rng } from '../cube/scramble';

export const CODE = {
  version: 'v1',
  size: 5,
  /** Moves in each scramble, and the reference solution length that scores 100. */
  reference: FULL_SCRAMBLE_LENGTH[5],
  /** Hidden cubes each solver is graded on. */
  cases: 50,
  /** Public cubes to practise on, with their scrambles. */
  practice: 20,
  /** Wall-clock hours the model may spend writing its solver. */
  devHours: 4,
  /** Grading limits, the same for everyone (one machine, one image). */
  buildSecs: 600,
  solveSecs: 60,
  cpus: 1,
  memoryMb: 2048,
  /** The solver/ folder, gzipped. Bigger tables can be built by build.py. */
  bundleMaxBytes: 3_000_000,
  /** Kept of each answer. */
  outputMaxBytes: 65_536,
} as const;

export type CaseStatus = 'solved' | 'unsolved' | 'illegal' | 'timeout' | 'crash';

export interface CodeCase {
  n: number;
  scramble: string;
  state: string;
}

function hiddenSeed(i: number): number {
  // Its own secret, so nothing else rotating changes the test set. Never a
  // guessable fallback in production: then there are no hidden cubes at all.
  const secret = process.env.CUBE_CODE_SECRET || (process.env.NODE_ENV === 'production' ? null : 'dev');
  if (!secret) throw new Error('CUBE_CODE_SECRET is not set');
  return createHmac('sha256', secret).update(`code:${CODE.version}:hidden:${i}`).digest().readUInt32BE(0);
}

const practiceSeed = (i: number) => createHash('sha256').update(`code:${CODE.version}:practice:${i}`).digest().readUInt32BE(0);

function makeCase(n: number, seed: number): CodeCase {
  const moves = randomWalk(CODE.size, CODE.reference, rng(seed));
  const state = applyMoves(solvedState(CODE.size), CODE.size, moves);
  return { n, scramble: moves.map((m) => m.token).join(' '), state: stateToString(state) };
}

/** The public practice cubes, scrambles included. */
export const practiceCases = (): CodeCase[] => Array.from({ length: CODE.practice }, (_, i) => makeCase(i, practiceSeed(i)));

/** The hidden cubes. Server and grader only: they come from the server's secret, and their scrambles never leave it. */
export const hiddenCases = (): CodeCase[] => Array.from({ length: CODE.cases }, (_, i) => makeCase(i, hiddenSeed(i)));

export interface CaseRun {
  /** What the solver printed. */
  stdout: string;
  exit_code: number | null;
  timed_out: boolean;
  ms: number;
}

export interface CaseOutcome {
  status: CaseStatus;
  moves: number | null;
  detail: string | null;
}

/** Checks one answer against the cube it was for. */
export function gradeCase(state: string, run: CaseRun): CaseOutcome {
  if (run.timed_out) return { status: 'timeout', moves: null, detail: `over ${CODE.solveSecs} s` };
  if (run.exit_code !== 0) return { status: 'crash', moves: null, detail: `exit code ${run.exit_code ?? 'none (killed)'}` };
  let moves;
  try {
    moves = parseMoves(run.stdout.trim(), CODE.size);
  } catch (e) {
    if (e instanceof MoveError) return { status: 'illegal', moves: null, detail: e.message.slice(0, 200) };
    throw e;
  }
  const end = applyMoves(stateFromString(state, CODE.size), CODE.size, moves);
  const count = moveCost(moves);
  return isSolved(end, CODE.size) ? { status: 'solved', moves: count, detail: null } : { status: 'unsolved', moves: count, detail: 'the cube is not solved after these moves' };
}

/** 100 × reference ÷ moves for a solved cube, 0 otherwise. */
export const caseScore = (o: { status: CaseStatus; moves: number | null }) =>
  o.status === 'solved' ? (100 * CODE.reference) / Math.max(1, o.moves ?? 0) : 0;

export interface CodeSummary {
  cases: number;
  solved: number;
  /** Mean case score over every case, failures counting 0. */
  score: number;
  /** Over solved cubes only. */
  mean_moves: number | null;
  mean_ms: number | null;
}

export function summarize(outcomes: (CaseOutcome & { ms: number | null })[]): CodeSummary {
  const solved = outcomes.filter((o) => o.status === 'solved');
  const ms = outcomes.map((o) => o.ms).filter((v): v is number => v !== null);
  return {
    cases: outcomes.length,
    solved: solved.length,
    score: outcomes.length ? outcomes.reduce((a, o) => a + caseScore(o), 0) / outcomes.length : 0,
    mean_moves: solved.length ? solved.reduce((a, o) => a + (o.moves ?? 0), 0) / solved.length : null,
    mean_ms: ms.length ? ms.reduce((a, b) => a + b, 0) / ms.length : null,
  };
}

/** Board order: more cubes solved first, then the higher score. */
export const codeRank = <T extends { solved: number | null; cases: number | null; score: number | null }>(a: T, b: T) =>
  (b.solved ?? 0) / (b.cases || 1) - (a.solved ?? 0) / (a.cases || 1) || (b.score ?? 0) - (a.score ?? 0);
