"""Cube Arena v2 reference solver, stage 1: solve every face's centre.

    printf '6\n<state>\n' | python3 solve_centres.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import nxn  # noqa: E402


def solve(state):
    n = int(round((len(state) / 6) ** 0.5))
    geo = nxn.Geo(n)
    moves, _, _ = nxn.Centres(geo).solve(tuple(state))
    return [nxn.token(m) for m in geo.simplify(moves)]


if __name__ == "__main__":
    lines = sys.stdin.read().split()
    print(" ".join(solve(lines[1])))
