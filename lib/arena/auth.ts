// Who is calling the runner API and the MCP server with a Bearer token: the
// operator (Rohit's own runner) or an invitee's runner. Anyone else is the
// community.

import { timingSafeEqual } from 'node:crypto';
import type { InviteRow } from './db';
import { inviteFor, normalizeCode } from './invites';

export type Auth = { role: 'operator' } | { role: 'invite'; invite: InviteRow };

export function tokenMatches(given: string, expected: string | undefined): boolean {
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const bearerOf = (req: Request) => (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();

/**
 * The operator, a live invite, or null for no token. `bad` is true when the
 * token looks like an invite code but isn't a live one (typo, revoked,
 * expired), so callers can say so instead of quietly treating it as anyone.
 */
export async function authFrom(req: Request): Promise<{ auth: Auth | null; bad: boolean }> {
  const bearer = bearerOf(req);
  if (!bearer) return { auth: null, bad: false };
  if (tokenMatches(bearer, process.env.CUBE_OPERATOR_TOKEN)) return { auth: { role: 'operator' }, bad: false };
  if (!normalizeCode(bearer)) return { auth: null, bad: false };
  const invite = await inviteFor(bearer);
  return invite ? { auth: { role: 'invite', invite }, bad: false } : { auth: null, bad: true };
}

export const deny = (bad = false) =>
  Response.json({ error: bad ? 'That invite code is not valid any more (typo, revoked or expired).' : 'not allowed' }, { status: 401 });
