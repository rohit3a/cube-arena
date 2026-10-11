// Audit transcripts: a gzipped JSON digest of one test session (what the model
// said and every tool call, no pictures).
//   POST /api/admin/transcripts?run_id=…   body: the gzip bytes. Operator, or the invitee whose suite it is.
//   GET  /api/admin/transcripts?run_id=…   the digest as JSON. Operator only.
import { gunzipSync } from 'node:zlib';
import { TRANSCRIPT_MAX_BYTES, getTranscript, saveTranscript, suiteOf } from '@/lib/arena/admin';
import { authFrom, deny } from '@/lib/arena/auth';

export const dynamic = 'force-dynamic';

const runIdOf = (req: Request) => new URL(req.url).searchParams.get('run_id') ?? '';

export async function GET(req: Request) {
  const { auth, bad } = await authFrom(req);
  if (auth?.role !== 'operator') return deny(bad);
  const gz = await getTranscript(runIdOf(req));
  if (!gz) return Response.json({ error: 'no transcript for that run' }, { status: 404 });
  return new Response(gunzipSync(gz), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

export async function POST(req: Request) {
  const { auth, bad } = await authFrom(req);
  if (!auth) return deny(bad);
  const runId = runIdOf(req);
  const owner = await suiteOf(runId);
  if (!owner || (auth.role === 'invite' && owner.inviteId !== auth.invite.id)) return Response.json({ error: 'not your run' }, { status: 403 });
  const gz = Buffer.from(await req.arrayBuffer());
  if (gz.length > TRANSCRIPT_MAX_BYTES) return Response.json({ error: `transcript over ${TRANSCRIPT_MAX_BYTES} bytes gzipped` }, { status: 413 });
  try {
    JSON.parse(gunzipSync(gz, { maxOutputLength: 20 * 1024 * 1024 }).toString('utf8'));
  } catch {
    return Response.json({ error: 'body must be gzipped JSON' }, { status: 400 });
  }
  return Response.json({ saved: await saveTranscript(runId, gz), bytes: gz.length });
}
