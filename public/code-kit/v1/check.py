"""Runs your solver the way the grader does, on the practice cubes.

    python3 check.py                 build (solver/build.py, if there is one), then solve every practice cube
    python3 check.py --cases 5       only the first 5 cubes
    python3 check.py --no-build      skip the build (it already ran)

The grader does the same on 50 hidden cubes, scrambled the same way, on a
Linux machine (Python 3.12, gcc/g++ 12, one CPU, 2 GB of memory, no network),
with solver/ read-only while solving.
"""

import argparse
import json
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
SOLVER = os.path.join(HERE, "solver")
sys.path.insert(0, HERE)
import cube  # noqa: E402

BINARY_MAGIC = (b"\x7fELF", b"\xcf\xfa\xed\xfe", b"\xce\xfa\xed\xfe", b"MZ")


def snapshot():
    seen = {}
    for root, dirs, files in os.walk(SOLVER):
        dirs[:] = [d for d in dirs if d != "__pycache__"]
        for f in files:
            p = os.path.join(root, f)
            try:
                st = os.stat(p)
            except OSError:
                continue
            seen[os.path.relpath(p, SOLVER)] = (st.st_size, st.st_mtime_ns)
    return seen


def changed(before, after):
    return sorted(k for k in set(before) | set(after) if before.get(k) != after.get(k))


def binaries():
    out = []
    for path in snapshot():
        try:
            with open(os.path.join(SOLVER, path), "rb") as fh:
                if fh.read(4).startswith(BINARY_MAGIC):
                    out.append(path)
        except OSError:
            pass
    return out


def run(args, stdin, timeout):
    start = time.perf_counter()
    try:
        p = subprocess.run(args, cwd=SOLVER, input=stdin, capture_output=True, text=True, timeout=timeout)
        return p.returncode, p.stdout, p.stderr, time.perf_counter() - start, False
    except subprocess.TimeoutExpired as e:
        out = e.stdout.decode() if isinstance(e.stdout, bytes) else (e.stdout or "")
        err = e.stderr.decode() if isinstance(e.stderr, bytes) else (e.stderr or "")
        return None, out, err, time.perf_counter() - start, True


def grade(state, code, out, timed_out, limit):
    if timed_out:
        return "timeout", None, "over %d s" % limit
    if code != 0:
        return "crash", None, "exit code %s" % code
    try:
        end = cube.apply(state, out.strip())
        moves = cube.count(out.strip())
    except (cube.MoveError, ValueError) as e:
        return "illegal", None, str(e)[:200]
    if cube.is_solved(end):
        return "solved", moves, None
    return "unsolved", moves, "the cube is not solved after these moves"


def main():
    ap = argparse.ArgumentParser(description="Run your solver on the practice cubes, as the grader would.")
    ap.add_argument("--cases", type=int, default=None, help="only the first N practice cubes")
    ap.add_argument("--no-build", action="store_true", help="skip solver/build.py")
    opt = ap.parse_args()

    with open(os.path.join(HERE, "practice.json")) as fh:
        kit = json.load(fh)
    limits = kit["limits"]
    cases = kit["practice"][: opt.cases] if opt.cases else kit["practice"]

    if not os.path.isfile(os.path.join(SOLVER, "solve.py")):
        print("solver/solve.py is missing: it reads one state from stdin and prints the moves (see SPEC.md).")
        return 2
    if sys.version_info[:2] != (3, 12):
        print("note: this is Python %d.%d; the grader runs 3.12." % sys.version_info[:2])

    build = os.path.join(SOLVER, "build.py")
    if os.path.isfile(build) and not opt.no_build:
        print("building (solver/build.py, up to %d s) ..." % limits["buildSecs"])
        code, out, err, secs, timed_out = run([sys.executable, "build.py"], "", limits["buildSecs"])
        if timed_out or code != 0:
            print("BUILD FAILED (%s) after %.1f s; the grader would score every cube 0." % ("timed out" if timed_out else "exit code %s" % code, secs))
            print((out + err)[-3000:])
            return 1
        print("built in %.1f s" % secs)
    elif not os.path.isfile(build):
        bins = binaries()
        if bins:
            print("warning: compiled files in solver/ (%s) but no build.py. The grader runs Linux x86-64: build them there with build.py." % ", ".join(bins[:5]))

    before = snapshot()
    total = 0.0
    solved_moves = []
    times = []
    for c in cases:
        code, out, err, secs, timed_out = run([sys.executable, "solve.py"], c["state"] + "\n", limits["solveSecs"])
        status, moves, detail = grade(c["state"], code, out, timed_out, limits["solveSecs"])
        score = 100.0 * limits["reference"] / max(1, moves) if status == "solved" else 0.0
        total += score
        times.append(secs)
        if status == "solved":
            solved_moves.append(moves)
        line = "#%-3d %-9s %5s moves %7.2f s   score %6.2f" % (c["n"], status, moves if moves is not None else "-", secs, score)
        if detail:
            line += "   (%s)" % detail
        print(line)
        if status == "crash" and err.strip():
            print("      " + err.strip().splitlines()[-1][:300])
        after = snapshot()
        diff = changed(before, after)
        if diff:
            print("      warning: solve.py changed solver/ (%s). It is read-only when graded: write to a temporary directory instead." % ", ".join(diff[:5]))
            before = after

    n = len(cases)
    print()
    print("solved %d of %d" % (len(solved_moves), n))
    if solved_moves:
        print("mean moves (solved cubes) %.1f" % (sum(solved_moves) / len(solved_moves)))
    print("mean time %.2f s per cube (limit %d s)" % (sum(times) / max(1, n), limits["solveSecs"]))
    print("score %.2f  (100 = %d moves per cube; unsolved cubes count 0)" % (total / max(1, n), limits["reference"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
