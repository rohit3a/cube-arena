"""Runs solve.py on one cube inside the grading container and reports, as one
JSON line: what it printed, its exit code, whether it ran past its CPU time,
and the CPU time it used. The input (N, then the state) comes on stdin; the
CPU-time limit in seconds is argv[1]; argv[2] and argv[3] (optional) are the
folder and the script (/solver and solve.py).

CPU time is read from the container's own cgroup, so it counts every process
the solver starts. Wall-clock time is capped too (a solver that sleeps or
waits), far above the CPU limit.
"""

import json
import os
import signal
import subprocess
import sys
import time

MAX_OUT = 512 * 1024


def cpu_usec():
    with open("/sys/fs/cgroup/cpu.stat") as f:
        for line in f:
            if line.startswith("usage_usec"):
                return int(line.split()[1])
    raise RuntimeError("no cgroup CPU accounting")


limit = float(sys.argv[1])
folder = sys.argv[2] if len(sys.argv) > 2 else "/solver"
script = sys.argv[3] if len(sys.argv) > 3 else "solve.py"
wall_limit = max(3 * limit, limit + 30)
data = sys.stdin.buffer.read()
base = cpu_usec()
start = time.perf_counter()
p = subprocess.Popen(
    ["python3", script],
    cwd=folder,
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
    start_new_session=True,
)
p.stdin.write(data)
p.stdin.close()
out = bytearray()
err = bytearray()
import selectors  # noqa: E402

sel = selectors.DefaultSelector()
sel.register(p.stdout, selectors.EVENT_READ, out)
sel.register(p.stderr, selectors.EVENT_READ, err)
timed_out = None
open_streams = 2
while open_streams:
    for key, _ in sel.select(timeout=0.02):
        chunk = os.read(key.fileobj.fileno(), 65536)
        if not chunk:
            sel.unregister(key.fileobj)
            open_streams -= 1
            continue
        buf = key.data
        if buf is out:
            if len(out) < MAX_OUT + 1:
                out += chunk
        else:
            err += chunk
            del err[:-4000]
    used = (cpu_usec() - base) / 1e6
    if timed_out is None and used > limit:
        timed_out = "cpu"
    elif timed_out is None and time.perf_counter() - start > wall_limit:
        timed_out = "wall"
    if timed_out:
        try:
            os.killpg(p.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        break
code = p.wait()
cpu_ms = (cpu_usec() - base) / 1000
try:
    os.killpg(p.pid, signal.SIGKILL)  # anything it left behind
except ProcessLookupError:
    pass
print(json.dumps({
    "stdout": out[:MAX_OUT].decode("utf-8", "replace"),
    "truncated": len(out) > MAX_OUT,
    "stderr": err[-2000:].decode("utf-8", "replace"),
    "exit_code": None if timed_out else code,
    "timed_out": timed_out,
    "cpu_ms": round(cpu_ms, 1),
    "wall_ms": round((time.perf_counter() - start) * 1000, 1),
}))
