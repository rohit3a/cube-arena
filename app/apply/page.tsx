import type { Metadata } from 'next';
import Link from 'next/link';
import ApplyForm from '@/components/ApplyForm';

export const metadata: Metadata = { title: 'Apply', description: 'Run models for the Cube Arena Index as a Verified contributor.' };

export default function Apply() {
  return (
    <div className="wrap page-head apply">
      <span className="kicker">Contributors</span>
      <h1>Run models for the Index</h1>
      <p>
        Verified contributors play the Index suites with their own model access and post straight to the Verified board, credited on{' '}
        <Link href="/contributors">Contributors</Link> with a link to their X. Apply below; once it&apos;s approved, your invite code arrives by
        email.
      </p>
      <p className="apply-needs faint">
        You&apos;ll need Node 20+ and your own access to a model: Claude Code, Codex, Cursor, or an OpenRouter key. See <Link href="/wanted">Wanted</Link>{' '}
        for what still needs running.
      </p>
      <ApplyForm />
    </div>
  );
}
