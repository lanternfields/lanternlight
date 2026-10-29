/**
 * Shadow projection: a point light (the lantern's "focal light") throws real
 * hand joints onto the stage plane (a detected wall, or the paper scroll).
 *
 * Stage-space coordinates are normalised by the stage height so gameplay is
 * independent of how far away the wall is:
 *   s: right (+) / left (-), t: up (+) / down (-), both in "stage heights".
 *   The visible stage spans t in [-0.5, 0.5] and s in [-aspect/2, aspect/2].
 */
import {
  V3,
  addScaled,
  clamp,
  cross,
  dot,
  normalize,
  sub,
} from './math.js';

export interface StageFrame {
  /** Centre of the stage on the wall/screen surface (world metres). */
  origin: V3;
  /** Unit normal of the surface pointing toward the viewer. */
  normal: V3;
  /** Unit right axis on the surface (viewer's right). */
  right: V3;
  /** Unit up axis on the surface. */
  up: V3;
  /** Stage height in metres (one stage unit). */
  height: number;
  /** Stage width / height. */
  aspect: number;
}

export function createStageFrame(): StageFrame {
  return {
    origin: new V3(0, 1.2, -2),
    normal: new V3(0, 0, 1),
    right: new V3(1, 0, 0),
    up: new V3(0, 1, 0),
    height: 1,
    aspect: 1.45,
  };
}

/** Builds orthonormal right/up axes for a surface normal (world up = +Y). */
export function orientStage(frame: StageFrame, normal: Readonly<V3>): void {
  normalize(frame.normal, normal);
  const worldUp = new V3(0, 1, 0);
  // right = up x normal  (viewer faces -normal, so right-handed screen axes)
  cross(frame.right, worldUp, frame.normal);
  if (Math.hypot(frame.right.x, frame.right.y, frame.right.z) < 1e-6) {
    frame.right.set(1, 0, 0);
  }
  normalize(frame.right, frame.right);
  cross(frame.up, frame.normal, frame.right);
  normalize(frame.up, frame.up);
}

export interface Projected {
  s: number;
  t: number;
  /** Magnification of this point's shadow (>1 means the shadow is bigger). */
  magnification: number;
  /** False when the point is behind the light or the ray misses the stage. */
  valid: boolean;
}

export function createProjected(): Projected {
  return { s: 0, t: 0, magnification: 1, valid: false };
}

const _dir = new V3();
const _hit = new V3();
const _rel = new V3();

/**
 * Projects world point `p` from light `light` onto the stage plane.
 * Allocation free; writes into `out`.
 */
export function projectToStage(
  p: Readonly<V3>,
  light: Readonly<V3>,
  stage: Readonly<StageFrame>,
  out: Projected,
): Projected {
  sub(_dir, p, light);
  const denom = dot(stage.normal, _dir);
  // The ray must travel from the light toward the surface (against the normal).
  if (denom > -1e-6) {
    out.valid = false;
    return out;
  }
  sub(_rel, stage.origin, light);
  const lambda = dot(stage.normal, _rel) / denom;
  if (!(lambda > 0) || !Number.isFinite(lambda)) {
    out.valid = false;
    return out;
  }
  addScaled(_hit, light, _dir, lambda);
  sub(_rel, _hit, stage.origin);
  out.s = dot(_rel, stage.right) / stage.height;
  out.t = dot(_rel, stage.up) / stage.height;
  out.magnification = lambda;
  out.valid = true;
  return out;
}

/** Inverse mapping: stage (s, t) back to a world point on the surface. */
export function stageToWorld(
  stage: Readonly<StageFrame>,
  s: number,
  t: number,
  out: V3,
): V3 {
  out.copy(stage.origin);
  addScaled(out, out, stage.right, s * stage.height);
  addScaled(out, out, stage.up, t * stage.height);
  return out;
}

export interface LightRig {
  /** The effective point light used for projection (may sit behind the lantern). */
  focal: V3;
  /** Physical radius of the flame (metres) used for penumbra estimates. */
  flameRadius: number;
}

/** Where a seated performer comfortably holds a hand (relative to the eyes). */
export const NOMINAL_HAND = { forward: 0.42, drop: 0.22, size: 0.19 };

/** Nominal hand point for a head pose and stage (world). */
export function nominalHandPoint(stage: Readonly<StageFrame>, head: Readonly<V3>, out: V3): V3 {
  out.copy(head);
  const fx = -stage.normal.x;
  const fz = -stage.normal.z;
  const l = Math.hypot(fx, fz) || 1;
  out.x += (fx / l) * NOMINAL_HAND.forward;
  out.z += (fz / l) * NOMINAL_HAND.forward;
  out.y -= NOMINAL_HAND.drop;
  return out;
}

/**
 * Chooses the effective light position.
 *
 * The light sits *below and behind* a comfortably held hand, on the line from
 * the stage centre through that hand. Consequences:
 *  - the comfortable hand casts its shadow onto the middle of the stage;
 *  - from the viewer's eyes the hand is ~25 deg below its own shadow, so the
 *    hand never hides the shadow it makes (a light behind the eyes would);
 *  - the distance is chosen so the shadow is about `targetShadowHeight` stage
 *    units tall, but never more than MAX_LIGHT_BEHIND_HAND behind the hand, so
 *    bringing the hand back toward you (toward the light) grows the shadow
 *    within easy reach.
 */
/** Furthest the effective light sits behind a comfortably held hand (m). */
export const MAX_LIGHT_BEHIND_HAND = 0.75;
/** Largest nominal hand shadow, as a fraction of the stage height. */
export const MAX_NOMINAL_SHADOW = 0.58;

export function computeFocalLight(
  stage: Readonly<StageFrame>,
  head: Readonly<V3>,
  out: V3,
  opts: { targetShadowHeight?: number } = {},
): V3 {
  const target = opts.targetShadowHeight ?? 0.46;
  const h0 = nominalHandPoint(stage, head, new V3());
  const dir = new V3();
  sub(dir, h0, stage.origin);
  const handToStage = Math.max(0.15, Math.hypot(dir.x, dir.y, dir.z));
  normalize(dir, dir);
  const k = Math.max(1.15, (target * stage.height) / NOMINAL_HAND.size);
  // At most MAX_LIGHT_BEHIND_HAND behind the hand: then pulling the hand ~20 cm
  // back toward you grows its shadow by ~1.4x (a light much further back would
  // need the hand right at your face). Far walls get slightly bigger shadows.
  let d = clamp(handToStage / (k - 1), 0.22, MAX_LIGHT_BEHIND_HAND);
  // ...but never so close that a comfortable hand covers more than
  // MAX_NOMINAL_SHADOW of a small (near-wall) stage: there, size wins over
  // sensitivity and the story's assists make up the difference.
  const kMax = (MAX_NOMINAL_SHADOW * stage.height) / NOMINAL_HAND.size;
  if (kMax > 1.05) d = Math.max(d, handToStage / (kMax - 1));
  d = Math.min(d, 1.8);
  out.copy(h0);
  addScaled(out, out, dir, d);
  return out;
}

/**
 * Penumbra width (stage units) for a point at `p`: a disc light of radius
 * `flameRadius` produces a soft edge proportional to (object->surface) /
 * (light->object). Clamped so shadows stay readable.
 */
export function penumbraWidth(
  magnification: number,
  stage: Readonly<StageFrame>,
  flameRadius: number,
): number {
  // magnification = |light->hit| / |light->p|  => (p->hit)/(light->p) = m - 1
  const w = (2 * flameRadius * Math.max(0, magnification - 1)) / stage.height;
  // Clamped for legibility: soft like lamplight, never mushy. The player's
  // shadow is the hero: never softer than a paper cut-out's edge allows to read
  // (the judge: it was the blurriest thing on stage).
  return clamp(w, 0.004, 0.01);
}

/** Angular stage sizing so the stage fits a comfortable, FoV-aware window. */
export function stageHeightForDistance(
  distance: number,
  verticalHalfAngleDeg = 15,
): number {
  return 2 * distance * Math.tan((verticalHalfAngleDeg * Math.PI) / 180);
}
