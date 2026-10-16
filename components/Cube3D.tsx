'use client';

// A 3D cube driven by the same engine as the server. Stickers are coloured
// from the exact state; a move animates the turning layers, then the layers
// snap home and the stickers are recoloured from the new state, so what you
// see is always the engine's state.

import { OrbitControls } from '@react-three/drei';
import { Canvas, useFrame } from '@react-three/fiber';
import { type RefObject, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { type CubeState, FACES, type Face, type Turn, applyTurn, parseMove, solvedState, stateFromString, stickers } from '@/lib/cube/engine';

// The site's palette. The pictures sent to models keep the atlas colours; this
// is only the 3D cube on the website. Red and orange stay well apart.
const STICKER_COLOUR: Record<Face, string> = {
  U: '#ffffff',
  R: '#e8383f',
  F: '#2bb673',
  D: '#ffd23f',
  L: '#ff9f1c',
  B: '#3d7bff',
};

export interface CubeController {
  /** Animate moves in order; resolves when they have all finished. */
  play(moves: string[], msPerMove?: number): Promise<void>;
  /** Jump to a state without animation (cancels anything playing). */
  set(state: string | CubeState): void;
  state(): CubeState;
}

const STICKER = new THREE.ShapeGeometry(
  (() => {
    const s = new THREE.Shape();
    const h = 0.42;
    const r = 0.09;
    s.moveTo(-h + r, -h);
    s.lineTo(h - r, -h);
    s.quadraticCurveTo(h, -h, h, -h + r);
    s.lineTo(h, h - r);
    s.quadraticCurveTo(h, h, h - r, h);
    s.lineTo(-h + r, h);
    s.quadraticCurveTo(-h, h, -h, h - r);
    s.lineTo(-h, -h + r);
    s.quadraticCurveTo(-h, -h, -h + r, -h);
    return s;
  })(),
);

interface Job {
  turn: Turn;
  ms: number;
  done: () => void;
}

function Model({ n, initial, controller }: { n: number; initial: CubeState; controller: RefObject<CubeController | null> }) {
  const built = useMemo(() => {
    const root = new THREE.Group();
    const pivot = new THREE.Group();
    root.add(pivot);
    const cubies = new Map<string, { group: THREE.Group; home: THREE.Vector3; coord: [number, number, number] }>();
    // Unlit: every sticker shows its exact colour from any angle, with no shading or highlights.
    const body = new THREE.MeshBasicMaterial({ color: '#0b0b0e' });
    const box = new THREE.BoxGeometry(0.97, 0.97, 0.97);
    const mats: THREE.MeshBasicMaterial[] = [];
    for (const s of stickers(n)) {
      const key = s.pos.join(',');
      let c = cubies.get(key);
      if (!c) {
        const group = new THREE.Group();
        const home = new THREE.Vector3(s.pos[0] / 2, s.pos[1] / 2, s.pos[2] / 2);
        group.position.copy(home);
        group.add(new THREE.Mesh(box, body));
        root.add(group);
        c = { group, home, coord: [...s.pos] as [number, number, number] };
        cubies.set(key, c);
      }
      const mat = new THREE.MeshBasicMaterial({ color: STICKER_COLOUR.U, side: THREE.FrontSide });
      const mesh = new THREE.Mesh(STICKER, mat);
      const normal = new THREE.Vector3(...s.normal);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
      mesh.position.copy(normal.multiplyScalar(0.49));
      c.group.add(mesh);
      mats.push(mat);
    }
    return { root, pivot, cubies: [...cubies.values()], mats };
  }, [n]);

  const state = useRef<CubeState>(initial);
  const queue = useRef<Job[]>([]);
  const active = useRef<{ job: Job; t: number; angle: number; axis: 0 | 1 | 2 } | null>(null);

  const paint = () => {
    const s = state.current;
    built.mats.forEach((m, i) => m.color.set(STICKER_COLOUR[FACES[s[i]]]));
  };

  const settle = () => {
    for (const c of built.cubies) {
      if (c.group.parent !== built.root) built.root.attach(c.group);
      c.group.position.copy(c.home);
      c.group.quaternion.identity();
    }
    built.pivot.rotation.set(0, 0, 0);
  };

  useEffect(() => {
    state.current = initial;
    paint();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [built, initial]);

  useEffect(() => {
    controller.current = {
      play: (moves, ms = 260) =>
        new Promise<void>((resolve) => {
          if (moves.length === 0) return resolve();
          moves.forEach((tok, i) => {
            const turn = parseMove(tok, n).turn;
            queue.current.push({ turn, ms, done: i === moves.length - 1 ? resolve : () => {} });
          });
        }),
      set: (s) => {
        queue.current.forEach((j) => j.done());
        queue.current = [];
        if (active.current) active.current.job.done();
        active.current = null;
        settle();
        state.current = typeof s === 'string' ? stateFromString(s, n) : s;
        paint();
      },
      state: () => state.current,
    };
    return () => {
      controller.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [built, n]);

  useFrame((_, delta) => {
    if (!active.current) {
      const job = queue.current.shift();
      if (!job) return;
      const layers = new Set(job.turn.layers);
      for (const c of built.cubies) if (layers.has(c.coord[job.turn.axis])) built.pivot.attach(c.group);
      const q = job.turn.quarter;
      active.current = { job, t: 0, angle: q === 3 ? -Math.PI / 2 : (q * Math.PI) / 2, axis: job.turn.axis };
    }
    const a = active.current;
    a.t = Math.min(1, a.t + (delta * 1000) / Math.max(30, a.job.ms));
    const e = a.t < 0.5 ? 2 * a.t * a.t : 1 - (-2 * a.t + 2) ** 2 / 2;
    const r = built.pivot.rotation;
    r.set(a.axis === 0 ? a.angle * e : 0, a.axis === 1 ? a.angle * e : 0, a.axis === 2 ? a.angle * e : 0);
    if (a.t >= 1) {
      state.current = applyTurn(state.current, n, a.job.turn);
      settle();
      paint();
      active.current = null;
      a.job.done();
    }
  });

  return <primitive object={built.root} />;
}

export default function Cube3D({
  n,
  initial,
  controller,
  autoRotate = false,
  className,
}: {
  n: number;
  initial?: string;
  controller?: RefObject<CubeController | null>;
  autoRotate?: boolean;
  className?: string;
}) {
  const fallback = useRef<CubeController | null>(null);
  const start = useMemo(() => (initial ? stateFromString(initial, n) : solvedState(n)), [initial, n]);
  // Far enough that corners stay inside the frame while it spins.
  const dist = 2.5 * n + 3.4;
  const cam = new THREE.Vector3(1, 0.85, 1.25).normalize().multiplyScalar(dist);
  return (
    <div className={className}>
      <Canvas flat camera={{ position: [cam.x, cam.y, cam.z], fov: 32 }} dpr={[1, 2]} gl={{ antialias: true, alpha: true }}>
        <Model key={n} n={n} initial={start} controller={controller ?? fallback} />
        <OrbitControls enablePan={false} enableZoom={false} autoRotate={autoRotate} autoRotateSpeed={0.9} />
      </Canvas>
    </div>
  );
}
