"""Runs your stage program the way the grader does, on the practice cubes.

    python3 check.py                 build (build.py, if there is one), then run the first 10 practice cubes of each size
    python3 check.py --held-out      the other 20 of each size: cubes you haven't been tuning on
    python3 check.py --all           all 30 of each size
    python3 check.py --sizes 4,5     only these sizes
    python3 check.py --cases 1       only the first cube of each size
    python3 check.py --no-build      skip the build (it already ran)

It prints, for each cube, whether the stage's goal is met, the moves (with the
best any graded program has done, our reference's and the cap) and the CPU time
against the limit; then, per size, how many met the goal and the mean moves.
The score counts the full solve (SPEC.md, Scoring): your three programs chained,
scramble length / their moves together, so every move here counts, and a cube
this program fails scores 0. The grader runs 10 hidden cubes per size, made the same way, on
a Linux machine (Python 3.12, gcc/g++ 12, one CPU core, 2 GB of memory, no
network), with your folder on its own and read-only while it solves. So does this:
after the build it runs a copy of your folder alone in a temporary folder, so a
program that reaches outside its folder (for ../cube.py, say) fails here too.
"""

import argparse
import io
import json
import os
import resource
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import cube  # noqa: E402

BUILD_SECS = 600
# check.py's default: the first 10 cubes of each size, as many as the grader's hidden cubes.
FIRST = 10
OUTPUT_MAX = 512 * 1024
BUNDLE_MAX = 3_000_000
BINARY_MAGIC = (b"\x7fELF", b"\xcf\xfa\xed\xfe", b"\xce\xfa\xed\xfe", b"MZ")
GOAL = {
    "centres": (cube.centres_solved, "the centres are not all solved"),
    "edges": (cube.edges_paired, "the edges are not all paired (or the centres came apart)"),
    "finish": (cube.is_solved, "the cube is not solved"),
}


def snapshot(folder):
    seen = {}
    for root, dirs, files in os.walk(folder):
        dirs[:] = [d for d in dirs if d != "__pycache__"]
        for f in files:
            p = os.path.join(root, f)
            try:
                st = os.stat(p)
            except OSError:
                continue
            seen[os.path.relpath(p, folder)] = (st.st_size, st.st_mtime_ns)
    return seen


def binaries(folder):
    out = []
    for path in snapshot(folder):
        try:
            with open(os.path.join(folder, path), "rb") as fh:
                if fh.read(4).startswith(BINARY_MAGIC):
                    out.append(path)
        except OSError:
            pass
    return out


def gz_size(folder):
    """The folder as the runner submits it: a gzipped tar (without __pycache__)."""
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for name in sorted(os.listdir(folder)):
            tar.add(os.path.join(folder, name), arcname=name, filter=lambda t: None if "__pycache__" in t.name else t)
    return len(buf.getvalue())


def run(args, cwd, stdin, cpu_limit):
    """Runs a program; returns (exit code, stdout, stderr, cpu seconds, wall seconds, timed out)."""
    before = resource.getrusage(resource.RUSAGE_CHILDREN)
    start = time.perf_counter()
    wall = max(3 * cpu_limit, cpu_limit + 30)
    timed_out = False
    try:
        p = subprocess.run(args, cwd=cwd, input=stdin, capture_output=True, text=True, timeout=wall)
        code, out, err = p.returncode, p.stdout, p.stderr
    except subprocess.TimeoutExpired as e:
        timed_out = True
        code = None
        out = e.stdout.decode() if isinstance(e.stdout, bytes) else (e.stdout or "")
        err = e.stderr.decode() if isinstance(e.stderr, bytes) else (e.stderr or "")
    after = resource.getrusage(resource.RUSAGE_CHILDREN)
    cpu = (after.ru_utime - before.ru_utime) + (after.ru_stime - before.ru_stime)
    if cpu > cpu_limit:
        timed_out = True
    return code, out, err, cpu, time.perf_counter() - start, timed_out


def grade(stage, n, state, code, out, timed_out, case):
    """(status, moves, detail) as the grader decides them."""
    if timed_out:
        return "timeout", None, "over the CPU limit of %.1f s" % (case["cpu_limit_ms"] / 1000)
    if code != 0:
        return "crash", None, "exit code %s" % code
    if len(out.encode()) > OUTPUT_MAX:
        return "over_cap", None, "the answer is longer than the grader reads (%d bytes)" % OUTPUT_MAX
    try:
        end = cube.apply(state, out.strip(), n)
        moves = cube.count(out.strip(), n)
    except (cube.MoveError, ValueError) as e:
        return "illegal", None, str(e)[:200]
    done, why = GOAL[stage]
    if not done(end):
        return "unsolved", moves, why
    if moves > case["cap"]:
        return "over_cap", moves, "%d moves, over the cap of %d" % (moves, case["cap"])
    return "solved", moves, None


def main():
    ap = argparse.ArgumentParser(description="Run your stage program on the practice cubes, as the grader would.")
    ap.add_argument("--sizes", default=None, help="only these sizes, e.g. 4,5")
    ap.add_argument("--cases", type=int, default=None, help="only the first N cubes of each size")
    ap.add_argument("--held-out", action="store_true", help="the cubes after the first 10 of each size")
    ap.add_argument("--all", action="store_true", help="every practice cube")
    ap.add_argument("--no-build", action="store_true", help="skip build.py")
    opt = ap.parse_args()

    with open(os.path.join(HERE, "practice.json")) as fh:
        kit = json.load(fh)
    stage = kit["stage"]
    folder = os.path.join(HERE, stage)
    cases = kit["cases"]
    if opt.sizes:
        keep = {int(x) for x in opt.sizes.split(",")}
        cases = [c for c in cases if c["n"] in keep]
    if opt.held_out:
        cases = [c for c in cases if c["case"] >= FIRST]
    elif opt.cases:
        cases = [c for c in cases if c["case"] < opt.cases]
    elif not opt.all:
        cases = [c for c in cases if c["case"] < FIRST]

    if not os.path.isfile(os.path.join(folder, "solve.py")):
        print("%s/solve.py is missing: it reads N and a state from stdin and prints moves (see SPEC.md)." % stage)
        return 2
    if sys.version_info[:2] != (3, 12):
        print("note: this is Python %d.%d; the grader runs 3.12." % sys.version_info[:2])

    build = os.path.join(folder, "build.py")
    if os.path.isfile(build) and not opt.no_build:
        print("building (%s/build.py, up to %d s) ..." % (stage, BUILD_SECS))
        code, out, err, cpu, secs, timed_out = run([sys.executable, "build.py"], folder, "", BUILD_SECS)
        if timed_out or code != 0:
            print("BUILD FAILED (%s) after %.1f s; the grader would score every cube 0." % ("timed out" if timed_out else "exit code %s" % code, secs))
            print((out + err)[-3000:])
            return 1
        print("built in %.1f s" % secs)
    elif not os.path.isfile(build):
        bins = binaries(folder)
        if bins:
            print("warning: compiled files in %s/ (%s) but no build.py. The grader runs Linux x86-64: compile there, in build.py." % (stage, ", ".join(bins[:5])))

    # The grader runs the folder on its own: so does this, on a copy alone in a temporary folder.
    tmp = tempfile.mkdtemp(prefix="check-")
    alone = os.path.join(tmp, "solver")
    shutil.copytree(folder, alone, ignore=shutil.ignore_patterns("__pycache__"))
    try:
        by_size = run_cases(stage, alone, cases)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    print()
    return report(stage, folder, by_size)


def run_cases(stage, alone, cases):
    """Runs solve.py in `alone` on each cube, a line per cube; returns (case, met the goal, moves) by size."""
    before = snapshot(alone)
    by_size = {}
    for c in cases:
        n = c["n"]
        limit = c["cpu_limit_ms"] / 1000
        code, out, err, cpu, secs, timed_out = run([sys.executable, "solve.py"], alone, "%d\n%s\n" % (n, c["state"]), limit)
        status, moves, detail = grade(stage, n, c["state"], code, out, timed_out, c)
        by_size.setdefault(n, []).append((c, status == "solved", moves))
        line = "%2dx%-2d #%d  %-8s %5s moves (best so far %4d, ours %4d, cap %4d)  %6.2f s CPU (limit %4.1f)" % (
            n, n, c["case"], status, moves if moves is not None else "-", c.get("par_moves", c["ref_moves"]), c["ref_moves"], c["cap"], cpu, limit)
        if detail:
            line += "   (%s)" % detail
        print(line, flush=True)
        if status == "crash" and err.strip():
            print("      " + err.strip().splitlines()[-1][:300])
            if "No module named" in err or "No such file" in err:
                print("      (the grader runs %s/ on its own: copy what solve.py needs, cube.py too, into %s/)" % (stage, stage))
        after = snapshot(alone)
        diff = sorted(k for k in set(before) | set(after) if before.get(k) != after.get(k))
        if diff:
            print("      warning: solve.py changed %s/ (%s). It is read-only when graded: write to /tmp instead." % (stage, ", ".join(diff[:5])))
            before = after
    return by_size


def report(stage, folder, by_size):
    """Per size: how many met the goal within the limits and the mean moves; then the folder's size."""
    for n in sorted(by_size):
        rows = by_size[n]
        met = [moves for _c, ok, moves in rows if ok]
        mean = lambda xs: sum(xs) / len(xs)  # noqa: E731
        best = mean([c.get("par_moves", c["ref_moves"]) for c, _ok, _m in rows])
        ours = mean([c["ref_moves"] for c, _ok, _m in rows])
        print("%2dx%-2d  %d of %d met the goal within the limits;  mean moves %s  (best so far %.0f, ours %.0f; scramble length %d)" % (
            n, n, len(met), len(rows), "%.1f" % mean(met) if met else "-", best, ours, 20 * (n - 2)))
    print("A cube scores scramble length / the moves of all three programs together (sizes weighted by N), and 0 if any of them fails on it.")
    size = gz_size(folder)
    print("%s/ is %d bytes gzipped (limit %d)%s" % (stage, size, BUNDLE_MAX, "  OVER THE LIMIT" if size > BUNDLE_MAX else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
