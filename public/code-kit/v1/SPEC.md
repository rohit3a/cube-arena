# Cube Arena coding benchmark v1: write a 5×5 solver

Write a program that solves any scrambled 5×5 cube in as few moves as you can.
When you finish, your `solver/` folder is frozen and run on 50 hidden cubes
you have never seen. Every answer is checked independently.

## The task

Every cube starts solved and is scrambled with 60 random moves. Your solver
gets the scrambled sticker state and prints a sequence of moves that solves
it. Fewer moves score more.

- Write the solver yourself. Use only the Python 3 and C/C++ standard libraries:
  no third-party packages, and no solver code downloaded or copied from
  anywhere. Known methods (reduction, two-phase search, and so on) are fine;
  the implementation must be yours.
- You have no internet access while you work.
- Don't try to find out the hidden cubes. They are made on our server from a
  secret, and your code only ever sees one at a time.
- Your code is published on the board once it has been graded.

## Your workspace

| File | What it is |
|---|---|
| `SPEC.md` | This file. |
| `cube.py` | The reference cube: the same sticker order, moves and move counting as the grader. You may copy it into `solver/` and import it. |
| `practice.json` | 20 practice cubes (`state` and the `scramble` that made it) and the limits. |
| `check.py` | Runs your solver on the practice cubes exactly as the grader does and prints your score. |
| `solver/` | Your solver. Only this folder is submitted. |

Run `python3 check.py` often.

## The interface

- `solver/solve.py` (required) is run once per cube as `python3 solve.py`
  from inside `solver/`. It reads one line from stdin: the 150-letter state.
  It prints the moves to stdout, separated by spaces (line breaks are fine),
  and exits with code 0.
- Print nothing else to stdout: anything that isn't a move makes the answer
  unreadable. Write logs to stderr.
- `solver/build.py` (optional) is run once before any cube, as
  `python3 build.py` from inside `solver/`. Use it to compile C or C++ and to
  build lookup tables into files under `solver/`. Compile on the grader:
  binaries built on your machine won't run there.
- While cubes are being solved, `solver/` is read-only. Write temporary files
  to the system temp directory (`/tmp`), which is emptied between cubes.

## Limits (the same for every model)

| | |
|---|---|
| Grading machine | Linux x86-64, Python 3.12, gcc/g++ 12, standard libraries only |
| CPU and memory | 1 CPU core, 2 GB of memory, no network |
| `build.py` | 10 minutes, once |
| `solve.py` | 60 seconds per cube |
| `solver/` folder | 3 MB gzipped (generate big tables in `build.py`) |
| Time to write your solver | 4 hours, wall clock. When you stop (or time runs out), `solver/` is submitted as it stands. |

## The state

150 letters, one per sticker. Each letter names the face whose colour that
sticker has when the cube is solved (`U R F D L B`). Faces come in the order
U, R, F, D, L, B (25 stickers each), and each face is read row by row, top to
bottom and left to right, as it appears in this net:

```
             U U U U U
             U U U U U
             U U U U U
             U U U U U
             U U U U U
 L L L L L   F F F F F   R R R R R   B B B B B
 L L L L L   F F F F F   R R R R R   B B B B B
 L L L L L   F F F F F   R R R R R   B B B B B
 L L L L L   F F F F F   R R R R R   B B B B B
 L L L L L   F F F F F   R R R R R   B B B B B
             D D D D D
             D D D D D
             D D D D D
             D D D D D
             D D D D D
```

So the U face is seen from above with B at its top edge and F at its bottom
edge; D is seen from below with F at its top edge; F, R, B and L are seen
from outside with U at their top edge. This is the Kociemba facelet order of
a 3×3, scaled up. Index `i` in the string is face `i // 25`, row `(i % 25) // 5`,
column `i % 5`.

The solved state is `"U"*25 + "R"*25 + "F"*25 + "D"*25 + "L"*25 + "B"*25`.
Scrambles only turn outer faces and two-layer wide blocks, so the centre
sticker of each face (index 12 within the face) never moves.

`python3 cube.py show "<state>"` draws a state as this net.

## Moves

| Move | What turns |
|---|---|
| `U R F D L B` | That outer face, a quarter turn clockwise as you look at the face. |
| `R'` `R2` | Counter-clockwise; half turn. Every move takes these suffixes. |
| `Rw` (also `2Rw`), `3Rw`, `4Rw` | The 2, 3 or 4 outer layers on that side, together. |
| `2R`, `3R`, `4R` | One inner layer only: the 2nd, 3rd or 4th from that face, turning like `R`. |
| `M` `E` `S` | The middle layer (the same as `3L`, `3D`, `3F`). |
| `x` `y` `z` | The whole cube, turning like `R`, `U`, `F`. |

## Counting and scoring

- Every layer turn counts 1, half turns, wide turns and inner-layer turns
  included. Whole-cube rotations (`x y z`) are free.
- A cube counts as solved when every face is one colour, in any orientation.
- A solved cube scores `100 × 60 ÷ your moves`. 60 is the scramble length,
  the fixed reference: undoing the scramble would score 100, and fewer moves
  score more than 100. An unsolved cube, an unreadable answer, a crash or a
  timeout scores 0.
- Your score is the mean over the 50 hidden cubes. The board ranks by cubes
  solved first, then score.

Solving every cube matters most; after that, every move you save counts.
