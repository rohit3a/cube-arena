// The invitee behind a code, for the runner (Authorization: Bearer <invite code>).
//   GET  /api/me                 {name, x_handle, profile}
//   POST /api/me {x_handle}      set your X handle for the contributors board ("" clears it)
import { authFrom, deny } from '@/lib/arena/auth';
import { contributorSlug, normalizeHandle, setHandle } from '@/lib/arena/invites';
import { SITE_URL } from '@/lib/site';

export const dynamic = 'force-dynamic';

const profile = (id: string, handle: string | null) => `${SITE_URL}/contributors/${contributorSlug(id, handle)}`;

export async function GET(req: Request) {
  const { auth, bad } = await authFrom(req);
  if (!auth) return deny(bad);
  if (auth.role === 'operator') return Response.json({ role: 'operator', name: 'Cube Arena', x_handle: null, profile: null });
  const { id, name, x_handle } = auth.invite;
  return Response.json({ role: 'invite', name, x_handle, profile: profile(id, x_handle) }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: Request) {
  const { auth, bad } = await authFrom(req);
  if (!auth) return deny(bad);
  if (auth.role !== 'invite') return Response.json({ error: 'only an invite code has a profile' }, { status: 400 });
  const body = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  if (typeof body.x_handle !== 'string') return Response.json({ error: 'x_handle is needed ("" clears it)' }, { status: 400 });
  const handle = body.x_handle.trim() ? normalizeHandle(body.x_handle) : null;
  if (body.x_handle.trim() && !handle) return Response.json({ error: 'That is not an X handle (letters, digits and _, up to 15).' }, { status: 400 });
  if (!(await setHandle(auth.invite.id, handle))) return Response.json({ error: 'Another invite already uses that handle.' }, { status: 409 });
  return Response.json({ name: auth.invite.name, x_handle: handle, profile: profile(auth.invite.id, handle) });
}
