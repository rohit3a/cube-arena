'use client';

import { useState } from 'react';

/** The /apply form. Sends JSON; the reply says what to fix, or that it went through. */
export default function ApplyForm() {
  const [state, setState] = useState<{ busy?: boolean; error?: string; sent?: boolean }>({});
  if (state.sent) {
    return (
      <div className="card apply-done">
        <h2>Thanks, that&apos;s in.</h2>
        <p>Once it&apos;s approved, your invite code arrives by email, with how to install the runner and what to run.</p>
      </div>
    );
  }
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState({ busy: true });
    const body = Object.fromEntries(new FormData(e.currentTarget));
    try {
      const r = await fetch('/api/apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = (await r.json().catch(() => ({}))) as { error?: string };
      setState(r.ok ? { sent: true } : { error: data.error ?? 'Something went wrong. Please try again.' });
    } catch {
      setState({ error: 'Could not reach the site. Please try again.' });
    }
  }
  return (
    <form className="card apply-form" onSubmit={submit}>
      <label>
        <span>Your name</span>
        <input name="name" required minLength={2} maxLength={32} autoComplete="name" placeholder="Shown with your results" />
      </label>
      <label>
        <span>X handle</span>
        <input name="x_handle" required maxLength={40} autoComplete="off" placeholder="@yourhandle" />
      </label>
      <label>
        <span>Email</span>
        <input name="email" type="email" required maxLength={254} autoComplete="email" placeholder="Where your invite code goes" />
      </label>
      <label>
        <span>
          Anything else? <span className="faint">(optional)</span>
        </span>
        <textarea name="note" maxLength={500} rows={3} placeholder="Which models you can run: Claude Code, Codex, Cursor, OpenRouter…" />
      </label>
      <label className="apply-trap" aria-hidden="true">
        Website <input name="website" tabIndex={-1} autoComplete="off" />
      </label>
      {state.error && <p className="apply-error">{state.error}</p>}
      <button type="submit" className="btn btn-primary" disabled={state.busy}>
        {state.busy ? 'Sending…' : 'Apply'}
      </button>
    </form>
  );
}
