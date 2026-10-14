"""Host-side helper for the v2 grader and case maker (trusted code, never in
the sandbox): applies an answer to a state and says where it leaves the cube.

    echo '{"state": "...", "moves": "R U ...", "stage": "centres"}' | python3 step.py
    -> {"ok": true, "state": "...", "moves": 12, "done": true}  or  {"ok": false, "error": "..."}
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cube  # noqa: E402

GOAL = {"centres": cube.centres_solved, "edges": cube.edges_paired, "finish": cube.is_solved}

req = json.load(sys.stdin)
try:
    n = cube.size(req["state"])
    end = cube.apply(req["state"], req["moves"], n)
    out = {"ok": True, "state": end, "moves": cube.count(req["moves"], n)}
    if req.get("stage"):
        out["done"] = GOAL[req["stage"]](end)
except Exception as e:  # an answer that isn't moves
    out = {"ok": False, "error": str(e)[:300]}
print(json.dumps(out))
