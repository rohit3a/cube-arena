// The site's public numbers as JSON, for agents that look things up (Cube Press's Grok Bot): only what the public
// pages already show, from the same queries. Read only, no key.
//   GET /api/data                               what's here
//   GET /api/data?view=index[&kind=fast]        the Index: each model at its best effort, best first, and who's waiting
//   GET /api/data?view=results[&model=<slug>][&since=<iso>][&limit=20]   suites newest first, running ones included
//   GET /api/data?view=suite&id=<suite id>      one suite: score, every test, cost, tokens, time, its runs and replays
//   GET /api/data?view=model&id=<slug>          one model: a result per effort, and every suite behind them
//   GET /api/data?view=replay&id=<attempt id>   one cube: who, which test and level, result, moves (once it's over)
//   GET /api/data?view=live                     cubes being played now
//   GET /api/data?view=recent[&limit=20]        cubes just finished
//   GET /api/data?view=boards[&section=<id>]    the boards: per test, every model ranked
import { averageByLabel, bestPerModel, indexPool, provisional, resultHref } from '@/lib/arena/aggregate';
import { allBoards, liveAttempts, recentFinished, replay } from '@/lib/arena/board';
import { modelHref } from '@/lib/arena/catalog';
import { clientLabel } from '@/lib/arena/clients';
import { type SuiteEntry, suiteEntries, suiteEntry, testNames } from '@/lib/arena/index-data';
import { effortRank } from '@/lib/arena/makers';
import { GAUNTLET, levelDepth } from '@/lib/arena/rules';
import { SUITES, type SuiteKind, testName } from '@/lib/arena/suites';
import { SITE_URL } from '@/lib/site';

export const dynamic = 'force-dynamic';

const VIEWS = {
  index: 'The Index: each model at its best effort, best first (kind=fast or thorough), and the models waiting on a result at their top effort.',
  results: 'Suites newest first, running ones included (model=<slug>, since=<ISO time>, limit up to 100).',
  suite: 'One suite (id=<suite id>): score, every test, cost, tokens, time, its runs and their replays.',
  model: 'One model (id=<slug>): a result per effort, and every suite behind them.',
  replay: 'One cube (id=<attempt id>): who, which test and level, the result and, once it is over, the moves.',
  live: 'Cubes being played now.',
  recent: 'Cubes just finished (limit up to 50).',
  boards: 'The boards: per test, every model ranked (section=<id> for one, e.g. 3x3-ladder-interactive-model-only).',
};

const url = (path: string) => `${SITE_URL}${path}`;
const round = (v: number | null, d = 1) => (v === null ? null : Math.round(v * 10 ** d) / 10 ** d);

/** A suite (or several averaged) as a row: what the Index and the model pages show. */
function row(e: SuiteEntry) {
  const names = new Map(testNames(e.kind).map((t) => [t.test, t.name]));
  return {
    label: e.label,
    model: e.model,
    slug: e.slug,
    effort: e.effort,
    maker: e.maker,
    kind: e.kind,
    version: e.version,
    board: e.board,
    status: e.status,
    score: round(e.score),
    provisional: provisional(e),
    gauntlet: e.gauntlet,
    tests: e.tests.map((t) => ({ test: t.test, name: names.get(t.test) ?? t.test, score: round(t.score), cubes_played: t.played, out_of_output: t.out_of_output })),
    progress: e.status === 'active' ? `test ${e.progress.started} of ${e.progress.of}` : null,
    cubes_solved: e.solved,
    moves: e.moves,
    moves_per_solve: round(e.moves_per_solve),
    hours: round((e.secs - e.paused_secs) / 3600, 2),
    cost_usd: round(e.cost_usd, 2),
    cost_estimated: e.cost_estimated,
    input_tokens: e.input_tokens,
    cached_input_tokens: e.cached_input_tokens,
    output_tokens: e.output_tokens,
    reasoning_tokens: e.reasoning_tokens,
    out_of_output: e.out_of_output,
    harness: e.harness,
    run_by: e.run_by,
    suites_averaged: e.n,
    suite_ids: e.ids,
    started_at: e.created_at,
    finished_at: e.finished_at,
    url: url(resultHref(e)),
    model_url: url(`/models/${e.slug}`),
  };
}

/** A suite in full: its row, and each test's run with its replay. */
function suite(e: SuiteEntry) {
  const names = new Map(testNames(e.kind).map((t) => [t.test, t.name]));
  return {
    ...row(e),
    runs: e.runs.map((r) => {
      const test = SUITES[e.kind].slots[r.slot]?.test ?? null;
      return {
        test,
        name: test ? names.get(test) ?? test : null,
        status: r.status,
        end_reason: r.end_reason,
        best_level: r.best_level,
        top_level: r.top_level,
        cubes_solved: r.solves,
        moves: r.moves,
        hours: round((r.secs - r.paused_secs) / 3600, 2),
        out_of_output_level: r.out_of_output,
        via: r.via,
        replay_id: r.replay,
        replay_url: r.replay ? url(`/replay/${r.replay}`) : null,
      };
    }),
  };
}

const kindOf = (k: string | null): SuiteKind => (k === 'thorough' ? 'thorough' : 'fast');
const limitOf = (v: string | null, def: number, max: number) => Math.min(max, Math.max(1, Number.parseInt(v ?? '', 10) || def));
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'CDN-Cache-Control': status === 200 ? 'max-age=15' : 'no-store' } });
const missing = (what: string) => json({ error: `no ${what} with that id` }, 404);

async function index(kind: SuiteKind) {
  const version = SUITES[kind].version;
  const { ranked, waiting } = indexPool(await suiteEntries(), kind, version);
  const rows = bestPerModel(ranked);
  return {
    kind,
    version,
    about: 'Each model once, at its best effort. Ranked by score (0-100), then fewest moves, then lowest cost, then least time. A model is ranked only once it has a result at its top effort.',
    tests: testNames(kind).map((t) => ({ test: t.test, name: t.name, gauntlet: t.gauntlet })),
    rows: rows.map((e, i) => ({ rank: i + 1, ...row(e) })),
    waiting: waiting.map((w) => ({ ...w, model_url: url(`/models/${w.slug}`) })),
    url: url('/benchmark'),
  };
}

async function results(q: URLSearchParams) {
  const model = q.get('model')?.toLowerCase();
  const since = q.get('since') ? Date.parse(q.get('since')!) : null;
  if (since !== null && Number.isNaN(since)) return null;
  const all = (await suiteEntries())
    .filter((e) => !model || e.slug === model)
    .filter((e) => since === null || Date.parse(e.finished_at ?? e.created_at) >= since)
    .sort((a, b) => (b.finished_at ?? '9').localeCompare(a.finished_at ?? '9') || b.created_at.localeCompare(a.created_at));
  const limit = limitOf(q.get('limit'), 20, 100);
  return { total: all.length, rows: all.slice(0, limit).map(row) };
}

async function model(slug: string) {
  const es = (await suiteEntries()).filter((e) => e.slug === slug.toLowerCase());
  if (!es.length) return null;
  const finished = es.filter((e) => e.status === 'finished');
  const byKind = (kind: SuiteKind) =>
    averageByLabel(finished.filter((e) => e.kind === kind && e.board === 'verified' && e.version === SUITES[kind].version))
      .sort((a, b) => effortRank(a.effort) - effortRank(b.effort))
      .map(row);
  return {
    model: es[0].model,
    slug: es[0].slug,
    maker: es[0].maker,
    top_effort: es[0].top_effort,
    about: 'by_effort: one result per effort on the current suite version (Verified, finished; several suites averaged). suites: every suite of this model, newest first.',
    by_effort: { fast: byKind('fast'), thorough: byKind('thorough') },
    suites: es.sort((a, b) => b.created_at.localeCompare(a.created_at)).map(row),
    url: url(`/models/${es[0].slug}`),
  };
}

async function cube(id: string) {
  const r = await replay(id);
  if (!r) return null;
  const { attempt: a, run, events } = r;
  const over = a.status !== 'active';
  const gauntlet = run.top_level != null;
  return {
    id: a.id,
    model: run.model_name,
    model_url: modelHref(run.model_name) ? url(modelHref(run.model_name)!) : null,
    run_by: run.display_name,
    via: clientLabel(run.client),
    board: run.board,
    on_the_boards: run.board === 'verified' || run.review === 'approved',
    test: testName({ size: a.size, challenge: run.challenge, mode: a.mode, gauntlet }).name,
    challenge: gauntlet ? `${GAUNTLET.name} ladder` : run.challenge,
    size: a.size,
    mode: a.mode,
    tool_use: run.tool_use,
    level: a.level,
    moves_from_solved: a.level ? levelDepth(run, a.level) : null,
    scramble: a.level ? (a.certified ? 'exact distance' : 'random moves') : a.scramble_kind,
    status: a.status,
    detail: a.detail,
    move_count: a.move_count,
    move_cap: a.move_cap,
    turns: a.turns,
    looks: a.looks,
    started_at: a.created_at,
    finished_at: a.finished_at,
    minutes: a.finished_at ? round((new Date(a.finished_at).getTime() - new Date(a.created_at).getTime()) / 60000 - a.paused_secs / 60) : null,
    // While a cube is being played only its picture is public, never its moves.
    moves: over ? a.moves : null,
    turn_log: over ? events.filter((e) => e.kind !== 'start').map((e) => ({ kind: e.kind, at: e.at, moves: e.moves, move_count: e.move_count, solved: e.solved, error: e.error })) : null,
    suite_id: run.suite_id,
    suite_url: run.suite_id ? url(`/suites/${run.suite_id}`) : null,
    picture: url(`/api/image/${a.id}?m=${over ? a.move_count : 0}`),
    url: url(`/replay/${a.id}`),
  };
}

const feed = (items: Awaited<ReturnType<typeof liveAttempts>>) =>
  items.map((a) => ({
    id: a.id,
    model: a.model_name,
    run_by: a.display_name,
    board: a.board,
    test: testName({ size: a.size as 2 | 3 | 4 | 5, challenge: a.challenge, mode: a.mode, gauntlet: a.gauntlet }).name,
    level: a.level,
    status: a.status,
    move_count: a.move_count,
    started_at: a.created_at,
    finished_at: a.finished_at,
    url: url(`/replay/${a.id}`),
  }));

async function boards(section: string | null) {
  const all = await allBoards();
  const pick = section ? all.filter((s) => s.id === section) : all;
  if (section && !pick.length) return null;
  return {
    about: 'Single tests outside the suites. Ladder: highest level, then fewest moves, cost, time. Scramble: solve rate, then fewest moves, cost, time.',
    sections: pick.map((s) => ({
      id: s.id,
      challenge: s.challenge,
      size: s.size,
      mode: s.mode,
      tool_use: s.toolUse,
      rows: (s.challenge === 'ladder' ? s.ladder : s.scramble).map(({ model_href, ...r }, i) => ({
        rank: i + 1,
        ...r,
        model_url: model_href ? url(model_href) : null,
        best_attempt_url: r.best_attempt ? url(`/replay/${r.best_attempt}`) : null,
      })),
    })),
    url: url('/leaderboard'),
  };
}

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const view = q.get('view');
  const id = q.get('id') ?? '';
  switch (view) {
    case 'index':
      return json(await index(kindOf(q.get('kind'))));
    case 'results': {
      const r = await results(q);
      return r ? json(r) : json({ error: 'since must be an ISO time' }, 400);
    }
    case 'suite': {
      const e = await suiteEntry(id);
      return e ? json(suite(e)) : missing('suite');
    }
    case 'model': {
      const m = id ? await model(id) : null;
      return m ? json(m) : missing('model');
    }
    case 'replay': {
      const c = await cube(id);
      return c ? json(c) : missing('cube');
    }
    case 'live':
      return json({ items: feed(await liveAttempts()) });
    case 'recent':
      return json({ items: feed(await recentFinished(limitOf(q.get('limit'), 20, 50))) });
    case 'boards': {
      const b = await boards(q.get('section'));
      return b ? json(b) : missing('board section');
    }
    default:
      return json({ about: "Cube Arena's public numbers, as the site shows them.", views: VIEWS }, view ? 400 : 200);
  }
}
