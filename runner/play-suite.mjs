// Plays a suite that already exists on the server, one fresh agent session per
// test, each allowed to touch only its own test. Shared by suite.mjs (the
// operator) and cli.mjs (invitees). A lockdown breach hides the whole suite
// and stops; tests the agent never started count 0. Nothing is timed: while
// it plays, the runner sends a heartbeat so the site can tell a model that is
// still thinking from a runner that died.

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { operator, playSession } from './agent.mjs';

/** How often the runner tells the site it's still playing (it gives up on a suite after 30 quiet minutes). */
const HEARTBEAT_MS = 5 * 60_000;

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

async function playTests(p, call, started) {
  const { suite, tests } = p;
  for (const [i, t] of tests.entries()) {
    if (p.played.has(i)) continue;
    const what = `${t.size}×${t.size} ${t.challenge === 'ladder' ? 'ladder' : 'full scramble'}, ${t.mode === 'one_shot' ? 'one-shot' : 'interactive'}`;
    console.log(`\n=== test ${i + 1}/${tests.length}: ${what} ===`);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const prompt =
      `Let's play Cube Arena. First call get_rules. Then call next_test with suite_id "${suite.id}": it starts your test ` +
      `(test ${i + 1} of ${tests.length}: ${what}, no time limit). Solve each cube from the pictures only, in as few moves as you can. ` +
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
    if (!r.runId) console.log('  !! the agent never started this test; it counts 0');
    if (r.code && !r.runId && r.stopReason?.startsWith('API error')) {
      console.log(`!!! ${r.stopReason}. Stopping; resume later with --resume ${suite.id}`);
      return { breach: null, result: null, suite, stopped: r.stopReason };
    }
    if (r.breach) {
      console.log(`!!! lockdown broken (${r.breach}); the suite is hidden. Stopping.`);
      return { breach: r.breach, result: null, suite };
    }
  }

  const { result, suite: done } = await call('/api/admin/suites', { id: suite.id, finish: true });
  console.log(`\n${result}`);
  for (const t of done.grade?.tests ?? []) console.log(`  ${t.test.padEnd(26)} ${t.score === null ? '-' : t.score.toFixed(1).padStart(5)}  (${t.played}/${t.cubes} cubes)`);
  console.log(`total ${((Date.now() - started) / 60_000).toFixed(1)} min`);
  return { breach: null, result, suite: done };
}
