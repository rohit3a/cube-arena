"""Runs your stage program the way the grader does, on the practice cubes.

    python3 check.py                 build (build.py, if there is one), then run every practice cube
    python3 check.py --sizes 4,5     only these sizes
    python3 check.py --cases 1       only the first cube of each size
    python3 check.py --no-build      skip the build (it already ran)

It prints, for each cube, whether the stage's goal is met, the moves against
the cap, the CPU time against the limit, and the case value; then the mean
value per size and the stage score (sizes weighted by N), as the grader
counts them. The grader does the same on hidden cubes, made the same way, on
a Linux machine (Python 3.12, gcc/g++ 12, one CPU core, 2 GB of memory, no
network), with your folder read-only while it solves.
"""

import argparse
import io
import json
import os
import resource
import subprocess
import sys
import tarfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import cube  # noqa: E402

BUILD_SECS = 600
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
    """(status, moves, value, detail) as the grader decides them."""
    if timed_out:
        return "timeout", None, 0.0, "over the CPU limit of %.1f s" % (case["cpu_limit_ms"] / 1000)
    if code != 0:
        return "crash", None, 0.0, "exit code %s" % code
    if len(out.encode()) > OUTPUT_MAX:
        return "over_cap", None, 0.0, "the answer is longer than the grader reads (%d bytes)" % OUTPUT_MAX
    try:
        end = cube.apply(state, out.strip(), n)
        moves = cube.count(out.strip(), n)
    except (cube.MoveError, ValueError) as e:
        return "illegal", None, 0.0, str(e)[:200]
    done, why = GOAL[stage]
    if not done(end):
        return "unsolved", moves, 0.0, why
    if moves > case["cap"]:
        return "over_cap", moves, 0.0, "%d moves, over the cap of %d" % (moves, case["cap"])
    return "solved", moves, 0.9 + 0.1 * min(1.0, case["ref_moves"] / max(1, moves)), None


def main():
    ap = argparse.ArgumentParser(description="Run your stage program on the practice cubes, as the grader would.")
    ap.add_argument("--sizes", default=None, help="only these sizes, e.g. 4,5")
    ap.add_argument("--cases", type=int, default=None, help="only the first N cubes of each size")
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
    if opt.cases:
        cases = [c for c in cases if c["case"] < opt.cases]

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

    before = snapshot(folder)
    by_size = {}
    for c in cases:
        n = c["n"]
        limit = c["cpu_limit_ms"] / 1000
        code, out, err, cpu, secs, timed_out = run([sys.executable, "solve.py"], folder, "%d\n%s\n" % (n, c["state"]), limit)
        status, moves, value, detail = grade(stage, n, c["state"], code, out, timed_out, c)
        by_size.setdefault(n, []).append(value)
        line = "%2dx%-2d #%d  %-8s %5s moves (cap %4d, ref %4d)  %6.2f s CPU (limit %4.1f)  value %.3f" % (
            n, n, c["case"], status, moves if moves is not None else "-", c["cap"], c["ref_moves"], cpu, limit, value)
        if detail:
            line += "   (%s)" % detail
        print(line, flush=True)
        if status == "crash" and err.strip():
            print("      " + err.strip().splitlines()[-1][:300])
        after = snapshot(folder)
        diff = sorted(k for k in set(before) | set(after) if before.get(k) != after.get(k))
        if diff:
            print("      warning: solve.py changed %s/ (%s). It is read-only when graded: write to /tmp instead." % (stage, ", ".join(diff[:5])))
            before = after

    print()
    num = den = 0.0
    for n in sorted(by_size):
        mean = sum(by_size[n]) / len(by_size[n])
        num += n * mean
        den += n
        print("%2dx%-2d  mean value %.3f  (%d of %d met the goal within the limits)" % (n, n, mean, sum(1 for v in by_size[n] if v > 0), len(by_size[n])))
    if den:
        print("stage score %.3f  (sizes weighted by N; 1.000 = every cube within the limits at or under our reference's moves)" % (num / den))
    size = gz_size(folder)
    print("%s/ is %d bytes gzipped (limit %d)%s" % (stage, size, BUNDLE_MAX, "  OVER THE LIMIT" if size > BUNDLE_MAX else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
