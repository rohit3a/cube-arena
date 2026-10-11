// Apply to be a Verified contributor (the form on /apply).
//   POST /api/apply {name, x_handle, email, note?, website?}   website is a trap field: people leave it empty
import { apply } from '@/lib/arena/applications';
import { ArenaError, hashIp } from '@/lib/arena/service';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const body = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  if (typeof body.website === 'string' && body.website.trim()) return Response.json({ ok: true });
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || req.headers.get('x-real-ip');
  try {
    await apply(body, hashIp(ip));
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof ArenaError) return Response.json({ error: e.message }, { status: 400 });
    console.error('apply failed', e);
    return Response.json({ error: 'Something went wrong sending your application. Please try again in a bit.' }, { status: 500 });
  }
}
