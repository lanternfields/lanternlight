/**
 * Ghost hints: a faint, animated hand-shadow that shows (never tells) the shape
 * to make. Built from the synthetic skeleton and drawn through the very same
 * capsule pipeline as a real hand, so the hint looks exactly like the result.
 */
import { DEFAULT_RADII, SHADOW_BONES } from './hand-model.js';
import { V3 } from './math.js';
import { Capsule2D } from './shadow-model.js';
import { POSES, SyntheticPose, makeHand } from './synthetic-hand.js';
import type { GhostPose } from './story.js';

/** Metres (of hand) to stage units for ghosts. */
const K = 2.2;

const _origin = new V3(0, 0, 0);

export function ghostCapsules(
  pose: GhostPose,
  s: number,
  t: number,
  scale: number,
  phase: number,
  out: Capsule2D[],
  maxOut: number,
): number {
  let p: SyntheticPose;
  let roll = 0;
  let pitch = 0;
  let yaw = 0;
  let ox = 0;
  let oy = -0.09;
  switch (pose) {
    case 'open': {
      p = POSES.open;
      roll = Math.sin(phase * 2.6) * 18; // a friendly wave
      break;
    }
    case 'rabbit': {
      // Ears that wiggle: index/middle flex a little in turn.
      const w = Math.sin(phase * 3) * 0.12;
      p = { ...POSES.rabbit, index: 0.95 + w, middle: 0.95 - w };
      roll = -12;
      break;
    }
    case 'mouth': {
      const o = 0.5 + 0.5 * Math.sin(phase * 3.2);
      p = { ...POSES.mouthOpen, thumbOppose: o > 0.5 ? (o - 0.5) * 2 : 0 };
      roll = -90; // fingers point right, thumb underneath
      ox = -0.09;
      oy = 0;
      break;
    }
    case 'bridge': {
      p = POSES.flat;
      roll = -90;
      pitch = 90; // palm down: seen edge-on it is a long low bar
      ox = -0.09;
      oy = 0;
      break;
    }
  }
  const hand = makeHand(p, { position: _origin, roll, pitch, yaw });
  let n = 0;
  const k = K * scale;
  for (const [a, b] of SHADOW_BONES) {
    if (n >= maxOut) break;
    const ja = hand.joints[a];
    const jb = hand.joints[b];
    const c = out[n++];
    c.ax = s + (ja.x + ox) * k;
    c.ay = t + (ja.y + oy) * k;
    c.bx = s + (jb.x + ox) * k;
    c.by = t + (jb.y + oy) * k;
    c.r = Math.max(DEFAULT_RADII[a], DEFAULT_RADII[b]) * k;
    c.soft = 0.02;
    c.actor = -2;
  }
  return n;
}
