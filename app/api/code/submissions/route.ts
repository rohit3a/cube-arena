// Coding benchmark submissions (Authorization: Bearer <operator token or invite code>).
//   GET  /api/code/submissions?id=…                           one submission (its owner or the operator); operator: ?limit= lists recent ones
//   POST /api/code/submissions {model_id, effort, harness, credit}   start one (harness: claude-code or codex)
//   POST /api/code/submissions {id, alive: true}             heartbeat while the model codes
//   POST /api/code/submissions {id, usage, dev_minutes}      add a coding session's tokens and cost, set the coding time
//   POST /api/code/submissions {id, hidden, reason}          hide (owner or operator) or unhide (operator)
//   POST /api/code/submissions {id, requeue: true}           grade it again (operator)
// The solver itself goes up through /api/code/files.
import { authFrom, deny } from '@/lib/arena/auth';
import {
  codeGradingDetail,
  codeHeartbeat,
  createSubmission,
  getSubmission,
  listSubmissions,
  ownsSubmission,
  requeue,
  saveCoding,
  setCodeHidden,
  sweepCode,
} from '@/lib/arena/code';
import { ArenaError } from '@/lib/arena/service';

export const dynamic = 'force-dynamic';

const noSuch = () => Response.json({ error: 'no such submission' }, { status: 404 });

export async function GET(req: Request) {
  const { auth, bad } = await authFrom(req);
  if (!auth) return deny(bad);
  const q = new URL(req.url).searchParams;
  const id = q.get('id');
  if (!id) {
    if (auth.role !== 'operator') return deny();
    return Response.json({ submissions: await listSubmissions(Number(q.get('limit')) || 50) }, { headers: { 'Cache-Control': 'no-store' } });
  }
  const s = await getSubmission(id);
  if (!s || !ownsSubmission(auth, s)) return noSuch();
  const detail = auth.role === 'operator' && q.get('detail') === '1' ? await codeGradingDetail(id) : null;
  return Response.json({ submission: s, ...(detail && { detail }) }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: Request) {
  const { auth, bad } = await authFrom(req);
  if (!auth) return deny(bad);
  const body = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  try {
    if (typeof body.id !== 'string') {
      await sweepCode().catch(() => {});
      const submission = await createSubmission(auth, body, req.headers.get('user-agent')?.slice(0, 120) ?? null);
      return Response.json({ submission });
    }
    const s = await getSubmission(body.id);
    if (!s || !ownsSubmission(auth, s)) return noSuch();
    if (body.alive === true) return Response.json({ alive: await codeHeartbeat(s.id) });
    if (body.usage && typeof body.usage === 'object') {
      const u = body.usage as Record<string, unknown>;
      const usage = Object.fromEntries(
        ['input_tokens', 'cached_input_tokens', 'output_tokens', 'reasoning_tokens', 'cost_usd'].flatMap((k) => (Number.isFinite(u[k]) ? [[k, Number(u[k])]] : [])),
      );
      const minutes = Number.isFinite(body.dev_minutes) ? Number(body.dev_minutes) : null;
      return Response.json({ recorded: await saveCoding(s.id, usage, minutes) });
    }
    if (body.requeue === true) {
      if (auth.role !== 'operator') return deny();
      return Response.json({ requeued: await requeue(s.id) });
    }
    if (typeof body.hidden === 'boolean') {
      // An invitee may hide its own, never unhide.
      if (auth.role !== 'operator' && !body.hidden) return deny();
      const reason = typeof body.reason === 'string' ? body.reason.slice(0, 200) : null;
      return Response.json({ hidden: await setCodeHidden(s.id, body.hidden, reason) });
    }
    return Response.json({ error: 'nothing to do' }, { status: 400 });
  } catch (e) {
    if (e instanceof ArenaError) return Response.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
