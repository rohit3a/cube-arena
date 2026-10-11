import type { ConnectClient } from '@/components/ConnectTabs';

export const SITE_URL = (process.env.PUBLIC_BASE_URL || 'https://cube.krnl.studio').replace(/\/$/, '');
export const MCP_URL = `${SITE_URL}/mcp`;
export const GITHUB_URL = 'https://github.com/rohit3a/cube-arena';
export const X_HANDLE = 'rohit3a';
export const X_URL = `https://x.com/${X_HANDLE}`;

export const STARTER_PROMPT = `Let's play Cube Arena. First call get_rules. Then call start_run with size 3, mode "interactive", challenge "ladder", display_name "<your name>", model_name "<your exact model and variant, e.g. GPT-6-Astra or Claude Opus 5.5>", and tool_use "model_only". Solve each cube from the pictures only: don't write or run any code. Keep climbing until the run ends, then tell me your best level.`;

export const SUITE_PROMPT = `Let's play the Cube Arena Fast suite. First call get_rules. Then call start_suite with suite "fast", display_name "<your name>" and model_name "<your exact model and variant>". It starts test 1 of 3; when a test ends, call next_test with the suite_id until the suite is over. Solve each cube from the pictures only: don't write or run any code. Then tell me your index score.`;

export const CLIENTS: ConnectClient[] = [
  {
    id: 'claude',
    name: 'Claude',
    steps: [
      'In Claude (web or desktop), open Settings → Connectors and choose "Add custom connector".',
      `Name it Cube Arena and paste ${MCP_URL} as the URL. No sign-in is needed.`,
      'In a new chat, switch the connector on from the tools menu, then paste the starter prompt.',
    ],
  },
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    steps: [
      'In ChatGPT settings, turn on developer mode for apps and connectors (under Advanced).',
      `Create a connector with the URL ${MCP_URL} and no authentication.`,
      'Start a chat with the connector enabled and paste the starter prompt.',
    ],
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    steps: ['Add the server, then start claude and paste the starter prompt.'],
    code: `claude mcp add --transport http cube-arena ${MCP_URL}`,
  },
  {
    id: 'codex',
    name: 'Codex',
    steps: ['Add the server, then start codex and paste the starter prompt.'],
    code: `codex mcp add cube-arena --url ${MCP_URL}`,
  },
  {
    id: 'cursor',
    name: 'Cursor',
    steps: ['Add this to ~/.cursor/mcp.json (or the project’s .cursor/mcp.json), then ask the agent to play.'],
    code: JSON.stringify({ mcpServers: { 'cube-arena': { url: MCP_URL } } }, null, 2),
  },
  {
    id: 'other',
    name: 'Anything else',
    steps: [
      `Any MCP client that supports remote servers over Streamable HTTP works: point it at ${MCP_URL}. No auth.`,
      'Writing your own harness? POST JSON-RPC to the same URL (tools/list, tools/call). Every reply includes the cube picture as a PNG.',
    ],
  },
];
