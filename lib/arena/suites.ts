// Suites: fixed sets of tests played one after another and graded together
// into one score out of 100. Model only: the index measures the model, not
// its tools. Every model gets the same cubes (seeded per suite version).
// Nothing is timed against the model: a test ends on its own terms (lives,
// the top level, a solve or a miss). Moves, cost and time only break ties.
//
// Changing the tests means a new version: scores only compare within one
// version. Grading is worked out from the moves each time it is shown, so a
// change of weights regrades every result of that version alike.

import { createHmac } from 'node:crypto';
import { type Challenge, LADDER_MAX_LEVEL, type Mode, SIZES, type Size } from './rules';

export type SuiteKind = 'fast' | 'thorough';
export const SUITE_KINDS: SuiteKind[] = ['fast', 'thorough'];

export interface SuiteSlot {
  /** Which test this slot belongs to; a test can have several cubes (slots). */
  test: string;
  size: Size;
  challenge: Challenge;
  mode: Mode;
}

export interface SuiteDef {
  kind: SuiteKind;
  version: string;
  name: string;
  blurb: string;
  slots: SuiteSlot[];
  /** Each test's share of the suite score, by test id; tests not listed weigh equally. */
  weights?: Record<string, number>;
}

const testId = (size: Size, challenge: Challenge, mode: Mode) => `${size}x${size}-${challenge}-${mode}`;
const slot = (size: Size, challenge: Challenge, mode: Mode): SuiteSlot => ({ test: testId(size, challenge, mode), size, challenge, mode });

export const SUITES: Record<SuiteKind, SuiteDef> = {
  fast: {
    kind: 'fast',
    version: 'v2',
    name: 'Fast',
    blurb: 'Three ladders: 2×2 and 3×3 interactive, and 3×3 one-shot. No time limit; each ends at the top level or on the third miss.',
    slots: [slot(2, 'ladder', 'interactive'), slot(3, 'ladder', 'interactive'), slot(3, 'ladder', 'one_shot')],
    // The 2×2 sorts weaker models but every strong one clears it, so it counts for less.
    weights: { '2x2-ladder-interactive': 11, '3x3-ladder-interactive': 44.5, '3x3-ladder-one_shot': 44.5 },
  },
  thorough: {
    kind: 'thorough',
    version: 'v2',
    name: 'Thorough',
    blurb:
      'Every model-only test: 2×2 to 5×5, ladder and full scramble, interactive and one-shot, with two cubes for each full scramble. No time limit, so it can take many hours.',
    slots: SIZES.flatMap((s) => [
      slot(s, 'ladder', 'interactive'),
      slot(s, 'ladder', 'one_shot'),
      slot(s, 'scramble', 'interactive'),
      slot(s, 'scramble', 'interactive'),
      slot(s, 'scramble', 'one_shot'),
      slot(s, 'scramble', 'one_shot'),
    ]),
  },
};

/** The distinct tests of a suite, in order, with how many cubes (slots) each has. */
export function suiteTests(def: SuiteDef): { test: string; size: Size; challenge: Challenge; mode: Mode; slots: number[] }[] {
  const out: { test: string; size: Size; challenge: Challenge; mode: Mode; slots: number[] }[] = [];
  def.slots.forEach((s, i) => {
    const t = out.find((x) => x.test === s.test);
    if (t) t.slots.push(i);
    else out.push({ test: s.test, size: s.size, challenge: s.challenge, mode: s.mode, slots: [i] });
  });
  return out;
}

/**
 * The seed for one cube of a suite: the same for every model, unknowable
 * without the server's secret. `attempt` counts tries at that level, so a
 * retry after a lost life is a new cube, the same new cube for everyone.
 */
export function suiteSeed(kind: SuiteKind, version: string, slotIndex: number, level: number | null, attempt: number): number {
  const secret = process.env.CUBE_SUITE_SECRET || process.env.CUBE_IP_SALT || 'dev';
  return createHmac('sha256', secret).update(`suite:${kind}:${version}:${slotIndex}:${level ?? 'full'}:${attempt}`).digest().readUInt32BE(0);
}

// ---------------------------------------------------------------------------
// Grading

export interface GradedAttempt {
  level: number | null;
  status: string;
  move_count: number;
}

export interface GradedRun {
  size: Size;
  challenge: Challenge;
  best_level: number;
  attempts: GradedAttempt[];
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Ladder: the share of the ladder climbed. */
export function ladderScore(run: GradedRun): number {
  const solved = run.attempts.some((a) => a.status === 'solved' && a.level);
  return solved && run.best_level > 0 ? (100 * run.best_level) / LADDER_MAX_LEVEL[run.size] : 0;
}

/** Full scramble: 100 for a solve, 0 for a miss. */
export function scrambleScore(run: GradedRun): number {
  return run.attempts.some((x) => x.status === 'solved') ? 100 : 0;
}

export const runScore = (run: GradedRun) => (run.challenge === 'ladder' ? ladderScore(run) : scrambleScore(run));

export interface SuiteGrade {
  /** 0-100, or null while a test has not been played yet (active suites). */
  score: number | null;
  tests: { test: string; size: Size; challenge: Challenge; mode: Mode; score: number | null; played: number; cubes: number; weight: number }[];
}

/** Each test's share of the suite score, as fractions that add up to 1. */
export function testWeights(def: SuiteDef): Map<string, number> {
  const tests = suiteTests(def);
  const raw = tests.map((t) => def.weights?.[t.test] ?? 1);
  const total = raw.reduce((a, b) => a + b, 0);
  return new Map(tests.map((t, i) => [t.test, raw[i] / total]));
}

/**
 * Each test scores the mean of its cubes; the suite scores the weighted mean
 * of its tests (equal unless the suite sets weights). Once a suite is over, tests never played count as 0.
 */
export function gradeSuite(def: SuiteDef, runsBySlot: Map<number, GradedRun>, finished: boolean): SuiteGrade {
  const weights = testWeights(def);
  const tests = suiteTests(def).map((t) => {
    const played = t.slots.filter((i) => runsBySlot.has(i));
    const complete = played.length === t.slots.length;
    const scores = t.slots.map((i) => (runsBySlot.has(i) ? runScore(runsBySlot.get(i) as GradedRun) : 0));
    return {
      test: t.test,
      size: t.size,
      challenge: t.challenge,
      mode: t.mode,
      score: complete || finished ? mean(scores) : null,
      played: played.length,
      cubes: t.slots.length,
      weight: weights.get(t.test) as number,
    };
  });
  const all = tests.every((t) => t.score !== null);
  return { score: all ? tests.reduce((a, t) => a + (t.score as number) * t.weight, 0) : null, tests };
}

/** Told to players at the start of every suite test. */
export const SUITE_SCORING =
  'Suite scoring: each test scores 0-100. Ladder: the share of the ladder you climb; full scramble: whether you solve it. The suite score is the average of its tests (Fast weighs the 2×2 ladder 11%, each 3×3 ladder 44.5%). ' +
  'Equal scores rank by the fewest moves (failed attempts included), then the lowest cost, then the least time. There is no time limit: take as long as you need.';
