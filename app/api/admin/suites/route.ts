// Operator-only suite API (Authorization: Bearer CUBE_OPERATOR_TOKEN), used by runner/suite.mjs.
//   GET  /api/admin/suites?limit=50                 recent suites with their grades, and each kind's current version
//   GET  /api/admin/suites?id=…                     one suite
//   POST /api/admin/suites {kind, model_name, model, model_id, effort, agent}   create a Verified suite
//   POST /api/admin/suites {id, finish: true}       close it (tests never played count 0)
// Hiding a suite goes through /api/admin/runs with the suite id.
import { getSuite, listSuites } from '@/lib/arena/admin';
import { tokenMatches } from '@/lib/arena/mcp';
import { closeSuite, createSuite } from '@/lib/arena/service';
import { SUITES, SUITE_KINDS, type SuiteKind } from '@/lib/arena/suites';

export const dynamic = 'force-dynamic';

const authorized = (req: Request) => tokenMatches((req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, ''), process.env.CUBE_OPERATOR_TOKEN);
const deny = () => Response.json({ error: 'not allowed' }, { status: 401 });
const str = (v: unknown, max = 64) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

export async function GET(req: Request) {
  if (!authorized(req)) return deny();
  const q = new URL(req.url).searchParams;
  const id = q.get('id');
  if (id) {
    const suite = await getSuite(id);
    return suite ? Response.json({ suite, tests: SUITES[suite.kind].slots }) : Response.json({ error: 'no such suite' }, { status: 404 });
  }
  const limit = Math.min(500, Math.max(1, Number(q.get('limit')) || 50));
  const versions = Object.fromEntries(SUITE_KINDS.map((k) => [k, SUITES[k].version]));
  return Response.json({ suites: await listSuites(limit), versions }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: Request) {
  if (!authorized(req)) return deny();
  const body = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  if (body.finish === true) {
    const result = await closeSuite(str(body.id) ?? '');
    return result ? Response.json({ result, suite: await getSuite(str(body.id) ?? '') }) : Response.json({ error: 'no such suite' }, { status: 404 });
  }
  const kind = body.kind as SuiteKind;
  const modelName = str(body.model_name);
  if (!SUITE_KINDS.includes(kind) || !modelName) return Response.json({ error: 'kind (fast or thorough) and model_name are needed' }, { status: 400 });
  const suite = await createSuite(
    kind,
    { display: str(body.display_name, 32) ?? 'Cube Arena', model: modelName },
    { board: 'verified', ipHash: null, client: null },
    { model: str(body.model), model_id: str(body.model_id), effort: str(body.effort, 16), agent: str(body.agent, 16) },
  );
  return Response.json({ suite, tests: SUITES[kind].slots });
}
