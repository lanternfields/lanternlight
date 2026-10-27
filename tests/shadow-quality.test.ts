/**
 * Shadow silhouette quality: tapered fingers, palm contour with web, fading
 * forearm, penumbra and orientation-independent size.
 */
import { describe, expect, it } from 'vitest';
import { V3 } from '../src/core/math.js';
import { computeFocalLight, createProjected, createStageFrame, orientStage, penumbraWidth, projectToStage, stageHeightForDistance } from '../src/core/projection.js';
import { PALM_POINTS, ShadowModel } from '../src/core/shadow-model.js';
import { J, createHandFrame } from '../src/core/hand-model.js';
import { POSES, makeHand } from './fixtures/synthetic-hand.js';

function setup(distance = 2) {
  const st = createStageFrame();
  st.origin.set(0, 1.1, -distance);
  orientStage(st, new V3(0, 0, 1));
  st.height = stageHeightForDistance(distance);
  const head = new V3(0, 1.2, 0);
  const light = computeFocalLight(st, head, new V3());
  const m = new ShadowModel();
  // calibrate as the app does: magnification of the comfortable hand point
  const p = createProjected();
  projectToStage(new V3(0, 0.98, -0.42), light, st, p);
  m.nominalMagnification = p.magnification;
  return { st, light, m };
}

describe('shadow silhouette', () => {
  it('fingers taper from knuckle to a round tip', () => {
    const { st, light, m } = setup();
    const hand = makeHand(POSES.open, { position: new V3(0, 0.92, -0.42) });
    m.build([createHandFrame('left'), hand], [], light, st, 1 / 72);
    const a = m.actors[1];
    // the last finger capsule of each finger ends at a tip: rb < r
    let tapered = 0;
    for (let i = a.capsuleStart; i < a.capsuleStart + a.capsuleCount; i++) {
      const c = m.capsules[i];
      if (!c.forearm && c.rb !== undefined && c.rb < c.r * 0.98) tapered++;
    }
    expect(tapered).toBeGreaterThan(12);
  });

  it('the forearm fades out and never counts for touching', () => {
    const { st, light, m } = setup();
    const hand = makeHand(POSES.open, { position: new V3(0, 0.92, -0.42) });
    m.build([createHandFrame('left'), hand], [], light, st, 1 / 72);
    const fa = m.capsules.slice(0, m.capsuleCount).find((c) => c.forearm)!;
    expect(fa).toBeTruthy();
    expect(fa.fadeB!).toBeLessThan(0.3);
    const mid = { s: (fa.ax + fa.bx) / 2, t: (fa.ay + fa.by) / 2 };
    expect(m.distanceToShadow(mid.s, mid.t, 0b1111, true)).toBeLessThan(0);
  });

  it('the palm contour has a web between thumb and index', () => {
    const { st, light, m } = setup();
    const hand = makeHand(POSES.open, { position: new V3(0, 0.92, -0.42) });
    m.build([createHandFrame('left'), hand], [], light, st, 1 / 72);
    const a = m.actors[1];
    expect(a.palmValid).toBe(true);
    expect(a.palm.length).toBe(PALM_POINTS * 2);
    const pt = (k: number) => [a.palm[k * 2], a.palm[k * 2 + 1]];
    const thumb = createProjected();
    const index = createProjected();
    projectToStage(hand.joints[J.thumbProx], light, st, thumb);
    projectToStage(hand.joints[J.indexProx], light, st, index);
    const web = pt(3);
    // the web point lies between the thumb and index knuckles
    const dTI = Math.hypot(thumb.s - index.s, thumb.t - index.t);
    expect(Math.hypot(web[0] - thumb.s, web[1] - thumb.t)).toBeLessThan(dTI);
    expect(Math.hypot(web[0] - index.s, web[1] - index.t)).toBeLessThan(dTI);
  });

  it('size is orientation independent and grows toward the lantern', () => {
    const { st, light, m } = setup();
    const sizes: number[] = [];
    for (const [pitch, yaw, roll] of [[0, 0, 0], [80, 0, 0], [0, 90, 0], [30, -40, 70]]) {
      const hand = makeHand(POSES.open, { position: new V3(0, 0.98, -0.42), pitch, yaw, roll });
      m.build([createHandFrame('left'), hand], [], light, st, 1 / 72);
      sizes.push(m.actors[1].sizeRatio);
    }
    // (a hand pointing at the light really does grow a little: it is closer to it)
    for (const s of sizes) expect(Math.abs(s - 1)).toBeLessThan(0.18);
    // 40% of the way toward the light
    const near = new V3(0 + (light.x - 0) * 0.4, 0.98 + (light.y - 0.98) * 0.4, -0.42 + (light.z + 0.42) * 0.4);
    m.build([createHandFrame('left'), makeHand(POSES.open, { position: near })], [], light, st, 1 / 72);
    expect(m.actors[1].sizeRatio).toBeGreaterThan(1.45);
  });

  it('the penumbra widens as the hand nears the lantern, within legible bounds', () => {
    const { st } = setup();
    const a = penumbraWidth(1.6, st, 0.005);
    const b = penumbraWidth(3.5, st, 0.005);
    expect(b).toBeGreaterThan(a);
    expect(penumbraWidth(40, st, 0.005)).toBeLessThanOrEqual(0.032);
    expect(penumbraWidth(1.0, st, 0.005)).toBeGreaterThanOrEqual(0.004);
  });
});
