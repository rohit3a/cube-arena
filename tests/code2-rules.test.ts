import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyMoves, parseMoves, stateFromString, stateToString } from '../lib/cube/engine';
import { STAGES } from '../lib/cube/stages';
import { benchScore, caseValue, cpuLimitMs, gradeChain, gradeStage, moveCap, nudgeText, partScore } from '../lib/arena/code2-rules';

const chain: { n: number; scrambled: string; centres: string; edges: string; finish: string; counts: number[] }[] = JSON.parse(
  readFileSync(new URL('./fixtures/v2-chain.json', import.meta.url), 'utf8'),
);
const ok = (stdout: string, cpu_ms = 100) => ({ stdout, exit_code: 0, timed_out: null, cpu_ms });

/** The inputs of each stage along the reference chain. */
function inputs(c: (typeof chain)[number]) {
  const out = [c.scrambled];
  for (const st of STAGES.slice(0, 2)) out.push(stateToString(applyMoves(stateFromString(out.at(-1)!, c.n), c.n, parseMoves(c[st], c.n))));
  return out;
}

describe('coding v2 grading', () => {
  it('limits and values', () => {
    expect(moveCap(300)).toBe(600);
    expect(cpuLimitMs(10)).toBe(5000);
    expect(cpuLimitMs(4000)).toBe(20000);
    expect(cpuLimitMs(100_000)).toBe(60000);
    expect(caseValue('solved', 300, 300)).toBeCloseTo(1);
    expect(caseValue('solved', 600, 300)).toBeCloseTo(0.95);
    expect(caseValue('solved', 100, 300)).toBeCloseTo(1);
    expect(caseValue('unsolved', 100, 300)).toBe(0);
    expect(nudgeText(40, 'edges')).toBe('You have 40 min left in this stage. Keep working on edges/ until the time is up; it is submitted then.');
  });

  it('grades the reference answers as solved at value 1, each stage and end to end', () => {
    for (const c of chain) {
      const ins = inputs(c);
      STAGES.forEach((st, i) => {
        const o = gradeStage(st, c.n, ins[i], ok(c[st]), c.counts[i], 50);
        expect(o.status).toBe('solved');
        expect(o.value).toBeCloseTo(1);
      });
      const e = gradeChain(c.n, c.scrambled, STAGES.map((st) => ok(c[st])), c.counts, [50, 50, 50]);
      expect(e.status).toBe('solved');
      expect(e.states).toEqual(ins);
    }
  });

  it('fails answers that miss the goal, run over the cap or the CPU limit, or are not moves', () => {
    const c = chain[0];
    const ins = inputs(c);
    expect(gradeStage('edges', c.n, ins[1], ok(''), c.counts[1], 50).status).toBe('unsolved');
    expect(gradeStage('centres', c.n, ins[0], ok(c.centres), Math.floor(c.counts[0] / 2) - 1, 50).status).toBe('over_cap');
    expect(gradeStage('centres', c.n, ins[0], ok(c.centres, 5001), c.counts[0], 50).status).toBe('timeout');
    expect(gradeStage('centres', c.n, ins[0], { ...ok(c.centres), timed_out: 'cpu' }, c.counts[0], 50).status).toBe('timeout');
    expect(gradeStage('centres', c.n, ins[0], { ...ok(c.centres), exit_code: 1 }, c.counts[0], 50).status).toBe('crash');
    expect(gradeStage('centres', c.n, ins[0], ok('R Q'), c.counts[0], 50).status).toBe('illegal');
    // End to end stops at the first program that leaves its goal unmet.
    const e = gradeChain(c.n, c.scrambled, [ok(''), ok(c.edges), ok(c.finish)], c.counts, [50, 50, 50]);
    expect(e.status).toBe('unsolved');
    expect(e.detail).toMatch(/^centres/);
  });

  it('weights sizes by N', () => {
    const rows = [
      { size: 4, status: 'solved' as const, value: 1 },
      { size: 4, status: 'unsolved' as const, value: 0 },
      { size: 6, status: 'solved' as const, value: 1 },
    ];
    const p = partScore(rows, [4, 6]);
    expect(p.score).toBeCloseTo((4 * 0.5 + 6 * 1) / 10);
    expect(p.solved).toBe(2);
    expect(benchScore({ centres: p, edges: p, finish: p, e2e: p })).toBeCloseTo(100 * p.score);
  });
});
