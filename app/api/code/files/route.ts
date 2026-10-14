// A submission's files.
//   POST /api/code/files?id=…&kind=bundle       the frozen solver: a gzipped tar of solver/ (owner or operator). Once.
//   POST /api/code/files?id=…&kind=transcript   the coding sessions' audit digest, gzipped JSON (owner or operator)
//   GET  /api/code/files?id=…&kind=bundle       the solver: anyone once it's graded and shown; the operator (the grader) always
//   GET  /api/code/files?id=…&kind=transcript   operator only
// A v2 submission's code goes up a stage at a time:
//   POST /api/code/files?id=…&kind=bundle&stage=centres[&minutes=…&nudged=1]   that stage's folder, gzipped tar. Once per stage;
//                                                                              queued for grading when all three are in.
//   GET  /api/code/files?id=…&kind=bundle&stage=centres                       the same rules as above
import { gunzipSync } from 'node:zlib';
import { authFrom, deny } from '@/lib/arena/auth';
import { codeFile, getSubmission, ownsSubmission, saveBundle, saveCodeTranscript } from '@/lib/arena/code';
import { isBench2, isStage } from '@/lib/arena/code2-rules';
import { saveStageBundle, stageBundle } from '@/lib/arena/code2';
import { ArenaError } from '@/lib/arena/service';

export const dynamic = 'force-dynamic';

const params = (req: Request): { id: string; kind: 'bundle' | 'transcript' | null } => {
  const q = new URL(req.url).searchParams;
  const kind = q.get('kind');
  return { id: q.get('id') ?? '', kind: kind === 'bundle' || kind === 'transcript' ? kind : null };
};

export async function GET(req: Request) {
  const { id, kind } = params(req);
  if (!kind) return Response.json({ error: 'kind must be bundle or transcript' }, { status: 400 });
  const s = await getSubmission(id);
  if (!s) return Response.json({ error: 'no such submission' }, { status: 404 });
  const { auth } = await authFrom(req);
  const open = kind === 'bundle' && s.status === 'graded' && !s.hidden;
  if (!open && auth?.role !== 'operator') return deny();
  const stage = new URL(req.url).searchParams.get('stage');
  if (kind === 'bundle' && isBench2(s.version) && !isStage(stage)) return Response.json({ error: 'a v2 bundle needs stage=centres, edges or finish' }, { status: 400 });
  const gz = kind === 'bundle' && isStage(stage) ? await stageBundle(id, stage) : await codeFile(id, kind);
  if (!gz) return Response.json({ error: `no ${kind} yet` }, { status: 404 });
  if (kind === 'transcript') return new Response(gunzipSync(gz), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  return new Response(new Uint8Array(gz), {
    headers: {
      'Content-Type': 'application/gzip',
      'Content-Disposition': `attachment; filename="cube-arena-${isStage(stage) ? stage : 'solver'}-${id.slice(0, 8)}.tar.gz"`,
      'Cache-Control': 'no-store',
    },
  });
}

export async function POST(req: Request) {
  const { auth, bad } = await authFrom(req);
  if (!auth) return deny(bad);
  const { id, kind } = params(req);
  if (!kind) return Response.json({ error: 'kind must be bundle or transcript' }, { status: 400 });
  const s = await getSubmission(id);
  if (!s || !ownsSubmission(auth, s)) return Response.json({ error: 'no such submission' }, { status: 404 });
  const gz = Buffer.from(await req.arrayBuffer());
  try {
    if (kind === 'bundle' && isBench2(s.version)) {
      const q = new URL(req.url).searchParams;
      const stage = q.get('stage');
      if (!isStage(stage)) return Response.json({ error: 'a v2 bundle needs stage=centres, edges or finish' }, { status: 400 });
      const minutes = Number(q.get('minutes'));
      const done = await saveStageBundle(id, stage, gz, q.get('minutes') !== null && Number.isFinite(minutes) ? minutes : null, q.get('nudged') === '1');
      return Response.json({ submission: { id, ...done } });
    }
    if (kind === 'bundle') {
      const done = await saveBundle(id, gz);
      return Response.json({ submission: { id: done.id, status: done.status, bundle_sha256: done.bundle_sha256, bundle_bytes: done.bundle_bytes } });
    }
    try {
      JSON.parse(gunzipSync(gz, { maxOutputLength: 40 * 1024 * 1024 }).toString('utf8'));
    } catch {
      return Response.json({ error: 'body must be gzipped JSON' }, { status: 400 });
    }
    return Response.json({ saved: await saveCodeTranscript(id, gz), bytes: gz.length });
  } catch (e) {
    if (e instanceof ArenaError) return Response.json({ error: e.message }, { status: e.code === 'too_big' ? 413 : 400 });
    throw e;
  }
}
