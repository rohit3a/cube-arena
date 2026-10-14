// Coding v2 from the runner's side: the NxN ladder. The model writes three
// programs, one per stage (centres, edges, finish), each in a fresh session
// and a fresh workspace of its own; nothing carries over between stages. Each
// stage's folder is frozen and sent when its session ends; Cube Arena grades
// the three on hidden cubes, each stage alone and chained end to end.
//
// The lockdown, the sandbox and the retries are code.mjs's. What is new: a
// stage has its own time, and a model that ends its turn with more than a
// quarter of that left gets one message, the same words for every model,
// saying how long is left (its session picked up again, so it keeps its
// context). Ending again, or replying DONE, submits.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { operator } from './agent.mjs';
import { endLeftovers, tieToRunner } from './children.mjs';
import { takeCodexSession } from './codex-session.mjs';
import { codingSession, packSolver, waitForGrade } from './code.mjs';

export const STAGES = ['centres', 'edges', 'finish'];
const RETRY_MINUTES = [1, 5, 15, 30, 60];
const RETRY_HOURS = 12;
const HEARTBEAT_MS = 5 * 60_000;
const PACK_FIXES = 2;
const PACK_GRACE_MS = 10 * 60_000;
const mb = (n) => `${(n / 1e6).toFixed(1)} MB`;

const DOES = { centres: 'solves its centres', edges: 'pairs its edges (keeping the centres solved)', finish: 'solves it' };
const INPUT = {
  centres: 'a scrambled cube',
  edges: 'a cube whose centres are solved',
  finish: 'a cube whose centres are solved and edges paired',
};

/** The stage's kit in a fresh workspace: SPEC.md, cube.py, check.py, practice.json, and an empty <stage>/. */
export async function setUpStage(site, bench, stage, dir) {
  mkdirSync(join(dir, stage), { recursive: true });
  const res = await fetch(`${site}/api/code?version=${bench}&stage=${stage}`);
  if (!res.ok) throw new Error(`could not get the ${stage} kit: ${res.status}`);
  const kit = await res.json();
  for (const url of kit.files) {
    const name = url.split('/').pop();
    if (existsSync(join(dir, name))) continue;
    const f = await fetch(url);
    if (!f.ok) throw new Error(`could not get ${name}: ${f.status}`);
    writeFileSync(join(dir, name), await f.text());
  }
  return kit;
}

const clock = (ms) => new Date(Date.now() + ms).toISOString().slice(11, 16);
const mins = (ms) => Math.max(0, Math.floor(ms / 60_000));

function stagePrompt(stage, k, limits, remainingMs) {
  const sizes = `${limits.sizes[0]}×${limits.sizes[0]} to ${limits.sizes.at(-1)}×${limits.sizes.at(-1)}`;
  return (
    `You're taking the Cube Arena coding benchmark, stage ${k} of 3: ${stage}. Read SPEC.md in this folder first. ` +
    `Write ${stage}/solve.py, a program that takes ${INPUT[stage]} of any size from ${sizes} and prints moves that ${DOES[stage]}. ` +
    `It is graded on ${limits.casesPerSize} hidden cubes per size, each with a move cap and a CPU-time limit; meeting the goal on every cube matters most, ` +
    'then fewer moves. Work on your own, with no internet access; test with `python3 check.py` and keep improving while you have time. ' +
    `You have ${mins(remainingMs)} min (until ${clock(remainingMs)} UTC; \`date -u\` tells the time). ` +
    `Nobody will answer questions during the run: when you end your turn, ${stage}/ is frozen and submitted as it stands.`
  );
}

function retryPrompt(stage, remainingMs) {
  return (
    'Your last session was cut off by an error that was not your doing. Your files are exactly as you left them. ' +
    `Carry on with this stage of the Cube Arena coding benchmark (SPEC.md) where you were. You have ${mins(remainingMs)} min left ` +
    `(until ${clock(remainingMs)} UTC). When you are done, make sure \`python3 check.py\` passes, then stop: ${stage}/ is submitted as it stands.`
  );
}

function packPrompt2(stage, packed, budgetMs, limits) {
  return (
    `Cube Arena coding benchmark (SPEC.md): your ${stage}/ folder can't be submitted as it stands. It is ${packed.problem}; ` +
    `the limit is ${mb(limits.bundleMaxBytes)} gzipped. Its biggest files: ${packed.biggest.map((f) => `${f.path} (${mb(f.size)})`).join(', ')}. ` +
    `build.py runs again on the grader before any cube, so the files it makes need not be in ${stage}/: delete them, and anything else ` +
    `build.py and solve.py do not need. You have ${mins(budgetMs)} min (until ${clock(budgetMs)} UTC). When ${stage}/ fits, stop: it is then submitted as it stands.`
  );
}

/** The time-left message: the same words for every model (lib/arena/code2-rules.ts nudgeText). */
export const nudgeText = (minutesLeft, stage) =>
  `You have ${minutesLeft} min left in this stage. Keep improving, or reply DONE to submit ${stage}/ as it stands.`;

/**
 * Codes the three stages, submits each, and (with `wait`) waits for the grade.
 * p: { site, token, submission, session: { agent, model, effort, codexHome }, bench, root, stateFile, logDir, transcript, wait }
 * Returns { breach } | { stopped } | { submission }.
 */
export async function playCoding2(p) {
  const call = operator(p.site, p.token);
  const id = p.submission.id;
  const state = existsSync(p.stateFile) ? JSON.parse(readFileSync(p.stateFile, 'utf8')) : { usedMs: 0, sessions: 0, stages: {} };
  const save = () => writeFileSync(p.stateFile, `${JSON.stringify(state)}\n`);
  const eventsFile = `${p.stateFile.replace(/\.json$/, '')}.events.jsonl`;
  mkdirSync(p.logDir, { recursive: true });
  const beat = () => call('/api/code/submissions', { id, alive: true }).catch((e) => console.log(`  (heartbeat failed: ${e.message})`));
  beat();
  const heart = setInterval(beat, HEARTBEAT_MS);
  // The server knows which stages are in (a run picked up again after the runner stopped).
  const { v2 } = await call(`/api/code/submissions?id=${id}`);
  const sent = new Set((v2?.stages ?? []).map((s) => s.stage));

  try {
    for (const [i, stage] of STAGES.entries()) {
      if (sent.has(stage)) {
        console.log(`\n${stage}/ is already in.`);
        continue;
      }
      const dir = join(p.root, stage);
      const kit = await setUpStage(p.site, p.bench, stage, dir);
      const st = (state.stages[stage] ??= { usedMs: 0, sessions: 0, nudged: false, ended: false, threads: [] });
      const budget = kit.minutes * 60_000;
      const sweep = (when) => {
        const ended = endLeftovers(dir);
        if (ended.length) console.log(`  ended ${ended.length} program${ended.length > 1 ? 's' : ''} the model left running ${when}`);
      };
      const untie = tieToRunner(() => endLeftovers(dir));
      sweep('from an earlier session');

      const runSession = async (prompt, budgetMs, resume) => {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const r = await codingSession({
          ...p.session,
          dir,
          prompt,
          budgetMs,
          persist: true,
          resume,
          logPath: join(p.logDir, `${stamp}-${p.session.model}-${p.session.effort ?? 'default'}-${p.bench}-${stage}-${st.sessions + 1}.jsonl`),
        });
        st.usedMs += r.ms;
        st.sessions += 1;
        state.usedMs += r.ms;
        state.sessions += 1;
        if (r.sessionId) st.sessionId = r.sessionId;
        if (p.session.agent === 'codex' && r.sessionId && !st.threads.includes(r.sessionId)) st.threads.push(r.sessionId);
        save();
        for (const e of r.events) appendFileSync(eventsFile, `${JSON.stringify({ stage, session: st.sessions, ...e })}\n`);
        sweep('when the session ended');
        // Claude Code reports each invocation's own tokens and cost; Codex's are totalled per thread when the stage ends.
        const usage = p.session.agent === 'codex' ? {} : r.usage;
        const cost = usage.cost_usd !== undefined ? `, $${usage.cost_usd.toFixed(2)}` : '';
        console.log(`  session over after ${(r.ms / 60_000).toFixed(1)} min${cost} (${mins(st.usedMs)} of ${kit.minutes} min used on ${stage})`);
        await call('/api/code/submissions', { id, usage, dev_minutes: state.usedMs / 60_000 }).catch((e) => console.log(`  (could not record usage: ${e.message})`));
        if (r.breach) {
          await call('/api/code/submissions', { id, hidden: true, reason: `runner lockdown: ${r.breach}` }).catch(() => {});
          await uploadTranscript(call, id, p, eventsFile, state);
          console.log(`!!! lockdown broken (${r.breach}); the submission is hidden. Stopping.`);
          return { end: { breach: r.breach } };
        }
        if (r.harnessError) {
          console.log(`!!! ${r.harnessError}. Stopping; fix that and carry on within 30 minutes with --resume ${id}`);
          return { end: { stopped: r.harnessError } };
        }
        return { r };
      };

      let packed;
      try {
        let waited = 0;
        for (let tries = 0; !st.ended; ) {
          const remaining = budget - st.usedMs;
          if (remaining < 30_000) break;
          let prompt;
          let resume;
          if (st.sessions === 0) prompt = stagePrompt(stage, i + 1, kit.limits, remaining);
          else if (st.nudgeDue) {
            prompt = nudgeText(mins(remaining), stage);
            resume = st.sessionId;
          } else prompt = retryPrompt(stage, remaining);
          console.log(`\n=== ${stage}, session ${st.sessions + 1}${resume ? ' (time-left message)' : ''}: ${mins(remaining)} min left ===`);
          const { r, end } = await runSession(prompt, remaining, resume);
          if (end) return end;
          if (st.nudgeDue) {
            st.nudgeDue = false;
            save();
          }
          if (r.quit && !r.apiError) {
            const left = budget - st.usedMs;
            // Ended early: once, the time left; a second end (or DONE) submits.
            if (!r.deadline && !st.nudged && left > kit.limits.nudgeShare * budget && st.sessionId) {
              st.nudged = true;
              st.nudgeDue = true;
              save();
              console.log(`  ended with ${mins(left)} min left: telling it once`);
              continue;
            }
            st.ended = true;
            save();
            break;
          }
          const why = r.apiError ?? r.stopReason ?? `the agent ended unexpectedly (exit ${r.code})`;
          const wait = RETRY_MINUTES[Math.min(tries++, RETRY_MINUTES.length - 1)];
          if (waited + wait > RETRY_HOURS * 60) {
            console.log(`!!! still failing after ${RETRY_HOURS} h (${why}). Stopping; carry on within 30 minutes with --resume ${id}`);
            return { stopped: why };
          }
          console.log(`  not the model's doing (${why}). Carrying on in ${wait} min; the files stay as they are.`);
          await new Promise((res) => setTimeout(res, wait * 60_000));
          waited += wait;
        }

        const folder = join(dir, stage);
        packed = packSolver(folder, kit.limits);
        for (let fix = 1; packed.problem && fix <= PACK_FIXES; fix++) {
          const budgetMs = Math.max(budget - st.usedMs, PACK_GRACE_MS);
          console.log(`\n=== ${stage}/ is too big to send (${packed.problem}). Session to fix that: ${mins(budgetMs)} min ===`);
          const { end } = await runSession(packPrompt2(stage, packed, budgetMs, kit.limits), budgetMs);
          if (end) return end;
          packed = packSolver(folder, kit.limits);
        }
      } finally {
        untie();
      }
      if (p.session.agent === 'codex') {
        const total = {};
        for (const t of st.threads) {
          for (const [k, v] of Object.entries(takeCodexSession(p.session.codexHome, t) ?? {})) total[k] = (total[k] ?? 0) + v;
        }
        st.threads = [];
        save();
        await call('/api/code/submissions', { id, usage: total, dev_minutes: state.usedMs / 60_000 }).catch((e) => console.log(`  (could not record usage: ${e.message})`));
      }
      await uploadTranscript(call, id, p, eventsFile, state);
      if (packed.problem) {
        console.log(`!!! ${stage}/ is still too big to send (${packed.problem}). Delete what build.py makes, then carry on within 30 minutes with --resume ${id}`);
        return { stopped: `${stage}/ is too big: ${packed.problem}` };
      }
      if (p.token && gunzipSync(packed.gz).includes(Buffer.from(p.token))) {
        console.log(`!!! ${stage}/ contains your invite code. Not sending it; remove it and carry on with --resume.`);
        return { stopped: `the invite code is in ${stage}/` };
      }
      if (!existsSync(join(dir, stage, 'solve.py'))) console.log(`  note: there is no ${stage}/solve.py, so every ${stage} cube will score 0.`);
      const q = `id=${id}&kind=bundle&stage=${stage}&minutes=${(st.usedMs / 60_000).toFixed(2)}${st.nudged ? '&nudged=1' : ''}`;
      const { submission } = await call(`/api/code/files?${q}`, packed.gz);
      console.log(`\n${stage}/ frozen and sent (${packed.gz.length} bytes); ${submission.stages.length} of 3 stages in.`);
    }
  } finally {
    clearInterval(heart);
  }
  console.log('\nAll three stages are in. Grading happens on our machine.');
  const { submission } = await call(`/api/code/submissions?id=${id}`);
  return { submission: p.wait ? await waitForGrade(call, id, p.wait) : submission };
}

async function uploadTranscript(call, id, p, eventsFile, state) {
  if (!p.transcript || !existsSync(eventsFile)) return;
  const events = readFileSync(eventsFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const stages = Object.fromEntries(Object.entries(state.stages).map(([k, v]) => [k, { minutes: v.usedMs / 60_000, sessions: v.sessions, nudged: v.nudged }]));
  const digest = { model: p.session.model, effort: p.session.effort ?? null, agent: p.session.agent, bench: p.bench, minutes: state.usedMs / 60_000, sessions: state.sessions, stages, events };
  let gz = gzipSync(JSON.stringify(digest));
  if (gz.length > 2_000_000) gz = gzipSync(JSON.stringify({ ...digest, events: events.map((e) => ({ ...e, text: e.text.slice(0, 300) })) }));
  await call(`/api/code/files?id=${id}&kind=transcript`, gz).catch((e) => console.log(`  (could not upload the transcript: ${e.message})`));
}
