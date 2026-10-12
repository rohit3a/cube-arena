// Only the newest runner is packed into public/runner/. A link to an older one
// (in an old email or post) lands here instead and is sent to the current one.
import { RUNNER_URL } from '@/lib/site';

export async function GET(_req: Request, props: { params: Promise<{ file: string }> }) {
  const { file } = await props.params;
  if (!/^cube-arena-runner-\d+\.\d+\.\d+\.tgz$/.test(file)) return new Response('Not found', { status: 404 });
  return Response.redirect(RUNNER_URL, 302);
}
