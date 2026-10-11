// The invitee behind a code, for the runner (Authorization: Bearer <invite code>).
//   GET  /api/me                 {name, x_handle, profile}
//   POST /api/me {name?, x_handle?}  set the name on your results, and your X handle for the contributors board ("" clears it)
import { authFrom, deny } from '@/lib/arena/auth';
import { RESERVED_NAMES, contributorSlug, normalizeHandle, setHandle, setName } from '@/lib/arena/invites';
import { ArenaError, cleanName } from '@/lib/arena/service';
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
  const fail = (error: string, status = 400) => Response.json({ error }, { status });
  if (typeof body.name !== 'string' && typeof body.x_handle !== 'string') return fail('Send name, x_handle ("" clears it), or both.');
  let { name, x_handle: handle } = auth.invite;
  if (typeof body.name === 'string') {
    try {
      name = cleanName(body.name, 2, 32, 'Name');
    } catch (e) {
      if (e instanceof ArenaError) return fail(e.message);
      throw e;
    }
    if (RESERVED_NAMES.test(name)) return fail('Pick a different name.');
  }
  if (typeof body.x_handle === 'string') {
    handle = body.x_handle.trim() ? normalizeHandle(body.x_handle) : null;
    if (body.x_handle.trim() && !handle) return fail('That is not an X handle (letters, digits and _, up to 15).');
    if (!(await setHandle(auth.invite.id, handle))) return fail('Another invite already uses that handle.', 409);
  }
  if (name !== auth.invite.name) await setName(auth.invite.id, name);
  return Response.json({ name, x_handle: handle, profile: profile(auth.invite.id, handle) });
}
