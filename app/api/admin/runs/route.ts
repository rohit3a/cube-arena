// Run API (Authorization: Bearer <operator token or invite code>).
//   GET  /api/admin/runs?limit=50&hidden=1      recent runs (or only hidden ones)            operator
//   POST /api/admin/runs {id, hidden, reason}   hide or unhide a run (run id or attempt id)   operator; an invitee may hide its own
//   POST /api/admin/runs {id, stop: true, reason} end an active run now, as a timeout        operator, or the invitee whose suite it is
//   POST /api/admin/runs {id, model_name}        fix a run's model name                       operator
//   POST /api/admin/runs {id, usage}             record the tokens and cost the runner measured   operator, or its invitee
// Hiding a run that belongs to a suite (or passing a suite id) hides the whole suite.
// scripts/moderate.mjs wraps these. Boards refresh within ~30 s (their cache).
import { listRuns, rename, setHidden, setUsage, suiteOf } from '@/lib/arena/admin';
import { authFrom, deny } from '@/lib/arena/auth';
import { stopRun } from '@/lib/arena/service';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const { auth, bad } = await authFrom(req);
  if (auth?.role !== 'operator') return deny(bad);
  const q = new URL(req.url).searchParams;
  const limit = Math.min(500, Math.max(1, Number(q.get('limit')) || 50));
  return Response.json({ runs: await listRuns(limit, q.get('hidden') === '1') }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: Request) {
  const { auth, bad } = await authFrom(req);
  if (!auth) return deny(bad);
  const body = (await req.json().catch(() => null)) as { id?: unknown; hidden?: unknown; stop?: unknown; reason?: unknown; model_name?: unknown; usage?: unknown } | null;
  const id = typeof body?.id === 'string' ? body.id.trim() : '';
  const reason = typeof body?.reason === 'string' ? body.reason.slice(0, 200) : null;
  // An invitee's runner may end, annotate or hide (never unhide or rename) runs in its own suites.
  if (auth.role === 'invite') {
    const owner = await suiteOf(id);
    const allowed = owner?.inviteId === auth.invite.id && (body?.stop === true || !!body?.usage || body?.hidden === true);
    if (!allowed) return Response.json({ error: 'not allowed' }, { status: 403 });
  }
  if (body?.stop === true) return Response.json({ stopped: await stopRun(id, reason ?? 'stopped by the operator') });
  if (body?.usage && typeof body.usage === 'object') {
    const u = body.usage as Record<string, unknown>;
    const usage = Object.fromEntries(
      ['input_tokens', 'cached_input_tokens', 'output_tokens', 'reasoning_tokens', 'cost_usd'].flatMap((k) => (Number.isFinite(u[k]) ? [[k, Number(u[k])]] : [])),
    );
    return Response.json({ recorded: await setUsage(id, usage) });
  }
  const name = typeof body?.model_name === 'string' ? body.model_name.trim().slice(0, 80) : '';
  const run = name ? await rename(id, name) : await setHidden(id, body?.hidden !== false, reason);
  if (!run) return Response.json({ error: 'no run or attempt with that id' }, { status: 404 });
  return Response.json({ run });
}
