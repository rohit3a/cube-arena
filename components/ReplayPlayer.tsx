'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CubeController } from './Cube3D';
import { confetti } from './confetti';
import { type CubeState, applyTurn, parseMove, stateFromString } from '@/lib/cube/engine';

const Cube3D = dynamic(() => import('./Cube3D'), { ssr: false, loading: () => <div className="cube-loading" /> });

export interface Checkpoint {
  /** Moves applied when the model was shown this picture. */
  moveCount: number;
  label: string;
}

const SPEEDS = [0.5, 1, 2, 4];

export default function ReplayPlayer({
  attemptId,
  n,
  initial,
  moves,
  checkpoints,
  solved,
}: {
  attemptId: string;
  /** Whether the attempt ended solved: the last move gets a stamp and confetti. */
  solved: boolean;
  n: number;
  initial: string;
  moves: string[];
  checkpoints: Checkpoint[];
}) {
  const ctrl = useRef<CubeController | null>(null);
  const stage = useRef<HTMLDivElement | null>(null);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const busy = useRef(false);
  // Bumped on every jump, so a move that was mid-animation during a jump is not counted.
  const gen = useRef(0);

  // State after k moves, for instant jumps.
  const states = useMemo(() => {
    const out: CubeState[] = [stateFromString(initial, n)];
    for (const m of moves) out.push(applyTurn(out[out.length - 1], n, parseMove(m, n).turn));
    return out;
  }, [initial, moves, n]);

  const jump = (k: number) => {
    const c = Math.max(0, Math.min(moves.length, k));
    gen.current += 1;
    setPlaying(false);
    busy.current = false;
    ctrl.current?.set(states[c]);
    setIdx(c);
  };

  useEffect(() => {
    if (!playing) return;
    if (idx >= moves.length) {
      setPlaying(false);
      if (solved && moves.length > 0) confetti(stage.current);
      return;
    }
    if (busy.current) return;
    busy.current = true;
    const ms = 420 / speed;
    const myGen = gen.current;
    (async () => {
      // Wait for the canvas to mount on first play.
      for (let i = 0; i < 50 && !ctrl.current; i++) await new Promise((r) => setTimeout(r, 50));
      await ctrl.current?.play([moves[idx]], ms);
      if (gen.current !== myGen) return;
      busy.current = false;
      // Count the move even if paused meanwhile: the cube has already turned.
      setIdx((i) => i + 1);
    })();
  }, [playing, idx, moves, speed, solved]);

  const togglePlay = () => {
    if (idx >= moves.length) {
      jump(0);
      setTimeout(() => setPlaying(true), 60);
    } else setPlaying((p) => !p);
  };

  const shown = checkpoints.filter((c) => c.moveCount <= idx).at(-1);

  return (
    <div className="player">
      <div className="player-stage" ref={stage}>
        <Cube3D n={n} initial={initial} controller={ctrl} className="player-canvas" />
        <div className="player-hud">
          <span>
            move <strong>{idx}</strong> / {moves.length}
          </span>
          {moves[idx - 1] && <span className="move-pill">{moves[idx - 1]}</span>}
        </div>
        {idx === moves.length && moves.length > 0 && (solved ? <span className="stamp">Solved!</span> : <span className="stamp miss">Not solved</span>)}
      </div>

      <div className="controls">
        <button className="btn btn-small" onClick={() => jump(0)} aria-label="Back to start">
          ⏮
        </button>
        <button className="btn btn-small" onClick={() => jump(idx - 1)} aria-label="Previous move">
          ◀
        </button>
        <button className="btn btn-primary" onClick={togglePlay} disabled={moves.length === 0}>
          {playing ? 'Pause' : idx >= moves.length && moves.length > 0 ? 'Replay' : 'Play'}
        </button>
        <button className="btn btn-small" onClick={() => jump(idx + 1)} aria-label="Next move">
          ▶
        </button>
        <button className="btn btn-small" onClick={() => jump(moves.length)} aria-label="Jump to end">
          ⏭
        </button>
        <div className="chips" role="group" aria-label="Speed">
          {SPEEDS.map((s) => (
            <button key={s} className={`chip ${s === speed ? 'on' : ''}`} onClick={() => setSpeed(s)} aria-pressed={s === speed}>
              {s}×
            </button>
          ))}
        </div>
      </div>

      <input
        type="range"
        className="scrub"
        min={0}
        max={moves.length}
        value={idx}
        onChange={(e) => jump(Number(e.target.value))}
        aria-label="Move position"
      />

      <div className="move-list" aria-label="Moves">
        {moves.length === 0 && <span className="muted">No moves were made.</span>}
        {moves.map((m, i) => (
          <button key={i} className={`mv ${i < idx ? 'done' : ''} ${i === idx - 1 ? 'cur' : ''}`} onClick={() => jump(i + 1)}>
            {checkpoints.some((c) => c.moveCount === i && i > 0) && <span className="sep" aria-hidden />}
            {m}
          </button>
        ))}
      </div>

      {checkpoints.length > 0 && (
        <div className="seen">
          <h2>What the model saw</h2>
          <p className="muted">
            Each picture is the exact image the model was sent{shown ? `; highlighted: ${shown.label}` : ''}.
          </p>
          <div className="seen-strip">
            {checkpoints.map((c, i) => (
              <button key={i} className={`seen-card ${shown === c ? 'on' : ''}`} onClick={() => jump(c.moveCount)}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/image/${attemptId}?m=${c.moveCount}`} alt={`Picture shown to the model: ${c.label}`} width={1400} height={800} loading="lazy" />
                <span>{c.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
