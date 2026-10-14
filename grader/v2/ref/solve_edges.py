"""Cube Arena v2 reference solver, stage 2: pair all 12 edges, centres kept solved.

    printf '6\n<state>\n' | python3 solve_edges.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import nxn  # noqa: E402


def solve(state):
    n = int(round((len(state) / 6) ** 0.5))
    geo = nxn.Geo(n)
    centres = nxn.Centres(geo)
    state = tuple(state)
    scheme = centres.scheme_for(state)
    moves, _ = nxn.Wings(geo, centres).solve(state, scheme)
    return [nxn.token(m) for m in geo.simplify(moves)]


if __name__ == "__main__":
    lines = sys.stdin.read().split()
    print(" ".join(solve(lines[1])))
