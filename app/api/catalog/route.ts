// The models Cube Arena can run, with their board names, efforts and how to
// reach each one. The runner reads this; data/catalog.json is the source.
import { CATALOG, CATALOG_BUILT } from '@/lib/arena/catalog';

export const dynamic = 'force-static';

export function GET() {
  return Response.json({ built: CATALOG_BUILT, models: CATALOG });
}
