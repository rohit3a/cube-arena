// Claims: someone says "I'm running this model at this effort" for 24 hours,
// so two people don't spend tokens on the same suite. Starting a suite claims
// it; finishing the suite releases it. Expired claims are released lazily.

import type { Auth } from './auth';
import { type Tx, UUID, transaction, withDb } from './db';
import type { SuiteKind } from './suites';

export const CLAIM_HOURS = 24;

export interface Claim {
  id: string;
  model_id: string;
  effort: string | null;
  kind: SuiteKind;
  /** The invitee's name if they chose to show it, "Cube Arena" for the operator, else null. */
  by: string | null;
  mine: boolean;
  expires_at: string;
  suite_id: string | null;
}

interface ClaimRow {
  id: string;
  invite_id: string | null;
  model_id: string;
  effort: string;
  kind: SuiteKind;
  credit: boolean;
  expires_at: Date;
  suite_id: string | null;
  name: string | null;
}

const release = (tx: Tx) => tx`update cube_arena.claims set released_at = expires_at where released_at is null and expires_at < now()`;

const view = (r: ClaimRow, auth: Auth | null): Claim => ({
  id: r.id,
  model_id: r.model_id,
  effort: r.effort || null,
  kind: r.kind,
  by: r.invite_id === null ? 'Cube Arena' : r.credit ? r.name : null,
  mine: auth ? (auth.role === 'operator' ? r.invite_id === null : r.invite_id === auth.invite.id) : false,
  expires_at: new Date(r.expires_at).toISOString(),
  suite_id: r.suite_id,
});

export async function openClaims(auth: Auth | null = null): Promise<Claim[]> {
  const rows = await withDb((sql) => sql<ClaimRow[]>`
    select c.id, c.invite_id, c.model_id, c.effort, c.kind, c.credit, c.expires_at, c.suite_id, i.name
    from cube_arena.claims c left join cube_arena.invites i on i.id = c.invite_id
    where c.released_at is null and c.expires_at > now() order by c.created_at`);
  return rows.map((r) => view(r, auth));
}

export class ClaimTaken extends Error {}

/**
 * Claims a model, effort and suite kind for 24 hours (or renews your own
 * claim). Throws ClaimTaken when someone else holds it.
 */
export async function claimFor(
  auth: Auth,
  c: { model_id: string; effort: string | null; kind: SuiteKind; credit: boolean; suite_id?: string | null },
): Promise<Claim> {
  const inviteId = auth.role === 'invite' ? auth.invite.id : null;
  return transaction(async (tx) => {
    await release(tx);
    const effort = c.effort ?? '';
    const [held] = await tx<ClaimRow[]>`
      select c.*, null as name from cube_arena.claims c
      where c.model_id = ${c.model_id} and c.effort = ${effort} and c.kind = ${c.kind} and c.released_at is null for update`;
    if (held && held.invite_id !== inviteId) throw new ClaimTaken('Someone else is running this one right now.');
    const suiteId = c.suite_id && UUID.test(c.suite_id) ? c.suite_id : null;
    const [row] = held
      ? await tx<ClaimRow[]>`
          update cube_arena.claims set expires_at = now() + make_interval(hours => ${CLAIM_HOURS}), credit = ${c.credit},
                 suite_id = coalesce(${suiteId}::uuid, suite_id)
          where id = ${held.id} returning *, null as name`
      : await tx<ClaimRow[]>`
          insert into cube_arena.claims (invite_id, model_id, effort, kind, credit, expires_at, suite_id)
          values (${inviteId}, ${c.model_id}, ${effort}, ${c.kind}, ${c.credit}, now() + make_interval(hours => ${CLAIM_HOURS}), ${suiteId})
          returning *, null as name`;
    return view({ ...row, name: auth.role === 'invite' ? auth.invite.name : null }, auth);
  });
}

/** Lets go of your own claim (the operator can release anyone's). */
export async function releaseClaim(auth: Auth, id: string): Promise<boolean> {
  if (!UUID.test(id)) return false;
  const inviteId = auth.role === 'invite' ? auth.invite.id : null;
  const rows = await withDb((sql) => sql`
    update cube_arena.claims set released_at = now()
    where id = ${id} and released_at is null and (${auth.role === 'operator'} or invite_id = ${inviteId}::uuid) returning id`);
  return rows.length > 0;
}
