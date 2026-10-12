// The grader's queue (operator only; scripts/code-worker.mjs on the ROG).
//   GET  /api/code/jobs                       take the next submission to grade: {job: {id, bundle_sha256, limits, cases}} or {job: null}
//   POST /api/code/jobs {id, grader, build, results}   what the solver printed for each hidden cube; graded here
//   POST /api/code/jobs {id, error}           the grader could not run it at all
// The solver's code comes from /api/code/files?kind=bundle.
import { authFrom, deny } from '@/lib/arena/auth';
import { type JobReport, failJob, finishJob, nextJob } from '@/lib/arena/code';
import { ArenaError } from '@/lib/arena/service';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const { auth, bad } = await authFrom(req);
  if (auth?.role !== 'operator') return deny(bad);
  return Response.json({ job: await nextJob() }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: Request) {
  const { auth, bad } = await authFrom(req);
  if (auth?.role !== 'operator') return deny(bad);
  const body = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const id = typeof body.id === 'string' ? body.id : '';
  if (typeof body.error === 'string') return Response.json({ failed: await failJob(id, body.error) });
  const build = body.build as JobReport['build'] | undefined;
  if (!build || typeof build.ok !== 'boolean' || !Array.isArray(body.results)) return Response.json({ error: 'need build and results' }, { status: 400 });
  const results = (body.results as Record<string, unknown>[]).flatMap((r) =>
    Number.isInteger(r.n)
      ? [{ n: r.n as number, stdout: String(r.stdout ?? ''), exit_code: Number.isInteger(r.exit_code) ? (r.exit_code as number) : null, timed_out: r.timed_out === true, ms: Number(r.ms) || 0 }]
      : [],
  );
  try {
    const s = await finishJob(id, { grader: String(body.grader ?? 'unknown'), build: { ok: build.ok, ms: Number(build.ms) || 0, log: String(build.log ?? '') }, results });
    return Response.json({ submission: s });
  } catch (e) {
    if (e instanceof ArenaError) return Response.json({ error: e.message }, { status: 409 });
    throw e;
  }
}
