// What still needs running: every current catalog model at every effort it
// takes, with how many Verified suites it has and who has claimed it.
// Thorough is only asked of the best models on Fast, at their top effort.

import type { Auth } from './auth';
import { CATALOG, type CatalogModel } from './catalog';
import { type Claim, openClaims } from './claims';
import { type SuiteEntry, suiteEntries } from './index-data';
import { SUITES, type SuiteKind } from './suites';

export const THOROUGH_TOP = 5;

export interface WantedRow {
  model: CatalogModel;
  effort: string | null;
  kind: SuiteKind;
  /** Finished, visible Verified suites of the current version. */
  runs: number;
  mean: number | null;
  claim: Claim | null;
  command: string;
}

export const commandFor = (id: string, effort: string | null, kind: SuiteKind) =>
  `npx cube-arena-runner play --model ${id}${effort ? ` --effort ${effort}` : ''}${kind === 'thorough' ? ' --suite thorough' : ''}`;

const key = (id: string, effort: string | null, kind: SuiteKind) => `${id}|${effort ?? ''}|${kind}`;

export async function wantedRows(auth: Auth | null = null): Promise<{ rows: WantedRow[]; thoroughModels: string[] }> {
  const [entries, claims] = await Promise.all([suiteEntries(), openClaims(auth)]);
  const done = new Map<string, SuiteEntry[]>();
  for (const e of entries) {
    if (e.board !== 'verified' || e.status !== 'finished' || e.version !== SUITES[e.kind].version) continue;
    const k = key(e.slug, e.effort, e.kind);
    done.set(k, [...(done.get(k) ?? []), e]);
  }
  const claimOf = new Map(claims.map((c) => [key(c.model_id, c.effort, c.kind), c]));
  const row = (model: CatalogModel, effort: string | null, kind: SuiteKind): WantedRow => {
    const es = done.get(key(model.id, effort, kind)) ?? [];
    const mean = es.length ? es.reduce((a, e) => a + (e.score ?? 0), 0) / es.length : null;
    return { model, effort, kind, runs: es.length, mean, claim: claimOf.get(key(model.id, effort, kind)) ?? null, command: commandFor(model.id, effort, kind) };
  };

  const wanted = CATALOG.filter((m) => m.wanted);
  const fast = wanted.flatMap((m) => (m.efforts.length ? m.efforts : [null]).map((e) => row(m, e, 'fast')));

  // Thorough: the models with the best Fast mean at any effort, at their top effort.
  const best = new Map<string, number>();
  for (const r of fast) if (r.mean !== null) best.set(r.model.id, Math.max(best.get(r.model.id) ?? 0, r.mean));
  const top = [...best].sort((a, b) => b[1] - a[1]).slice(0, THOROUGH_TOP).map(([id]) => id);
  const thorough = wanted.filter((m) => top.includes(m.id)).map((m) => row(m, m.efforts.at(-1) ?? null, 'thorough'));
  return { rows: [...fast, ...thorough], thoroughModels: top };
}
