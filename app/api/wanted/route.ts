// The wanted list as JSON, for the runner's `wanted` command and anyone curious.
import { authFrom } from '@/lib/arena/auth';
import { wantedRows } from '@/lib/arena/wanted';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const { auth } = await authFrom(req);
  const { rows, thoroughModels } = await wantedRows(auth);
  return Response.json(
    {
      thorough_models: thoroughModels,
      rows: rows.map((r) => ({
        model_id: r.model.id,
        name: r.model.name,
        maker: r.model.maker,
        effort: r.effort,
        kind: r.kind,
        runs: r.runs,
        mean: r.mean,
        via: Object.keys(r.model.via),
        claim: r.claim,
        command: r.command,
        gauntlets: r.gauntlets,
      })),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
