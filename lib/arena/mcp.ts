// The MCP server: the tools a model uses to play. Stateless; every request
// builds a fresh server, and all game state lives in the database.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { parseMoves, solvedState, applyMoves } from '../cube/engine';
import { atlasPng } from '../render/png';
import { authFrom } from './auth';
import { type ToolUse, LADDER_LIVES, LADDER_MAX_LEVEL, MAX_LOOKS, MAX_TURN_BATCH, MODEL_NAME_HELP, SCORING, NOTATION, PICTURE, TOOL_USE_HELP } from './rules';
import { ArenaError, BASE_URL, type Caller, type Reply, giveUp, hashIp, look, nextTest, startRun, startSuite, submitSolution, turn } from './service';
import { SUITES } from './suites';

export const INSTRUCTIONS = `Cube Arena (${BASE_URL}): solve a scrambled cube that you can only see as a picture.

How to play:
1. Call start_run with the cube size (2-5), mode, challenge, your display name, the model you are, and honest tool_use. You get back an attempt_id and an image of the cube.
2. One-shot mode: study the image, work out the full solution, call submit_solution once with every move.
   Interactive mode: call turn with up to ${MAX_TURN_BATCH} moves at a time; each call returns a new image. The attempt ends when the cube is solved at the end of a call.
3. Ladder challenge: level N is a cube N moves from solved. Solve it to go up a level; a failed attempt costs one of ${LADDER_LIVES} lives and gives a fresh cube at the same level. Full scramble challenge: one fully mixed cube.

Suites (the Cube Arena Index): start_suite plays a fixed set of model-only tests, one after another with no time limit, graded together out of 100. ${SUITES.fast.name}: ${SUITES.fast.blurb} ${SUITES.thorough.name}: ${SUITES.thorough.blurb} When a test ends, call next_test with the suite_id for the next one.

${SCORING}

Call get_rules for the notation and how to read the picture. Results and replays appear on ${BASE_URL}.`;

// get_rules is called by every player and never changes: render its pictures once per server.
let examples: [string, string] | undefined;
function examplePictures(): [string, string] {
  if (!examples) {
    const solved = solvedState(3);
    const afterR = applyMoves(solved, 3, parseMoves('R', 3));
    examples = [
      atlasPng(solved, 3, { caption: 'example: solved' }).toString('base64'),
      atlasPng(afterR, 3, { caption: 'example: after R', moves: 1 }).toString('base64'),
    ];
  }
  return examples;
}

const attemptId = z.string().describe('The attempt_id from the most recent reply.');
const movesArg = z
  .string()
  .max(20000)
  .describe(`Moves in standard notation separated by spaces, e.g. "R U R' U' F2". Faces U R F D L B; ' = counter-clockwise; 2 = half turn; Rw/3Rw wide; 2R inner slice; M E S; x y z rotations (free).`);

function toResult(r: Reply) {
  const content: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[] = [
    { type: 'text', text: `${r.text}\n\n${JSON.stringify(r.data)}` },
  ];
  if (r.png) content.push({ type: 'image', data: r.png.toString('base64'), mimeType: 'image/png' });
  return { content };
}

async function guard(fn: () => Promise<Reply>) {
  try {
    return toResult(await fn());
  } catch (e) {
    if (e instanceof ArenaError) return { content: [{ type: 'text' as const, text: e.message }], isError: true };
    console.error('cube-arena tool error', e);
    return { content: [{ type: 'text' as const, text: 'Something went wrong on our side. Try again in a moment.' }], isError: true };
  }
}

export function buildServer(caller: Caller): McpServer {
  const server = new McpServer({ name: 'cube-arena', title: 'Cube Arena', version: '0.1.0' }, { instructions: INSTRUCTIONS });

  server.registerTool(
    'start_run',
    {
      title: 'Start a run',
      description:
        'Start a new run and get the first scrambled cube as an image. ' +
        `Ladder: level N is N moves from solved; solve to climb (max level ${LADDER_MAX_LEVEL[3]} on 3x3), ${LADDER_LIVES} lives. ` +
        'Scramble: one fully mixed cube. Mode one_shot: submit the whole solution once. Mode interactive: turn a few moves at a time and see a new picture each time.',
      inputSchema: {
        size: z.number().int().min(2).max(5).describe('Cube size: 2, 3, 4 or 5 (3 = the classic cube).'),
        mode: z.enum(['one_shot', 'interactive']).describe('one_shot: one submission with every move. interactive: turn, look, repeat.'),
        challenge: z.enum(['ladder', 'scramble']).default('ladder').describe('ladder (default): climb levels of difficulty. scramble: one fully mixed cube.'),
        display_name: z.string().describe('Name for the leaderboard: the person or team running you, 2-32 characters.'),
        model_name: z.string().describe(`The model you are: ${MODEL_NAME_HELP}`),
        tool_use: z
          .enum(['model_only', 'code', 'solver'])
          .describe(`Be honest; it decides which ranking you are in. model_only: ${TOOL_USE_HELP.model_only} code: ${TOOL_USE_HELP.code} solver: ${TOOL_USE_HELP.solver}`),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    (args) =>
      guard(() =>
        startRun(
          {
            size: args.size as 2 | 3 | 4 | 5,
            mode: args.mode,
            challenge: args.challenge ?? 'ladder',
            display_name: args.display_name,
            model_name: args.model_name,
            tool_use: args.tool_use,
          },
          caller,
        ),
      ),
  );

  server.registerTool(
    'start_suite',
    {
      title: 'Start a suite',
      description:
        `Start a Cube Arena Index suite: fixed model-only tests played in order, graded together out of 100. No time limit. ` +
        `fast: ${SUITES.fast.slots.length} tests. thorough: ${SUITES.thorough.slots.length} tests (many hours). ` +
        'Returns the first test like start_run does. Model only: no code, no tools.',
      inputSchema: {
        suite: z.enum(['fast', 'thorough']).describe('fast (three ladders) or thorough (every test, many hours).'),
        display_name: z.string().describe('Name for the leaderboard: the person or team running you, 2-32 characters.'),
        model_name: z.string().describe(`The model you are: ${MODEL_NAME_HELP}`),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    (args) => guard(() => startSuite(args.suite, { display_name: args.display_name, model_name: args.model_name }, caller)),
  );

  server.registerTool(
    'next_test',
    {
      title: 'Next suite test',
      description: "Start the suite's next test (or show the one in progress). When the last test ends, the suite is graded.",
      inputSchema: { suite_id: z.string().describe('The suite_id from start_suite.') },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    (args) => guard(() => nextTest(args.suite_id, caller)),
  );

  server.registerTool(
    'look',
    {
      title: 'Look at the cube',
      description: `Get the current picture of an attempt again. Free (costs no moves), up to ${MAX_LOOKS} times per attempt.`,
      inputSchema: { attempt_id: attemptId },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (args) => guard(() => look(args.attempt_id, caller)),
  );

  server.registerTool(
    'turn',
    {
      title: 'Turn the cube (interactive)',
      description: `Interactive mode: apply up to ${MAX_TURN_BATCH} moves, then get the new picture. If the cube is solved after the last move, the attempt is won.`,
      inputSchema: { attempt_id: attemptId, moves: movesArg },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    (args) => guard(() => turn(args.attempt_id, args.moves, caller)),
  );

  server.registerTool(
    'submit_solution',
    {
      title: 'Submit a full solution (one-shot)',
      description: 'One-shot mode: submit every move of your solution at once. You only get one submission per cube; it wins if the cube is solved after the last move.',
      inputSchema: { attempt_id: attemptId, moves: movesArg },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    (args) => guard(() => submitSolution(args.attempt_id, args.moves, caller)),
  );

  server.registerTool(
    'give_up',
    {
      title: 'Give up',
      description: 'End the whole run now. Your best level so far stays on the leaderboard.',
      inputSchema: { attempt_id: attemptId },
      // Not destructive: it only records the end, like a submission does.
      // Codex runs unattended and refuses any tool marked destructive, so a
      // Codex model could not give up at all.
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    (args) => guard(() => giveUp(args.attempt_id, caller)),
  );

  server.registerTool(
    'get_rules',
    {
      title: 'Rules and notation',
      description: 'How to read the picture and write moves, with two example pictures: a solved 3x3 and the same cube after R.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const [solved, afterR] = examplePictures();
      return {
        content: [
          { type: 'text' as const, text: `${INSTRUCTIONS}\n\n${PICTURE}\n\n${NOTATION}\n\nExample 1: a solved 3x3. Example 2: the same cube after the single move R (the right face turned clockwise, as seen from the right).` },
          { type: 'image' as const, data: solved, mimeType: 'image/png' },
          { type: 'image' as const, data: afterR, mimeType: 'image/png' },
        ],
      };
    },
  );

  return server;
}

const TOOL_USES = new Set<ToolUse>(['model_only', 'code', 'solver']);

/**
 * Who is calling: the operator's runner or an invitee's (verified board), or
 * anyone (community). Null when the token is an invite code that isn't live.
 */
export async function callerFrom(req: Request): Promise<Caller | null> {
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || req.headers.get('x-real-ip');
  const client = (req.headers.get('user-agent') ?? '').slice(0, 120) || null;
  const { auth, bad } = await authFrom(req);
  if (bad) return null;
  if (auth) {
    const toolUse = req.headers.get('x-arena-tool-use') as ToolUse | null;
    const slot = Number.parseInt(req.headers.get('x-arena-suite-slot') ?? '', 10);
    return {
      board: 'verified',
      ipHash: null,
      client,
      operator: {
        displayName: req.headers.get('x-arena-name') ?? 'Cube Arena',
        modelName: req.headers.get('x-arena-model') ?? undefined,
        toolUse: toolUse && TOOL_USES.has(toolUse) ? toolUse : undefined,
        suiteSlot: Number.isInteger(slot) && slot >= 0 ? slot : undefined,
      },
      invite: auth.role === 'invite' ? { id: auth.invite.id, name: auth.invite.name } : undefined,
    };
  }
  return { board: 'community', ipHash: hashIp(ip), client };
}
