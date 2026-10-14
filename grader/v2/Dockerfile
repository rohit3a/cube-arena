# Grading image for coding v2: what SPEC.md promises a solver (Linux x86-64,
# Python 3.12, gcc/g++ 12, standard libraries only), the per-case wrapper
# that limits CPU time, the cube engine, and our reference solvers (used to
# make the cases). Built on the ROG:  docker build -t cube-arena-code:v2 grader/v2
FROM python:3.12-slim-bookworm
RUN apt-get update \
 && apt-get install -y --no-install-recommends gcc g++ make libc6-dev \
 && rm -rf /var/lib/apt/lists/*
COPY run_stage.py cube.py /grade/
COPY ref/nxn.py ref/finish.py ref/solve_centres.py ref/solve_edges.py ref/solve_finish.py /ref/
COPY cube.py /ref/cube.py
WORKDIR /solver
