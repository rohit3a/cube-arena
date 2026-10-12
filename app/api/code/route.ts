// The coding benchmark's public kit: version, limits and the practice cubes
// (with their scrambles). The runner puts these in the model's workspace next
// to the spec, the reference cube and the checker under /code-kit/<version>/.
//   GET /api/code
import { CODE, practiceCases } from '@/lib/arena/code-rules';
import { SITE_URL } from '@/lib/site';

export function GET() {
  return Response.json(
    {
      version: CODE.version,
      limits: CODE,
      files: ['SPEC.md', 'cube.py', 'check.py'].map((f) => `${SITE_URL}/code-kit/${CODE.version}/${f}`),
      practice: practiceCases(),
    },
    { headers: { 'Cache-Control': 'public, max-age=300' } },
  );
}
