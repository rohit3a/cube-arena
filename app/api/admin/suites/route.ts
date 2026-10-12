// Suite API for runners (Authorization: Bearer <operator token or invite code>).
// The operator sees and changes every suite; an invitee only its own.
//   GET  /api/admin/suites?limit=50                 recent suites with their grades, and each kind's current version
//   GET  /api/admin/suites?id=…                     one suite and its tests
//   POST /api/admin/suites {kind, model_id, effort, harness, credit}   create a Verified suite named from the catalog
//   POST /api/admin/suites {kind, model_name, model, model_id, effort, agent}   operator only: any name
//   POST /api/admin/suites {id, finish: true}       close it (hidden if a test is missing or stopped)
//   POST /api/admin/suites {id, alive: true}        heartbeat: the runner is still playing it (every few minutes)
// Hiding a suite goes through /api/admin/runs with the suite id.
import { getSuite, listSuites } from '@/lib/arena/admin';
import { type Auth, authFrom, deny } from '@/lib/arena/auth';
import { type Harness, HARNESSES, catalogModel, labelOf } from '@/lib/arena/catalog';
import { claimFor } from '@/lib/arena/claims';
import type { SuiteRow } from '@/lib/arena/db';
import { closeSuite, createSuite, heartbeat } from '@/lib/arena/service';
import { SUITES, SUITE_KINDS, type SuiteKind } from '@/lib/arena/suites';

export const dynamic = 'force-dynamic';

const str = (v: unknown, max = 64) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const owns = (auth: Auth, suite: SuiteRow) => auth.role === 'operator' || suite.invite_id === auth.invite.id;
const bad = (error: string) => Response.json({ error }, { status: 400 });
const noSuite = () => Response.json({ error: 'no such suite' }, { status: 404 });
const versions = () => Object.fromEntries(SUITE_KINDS.map((k) => [k, SUITES[k].version]));

export async function GET(req: Request) {
  const { auth, bad: badCode } = await authFrom(req);
  if (!auth) return deny(badCode);
  const q = new URL(req.url).searchParams;
  const id = q.get('id');
  if (id) {
    const suite = await getSuite(id);
    return suite && owns(auth, suite) ? Response.json({ suite, tests: SUITES[suite.kind].slots }) : noSuite();
  }
  const limit = Math.min(500, Math.max(1, Number(q.get('limit')) || 50));
  const suites = await listSuites(limit, auth.role === 'invite' ? auth.invite.id : undefined);
  const me = auth.role === 'invite' ? { role: 'invite', name: auth.invite.name } : { role: 'operator', name: 'Cube Arena' };
  return Response.json({ suites, versions: versions(), me }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: Request) {
  const { auth, bad: badCode } = await authFrom(req);
  if (!auth) return deny(badCode);
  const body = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;

  if (body.alive === true) {
    const suite = await getSuite(str(body.id) ?? '');
    if (!suite || !owns(auth, suite)) return noSuite();
    return Response.json({ alive: await heartbeat(suite.id) });
  }

  if (body.finish === true) {
    const suite = await getSuite(str(body.id) ?? '');
    if (!suite || !owns(auth, suite)) return noSuite();
    const result = await closeSuite(suite.id);
    return result ? Response.json({ result, suite: await getSuite(suite.id) }) : noSuite();
  }

  const kind = body.kind as SuiteKind;
  if (!SUITE_KINDS.includes(kind)) return bad('kind must be fast or thorough');
  const caller = { board: 'verified' as const, ipHash: null, client: str(req.headers.get('user-agent'), 120) };

  // The operator's runner may still name a model itself (models not in the catalog yet).
  if (auth.role === 'operator' && str(body.model_name)) {
    const suite = await createSuite(
      kind,
      { display: str(body.display_name, 32) ?? 'Cube Arena', model: str(body.model_name) as string },
      caller,
      { model: str(body.model), model_id: str(body.model_id), effort: str(body.effort, 16), agent: str(body.agent, 16), harness: str(body.harness, 64) },
    );
    return Response.json({ suite, tests: SUITES[kind].slots });
  }

  // Everyone else picks a catalog model, an effort it takes, and a way to reach it.
  const model = catalogModel(str(body.model_id) ?? '');
  if (!model) return bad('model_id is not in the catalog (GET /api/catalog lists them)');
  const effort = str(body.effort, 16);
  if (model.efforts.length ? !effort || !model.efforts.includes(effort) : effort) {
    return bad(model.efforts.length ? `${model.name} takes effort ${model.efforts.join(', ')}` : `${model.name} has no effort setting; leave it out`);
  }
  const harness = str(body.harness, 80) ?? '';
  const host = harness.startsWith('api:') ? harness.slice(4) : null;
  if (!(HARNESSES.includes(harness as Harness) && model.via[harness as Harness]) && !(host && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host))) {
    return bad(`harness must be one of ${Object.keys(model.via).join(', ')}, or api:<host> for another OpenAI-compatible API`);
  }
  const credit = auth.role === 'invite' && body.credit === true;
  const display = auth.role === 'operator' ? 'Cube Arena' : credit ? auth.invite.name.slice(0, 32).padEnd(2, '.') : 'Invited tester';
  const agent = harness === 'claude-code' ? 'claude' : harness === 'codex' ? 'codex' : harness === 'cursor' ? 'cursor' : harness === 'muse' ? 'muse' : 'api';
  const suite = await createSuite(kind, { display, model: labelOf(model, effort) }, caller, {
    model: model.name,
    model_id: model.id,
    effort,
    agent,
    harness,
    invite_id: auth.role === 'invite' ? auth.invite.id : null,
    credit,
  });
  // Starting a suite claims that model and effort, so nobody else starts the same one meanwhile.
  await claimFor(auth, { model_id: model.id, effort, kind, credit, suite_id: suite.id }).catch(() => null);
  return Response.json({ suite, tests: SUITES[kind].slots });
}
