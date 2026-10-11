// Suites: fixed sets of tests played one after another and graded together
// into one score out of 100. Model only: the index measures the model, not
// its tools. Every model gets the same cubes (seeded per suite version).
// Nothing is timed against the model: a test ends on its own terms (lives,
// the top level, a solve or a miss). Moves, cost and time only break ties.
//
// Changing the tests or the grading means a new version: scores only compare
// within one version.

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
  tests: { test: string; size: Size; challenge: Challenge; mode: Mode; score: number | null; played: number; cubes: number }[];
}

/**
 * Each test scores the mean of its cubes; the suite scores the mean of its
 * tests. Once a suite is over, tests never played count as 0.
 */
export function gradeSuite(def: SuiteDef, runsBySlot: Map<number, GradedRun>, finished: boolean): SuiteGrade {
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
    };
  });
  const all = tests.every((t) => t.score !== null);
  return { score: all ? mean(tests.map((t) => t.score as number)) : null, tests };
}

/** Told to players at the start of every suite test. */
export const SUITE_SCORING =
  'Suite scoring: each test scores 0-100. Ladder: the share of the ladder you climb; full scramble: whether you solve it. The suite score is the average of its tests. ' +
  'Equal scores rank by the fewest moves (failed attempts included), then the lowest cost, then the least time. There is no time limit: take as long as you need.';
