// Suites: fixed sets of tests played one after another and graded together
// into one score out of 100. Model only: the index measures the model, not
// its tools. Every model gets the same cubes (seeded per suite version).
// Nothing is timed against the model: a test ends on its own terms (lives,
// the top level, a solve or a miss). Moves, cost and time only break ties.
//
// Changing the tests means a new version: scores only compare within one
// version. Grading is worked out from the moves each time it is shown, so a
// change of weights regrades every result of that version alike.
//
// Fast ends with the Gauntlet: two 4×4 ladders that only a model with 100 on
// every other test gets to play. A model that doesn't qualify tops out at 80.

import { createHmac } from 'node:crypto';
import { type Challenge, GAUNTLET, type Mode, SIZES, type Size, topLevel } from './rules';

export { GAUNTLET };

export type SuiteKind = 'fast' | 'thorough';
export const SUITE_KINDS: SuiteKind[] = ['fast', 'thorough'];

export interface SuiteSlot {
  /** Which test this slot belongs to; a test can have several cubes (slots). */
  test: string;
  size: Size;
  challenge: Challenge;
  mode: Mode;
  /** Played only after a perfect score on every test that isn't (Fast's 4×4 Gauntlet). */
  gauntlet?: boolean;
  /** Ladders: how many levels, when not the size's usual top. */
  levels?: number;
  /** Ladders: how many moves from solved level 1 is, when not 1. */
  startDepth?: number;
  /** Seed its cubes as this suite version did, so a test carried over from it keeps the same cubes. */
  seedVersion?: string;
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

const gauntlet = (mode: Mode): SuiteSlot => ({
  test: `${GAUNTLET.size}x${GAUNTLET.size}-gauntlet-${mode}`,
  size: GAUNTLET.size,
  challenge: 'ladder',
  mode,
  gauntlet: true,
  levels: GAUNTLET.levels,
  startDepth: GAUNTLET.startDepth,
});
/** Fast v3 keeps v2's three tests and their cubes. */
const fromV2 = (s: SuiteSlot): SuiteSlot => ({ ...s, seedVersion: 'v2' });

export const SUITES: Record<SuiteKind, SuiteDef> = {
  fast: {
    kind: 'fast',
    version: 'v3',
    name: 'Fast',
    blurb:
      'Three ladders: 2×2 and 3×3 interactive, and 3×3 one-shot. A perfect 100 on all three unlocks the 4×4 Gauntlet, two 4×4 ladders that start 7 moves from solved. No time limit; each ends at the top level or on the third miss.',
    slots: [
      fromV2(slot(2, 'ladder', 'interactive')),
      fromV2(slot(3, 'ladder', 'interactive')),
      fromV2(slot(3, 'ladder', 'one_shot')),
      gauntlet('interactive'),
      gauntlet('one_shot'),
    ],
    // The 2×2 sorts weaker models but every strong one clears it, so it counts for less. The Gauntlet sorts the
    // models that clear everything else; without it, 80 is the most there is.
    weights: {
      '2x2-ladder-interactive': 20,
      '3x3-ladder-interactive': 30,
      '3x3-ladder-one_shot': 30,
      '4x4-gauntlet-interactive': 10,
      '4x4-gauntlet-one_shot': 10,
    },
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

export interface SuiteTest {
  test: string;
  size: Size;
  challenge: Challenge;
  mode: Mode;
  slots: number[];
  gauntlet: boolean;
  /** Ladders: the top level, and how many moves from solved level 1 is. */
  levels: number;
  startDepth: number;
}

/** The distinct tests of a suite, in order, with how many cubes (slots) each has. */
export function suiteTests(def: SuiteDef): SuiteTest[] {
  const out: SuiteTest[] = [];
  def.slots.forEach((s, i) => {
    const t = out.find((x) => x.test === s.test);
    if (t) t.slots.push(i);
    else
      out.push({
        test: s.test,
        size: s.size,
        challenge: s.challenge,
        mode: s.mode,
        slots: [i],
        gauntlet: !!s.gauntlet,
        levels: topLevel({ size: s.size, top_level: s.levels }),
        startDepth: s.startDepth ?? 1,
      });
  });
  return out;
}

/** Readable test names: "3×3 ladder, one-shot", "4×4 Gauntlet, interactive". */
export function testName(t: { size: Size; challenge: Challenge; mode: Mode; gauntlet?: boolean }): { name: string; short: string } {
  const mode = t.mode === 'one_shot' ? 'one-shot' : 'interactive';
  const short = t.mode === 'one_shot' ? '1×' : 'int';
  if (t.gauntlet) return { name: `${t.size}×${t.size} ${GAUNTLET.name}, ${mode}`, short: `${t.size}×${t.size} G ${short}` };
  const what = t.challenge === 'ladder' ? 'ladder' : 'scramble';
  return { name: `${t.size}×${t.size} ${what}, ${mode}`, short: `${t.size}×${t.size} ${what === 'ladder' ? 'L' : 'S'} ${short}` };
}

/** The version whose seeds a slot's cubes use: its own, or the one it was carried over from. */
export function seedVersionOf(kind: SuiteKind, version: string, slotIndex: number): string {
  const def = SUITES[kind];
  return (def.version === version && def.slots[slotIndex]?.seedVersion) || version;
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
  /** The run's own top level (the Gauntlet's 20), when not the size's usual one. */
  top_level?: number | null;
  /** 'active' while it's being played; finished when left out. */
  status?: string;
  attempts: GradedAttempt[];
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Ladder: the share of the ladder climbed. */
export function ladderScore(run: GradedRun): number {
  const solved = run.attempts.some((a) => a.status === 'solved' && a.level);
  return solved && run.best_level > 0 ? Math.min(100, (100 * run.best_level) / topLevel(run)) : 0;
}

/** Full scramble: 100 for a solve, 0 for a miss. */
export function scrambleScore(run: GradedRun): number {
  return run.attempts.some((x) => x.status === 'solved') ? 100 : 0;
}

export const runScore = (run: GradedRun) => (run.challenge === 'ladder' ? ladderScore(run) : scrambleScore(run));

/**
 * Where a suite stands with its Gauntlet: locked until every other test is
 * over with a perfect score (and for good after anything less), pending once
 * unlocked and not yet played, playing, then done.
 */
export type GauntletState = 'locked' | 'pending' | 'playing' | 'done';

export interface SuiteGrade {
  /** 0-100, or null while a test has not been played yet (active suites). */
  score: number | null;
  tests: {
    test: string;
    size: Size;
    challenge: Challenge;
    mode: Mode;
    gauntlet: boolean;
    score: number | null;
    played: number;
    cubes: number;
    weight: number;
  }[];
  /** Null for a suite without a Gauntlet (Thorough). */
  gauntlet: GauntletState | null;
}

const PERFECT = 100 - 1e-9;

/** Each test's share of the suite score, as fractions that add up to 1. */
export function testWeights(def: SuiteDef): Map<string, number> {
  const tests = suiteTests(def);
  const raw = tests.map((t) => def.weights?.[t.test] ?? 1);
  const total = raw.reduce((a, b) => a + b, 0);
  return new Map(tests.map((t, i) => [t.test, raw[i] / total]));
}

/**
 * Each test scores the mean of its cubes; the suite scores the weighted mean
 * of its tests (equal unless the suite sets weights). Once a suite is over,
 * tests never played count as 0, and so does a Gauntlet that is locked or
 * not played yet: its share is only there to be won.
 */
export function gradeSuite(def: SuiteDef, runsBySlot: Map<number, GradedRun>, finished: boolean): SuiteGrade {
  const weights = testWeights(def);
  const all = suiteTests(def);
  const over = (i: number) => runsBySlot.has(i) && (runsBySlot.get(i) as GradedRun).status !== 'active';
  const baseOver = all.filter((t) => !t.gauntlet).every((t) => t.slots.every(over));
  const tests = all.map((t) => {
    const played = t.slots.filter((i) => runsBySlot.has(i));
    const complete = played.length === t.slots.length;
    const scores = t.slots.map((i) => (runsBySlot.has(i) ? runScore(runsBySlot.get(i) as GradedRun) : 0));
    return {
      test: t.test,
      size: t.size,
      challenge: t.challenge,
      mode: t.mode,
      gauntlet: t.gauntlet,
      score: complete || finished || (t.gauntlet && baseOver) ? mean(scores) : null,
      played: played.length,
      cubes: t.slots.length,
      weight: weights.get(t.test) as number,
    };
  });
  let gauntlet: GauntletState | null = null;
  if (all.some((t) => t.gauntlet)) {
    const perfect = baseOver && tests.every((t) => t.gauntlet || (t.score ?? 0) >= PERFECT);
    const slots = all.filter((t) => t.gauntlet).flatMap((t) => t.slots);
    gauntlet = !perfect
      ? 'locked'
      : slots.every(over)
        ? 'done'
        : slots.some((i) => runsBySlot.get(i)?.status === 'active')
          ? 'playing'
          : 'pending';
  }
  const scored = tests.every((t) => t.score !== null);
  return { score: scored ? tests.reduce((a, t) => a + (t.score as number) * t.weight, 0) : null, tests, gauntlet };
}

/** The suite's Gauntlet slots still to play, in order: none unless it is unlocked. */
export function gauntletToPlay(def: SuiteDef, grade: SuiteGrade, played: Set<number>): number[] {
  if (grade.gauntlet !== 'pending' && grade.gauntlet !== 'playing') return [];
  return def.slots.flatMap((s, i) => (s.gauntlet && !played.has(i) ? [i] : []));
}

/** Told to players at the start of every suite test. */
export const SUITE_SCORING =
  'Suite scoring: each test scores 0-100. Ladder: the share of the ladder you climb; full scramble: whether you solve it. The suite score is the weighted average of its tests. ' +
  `Fast weighs the 2×2 ladder 20% and each 3×3 ladder 30%. A perfect 100 on all three unlocks the 4×4 ${GAUNTLET.name}: two 4×4 ladders of ${GAUNTLET.levels} levels, level 1 already ${GAUNTLET.startDepth} moves from solved, worth 10% each. Without it, 80 is the most a Fast suite scores. ` +
  'Equal scores rank by the fewest moves (failed attempts included), then the lowest cost, then the least time. There is no time limit: take as long as you need.';
