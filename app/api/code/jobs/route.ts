// The grader's queue (operator only; scripts/code-worker.mjs and code2-worker.mjs on the ROG).
//   GET  /api/code/jobs                       take the next submission to grade: {job: {id, bundle_sha256, limits, cases}} or {job: null}
//   POST /api/code/jobs {id, grader, build, results}   what the solver printed for each hidden cube; graded here
//   POST /api/code/jobs {id, error}           the grader could not run it at all
// The solver's code comes from /api/code/files?kind=bundle.
// v2 (the NxN ladder):
//   GET  /api/code/jobs?version=v2            the next v2 or v2-mini submission: {job: {id, version, limits, bundles, cases}} or {job: null}
//   POST /api/code/jobs {id, results: [...]}  a batch of runs ({part, n, case_no, run} or, end to end, {part: 'e2e', n, case_no, runs, inputs}); graded here
//   POST /api/code/jobs {id, done: true, grader, builds}   all posted: the rest count 0, the score is added up
import { authFrom, deny } from '@/lib/arena/auth';
import { type JobReport, failJob, finishJob, getSubmission, nextJob } from '@/lib/arena/code';
import { type Build2, type Report2, finishJob2, nextJob2, saveResults2 } from '@/lib/arena/code2';
import { PARTS, type Run2 } from '@/lib/arena/code2-rules';
import { ArenaError } from '@/lib/arena/service';
import type { Stage } from '@/lib/cube/stages';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
  const { auth, bad } = await authFrom(req);
  if (auth?.role !== 'operator') return deny(bad);
  const v2 = new URL(req.url).searchParams.get('version') === 'v2';
  return Response.json({ job: v2 ? await nextJob2() : await nextJob() }, { headers: { 'Cache-Control': 'no-store' } });
}

const run2 = (r: unknown): Run2 & { stderr: string } => {
  const o = (r ?? {}) as Record<string, unknown>;
  return {
    stdout: String(o.stdout ?? ''),
    stderr: String(o.stderr ?? ''),
    exit_code: Number.isInteger(o.exit_code) ? (o.exit_code as number) : null,
    timed_out: typeof o.timed_out === 'string' ? o.timed_out.slice(0, 8) : o.timed_out === true,
    cpu_ms: Number(o.cpu_ms) || 0,
    truncated: o.truncated === true,
  };
};

async function v2(id: string, body: Record<string, unknown>) {
  if (body.done === true) {
    const builds = (body.builds ?? {}) as Record<string, Partial<Build2> | undefined>;
    const clean = Object.fromEntries(
      Object.entries(builds).flatMap(([st, b]) => (b && typeof b.ok === 'boolean' ? [[st, { ok: b.ok, ms: Number(b.ms) || 0, log: String(b.log ?? '') }]] : [])),
    );
    return Response.json({ submission: await finishJob2(id, String(body.grader ?? 'unknown'), clean) });
  }
  const reports: Report2[] = (body.results as Record<string, unknown>[]).flatMap((r): Report2[] => {
    if (!PARTS.includes(r.part as never) || !Number.isInteger(r.n) || !Number.isInteger(r.case_no)) return [];
    const at = { n: r.n as number, case_no: r.case_no as number };
    if (r.part === 'e2e') {
      if (!Array.isArray(r.runs) || !Array.isArray(r.inputs)) return [];
      return [{ part: 'e2e', ...at, runs: r.runs.map(run2), inputs: r.inputs.map(String) }];
    }
    return [{ part: r.part as Stage, ...at, run: run2(r.run) }];
  });
  return Response.json({ saved: await saveResults2(id, reports) });
}

export async function POST(req: Request) {
  const { auth, bad } = await authFrom(req);
  if (auth?.role !== 'operator') return deny(bad);
  const body = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const id = typeof body.id === 'string' ? body.id : '';
  if (typeof body.error === 'string') return Response.json({ failed: await failJob(id, body.error) });
  try {
    if (body.done === true || (Array.isArray(body.results) && !body.build)) {
      if (!(await getSubmission(id))) return Response.json({ error: 'no such submission' }, { status: 404 });
      return await v2(id, body);
    }
    const build = body.build as JobReport['build'] | undefined;
    if (!build || typeof build.ok !== 'boolean' || !Array.isArray(body.results)) return Response.json({ error: 'need build and results' }, { status: 400 });
    const results = (body.results as Record<string, unknown>[]).flatMap((r) =>
      Number.isInteger(r.n)
        ? [{ n: r.n as number, stdout: String(r.stdout ?? ''), exit_code: Number.isInteger(r.exit_code) ? (r.exit_code as number) : null, timed_out: r.timed_out === true, ms: Number(r.ms) || 0 }]
        : [],
    );
    const s = await finishJob(id, { grader: String(body.grader ?? 'unknown'), build: { ok: build.ok, ms: Number(build.ms) || 0, log: String(build.log ?? '') }, results });
    return Response.json({ submission: s });
  } catch (e) {
    if (e instanceof ArenaError) return Response.json({ error: e.message }, { status: 409 });
    throw e;
  }
}
