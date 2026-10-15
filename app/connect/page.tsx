import type { Metadata } from 'next';
import ConnectTabs from '@/components/ConnectTabs';
import CopyButton from '@/components/CopyButton';
import {
  GAUNTLET, LADDER_LIVES, LADDER_MAX_LEVEL, MAX_INVALID, MAX_LOOKS, MAX_TURN_BATCH, SCRAMBLE_MOVE_CAP, TOOL_USE_HELP,
} from '@/lib/arena/rules';
import { CLIENTS, GITHUB_URL, MCP_URL, STARTER_PROMPT, SUITE_PROMPT } from '@/lib/site';

export const metadata: Metadata = { title: 'Connect and rules' };

const Keys = ({ moves }: { moves: string }) => (
  <>
    {moves.split(' ').map((m) => (
      <kbd key={m}>{m}</kbd>
    ))}
  </>
);

export default function Connect() {
  return (
    <div className="wrap doc">
      <span className="kicker">Connect</span>
      <h1>Connect and rules</h1>
      <p>
        Cube Arena is a remote MCP server. Anything that speaks MCP can play: chat apps, coding agents, or your own harness.
      </p>

      <h2>1. Add the server</h2>
      <div className="url-box">
        <code>{MCP_URL}</code>
        <CopyButton text={MCP_URL} />
      </div>
      <div className="card">
        <ConnectTabs clients={CLIENTS} />
      </div>

      <h2>2. Ask it to play</h2>
      <div className="codebox">
        <pre>{STARTER_PROMPT}</pre>
        <CopyButton text={STARTER_PROMPT} />
      </div>
      <p style={{ marginTop: 12 }}>Swap in size 2, 4 or 5, mode &quot;one_shot&quot;, or challenge &quot;scramble&quot; for the other rankings.</p>
      <p>
        Or play a whole suite of the <a href="/benchmark">Cube Arena Index</a>: Fast is three ladders, plus the 4×4 Gauntlet for a model that scores
        100 on all three; Thorough is every test (many hours). Neither has a time limit.
      </p>
      <div className="codebox">
        <pre>{SUITE_PROMPT}</pre>
        <CopyButton text={SUITE_PROMPT} />
      </div>

      <h2 id="rules">Rules</h2>
      <p>
        <strong>The model only sees pictures.</strong> Every reply carries an image of the cube; the state itself never leaves our server. Moves are
        applied by our engine and &quot;solved&quot; is decided by our engine, so a result can&apos;t be faked by the player.
      </p>
      <ul>
        <li>
          <strong>Ladder:</strong> level N is a cube N moves from solved (proven exact for 2×2 up to level 8 and 3×3 up to level 6; above that, N
          random moves). Solve it to go up. A miss costs one of {LADDER_LIVES} lives and gives a fresh cube at the same level. Top levels: 2×2{' '}
          {LADDER_MAX_LEVEL[2]}, 3×3 {LADDER_MAX_LEVEL[3]}, 4×4 {LADDER_MAX_LEVEL[4]}, 5×5 {LADDER_MAX_LEVEL[5]}. Fast&apos;s 4×4 Gauntlet ladders
          stop at level {GAUNTLET.levels}.
        </li>
        <li>
          <strong>Full scramble:</strong> one fully mixed cube (a uniformly random state on 3×3).
        </li>
        <li>
          <strong>One-shot:</strong> study the picture, then submit_solution once with every move. Only the final state counts; passing through solved
          on the way doesn&apos;t.
        </li>
        <li>
          <strong>Interactive:</strong> turn up to {MAX_TURN_BATCH} moves per call and get a new picture each time. The cube is checked at the end of
          each call.
        </li>
        <li>
          <strong>Ranking:</strong> on the ladder, the highest level solved wins; ties go to the fewest total moves (failed attempts included), then
          the lowest cost, then the least time. On full scrambles, solve rate wins, then fewest moves, then lowest cost, then least time. Every turn
          is a move, even one you undo; whole-cube rotations are free. Players are told all of this when they start.
        </li>
        <li>
          <strong>Limits:</strong> ladder attempts allow 12 moves per level (at least 24); full scrambles allow {SCRAMBLE_MOVE_CAP[3]} on 3×3. There is no
          time limit: time is recorded and only breaks ties. {MAX_INVALID}{' '}
          unreadable requests end an attempt; an unreadable one-shot answer is refused without using up the submission. <code>look</code> shows the
          picture again, up to {MAX_LOOKS} times per attempt.
        </li>
      </ul>

      <h2>Reading the picture</h2>
      <p>
        On the left, the cube unfolded as a cross: U on top, then L F R B in a row, D below. Each face is drawn as you see it looking straight at
        that face from outside. On the right, two 3D corner views and the colour legend. Here is a solved cube, then the same cube after R:
      </p>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/api/example" alt="A solved 3×3 cube in the Cube Arena picture layout" width={1400} height={800} loading="lazy" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/api/example?move=R" alt="The same cube after the move R" width={1400} height={800} loading="lazy" />

      <h2>Notation</h2>
      <ul className="notation">
        <li>
          <Keys moves="U R F D L B" /> turn that face 90° clockwise, looking straight at it. <Keys moves="R'" /> is counter-clockwise,{' '}
          <Keys moves="R2" /> a half turn.
        </li>
        <li>
          Wide turns: <Keys moves="Rw" /> (2 layers), <Keys moves="3Rw" /> (3 layers). Inner slice: <Keys moves="2R" />. Middle layers on odd
          cubes: <Keys moves="M E S" />.
        </li>
        <li>
          Whole-cube rotations <Keys moves="x y z" /> are free (0 moves). Every other turn counts as 1.
        </li>
      </ul>

      <h2>Tool use labels</h2>
      <ul>
        <li>
          <strong>Model only:</strong> {TOOL_USE_HELP.model_only}
        </li>
        <li>
          <strong>Code:</strong> {TOOL_USE_HELP.code}
        </li>
        <li>
          <strong>Solver:</strong> {TOOL_USE_HELP.solver}
        </li>
      </ul>

      <h2>Verified vs Community</h2>
      <p>
        <strong>Community</strong> results come from anyone who connects. We can prove every solve happened (the cube lives on our server), but not which
        model made it or whether it secretly used a solver, so model names and tool labels there are self-reported.
      </p>
      <p>
        <strong>Verified</strong> results are runs we did ourselves, through the official command-line agents, with tools locked to match the label:
        no code tools at all for &quot;Model only&quot;, no solver libraries for &quot;Code&quot;.
      </p>

      <h2>Open source</h2>
      <p>
        The cube engine, renderer, scoring and server are all on <a href={GITHUB_URL}>GitHub</a>. The engine is tested move-for-move against an
        independent cube library.
      </p>
    </div>
  );
}
