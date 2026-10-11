// Applying to be a Verified contributor. Someone fills in /apply; the operator
// (CUBE_APPLY_TO) gets an email with a link to approve or decline; approving
// makes their invite, with their name and X handle, and emails them the code.
// The link carries a secret of which only a hash is kept, and it opens a page
// with buttons, so a mail scanner that follows links decides nothing. The
// operator can also decide by id (scripts/invite.mjs approve), and the link
// then shows the outcome.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { RUNNER_INSTALL, SITE_URL } from '../site';
import { createInvite, revokeInvite } from './admin';
import { UUID, withDb } from './db';
import { escapeHtml, sendEmail } from './email';
import { RESERVED_NAMES, normalizeHandle, setHandle } from './invites';
import { ArenaError, cleanName } from './service';

export interface Application {
  id: string;
  created_at: Date;
  name: string;
  x_handle: string;
  email: string;
  note: string | null;
  status: 'pending' | 'approved' | 'declined';
  decided_at: Date | null;
}

/** Applications one address may send a day. */
const APPLIES_PER_DAY = 3;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const hash = (token: string) => createHash('sha256').update(token).digest('hex');

/** Checks and stores an application, then emails the operator. Throws ArenaError with a message for the form. */
export async function apply(input: { name?: unknown; x_handle?: unknown; email?: unknown; note?: unknown }, ipHash: string | null): Promise<void> {
  const name = cleanName(input.name, 2, 32, 'Name');
  if (RESERVED_NAMES.test(name)) throw new ArenaError('bad_name', 'Pick a different name.');
  const handle = typeof input.x_handle === 'string' ? normalizeHandle(input.x_handle) : null;
  if (!handle) throw new ArenaError('bad_handle', 'That is not an X handle (letters, digits and _, up to 15).');
  const email = typeof input.email === 'string' ? input.email.trim() : '';
  if (email.length > 254 || !EMAIL.test(email)) throw new ArenaError('bad_email', 'That email address does not look right.');
  const note = typeof input.note === 'string' && input.note.trim() ? input.note.trim().slice(0, 500) : null;
  const to = process.env.CUBE_APPLY_TO;
  if (!to) throw new Error('CUBE_APPLY_TO is not set');

  const token = randomBytes(24).toString('base64url');
  const id = await withDb(async (sql) => {
    const [{ recent }] = await sql<{ recent: number }[]>`
      select count(*)::int as recent from cube_arena.applications where ip_hash = ${ipHash} and created_at > now() - interval '1 day'`;
    if (ipHash && recent >= APPLIES_PER_DAY) throw new ArenaError('rate_limited', 'That is enough applications from here for today. Try again tomorrow.');
    const [invited] = await sql`select 1 from cube_arena.invites where lower(x_handle) = lower(${handle}) and revoked_at is null`;
    if (invited) throw new ArenaError('taken', `@${handle} already has an invite code. Lost it? Message @rohit3a on X.`);
    const [waiting] = await sql`select 1 from cube_arena.applications where lower(x_handle) = lower(${handle}) and status = 'pending'`;
    if (waiting) throw new ArenaError('pending', `There is already an application for @${handle} waiting for a reply.`);
    const [row] = await sql<{ id: string }[]>`
      insert into cube_arena.applications (name, x_handle, email, note, ip_hash, token_hash)
      values (${name}, ${handle}, ${email}, ${note}, ${ipHash}, ${hash(token)}) returning id`;
    return row.id;
  });

  const link = `${SITE_URL}/apply/decide?id=${id}&t=${token}`;
  const lines = [`${name} (https://x.com/${handle}) wants to run models for the Cube Arena Index.`, `Email: ${email}`, ...(note ? [`Note: ${note}`] : [])];
  try {
    await sendEmail({
      to,
      replyTo: email,
      subject: `Cube Arena: ${name} (@${handle}) wants to be a contributor`,
      text: `${lines.join('\n')}\n\nApprove or decline: ${link}\n`,
      html:
        lines.map((l) => `<p>${escapeHtml(l)}</p>`).join('') +
        `<p><a href="${escapeHtml(link)}" style="display:inline-block;padding:10px 18px;background:#ffd23f;color:#111;border:2px solid #111;border-radius:10px;font-weight:700;text-decoration:none">Approve or decline</a></p>`,
    });
  } catch (e) {
    // Nobody would ever see it: drop it so they can try again.
    await withDb((sql) => sql`delete from cube_arena.applications where id = ${id}`);
    throw e;
  }
}

/** The application behind a decision link, or null if the link is wrong. */
export async function applicationFor(id: string, token: string): Promise<Application | null> {
  if (!UUID.test(id) || !token) return null;
  const [row] = await withDb((sql) => sql<{ token_hash: string }[]>`select token_hash from cube_arena.applications where id = ${id}`);
  if (!row) return null;
  const [a, b] = [Buffer.from(row.token_hash, 'hex'), Buffer.from(hash(token), 'hex')];
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return applicationById(id);
}

async function applicationById(id: string): Promise<Application | null> {
  if (!UUID.test(id)) return null;
  const [row] = await withDb((sql) => sql<Application[]>`
    select id, created_at, name, x_handle, email, note, status, decided_at from cube_arena.applications where id = ${id}`);
  return row ?? null;
}

/** Operator only: applications, newest first (just the waiting ones unless `all`). */
export async function listApplications(all = false): Promise<Application[]> {
  return withDb((sql) => sql<Application[]>`
    select id, created_at, name, x_handle, email, note, status, decided_at from cube_arena.applications
    where ${all} or status = 'pending' order by created_at desc limit 100`);
}

/** Approves or declines from the email's link. Null if the link is wrong. */
export async function decide(id: string, token: string, approve: boolean): Promise<Application | null> {
  const app = await applicationFor(id, token);
  return app && settle(app, approve);
}

/** Operator only: the same decision by id, leaving the email's link working (it then shows the outcome). */
export async function decideById(id: string, approve: boolean): Promise<Application | null> {
  const app = await applicationById(id);
  return app && settle(app, approve);
}

/**
 * Approving makes the invite (named, with the X handle) and emails the code;
 * if that email fails, the invite is withdrawn and the application waits
 * again, so the decision can simply be made again. Declining sends nothing.
 * Returns the application as it now stands.
 */
async function settle(app: Application, approve: boolean): Promise<Application> {
  if (app.status !== 'pending') return app;
  // Claim it first, so two clicks can't make two invites.
  const [claimed] = await withDb((sql) => sql<Application[]>`
    update cube_arena.applications set status = ${approve ? 'approved' : 'declined'}, decided_at = now()
    where id = ${app.id} and status = 'pending'
    returning id, created_at, name, x_handle, email, note, status, decided_at`);
  if (!claimed) return (await applicationById(app.id)) ?? app;
  if (!approve) return claimed;

  const { invite, code } = await createInvite(app.name, `applied ${new Date().toISOString().slice(0, 10)}: ${app.email}`, null);
  try {
    await setHandle(invite.id, app.x_handle);
    await sendEmail({
      to: app.email,
      subject: 'Your Cube Arena invite',
      ...inviteEmail(app, code),
    });
  } catch (e) {
    await revokeInvite(invite.id, false).catch(() => {});
    await withDb((sql) => sql`update cube_arena.applications set status = 'pending', decided_at = null where id = ${app.id}`);
    throw e;
  }
  await withDb((sql) => sql`update cube_arena.applications set invite_id = ${invite.id} where id = ${app.id}`);
  return claimed;
}

function inviteEmail(app: Application, code: string): { text: string; html: string } {
  const steps = [
    ['Install the runner (needs Node 20+). A permission error on a Mac? Add --prefix ~/.local and make sure ~/.local/bin is on your PATH.', RUNNER_INSTALL],
    ['Log in once. It asks whether to show your name next to your results, and which name.', `cube-arena-runner login ${code}`],
    [`Pick a model and effort that still needs a run at ${SITE_URL}/wanted, claim it, and play it, for example:`, 'cube-arena-runner play --model claude-sonnet-5-5 --effort max'],
  ];
  const intro = `Hi ${app.name}, you're in. Your invite code is ${code}. Keep it to yourself: anything run with it goes on the Verified board.`;
  const outro = `You need your own access to the model: Claude Code, Codex, or an OpenRouter key. There's no time limit. Finished suites put you on ${SITE_URL}/contributors, linked to @${app.x_handle}.`;
  return {
    text: [intro, '', ...steps.flatMap(([say, cmd], i) => [`${i + 1}. ${say}`, `   ${cmd}`, '']), outro, ''].join('\n'),
    html:
      `<p>${escapeHtml(intro)}</p><ol>` +
      steps.map(([say, cmd]) => `<li><p>${escapeHtml(say)}</p><pre style="background:#f4f1ea;padding:8px 10px;border-radius:8px">${escapeHtml(cmd)}</pre></li>`).join('') +
      `</ol><p>${escapeHtml(outro)}</p>`,
  };
}
