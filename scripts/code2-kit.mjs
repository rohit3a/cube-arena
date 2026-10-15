#!/usr/bin/env node
// Writes coding v2's kits: public/code-kit/{v2,v2-mini}/<stage>/ with
// SPEC.md (from the template below), cube.py (grader/v2/cube.py) and
// check.py (grader/v2/kit/check.py). practice.json comes from
// scripts/code2-cases.mjs --practice; run that first.
//
//   node scripts/code2-kit.mjs

import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from './grader-lib.mjs';

const BENCHES = {
  v2: { sizes: [4, 5, 6, 7, 8, 9, 10], minutes: { centres: 90, edges: 90, finish: 60 } },
  'v2-mini': { sizes: [4, 5, 6], minutes: { centres: 30, edges: 30, finish: 20 } },
};
const STAGES = ['centres', 'edges', 'finish'];

const STAGE = {
  centres: {
    title: 'solve the centres',
    does: 'solve its centres',
    input: (sizes) => `A scrambled cube: solved, then 20 × (N − 2) random moves of outer blocks
(an outer face, or a wide block of up to half the cube's layers). So a
${sizes[0]}×${sizes[0]} gets ${20 * (sizes[0] - 2)} moves and a ${sizes.at(-1)}×${sizes.at(-1)} gets ${20 * (sizes.at(-1) - 2)}.`,
    goal: `Every face's **centre** solved: the (N − 2) × (N − 2) stickers inside each
face's outer ring are all one colour, and the six centre colours sit as on a
real cube (any orientation of it). Edges and corners may end up anywhere.

\`cube.centres_solved(state)\` is the grader's check.`,
    notes: `On odd sizes the middle sticker of each face never moves in a scramble, so
it fixes which colour goes where (unless your own moves turn a middle slice).
On even sizes any real-cube arrangement of the six colours counts.`,
  },
  edges: {
    title: 'pair the edges',
    does: 'pair its edges',
    input: () => `A cube whose centres are solved, with edges and corners anywhere. In the
stage cases it comes from our reference centres program run on a scrambled
cube. End to end (see Scoring) it comes from a centres program written in
another session, so handle any cube whose centres are solved: on even sizes
the centres may sit in any orientation of the cube.`,
    goal: `The centres still solved, and every **edge paired**: along each of the 12
edges, the N − 2 stickers between the corners are one colour on each of the
edge's two faces (on odd sizes they match the middle edge piece). Corners
may end up anywhere, and a paired edge may sit anywhere, flipped or not.

\`cube.edges_paired(state)\` is the grader's check (it also checks the centres).`,
    notes: `Pairing is always possible. On even sizes the paired cube may need moves a
3×3 can't make to finish (parity); that is the finish stage's problem, not
yours.`,
  },
  finish: {
    title: 'finish the cube',
    does: 'solve it',
    input: () => `A cube whose centres are solved and whose edges are paired, with corners and
edge pairs anywhere. In the stage cases it comes from our reference centres
and edges programs. End to end (see Scoring) it comes from an edges program
written in another session, so handle any such cube, in any orientation.`,
    goal: `The cube **solved**: every face one colour, in any orientation.

\`cube.is_solved(state)\` is the grader's check.`,
    notes: `With centres solved and edges paired the cube can be solved like a 3×3,
turning outer faces only, except on even sizes, where two parities a 3×3
never has can turn up: a single flipped edge pair, and two edge pairs (or two
corners) swapped. Your program has to handle both.`,
  },
};

function refTable(bench, stage) {
  const { cases } = JSON.parse(readFileSync(join(REPO, 'public/code-kit', bench, stage, 'practice.json'), 'utf8'));
  const rows = BENCHES[bench].sizes.map((n) => {
    const cs = cases.filter((c) => c.n === n);
    const mean = (k) => Math.round(cs.reduce((a, c) => a + c[k], 0) / cs.length);
    const par = Math.round(cs.reduce((a, c) => a + (c.par_moves ?? c.ref_moves), 0) / cs.length);
    return `| ${n}×${n} | ${n} | ${20 * (n - 2)} | ${par} | ${mean('ref_moves')} | ${mean('cap')} | ${(mean('cpu_limit_ms') / 1000).toFixed(0)} s |`;
  });
  return [
    '| Size | Weight | Scramble length (whole solve) | Best so far (this stage) | Our reference (this stage) | Cap (this stage) | CPU limit |',
    '|---|---|---|---|---|---|---|',
    ...rows,
  ].join('\n');
}

function spec(bench, stage) {
  const b = BENCHES[bench];
  const s = STAGE[stage];
  const k = STAGES.indexOf(stage) + 1;
  const sizes = b.sizes;
  const sizeList = sizes.length > 2 ? `${sizes[0]}×${sizes[0]} up to ${sizes.at(-1)}×${sizes.at(-1)}` : sizes.map((n) => `${n}×${n}`).join(' and ');
  const weightSum = sizes.reduce((a, n) => a + n, 0);
  const minutes = b.minutes[stage];
  return `# Cube Arena coding benchmark ${bench}, stage ${k} of 3: ${s.title}

Cube Arena's coding benchmark has you write an N×N cube solver for every size
from ${sizeList}, in three stages, each written in its own session: **centres**,
**edges**, **finish**. This session is stage ${k}: write \`${stage}/solve.py\`, a
program that takes a cube and prints the moves that ${s.does}.
When you finish, \`${stage}/\` is frozen and run on hidden cubes you have never seen.

## The stage

**Input.** ${s.input(sizes)}

**Goal.** ${s.goal}

${s.notes}

Meet the goal on every cube, within the CPU limit: a cube any of the three
programs fails scores 0. After that, every move you save raises the score
(see Scoring).

## Rules

- Write the program yourself. Use only the Python 3 and C/C++ standard
  libraries: no third-party packages, and no solver code downloaded or copied
  from anywhere. Known methods (commutators, reduction, and so on) are fine;
  the implementation must be yours.
- You have no internet access while you work.
- Don't try to find out the hidden cubes. They are made on our server, and
  your program only ever sees one at a time.
- Your code may be published with the results.

## Your workspace

| File | What it is |
|---|---|
| \`SPEC.md\` | This file. |
| \`cube.py\` | The reference N×N cube: the same sticker order, moves, move counting and stage checks as the grader. Copy it into \`${stage}/\` to import it. |
| \`practice.json\` | 30 practice cubes per size, made like the hidden ones: the input \`state\`${stage === 'centres' ? ' (and the `scramble` that made it)' : ''}, our reference's moves on it (\`ref_moves\`), the fewest moves any program we have graded has used on it (\`par_moves\`), this stage's move \`cap\` and the CPU limit (\`cpu_limit_ms\`). |
| \`check.py\` | Runs your program on practice cubes exactly as the grader does and prints the moves and how many cubes met the goal: the first 10 per size by default (the grader uses 10 hidden cubes per size), \`--held-out\` for the other 20, \`--all\` for all 30. |
| \`${stage}/\` | Your program. Only this folder is submitted. |

Run \`python3 check.py\` often (\`--sizes 4,5\` and \`--cases 1\` make it quicker).

## The interface

- \`${stage}/solve.py\` (required) is run once per cube as \`python3 solve.py\`
  from inside \`${stage}/\`. It reads two lines from stdin: N, then the cube's
  6·N² letters. It prints the moves to stdout, separated by spaces (line
  breaks are fine), and exits with code 0.
- Print nothing else to stdout: anything that isn't a move makes the answer
  unreadable. Write logs to stderr.
- \`${stage}/build.py\` (optional) is run once before any cube, as
  \`python3 build.py\` from inside \`${stage}/\`. Use it to compile C or C++ and
  to build tables into files under \`${stage}/\`. Compile on the grader:
  binaries built on your machine won't run there.
- While cubes are being solved, \`${stage}/\` is read-only. Write temporary
  files to \`/tmp\`, which is emptied between cubes.

## Limits (the same for every model)

| | |
|---|---|
| Grading machine | Linux x86-64, Python 3.12, gcc/g++ 12, standard libraries only. One core of an Intel i7-7700HQ (2017), 2 GB of memory, no network. |
| \`build.py\` | 10 minutes, once |
| \`solve.py\` | The cube's CPU limit (below): CPU time of every process it starts, Python's start-up included. |
| Answer | 512 KB of output per cube |
| \`${stage}/\` folder | 3 MB gzipped (generate big tables in \`build.py\`) |
| Time to write it | ${minutes} minutes, wall clock. \`${stage}/\` is submitted as it stands when the time runs out. If you stop with more than a tenth of the time left, your session is picked up again with a message saying how much is left (up to 5 times); stopping with less left than that submits it. |

## The state

6·N² letters, one per sticker. Each letter names the face whose colour that
sticker has when the cube is solved (\`U R F D L B\`). Faces come in the order
U, R, F, D, L, B (N² stickers each), and each face is read row by row, top to
bottom and left to right, as it appears in this net (a 4×4):

\`\`\`
           U U U U
           U U U U
           U U U U
           U U U U
 L L L L   F F F F   R R R R   B B B B
 L L L L   F F F F   R R R R   B B B B
 L L L L   F F F F   R R R R   B B B B
 L L L L   F F F F   R R R R   B B B B
           D D D D
           D D D D
           D D D D
           D D D D
\`\`\`

So the U face is seen from above with B at its top edge and F at its bottom
edge; D is seen from below with F at its top edge; F, R, B and L are seen
from outside with U at their top edge. This is the Kociemba facelet order of
a 3×3, scaled up. Index \`i\` in the string is face \`i // N²\`, row
\`(i % N²) // N\`, column \`i % N\`. The solved state is
\`"U"*N*N + "R"*N*N + "F"*N*N + "D"*N*N + "L"*N*N + "B"*N*N\`.

\`python3 cube.py show "<state>"\` draws a state as this net, and
\`python3 cube.py check "<state>" "<moves>"\` says what moves achieve.

## Moves

| Move | What turns |
|---|---|
| \`U R F D L B\` | That outer face, a quarter turn clockwise as you look at the face. |
| \`R'\` \`R2\` | Counter-clockwise; half turn. Every move takes these suffixes. |
| \`Rw\` (also \`2Rw\`), \`3Rw\` … | The 2, 3, … outer layers on that side, together (up to N − 1 layers). |
| \`2R\`, \`3R\` … | One inner layer only: the 2nd, 3rd, … from that face (up to the (N − 1)th), turning like \`R\`. |
| \`M\` \`E\` \`S\` | Odd sizes only: the middle layer, turning like \`L\`, \`D\`, \`F\`. |
| \`x\` \`y\` \`z\` | The whole cube, turning like \`R\`, \`U\`, \`F\`. |

Every layer turn counts 1 (half turns, wide turns and inner-layer turns too).
Whole-cube rotations are free.

## Scoring

The score comes from the **whole solve**. On each hidden scrambled cube the
grader chains the programs from the three sessions: centres on the scrambled
cube, edges on what that leaves, finish on what edges leaves, each with its
own stage's CPU limit.

- A cube scores **0** if any of the three fails on it: its goal isn't met, its
  answer isn't moves, it crashes or exits non-zero, or it uses more CPU time
  than its limit; or if the three together use more moves than the cap
  (2 × our reference's three stages together).
- Otherwise it scores **scramble length ÷ your moves**, the moves of all three
  programs together. The scramble length is the number of random moves that
  mixed the cube, 20 × (N − 2): undoing them solves it, so 1 means solving the
  cube in as few moves as it took to mix it. There is no upper limit: fewer
  moves than that score more than 1.

The benchmark score is 100 × the mean at each size, weighted by N (weights
sum to ${weightSum}), over 10 hidden cubes per size: bigger cubes count more.

Every move this program makes adds to that total, so fewer moves here score
more. ${stage === 'centres' ? 'End to end, the edges program gets whatever your program leaves.' : `End to end, your program runs on what the previous stage's program
leaves, not on what our reference leaves.`} We also run each program on
its own, on stage cubes from our reference programs, and report how it did,
but only the whole solve counts.

For scale (practice cubes, means per size):

${refTable(bench, stage)}

Best so far is the fewest moves any program we have graded has used on the
cube in this stage. Our reference is a plain commutator-based solver. The cap
here is this stage's alone (2 × our reference's moves); end to end it applies
to the three together. The **CPU limit** is 5 × our reference's CPU time on
that cube, at least 5 s and at most 60 s.
`;
}

for (const bench of Object.keys(BENCHES)) {
  for (const stage of STAGES) {
    const dir = join(REPO, 'public/code-kit', bench, stage);
    writeFileSync(join(dir, 'SPEC.md'), spec(bench, stage));
    copyFileSync(join(REPO, 'grader/v2/cube.py'), join(dir, 'cube.py'));
    copyFileSync(join(REPO, 'grader/v2/kit/check.py'), join(dir, 'check.py'));
  }
}
console.log('kits written');
