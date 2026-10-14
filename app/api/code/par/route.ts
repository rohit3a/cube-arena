// Coding v2's par (operator only; scripts/code2-par.mjs on the ROG).
//   GET  /api/code/par                      the graded v2 submissions: {ids}
//   POST /api/code/par {set: true}          set each hidden cube's par from the graded runs (refused once set, unless replace: true)
//   POST /api/code/par {rescore: id}        value that submission's cases again against the pars: {id, before, after}
import { authFrom, deny } from '@/lib/arena/auth';
import { graded2, rescore2, setPars2 } from '@/lib/arena/code2';
import { ArenaError } from '@/lib/arena/service';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
  const { auth, bad } = await authFrom(req);
  if (auth?.role !== 'operator') return deny(bad);
  return Response.json({ ids: await graded2() }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: Request) {
  const { auth, bad } = await authFrom(req);
  if (auth?.role !== 'operator') return deny(bad);
  const body = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  try {
    if (body.set === true) return Response.json(await setPars2({ replace: body.replace === true }));
    if (typeof body.rescore === 'string') return Response.json(await rescore2(body.rescore));
    return Response.json({ error: 'say set or rescore' }, { status: 400 });
  } catch (e) {
    if (e instanceof ArenaError) return Response.json({ error: e.message }, { status: 409 });
    throw e;
  }
}
