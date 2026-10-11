// The models Cube Arena can run (data/catalog.json, built by
// scripts/build-catalog.mjs): the exact name on the boards, the efforts each
// takes, and how to reach it. Invitee suites take their names from here, so a
// model is called the same thing whoever runs it.

import data from '../../data/catalog.json';

export type Harness = 'claude-code' | 'codex' | 'openrouter';
export const HARNESSES: Harness[] = ['claude-code', 'codex', 'openrouter'];

export interface CatalogModel {
  id: string;
  name: string;
  maker: string;
  released: string | null;
  /** Current on Artificial Analysis: what we ask people to run. */
  wanted: boolean;
  /** Effort levels, low to max; empty when the model has no effort setting. */
  efforts: string[];
  /** The model's id in each harness that can run it. */
  via: Partial<Record<Harness, string>>;
  /** USD per million tokens on OpenRouter. */
  price: { input: number | null; output: number | null; cached?: number | null } | null;
  aa: string | null;
}

export const CATALOG = data.models as CatalogModel[];
export const CATALOG_BUILT = data.built;

const byId = new Map(CATALOG.map((m) => [m.id, m]));
export const catalogModel = (id: string) => byId.get(id) ?? null;

/** "Claude Opus 5.5 (max)", or just the name for a model with no effort setting. */
export const labelOf = (m: CatalogModel, effort: string | null) => (effort ? `${m.name} (${effort})` : m.name);

/** A harness label for the boards: "via Claude Code", "via OpenRouter", "via api.x.ai". */
export function harnessLabel(harness: string | null): string | null {
  if (!harness) return null;
  if (harness === 'claude' || harness === 'claude-code') return 'Claude Code';
  if (harness === 'codex') return 'Codex';
  if (harness === 'openrouter') return 'OpenRouter';
  return harness.replace(/^api:/, '');
}

/** A run's cost at the model's OpenRouter list price, when we know it; null otherwise. */
export function catalogCost(modelId: string | null, u: { input_tokens?: number; cached_input_tokens?: number; output_tokens?: number }): number | null {
  const p = modelId ? catalogModel(modelId)?.price : null;
  if (!p || p.input === null || p.output === null || u.input_tokens === undefined || u.output_tokens === undefined) return null;
  const cached = u.cached_input_tokens ?? 0;
  return ((u.input_tokens - cached) * p.input + cached * (p.cached ?? p.input) + u.output_tokens * p.output) / 1e6;
}
