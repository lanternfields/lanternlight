/**
 * Closed-loop "puppeteer" for tests and demo capture: moves an emulated hand
 * until a chosen feature of its shadow (centroid, fingertip, mouth, box edge)
 * lands on a stage target. Uses a measured 2x2 Jacobian, so it works in any
 * room, at any wall distance, for any hand orientation - exactly the
 * robustness we want the real experience to have.
 */
import { setHand, snap } from './lib.mjs';

export function feature(actor, which) {
  switch (which) {
    case 'centroid':
      return actor.centroid;
    case 'tip':
      return actor.tip;
    case 'mouth':
      return actor.mouth;
    case 'boxTop':
      return [(actor.box[0] + actor.box[1]) / 2, actor.box[3]];
    case 'handTop':
      return [(actor.handBox[0] + actor.handBox[1]) / 2, actor.handBox[3]];
    default:
      throw new Error('unknown feature ' + which);
  }
}

async function measure(page, which, actorIndex) {
  const s = await snap(page);
  const a = s.actors[actorIndex];
  if (!a.present) return null;
  return feature(a, which);
}

/**
 * @param hand {x,y,z,pitch,yaw,roll,pose,device}
 * @returns the final hand placement
 */
export async function steer(page, hand, target, { which = 'centroid', actorIndex = 1, iterations = 8, tolerance = 0.015, settle = 140 } = {}) {
  let h = { ...hand };
  // Move along the stage's own right axis (world X is depth when facing sideways).
  const st = (await snap(page)).stage;
  const n = st ? st.normal : [0, 0, 1];
  const rl = Math.hypot(n[2], n[0]) || 1;
  const R = [n[2] / rl, 0, -n[0] / rl];
  const moveR = (hh, d) => ({ ...hh, x: hh.x + R[0] * d, z: hh.z + R[2] * d });
  await setHand(page, h);
  await page.waitForTimeout(settle);
  let f = await measure(page, which, actorIndex);
  if (!f) return { hand: h, error: Infinity };
  // Jacobian by finite differences (stage units per metre).
  const d = 0.03;
  await setHand(page, { ...moveR(h, d), pose: undefined });
  await page.waitForTimeout(settle);
  const fx = (await measure(page, which, actorIndex)) ?? f;
  await setHand(page, { ...h, y: h.y + d, pose: undefined });
  await page.waitForTimeout(settle);
  const fy = (await measure(page, which, actorIndex)) ?? f;
  const J = [
    [(fx[0] - f[0]) / d, (fy[0] - f[0]) / d],
    [(fx[1] - f[1]) / d, (fy[1] - f[1]) / d],
  ];
  const det = J[0][0] * J[1][1] - J[0][1] * J[1][0];
  let err = Infinity;
  for (let i = 0; i < iterations; i++) {
    await setHand(page, { ...h, pose: undefined });
    await page.waitForTimeout(settle);
    f = await measure(page, which, actorIndex);
    if (!f) break;
    const es = target[0] - f[0];
    const et = target[1] - f[1];
    err = Math.hypot(es, et);
    if (err < tolerance) break;
    if (Math.abs(det) < 1e-6) break;
    // dx = J^-1 e  (damped)
    const dx = (J[1][1] * es - J[0][1] * et) / det;
    const dy = (-J[1][0] * es + J[0][0] * et) / det;
    const k = 0.85;
    h = { ...moveR(h, clampStep(dx * k)), y: h.y + clampStep(dy * k) };
  }
  return { hand: h, error: err };
}

function clampStep(v) {
  return Math.max(-0.12, Math.min(0.12, v));
}

/** Finds the hand orientation whose (hand-only) shadow is the longest flat bar. */
export async function findBarOrientation(page, base, candidates) {
  const { setHand: sh, snap: sn } = await import('./lib.mjs');
  let best = null;
  for (const o of candidates) {
    await sh(page, { ...base, ...o });
    await page.waitForTimeout(150);
    const s = await sn(page);
    const a = s.actors[1];
    if (!a.present) continue;
    const [x0, x1, y0, y1] = a.handBox;
    const w = x1 - x0;
    const h = y1 - y0;
    const score = w / Math.max(0.02, h);
    if (!best || score > best.score) best = { ...o, score, w, h };
  }
  return best;
}
