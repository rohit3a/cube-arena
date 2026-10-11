// Applications to be a Verified contributor, operator only (Authorization: Bearer CUBE_OPERATOR_TOKEN).
// scripts/invite.mjs wraps these. Deciding here leaves the email's link working: it shows the outcome.
//   GET  /api/admin/applications[?all=1]           the waiting ones (all: every one), newest first
//   POST /api/admin/applications {id, approve}     approve (makes the invite, emails the code) or decline
import { decideById, listApplications } from '@/lib/arena/applications';
import { authFrom, deny } from '@/lib/arena/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const { auth, bad } = await authFrom(req);
  if (auth?.role !== 'operator') return deny(bad);
  const all = new URL(req.url).searchParams.get('all') === '1';
  return Response.json({ applications: await listApplications(all) }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: Request) {
  const { auth, bad } = await authFrom(req);
  if (auth?.role !== 'operator') return deny(bad);
  const body = ((await req.json().catch(() => null)) ?? {}) as { id?: unknown; approve?: unknown };
  if (typeof body.id !== 'string' || typeof body.approve !== 'boolean') return Response.json({ error: 'needs {id, approve: true|false}' }, { status: 400 });
  try {
    const app = await decideById(body.id, body.approve);
    return app ? Response.json({ application: app }) : Response.json({ error: 'no such application' }, { status: 404 });
  } catch (e) {
    console.error('decide failed', e);
    return Response.json({ error: `nothing changed: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 });
  }
}
