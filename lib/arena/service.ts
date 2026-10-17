// The game. Every rule is enforced here, on the server: the cube's state never
// leaves it except as a picture, moves are applied by our engine, and solved
// is decided by our engine. Callers (the MCP endpoint) only shape requests.

import { createHash, randomInt } from 'node:crypto';
import { MoveError, applyMoves, isSolved, moveCost, parseMoves, stateFromString, stateToString } from '../cube/engine';
import { fullScramble } from '../cube/random-state';
import { levelScramble, rng } from '../cube/scramble';
import { atlasPng } from '../render/png';
import { CLAIM_HOURS } from './claims';
import { type AttemptRow, type RunRow, type SuiteRow, type Tx, UUID, transaction, withDb } from './db';
import {
  type Board, type Challenge, LADDER_LIVES, MAX_INVALID, MAX_LOOKS, MAX_TURN_BATCH, MODE_LABEL, type Mode,
  MODEL_NAME_HELP, RUNS_PER_HOUR, RUNS_PER_HOUR_TOTAL, SCRAMBLE_MOVE_CAP, type Size, TOOL_USE_LABEL, type ToolUse, isFamilyOnly, ladderMoveCap, levelDepth,
  scoringLine, topLevel, CHALLENGE_LABEL,
} from './rules';
import { gradeSuites } from './suite-data';
import {
  GAUNTLET, SUITES, SUITE_SCORING, type SuiteDef, type SuiteGrade, type SuiteKind, gauntletToPlay, seedVersionOf, suiteSeed, testName,
} from './suites';

export const BASE_URL = (process.env.PUBLIC_BASE_URL || 'https://cube.krnl.studio').replace(/\/$/, '');

export class ArenaError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface Caller {
  board: Board;
  ipHash: string | null;
  client: string | null;
  /** Set by the operator's runner on verified runs; overrides what the model says. */
  operator?: {
    displayName?: string;
    modelName?: string;
    toolUse?: ToolUse;
    /** Suite sessions: this session may only play this slot (one fresh agent per test). */
    suiteSlot?: number;
  };
  /** An invitee's runner: it may only play suites made under its own invite. */
  invite?: { id: string; name: string };
}

/** What a tool call returns: words for the model, and the cube picture when relevant. */
export interface Reply {
  text: string;
  png?: Buffer;
  data: Record<string, unknown>;
}

export const hashIp = (ip: string | null) =>
  ip ? createHash('sha256').update(`${process.env.CUBE_IP_SALT || 'dev'}:${ip}`).digest('hex').slice(0, 32) : null;

// ---------------------------------------------------------------------------
// Names

const BLOCKED = /(fuck|shit|cunt|nigg|fag|rape|hitler|nazi|whore|slut|bitch|dick|cock|pussy|kkk|porn)/;

export function cleanName(raw: unknown, min: number, max: number, what: string): string {
  const v = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (v.length < min || v.length > max) throw new ArenaError('bad_name', `${what} must be ${min} to ${max} characters.`);
  if (!/^[\p{L}\p{N} ._:/()@+#-]+$/u.test(v)) throw new ArenaError('bad_name', `${what} may use letters, numbers, spaces and . _ : / ( ) @ + # - only.`);
  if (BLOCKED.test(v.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''))) throw new ArenaError('bad_name', `Pick a different ${what.toLowerCase()}.`);
  return v;
}

// ---------------------------------------------------------------------------
// Rendering and wording

function picture(a: AttemptRow): Buffer {
  const caption = a.level ? `level ${a.level}` : 'full scramble';
  return atlasPng(stateFromString(a.state, a.size), a.size, { caption, moves: a.move_count });
}

const replayUrl = (a: AttemptRow) => `${BASE_URL}/replay/${a.id}`;
const imageUrl = (a: AttemptRow) => `${BASE_URL}/api/image/${a.id}?m=${a.move_count}`;

function header(run: RunRow): string {
  const what = run.challenge === 'ladder' ? 'Ladder' : 'Full scramble';
  return `Cube Arena · ${run.size}×${run.size} · ${what} · ${MODE_LABEL[run.mode]} · ${TOOL_USE_LABEL[run.tool_use]}`;
}

function attemptLine(run: RunRow, a: AttemptRow): string {
  const left = a.move_cap - a.move_count;
  if (run.challenge === 'ladder') {
    const depth = levelDepth(run, a.level ?? 0);
    const exact = a.certified ? `exactly ${depth} move${depth === 1 ? '' : 's'} from solved` : `scrambled with ${depth} random moves`;
    return `Level ${a.level} of ${topLevel(run)} (${exact}). Lives: ${run.lives}. Moves left this attempt: ${left}.`;
  }
  const how = a.scramble_kind === 'random_state' ? 'a uniformly random state' : `${a.scramble?.split(' ').length ?? 0} random moves`;
  return `Full scramble (${how}). Moves allowed: ${left}.`;
}

function howTo(run: RunRow, a: AttemptRow): string {
  if (run.mode === 'one_shot') {
    return `Study the picture and work out the whole solution, then call submit_solution with attempt_id "${a.id}" and every move in order (max ${a.move_cap - a.move_count}). You get one submission; only the final state counts. Use look to see the picture again.`;
  }
  return `Turn the cube with turn(attempt_id "${a.id}", moves), up to ${MAX_TURN_BATCH} moves per call, e.g. "R U R' U'". Each call returns a new picture. The attempt ends as soon as the cube is solved at the end of a call.`;
}

function data(run: RunRow, a: AttemptRow | null, extra: Record<string, unknown> = {}) {
  return {
    run_id: run.id,
    run_status: run.status,
    run_end_reason: run.end_reason,
    lives: run.lives,
    best_level: run.best_level,
    attempt_id: a?.id ?? null,
    attempt_status: a?.status ?? null,
    level: a?.level ?? null,
    moves_used: a?.move_count ?? null,
    moves_left: a ? a.move_cap - a.move_count : null,
    replay_url: a ? replayUrl(a) : null,
    image_url: a ? imageUrl(a) : null,
    ...(run.suite_id ? { suite_id: run.suite_id, suite_test: (run.suite_slot ?? 0) + 1 } : {}),
    ...extra,
  };
}

function presentAttempt(run: RunRow, a: AttemptRow, lead: string[] = []): Reply {
  const text = [...lead, header(run), attemptLine(run, a), `attempt_id: ${a.id}`, howTo(run, a), `The attached image is the cube right now (also at ${imageUrl(a)}).`].join('\n');
  return { text, png: picture(a), data: data(run, a) };
}

// ---------------------------------------------------------------------------
// Attempts

async function newAttempt(tx: Tx, run: RunRow): Promise<AttemptRow> {
  const n = run.size;
  let seed = randomInt(0, 2 ** 31);
  if (run.suite_id) {
    // Suite cubes are the same for every model: seeded by suite, slot, level and try.
    const level = run.challenge === 'ladder' ? run.level : null;
    const [suite] = await tx<{ kind: SuiteKind; version: string }[]>`select kind, version from cube_arena.suites where id = ${run.suite_id}`;
    const [{ tries }] = await tx<{ tries: number }[]>`
      select count(*)::int as tries from cube_arena.attempts where run_id = ${run.id} and level is not distinct from ${level}`;
    seed = suiteSeed(suite.kind, seedVersionOf(suite.kind, suite.version, run.suite_slot ?? 0), run.suite_slot ?? 0, level, tries);
  }
  const random = rng(seed);
  let state: string;
  let scramble: string | null;
  let kind: AttemptRow['scramble_kind'];
  let certified = false;
  let cap: number;
  if (run.challenge === 'ladder') {
    // Level N is N moves from solved, or more on a ladder that starts higher (the Gauntlet).
    const depth = levelDepth(run, run.level);
    const sc = levelScramble(n, depth, random);
    state = stateToString(sc.state);
    scramble = sc.moves.map((m) => m.token).join(' ');
    kind = 'walk';
    certified = sc.certified;
    cap = ladderMoveCap(n, depth);
  } else {
    const sc = fullScramble(n, random);
    state = stateToString(sc.state);
    scramble = sc.moves ? sc.moves.join(' ') : null;
    kind = sc.kind;
    cap = SCRAMBLE_MOVE_CAP[n];
  }
  const seq = run.attempts + 1;
  const [a] = await tx<AttemptRow[]>`
    insert into cube_arena.attempts
      (run_id, seq, size, mode, level, scramble_kind, scramble, certified, initial_state, state, move_cap)
    values
      (${run.id}, ${seq}, ${n}, ${run.mode}, ${run.challenge === 'ladder' ? run.level : null}, ${kind}, ${scramble}, ${certified},
       ${state}, ${state}, ${cap})
    returning *`;
  await tx`insert into cube_arena.events (attempt_id, kind, move_count, solved, state) values (${a.id}, 'start', 0, false, ${state})`;
  await tx`update cube_arena.runs set attempts = ${seq}, updated_at = now() where id = ${run.id}`;
  run.attempts = seq;
  return a;
}

async function lock(tx: Tx, attemptId: string, caller?: Caller): Promise<{ run: RunRow; a: AttemptRow }> {
  if (!UUID.test(attemptId)) throw new ArenaError('bad_attempt', 'That attempt_id is not valid. Use the attempt_id from the latest reply.');
  const [a] = await tx<AttemptRow[]>`select * from cube_arena.attempts where id = ${attemptId} for update`;
  if (!a) throw new ArenaError('bad_attempt', 'No attempt with that attempt_id.');
  const [run] = await tx<RunRow[]>`select * from cube_arena.runs where id = ${a.run_id} for update`;
  // Attempt ids show up in replay links, so a Verified run only takes moves
  // from a Verified caller; nobody else can play (or spoil) it.
  if (caller && run.board === 'verified' && caller.board !== 'verified') throw new ArenaError('bad_attempt', 'That attempt is on the Verified board.');
  return { run, a };
}

async function finishRun(tx: Tx, run: RunRow, reason: string) {
  run.status = 'finished';
  run.end_reason = reason;
  await tx`update cube_arena.runs set status = 'finished', end_reason = ${reason}, lives = ${run.lives}, best_level = ${run.best_level},
           solves = ${run.solves}, updated_at = now() where id = ${run.id}`;
  if (run.suite_id) run.suite_note = await afterSuiteTest(tx, run.suite_id, run.suite_slot ?? 0);
}

/** "test 2 of 3", or "Gauntlet test 1 of 2": tests are counted apart from the Gauntlet, which most suites never reach. */
function slotLabel(def: SuiteDef, slot: number): string {
  const gauntlet = !!def.slots[slot]?.gauntlet;
  const same = def.slots.flatMap((s, i) => (!!s.gauntlet === gauntlet ? [i] : []));
  return `${gauntlet ? `${GAUNTLET.name} test` : 'test'} ${same.indexOf(slot) + 1} of ${same.length}`;
}

const gradeOf = async (tx: Tx, suite: SuiteRow): Promise<SuiteGrade> => (await gradeSuites(tx, [suite])).get(suite.id) as SuiteGrade;

/**
 * A suite test ended: say what comes next. Once every test but the Gauntlet
 * is over, the suite closes with that score; a perfect one unlocks the
 * Gauntlet, played after the close, and the suite's result line says so.
 */
async function afterSuiteTest(tx: Tx, suiteId: string, slot: number): Promise<string> {
  const [suite] = await tx<SuiteRow[]>`select * from cube_arena.suites where id = ${suiteId} for update`;
  const def = SUITES[suite.kind];
  const runs = await tx<{ suite_slot: number }[]>`
    select suite_slot from cube_arena.runs where suite_id = ${suiteId} and status = 'finished'`;
  const over = new Set(runs.map((r) => r.suite_slot));
  await tx`update cube_arena.suites set updated_at = now() where id = ${suiteId}`;
  const gauntlet = !!def.slots[slot]?.gauntlet;
  const left = def.slots.filter((s, i) => !!s.gauntlet === gauntlet && !over.has(i)).length;
  if (left > 0) {
    return `Suite ${slotLabel(def, slot)} is over (${left} to go). Call next_test with suite_id "${suiteId}" for the next one.`;
  }
  return finishSuite(tx, suite);
}

/**
 * Closes a suite and returns its result line. A suite shows only if it is
 * complete: every test played to an end the model made (cleared, out of
 * lives, gave up, quit). A test never played, or one stopped for a reason
 * nobody knows (a crash, a killed runner), says nothing about the model, so
 * that suite is hidden, its runs with it. The Gauntlet doesn't count here: the
 * suite closes before it, and a Gauntlet cut short scores what it reached.
 */
async function finishSuite(tx: Tx, suite: SuiteRow): Promise<string> {
  const def = SUITES[suite.kind];
  if (suite.status !== 'finished') {
    await tx`update cube_arena.suites set status = 'finished', finished_at = now(), updated_at = now() where id = ${suite.id}`;
    suite.status = 'finished';
    const gap = await incomplete(tx, suite);
    if (gap) {
      await tx`update cube_arena.suites set hidden = true, hidden_reason = coalesce(hidden_reason, ${`incomplete: ${gap}`}) where id = ${suite.id}`;
      await tx`update cube_arena.runs set hidden = true, hidden_reason = coalesce(hidden_reason, ${`incomplete suite: ${gap}`}) where suite_id = ${suite.id}`;
      suite.hidden = true;
      suite.hidden_reason ??= `incomplete: ${gap}`;
    }
  }
  const closed = suite.hidden && (suite.hidden_reason ?? 'incomplete').startsWith('incomplete');
  const grade = closed ? null : await gradeOf(tx, suite);
  // Its claim, if any, is done (the model and effort are free for another run), unless the Gauntlet is still to play.
  if (grade?.gauntlet !== 'pending' && grade?.gauntlet !== 'playing') {
    await tx`update cube_arena.claims set released_at = now() where suite_id = ${suite.id} and released_at is null`;
  }
  if (!grade) {
    return `Suite closed: ${def.name} ${suite.version} is incomplete, so it isn't shown on the boards. Start a new one to run it again.`;
  }
  const score = (grade.score ?? 0).toFixed(1);
  const name = `${def.name} ${suite.version}`;
  // Hidden by the operator (an unreleased model, say): the player still gets the score, but there's no public page.
  // A Community suite's page opens once the operator has reviewed it.
  const where = suite.hidden
    ? ''
    : suite.board === 'community' && suite.review !== 'approved'
      ? ` Community results reach the boards once we've reviewed them; its page will be ${BASE_URL}/suites/${suite.id}`
      : ` Results: ${BASE_URL}/suites/${suite.id}`;
  const g = `the ${GAUNTLET.size}×${GAUNTLET.size} ${GAUNTLET.name}`;
  const base = def.slots.filter((s) => !s.gauntlet).length;
  const all = `100 on all ${base === 3 ? 'three' : base} tests`;
  if (grade.gauntlet === 'pending') {
    return (
      `Suite score so far: ${name}, ${score} out of 100, with ${all}. That unlocks ${g}: ` +
      `two ${GAUNTLET.size}×${GAUNTLET.size} ladders for the last ${Math.round(100 - (grade.score ?? 0))} points, ${GAUNTLET.levels} levels each. ` +
      `Call next_test with suite_id "${suite.id}" to play it.${where}`
    );
  }
  if (grade.gauntlet === 'playing') return `Suite score so far: ${name}, ${score} out of 100; ${g} is under way. Call next_test with suite_id "${suite.id}" to go on.${where}`;
  if (grade.gauntlet === 'locked') {
    return `Suite complete: ${name}, score ${score} out of 100. ${g[0].toUpperCase()}${g.slice(1)} unlocks only with ${all}, so the suite ends here.${where}`;
  }
  return `Suite complete: ${name}, score ${score} out of 100${grade.gauntlet === 'done' ? `, ${g} included` : ''}.${where}`;
}

/** Why a suite isn't complete ("test 2 never played"), or null if every test (the Gauntlet aside) ended the model's way. */
async function incomplete(tx: Tx, suite: SuiteRow): Promise<string | null> {
  const runs = await tx<{ suite_slot: number; status: string; end_reason: string | null }[]>`
    select suite_slot, status, end_reason from cube_arena.runs where suite_id = ${suite.id}`;
  const gaps = SUITES[suite.kind].slots.flatMap((s, i) => {
    if (s.gauntlet) return [];
    const r = runs.find((x) => x.suite_slot === i);
    if (!r || r.status !== 'finished') return [`test ${i + 1} never played`];
    return r.end_reason === 'stopped' ? [`test ${i + 1} stopped for an unknown reason`] : [];
  });
  return gaps.length ? gaps.join(', ') : null;
}

/** After an attempt ends, move the run on: next level, a retry, or the end. */
async function advance(tx: Tx, run: RunRow, a: AttemptRow): Promise<AttemptRow | null> {
  if (a.status === 'solved') run.solves += 1;
  if (run.challenge === 'scramble') {
    await finishRun(tx, run, a.status === 'solved' ? 'solved' : a.status);
    return null;
  }
  if (a.status === 'gave_up' || a.status === 'stopped') {
    await finishRun(tx, run, a.status);
    return null;
  }
  if (a.status === 'solved') {
    run.best_level = Math.max(run.best_level, a.level ?? 0);
    if (run.level >= topLevel(run)) {
      await finishRun(tx, run, 'cleared');
      return null;
    }
    run.level += 1;
  } else {
    run.lives -= 1;
    if (run.lives <= 0) {
      await finishRun(tx, run, 'out_of_lives');
      return null;
    }
  }
  await tx`update cube_arena.runs set level = ${run.level}, lives = ${run.lives}, best_level = ${run.best_level}, solves = ${run.solves},
           updated_at = now() where id = ${run.id}`;
  return newAttempt(tx, run);
}

async function endAttempt(tx: Tx, a: AttemptRow, status: AttemptRow['status'], detail: string | null) {
  a.status = status;
  a.detail = detail;
  await tx`update cube_arena.attempts set status = ${status}, detail = ${detail}, finished_at = now() where id = ${a.id}`;
}

function finishedReply(run: RunRow, a: AttemptRow, next: AttemptRow | null, lead: string[]): Reply {
  if (next) return presentAttempt(run, next, lead);
  const end: Record<string, string> = {
    cleared: `Run complete: every level cleared!`,
    out_of_lives: `Out of lives. Run over: best level ${run.best_level}.`,
    solved: 'Run complete.',
    gave_up: 'Run ended.',
    stopped: 'Run stopped.',
  };
  const after = run.suite_id ? (run.suite_note ?? `Call next_test with suite_id "${run.suite_id}" to go on.`) : 'Call start_run to play again.';
  const text = [...lead, end[run.end_reason ?? ''] ?? `Run ended (${run.end_reason}).`, `Replay: ${replayUrl(a)}`, after].join('\n');
  return { text, png: picture(a), data: data(run, a) };
}

// ---------------------------------------------------------------------------
// Operations

export interface StartInput {
  size: Size;
  mode: Mode;
  challenge: Challenge;
  display_name: string;
  model_name: string;
  tool_use: ToolUse;
}

/** The names a run or suite is filed under: the operator's for Verified, the player's (checked) otherwise. */
function namesFor(input: { display_name: string; model_name: string }, caller: Caller) {
  const display = caller.operator?.displayName ?? cleanName(input.display_name, 2, 32, 'Display name');
  const model = caller.operator?.modelName ?? cleanName(input.model_name, 1, 64, 'Model name');
  if (!caller.operator && isFamilyOnly(model)) {
    throw new ArenaError('vague_model', `"${model}" is a model family, not an exact model. Use ${MODEL_NAME_HELP}`);
  }
  return { display, model };
}

async function checkRate(caller: Caller) {
  if (caller.board !== 'community') return;
  const ipHash = caller.ipHash ?? '';
  const [{ mine, everyone }] = await withDb((sql) => sql<{ mine: number; everyone: number }[]>`
    select count(*) filter (where ip_hash = ${ipHash})::int as mine, count(*)::int as everyone
    from cube_arena.runs where board = 'community' and created_at > now() - interval '1 hour'`);
  if (ipHash && mine >= RUNS_PER_HOUR) throw new ArenaError('slow_down', `Too many new runs from here (limit ${RUNS_PER_HOUR} an hour). Try again later.`);
  if (everyone >= RUNS_PER_HOUR_TOTAL) throw new ArenaError('slow_down', 'Cube Arena is very busy right now. Try again in a little while.');
}

// Invite codes are for suites the runner sets up (names come from the model
// catalog), not for one-off runs or suites a model starts itself.
function noInvite(caller: Caller) {
  if (caller.invite) throw new ArenaError('invite_suites_only', 'An invite code only plays suites set up by the Cube Arena runner (cube-arena-runner; see /wanted). Remove it to play on the Community board.');
}

export async function startRun(input: StartInput, caller: Caller): Promise<Reply> {
  noInvite(caller);
  const { display, model } = namesFor(input, caller);
  const toolUse = caller.operator?.toolUse ?? input.tool_use;
  await checkRate(caller);
  return transaction(async (tx) => {
    const lives = input.challenge === 'ladder' ? LADDER_LIVES : 1;
    const level = input.challenge === 'ladder' ? 1 : 0;
    const [run] = await tx<RunRow[]>`
      insert into cube_arena.runs (board, display_name, model_name, tool_use, client, size, mode, challenge, lives, level, ip_hash)
      values (${caller.board}, ${display}, ${model}, ${toolUse}, ${caller.client}, ${input.size}, ${input.mode}, ${input.challenge},
              ${lives}, ${level}, ${caller.ipHash})
      returning *`;
    const a = await newAttempt(tx, run);
    const board = caller.board === 'verified' ? 'Verified board' : 'Community board (self-reported)';
    return presentAttempt(run, a, [`Run started for ${display} / ${model} on the ${board}. Run id: ${run.id}`, scoringLine(run.challenge)]);
  });
}

// ---------------------------------------------------------------------------
// Suites

/** Creates a suite. The runner calls this through the operator API, with the exact model and effort. */
export async function createSuite(
  kind: SuiteKind,
  names: { display: string; model: string },
  caller: Caller,
  meta: {
    model?: string | null;
    model_id?: string | null;
    effort?: string | null;
    agent?: string | null;
    harness?: string | null;
    invite_id?: string | null;
    credit?: boolean;
  } = {},
): Promise<SuiteRow> {
  const def = SUITES[kind];
  const [suite] = await withDb((sql) => sql<SuiteRow[]>`
    insert into cube_arena.suites (kind, version, board, display_name, model_name, model, model_id, effort, agent, client, ip_hash,
                                   harness, invite_id, credit)
    values (${kind}, ${def.version}, ${caller.board}, ${names.display}, ${names.model}, ${meta.model ?? null}, ${meta.model_id ?? null},
            ${meta.effort ?? null}, ${meta.agent ?? null}, ${caller.client}, ${caller.ipHash},
            ${meta.harness ?? meta.agent ?? null}, ${meta.invite_id ?? null}, ${meta.credit ?? false})
    returning *`);
  return suite;
}

export async function startSuite(kind: SuiteKind, input: { display_name: string; model_name: string }, caller: Caller): Promise<Reply> {
  if (!SUITES[kind]) throw new ArenaError('bad_suite', 'suite must be "fast" or "thorough".');
  noInvite(caller);
  const names = namesFor(input, caller);
  await checkRate(caller);
  const suite = await createSuite(kind, names, caller);
  return nextTest(suite.id, caller);
}

/**
 * Starts the suite's next test, or shows the one in progress. After the last
 * test everyone plays the suite closes; with a perfect score the Gauntlet
 * comes next, on the closed suite (its score so far stays on the boards).
 */
export async function nextTest(suiteId: string, caller: Caller): Promise<Reply> {
  if (!UUID.test(suiteId)) throw new ArenaError('bad_suite', 'That suite_id is not valid. Use the suite_id from start_suite.');
  return transaction(async (tx) => {
    const [suite] = await tx<SuiteRow[]>`select * from cube_arena.suites where id = ${suiteId} for update`;
    if (!suite) throw new ArenaError('bad_suite', 'No suite with that suite_id.');
    if (suite.board !== caller.board) throw new ArenaError('bad_suite', `That suite is on the ${suite.board} board.`);
    if (caller.invite && suite.invite_id !== caller.invite.id) throw new ArenaError('bad_suite', 'That suite was not made with this invite code.');
    const def = SUITES[suite.kind];
    const only = caller.operator?.suiteSlot;
    const runs = await tx<RunRow[]>`select * from cube_arena.runs where suite_id = ${suite.id} order by suite_slot`;

    const active = runs.find((r) => r.status === 'active');
    if (active && (only === undefined || active.suite_slot === only)) {
      const [a] = await tx<AttemptRow[]>`select * from cube_arena.attempts where run_id = ${active.id} and status = 'active' order by seq desc limit 1 for update`;
      if (a) return presentAttempt(active, a, [`Suite ${slotLabel(def, active.suite_slot ?? 0)} is in progress:`]);
    }
    if (only !== undefined && (only < 0 || only >= def.slots.length)) throw new ArenaError('bad_suite', `This suite has ${def.slots.length} tests.`);
    const played = new Set(runs.map((r) => r.suite_slot ?? 0));
    if (only !== undefined && played.has(only)) {
      throw new ArenaError('suite_test_over', `Suite ${slotLabel(def, only)} is over. This session is done; stop here.`);
    }
    const closed = async () => ({ text: await finishSuite(tx, suite), data: { suite_id: suite.id, suite_status: 'finished' } });

    if (suite.status !== 'finished') {
      const slot = only ?? def.slots.findIndex((s, i) => !s.gauntlet && !played.has(i));
      if (slot >= 0 && !def.slots[slot].gauntlet) return startSlot(tx, suite, slot, caller);
      if (slot >= 0 && def.slots.some((s, i) => !s.gauntlet && !played.has(i))) {
        throw new ArenaError('gauntlet_locked', `The ${GAUNTLET.name} comes after every other test, and only with a perfect score on them. Stop here.`);
      }
      // Every test everyone plays is over: close the suite. The Gauntlet, if unlocked, follows below.
      const text = await finishSuite(tx, suite);
      const open = gauntletToPlay(def, await gradeOf(tx, suite), played);
      const next = only ?? open[0];
      if (next === undefined || !open.includes(next)) return { text, data: { suite_id: suite.id, suite_status: 'finished' } };
      return startSlot(tx, suite, next, caller, [text]);
    }

    // A closed suite plays on only into an unlocked Gauntlet.
    const open = gauntletToPlay(def, await gradeOf(tx, suite), played);
    const slot = only ?? open[0];
    if (slot === undefined || !open.includes(slot)) {
      if (only !== undefined && def.slots[only].gauntlet) {
        throw new ArenaError('gauntlet_locked', `The ${GAUNTLET.name} unlocks only with 100 on every other test. This suite is over; stop here.`);
      }
      return closed();
    }
    return startSlot(tx, suite, slot, caller);
  });
}

async function startSlot(tx: Tx, suite: SuiteRow, slot: number, caller: Caller, lead: string[] = []): Promise<Reply> {
  const def = SUITES[suite.kind];
  const t = def.slots[slot];
  const lives = t.challenge === 'ladder' ? LADDER_LIVES : 1;
  const level = t.challenge === 'ladder' ? 1 : 0;
  const offset = t.challenge === 'ladder' ? (t.startDepth ?? 1) - 1 : 0;
  const [run] = await tx<RunRow[]>`
    insert into cube_arena.runs (board, display_name, model_name, tool_use, client, size, mode, challenge, lives, level, ip_hash,
                                 suite_id, suite_slot, hidden, hidden_reason, level_offset, top_level, review, reviewed_at)
    values (${suite.board}, ${suite.display_name}, ${suite.model_name}, 'model_only', ${caller.client}, ${t.size}, ${t.mode}, ${t.challenge},
            ${lives}, ${level}, ${caller.ipHash}, ${suite.id}, ${slot}, ${suite.hidden}, ${suite.hidden_reason}, ${offset}, ${t.levels ?? null},
            ${suite.review ?? null}, ${suite.reviewed_at ?? null})
    returning *`;
  await tx`update cube_arena.suites set updated_at = now() where id = ${suite.id}`;
  const a = await newAttempt(tx, run);
  const what = t.gauntlet
    ? `${testName(t).name}: ${topLevel(run)} levels; level N is ${levelDepth(run, 1) === 1 ? 'N' : `N + ${levelDepth(run, 0)}`} moves from solved.`
    : `${t.size}×${t.size} ${CHALLENGE_LABEL[t.challenge]}, ${MODE_LABEL[t.mode]}.`;
  return presentAttempt(run, a, [
    ...lead,
    `${def.name} suite ${suite.version}, ${slotLabel(def, slot)}: ${what} No time limit. suite_id: ${suite.id}`,
    SUITE_SCORING,
  ]);
}

export async function look(attemptId: string, caller?: Caller): Promise<Reply> {
  return transaction(async (tx) => {
    const { run, a } = await lock(tx, attemptId, caller);
    if (a.status !== 'active') {
      const [next] = await tx<AttemptRow[]>`select * from cube_arena.attempts where run_id = ${run.id} and status = 'active' order by seq desc limit 1`;
      if (next) return presentAttempt(run, next, [`That attempt is over (${a.status}). This is the run's current attempt:`]);
      return finishedReply(run, a, null, [`That attempt is over (${a.status}).`]);
    }
    if (a.looks >= MAX_LOOKS) throw new ArenaError('look_limit', `That's all ${MAX_LOOKS} looks for this attempt. The last picture you got is still the current cube.`);
    await tx`update cube_arena.attempts set looks = looks + 1 where id = ${a.id}`;
    await tx`insert into cube_arena.events (attempt_id, kind, move_count) values (${a.id}, 'look', ${a.move_count})`;
    return presentAttempt(run, a);
  });
}

/** A rejected request: counts toward the attempt's invalid limit, changes nothing else. */
async function reject(tx: Tx, run: RunRow, a: AttemptRow, error: string, moves: string[] | null): Promise<Reply> {
  a.invalid += 1;
  await tx`update cube_arena.attempts set invalid = ${a.invalid} where id = ${a.id}`;
  await tx`insert into cube_arena.events (attempt_id, kind, moves, move_count, error) values (${a.id}, 'invalid', ${moves ? tx.array(moves) : null}, ${a.move_count}, ${error})`;
  if (a.invalid >= MAX_INVALID) {
    await endAttempt(tx, a, 'invalid', `${MAX_INVALID} invalid requests`);
    const next = await advance(tx, run, a);
    return finishedReply(run, a, next, [`Rejected: ${error}`, `That was the ${MAX_INVALID}th invalid request, so this attempt failed.`]);
  }
  return {
    text: `Rejected, nothing changed: ${error}\nInvalid requests on this attempt: ${a.invalid} of ${MAX_INVALID}. attempt_id: ${a.id}`,
    data: data(run, a, { error }),
  };
}

function parse(a: AttemptRow, raw: string | string[]) {
  try {
    const moves = parseMoves(raw, a.size);
    if (moves.length === 0) return { error: 'no moves given.' };
    return { moves };
  } catch (e) {
    if (e instanceof MoveError) return { error: e.message };
    throw e;
  }
}

export async function turn(attemptId: string, raw: string | string[], caller?: Caller): Promise<Reply> {
  return transaction(async (tx) => {
    const { run, a } = await lock(tx, attemptId, caller);
    if (a.status !== 'active') throw new ArenaError('over', `That attempt is over (${a.status}). Use the attempt_id from the latest reply, or call look.`);
    if (a.mode !== 'interactive') throw new ArenaError('wrong_mode', 'This is a one-shot run: send every move at once with submit_solution.');
    const p = parse(a, raw);
    if (!p.moves) return reject(tx, run, a, p.error!, null);
    const tokens = p.moves.map((m) => m.token);
    if (p.moves.length > MAX_TURN_BATCH) return reject(tx, run, a, `at most ${MAX_TURN_BATCH} moves per turn call (got ${p.moves.length}).`, tokens);
    const cost = moveCost(p.moves);
    if (a.move_count + cost > a.move_cap) {
      return reject(tx, run, a, `that would use ${cost} moves but only ${a.move_cap - a.move_count} are left.`, tokens);
    }
    const s = applyMoves(stateFromString(a.state, a.size), a.size, p.moves);
    const solved = isSolved(s, a.size);
    a.state = stateToString(s);
    a.move_count += cost;
    a.turns += 1;
    a.moves = [...a.moves, ...tokens];
    await tx`update cube_arena.attempts set state = ${a.state}, move_count = ${a.move_count}, turns = ${a.turns},
             moves = moves || ${tx.array(tokens)}::text[] where id = ${a.id}`;
    await tx`insert into cube_arena.events (attempt_id, kind, moves, move_count, solved, state)
             values (${a.id}, 'turn', ${tx.array(tokens)}, ${a.move_count}, ${solved}, ${a.state})`;
    if (solved) {
      await endAttempt(tx, a, 'solved', null);
      const next = await advance(tx, run, a);
      const what = a.level ? `level ${a.level}` : 'the cube';
      return finishedReply(run, a, next, [`Solved ${what} in ${a.move_count} move${a.move_count === 1 ? '' : 's'}!${next ? ' Next up:' : ''}`]);
    }
    if (a.move_count >= a.move_cap) {
      await endAttempt(tx, a, 'failed', 'move limit reached');
      const next = await advance(tx, run, a);
      return finishedReply(run, a, next, [`Move limit reached without solving. Attempt failed.${next ? ` Lives left: ${run.lives}.` : ''}`]);
    }
    return presentAttempt(run, a, [`Applied ${tokens.join(' ')}. Not solved yet.`]);
  });
}

export async function submitSolution(attemptId: string, raw: string | string[], caller?: Caller): Promise<Reply> {
  return transaction(async (tx) => {
    const { run, a } = await lock(tx, attemptId, caller);
    if (a.status !== 'active') throw new ArenaError('over', `That attempt is over (${a.status}). Use the attempt_id from the latest reply, or call look.`);
    if (a.mode !== 'one_shot') throw new ArenaError('wrong_mode', 'This is an interactive run: use turn.');
    // Unreadable or over-long lists are refused without using up the one
    // submission: those checks never depend on the cube, so they leak nothing.
    const p = parse(a, raw);
    if (!p.moves) return reject(tx, run, a, `${p.error} Your submission was not used; send a corrected one.`, null);
    const tokens = p.moves.map((m) => m.token);
    const cost = moveCost(p.moves);
    if (cost > a.move_cap) return reject(tx, run, a, `${cost} moves is over this attempt's limit of ${a.move_cap}. Your submission was not used.`, tokens);
    const s = applyMoves(stateFromString(a.state, a.size), a.size, p.moves);
    const solved = isSolved(s, a.size);
    a.state = stateToString(s);
    a.move_count = cost;
    a.moves = tokens;
    a.turns = 1;
    await tx`update cube_arena.attempts set state = ${a.state}, move_count = ${cost}, turns = 1, moves = ${tx.array(tokens)}::text[] where id = ${a.id}`;
    await tx`insert into cube_arena.events (attempt_id, kind, moves, move_count, solved, state)
             values (${a.id}, 'submit', ${tx.array(tokens)}, ${cost}, ${solved}, ${a.state})`;
    await endAttempt(tx, a, solved ? 'solved' : 'failed', solved ? null : 'final state not solved');
    const next = await advance(tx, run, a);
    const what = a.level ? `Level ${a.level}` : 'The cube';
    const lead = solved
      ? [`Correct! ${what} solved in ${cost} move${cost === 1 ? '' : 's'}.${next ? ' Next up:' : ''}`]
      : [`Not solved: after your ${cost} moves the cube is not solved (picture at ${imageUrl(a)}).${next && run.challenge === 'ladder' ? ` Lives left: ${run.lives}. Try again with a new cube at the same level:` : ''}`];
    return finishedReply(run, a, next, lead);
  });
}

export async function giveUp(attemptId: string, caller?: Caller): Promise<Reply> {
  return transaction(async (tx) => {
    const { run, a } = await lock(tx, attemptId, caller);
    if (a.status !== 'active') throw new ArenaError('over', `That attempt is already over (${a.status}).`);
    await endAttempt(tx, a, 'gave_up', null);
    await tx`insert into cube_arena.events (attempt_id, kind, move_count) values (${a.id}, 'give_up', ${a.move_count})`;
    await advance(tx, run, a);
    return finishedReply(run, a, null, [`Gave up. Best level: ${run.best_level}.`]);
  });
}

/** How long a Verified runner may go without a heartbeat (it sends one every few minutes) before its suite counts as abandoned. */
const RUNNER_QUIET = '30 minutes';
/** How long a Community cube may go without a move before it counts as abandoned. There is no runner to ask. */
const PLAYER_QUIET = '24 hours';

/**
 * Close what nobody is playing any more. Cheap; called by pages. This never
 * limits thinking: a Verified runner sends a heartbeat while it plays, so its
 * suite closes only once the runner itself has gone quiet (crashed, killed,
 * the machine asleep). A dead runner says nothing about the model, so that
 * suite is hidden rather than scored. A Community player has no runner, so its
 * cube is let go after a day without a move, and that does count.
 */
export async function sweepExpired(): Promise<void> {
  await transaction(async (tx) => {
    const quiet = await tx<{ id: string }[]>`
      update cube_arena.suites set status = 'finished', finished_at = now(), updated_at = now(), hidden = true,
        hidden_reason = coalesce(hidden_reason, 'abandoned: the runner stopped before the end')
      where status = 'active' and board = 'verified' and updated_at < now() - ${RUNNER_QUIET}::interval
      returning id`;
    if (!quiet.length) return;
    const ids = quiet.map((q) => q.id);
    const open = await tx<{ id: string; move_count: number }[]>`
      update cube_arena.attempts set status = 'stopped', detail = 'abandoned: the runner stopped', finished_at = now()
      where status = 'active' and run_id in (select id from cube_arena.runs where suite_id in ${tx(ids)})
      returning id, move_count`;
    for (const a of open) await tx`insert into cube_arena.events (attempt_id, kind, move_count) values (${a.id}, 'stop', ${a.move_count})`;
    await tx`
      update cube_arena.runs set hidden = true, hidden_reason = coalesce(hidden_reason, 'abandoned: the runner stopped before the end'),
        end_reason = case when status = 'active' then 'stopped' else end_reason end, status = 'finished'
      where suite_id in ${tx(ids)}`;
    await tx`update cube_arena.claims set released_at = now() where suite_id in ${tx(ids)} and released_at is null`;
  });

  // A Gauntlet is played on a closed suite, whose score so far stands: a runner gone quiet there ends only its Gauntlet test,
  // which keeps the levels it reached.
  const gauntlets = await withDb((sql) => sql<{ id: string }[]>`
    select r.id from cube_arena.runs r join cube_arena.suites s on s.id = r.suite_id
    where r.status = 'active' and s.status = 'finished' and s.board = 'verified' and s.updated_at < now() - ${RUNNER_QUIET}::interval
    limit 25`);
  for (const { id } of gauntlets) await stopRun(id, 'abandoned: the runner stopped');

  const idle = await withDb((sql) => sql<{ run_id: string }[]>`
    select a.run_id from cube_arena.attempts a join cube_arena.runs r on r.id = a.run_id
    where a.status = 'active' and r.board = 'community'
      and coalesce((select e.at from cube_arena.events e where e.attempt_id = a.id order by e.id desc limit 1), a.created_at)
          < now() - ${PLAYER_QUIET}::interval
    limit 25`);
  for (const { run_id } of idle) await stopRun(run_id, 'abandoned: no move for a day');

  // Community suites with nothing in play and no next test asked for: the player gave up, which counts.
  await withDb((sql) => sql`
    with gone as (
      update cube_arena.suites s set status = 'finished', finished_at = now()
      where s.status = 'active' and s.board = 'community' and s.updated_at < now() - ${PLAYER_QUIET}::interval
        and not exists (select 1 from cube_arena.runs r where r.suite_id = s.id and r.status = 'active')
      returning s.id
    )
    update cube_arena.claims set released_at = now() where suite_id in (select id from gone) and released_at is null`);
}

/**
 * Ends a run now. The runner calls this when its session ends before the run
 * does, and so does the sweep for abandoned Community cubes. With `quit` the
 * model ended it (it stopped playing, a lockdown breach): that counts as giving
 * up, a result like any other. Otherwise nobody knows why (the CLI crashed, the
 * runner was killed), and the open attempt ends as stopped, which keeps its
 * suite off the boards. `id` is the run id or any of its attempt ids. Returns
 * false if there was no such run or it had already ended.
 */
export async function stopRun(id: string, detail: string, quit = false): Promise<boolean> {
  if (!UUID.test(id)) return false;
  return transaction(async (tx) => {
    const [run] = await tx<RunRow[]>`select * from cube_arena.runs
      where id = coalesce((select run_id from cube_arena.attempts where id = ${id}), ${id}::uuid) for update`;
    if (!run || run.status !== 'active') return false;
    const [a] = await tx<AttemptRow[]>`select * from cube_arena.attempts where run_id = ${run.id} and status = 'active' order by seq desc limit 1 for update`;
    if (!a) {
      await finishRun(tx, run, quit ? 'gave_up' : 'stopped');
      return true;
    }
    await endAttempt(tx, a, quit ? 'gave_up' : 'stopped', detail);
    await tx`insert into cube_arena.events (attempt_id, kind, move_count) values (${a.id}, ${quit ? 'give_up' : 'stop'}, ${a.move_count})`;
    await advance(tx, run, a);
    return true;
  });
}

/**
 * A Verified runner is still playing this suite (or its Gauntlet, played after the suite closed); its claim on the model
 * stays too. Returns false if nothing in it is being played.
 */
export async function heartbeat(suiteId: string): Promise<boolean> {
  if (!UUID.test(suiteId)) return false;
  return transaction(async (tx) => {
    const rows = await tx`update cube_arena.suites s set updated_at = now() where s.id = ${suiteId}
      and (s.status = 'active' or exists (select 1 from cube_arena.runs r where r.suite_id = s.id and r.status = 'active')) returning s.id`;
    if (!rows.length) return false;
    await tx`update cube_arena.claims set expires_at = greatest(expires_at, now() + make_interval(hours => ${CLAIM_HOURS}))
             where suite_id = ${suiteId} and released_at is null`;
    return true;
  });
}

/**
 * Operator only: a session ended through no fault of the model (an API error, a safeguard flag) and a fresh one picked
 * the cube up. The time from `from` (the lost session's start) to `to` (the next one's start) is added to the waiting
 * cube's paused time, which every time shown leaves out. Returns the cube and the seconds added, or null with no cube
 * waiting.
 */
export async function addLostTime(suiteId: string, from: Date, to: Date): Promise<{ attempt: string; secs: number } | null> {
  if (!UUID.test(suiteId) || !(to > from)) return null;
  return transaction(async (tx) => {
    const [a] = await tx<{ id: string; created_at: Date }[]>`
      select a.id, a.created_at from cube_arena.attempts a join cube_arena.runs r on r.id = a.run_id
      where r.suite_id = ${suiteId} and a.status = 'active' order by a.created_at desc limit 1 for update of a`;
    if (!a) return null;
    const start = Math.max(from.getTime(), new Date(a.created_at).getTime());
    const secs = Math.min(24 * 3600, Math.max(0, Math.round((to.getTime() - start) / 1000)));
    if (secs) await tx`update cube_arena.attempts set paused_secs = paused_secs + ${secs} where id = ${a.id}`;
    return { attempt: a.id, secs };
  });
}

/** Operator only: closes a suite now (hidden if a test is missing). Returns its result line, or null if there is no such suite. */
export async function closeSuite(id: string): Promise<string | null> {
  if (!UUID.test(id)) return null;
  return transaction(async (tx) => {
    const [suite] = await tx<SuiteRow[]>`select * from cube_arena.suites where id = ${id} for update`;
    return suite ? finishSuite(tx, suite) : null;
  });
}
