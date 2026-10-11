import { describe, expect, it } from 'vitest';
import { agentFor, boardLabel, claudeName, codexName, effortsOf, resolveModel } from '../runner/models.mjs';
import { catalogModel, listCost } from '../lib/arena/catalog';

const listed = [
  { slug: 'gpt-6-astra', display_name: 'GPT-6-Astra' },
  { slug: 'gpt-6.1-sol', display_name: 'GPT-6.1-Sol' },
];

describe('Verified board names', () => {
  it('names every Claude version exactly, never just the tier', () => {
    expect(claudeName('claude-opus-5-5')).toBe('Claude Opus 5.5');
    expect(claudeName('claude-opus-5')).toBe('Claude Opus 5');
    expect(claudeName('claude-sonnet-5-5')).toBe('Claude Sonnet 5.5');
    expect(claudeName('claude-haiku-5-5')).toBe('Claude Haiku 5.5');
    expect(claudeName('claude-fable-5-1')).toBe('Claude Fable 5.1');
    expect(claudeName('claude-sonnet-5-20260514')).toBe('Claude Sonnet 5');
  });

  it('refuses aliases that could mean any version', () => {
    for (const alias of ['opus', 'sonnet', 'fable', 'claude-opus', 'default', 'opusplan']) expect(claudeName(alias)).toBeNull();
    for (const alias of ['opus', 'sonnet', 'default']) expect(agentFor(alias)).toBeNull();
  });

  it("uses Codex's own display names, and builds the same shape for unlisted ones", () => {
    expect(codexName('gpt-6-astra', listed)).toBe('GPT-6-Astra');
    expect(codexName('gpt-6.1-sol', listed)).toBe('GPT-6.1-Sol');
    expect(codexName('gpt-6-sol', listed)).toBe('GPT-6-Sol');
    expect(codexName('gpt-5.6-terra', null)).toBe('GPT-5.6-Terra');
    expect(codexName('gpt-5.5', null)).toBe('GPT-5.5');
    expect(codexName('gpt', null)).toBeNull();
  });

  it('only offers the efforts a model really has', () => {
    expect(effortsOf('claude-opus-5-5', null)).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    expect(effortsOf('claude-opus-4-6', null)).toEqual(['low', 'medium', 'high', 'max']);
    expect(effortsOf('claude-opus-4-5', null)).toEqual(['low', 'medium', 'high']);
    expect(effortsOf('claude-sonnet-4-5', null)).toEqual([]);
    expect(effortsOf('gpt-6-luna', [{ slug: 'gpt-6-luna', supported_reasoning_levels: ['low', 'max', 'ultra'].map((effort) => ({ effort })) }])).toEqual(['low', 'max']);
    expect(resolveModel('claude-opus-4-6', 'xhigh', '/nowhere').error).toMatch(/takes --effort/);
  });

  it('puts the effort in the name', () => {
    expect(boardLabel('GPT-6-Astra', 'xhigh')).toBe('GPT-6-Astra (xhigh)');
    expect(resolveModel('claude-haiku-4-5', 'high', '/nowhere').label).toBe('Claude Haiku 4.5');
    expect(resolveModel('claude-opus-5', 'max', '/nowhere').label).toBe('Claude Opus 5 (max)');
    expect(agentFor('gpt-6-luna')).toBe('codex');
    expect(agentFor('claude-opus-5')).toBe('claude');
  });
});

describe('listCost', () => {
  const astra = catalogModel('gpt-6-astra');

  it('prices uncached input, cached input and output separately', () => {
    // GPT-6-Astra's 2×2 ladder: $10 in, $1 cached, $50 out per million.
    const cost = listCost(astra, { input_tokens: 887_473, cached_input_tokens: 804_096, output_tokens: 41_008 });
    expect(cost).toBeCloseTo((83_377 * 10 + 804_096 * 1 + 41_008 * 50) / 1e6, 9);
  });

  it('gives nothing without a price or token counts', () => {
    expect(listCost(null, { input_tokens: 1, output_tokens: 1 })).toBeNull();
    expect(listCost(astra, { input_tokens: 1 })).toBeNull();
    expect(listCost(catalogModel('gpt-reserve'), { input_tokens: 1, output_tokens: 1 })).toBeNull();
  });
});
