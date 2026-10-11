// Invite codes: 8 characters Rohit hands to people he trusts. A runner that
// sends one posts its suites to the Verified board, filed under that person.
// Only an HMAC of each code is stored; the code is shown once, when it's made.

import { createHmac, randomInt } from 'node:crypto';
import { type InviteRow, withDb } from './db';

// No 0/O, 1/I/L: easy to read out loud and type from a message.
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const CODE_LENGTH = 8;

export const newCode = () => Array.from({ length: CODE_LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');

/** "ab12-cd34 " → "AB12CD34"; null if it can't be a code. */
export function normalizeCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[\s-]/g, '');
  return code.length === CODE_LENGTH && [...code].every((c) => ALPHABET.includes(c)) ? code : null;
}

/** "AB12CD34" → "AB12-CD34", the way codes are shown. */
export const formatCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;

const secret = () => process.env.CUBE_INVITE_SECRET || process.env.CUBE_SUITE_SECRET || process.env.CUBE_IP_SALT || 'dev';
export const hashCode = (code: string) => createHmac('sha256', secret()).update(`invite:${code}`).digest('hex');

/** The live invite for a code: not revoked, not expired. Marks it used. */
export async function inviteFor(input: string): Promise<InviteRow | null> {
  const code = normalizeCode(input);
  if (!code) return null;
  const [invite] = await withDb((sql) => sql<InviteRow[]>`
    update cube_arena.invites set last_used_at = now()
    where code_hash = ${hashCode(code)} and revoked_at is null and (expires_at is null or expires_at > now())
    returning *`);
  return invite ?? null;
}
