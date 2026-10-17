// Approve or decline community results: the buttons on /community/review (the link the operator is sent).
//   POST /api/community/review (form: ids, t, action=approve|decline, only=<one of the ids>)
import { reviewIds, setReview } from '@/lib/arena/community';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const form = await req.formData();
  const [ids, t, action, only] = ['ids', 't', 'action', 'only'].map((k) => String(form.get(k) ?? ''));
  const back = new URL(`/community/review?ids=${encodeURIComponent(ids)}&t=${encodeURIComponent(t)}`, req.url);
  const allowed = reviewIds(ids, t);
  if (!allowed || (action !== 'approve' && action !== 'decline') || (only && !allowed.includes(only))) return Response.redirect(back, 303);
  try {
    await setReview(only ? [only] : allowed, action === 'approve');
  } catch (e) {
    console.error('review failed', e);
    back.searchParams.set('failed', '1');
  }
  return Response.redirect(back, 303);
}
