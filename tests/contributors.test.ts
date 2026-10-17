import { describe, expect, it } from 'vitest';
import { buildBoard } from '../lib/arena/contributors';
import type { SuiteEntry } from '../lib/arena/index-data';
import { contributorSlug, normalizeHandle } from '../lib/arena/invites';

const PRIYA = { slug: 'priya', name: 'Priya', x: 'Priya' };
const TOM = { slug: 'i-0badc0de', name: 'Tom', x: null };

let n = 0;
const entry = (o: Partial<SuiteEntry> & { at: string }): SuiteEntry => {
  n += 1;
  const kind = o.kind ?? 'fast';
  return {
    id: `id-${n}`,
    kind,
    version: 'v1',
    board: 'verified',
    review: null,
    label: `${o.slug ?? 'gpt-6-luna'} (${o.effort ?? 'max'})`,
    model: 'M',
    slug: 'gpt-6-luna',
    effort: 'max',
    top_effort: 'max',
    maker: 'OpenAI',
    color: '#000',
    display_name: 'x',
    status: 'finished',
    created_at: o.at,
    finished_at: o.at,
    score: 10,
    tests: Array.from({ length: kind === 'fast' ? 3 : 16 }, (_, i) => ({ test: `t${i}`, gauntlet: false, score: 10, played: 1, cubes: 1, out_of_output: false })),
    gauntlet: kind === 'fast' ? 'locked' : null,
    out_of_output: 0,
    moves: 0,
    solved: 0,
    moves_per_solve: null,
    secs: 600,
    paused_secs: 0,
    input_tokens: 1000,
    output_tokens: 100,
    cost_usd: null,
    cost_estimated: false,
    runs: [],
    progress: { started: 3, of: 3 },
    n: 1,
    ids: [],
    run_by: [o.contributor ? o.contributor.name : 'Cube Arena'],
    harness: null,
    contributor: null,
    ...o,
  };
};

describe('X handles', () => {
  it('accepts the usual ways people write a handle', () => {
    for (const input of ['priya_k', '@priya_k', ' @priya_k ', 'x.com/priya_k', 'https://x.com/priya_k?s=20', 'https://twitter.com/priya_k/'])
      expect(normalizeHandle(input)).toBe('priya_k');
  });

  it('refuses anything that is not a handle', () => {
    for (const input of ['', '@', 'way_too_long_for_x_handles', 'priya k', '<b>', 'javascript:alert(1)', 'x.com/']) expect(normalizeHandle(input)).toBeNull();
  });

  it('makes profile slugs that never clash between handles and ids', () => {
    expect(contributorSlug('0badc0de-0000-4000-8000-000000000000', null)).toBe('i-0badc0de');
    expect(contributorSlug('0badc0de-0000-4000-8000-000000000000', 'Priya_K')).toBe('priya_k');
  });
});

describe('contributors board', () => {
  it('ranks by tests played, counts new results, and keeps anonymous runs off it', () => {
    const board = buildBoard([
      // Cube Arena ran Luna max first, so Priya's Luna max is not new.
      entry({ at: '2026-10-01T00:00:00Z' }),
      entry({ at: '2026-10-02T00:00:00Z', contributor: PRIYA }),
      entry({ at: '2026-10-03T00:00:00Z', contributor: PRIYA, slug: 'gpt-6-sol', label: 'GPT-6-Sol (max)' }),
      // Tom's Thorough is new and outweighs two Fast suites.
      entry({ at: '2026-10-04T00:00:00Z', contributor: TOM, kind: 'thorough' }),
      // Anonymous, unfinished and Community suites don't count towards anyone.
      entry({ at: '2026-10-05T00:00:00Z', run_by: ['an invited tester'], slug: 'gpt-6-astra', label: 'GPT-6-Astra (max)' }),
      entry({ at: '2026-10-06T00:00:00Z', contributor: PRIYA, status: 'active', finished_at: null }),
      entry({ at: '2026-10-07T00:00:00Z', contributor: PRIYA, board: 'community' }),
    ]);
    expect(board.people.map((p) => [p.rank, p.name, p.tests, p.firsts, p.suites.length])).toEqual([
      [1, 'Tom', 16, 1, 1],
      [2, 'Priya', 6, 1, 2],
    ]);
    expect(board.people[1].x).toBe('Priya');
    expect(board.people[1].tokens).toBe(2200);
    expect(board.anonymous).toBe(1);
    expect(board.ours).toBe(1);
  });

  it('shares a rank on a full tie', () => {
    const board = buildBoard([
      entry({ at: '2026-10-01T00:00:00Z', contributor: PRIYA, slug: 'a' }),
      entry({ at: '2026-10-02T00:00:00Z', contributor: TOM, slug: 'b' }),
    ]);
    expect(board.people.map((p) => [p.rank, p.name])).toEqual([
      [1, 'Priya'],
      [1, 'Tom'],
    ]);
  });
});
