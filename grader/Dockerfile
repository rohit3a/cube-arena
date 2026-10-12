# The coding benchmark's grading image: what SPEC.md promises a solver
# (Linux x86-64, Python 3.12, gcc/g++ 12, standard libraries only), plus the
# per-cube wrapper. Built on the ROG by scripts/code-worker.mjs:
#   docker build -t cube-arena-code:v1 grader/
FROM python:3.12-slim-bookworm
RUN apt-get update \
 && apt-get install -y --no-install-recommends gcc g++ make libc6-dev \
 && rm -rf /var/lib/apt/lists/*
COPY run_case.py /grade/run_case.py
WORKDIR /solver
