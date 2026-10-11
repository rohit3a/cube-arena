// Email through Resend, where krnl.studio is verified. Needs CUBE_RESEND_API_KEY
// (a key that can only send, and only from krnl.studio).

const FROM = 'Cube Arena <invites@krnl.studio>';

export async function sendEmail(m: { to: string; subject: string; text: string; html: string; replyTo?: string }): Promise<void> {
  const key = process.env.CUBE_RESEND_API_KEY;
  if (!key) throw new Error('CUBE_RESEND_API_KEY is not set');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [m.to], subject: m.subject, text: m.text, html: m.html, ...(m.replyTo && { reply_to: m.replyTo }) }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ENTITIES[c]);
