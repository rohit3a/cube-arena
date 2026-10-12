import { describe, expect, it } from 'vitest';
import { topEffort } from '../lib/arena/catalog';
import { fullEffort } from '../lib/arena/ranking';

const e = (model: string, effort: string | null, top_effort: string | null) => ({ model, slug: model.toLowerCase(), effort, top_effort, label: `${model} (${effort})` });

describe('fullEffort', () => {
  it('ranks a model once it has a result at its top effort, lower efforts included', () => {
    const entries = [e('Astra', 'high', 'max'), e('Astra', 'max', 'max'), e('Terra', 'high', 'max'), e('Terra', 'low', 'max')];
    const { ranked, waiting } = fullEffort(entries);
    expect(ranked.map((x) => x.label)).toEqual(['Astra (high)', 'Astra (max)']);
    expect(waiting).toEqual([{ model: 'Terra', slug: 'terra', top: 'max', tested: ['low', 'high'] }]);
  });

  it('always counts models with no effort setting or none we know', () => {
    const { ranked, waiting } = fullEffort([e('Composer', null, null), e('Mystery', 'high', null)]);
    expect(ranked).toHaveLength(2);
    expect(waiting).toEqual([]);
  });
});

describe('topEffort', () => {
  it('reads the catalog by id, else by name', () => {
    expect(topEffort('gpt-5.6-terra', 'GPT-5.6-Terra')).toBe('max');
    expect(topEffort('gemini-3-8-flash', 'whatever')).toBe('high');
    expect(topEffort('not-an-id', 'Gemini 3.8 Flash')).toBe('high');
    expect(topEffort('composer-2-5', 'Composer 2.5')).toBeNull();
    expect(topEffort('nope', 'Nope')).toBeNull();
  });
});
