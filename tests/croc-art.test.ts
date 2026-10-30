/**
 * The crocodile reads at a glance (STYLE_GUIDE §3): the arm is a short,
 * tapering, fading stub that continues the hand's line (never a column from
 * below), the dress gives one clean snout, teeth only while the jaw is open,
 * and swallowed fireflies glow inside the head, not out along the arm.
 */
import { describe, expect, it } from 'vitest';
import { V3 } from '../src/core/math.js';
import { computeFocalLight, createProjected, createStageFrame, orientStage, projectToStage, stageHeightForDistance } from '../src/core/projection.js';
import { FOREARM_RADIUS, ShadowModel } from '../src/core/shadow-model.js';
import { createHandFrame } from '../src/core/hand-model.js';
import { CrocOverlay, type CapsuleSink, type GlowSink } from '../src/render/croc-overlay.js';
import { NIGHT_CROC_EXTENT, NIGHT_CROC_SCALE } from '../src/core/story.js';
import { POSES, makeHand } from './fixtures/synthetic-hand.js';

function setup(distance = 2) {
  const st = createStageFrame();
  st.origin.set(0, 1.1, -distance);
  orientStage(st, new V3(0, 0, 1));
  st.height = stageHeightForDistance(distance);
  const head = new V3(0, 1.2, 0);
  const light = computeFocalLight(st, head, new V3());
  const m = new ShadowModel();
  const p = createProjected();
  projectToStage(new V3(0, 0.98, -0.42), light, st, p);
  m.nominalMagnification = p.magnification;
  return { st, light, m };
}

/** A crocodile hand held side-on (fingers to the right, thumb under), jaw open 0..1. */
function croc(open: number) {
  const { st, light, m } = setup();
  const pose = { ...POSES.mouthOpen, thumbOppose: 1 - open };
  const hand = makeHand(pose, { position: new V3(0, 0.98, -0.42), roll: -90 });
  m.build([createHandFrame('left'), hand], [], light, st, 1 / 72);
  return { m, actor: m.actors[1] };
}

class Sink implements CapsuleSink {
  readonly caps: { ax: number; ay: number; bx: number; by: number; r: number; rb: number; strength: number }[] = [];
  pushRaw(ax: number, ay: number, bx: number, by: number, r: number, _soft: number, strength = 1, rb = r): void {
    this.caps.push({ ax, ay, bx, by, r, rb, strength });
  }
}
class Glows implements GlowSink {
  readonly items: { x: number; y: number; r: number; i: number }[] = [];
  push(x: number, y: number, r: number, i: number): void {
    this.items.push({ x, y, r, i });
  }
}

function dress(open: number, full = 0, frames = 40) {
  const { m, actor } = croc(open);
  const o = new CrocOverlay();
  let details = new Sink();
  let glows = new Glows();
  for (let i = 0; i < frames; i++) {
    details = new Sink();
    glows = new Glows();
    o.update(1 / 60, m, actor, 1, open, i / 60, details, new Sink(), glows, full);
  }
  return { m, actor, details, glows };
}

describe('the arm of a shadow puppet', () => {
  it('tapers from the wrist and fades out completely', () => {
    expect(FOREARM_RADIUS[1]).toBeLessThan(FOREARM_RADIUS[0]);
    const { m } = croc(0.6);
    const fa = m.capsules.slice(0, m.capsuleCount).find((c) => c.forearm)!;
    expect(fa.fadeB).toBe(0);
    expect(fa.rb!).toBeLessThan(fa.r);
  });

  it('a crocodile held side-on: the arm continues the hand to the left, not down in a column', () => {
    const { m, actor } = croc(0.6);
    const fa = m.capsules.slice(0, m.capsuleCount).find((c) => c.forearm)!;
    const dx = fa.bx - fa.ax;
    const dy = fa.by - fa.ay;
    // the snout points right, so the arm runs left from the wrist...
    expect(actor.upperS).toBeGreaterThan(actor.knuckleS);
    expect(dx).toBeLessThan(0);
    // ...and stays well under 45 degrees from horizontal
    expect(Math.abs(dy)).toBeLessThan(Math.abs(dx));
  });
});

describe('the crocodile your hand becomes', () => {
  it('teeth show only while the jaw is open', () => {
    const shut = dress(0).details.caps.length;
    const wide = dress(1).details.caps.length;
    // 3 back scutes at most, 2 arm scutes, snout, nostril, brow: no teeth when shut
    expect(shut).toBeLessThanOrEqual(8);
    // wide open: at least three more pieces (teeth)
    expect(wide).toBeGreaterThanOrEqual(shut + 3);
  });

  it('one clean snout: a tapered piece along the top, reaching a little past the fingertips', () => {
    const { actor, details } = dress(0.6);
    const snout = details.caps[0];
    expect(snout.rb).toBeLessThan(snout.r);
    const ax = actor.upperS - actor.knuckleS;
    const ay = actor.upperT - actor.knuckleT;
    const len = Math.hypot(ax, ay);
    // its far end lies beyond the fingertips along the snout axis
    const reach = ((snout.bx - actor.knuckleS) * ax + (snout.by - actor.knuckleT) * ay) / len;
    expect(reach).toBeGreaterThan(len * 0.95);
  });

  it('swallowed fireflies glow inside the head, not out along the arm', () => {
    const { m, actor, glows } = dress(0.6, 2 / 7);
    expect(glows.items.length).toBeGreaterThan(0);
    const mask = 1 << m.actors.indexOf(actor);
    for (const g of glows.items) {
      // inside the hand's own shadow (the arm is excluded from this test)
      expect(m.distanceToShadow(g.x, g.y, mask)).toBeLessThanOrEqual(0);
      // and close to the head (within the snout's length of the knuckles)
      const len = Math.hypot(actor.upperS - actor.knuckleS, actor.upperT - actor.knuckleT);
      expect(Math.hypot(g.x - actor.knuckleS, g.y - actor.knuckleT)).toBeLessThan(len * 0.6);
    }
  });
});

describe('the fed crocodile', () => {
  it('is big enough to read: about two thirds of a stage unit long and a crocodile proportion', () => {
    const long = NIGHT_CROC_EXTENT.back + NIGHT_CROC_EXTENT.front;
    expect(NIGHT_CROC_SCALE).toBeGreaterThanOrEqual(2);
    expect(long).toBeGreaterThan(0.6);
    expect(NIGHT_CROC_EXTENT.height).toBeGreaterThan(0.12);
    expect(long / NIGHT_CROC_EXTENT.height).toBeGreaterThan(4);
  });
});
