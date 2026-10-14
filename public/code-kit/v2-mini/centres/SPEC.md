# Cube Arena coding benchmark v2-mini, stage 1 of 3: solve the centres

Cube Arena's coding benchmark has you write an N×N cube solver for every size
from 4×4 up to 6×6, in three stages, each written in its own session: **centres**,
**edges**, **finish**. This session is stage 1: write `centres/solve.py`, a
program that takes a cube and prints the moves that solve its centres.
When you finish, `centres/` is frozen and run on hidden cubes you have never seen.

## The stage

**Input.** A scrambled cube: solved, then 20 × (N − 2) random moves of outer blocks
(an outer face, or a wide block of up to half the cube's layers). So a
4×4 gets 40 moves and a 6×6 gets 80.

**Goal.** Every face's **centre** solved: the (N − 2) × (N − 2) stickers inside each
face's outer ring are all one colour, and the six centre colours sit as on a
real cube (any orientation of it). Edges and corners may end up anywhere.

`cube.centres_solved(state)` is the grader's check.

On odd sizes the middle sticker of each face never moves in a scramble, so
it fixes which colour goes where (unless your own moves turn a middle slice).
On even sizes any real-cube arrangement of the six colours counts.

Meet the goal on every cube, within the move cap and the CPU limit; after
that, fewer moves score more: half of each cube's value goes by how close you
come to par (see Scoring).

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
| `SPEC.md` | This file. |
| `cube.py` | The reference N×N cube: the same sticker order, moves, move counting and stage checks as the grader. Copy it into `centres/` to import it. |
| `practice.json` | 30 practice cubes per size, made like the hidden ones: the input `state` (and the `scramble` that made it), our reference's moves on it (`ref_moves`), par (`par_moves`), the move `cap` and the CPU limit (`cpu_limit_ms`). |
| `check.py` | Runs your program on practice cubes exactly as the grader does and prints the stage score: the first 10 per size by default (the grader uses 10 hidden cubes per size), `--held-out` for the other 20, `--all` for all 30. |
| `centres/` | Your program. Only this folder is submitted. |

Run `python3 check.py` often (`--sizes 4,5` and `--cases 1` make it quicker).

## The interface

- `centres/solve.py` (required) is run once per cube as `python3 solve.py`
  from inside `centres/`. It reads two lines from stdin: N, then the cube's
  6·N² letters. It prints the moves to stdout, separated by spaces (line
  breaks are fine), and exits with code 0.
- Print nothing else to stdout: anything that isn't a move makes the answer
  unreadable. Write logs to stderr.
- `centres/build.py` (optional) is run once before any cube, as
  `python3 build.py` from inside `centres/`. Use it to compile C or C++ and
  to build tables into files under `centres/`. Compile on the grader:
  binaries built on your machine won't run there.
- While cubes are being solved, `centres/` is read-only. Write temporary
  files to `/tmp`, which is emptied between cubes.

## Limits (the same for every model)

| | |
|---|---|
| Grading machine | Linux x86-64, Python 3.12, gcc/g++ 12, standard libraries only. One core of an Intel i7-7700HQ (2017), 2 GB of memory, no network. |
| `build.py` | 10 minutes, once |
| `solve.py` | The cube's CPU limit (below): CPU time of every process it starts, Python's start-up included. |
| Answer | 512 KB of output per cube |
| `centres/` folder | 3 MB gzipped (generate big tables in `build.py`) |
| Time to write it | 30 minutes, wall clock. `centres/` is submitted as it stands when the time runs out. If you stop with more than a tenth of the time left, your session is picked up again with a message saying how much is left (up to 5 times); stopping with less left than that submits it. |

## The state

6·N² letters, one per sticker. Each letter names the face whose colour that
sticker has when the cube is solved (`U R F D L B`). Faces come in the order
U, R, F, D, L, B (N² stickers each), and each face is read row by row, top to
bottom and left to right, as it appears in this net (a 4×4):

```
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
```

So the U face is seen from above with B at its top edge and F at its bottom
edge; D is seen from below with F at its top edge; F, R, B and L are seen
from outside with U at their top edge. This is the Kociemba facelet order of
a 3×3, scaled up. Index `i` in the string is face `i // N²`, row
`(i % N²) // N`, column `i % N`. The solved state is
`"U"*N*N + "R"*N*N + "F"*N*N + "D"*N*N + "L"*N*N + "B"*N*N`.

`python3 cube.py show "<state>"` draws a state as this net, and
`python3 cube.py check "<state>" "<moves>"` says what moves achieve.

## Moves

| Move | What turns |
|---|---|
| `U R F D L B` | That outer face, a quarter turn clockwise as you look at the face. |
| `R'` `R2` | Counter-clockwise; half turn. Every move takes these suffixes. |
| `Rw` (also `2Rw`), `3Rw` … | The 2, 3, … outer layers on that side, together (up to N − 1 layers). |
| `2R`, `3R` … | One inner layer only: the 2nd, 3rd, … from that face (up to the (N − 1)th), turning like `R`. |
| `M` `E` `S` | Odd sizes only: the middle layer, turning like `L`, `D`, `F`. |
| `x` `y` `z` | The whole cube, turning like `R`, `U`, `F`. |

Every layer turn counts 1 (half turns, wide turns and inner-layer turns too).
Whole-cube rotations are free.

## Scoring

Each hidden cube is worth between 0 and 1:

- **0** if, after your moves, the goal isn't met; if the answer isn't moves,
  the program crashes or exits non-zero; if it uses more CPU time than the
  cube's limit; or if it uses more moves than the cube's cap.
- Otherwise **0.5 + 0.5 × min(1, par ÷ your moves)**. **Par** is the fewest
  moves any program we have graded has used on that cube (never more than our
  reference program's), fixed for this benchmark. Meeting the goal within the
  limits is worth 0.5; matching par (or beating it) earns the other 0.5.
- The **cap** is 2 × ref, where ref is our reference program's move count on
  that cube. The **CPU limit** is 5 × our reference's CPU time on that cube,
  at least 5 s and at most 60 s. Our reference is a plain commutator-based
  solver, well above par; for scale (practice cubes):

| Size | Weight | Par (practice mean) | Reference moves | Cap | CPU limit |
|---|---|---|---|---|---|
| 4×4 | 4 | 30 | 92 | 184 | 5 s |
| 5×5 | 5 | 96 | 184 | 369 | 5 s |
| 6×6 | 6 | 181 | 314 | 628 | 5 s |

The stage score is the mean value at each size, weighted by N (weights sum to
15), over 10 hidden cubes per size: bigger cubes count more.

The benchmark score is 100 × the mean of four parts: the three stages, and
**end to end**, where the grader chains the centres, edges and finish
programs from the three sessions on each scrambled cube (each program with
its own stage's CPU limit; the cap is 2 × our reference's three stages
together, and par is the fewest moves any graded chain has used on that cube). End to end, the edges program gets whatever your program leaves.
