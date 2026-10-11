// Made-up index results for working on the charts locally:
// CUBE_DEMO_INDEX=1 npm run dev. Never used in production (index-data.ts checks).

import type { SuiteEntry } from './index-data';
import { makerOf } from './makers';
import { SUITES, type SuiteKind, suiteTests } from './suites';

const MODELS: [string, string, number][] = [
  ['Claude Opus 5.5', 'claude-opus-5-5', 46],
  ['Claude Fable 5.1', 'claude-fable-5-1', 41],
  ['GPT-6-Astra', 'gpt-6-astra', 39],
  ['GPT-6.1-Sol', 'gpt-6.1-sol', 33],
  ['Claude Sonnet 5.5', 'claude-sonnet-5-5', 30],
  ['GPT-6-Sol', 'gpt-6-sol', 26],
  ['Claude Opus 5', 'claude-opus-5', 24],
  ['GPT-5.6-Terra', 'gpt-5.6-terra', 17],
  ['Claude Haiku 5.5', 'claude-haiku-5-5', 12],
  ['GPT-6-Luna', 'gpt-6-luna', 8],
];
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

export function demoEntries(): SuiteEntry[] {
  const out: SuiteEntry[] = [];
  let n = 0;
  for (const kind of ['fast', 'thorough'] as SuiteKind[]) {
    for (const [model, slug, top] of MODELS) {
      if (kind === 'thorough' && top < 30) continue;
      for (const [i, effort] of EFFORTS.entries()) {
        if (kind === 'thorough' && effort !== 'max') continue;
        n += 1;
        const score = Math.max(0, top * (kind === 'thorough' ? 0.55 : 1) * (0.55 + 0.45 * (i / 4)) + ((n * 7) % 5) - 2);
        const tests = suiteTests(SUITES[kind]).map((t, j) => ({ test: t.test, score: Math.max(0, Math.min(100, score * (1.6 - j * 0.35))), played: t.slots.length, cubes: t.slots.length }));
        const maker = makerOf(model);
        const solved = Math.round(score / 4);
        const moves = solved * (8 + ((n * 13) % 9));
        out.push({
          id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
          kind,
          version: SUITES[kind].version,
          board: 'verified',
          label: `${model} (${effort})`,
          model,
          slug,
          effort,
          maker: maker.name,
          color: maker.color,
          display_name: 'Cube Arena',
          status: 'finished',
          created_at: new Date(Date.now() - n * 3_600_000).toISOString(),
          finished_at: new Date(Date.now() - n * 3_000_000).toISOString(),
          score,
          tests,
          moves,
          solved,
          moves_per_solve: solved ? moves / solved : null,
          secs: 600 + i * 420 + ((n * 97) % 600),
          input_tokens: 200_000 * (i + 1),
          output_tokens: 9_000 * (i + 1) ** 2,
          cost_usd: (slug.includes('opus') || slug.includes('astra') ? 0.9 : slug.includes('luna') || slug.includes('haiku') ? 0.03 : 0.25) * (i + 1),
          cost_estimated: slug.startsWith('gpt'),
          runs: [],
          progress: { started: tests.length, of: tests.length },
        });
      }
    }
  }
  return out;
}
