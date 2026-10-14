"""Cube Arena v2 reference solver, stage 3: solve a reduced cube (parity first on even sizes).

    printf '6\n<state>\n' | python3 solve_finish.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import finish  # noqa: E402

solve = finish.solve

if __name__ == "__main__":
    lines = sys.stdin.read().split()
    print(" ".join(solve(lines[1])))
