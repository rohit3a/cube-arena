// Approve or decline an application: the buttons on /apply/decide (the link in the operator's email).
//   POST /api/apply/decide (form: id, t, action=approve|decline)
import { decide } from '@/lib/arena/applications';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const form = await req.formData();
  const [id, t, action] = ['id', 't', 'action'].map((k) => String(form.get(k) ?? ''));
  const back = new URL(`/apply/decide?id=${encodeURIComponent(id)}&t=${encodeURIComponent(t)}`, req.url);
  if (action !== 'approve' && action !== 'decline') return Response.redirect(back, 303);
  try {
    await decide(id, t, action === 'approve');
  } catch (e) {
    console.error('decide failed', e);
    back.searchParams.set('failed', '1');
  }
  return Response.redirect(back, 303);
}
