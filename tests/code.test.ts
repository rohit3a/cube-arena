import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { applyMoves, isSolved, moveCost, parseMoves, solvedState, stateFromString, stateToString } from '../lib/cube/engine';
import { rng } from '../lib/cube/scramble';
import { CODE, caseScore, codeRank, gradeCase, hiddenCases, practiceCases, summarize } from '../lib/arena/code-rules';

const N = 5;
const ok = (stdout: string, ms = 10) => ({ stdout, exit_code: 0, timed_out: false, ms });
const invert = (scramble: string) =>
  scramble
    .split(' ')
    .reverse()
    .map((t) => (t.endsWith('2') ? t : t.endsWith("'") ? t.slice(0, -1) : `${t}'`))
    .join(' ');

describe('coding benchmark cases', () => {
  it('scrambles every cube with 60 counted moves, the reference', () => {
    for (const c of [...practiceCases(), ...hiddenCases()]) {
      const moves = parseMoves(c.scramble, N);
      expect(moves).toHaveLength(CODE.reference);
      expect(moveCost(moves)).toBe(CODE.reference);
      expect(stateToString(applyMoves(solvedState(N), N, moves))).toBe(c.state);
      expect(isSolved(stateFromString(c.state, N), N)).toBe(false);
    }
  });

  it('keeps the hidden cubes apart from the practice ones, and the same every time', () => {
    const practice = new Set(practiceCases().map((c) => c.state));
    const hidden = hiddenCases();
    expect(hidden).toHaveLength(CODE.cases);
    expect(hidden.some((c) => practice.has(c.state))).toBe(false);
    expect(hiddenCases().map((c) => c.state)).toEqual(hidden.map((c) => c.state));
    expect(new Set(hidden.map((c) => c.state)).size).toBe(CODE.cases);
  });

  it('leaves each face centre where it is (scrambles turn at most two layers)', () => {
    for (const c of practiceCases()) for (let f = 0; f < 6; f++) expect(c.state[f * 25 + 12]).toBe('URFDLB'[f]);
  });
});

describe('grading an answer', () => {
  const c = practiceCases()[0];

  it('scores the inverse scramble 100 and longer solutions less', () => {
    const inv = gradeCase(c.state, ok(invert(c.scramble)));
    expect(inv).toEqual({ status: 'solved', moves: 60, detail: null });
    expect(caseScore(inv)).toBe(100);
    // Two extra moves that cancel: still solved, 62 moves.
    const longer = gradeCase(c.state, ok(`${invert(c.scramble)} R R'`));
    expect(longer.status).toBe('solved');
    expect(caseScore(longer)).toBeCloseTo(6000 / 62, 6);
  });

  it('does not charge for whole-cube rotations', () => {
    // Solved in any orientation, so turning the whole cube after the solve costs nothing.
    const o = gradeCase(c.state, ok(`${invert(c.scramble)} x y2 z'`));
    expect(o).toMatchObject({ status: 'solved', moves: 60 });
  });

  it('gives nothing for an unsolved, unreadable, crashed or slow answer', () => {
    expect(gradeCase(c.state, ok('R U')).status).toBe('unsolved');
    expect(gradeCase(c.state, ok('')).status).toBe('unsolved');
    expect(gradeCase(c.state, ok('solving... R U')).status).toBe('illegal');
    expect(gradeCase(c.state, ok('5R')).status).toBe('illegal');
    expect(gradeCase(c.state, { ...ok(invert(c.scramble)), exit_code: 1 }).status).toBe('crash');
    expect(gradeCase(c.state, { ...ok(invert(c.scramble)), timed_out: true }).status).toBe('timeout');
    for (const s of ['unsolved', 'illegal', 'timeout', 'crash'] as const) expect(caseScore({ status: s, moves: 3 })).toBe(0);
  });

  it('averages over every case, failures counting 0, and ranks solve rate first', () => {
    const sum = summarize([
      { status: 'solved', moves: 60, detail: null, ms: 100 },
      { status: 'solved', moves: 120, detail: null, ms: 300 },
      { status: 'timeout', moves: null, detail: null, ms: 60000 },
      { status: 'illegal', moves: null, detail: null, ms: null },
    ]);
    expect(sum).toEqual({ cases: 4, solved: 2, score: (100 + 50) / 4, mean_moves: 90, mean_ms: (100 + 300 + 60000) / 3 });
    const a = { solved: 50, cases: 50, score: 20 };
    const b = { solved: 49, cases: 50, score: 90 };
    expect([b, a].sort(codeRank)).toEqual([a, b]);
  });
});

// The kit's cube.py must be the server's cube exactly: same stickers, moves and counting.
const python = spawnSync('python3', ['--version']).status === 0;

describe.skipIf(!python)('the kit cube.py', () => {
  const POOL = [
    ...'URFDLB'.split('').flatMap((f) => [f, `2${f}`, `3${f}`, `4${f}`, `${f}w`, `3${f}w`, `4${f}w`]),
    'M', 'E', 'S', 'x', 'y', 'z',
  ];
  const SUFFIX = ['', "'", '2', "2'", '’'];

  it('turns, counts and checks exactly like the server', () => {
    const random = rng(12345);
    const pick = <T,>(xs: T[]) => xs[Math.floor(random() * xs.length)];
    const seqs = Array.from({ length: 300 }, (_, i) => {
      const toks = Array.from({ length: 1 + Math.floor(random() * 40) }, () => pick(POOL) + pick(SUFFIX));
      // Some written without spaces, some with commas.
      return i % 7 === 0 ? toks.join('') : i % 5 === 0 ? toks.join(',') : toks.join(' ');
    });
    const start = practiceCases()[3].state;
    const expected = seqs.map((s) => {
      const moves = parseMoves(s, N);
      const end = applyMoves(stateFromString(start, N), N, moves);
      return { state: stateToString(end), count: moveCost(moves), solved: isSolved(end, N) };
    });
    const script = [
      'import json, sys',
      "sys.path.insert(0, 'public/code-kit/v1')",
      'import cube',
      'data = json.load(sys.stdin)',
      "print(json.dumps([{'state': cube.apply(data['start'], s), 'count': cube.count(s), 'solved': cube.is_solved(cube.apply(data['start'], s))} for s in data['seqs']]))",
    ].join('\n');
    const out = spawnSync('python3', ['-c', script], { input: JSON.stringify({ start, seqs }), encoding: 'utf8' });
    expect(out.stderr).toBe('');
    expect(JSON.parse(out.stdout)).toEqual(expected);
  });

  it('solves a practice cube with its inverse scramble and refuses what the server refuses', () => {
    const c = practiceCases()[0];
    const script = [
      'import json, sys',
      "sys.path.insert(0, 'public/code-kit/v1')",
      'import cube',
      'd = json.load(sys.stdin)',
      'bad = []',
      "for m in ['5R', '1Rw', 'Rw5', 'Q', '5Rw', 'R3']:",
      '    try:',
      '        cube.apply(cube.SOLVED, m)',
      '    except cube.MoveError:',
      '        bad.append(m)',
      "print(json.dumps({'solved': cube.is_solved(cube.apply(d['state'], d['inv'])), 'count': cube.count(d['inv']), 'bad': bad, 'solved0': cube.is_solved(cube.SOLVED)}))",
    ].join('\n');
    const out = spawnSync('python3', ['-c', script], { input: JSON.stringify({ state: c.state, inv: invert(c.scramble) }), encoding: 'utf8' });
    expect(out.stderr).toBe('');
    expect(JSON.parse(out.stdout)).toEqual({ solved: true, count: 60, bad: ['5R', '1Rw', 'Rw5', 'Q', '5Rw', 'R3'], solved0: true });
    for (const m of ['5R', '1Rw', '5Rw']) expect(() => parseMoves(m, N)).toThrow();
  });
});
