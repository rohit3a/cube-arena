#!/usr/bin/env node
// Invite codes for people who run suites for the Verified board.
//
//   node --env-file=.env.local scripts/invite.mjs create "Priya" [--note "has OpenRouter credits"] [--expires 2026-12-31]
//   node --env-file=.env.local scripts/invite.mjs list
//   node --env-file=.env.local scripts/invite.mjs rotate <invite id>          a new code; the old one stops working
//   node --env-file=.env.local scripts/invite.mjs revoke <invite id> [--hide] stop the code; --hide also hides all it ran
//   node --env-file=.env.local scripts/invite.mjs x <invite id> <handle|->     their X handle on /contributors ("-" clears it)
//
// A code is shown once, when it's made (or rotated). Needs CUBE_OPERATOR_TOKEN.
import { parseArgs } from 'node:util';

const { values: opt, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    note: { type: 'string' },
    expires: { type: 'string' },
    hide: { type: 'boolean', default: false },
    url: { type: 'string', default: 'https://cube.krnl.studio' },
  },
});
const token = process.env.CUBE_OPERATOR_TOKEN;
if (!token) {
  console.error('CUBE_OPERATOR_TOKEN is not set (run with --env-file=.env.local)');
  process.exit(2);
}

async function api(body) {
  const res = await fetch(`${opt.url}/api/admin/invites`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(json.error ?? `HTTP ${res.status}`);
    process.exit(1);
  }
  return json;
}

const [command, arg, arg2] = positionals;
const howTo = (code) => `\nSend them:\n  their code, ${code}, and ${opt.url}/wanted (how to install the runner and what to run)`;

if (command === 'create') {
  if (!arg) throw new Error('Who is it for? create "Name"');
  const { invite, code } = await api({ name: arg, note: opt.note, expires_at: opt.expires });
  console.log(`${invite.name}: ${code}  (invite ${invite.id}${invite.expires_at ? `, expires ${invite.expires_at.slice(0, 10)}` : ''})`);
  console.log(howTo(code));
} else if (command === 'list') {
  const { invites } = await api();
  for (const i of invites) {
    const state = i.revoked_at ? 'revoked' : i.expires_at && new Date(i.expires_at) < new Date() ? 'expired' : 'live';
    const used = i.last_used_at ? `last used ${i.last_used_at.slice(0, 10)}` : 'never used';
    console.log(`${i.id}  ${i.name.padEnd(20)} …${i.code_hint}  ${state.padEnd(8)} ${String(i.finished).padStart(3)} suites  ${used}${i.x_handle ? `  @${i.x_handle}` : ''}${i.note ? `  (${i.note})` : ''}`);
  }
} else if (command === 'rotate') {
  const { code } = await api({ id: arg, rotate: true });
  console.log(`New code: ${code}`);
  console.log(howTo(code));
} else if (command === 'revoke') {
  const { suites_hidden } = await api({ id: arg, revoke: true, hide: opt.hide });
  console.log(`Revoked.${opt.hide ? ` ${suites_hidden} suite(s) hidden.` : ' Their results stay up (add --hide to hide them).'}`);
} else if (command === 'x') {
  if (!arg || !arg2) throw new Error('x <invite id> <handle>, or "-" to clear it');
  const { x_handle } = await api({ id: arg, x_handle: arg2 === '-' ? '' : arg2 });
  console.log(x_handle ? `X handle set to @${x_handle}.` : 'X handle cleared.');
} else {
  console.log('Usage: invite.mjs create "Name" | list | rotate <id> | revoke <id> [--hide] | x <id> <handle|->');
}
