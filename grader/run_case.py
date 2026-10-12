"""Runs solve.py on one cube inside the grading container and reports, as one
JSON line: what it printed, its exit code, whether it ran out of time, and
how long it took. The state comes on stdin; the time limit is argv[1].
"""

import json
import os
import signal
import subprocess
import sys
import time

MAX_OUT = 65536

limit = float(sys.argv[1])
state = sys.stdin.read()
start = time.perf_counter()
p = subprocess.Popen(
    ["python3", "solve.py"],
    cwd="/solver",
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
    start_new_session=True,
)
timed_out = False
try:
    out, err = p.communicate(state.encode(), timeout=limit)
except subprocess.TimeoutExpired:
    timed_out = True
    os.killpg(p.pid, signal.SIGKILL)
    out, err = p.communicate()
ms = (time.perf_counter() - start) * 1000
print(json.dumps({
    "stdout": out[:MAX_OUT].decode("utf-8", "replace"),
    "stderr": err[-2000:].decode("utf-8", "replace"),
    "exit_code": None if timed_out else p.returncode,
    "timed_out": timed_out,
    "ms": ms,
}))
