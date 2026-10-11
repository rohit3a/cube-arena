// Invites, operator only (Authorization: Bearer CUBE_OPERATOR_TOKEN). scripts/invite.mjs wraps these.
//   GET  /api/admin/invites                                   every invite, with how many suites each ran
//   POST /api/admin/invites {name, note?, expires_at?}        make one; the reply has the code (shown only now)
//   POST /api/admin/invites {id, rotate: true}                a new code for the same person
//   POST /api/admin/invites {id, revoke: true, hide?: true}   stop the code; hide: also hide everything it ran
//   POST /api/admin/invites {id, x_handle}                    set their X handle ("" clears it)
import { createInvite, listInvites, revokeInvite, rotateInvite } from '@/lib/arena/admin';
import { authFrom, deny } from '@/lib/arena/auth';
import { UUID } from '@/lib/arena/db';
import { normalizeHandle, setHandle } from '@/lib/arena/invites';

export const dynamic = 'force-dynamic';

const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

export async function GET(req: Request) {
  const { auth, bad } = await authFrom(req);
  if (auth?.role !== 'operator') return deny(bad);
  return Response.json({ invites: await listInvites() }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: Request) {
  const { auth, bad } = await authFrom(req);
  if (auth?.role !== 'operator') return deny(bad);
  const body = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const id = str(body.id, 64);
  if (id && body.rotate === true) {
    const code = await rotateInvite(id);
    return code ? Response.json({ code }) : Response.json({ error: 'no such invite' }, { status: 404 });
  }
  if (id && body.revoke === true) {
    const hidden = await revokeInvite(id, body.hide === true);
    return hidden === null ? Response.json({ error: 'no such invite' }, { status: 404 }) : Response.json({ revoked: true, suites_hidden: hidden });
  }
  if (id && typeof body.x_handle === 'string') {
    const handle = body.x_handle.trim() ? normalizeHandle(body.x_handle) : null;
    if (body.x_handle.trim() && !handle) return Response.json({ error: 'not an X handle' }, { status: 400 });
    if (!UUID.test(id)) return Response.json({ error: 'no such invite' }, { status: 404 });
    return (await setHandle(id, handle)) ? Response.json({ x_handle: handle }) : Response.json({ error: 'another invite has that handle' }, { status: 409 });
  }
  const name = str(body.name, 40);
  if (!name) return Response.json({ error: 'name is needed (who the code is for)' }, { status: 400 });
  const expires = str(body.expires_at, 40);
  const expiresAt = expires ? new Date(expires) : null;
  if (expiresAt && Number.isNaN(expiresAt.getTime())) return Response.json({ error: 'expires_at must be a date' }, { status: 400 });
  return Response.json(await createInvite(name, str(body.note, 200), expiresAt));
}
