// The models Cube Arena can run, with their board names, efforts and how to
// reach each one, and the runner's current version. The runner reads this;
// data/catalog.json is the source.
import { CATALOG, CATALOG_BUILT } from '@/lib/arena/catalog';
import { RUNNER_INSTALL, RUNNER_VERSION } from '@/lib/site';

export const dynamic = 'force-static';

export function GET() {
  // The current runner, so older copies can say there's a new one.
  return Response.json({ built: CATALOG_BUILT, models: CATALOG, runner: { version: RUNNER_VERSION, install: RUNNER_INSTALL } });
}
