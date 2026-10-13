import { describe, expect, it } from 'vitest';
import { averageByLabel } from '../lib/arena/aggregate';
import type { SuiteEntry } from '../lib/arena/index-data';

const entry = (id: string, score: number, gauntlet: SuiteEntry['gauntlet']) =>
  ({
    id,
    label: 'GPT-6-Astra max',
    score,
    gauntlet,
    tests: [],
    solved: 0,
    moves: 0,
    secs: 0,
    out_of_output: 0,
    input_tokens: null,
    output_tokens: null,
    cost_usd: null,
    run_by: [],
    n: 1,
  }) as unknown as SuiteEntry;

describe('averageByLabel', () => {
  it('leaves a suite waiting on its Gauntlet out while another of its label is final', () => {
    const [row] = averageByLabel([entry('adam', 80, 'pending'), entry('rohit', 81, 'done')]);
    expect(row.id).toBe('rohit');
    expect(row.score).toBe(81);
    expect(row.gauntlet).toBe('done');
    expect(row.n).toBe(1);
  });

  it('averages the waiting suites when none of the label is final', () => {
    const [row] = averageByLabel([entry('a', 80, 'pending'), entry('b', 80, 'playing')]);
    expect(row.n).toBe(2);
    expect(row.gauntlet).toBe('playing');
  });

  it('averages final suites as before', () => {
    const [row] = averageByLabel([entry('a', 81, 'done'), entry('b', 60, 'locked'), entry('c', 80, 'pending')]);
    expect(row.n).toBe(2);
    expect(row.score).toBe(70.5);
  });
});
