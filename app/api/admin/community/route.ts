// Community results and their review, operator only (Authorization: Bearer CUBE_OPERATOR_TOKEN). The operator's
// poller uses these to say when a community run starts and to ask for a review when it ends.
//   GET  /api/admin/community[?since=ISO]          suites and one-off runs since then (default 30 days), each with its review link
//   GET  /api/admin/community?link=id1,id2         one review link for several results
//   POST /api/admin/community {ids, approve}       approve (on the boards) or decline (stays off them)
import { authFrom, deny } from '@/lib/arena/auth';
import { communityItems, reviewUrl, setReview } from '@/lib/arena/community';

export const dynamic = 'force-dynamic';

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function GET(req: Request) {
  const { auth, bad } = await authFrom(req);
  if (auth?.role !== 'operator') return deny(bad);
  const q = new URL(req.url).searchParams;
  const link = q.get('link');
  if (link) return json({ url: reviewUrl(link.split(',').filter(Boolean)) });
  const since = new Date(q.get('since') ?? Date.now() - 30 * 86_400_000);
  if (Number.isNaN(since.getTime())) return json({ error: 'since must be an ISO date' }, 400);
  const items = await communityItems(since);
  return json({ items: items.map((x) => ({ ...x, review_url: reviewUrl([x.id]) })) });
}

export async function POST(req: Request) {
  const { auth, bad } = await authFrom(req);
  if (auth?.role !== 'operator') return deny(bad);
  const body = ((await req.json().catch(() => null)) ?? {}) as { ids?: unknown; approve?: unknown };
  if (!Array.isArray(body.ids) || !body.ids.every((x) => typeof x === 'string') || typeof body.approve !== 'boolean') {
    return json({ error: 'needs {ids: [...], approve: true|false}' }, 400);
  }
  return json({ changed: await setReview(body.ids as string[], body.approve) });
}
