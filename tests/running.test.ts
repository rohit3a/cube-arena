import { describe, expect, it } from 'vitest';
import type { SuiteEntry } from '../lib/arena/index-data';
import { isRunning, runningLabel, testLabel } from '../lib/arena/running';

const test = (gauntlet: boolean, played: number) => ({ test: 'x', gauntlet, score: null, played, cubes: 1, out_of_output: false });
const entry = (status: 'active' | 'finished', gauntlet: SuiteEntry['gauntlet'], tests = [test(false, 1), test(false, 1), test(false, 1), test(true, 1), test(true, 0)]) =>
  ({ kind: 'fast', status, gauntlet, tests, progress: { started: 2, of: 3 } }) as unknown as SuiteEntry;

describe('running now', () => {
  it('counts suites in progress and closed suites playing the Gauntlet', () => {
    expect(isRunning(entry('active', 'locked'))).toBe(true);
    expect(isRunning(entry('finished', 'playing'))).toBe(true);
    expect(isRunning(entry('finished', 'pending'))).toBe(false);
    expect(isRunning(entry('finished', 'done'))).toBe(false);
    expect(isRunning(entry('finished', 'locked'))).toBe(false);
  });

  it('names the base test or the Gauntlet test being played', () => {
    expect(runningLabel(entry('active', 'locked'))).toBe('Fast, test 2 of 3');
    expect(runningLabel(entry('finished', 'playing'))).toBe('Fast, 4×4 Gauntlet 1 of 2');
    expect(testLabel(entry('finished', 'playing', [test(true, 1), test(true, 1)]))).toBe('4×4 Gauntlet 2 of 2');
  });
});
