'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import type { CubeController } from './Cube3D';
import { randomWalk, rng } from '@/lib/cube/scramble';

const Cube3D = dynamic(() => import('./Cube3D'), { ssr: false, loading: () => <div className="cube-loading" /> });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const invert = (moves: string[]) =>
  [...moves].reverse().map((t) => (t.endsWith('2') ? t : t.endsWith("'") ? t.slice(0, -1) : `${t}'`));

/** The homepage cube: scrambles itself, pauses, solves itself, forever. */
export default function HeroCube() {
  const [n, setN] = useState(3);
  const [label, setLabel] = useState('Scrambling…');
  const ctrl = useRef<CubeController | null>(null);
  const [still, setStill] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setStill(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (still) {
      setLabel('Drag me to spin');
      return;
    }
    let alive = true;
    const random = rng((Date.now() ^ (n * 7919)) >>> 0);
    (async () => {
      await sleep(500);
      while (alive) {
        const c = ctrl.current;
        if (!c) {
          await sleep(150);
          continue;
        }
        const walk = randomWalk(n, n === 2 ? 8 : n === 3 ? 12 : 16, random).map((m) => m.token);
        setLabel('Scrambling…');
        await c.play(walk, n > 3 ? 140 : 180);
        if (!alive) break;
        setLabel(`${walk.length} moves from solved. Watch.`);
        await sleep(1100);
        if (!alive) break;
        setLabel('Solving…');
        await c.play(invert(walk), n > 3 ? 120 : 150);
        if (!alive) break;
        setLabel('Solved! ✓');
        await sleep(1500);
      }
    })();
    return () => {
      alive = false;
    };
  }, [n, still]);

  return (
    <div className="hero-cube">
      {/* A demo, not content: one name for the whole stage, and the bubble (it changes every second or two) stays quiet. */}
      <div className="hero-stage" role="img" aria-label={`A ${n}×${n} cube that scrambles and solves itself`}>
        <div className="hero-disc" aria-hidden />
        <Cube3D key={n} n={n} controller={ctrl} autoRotate={!still} className="hero-canvas" />
        <span key={label} className={`bubble ${label.startsWith('Solved') ? 'win' : ''}`} aria-hidden>
          {label}
        </span>
      </div>
      <div className="hero-cube-bar">
        <div className="seg" role="group" aria-label="Cube size">
          {[2, 3, 4, 5].map((s) => (
            <button key={s} onClick={() => setN(s)} aria-pressed={s === n}>
              {s}×{s}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
