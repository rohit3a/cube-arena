// Claims on the wanted list.
//   GET  /api/claims                                          open claims (anyone)
//   POST /api/claims {model_id, effort, kind, credit?}        claim one for 24 hours (operator or invite)
//   POST /api/claims {id, release: true}                      let go of it
import { authFrom, deny } from '@/lib/arena/auth';
import { catalogModel } from '@/lib/arena/catalog';
import { ClaimTaken, claimFor, openClaims, releaseClaim } from '@/lib/arena/claims';
import { SUITE_KINDS, type SuiteKind } from '@/lib/arena/suites';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const { auth } = await authFrom(req);
  return Response.json({ claims: await openClaims(auth) }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: Request) {
  const { auth, bad } = await authFrom(req);
  if (!auth) return deny(bad);
  const body = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  if (body.release === true) return Response.json({ released: await releaseClaim(auth, String(body.id ?? '')) });
  const model = catalogModel(String(body.model_id ?? ''));
  const kind = body.kind as SuiteKind;
  const effort = typeof body.effort === 'string' && body.effort ? body.effort : null;
  if (!model || !SUITE_KINDS.includes(kind)) return Response.json({ error: 'model_id (from the catalog) and kind are needed' }, { status: 400 });
  if (model.efforts.length ? !effort || !model.efforts.includes(effort) : effort) {
    return Response.json({ error: `${model.name} takes effort ${model.efforts.join(', ') || '(none)'}` }, { status: 400 });
  }
  try {
    return Response.json({ claim: await claimFor(auth, { model_id: model.id, effort, kind, credit: body.credit === true }) });
  } catch (e) {
    if (e instanceof ClaimTaken) return Response.json({ error: e.message }, { status: 409 });
    throw e;
  }
}
