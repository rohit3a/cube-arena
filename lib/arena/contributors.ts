// The contributors board: invited people who ran Verified suites and chose to
// show their name. Built from the index entries (index-data.ts), so it is
// cached the same way and always agrees with the Index.

import { type SuiteEntry, suiteEntries } from './index-data';
import { isRunning } from './running';

export interface Contributor {
  rank: number;
  slug: string;
  name: string;
  x: string | null;
  /** Their finished suites, newest first. */
  suites: SuiteEntry[];
  fast: number;
  thorough: number;
  /** Tests played across those suites: 3 per Fast, 16 per Thorough. */
  tests: number;
  /** Model, effort and suite results they were first to put on the Index. */
  firsts: number;
  /** Which of their suites those were. */
  first_ids: string[];
  /** Distinct model and effort pairs. */
  models: number;
  makers: string[];
  /** Time the model spent on the cube. */
  secs: number;
  /** Input and output tokens, where the runner counted them. */
  tokens: number;
  first_at: string;
  last_at: string;
}

export interface ContributorBoard {
  people: Contributor[];
  /** Finished suites from invitees who chose not to show their name. */
  anonymous: number;
  /** Finished suites Cube Arena ran itself. */
  ours: number;
  /** Suites contributors are playing right now: they join the board when one finishes. */
  running: SuiteEntry[];
}

const testsPlayed = (e: SuiteEntry) => e.tests.filter((t) => t.played > 0).length;
const cell = (e: SuiteEntry) => `${e.kind}|${e.version}|${e.slug}|${e.effort ?? ''}`;

export async function contributorBoard(): Promise<ContributorBoard> {
  return buildBoard(await suiteEntries());
}

/** The board from index entries (exported for tests). */
export function buildBoard(entries: SuiteEntry[]): ContributorBoard {
  const done = entries.filter((e) => e.board === 'verified' && e.status === 'finished' && e.finished_at);

  // The first finished suite for each model, effort and suite version.
  const first = new Map<string, SuiteEntry>();
  for (const e of done) {
    const prev = first.get(cell(e));
    if (!prev || (e.finished_at as string) < (prev.finished_at as string)) first.set(cell(e), e);
  }
  const firstIds = new Set([...first.values()].map((e) => e.id));

  const bySlug = new Map<string, SuiteEntry[]>();
  for (const e of done) if (e.contributor) bySlug.set(e.contributor.slug, [...(bySlug.get(e.contributor.slug) ?? []), e]);

  const people = [...bySlug.values()].map((es): Omit<Contributor, 'rank'> => {
    const sorted = [...es].sort((a, b) => (b.finished_at as string).localeCompare(a.finished_at as string));
    const who = sorted[0].contributor as NonNullable<SuiteEntry['contributor']>;
    return {
      slug: who.slug,
      name: who.name,
      x: who.x,
      suites: sorted,
      fast: es.filter((e) => e.kind === 'fast').length,
      thorough: es.filter((e) => e.kind === 'thorough').length,
      tests: es.reduce((a, e) => a + testsPlayed(e), 0),
      firsts: es.filter((e) => firstIds.has(e.id)).length,
      first_ids: es.filter((e) => firstIds.has(e.id)).map((e) => e.id),
      models: new Set(es.map((e) => e.label)).size,
      makers: [...new Set(es.map((e) => e.maker))].sort(),
      secs: es.reduce((a, e) => a + e.secs, 0),
      tokens: es.reduce((a, e) => a + (e.input_tokens ?? 0) + (e.output_tokens ?? 0), 0),
      first_at: sorted[sorted.length - 1].finished_at as string,
      last_at: sorted[0].finished_at as string,
    };
  });

  // Most tests played first; then most new results; then whoever started earlier.
  people.sort((a, b) => b.tests - a.tests || b.firsts - a.firsts || a.first_at.localeCompare(b.first_at));
  let rank = 0;
  const ranked = people.map((p, i) => {
    const prev = people[i - 1];
    if (!prev || prev.tests !== p.tests || prev.firsts !== p.firsts) rank = i + 1;
    return { ...p, rank };
  });

  return {
    people: ranked,
    anonymous: done.filter((e) => !e.contributor && !e.run_by.includes('Cube Arena')).length,
    ours: done.filter((e) => e.run_by.includes('Cube Arena')).length,
    running: entries.filter((e) => e.board === 'verified' && isRunning(e) && e.contributor),
  };
}

export async function contributor(slug: string): Promise<Contributor | null> {
  const s = slug.toLowerCase();
  return (await contributorBoard()).people.find((p) => p.slug === s) ?? null;
}

/** The X link for a handle. */
export const xUrl = (handle: string) => `https://x.com/${handle}`;
