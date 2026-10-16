// Writeups (lib/arena/writeups.ts), for the comms worker. Operator only.
//   GET  /api/admin/writeups?kind=round&subjects=<id>,<id>   what's stored for each subject: newest version, status, facts hash
//   POST /api/admin/writeups {kind, subject, body, status?, writer?, judge?, style?, drafts?, facts_hash?, problems?}
//                                                                 a new version (published unless status 'held')
//   POST /api/admin/writeups {kind, subject, version, withdraw: true}   take a version off the pages
import { authFrom, deny } from '@/lib/arena/auth';
import { WRITEUP_KINDS, type WriteupKind, saveWriteup, withdrawWriteup, writeupState } from '@/lib/arena/writeups';

export const dynamic = 'force-dynamic';

const kindOf = (v: unknown): WriteupKind | null => (WRITEUP_KINDS.includes(v as WriteupKind) ? (v as WriteupKind) : null);

export async function GET(req: Request) {
  const { auth, bad } = await authFrom(req);
  if (auth?.role !== 'operator') return deny(bad);
  const q = new URL(req.url).searchParams;
  const kind = kindOf(q.get('kind'));
  const subjects = (q.get('subjects') ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 500);
  if (!kind) return Response.json({ error: `kind is one of ${WRITEUP_KINDS.join(', ')}` }, { status: 400 });
  return Response.json({ state: await writeupState(kind, subjects) }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: Request) {
  const { auth, bad } = await authFrom(req);
  if (auth?.role !== 'operator') return deny(bad);
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const kind = kindOf(b?.kind);
  const subject = typeof b?.subject === 'string' ? b.subject.trim().slice(0, 100) : '';
  if (!kind || !subject) return Response.json({ error: 'kind and subject are required' }, { status: 400 });
  if (b?.withdraw === true) return Response.json({ withdrawn: await withdrawWriteup(kind, subject, Number(b.version)) });
  const body = typeof b?.body === 'string' ? b.body.trim() : '';
  if (!body || body.length > 20_000) return Response.json({ error: 'body is required (at most 20,000 characters)' }, { status: 400 });
  const str = (v: unknown) => (typeof v === 'string' ? v.slice(0, 200) : null);
  const version = await saveWriteup({
    kind,
    subject,
    body,
    status: b?.status === 'held' ? 'held' : 'published',
    writer: str(b?.writer),
    judge: str(b?.judge),
    style: str(b?.style),
    drafts: Number.isFinite(b?.drafts) ? Number(b?.drafts) : null,
    facts_hash: str(b?.facts_hash),
    problems: b?.problems ?? null,
  });
  return Response.json({ version });
}
