// Facts for the comms writer (lib/arena/comms-facts.ts). Operator only.
//   GET /api/admin/comms?suite=<id>    one suite down to each cube's part of the transcript
//   GET /api/admin/comms?model=<slug>  one model across its Verified suites, for its blog
//   GET /api/admin/comms?work=1        every suite with its runs and finished cubes, for the worker to find what's new
import { authFrom, deny } from '@/lib/arena/auth';
import { modelFacts, suiteFacts, workList } from '@/lib/arena/comms-facts';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const { auth, bad } = await authFrom(req);
  if (auth?.role !== 'operator') return deny(bad);
  const q = new URL(req.url).searchParams;
  if (q.get('work')) return Response.json({ suites: await workList() }, { headers: { 'Cache-Control': 'no-store' } });
  const suite = q.get('suite');
  const model = q.get('model');
  const facts = suite ? await suiteFacts(suite) : model ? await modelFacts(model) : null;
  if (!facts) return Response.json({ error: suite || model ? 'not found' : 'pass suite or model' }, { status: suite || model ? 404 : 400 });
  return Response.json(facts, { headers: { 'Cache-Control': 'no-store' } });
}
