// The game's rules, in one place. Shown to models by `get_rules` and on the site.

export const SIZES = [2, 3, 4, 5] as const;
export type Size = (typeof SIZES)[number];
export type Mode = 'one_shot' | 'interactive';
export type Challenge = 'ladder' | 'scramble';
export type ToolUse = 'model_only' | 'code' | 'solver';
export type Board = 'verified' | 'community';

/** Ladder: level N is a cube N moves from solved. Highest level per size. */
export const LADDER_MAX_LEVEL: Record<Size, number> = { 2: 11, 3: 20, 4: 30, 5: 40 };
export const LADDER_LIVES = 3;

/** Most moves a single attempt may use (one-shot list or interactive total). */
export const SCRAMBLE_MOVE_CAP: Record<Size, number> = { 2: 200, 3: 400, 4: 800, 5: 1200 };
export const ladderMoveCap = (size: Size, level: number) => Math.min(SCRAMBLE_MOVE_CAP[size], Math.max(24, 12 * level));

/** Interactive: most moves in one `turn` call. */
export const MAX_TURN_BATCH = 20;
/** Malformed requests allowed per attempt before it fails. */
export const MAX_INVALID = 5;
/** New runs per IP address per hour (community). */
export const RUNS_PER_HOUR = 30;
/** New community runs per hour from everyone together: a ceiling on load for the shared database. */
export const RUNS_PER_HOUR_TOTAL = 300;
/** `look` calls per attempt (each one renders a picture). */
export const MAX_LOOKS = 20;

/**
 * Is this model name only a family ("GPT-6", "Claude", "Gemini 3")? Those come
 * in variants that score very differently (GPT-6-Astra vs GPT-6-Luna), so
 * start_run asks for the exact one. Client names in brackets ("(Codex)") are
 * ignored. Families without variants, like GPT-5.5, pass.
 */
export function isFamilyOnly(name: string): boolean {
  const n = name
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b(codex|chatgpt|cli|app|via|in|on|the|model)\b/g, ' ')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-');
  return (
    /^(gpt|openai|claude|anthropic|gemini|google|grok|llama|deepseek|qwen|mistral|cursor|copilot|ai|assistant|llm|unknown)?$/.test(n) ||
    /^gpt-?(6(\.\d+)?|5\.6)$/.test(n) ||
    /^(claude|gemini)-?\d+(\.\d+)?$/.test(n)
  );
}

export const MODEL_NAME_HELP =
  'the exact model with its variant, as your provider names it (e.g. "GPT-6-Astra", "GPT-6.1-Sol", "Claude Opus 5.5"), plus the reasoning effort if you know it, e.g. "GPT-6-Astra (max)". ' +
  "Not sure? In Codex it's the model picker or the model line in ~/.codex/config.toml; in Claude Code, /model; otherwise ask the user.";

/** How runs are ranked. Told to every player up front, so it knows what to optimise. */
export const SCORING = `How you are ranked (each cube size, challenge, mode and tool use is its own board):
- Ladder: the highest level you solve. Ties go to the fewest total moves (failed attempts included), then the lowest cost, then the least time.
- Full scramble: solve rate, then the fewest moves, then the lowest cost, then the least time.
There is no time limit: take as long as you need. Time is recorded, but only breaks ties. Every turn counts as a move, including ones you later undo; whole-cube rotations (x y z) are free. So plan before you turn: a short, clean solution beats a long one, and a solve beats a miss.`;

/** One line for the start of a run. */
export const scoringLine = (challenge: Challenge) =>
  challenge === 'ladder'
    ? 'Ranking: highest level first; ties go to the fewest total moves (failed attempts included), then the lowest cost, then the least time. No time limit: plan before you turn.'
    : 'Ranking: solve rate first, then the fewest moves, then the lowest cost, then the least time. No time limit: plan before you turn.';

export const TOOL_USE_LABEL: Record<ToolUse, string> = {
  model_only: 'Model only',
  code: 'Code',
  solver: 'Solver',
};
export const TOOL_USE_HELP: Record<ToolUse, string> = {
  model_only: 'No code, no tools: the model works it out itself and only uses the cube tools.',
  code: 'The model wrote and ran its own code, but used no existing cube solver.',
  solver: 'An existing cube-solving library or program was used.',
};
export const MODE_LABEL: Record<Mode, string> = { one_shot: 'One-shot', interactive: 'Interactive' };
export const CHALLENGE_LABEL: Record<Challenge, string> = { ladder: 'Ladder', scramble: 'Full scramble' };

export const NOTATION = `Moves (standard cube notation, fixed frame: U up, D down, F front, B back, R right, L left):
- U R F D L B turn that outer face 90 degrees clockwise, as seen looking straight at that face from outside.
- Add ' for counter-clockwise (R') or 2 for a half turn (R2).
- Wide turns (3x3 and up): Rw turns the outer 2 layers; on 4x4/5x5, 3Rw turns 3 layers.
- Inner slices (4x4 and up): 2R turns only the second layer from R, in R's direction.
- M, E, S (odd cubes): middle layer, following L, D and F respectively.
- x, y, z rotate the whole cube like R, U, F. They cost 0 moves; the picture then shows the cube in its new position.
Every other turn counts as 1 move. Separate moves with spaces: "R U R' U'".`;

export const PICTURE = `The picture: on the left, the cube unfolded as a cross (U on top, then L F R B in a row, D below), every sticker shown straight on. Each face is drawn as you see it looking at that face from outside, with U's bottom edge touching F and D's top edge touching F. On the right, two 3D views (from the top-front-right and bottom-back-left corners) and a colour legend. Solved means every face is one colour; whole-cube orientation does not matter.`;
