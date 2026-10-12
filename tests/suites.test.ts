import { describe, expect, it } from 'vitest';
import { fullScramble } from '../lib/cube/random-state';
import { levelScramble, rng } from '../lib/cube/scramble';
import { stateToString } from '../lib/cube/engine';
import { suiteOrder } from '../lib/arena/ranking';
import { type GradedRun, SUITES, gradeSuite, ladderScore, scrambleScore, suiteSeed, suiteTests, testWeights } from '../lib/arena/suites';

const ladder = (size: 2 | 3, best: number, moves: number[], extra: GradedRun['attempts'] = []): GradedRun => ({
  size,
  challenge: 'ladder',
  best_level: best,
  attempts: [...moves.map((m, i) => ({ level: i + 1, status: 'solved', move_count: m })), ...extra],
});

describe('suites', () => {
  it('fast is three ladders; thorough covers every model-only test; nothing is timed', () => {
    expect(SUITES.fast.slots).toHaveLength(3);
    expect(SUITES.fast.slots.every((s) => s.challenge === 'ladder')).toBe(true);
    expect(suiteTests(SUITES.thorough)).toHaveLength(16);
    expect(SUITES.thorough.slots).toHaveLength(24);
    expect(SUITES.thorough.slots.some((s) => 'minutes' in s)).toBe(false);
  });

  it('gives every model the same cubes, and a fresh cube on a retry', () => {
    const a = suiteSeed('fast', 'v1', 1, 4, 0);
    expect(suiteSeed('fast', 'v1', 1, 4, 0)).toBe(a);
    expect(suiteSeed('fast', 'v1', 1, 4, 1)).not.toBe(a);
    expect(suiteSeed('fast', 'v2', 1, 4, 0)).not.toBe(a);
    const s1 = stateToString(levelScramble(3, 5, rng(a)).state);
    expect(stateToString(levelScramble(3, 5, rng(a)).state)).toBe(s1);
    const f1 = stateToString(fullScramble(3, rng(a)).state);
    expect(stateToString(fullScramble(3, rng(a)).state)).toBe(f1);
    expect(stateToString(fullScramble(3, rng(a + 1)).state)).not.toBe(f1);
  });

  it('grades ladders by reach alone; moves only break ties', () => {
    // The Opus 5.5 run: levels 1-7 in 1, 6, 3, 4, 9, 52, 61 moves.
    expect(ladderScore(ladder(3, 7, [1, 6, 3, 4, 9, 52, 61]))).toBeCloseTo(35, 5);
    expect(ladderScore(ladder(3, 7, [1, 2, 3, 4, 5, 6, 7]))).toBeCloseTo(35, 5);
    expect(ladderScore(ladder(3, 0, [], [{ level: 1, status: 'failed', move_count: 3 }]))).toBe(0);
    expect(ladderScore(ladder(2, 11, Array.from({ length: 11 }, (_, i) => i + 1)))).toBe(100);
  });

  it('grades full scrambles by the solve alone', () => {
    const run = (status: string, moves: number): GradedRun => ({ size: 3, challenge: 'scramble', best_level: 0, attempts: [{ level: null, status, move_count: moves }] });
    expect(scrambleScore(run('solved', 20))).toBe(100);
    expect(scrambleScore(run('solved', 40))).toBe(100);
    expect(scrambleScore(run('failed', 20))).toBe(0);
    expect(scrambleScore(run('stopped', 5))).toBe(0);
  });

  it('ranks by score, then moves, then cost (unknown last), then time', () => {
    const e = (score: number | null, moves: number, cost_usd: number | null, secs: number) => ({ score, moves, cost_usd, secs });
    const higher = e(40, 900, 50, 99999);
    const fewerMoves = e(35, 30, 9, 9000);
    const cheaper = e(35, 40, 1, 9000);
    const dearer = e(35, 40, 2, 10);
    const unknownCost = e(35, 40, null, 1);
    const faster = e(35, 40, 2, 5);
    const ranked = [unknownCost, dearer, faster, cheaper, fewerMoves, higher].sort(suiteOrder);
    expect(ranked).toEqual([higher, fewerMoves, cheaper, faster, dearer, unknownCost]);
    // A slow, stronger model beats a fast, weaker one.
    expect([e(20, 10, 0.1, 60), e(30, 50, 9, 20000)].sort(suiteOrder)[0].score).toBe(30);
    // Averages of equal results tie on score and fall through to moves.
    expect(suiteOrder(e(100 / 3, 10, null, 1), e((100 + 0 + 0) / 3 + 1e-12, 9, null, 1))).toBeGreaterThan(0);
  });

  it('averages cubes into tests and weighs tests into the suite; unplayed tests count 0 once it is over', () => {
    const runs = new Map<number, GradedRun>([[0, ladder(2, 11, Array.from({ length: 11 }, (_, i) => i + 1))]]);
    expect(gradeSuite(SUITES.fast, runs, false).score).toBeNull();
    const done = gradeSuite(SUITES.fast, runs, true);
    expect(done.score).toBeCloseTo(11, 5);
    expect(done.tests.map((t) => t.score)).toEqual([100, 0, 0]);
    expect(done.tests.map((t) => t.weight)).toEqual([0.11, 0.445, 0.445]);
    // 2×2 cleared, 3×3 interactive level 4 of 20, one-shot level 14 of 20.
    runs.set(1, ladder(3, 4, [1, 2, 3, 4]));
    runs.set(2, ladder(3, 14, Array.from({ length: 14 }, (_, i) => i + 1)));
    expect(gradeSuite(SUITES.fast, runs, true).score).toBeCloseTo(11 + 0.445 * 20 + 0.445 * 70, 5);
  });

  it('weighs Thorough tests equally', () => {
    const w = [...testWeights(SUITES.thorough).values()];
    expect(new Set(w.map((x) => x.toFixed(9))).size).toBe(1);
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
  });
});
