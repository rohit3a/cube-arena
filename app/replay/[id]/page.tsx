import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import MiniFace from '@/components/MiniFace';
import ReplayPlayer, { type Checkpoint } from '@/components/ReplayPlayer';
import { replay } from '@/lib/arena/board';
import { clientLabel } from '@/lib/arena/clients';
import { CHALLENGE_LABEL, MODE_LABEL, TOOL_USE_LABEL } from '@/lib/arena/rules';
import { OUT_OF_OUTPUT, OUT_OF_OUTPUT_WHY, outOfOutput } from '@/lib/arena/format';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }> };

function headline(r: NonNullable<Awaited<ReturnType<typeof replay>>>) {
  const { attempt: a, run } = r;
  const what = a.level ? `level ${a.level}` : 'a full scramble';
  const cube = `${a.size}×${a.size}`;
  if (a.status === 'active') return `${run.model_name} is solving ${what} on a ${cube}`;
  if (a.status === 'solved') return `${run.model_name} solved ${what} on a ${cube} in ${a.move_count} move${a.move_count === 1 ? '' : 's'}`;
  if (a.status === 'stopped') return `${run.model_name} stopped at ${what} on a ${cube}`;
  return `${run.model_name} missed ${what} on a ${cube}`;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const r = await replay((await params).id);
  if (!r) return { title: 'Replay not found' };
  const title = headline(r);
  return {
    title,
    description: 'Watch the replay in 3D, with the exact pictures the model was shown. Cube Arena checks every move on the server.',
    openGraph: { title, images: [{ url: `/api/image/${r.attempt.id}?m=${r.attempt.status === 'active' ? 0 : r.attempt.move_count}`, width: 1400, height: 800 }] },
  };
}

const RESULT: Record<string, string> = {
  solved: 'Solved!',
  failed: 'Missed',
  invalid: 'Fumbled',
  gave_up: 'Gave up',
  timeout: 'Out of time',
  stopped: 'Stopped',
  active: 'Live now',
};

function duration(from: Date, to: Date | null) {
  if (!to) return '–';
  const s = Math.round((new Date(to).getTime() - new Date(from).getTime()) / 1000);
  return s < 120 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

export default async function ReplayPage({ params }: Props) {
  const r = await replay((await params).id);
  if (!r) notFound();
  const { attempt: a, run, events, siblings } = r;
  const active = a.status === 'active';

  // Pictures the model was sent: the start, then the state after each turn (interactive).
  const checkpoints: Checkpoint[] = [{ moveCount: 0, label: 'start' }];
  let turnNo = 0;
  for (const e of events) {
    if (e.kind === 'turn' && e.move_count !== null) checkpoints.push({ moveCount: e.move_count, label: `after turn ${++turnNo} · ${e.move_count} moves` });
  }

  return (
    <div className="wrap replay">
      <div>
        {active ? (
          <div>
            {/* While an attempt is live, only the picture is public: never the state itself. */}
            <div className="live-shot">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/image/${a.id}?m=${a.move_count}`} alt="The cube as the model currently sees it" width={1400} height={800} />
              <span className="live-pill">LIVE</span>
            </div>
            <p className="muted" style={{ marginTop: 12 }}>
              This attempt is still in progress. The 3D replay unlocks when it finishes; refresh to see the latest picture.
            </p>
          </div>
        ) : (
          <ReplayPlayer
            attemptId={a.id}
            n={a.size}
            initial={a.initial_state}
            moves={a.moves}
            solved={a.status === 'solved'}
            checkpoints={a.mode === 'interactive' ? checkpoints : checkpoints.slice(0, 1)}
          />
        )}
      </div>

      <aside>
        <div className={`result ${a.status === 'solved' ? 'solved' : active ? '' : 'failed'}`}>
          <span className="result-word">
            <MiniFace n={a.size} solved={a.status === 'solved'} seed={a.id} />
            {outOfOutput(a.detail) ? 'Out of output' : (RESULT[a.status] ?? a.status)}
          </span>
          <h2>{headline(r)}</h2>
          {a.detail && (
            <p>
              {outOfOutput(a.detail)
                ? `The model ${OUT_OF_OUTPUT}: ${OUT_OF_OUTPUT_WHY}. It thought past the most it can write in one reply, so the test ended on this level.`
                : a.detail}
            </p>
          )}
        </div>

        <dl className="facts">
          <div>
            <dt>Model</dt>
            <dd>{run.model_name}</dd>
          </div>
          <div>
            <dt>Run by</dt>
            <dd>{run.display_name}</dd>
          </div>
          <div>
            <dt>Connected via</dt>
            <dd title="Recorded by the server from the app's User-Agent, not typed by the model">{clientLabel(run.client)}</dd>
          </div>
          <div>
            <dt>Board</dt>
            <dd>{run.board === 'verified' ? <span className="badge verified">Verified</span> : <span className="badge">Community · self-reported</span>}</dd>
          </div>
          <div>
            <dt>Tools</dt>
            <dd>{TOOL_USE_LABEL[run.tool_use]}</dd>
          </div>
          <div>
            <dt>Challenge</dt>
            <dd>
              {CHALLENGE_LABEL[run.challenge]} · {MODE_LABEL[a.mode]}
            </dd>
          </div>
          <div>
            <dt>Start</dt>
            <dd>
              {a.level
                ? a.certified
                  ? `exactly ${a.level} move${a.level === 1 ? '' : 's'} from solved`
                  : `${a.level} random moves`
                : a.scramble_kind === 'random_state'
                  ? 'uniformly random state'
                  : 'long random scramble'}
            </dd>
          </div>
          <div>
            <dt>Moves used</dt>
            <dd>
              {a.move_count} <span className="faint">/ {a.move_cap} allowed</span>
            </dd>
          </div>
          {a.mode === 'interactive' && (
            <div>
              <dt>Turn calls</dt>
              <dd>{a.turns}</dd>
            </div>
          )}
          <div>
            <dt>Rejected requests</dt>
            <dd>{a.invalid}</dd>
          </div>
          <div>
            <dt>Time</dt>
            <dd>{duration(a.created_at, a.finished_at)}</dd>
          </div>
        </dl>

        {!active && a.scramble && (
          <p className="faint" style={{ marginTop: 14, fontSize: '0.88rem' }}>
            Scramble: <code>{a.scramble}</code>
          </p>
        )}

        {siblings.length > 1 && (
          <div style={{ marginTop: 20 }}>
            <h3>This run</h3>
            <p className="faint" style={{ fontSize: '0.88rem' }}>
              {run.challenge === 'ladder' ? `Best level ${run.best_level}` : ''} {run.status === 'finished'
                ? `· ended: ${siblings.some((x) => outOfOutput(x.detail)) ? OUT_OF_OUTPUT : run.end_reason?.replace(/_/g, ' ')}`
                : '· still going'}
            </p>
            <div className="sibs">
              {siblings.map((s) => (
                <Link key={s.id} prefetch={false} href={`/replay/${s.id}`} className={`chip ${s.id === a.id ? 'on' : ''}`}>
                  {s.level ? `L${s.level}` : `#${s.seq}`} {s.status === 'solved' ? '✓' : s.status === 'active' ? '…' : s.status === 'stopped' ? '–' : '✗'}
                </Link>
              ))}
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
