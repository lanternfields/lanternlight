import { describe, expect, it } from 'vitest';
import {
  GENTLE_CLASSIFIER,
  MouthDetector,
  PoseClassifier,
  computeFeatures,
  createFeatures,
  scorePoses,
  PoseScore,
} from '../src/core/hand-features.js';
import { V3 } from '../src/core/math.js';
import { POSES, makeHand } from './fixtures/synthetic-hand.js';

const EXPECT: Record<string, string> = {
  open: 'open',
  flat: 'open',
  fist: 'fist',
  rabbit: 'rabbit',
  point: 'point',
  horns: 'horns',
  call: 'call',
};
// 'claw' is validated against IWER's captured skeletons (tests/iwer-poses.test.ts).

function classifyStatic(name: string, opts: Parameters<typeof makeHand>[1]): string {
  const c = new PoseClassifier();
  let result = 'none';
  for (let i = 0; i < 40; i++) {
    const hand = makeHand(POSES[name], { ...opts, seed: (opts.seed ?? 1) * 100 + i });
    result = c.update(computeFeatures(hand, createFeatures()), 1 / 72);
  }
  return result;
}

describe('hand features', () => {
  it('extension is ~1 for straight fingers and ~0 for a fist', () => {
    const open = computeFeatures(makeHand(POSES.open, { position: new V3(0, 1.1, -0.4) }), createFeatures());
    const fist = computeFeatures(makeHand(POSES.fist, { position: new V3(0, 1.1, -0.4) }), createFeatures());
    for (const f of ['index', 'middle', 'ring', 'pinky'] as const) {
      expect(open.extension[f]).toBeGreaterThan(0.85);
      expect(fist.extension[f]).toBeLessThan(0.2);
    }
  });

  it('features are invariant to position, orientation, scale and handedness', () => {
    const ref = computeFeatures(makeHand(POSES.rabbit, { position: new V3(0, 0, 0) }), createFeatures());
    const variants = [
      { position: new V3(1, 2, 3), yaw: 70, pitch: -30, roll: 45 },
      { position: new V3(-0.3, 1.2, -0.5), yaw: -120, pitch: 60, roll: -80, scale: 0.85 },
      { position: new V3(0.2, 1.0, -0.4), yaw: 10, scale: 1.15, handedness: 'left' as const },
    ];
    for (const v of variants) {
      const f = computeFeatures(makeHand(POSES.rabbit, v), createFeatures());
      for (const k of ['thumb', 'index', 'middle', 'ring', 'pinky'] as const) {
        expect(Math.abs(f.extension[k] - ref.extension[k])).toBeLessThan(0.02);
      }
      expect(Math.abs(f.aperture - ref.aperture)).toBeLessThan(0.02);
    }
  });

  it('aperture distinguishes an open mouth from a closed one', () => {
    const open = computeFeatures(makeHand(POSES.mouthOpen, { position: new V3() }), createFeatures());
    const closed = computeFeatures(makeHand(POSES.mouthClosed, { position: new V3() }), createFeatures());
    expect(open.aperture).toBeGreaterThan(closed.aperture + 0.3);
    const m = new MouthDetector();
    expect(open.aperture).toBeGreaterThan(m.openAt);
    expect(closed.aperture).toBeLessThan(m.closeAt);
  });
});

describe('pose classifier', () => {
  for (const [name, expected] of Object.entries(EXPECT)) {
    it(`recognises ${name} from many orientations`, () => {
      for (const [yaw, pitch, roll] of [
        [0, 0, 0],
        [90, 20, -30],
        [-60, -45, 80],
        [170, 10, 10],
      ]) {
        expect(classifyStatic(name, { position: new V3(0.1, 1.1, -0.45), yaw, pitch, roll })).toBe(expected);
      }
    });
  }

  it('survives realistic joint noise (6 mm) without flicker', () => {
    for (const name of ['rabbit', 'fist', 'open', 'point']) {
      const c = new PoseClassifier();
      let correct = 0;
      let switches = 0;
      let last = 'none';
      const frames = 300;
      for (let i = 0; i < frames; i++) {
        const hand = makeHand(POSES[name], {
          position: new V3(0, 1.1, -0.45),
          yaw: 20,
          pitch: -15,
          noise: 0.006,
          seed: i + 1,
        });
        const r = c.update(computeFeatures(hand, createFeatures()), 1 / 72);
        if (i > 40 && r === EXPECT[name]) correct++;
        if (r !== last) switches++;
        last = r;
      }
      expect(correct / (frames - 41)).toBeGreaterThan(0.95);
      expect(switches).toBeLessThanOrEqual(2);
    }
  });

  it('gentle mode accepts sloppier rabbits', () => {
    const sloppy = { ...POSES.rabbit, index: 0.65, middle: 0.6, ring: 0.35, pinky: 0.3 };
    const gentle = new PoseClassifier(GENTLE_CLASSIFIER);
    let r = 'none';
    for (let i = 0; i < 40; i++) {
      r = gentle.update(computeFeatures(makeHand(sloppy, { position: new V3() }), createFeatures()), 1 / 72);
    }
    expect(r).toBe('rabbit');
  });

  it('a hand with no clear shape reports none', () => {
    const scores: PoseScore[] = [];
    const ambiguous = { thumb: 0.5, index: 0.75, middle: 0.25, ring: 0.75, pinky: 0.25 };
    scorePoses(computeFeatures(makeHand(ambiguous, { position: new V3() }), createFeatures()), scores);
    const c = new PoseClassifier();
    let r = 'x';
    for (let i = 0; i < 40; i++) r = c.update(computeFeatures(makeHand(ambiguous, { position: new V3() }), createFeatures()), 1 / 72);
    expect(r).toBe('none');
  });
});

describe('mouth detector', () => {
  it('does not chatter when aperture jitters around a threshold', () => {
    const m = new MouthDetector();
    let edges = 0;
    for (let i = 0; i < 500; i++) {
      const a = m.openAt - 0.02 + Math.sin(i * 1.7) * 0.06; // straddles openAt only
      const e = m.update(a, 1 / 72);
      if (e.opened || e.closed) edges++;
    }
    expect(edges).toBeLessThanOrEqual(1);
  });

  it('reports one open and one close per chomp', () => {
    const m = new MouthDetector();
    let opened = 0;
    let closed = 0;
    for (let c = 0; c < 5; c++) {
      for (let i = 0; i < 30; i++) if (m.update(1.0, 1 / 72).opened) opened++;
      for (let i = 0; i < 30; i++) if (m.update(0.2, 1 / 72).closed) closed++;
    }
    expect(opened).toBe(5);
    expect(closed).toBe(5);
  });
});
