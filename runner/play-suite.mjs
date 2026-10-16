// Plays a suite that already exists on the server, one fresh agent session per
// test, each allowed to touch only its own test. Shared by suite.mjs (the
// operator) and cli.mjs (invitees). A lockdown breach hides the whole suite
// and stops. A test ends when the run does or the model stops playing (that
// counts as giving up). A session ended any other way (an API error, a usage
// limit, a crash) leaves the test open and picks it up again after a wait. A
// test that never starts stops the suite for --resume: a suite with a test
// missing is closed off the boards. Fast closes after its three tests; with
// a perfect score the 4×4 Gauntlet follows on the closed suite. Nothing is timed: while it plays, the
// runner sends a heartbeat so the site can tell a model that is still
// thinking from a runner that died.

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { operator, playSession } from './agent.mjs';

/** How often the runner tells the site it's still playing (it gives up on a suite after 30 quiet minutes). */
const HEARTBEAT_MS = 5 * 60_000;
/** After an API error, a usage limit or a crash, minutes to wait before picking the test up again; then hourly. */
const RETRY_MINUTES = [1, 5, 15, 30, 60];
/** How long to keep retrying before leaving the suite for --resume. */
const RETRY_HOURS = 12;

/**
 * p: { url, token, suite, tests, played (Set of slots done), session: { agent, model, effort, codexHome?, api? },
 *      logDir, transcript (upload audit digests) }
 * Returns { breach, result, suite } once the suite is closed (or stopped by a breach).
 */
export async function playSuite(p) {
  const call = operator(p.url, p.token);
  mkdirSync(p.logDir, { recursive: true });
  const { suite } = p;
  const started = Date.now();
  const beat = () => call('/api/admin/suites', { id: suite.id, alive: true }).catch((e) => console.log(`  (heartbeat failed: ${e.message})`));
  beat();
  const heart = setInterval(beat, HEARTBEAT_MS);
  try {
    return await playTests(p, call, started);
  } finally {
    clearInterval(heart);
  }
}

/** "2×2 ladder, interactive", or "4×4 Gauntlet ladder, one-shot (20 levels)". */
function describe(t) {
  const mode = t.mode === 'one_shot' ? 'one-shot' : 'interactive';
  if (t.gauntlet) return `${t.size}×${t.size} Gauntlet ladder, ${mode} (${t.levels} levels${t.startDepth > 1 ? `, level 1 is ${t.startDepth} moves from solved` : ''})`;
  return `${t.size}×${t.size} ${t.challenge === 'ladder' ? 'ladder' : 'full scramble'}, ${mode}`;
}

/**
 * The tests everyone plays, then the suite closes with that score. A perfect
 * score unlocks the Gauntlet (the server says so in the suite's grade): its
 * tests follow, and the suite closes again with them counted. Anything less
 * ends the suite after the tests everyone plays.
 */
async function playTests(p, call, started) {
  const { suite, tests } = p;
  const all = tests.map((t, i) => ({ t, i }));
  const base = all.filter(({ t }) => !t.gauntlet);
  const gauntlet = all.filter(({ t }) => t.gauntlet);
  const stop = await playSlots(p, base, 'test');
  if (stop) return stop;
  let { result, suite: done } = await call('/api/admin/suites', { id: suite.id, finish: true });
  console.log(`\n${result}`);
  const state = done.grade?.gauntlet ?? null;
  if (gauntlet.length && (state === 'pending' || state === 'playing')) {
    console.log(`\n*** 100 on all three: the ${gauntlet[0].t.size}×${gauntlet[0].t.size} Gauntlet is unlocked ***`);
    const g = await playSlots(p, gauntlet, 'Gauntlet');
    if (g) return g;
    ({ result, suite: done } = await call('/api/admin/suites', { id: suite.id, finish: true }));
    console.log(`\n${result}`);
  } else if (gauntlet.length && state === 'locked') {
    console.log('The Gauntlet takes 100 on all three tests, so the suite ends here.');
  }
  for (const t of done.grade?.tests ?? []) console.log(`  ${t.test.padEnd(26)} ${t.score === null ? '-' : t.score.toFixed(1).padStart(5)}  (${t.played}/${t.cubes} cubes)`);
  console.log(`total ${((Date.now() - started) / 60_000).toFixed(1)} min`);
  return { breach: null, result, suite: done };
}

/** Plays these slots in order, skipping those already played. Returns null when all are over, else why it stopped. */
async function playSlots(p, slots, label) {
  const { suite } = p;
  for (const [k, { t, i }] of slots.entries()) {
    if (p.played.has(i)) continue;
    const what = describe(t);
    console.log(`\n=== ${label} ${k + 1}/${slots.length}: ${what} ===`);
    let waited = 0;
    // When a session is lost through no fault of the model, its time and the wait are left out of the cube's time.
    let lostFrom = null;
    for (let tries = 0; ; tries++) {
      const started = new Date();
      if (lostFrom)
        await call('/api/admin/suites', { id: suite.id, lost: { from: lostFrom.toISOString(), to: started.toISOString() } })
          .then((x) => x.lost && console.log(`  ${Math.round(x.lost.secs / 60)} min left out of the cube's time (not the model's doing)`))
          .catch((e) => console.log(`  (could not leave the lost time out: ${e.message})`));
      lostFrom = null;
      const stamp = started.toISOString().replace(/[:.]/g, '-');
      const prompt =
        `Let's play Cube Arena. First call get_rules. Then call next_test with suite_id "${suite.id}": it ${tries ? 'picks your test back up where the cube was left' : 'starts your test'} ` +
        `(${label === 'test' ? 'test' : `${label} test`} ${k + 1} of ${slots.length}: ${what}, no time limit). Solve each cube from the pictures only, in as few moves as you can. ` +
        'Play until this test ends, then stop and reply with your result in one line. Do not start another test.';
      const r = await playSession({
        ...p.session,
        prompt,
        headers: { 'x-arena-model': suite.model_name, 'x-arena-tool-use': 'model_only', 'x-arena-name': suite.display_name, 'x-arena-suite-slot': String(i) },
        url: p.url,
        token: p.token,
        logPath: join(p.logDir, `${stamp}-${suite.model_id ?? 'model'}-${p.session.effort ?? 'default'}-${suite.kind}-${i + 1}.jsonl`),
        transcript: p.transcript,
      });
      const cost = r.usage.cost_usd !== undefined ? `, $${r.usage.cost_usd.toFixed(2)}` : '';
      const tokens = r.usage.output_tokens !== undefined ? `, ${r.usage.input_tokens ?? 0} in / ${r.usage.output_tokens} out tokens` : '';
      console.log(`  done in ${r.minutes.toFixed(1)} min, ${r.calls} tool calls${tokens}${cost}`);
      if (r.last) console.log(`  best level ${r.last.best_level}, replay ${r.last.replay_url ?? '-'}`);
      if (r.breach) {
        console.log(`!!! lockdown broken (${r.breach}); the suite is hidden. Stopping.`);
        return { breach: r.breach, result: null, suite };
      }
      if (!r.retry && r.runId) break;
      if (!r.retry) {
        const why = r.stopReason ?? (r.quit ? 'the model ended without starting it' : `the agent ended, exit ${r.code}`);
        console.log(`!!! ${label} ${k + 1} never started (${why}). Stopping; carry on with --resume ${suite.id} within 30 minutes.`);
        return { breach: null, result: null, suite, stopped: why };
      }
      // Not the model's doing: the cube waits where it is, and a fresh session picks it up.
      const wait = RETRY_MINUTES[Math.min(tries, RETRY_MINUTES.length - 1)];
      if (waited + wait > RETRY_HOURS * 60) {
        console.log(`!!! still failing after ${RETRY_HOURS} h (${r.retry}). Stopping; carry on with --resume ${suite.id} within 30 minutes.`);
        return { breach: null, result: null, suite, stopped: r.retry };
      }
      console.log(`  not the model's doing (${r.retry}). Trying this test again in ${wait} min; the cube waits where it is.`);
      lostFrom = started;
      await new Promise((res) => setTimeout(res, wait * 60_000));
      waited += wait;
    }
  }
  return null;
}
