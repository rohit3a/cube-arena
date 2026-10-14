// The coding v2 stage checks, the same as grader/v2/cube.py: centres solved
// (in a real colour scheme), edges paired (centres still solved), solved.

import { type CubeState, isSolved, parseMove, applyTurn, solvedState, stickers } from './engine';

/** Face -> colour maps of the solved cube in its 24 orientations, as 6-colour keys (U R F D L B). */
const SCHEMES: Set<string> = (() => {
  const out = new Set<string>();
  const frontier = [solvedState(3)];
  const rot = ['x', 'y', 'z'].map((r) => parseMove(r, 3).turn);
  while (frontier.length) {
    const s = frontier.pop()!;
    const key = Array.from({ length: 6 }, (_, f) => s[f * 9 + 4]).join(',');
    if (out.has(key)) continue;
    out.add(key);
    for (const t of rot) frontier.push(applyTurn(s, 3, t));
  }
  return out;
})();

/** Each face's centre colour (all but the outer ring), or null if some face's centre is mixed. */
export function centreColours(state: CubeState, n: number): number[] | null {
  const nn = n * n;
  const out: number[] = [];
  for (let f = 0; f < 6; f++) {
    const c = state[f * nn + n + 1];
    for (let r = 1; r < n - 1; r++) for (let k = 1; k < n - 1; k++) if (state[f * nn + r * n + k] !== c) return null;
    out.push(c);
  }
  return out;
}

export function centresSolved(state: CubeState, n: number): boolean {
  if (n < 3) return true;
  const cc = centreColours(state, n);
  return cc !== null && SCHEMES.has(cc.join(','));
}

const stripCache = new Map<number, [number[], number[]][]>();

/** The 12 edges, each as the N-2 sticker indices along it on each of its two faces. */
export function edgeStrips(n: number): [number[], number[]][] {
  let out = stripCache.get(n);
  if (out) return out;
  const byPos = new Map<string, number[]>();
  stickers(n).forEach((s, i) => {
    const k = s.pos.join(',');
    byPos.set(k, [...(byPos.get(k) ?? []), i]);
  });
  const edges = new Map<string, number[][]>();
  for (const [k, idx] of byPos) {
    if (idx.length !== 2) continue;
    const pos = k.split(',').map(Number);
    const key = [0, 1, 2].filter((a) => Math.abs(pos[a]) === n - 1).map((a) => `${a}:${pos[a]}`).join('|');
    edges.set(key, [...(edges.get(key) ?? []), idx]);
  }
  out = [...edges.values()].map((pieces) => {
    const sorted = pieces.map((p) => [...p].sort((a, b) => a - b)).sort((a, b) => a[0] - b[0]);
    return [sorted.map((p) => p[0]), sorted.map((p) => p[1])] as [number[], number[]];
  });
  stripCache.set(n, out);
  return out;
}

export function edgesPaired(state: CubeState, n: number): boolean {
  if (!centresSolved(state, n)) return false;
  for (const [a, b] of edgeStrips(n)) {
    if (a.some((i) => state[i] !== state[a[0]]) || b.some((i) => state[i] !== state[b[0]])) return false;
  }
  return true;
}

export type Stage = 'centres' | 'edges' | 'finish';
export const STAGES: Stage[] = ['centres', 'edges', 'finish'];

/** Whether a state meets a stage's goal. */
export function stageDone(stage: Stage, state: CubeState, n: number): boolean {
  if (stage === 'centres') return centresSolved(state, n);
  if (stage === 'edges') return edgesPaired(state, n);
  return isSolved(state, n);
}
