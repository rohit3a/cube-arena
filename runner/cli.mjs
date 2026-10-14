#!/usr/bin/env node
// cube-arena-runner: play Cube Arena Index suites with your own model access,
// locked down to the cube tools, and post them to the Verified board with an
// invite code. https://cube.krnl.studio/wanted . Also the coding benchmark:
// the model writes its own 5x5 solver, graded on hidden cubes (code.mjs).
//
//   npm install -g https://cube.krnl.studio/runner/cube-arena-runner-<version>.tgz
//   cube-arena-runner login AB12-CD34
//   cube-arena-runner wanted
//   cube-arena-runner play --model gemini-3-1-pro-preview --effort high
//   cube-arena-runner code --model claude-opus-5-5 --effort max

import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { operator } from './agent.mjs';
import { claimMachine, claudeSandboxProblem, playCoding, setUpWorkspace, waitForGrade } from './code.mjs';
import { playCoding2 } from './code2.mjs';
import { commandFor } from './command.mjs';
import { cursorBin, cursorModels, cursorSignedIn, cursorSlug } from './cursor.mjs';
import { playSuite } from './play-suite.mjs';

const VERSION = '0.6.1';
const DEFAULT_URL = 'https://cube.krnl.studio/mcp';
const HOME = process.env.CUBE_ARENA_HOME || join(homedir(), '.cube-arena');
const CONFIG = join(HOME, 'config.json');
const VIA = ['claude-code', 'codex', 'cursor', 'muse', 'openrouter', 'api'];

const HELP = `cube-arena-runner ${VERSION}: run Cube Arena Index suites for the Verified board.

  login <code> [--show-name | --hide-name] [--name <name>]   save your invite code (once)
  profile [--name <name>] [--x <handle> | --no-x]            your name and X handle on the boards
  whoami                                      who your code belongs to
  wanted [--suite thorough] [--all]           what still needs running
  models                                      every model the runner knows
  play --model <id> [options]                 play a suite and post the result
  code --model <id> [options]                 the coding benchmark: the model writes a 5x5 solver
  logout                                      forget your code

play options:
  --effort <level>         low, medium, high, xhigh or max (what the model takes; see wanted)
  --suite fast|thorough    default fast (three ladders, then the 4×4 Gauntlet after a perfect 100); thorough is every test (many hours)
  --via <how>              claude-code, codex, cursor, muse, openrouter or api (default: the first you have)
  --base-url <url>         with --via api: an OpenAI-compatible endpoint, e.g. https://api.x.ai/v1
  --api-key-env <NAME>     with --via api: the environment variable holding its key
  --api-model <id>         with --via api: the model's id on that endpoint
  --codex-home <dir>       a Codex home just for this (default ~/.cube-arena/codex)
  --cursor-home <dir>      Cursor's config and data for the runner (default ~/.cube-arena/cursor)
  --resume <suite id>      carry on a suite that stopped part way, or play the Gauntlet a suite unlocked
  --force                  play even if someone else has claimed this one
  --no-transcript          don't upload the session logs (they help us check results)

code options (macOS or Linux; the model codes in a sandbox with no network):
  --effort, --via claude-code|codex, --codex-home   as for play
  --resume <submission id> carry on coding after the runner stopped part way
  --no-wait                don't wait for the grade (it shows on the site)

Your keys stay on your machine: the runner talks to the model provider directly,
and only sends Cube Arena the moves, token counts and a text log of each session.
Install or update it from https://cube.krnl.studio/wanted.`;

const fail = (msg) => {
  console.error(msg);
  process.exit(2);
};

const readConfig = () => {
  try {
    return JSON.parse(readFileSync(CONFIG, 'utf8'));
  } catch {
    return {};
  }
};
const writeConfig = (c) => {
  mkdirSync(HOME, { recursive: true });
  writeFileSync(CONFIG, `${JSON.stringify(c, null, 2)}\n`, { mode: 0o600 });
  chmodSync(CONFIG, 0o600);
};

const has = (cmd) => {
  try {
    const run = commandFor(cmd, ['--version']);
    execFileSync(run.file, run.args, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

async function ask(question) {
  if (!process.stdin.isTTY) return '';
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

async function get(site, path, token, body) {
  const res = await fetch(`${site}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { ...(token && { Authorization: `Bearer ${token}` }), ...(body && { 'Content-Type': 'application/json' }) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `${path}: ${res.status}`);
  return json;
}

/** "3 tests" or "3 tests, then 2 Gauntlet tests after a perfect score". */
function testCount(tests) {
  const g = tests.filter((t) => t.gauntlet).length;
  const base = tests.length - g;
  return `${base} test${base === 1 ? '' : 's'}${g ? `, then ${g} Gauntlet tests after a perfect score` : ''}`;
}

/** Says so when the site has a newer runner than this one. */
function newer(runner) {
  if (runner?.version && runner.version !== VERSION) console.error(`cube-arena-runner ${runner.version} is out (this is ${VERSION}). Update with:\n  ${runner.install}\n`);
}

/** Sets the X handle shown on the contributors board ("" clears it). */
async function setX(code, handle) {
  const me = await get(site, '/api/me', code, { x_handle: handle }).catch((e) => fail(e.message));
  console.log(me.x_handle ? `X handle set to @${me.x_handle}.` : 'X handle cleared.');
  return me;
}

/** Sets the name shown next to your results. */
async function setName(code, name) {
  const me = await get(site, '/api/me', code, { name }).catch((e) => fail(e.message));
  console.log(`Name set to ${me.name}.`);
  return me;
}

/** An invite made without a name starts as this; login asks for a real one. */
const UNNAMED = 'Invitee';

const [command, ...rest] = process.argv.slice(2);
const { values: opt, positionals } = parseArgs({
  args: rest,
  allowPositionals: true,
  options: {
    model: { type: 'string' },
    effort: { type: 'string' },
    suite: { type: 'string', default: 'fast' },
    via: { type: 'string' },
    'base-url': { type: 'string' },
    'api-key-env': { type: 'string' },
    'api-model': { type: 'string' },
    'codex-home': { type: 'string' },
    'cursor-home': { type: 'string' },
    resume: { type: 'string' },
    force: { type: 'boolean', default: false },
    'no-transcript': { type: 'boolean', default: false },
    'no-wait': { type: 'boolean', default: false },
    bench: { type: 'string' },
    'show-name': { type: 'boolean' },
    'hide-name': { type: 'boolean' },
    name: { type: 'string' },
    x: { type: 'string' },
    'no-x': { type: 'boolean', default: false },
    all: { type: 'boolean', default: false },
    url: { type: 'string' },
  },
});

const config = readConfig();
const url = opt.url ?? process.env.CUBE_ARENA_URL ?? config.url ?? DEFAULT_URL;
const site = url.replace(/\/mcp\/?$/, '');
// An invite code from login or CUBE_INVITE; the operator's token works too.
const token = process.env.CUBE_INVITE || config.invite || process.env.CUBE_OPERATOR_TOKEN || null;

if (!command || command === 'help' || command === '--help' || command === '-h') {
  console.log(HELP);
} else if (command === '--version' || command === 'version') {
  console.log(VERSION);
} else if (command === 'login') {
  const code = positionals[0];
  if (!code) fail('Usage: cube-arena-runner login AB12-CD34');
  let me;
  try {
    ({ me } = await get(site, '/api/admin/suites?limit=1', code));
  } catch (e) {
    fail(`That code didn't work: ${e.message}`);
  }
  let credit = opt['show-name'] ? true : opt['hide-name'] ? false : null;
  const hi = me.name === UNNAMED ? 'Hi!' : `Hi ${me.name}!`;
  if (credit === null) credit = /^y/i.test(await ask(`${hi} Show your name next to your results on the boards? [y/N] `));
  if (credit) {
    let name = opt.name;
    while (!name) {
      name = (await ask(me.name === UNNAMED ? 'Your name for the boards: ' : `Your name for the boards (Enter for ${me.name}): `)).trim();
      if (!name && me.name !== UNNAMED) name = me.name;
    }
    if (name !== me.name) ({ name: me.name } = await setName(code, name));
  }
  writeConfig({ ...config, invite: code, credit, url: opt.url ?? config.url });
  console.log(`Saved to ${CONFIG}. Your results will show ${credit ? `"run by ${me.name}"` : '"run by an invited tester"'}.`);
  if (credit) {
    const handle = opt.x ?? (await ask('Your X handle, linked from the contributors board (optional, Enter to skip): '));
    const { profile } = handle ? await setX(code, handle) : await get(site, '/api/me', code);
    console.log(`Once a suite finishes, you're on ${site}/contributors (your page: ${profile}).`);
  }
  console.log('Next: cube-arena-runner wanted');
} else if (command === 'logout') {
  if (existsSync(CONFIG)) rmSync(CONFIG);
  console.log('Forgot your invite code.');
} else if (command === 'whoami') {
  if (!token) fail('No invite code yet: cube-arena-runner login AB12-CD34');
  const me = await get(site, '/api/me', token).catch((e) => fail(e.message));
  console.log(`${me.name} (${me.role}), names ${config.credit ? 'shown' : 'hidden'}${me.x_handle ? `, @${me.x_handle} on X` : ''}, ${site}`);
  if (me.profile && config.credit) console.log(`Your page: ${me.profile}`);
} else if (command === 'profile') {
  if (!token) fail('No invite code yet: cube-arena-runner login AB12-CD34');
  if (opt.name) await setName(token, opt.name);
  const me = opt['no-x'] ? await setX(token, '') : opt.x ? await setX(token, opt.x) : await get(site, '/api/me', token).catch((e) => fail(e.message));
  if (!opt.x && !opt['no-x'] && !opt.name) console.log(`${me.name}${me.x_handle ? ` (@${me.x_handle})` : ', no X handle yet (add one: profile --x yourhandle)'}`);
  if (me.profile) console.log(config.credit ? `Your page: ${me.profile}` : 'Your name is hidden on results, so you are not on the contributors board. To show it: login <code> --show-name');
} else if (command === 'models') {
  const { models, runner } = await get(site, '/api/catalog');
  newer(runner);
  for (const m of models.filter((x) => opt.all || x.wanted)) {
    console.log(`${m.id.padEnd(28)} ${m.name.padEnd(28)} ${m.maker.padEnd(18)} ${(m.efforts.join(' ') || '-').padEnd(30)} via ${Object.keys(m.via).join(', ')}`);
  }
} else if (command === 'wanted') {
  const { rows } = await get(site, '/api/wanted', token);
  const kind = opt.suite === 'thorough' ? 'thorough' : 'fast';
  const list = rows.filter((r) => r.kind === kind && (opt.all || (r.runs === 0 && !r.claim)));
  if (list.length === 0) console.log(opt.all ? 'Nothing listed.' : 'Everything has a result or a claim. Add --all to see them.');
  for (const r of list) {
    const status = r.runs ? `${r.runs} run${r.runs > 1 ? 's' : ''}, ${r.mean.toFixed(1)}` : r.claim ? `claimed${r.claim.by ? ` by ${r.claim.by}` : ''}${r.claim.mine ? ' (you)' : ''}` : 'needed';
    console.log(`${`${r.name}${r.effort ? ` (${r.effort})` : ''}`.padEnd(36)} ${status.padEnd(26)} ${r.command}`);
  }
  // Suites of yours that scored 100 and haven't played the Gauntlet they unlocked.
  const mine = rows.flatMap((r) => (r.gauntlets ?? []).filter((g) => g.mine).map((g) => ({ ...g, name: `${r.name}${r.effort ? ` (${r.effort})` : ''}` })));
  if (mine.length) {
    console.log('\nYour suites with the 4×4 Gauntlet unlocked and not played yet:');
    for (const g of mine) console.log(`${g.name.padEnd(36)} ${`${g.score?.toFixed(1) ?? '-'} so far`.padEnd(26)} ${g.command}`);
  }
} else if (command === 'play') {
  await play();
} else if (command === 'code') {
  await code();
} else {
  fail(`Unknown command "${command}".\n\n${HELP}`);
}

/** The catalog model and effort asked for, checked. */
async function modelAndEffort() {
  if (!token) fail('No invite code yet. Run: cube-arena-runner login AB12-CD34');
  if (!opt.model) fail('--model is required. See: cube-arena-runner wanted');
  const { models, runner } = await get(site, '/api/catalog');
  newer(runner);
  const model = models.find((m) => m.id === opt.model);
  if (!model) fail(`"${opt.model}" isn't in the catalog. See: cube-arena-runner models`);
  const effort = opt.effort ?? null;
  if (model.efforts.length && !model.efforts.includes(effort)) fail(`${model.name} takes --effort ${model.efforts.join(', ')}`);
  if (!model.efforts.length && effort) fail(`${model.name} has no effort setting; leave out --effort`);
  return { model, effort };
}

/** A Codex home of its own, so your config, AGENTS.md, skills and memories don't reach the model. */
function codexHomeFor() {
  const codexHome = opt['codex-home'] ?? join(HOME, 'codex');
  mkdirSync(codexHome, { recursive: true });
  if (!existsSync(join(codexHome, 'auth.json'))) {
    const login = process.platform === 'win32' ? `$env:CODEX_HOME="${codexHome}"; codex login; Remove-Item Env:CODEX_HOME` : `CODEX_HOME=${codexHome} codex login`;
    fail(`Sign Codex in for the runner once (its own home, so nothing else of yours leaks in):\n  ${login}`);
  }
  return codexHome;
}

async function play() {
  if (!['fast', 'thorough'].includes(opt.suite)) fail('--suite must be fast or thorough');
  const { model, effort } = await modelAndEffort();

  // How to reach the model: what you asked for, else the first that works here.
  const via = opt.via ?? (opt['base-url'] ? 'api' : pickVia(model));
  if (!VIA.includes(via)) fail(`--via must be one of ${VIA.join(', ')}`);
  let session;
  let harness = via;
  if (via === 'claude-code') {
    if (!model.via['claude-code']) fail(`${model.name} doesn't run in Claude Code.`);
    if (!has('claude')) fail('Claude Code is not installed: https://claude.com/claude-code');
    session = { agent: 'claude', model: model.via['claude-code'], effort };
  } else if (via === 'codex') {
    if (!model.via.codex) fail(`${model.name} doesn't run in Codex.`);
    if (!has('codex')) fail('Codex is not installed: npm i -g @openai/codex');
    session = { agent: 'codex', model: model.via.codex, effort, codexHome: codexHomeFor() };
  } else if (via === 'cursor') {
    session = cursorSession(model, effort);
  } else if (via === 'muse') {
    if (!model.via.muse) fail(`${model.name} isn't in Muse Code.`);
    if (!has('muse')) fail("Muse Code (Meta's CLI) is not installed.");
    const billed = process.env.META_API_KEY ? 'META_API_KEY, billed per token' : 'your Muse Code plan (muse login)';
    console.log(`Muse Code model ${model.via.muse}, contributor mode off. It runs on ${billed}.`);
    session = { agent: 'muse', model: model.via.muse, effort };
  } else if (via === 'openrouter') {
    if (!model.via.openrouter) fail(`${model.name} isn't on OpenRouter; try --via api with the provider's endpoint.`);
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) fail('Set OPENROUTER_API_KEY (https://openrouter.ai/keys).');
    session = { agent: 'api', model: model.via.openrouter, effort, api: { baseUrl: 'https://openrouter.ai/api/v1', apiKey, provider: 'openrouter' } };
  } else {
    const baseUrl = opt['base-url'];
    const keyEnv = opt['api-key-env'];
    const apiModel = opt['api-model'];
    if (!baseUrl || !keyEnv || !apiModel) fail('--via api needs --base-url, --api-key-env and --api-model.');
    if (!process.env[keyEnv]) fail(`${keyEnv} is not set.`);
    const host = new URL(baseUrl).host;
    harness = `api:${host}`;
    session = { agent: 'api', model: apiModel, effort, api: { baseUrl: baseUrl.replace(/\/$/, ''), apiKey: process.env[keyEnv], provider: host === 'openrouter.ai' ? 'openrouter' : 'openai-compatible' } };
  }

  const call = operator(url, token);
  let suite;
  let tests;
  let played = new Set();
  if (opt.resume) {
    ({ suite, tests } = await call(`/api/admin/suites?id=${opt.resume}`));
    if (suite.model_id !== model.id || (suite.effort ?? null) !== effort || suite.kind !== opt.suite) {
      fail(`That suite is ${suite.kind} for ${suite.model_name}, not ${opt.suite} for ${model.name}${effort ? ` (${effort})` : ''}.`);
    }
    // A finished suite carries on only into a Gauntlet it unlocked and hasn't played.
    const gauntlet = suite.grade?.gauntlet;
    if (suite.status === 'finished' && gauntlet !== 'pending' && gauntlet !== 'playing') {
      fail(gauntlet === 'locked' ? 'That suite is finished: it scored under 100, so its Gauntlet stays locked.' : 'That suite is already finished.');
    }
    played = new Set(suite.slots_played ?? []);
  } else {
    // Someone else on it already? Then pick another row, unless --force.
    const { claims } = await get(site, '/api/claims', token);
    const held = claims.find((c) => c.model_id === model.id && (c.effort ?? null) === effort && c.kind === opt.suite && !c.mine);
    if (held && !opt.force) fail(`${held.by ?? 'Someone'} claimed this one until ${new Date(held.expires_at).toLocaleString()}. Pick another (cube-arena-runner wanted), or add --force.`);
    ({ suite, tests } = await call('/api/admin/suites', { kind: opt.suite, model_id: model.id, effort, harness, credit: !!config.credit }).catch((e) => fail(e.message)));
  }

  console.log(`${suite.model_name} via ${harness}: ${opt.suite} suite ${suite.version}, ${testCount(tests)} → ${site}`);
  console.log(`suite ${suite.id} (resume with --resume ${suite.id})`);
  const r = await playSuite({
    url,
    token,
    suite,
    tests,
    played,
    session,
    logDir: join(HOME, 'logs'),
    transcript: !opt['no-transcript'],
  });
  if (r.result) console.log(`\nThanks! Results: ${site}/suites/${suite.id}`);
  process.exit(r.breach ? 3 : r.result ? 0 : 1);
}

/**
 * A Cursor session for this model and effort: the full Cursor id from your
 * account's model list, checked before anything starts.
 */
function cursorSession(model, effort) {
  if (!model.via.cursor) fail(`${model.name} isn't in Cursor.`);
  if (process.platform === 'win32') fail('--via cursor needs macOS or Linux (on Windows, use WSL).');
  const bin = cursorBin();
  if (!bin) fail("Cursor's CLI is not installed: curl https://cursor.com/install -fsS | bash");
  const cursorHome = opt['cursor-home'] ?? join(HOME, 'cursor');
  mkdirSync(cursorHome, { recursive: true });
  const env = { ...process.env, CURSOR_CONFIG_DIR: join(cursorHome, 'config'), CURSOR_DATA_DIR: join(cursorHome, 'data') };
  if (!cursorSignedIn(bin, env)) fail(`Sign Cursor's CLI in first: ${bin} login`);
  let list;
  try {
    list = cursorModels(bin, env);
  } catch (e) {
    fail(`Couldn't list your Cursor models: ${String(e.stderr || e.message).trim().slice(0, 300)}`);
  }
  const found = cursorSlug(model.via.cursor, effort, list);
  if (!found.slug) {
    if (!found.efforts.length) fail(`Your Cursor plan doesn't list ${model.name} (${model.via.cursor}). See: ${bin} models`);
    fail(`Cursor has ${model.name} at ${found.efforts.join(', ')}, not ${effort ?? 'its default'}.`);
  }
  console.log(`Cursor model ${found.slug} (${found.name}). It runs on your Cursor plan's usage.`);
  return { agent: 'cursor', model: found.slug, modelName: found.name, effort, cursorBin: bin, cursorHome };
}

/** The coding benchmark: the model writes a 5x5 solver here, Cube Arena grades it. */
async function code() {
  if (process.platform === 'win32') fail("The coding benchmark needs macOS or Linux (on Windows, use WSL): the agent's sandbox doesn't run on Windows.");
  const { model, effort } = await modelAndEffort();
  const via = opt.via ?? (model.via['claude-code'] && has('claude') ? 'claude-code' : model.via.codex && has('codex') ? 'codex' : null);
  if (!via) fail(`The coding benchmark runs through Claude Code or Codex for now; ${model.name} runs via ${Object.keys(model.via).join(', ')}.`);
  if (!['claude-code', 'codex'].includes(via) || !model.via[via]) fail(`--via must be ${['claude-code', 'codex'].filter((h) => model.via[h]).join(' or ')} for ${model.name}.`);
  let session;
  if (via === 'claude-code') {
    if (!has('claude')) fail('Claude Code is not installed: https://claude.com/claude-code');
    const problem = claudeSandboxProblem();
    if (problem) fail(problem);
    session = { agent: 'claude', model: model.via['claude-code'], effort };
  } else {
    if (!has('codex')) fail('Codex is not installed: npm i -g @openai/codex');
    session = { agent: 'codex', model: model.via.codex, effort, codexHome: codexHomeFor() };
  }

  mkdirSync(join(HOME, 'code'), { recursive: true });
  const lock = join(HOME, 'code', 'running.json');
  const held = claimMachine(lock, opt.resume ?? null);
  if (held) {
    fail(
      `Another coding run is going on this machine (${held.id ? `submission ${held.id}, ` : ''}runner pid ${held.pid}). ` +
        'Coding runs go one at a time, so each model has the machine to itself: start this one when that one ends.',
    );
  }
  const call = operator(site, token);
  let submission;
  if (opt.resume) {
    ({ submission } = await call(`/api/code/submissions?id=${opt.resume}`).catch((e) => fail(e.message)));
    if (submission.model_id !== model.id || (submission.effort ?? null) !== effort) fail(`That submission is for ${submission.model_name}, not ${model.name}${effort ? ` (${effort})` : ''}.`);
    if (submission.status !== 'coding') {
      if (opt['no-wait']) fail(`That submission is ${submission.status}; nothing to carry on.`);
      console.log(`That submission is ${submission.status}; waiting for its grade.`);
      return report(await waitForGrade(call, submission.id, 180));
    }
  } else {
    const version = opt.bench;
    if (version && !['v2', 'v2-mini'].includes(version)) fail('--bench must be v2 or v2-mini');
    ({ submission } = await call('/api/code/submissions', { model_id: model.id, effort, harness: via, credit: !!config.credit, ...(version && { version }) }).catch((e) =>
      fail(e.message),
    ));
  }
  writeFileSync(lock, `${JSON.stringify({ pid: process.pid, id: submission.id })}\n`);
  const dir = join(HOME, 'code', submission.id);
  if (submission.version === 'v2' || submission.version === 'v2-mini') {
    console.log(`${submission.model_name} via ${via}: coding benchmark ${submission.version}, three stages (centres, edges, finish) → ${site}`);
    console.log(`submission ${submission.id} (resume with --resume ${submission.id})`);
    console.log(`workspaces ${dir}/<stage>`);
    const r2 = await playCoding2({
      site,
      token,
      submission,
      session,
      bench: submission.version,
      root: dir,
      stateFile: join(HOME, 'code', `${submission.id}.json`),
      logDir: join(HOME, 'logs'),
      transcript: !opt['no-transcript'],
      wait: opt['no-wait'] ? 0 : 600,
    });
    if (r2.breach) process.exit(3);
    if (r2.stopped) process.exit(1);
    return report(r2.submission);
  }
  const { limits } = await setUpWorkspace(site, dir).catch((e) => fail(e.message));
  console.log(`${submission.model_name} via ${via}: coding benchmark ${limits.version}, ${limits.devHours} h to write a 5×5 solver → ${site}`);
  console.log(`submission ${submission.id} (resume with --resume ${submission.id})`);
  console.log(`workspace ${dir}`);
  const r = await playCoding({
    site,
    token,
    submission,
    session,
    dir,
    stateFile: join(HOME, 'code', `${submission.id}.json`),
    logDir: join(HOME, 'logs'),
    limits,
    transcript: !opt['no-transcript'],
    wait: opt['no-wait'] ? 0 : 180,
  });
  if (r.breach) process.exit(3);
  if (r.stopped) process.exit(1);
  report(r.submission);

  function report(s) {
    if (s?.status === 'graded' && s.parts) {
      const parts = ['centres', 'edges', 'finish', 'e2e'].map((k) => `${k} ${(100 * s.parts[k].score).toFixed(1)}`).join(', ');
      console.log(`\nscore ${Number(s.score).toFixed(1)} (${parts}); ${s.solved}/${s.cases} cases met the goal within the limits.`);
    } else if (s?.status === 'graded') {
      console.log(`\n${s.solved}/${s.cases} hidden cubes solved, score ${Number(s.score).toFixed(2)}${s.mean_moves ? `, ${Number(s.mean_moves).toFixed(1)} moves per solve` : ''}.`);
    } else if (s?.status === 'failed') console.log(`\nThe grader could not run it (${s.error}). We'll look into it.`);
    else console.log('\nStill waiting for the grader; the result will show on the site.');
    console.log(`${site}/code/${submission.id}`);
    process.exit(s?.status === 'graded' ? 0 : 1);
  }
}

function pickVia(model) {
  if (model.via['claude-code'] && has('claude')) return 'claude-code';
  if (model.via.codex && has('codex')) return 'codex';
  if (model.via.cursor && process.platform !== 'win32' && cursorBin()) return 'cursor';
  if (model.via.muse && has('muse')) return 'muse';
  if (model.via.openrouter && process.env.OPENROUTER_API_KEY) return 'openrouter';
  const ways = Object.keys(model.via).join(', ');
  return fail(`No way to reach ${model.name} here. It runs via ${ways}: install that CLI, or set OPENROUTER_API_KEY, or use --via api.`);
}
