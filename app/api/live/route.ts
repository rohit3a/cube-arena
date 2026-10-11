import { liveAttempts } from '@/lib/arena/board';

export const dynamic = 'force-dynamic';

export async function GET() {
  // `at` lets the page ignore a copy older than the one it shows.
  const at = Date.now();
  const items = await liveAttempts();
  // Browsers always ask again; the CDN answers everyone from one copy for a few seconds.
  return Response.json({ at, items }, { headers: { 'Cache-Control': 'no-store', 'CDN-Cache-Control': 'max-age=3' } });
}
