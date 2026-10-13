import type { Metadata } from 'next';
import CompareView from '@/components/Compare';
import { averageByLabel } from '@/lib/arena/aggregate';
import { MAX_PICKS, type Pick, compare, compareOptions, parsePicks } from '@/lib/arena/compare';
import { suiteEntries, testNames } from '@/lib/arena/index-data';
import { fullEffort, suiteOrder } from '@/lib/arena/ranking';
import { SUITES } from '@/lib/arena/suites';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { searchParams: Promise<{ m?: string | string[] }> }): Promise<Metadata> {
  const picks = parsePicks((await props.searchParams).m);
  const options = picks.length ? await compareOptions() : [];
  const names = picks.map((p) => {
    const model = options.find((o) => o.slug === p.slug)?.model ?? p.slug;
    return p.effort ? `${model} (${p.effort})` : model;
  });
  return {
    title: names.length >= 2 ? `${names.join(' vs ')}` : 'Compare models',
    description: 'Put 2 to 4 models side by side: Index scores, every test and level, moves, time, cost, effort curves and the coding benchmark.',
  };
}

/** With nothing picked: the top two models on the Fast index. */
async function defaultPicks(): Promise<Pick[]> {
  const fast = (await suiteEntries()).filter((e) => e.kind === 'fast' && e.board === 'verified' && e.status === 'finished' && e.version === SUITES.fast.version);
  const { ranked } = fullEffort(averageByLabel(fast));
  const best = new Map<string, (typeof ranked)[number]>();
  for (const e of ranked.sort(suiteOrder)) if (!best.has(e.model)) best.set(e.model, e);
  return [...best.values()].slice(0, 2).map((e) => ({ slug: e.slug, effort: e.effort }));
}

export default async function ComparePage(props: { searchParams: Promise<{ m?: string | string[] }> }) {
  const asked = parsePicks((await props.searchParams).m);
  const picks = asked.length ? asked : await defaultPicks();
  const [sides, options] = await Promise.all([compare(picks), compareOptions()]);

  return (
    <div className="wrap page-head">
      <span className="kicker k-blue">Compare</span>
      <h1>Model vs model</h1>
      <p>
        Pick up to {MAX_PICKS} models, at one effort or their best, and see them side by side: the Index and every test, level by level on the same
        cubes, moves, time, tokens, cost, how effort changes them, and the coding benchmark. Every chart and card downloads as an image.
      </p>
      <CompareView sides={sides} options={options} fastTests={testNames('fast')} thoroughTests={testNames('thorough')} />
    </div>
  );
}
