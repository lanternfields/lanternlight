/**
 * Classifier & feature checks on *captured* hand skeletons: IWER's pose library
 * (built on a real Quest hand capture, MIT, Meta) - the closest thing to real
 * hand-tracking data available without a headset.
 */
import { describe, expect, it } from 'vitest';
import poses from '../e2e/fixtures/iwer-poses.json';
import { JOINT_NAMES, createHandFrame, HandFrame } from '../src/core/hand-model.js';
import {
  MouthDetector,
  PoseClassifier,
  computeFeatures,
  createFeatures,
} from '../src/core/hand-features.js';
import { mulberry32 } from '../src/core/math.js';

type PoseData = { jointTransforms: Record<string, { offsetMatrix: number[]; radius: number }> };
const P = poses as unknown as Record<string, PoseData>;

/** Joint positions from a pose; optional rigid rotation + noise. */
export function handFromPose(
  name: string,
  opts: { yawDeg?: number; pitchDeg?: number; noise?: number; seed?: number } = {},
): HandFrame {
  const hand = createHandFrame('right');
  const data = P[name].jointTransforms;
  const yaw = ((opts.yawDeg ?? 0) * Math.PI) / 180;
  const pitch = ((opts.pitchDeg ?? 0) * Math.PI) / 180;
  const rng = mulberry32(opts.seed ?? 3);
  const n = opts.noise ?? 0;
  JOINT_NAMES.forEach((jn, i) => {
    const m = data[jn].offsetMatrix;
    let x = m[12];
    let y = m[13];
    let z = m[14];
    // pitch about X then yaw about Y
    const y1 = y * Math.cos(pitch) - z * Math.sin(pitch);
    const z1 = y * Math.sin(pitch) + z * Math.cos(pitch);
    y = y1;
    z = z1;
    const x2 = x * Math.cos(yaw) + z * Math.sin(yaw);
    const z2 = -x * Math.sin(yaw) + z * Math.cos(yaw);
    x = x2;
    z = z2;
    const j = () => (rng() + rng() + rng() - 1.5) * n * 1.15;
    hand.joints[i].set(x + j(), y + j(), z + j());
    hand.radii[i] = data[jn].radius;
  });
  hand.tracked = true;
  return hand;
}

function classify(name: string, noise = 0, frames = 60, seed = 1): string {
  const c = new PoseClassifier();
  let r = 'none';
  for (let i = 0; i < frames; i++) {
    r = c.update(computeFeatures(handFromPose(name, { noise, seed: seed * 1000 + i, yawDeg: 30, pitchDeg: -20 }), createFeatures()), 1 / 72);
  }
  return r;
}

/** Story-relevant expectations for captured poses. */
const EXPECT: Record<string, string> = {
  open: 'open',
  flat: 'open',
  fist: 'fist',
  peace: 'rabbit',
  rock: 'horns',
  call: 'call',
  'thumbs-up': 'fist',
  'finger-gun': 'point',
};

describe('captured skeletons (IWER library)', () => {
  it('fixture has the expected poses', () => {
    for (const k of Object.keys(EXPECT)) expect(P[k]).toBeTruthy();
  });

  for (const [pose, expected] of Object.entries(EXPECT)) {
    it(`${pose} -> ${expected}`, () => {
      expect(classify(pose)).toBe(expected);
    });
    it(`${pose} -> ${expected} with 6 mm tracking noise`, () => {
      let ok = 0;
      for (let s = 1; s <= 10; s++) if (classify(pose, 0.006, 60, s) === expected) ok++;
      expect(ok).toBeGreaterThanOrEqual(9);
    });
  }

  it('never mistakes a non-rabbit for the rabbit', () => {
    for (const name of Object.keys(P)) {
      if (name === 'peace') continue;
      expect([name, classify(name)]).not.toEqual([name, 'rabbit']);
    }
  });

  it('pinch closes the crocodile mouth, open/flat open it', () => {
    const ap = (n: string) => computeFeatures(handFromPose(n), createFeatures()).aperture;
    const m = new MouthDetector();
    for (const n of ['pinch', 'pinchCaptured', 'tripod']) {
      if (!P[n]) continue;
      expect(ap(n)).toBeLessThan(m.closeAt);
    }
    for (const n of ['open', 'relaxed', 'peace']) expect(ap(n)).toBeGreaterThan(m.openAt);
    // a flat blade sits between the thresholds: hysteresis keeps the previous state
    expect(ap('flat')).toBeGreaterThan(m.closeAt);
  });
});
