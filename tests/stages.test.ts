import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyMoves, isSolved, moveCost, parseMoves, solvedState, stateFromString, stateToString } from '../lib/cube/engine';
import { centresSolved, edgesPaired, stageDone } from '../lib/cube/stages';

// Made by the Python reference chain (grader/v2/ref): a scramble, then each stage's moves.
const chain: { n: number; scrambled: string; centres: string; edges: string; finish: string; counts: number[] }[] = JSON.parse(
  readFileSync(new URL('./fixtures/v2-chain.json', import.meta.url), 'utf8'),
);

describe('v2 stage checks', () => {
  it('agree with the Python reference chain on every size', () => {
    for (const c of chain) {
      const n = c.n;
      const s0 = stateFromString(c.scrambled, n);
      expect(centresSolved(s0, n)).toBe(false);
      const m1 = parseMoves(c.centres, n);
      const s1 = applyMoves(s0, n, m1);
      expect(centresSolved(s1, n)).toBe(true);
      expect(edgesPaired(s1, n)).toBe(false);
      const m2 = parseMoves(c.edges, n);
      const s2 = applyMoves(s1, n, m2);
      expect(edgesPaired(s2, n)).toBe(true);
      expect(isSolved(s2, n)).toBe(false);
      const m3 = parseMoves(c.finish, n);
      const s3 = applyMoves(s2, n, m3);
      expect(stageDone('finish', s3, n)).toBe(true);
      expect([moveCost(m1), moveCost(m2), moveCost(m3)]).toEqual(c.counts);
    }
  });

  it('accept any whole-cube orientation and outer turns, and reject inner turns', () => {
    for (const n of [4, 5, 7, 10]) {
      const at = (m: string) => applyMoves(solvedState(n), n, parseMoves(m, n));
      expect(edgesPaired(at("x y2 z'"), n)).toBe(true);
      expect(edgesPaired(at("R U F' D2 L B"), n)).toBe(true);
      expect(centresSolved(at('2R'), n)).toBe(false);
      expect(edgesPaired(at('R 2U R\''), n)).toBe(false);
    }
  });

  it('rejects centres solved in a colour scheme no cube has', () => {
    const n = 4;
    const s = stateToString(solvedState(n)).split('');
    const nn = n * n;
    // Swap the U and F centre colours only.
    for (const i of [5, 6, 9, 10]) {
      s[i] = 'F';
      s[2 * nn + i] = 'U';
    }
    expect(centresSolved(stateFromString(s.join(''), n), n)).toBe(false);
  });
});
