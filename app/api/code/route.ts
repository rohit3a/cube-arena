// The coding benchmark's public kit: version, limits and the practice cubes
// (with their scrambles). The runner puts these in the model's workspace next
// to the spec, the reference cube and the checker under /code-kit/<version>/.
//   GET /api/code                              v1
//   GET /api/code?version=v2&stage=centres     a v2 bench's stage (v2 or v2-mini; centres, edges or finish):
//                                              its limits and the kit files (practice cubes in practice.json)
import { CODE, practiceCases } from '@/lib/arena/code-rules';
import { isBench2, isStage, limits2 } from '@/lib/arena/code2-rules';
import { SITE_URL } from '@/lib/site';

export function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const version = q.get('version');
  const cache = { headers: { 'Cache-Control': 'public, max-age=300' } };
  if (version && version !== CODE.version) {
    const stage = q.get('stage');
    if (!isBench2(version) || !isStage(stage)) return Response.json({ error: 'version must be v1, v2 or v2-mini; a v2 kit needs stage=centres, edges or finish' }, { status: 400 });
    const limits = limits2(version);
    return Response.json(
      {
        version,
        stage,
        minutes: limits.minutes[stage],
        limits,
        files: ['SPEC.md', 'cube.py', 'check.py', 'practice.json'].map((f) => `${SITE_URL}/code-kit/${version}/${stage}/${f}`),
      },
      cache,
    );
  }
  return Response.json(
    {
      version: CODE.version,
      limits: CODE,
      files: ['SPEC.md', 'cube.py', 'check.py'].map((f) => `${SITE_URL}/code-kit/${CODE.version}/${f}`),
      practice: practiceCases(),
    },
    cache,
  );
}
