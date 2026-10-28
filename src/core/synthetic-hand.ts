/**
 * Parametric synthetic hand skeleton (25 WebXR joints). Used for the ghost
 * hint silhouettes on stage and by the unit tests.
 *
 * Local frame (right hand): wrist at origin, fingers along +Y, palm facing +Z,
 * thumb on +X. Flexion curls fingers toward +Z (into the palm).
 * Anatomical proportions are approximate adult values; the point is to exercise
 * the features/classifier through orientation, scale, curl and noise changes.
 */
import { HandFrame, J, createHandFrame } from './hand-model.js';
import { V3, mulberry32 } from './math.js';

export interface SyntheticPose {
  /** Extension per finger 0 (curled) .. 1 (straight). */
  thumb: number;
  index: number;
  middle: number;
  ring: number;
  pinky: number;
  /** Lateral spread 0..1. */
  spread?: number;
  /** 0..1 thumb opposition toward the fingertips (pinch/mouth closing). */
  thumbOppose?: number;
}

export const POSES: Record<string, SyntheticPose> = {
  open: { thumb: 1, index: 1, middle: 1, ring: 1, pinky: 1, spread: 0.8 },
  flat: { thumb: 1, index: 1, middle: 1, ring: 1, pinky: 1, spread: 0.1 },
  fist: { thumb: 0.2, index: 0, middle: 0, ring: 0, pinky: 0 },
  rabbit: { thumb: 0.3, index: 1, middle: 1, ring: 0, pinky: 0, spread: 0.5 },
  point: { thumb: 0.3, index: 1, middle: 0, ring: 0, pinky: 0 },
  horns: { thumb: 0.3, index: 1, middle: 0, ring: 0, pinky: 1 },
  call: { thumb: 1, index: 0, middle: 0, ring: 0, pinky: 1, spread: 0.6 },
  claw: { thumb: 0.6, index: 0.5, middle: 0.5, ring: 0.5, pinky: 0.5, spread: 0.6 },
  mouthOpen: { thumb: 1, index: 1, middle: 1, ring: 1, pinky: 1, spread: 0.05, thumbOppose: 0 },
  mouthClosed: { thumb: 1, index: 1, middle: 1, ring: 1, pinky: 1, spread: 0.05, thumbOppose: 1 },
};

interface FingerSpec {
  base: [number, number, number];
  knuckle: [number, number, number];
  lengths: [number, number, number];
}

const FINGER_SPECS: FingerSpec[] = [
  { base: [0.021, 0.012, 0], knuckle: [0.025, 0.087, 0], lengths: [0.041, 0.024, 0.021] },
  { base: [0.006, 0.013, 0], knuckle: [0.007, 0.091, 0], lengths: [0.045, 0.028, 0.022] },
  { base: [-0.009, 0.012, 0], knuckle: [-0.011, 0.085, 0], lengths: [0.042, 0.026, 0.021] },
  { base: [-0.022, 0.01, 0], knuckle: [-0.028, 0.076, 0], lengths: [0.033, 0.02, 0.018] },
];

const DEG = Math.PI / 180;
const THUMB_LENS = [0.042, 0.032, 0.027];

const SPREAD_DEG = [-10, -2, 6, 14];
const BASE_IDX = [J.indexMeta, J.middleMeta, J.ringMeta, J.pinkyMeta];
const _exts = [0, 0, 0, 0];
const _spread = [0, 0, 0, 0];
const _flex = [0, 0, 0];
const _local: V3[] = [];
for (let i = 0; i < 25; i++) _local.push(new V3());

/** Builds joints in the local hand frame (into `out`, reused: no allocation). */
function localJoints(pose: SyntheticPose, handScale = 1, out: V3[] = _local): V3[] {
  out[J.wrist].set(0, 0, 0);
  const spread = pose.spread ?? 0.4;
  const exts = _exts;
  exts[0] = pose.index;
  exts[1] = pose.middle;
  exts[2] = pose.ring;
  exts[3] = pose.pinky;
  const spreadAngles = _spread;
  for (let i = 0; i < 4; i++) spreadAngles[i] = SPREAD_DEG[i] * spread * DEG;
  const baseIdx = BASE_IDX;
  for (let f = 0; f < 4; f++) {
    const spec = FINGER_SPECS[f];
    const e = Math.max(0, Math.min(1, exts[f]));
    const b = out[baseIdx[f]];
    b.set(spec.base[0], spec.base[1], spec.base[2]);
    const k = out[baseIdx[f] + 1];
    k.set(spec.knuckle[0], spec.knuckle[1], spec.knuckle[2]);
    // Flexion angles (MCP, PIP, DIP)
    const flex = _flex;
    flex[0] = (1 - e) * 82 * DEG;
    flex[1] = (1 - e) * 100 * DEG;
    flex[2] = (1 - e) * 65 * DEG;
    let angle = 0;
    let px = k.x;
    let py = k.y;
    let pz = k.z;
    const yaw = -spreadAngles[f]; // lateral tilt around Z
    for (let s = 0; s < 3; s++) {
      angle += flex[s];
      const len = spec.lengths[s];
      // direction in the finger's plane: start along +Y, flex toward +Z
      const dy = Math.cos(angle);
      const dz = Math.sin(angle);
      const dx = Math.sin(yaw) * dy;
      const dyy = Math.cos(yaw) * dy;
      px += dx * len;
      py += dyy * len;
      pz += dz * len;
      out[baseIdx[f] + 2 + s].set(px, py, pz);
    }
  }
  // Thumb: metacarpal base near the wrist, pointing up-and-out.
  const te = Math.max(0, Math.min(1, pose.thumb));
  const oppose = Math.max(0, Math.min(1, pose.thumbOppose ?? 0));
  out[J.thumbMeta].set(0.02, 0.022, 0.012);
  const tLens = THUMB_LENS;
  // Base direction: up/out; opposition rotates it toward the index fingertip.
  let ang = (52 - oppose * 30) * DEG; // angle from +Y toward +X
  let flexZ = (8 + oppose * 25) * DEG;
  let px = out[J.thumbMeta].x;
  let py = out[J.thumbMeta].y;
  let pz = out[J.thumbMeta].z;
  const curl = (1 - te) * 55 * DEG;
  for (let s = 0; s < 3; s++) {
    if (s > 0) {
      ang -= curl * 0.9 + oppose * 0.18;
      flexZ += curl * 0.7 + oppose * 0.32;
    }
    const len = tLens[s];
    const dirX = Math.sin(ang) * Math.cos(flexZ);
    const dirY = Math.cos(ang) * Math.cos(flexZ);
    const dirZ = Math.sin(flexZ);
    px += dirX * len;
    py += dirY * len;
    pz += dirZ * len;
    out[J.thumbProx + s].set(px, py, pz);
  }
  if (oppose > 0) {
    // Bring the thumb tip (and partly the distal joint) to the index/middle tips.
    const mx = (out[J.indexTip].x + out[J.middleTip].x) / 2;
    const my = (out[J.indexTip].y + out[J.middleTip].y) / 2 - 0.004;
    const mz = (out[J.indexTip].z + out[J.middleTip].z) / 2 + 0.012;
    const tip = out[J.thumbTip];
    const dj = out[J.thumbDist];
    tip.set(tip.x + (mx - tip.x) * oppose, tip.y + (my - tip.y) * oppose, tip.z + (mz - tip.z) * oppose);
    const k = oppose * 0.6;
    dj.set(dj.x + (mx - 0.01 - dj.x) * k, dj.y + (my - 0.025 - dj.y) * k, dj.z + (mz + 0.01 - dj.z) * k);
  }
  if (handScale !== 1) for (const p of out) p.set(p.x * handScale, p.y * handScale, p.z * handScale);
  return out;
}

export interface Placement {
  position: V3;
  /** Rotation as yaw/pitch/roll in degrees (applied Z, then X, then Y). */
  yaw?: number;
  pitch?: number;
  roll?: number;
  scale?: number;
  handedness?: 'left' | 'right';
  /** Gaussian-ish joint noise (metres). */
  noise?: number;
  seed?: number;
}

function rotate(p: V3, yaw: number, pitch: number, roll: number): V3 {
  // roll about Z
  let x = p.x * Math.cos(roll) - p.y * Math.sin(roll);
  let y = p.x * Math.sin(roll) + p.y * Math.cos(roll);
  let z = p.z;
  // pitch about X
  const y2 = y * Math.cos(pitch) - z * Math.sin(pitch);
  const z2 = y * Math.sin(pitch) + z * Math.cos(pitch);
  y = y2;
  z = z2;
  // yaw about Y
  const x3 = x * Math.cos(yaw) + z * Math.sin(yaw);
  const z3 = -x * Math.sin(yaw) + z * Math.cos(yaw);
  x = x3;
  z = z3;
  return p.set(x, y, z);
}

/** Poses a synthetic hand. Pass `out` to reuse a HandFrame (no allocation per call). */
export function makeHand(pose: SyntheticPose, place: Placement, out?: HandFrame): HandFrame {
  const handed = place.handedness ?? 'right';
  const hand = out ?? createHandFrame(handed);
  hand.handedness = handed;
  const local = localJoints(pose, place.scale ?? 1);
  const rng = mulberry32(place.seed ?? 1);
  const noise = place.noise ?? 0;
  for (let i = 0; i < 25; i++) {
    const p = local[i];
    if (handed === 'left') p.x = -p.x;
    rotate(p, (place.yaw ?? 0) * DEG, (place.pitch ?? 0) * DEG, (place.roll ?? 0) * DEG);
    let nx = 0;
    let ny = 0;
    let nz = 0;
    if (noise > 0) {
      // sum of uniforms ~ gaussian
      nx = (rng() + rng() + rng() - 1.5) * noise * 1.15;
      ny = (rng() + rng() + rng() - 1.5) * noise * 1.15;
      nz = (rng() + rng() + rng() - 1.5) * noise * 1.15;
    }
    hand.joints[i].set(p.x + place.position.x + nx, p.y + place.position.y + ny, p.z + place.position.z + nz);
  }
  hand.tracked = true;
  return hand;
}
