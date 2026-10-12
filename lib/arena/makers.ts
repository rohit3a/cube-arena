// Who makes a model, its chart colour, and what it costs to run.

export interface Maker {
  name: string;
  /** A CSS colour (a palette variable), the same for every model by this maker. */
  color: string;
}

const MAKERS: [RegExp, Maker][] = [
  [/^claude|anthropic/i, { name: 'Anthropic', color: 'var(--orange)' }],
  [/^(gpt|o\d|chatgpt|openai)/i, { name: 'OpenAI', color: 'var(--green)' }],
  [/^gemini|google/i, { name: 'Google', color: 'var(--blue)' }],
  [/^grok|xai/i, { name: 'xAI', color: 'var(--red)' }],
  [/^(llama|muse|meta)/i, { name: 'Meta', color: 'var(--purple)' }],
  [/^deepseek/i, { name: 'DeepSeek', color: 'var(--teal)' }],
  [/^qwen/i, { name: 'Alibaba', color: 'var(--pink)' }],
  [/^(mistral|magistral|codestral)/i, { name: 'Mistral', color: 'var(--yellow)' }],
  [/^kimi/i, { name: 'Moonshot', color: 'var(--slate)' }],
  [/^(composer|cursor)/i, { name: 'Cursor', color: 'var(--text)' }],
];

export function makerOf(model: string): Maker {
  for (const [re, m] of MAKERS) if (re.test(model.trim())) return m;
  return { name: 'Other', color: 'var(--slate)' };
}

/** "GPT-6-Luna (max)" → { model: "GPT-6-Luna", effort: "max" }. */
export function splitLabel(label: string): { model: string; effort: string | null } {
  const m = label.match(/^(.*?)\s*\((low|medium|high|xhigh|max|ultra|default effort)\)$/i);
  return m ? { model: m[1], effort: m[2].toLowerCase() } : { model: label, effort: null };
}

export const slugOf = (model: string) =>
  model
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/\./g, '-')
    .replace(/^-|-$/g, '');

export const EFFORT_ORDER = ['low', 'medium', 'high', 'xhigh', 'max'];
export const effortRank = (e: string | null) => (e === null ? -1 : EFFORT_ORDER.indexOf(e));

/**
 * API prices in USD per million tokens, for models whose CLI reports tokens
 * but no cost (Codex). Claude Code reports its own API-equivalent cost.
 * Sources: published API price lists as of October 2026; update when they change.
 */
const PRICES: Record<string, { input: number; cached: number; output: number }> = {
  'gpt-6-astra': { input: 10, cached: 1, output: 50 },
  'gpt-6.1-sol': { input: 2, cached: 0.1, output: 10 },
  'gpt-6-sol': { input: 2, cached: 0.2, output: 10 },
  'gpt-6-luna': { input: 0.1, cached: 0.01, output: 0.5 },
};

/** Cost of a run's tokens at API prices, or null when the price is unknown. */
export function estimateCost(modelId: string | null, u: { input_tokens?: number; cached_input_tokens?: number; output_tokens?: number }): number | null {
  const p = modelId ? PRICES[modelId] : undefined;
  if (!p || u.input_tokens === undefined || u.output_tokens === undefined) return null;
  const cached = u.cached_input_tokens ?? 0;
  return ((u.input_tokens - cached) * p.input + cached * p.cached + u.output_tokens * p.output) / 1e6;
}
