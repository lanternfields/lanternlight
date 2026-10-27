/**
 * The shadow model: everything that casts a shadow, expressed as 2D capsules
 * in stage units. The renderer draws exactly these capsules and the gameplay
 * physics collides against exactly these capsules, so what you see is what
 * the rabbit stands on.
 *
 * Casters ("actors"):
 *   - tracked hands (25 joints -> bones, palm polygon, forearm)
 *   - rod puppets held by controllers (controller fallback path)
 */
import {
  FINGERS,
  HandFrame,
  J,
  PALM_POLYGON,
  SHADOW_BONES,
} from './hand-model.js';
import {
  HandFeatures,
  MouthDetector,
  PoseClassifier,
  PoseId,
  computeFeatures,
  createFeatures,
} from './hand-features.js';
import { V3, addScaled, normalize, sub } from './math.js';
import {
  Projected,
  StageFrame,
  createProjected,
  penumbraWidth,
  projectToStage,
} from './projection.js';

export interface Capsule2D {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  r: number;
  /** Edge softness (stage units). */
  soft: number;
  /** Index of the actor that owns this capsule. */
  actor: number;
  /** True for the forearm: it casts a shadow but never "touches" UI. */
  forearm?: boolean;
}

export const MAX_CAPSULES = 96;
export const PALM_POINTS = PALM_POLYGON.length;

export type ActorKind = 'hand' | 'rod';

export interface Actor {
  kind: ActorKind;
  handedness: 'left' | 'right';
  present: boolean;
  /** Seconds this actor has been continuously present. */
  presentTime: number;
  capsuleStart: number;
  capsuleCount: number;
  /** Palm polygon (hands only) in stage units, PALM_POINTS * 2 floats. */
  palm: Float32Array;
  palmValid: boolean;
  palmSoft: number;
  /** Bounding box of the hand (joints only, no forearm) in stage units. */
  handMinS: number;
  handMaxS: number;
  handMinT: number;
  handMaxT: number;
  /** Bounding box of the shadow in stage units. */
  minS: number;
  maxS: number;
  minT: number;
  maxT: number;
  /** Shadow height relative to its nominal height (1 = comfortable default). */
  sizeRatio: number;
  centroidS: number;
  centroidT: number;
  /** Mouth point (between thumb and fingers / puppet jaws). */
  mouthS: number;
  mouthT: number;
  /** Raw aperture (hands: hand-lengths; rods: mapped from trigger). */
  aperture: number;
  mouth: MouthDetector;
  pose: PoseId;
  classifier: PoseClassifier;
  features: HandFeatures;
  /** Upper/lower jaw tip positions for the crocodile overlay. */
  upperS: number;
  upperT: number;
  lowerS: number;
  lowerT: number;
  /** Fingertip (index) in stage units: the shadow "cursor". */
  tipS: number;
  tipT: number;
  /** Knuckle (crocodile eye anchor) in stage units. */
  knuckleS: number;
  knuckleT: number;
  /** Mouth edges this frame. */
  mouthOpened: boolean;
  mouthClosed: boolean;
}

function createActor(kind: ActorKind, handedness: 'left' | 'right'): Actor {
  return {
    kind,
    handedness,
    present: false,
    presentTime: 0,
    capsuleStart: 0,
    capsuleCount: 0,
    palm: new Float32Array(PALM_POINTS * 2),
    palmValid: false,
    palmSoft: 0.01,
    handMinS: 0,
    handMaxS: 0,
    handMinT: 0,
    handMaxT: 0,
    minS: 0,
    maxS: 0,
    minT: 0,
    maxT: 0,
    sizeRatio: 1,
    centroidS: 0,
    centroidT: 0,
    mouthS: 0,
    mouthT: 0,
    aperture: 0,
    mouth: new MouthDetector(),
    pose: 'none',
    classifier: new PoseClassifier(),
    features: createFeatures(),
    upperS: 0,
    upperT: 0,
    lowerS: 0,
    lowerT: 0,
    tipS: 0,
    tipT: 0,
    knuckleS: 0,
    knuckleT: 0,
    mouthOpened: false,
    mouthClosed: false,
  };
}

/** A rod puppet: capsules in the controller grip's local space (metres). */
export interface RodPuppetPart {
  a: [number, number, number];
  b: [number, number, number];
  r: number;
  /** Parts flagged `jaw` rotate open by the trigger. */
  jaw?: boolean;
}

/**
 * Crocodile rod puppet, drawn in the grip's local XY plane so that holding a
 * controller naturally (pointing at the wall) shows the puppet broadside.
 * Its long flat back doubles as a bridge for the rabbit.
 */
const PUPPET_SCALE = 0.65;
const P = (x: number, y: number): [number, number, number] => [x * PUPPET_SCALE, 0.2 + (y - 0.2) * PUPPET_SCALE, 0];
export const CROC_ROD_PUPPET: readonly RodPuppetPart[] = [
  { a: [0, 0.02, 0], b: [0, 0.17, 0], r: 0.005 }, // rod
  { a: P(-0.1, 0.2), b: P(0.06, 0.2), r: 0.03 * PUPPET_SCALE }, // body
  { a: P(-0.1, 0.2), b: P(-0.19, 0.19), r: 0.014 * PUPPET_SCALE }, // tail
  { a: P(-0.19, 0.19), b: P(-0.24, 0.185), r: 0.007 * PUPPET_SCALE }, // tail tip
  { a: P(0.05, 0.212), b: P(0.16, 0.205), r: 0.014 * PUPPET_SCALE }, // upper snout
  { a: P(0.05, 0.188), b: P(0.15, 0.182), r: 0.01 * PUPPET_SCALE, jaw: true }, // lower jaw
  { a: P(0.04, 0.24), b: P(0.05, 0.245), r: 0.011 * PUPPET_SCALE }, // eye bump
  { a: P(-0.06, 0.18), b: P(-0.075, 0.155), r: 0.008 * PUPPET_SCALE }, // leg
  { a: P(0.02, 0.18), b: P(0.03, 0.155), r: 0.008 * PUPPET_SCALE }, // leg
];

export interface RodInput {
  connected: boolean;
  handedness: 'left' | 'right';
  position: V3;
  /** Quaternion x, y, z, w. */
  quaternion: [number, number, number, number];
  /** 0..1 trigger: squeezing closes the jaws. */
  trigger: number;
}

export function createRodInput(handedness: 'left' | 'right'): RodInput {
  return {
    connected: false,
    handedness,
    position: new V3(),
    quaternion: [0, 0, 0, 1],
    trigger: 0,
  };
}

function rotateByQuat(
  out: V3,
  x: number,
  y: number,
  z: number,
  q: readonly [number, number, number, number],
): V3 {
  const [qx, qy, qz, qw] = q;
  const ix = qw * x + qy * z - qz * y;
  const iy = qw * y + qz * x - qx * z;
  const iz = qw * z + qx * y - qy * x;
  const iw = -qx * x - qy * y - qz * z;
  out.x = ix * qw + iw * -qx + iy * -qz - iz * -qy;
  out.y = iy * qw + iw * -qy + iz * -qx - ix * -qz;
  out.z = iz * qw + iw * -qz + ix * -qy - iy * -qx;
  return out;
}

/** Nominal shadow height (stage units) used for `sizeRatio`. */
export const NOMINAL_SHADOW_HEIGHT = 0.46;

export class ShadowModel {
  readonly capsules: Capsule2D[] = [];
  capsuleCount = 0;
  /** actors[0..1] = left/right hands, actors[2..3] = left/right rods. */
  readonly actors: Actor[] = [
    createActor('hand', 'left'),
    createActor('hand', 'right'),
    createActor('rod', 'left'),
    createActor('rod', 'right'),
  ];
  flameRadius = 0.02;
  /** Viewer head & right axis: the forearm runs from the wrist toward the shoulder. */
  readonly head = new V3(0, 1.2, 0);
  readonly right = new V3(1, 0, 0);
  /** Magnification of the hand at its comfortable distance (from calibration). */
  nominalPalmShadow = 0.2;

  private readonly pa = createProjected();
  private readonly pb = createProjected();
  private readonly projectedJoints: Projected[] = [];
  private readonly tmpA = new V3();
  private readonly tmpB = new V3();
  private readonly tmpC = new V3();

  constructor() {
    for (let i = 0; i < MAX_CAPSULES; i++) {
      this.capsules.push({ ax: 0, ay: 0, bx: 0, by: 0, r: 0, soft: 0, actor: 0 });
    }
    for (let i = 0; i < 25; i++) this.projectedJoints.push(createProjected());
  }

  private pushCapsule(
    a: Projected,
    b: Projected,
    ra: number,
    rb: number,
    stage: StageFrame,
    actor: number,
  ): void {
    if (!a.valid || !b.valid || this.capsuleCount >= MAX_CAPSULES) return;
    const c = this.capsules[this.capsuleCount++];
    c.ax = a.s;
    c.ay = a.t;
    c.bx = b.s;
    c.by = b.t;
    const m = (a.magnification + b.magnification) * 0.5;
    c.r = (Math.max(ra, rb) * m) / stage.height;
    c.soft = penumbraWidth(m, stage, this.flameRadius);
    c.actor = actor;
    c.forearm = false;
  }

  /**
   * Rebuilds all capsules for this frame.
   * @param classify run the pose classifier (skip when the story doesn't need it)
   */
  build(
    hands: readonly HandFrame[],
    rods: readonly RodInput[],
    light: Readonly<V3>,
    stage: Readonly<StageFrame>,
    dt: number,
    classify = true,
  ): void {
    this.capsuleCount = 0;
    for (let h = 0; h < 2; h++) {
      const hand = hands[h];
      const actor = this.actors[h];
      actor.capsuleStart = this.capsuleCount;
      if (!hand || !hand.tracked) {
        this.markAbsent(actor);
        continue;
      }
      this.buildHand(hand, h, light, stage, dt, classify);
    }
    for (let r = 0; r < 2; r++) {
      const rod = rods[r];
      const actor = this.actors[2 + r];
      actor.capsuleStart = this.capsuleCount;
      if (!rod || !rod.connected) {
        this.markAbsent(actor);
        continue;
      }
      this.buildRod(rod, 2 + r, light, stage, dt);
    }
  }

  private markAbsent(actor: Actor): void {
    actor.present = false;
    actor.presentTime = 0;
    actor.mouthOpened = false;
    actor.mouthClosed = false;
    actor.capsuleCount = 0;
    actor.palmValid = false;
    actor.pose = 'none';
    actor.classifier.reset();
  }

  private finishBounds(actor: Actor): void {
    let minS = Infinity;
    let maxS = -Infinity;
    let minT = Infinity;
    let maxT = -Infinity;
    for (let i = actor.capsuleStart; i < actor.capsuleStart + actor.capsuleCount; i++) {
      const c = this.capsules[i];
      minS = Math.min(minS, c.ax - c.r, c.bx - c.r);
      maxS = Math.max(maxS, c.ax + c.r, c.bx + c.r);
      minT = Math.min(minT, c.ay - c.r, c.by - c.r);
      maxT = Math.max(maxT, c.ay + c.r, c.by + c.r);
    }
    actor.minS = minS;
    actor.maxS = maxS;
    actor.minT = minT;
    actor.maxT = maxT;
    actor.centroidS = (minS + maxS) * 0.5;
    actor.centroidT = (minT + maxT) * 0.5;
  }

  /** Hand centroid (without forearm) is the better "where is my hand" point. */
  private handCentroid(actor: Actor): void {
    actor.centroidS = (actor.handMinS + actor.handMaxS) * 0.5;
    actor.centroidT = (actor.handMinT + actor.handMaxT) * 0.5;
  }

  private buildHand(
    hand: HandFrame,
    index: number,
    light: Readonly<V3>,
    stage: Readonly<StageFrame>,
    dt: number,
    classify: boolean,
  ): void {
    const actor = this.actors[index];
    const pj = this.projectedJoints;
    let valid = 0;
    for (let i = 0; i < 25; i++) {
      projectToStage(hand.joints[i], light, stage, pj[i]);
      if (pj[i].valid) valid++;
    }
    if (valid < 20) {
      this.markAbsent(actor);
      return;
    }
    const start = this.capsuleCount;
    for (const [a, b] of SHADOW_BONES) {
      this.pushCapsule(pj[a], pj[b], hand.radii[a], hand.radii[b], stage as StageFrame, index);
    }
    // Forearm: from the wrist toward the elbow, i.e. toward the same-side
    // shoulder (blended a little with the hand's own axis), 19 cm long.
    const w = hand.joints[J.wrist];
    const side = hand.handedness === 'left' ? -1 : 1;
    this.tmpC.copy(this.head);
    addScaled(this.tmpC, this.tmpC, this.right, 0.18 * side);
    this.tmpC.y -= 0.28;
    sub(this.tmpA, this.tmpC, w);
    normalize(this.tmpA, this.tmpA);
    // the elbow hangs below the shoulder line
    this.tmpA.y -= 1.1;
    normalize(this.tmpA, this.tmpA);
    sub(this.tmpB, w, hand.joints[J.middleMeta]);
    normalize(this.tmpB, this.tmpB);
    addScaled(this.tmpA, this.tmpB, this.tmpA, 2.5);
    normalize(this.tmpA, this.tmpA);
    addScaled(this.tmpB, w, this.tmpA, 0.19);
    projectToStage(this.tmpB, light, stage, this.pa);
    this.pushCapsule(pj[J.wrist], this.pa, 0.026, 0.03, stage as StageFrame, index);
    if (this.capsuleCount > start) this.capsules[this.capsuleCount - 1].forearm = true;
    actor.capsuleCount = this.capsuleCount - start;
    // Hand-only bounds (gameplay uses these; the forearm is just for looks).
    let h0 = Infinity;
    let h1 = -Infinity;
    let v0 = Infinity;
    let v1 = -Infinity;
    for (let i = 0; i < 25; i++) {
      const p = pj[i];
      if (!p.valid) continue;
      h0 = Math.min(h0, p.s);
      h1 = Math.max(h1, p.s);
      v0 = Math.min(v0, p.t);
      v1 = Math.max(v1, p.t);
    }
    actor.handMinS = h0;
    actor.handMaxS = h1;
    actor.handMinT = v0;
    actor.handMaxT = v1;

    // Palm polygon
    actor.palmValid = true;
    for (let k = 0; k < PALM_POINTS; k++) {
      const p = pj[PALM_POLYGON[k]];
      if (!p.valid) actor.palmValid = false;
      actor.palm[k * 2] = p.s;
      actor.palm[k * 2 + 1] = p.t;
    }
    actor.palmSoft = penumbraWidth(pj[J.middleMeta].magnification, stage, this.flameRadius);

    this.finishBounds(actor);
    this.handCentroid(actor);
    actor.present = true;
    actor.presentTime += dt;

    // Shape features (rotation invariant, measured in 3D on the real hand).
    computeFeatures(hand, actor.features);
    actor.aperture = actor.features.aperture;
    const edges = actor.mouth.update(actor.aperture, dt);
    actor.mouthOpened = edges.opened;
    actor.mouthClosed = edges.closed;
    actor.knuckleS = pj[J.middleProx].s;
    actor.knuckleT = pj[J.middleProx].t;
    actor.pose = classify ? actor.classifier.update(actor.features, dt) : 'none';

    // Shadow size relative to nominal: projected palm length vs comfortable.
    const palmShadow = Math.hypot(
      pj[J.middleProx].s - pj[J.wrist].s,
      pj[J.middleProx].t - pj[J.wrist].t,
    );
    actor.sizeRatio = palmShadow / Math.max(0.02, this.nominalPalmShadow);

    const up = pj[J.indexTip];
    const mid = pj[J.middleTip];
    const th = pj[J.thumbTip];
    actor.upperS = (up.s + mid.s) * 0.5;
    actor.upperT = (up.t + mid.t) * 0.5;
    actor.lowerS = th.s;
    actor.lowerT = th.t;
    actor.mouthS = (actor.upperS + actor.lowerS) * 0.5;
    actor.mouthT = (actor.upperT + actor.lowerT) * 0.5;
    actor.tipS = up.s;
    actor.tipT = up.t;
  }

  private buildRod(
    rod: RodInput,
    index: number,
    light: Readonly<V3>,
    stage: Readonly<StageFrame>,
    dt: number,
  ): void {
    const actor = this.actors[index];
    const start = this.capsuleCount;
    const mirror = rod.handedness === 'left' ? -1 : 1;
    const jawOpen = 1 - Math.min(1, Math.max(0, rod.trigger));
    const jawAngle = jawOpen * 0.55;
    let upperS = 0;
    let upperT = 0;
    let lowerS = 0;
    let lowerT = 0;
    let bodyS = 0;
    let bodyT = 0;
    for (const part of CROC_ROD_PUPPET) {
      let ax = part.a[0] * mirror;
      let ay = part.a[1];
      let bx = part.b[0] * mirror;
      let by = part.b[1];
      if (part.jaw) {
        // Rotate around the jaw hinge (start point) downward.
        const dx = bx - ax;
        const dy = by - ay;
        const ang = -jawAngle * mirror;
        const c = Math.cos(ang);
        const s = Math.sin(ang);
        bx = ax + dx * c - dy * s;
        by = ay + dx * s + dy * c;
      }
      rotateByQuat(this.tmpA, ax, ay, part.a[2], rod.quaternion);
      addScaled(this.tmpA, rod.position, this.tmpA, 1);
      rotateByQuat(this.tmpB, bx, by, part.b[2], rod.quaternion);
      addScaled(this.tmpB, rod.position, this.tmpB, 1);
      projectToStage(this.tmpA, light, stage, this.pa);
      projectToStage(this.tmpB, light, stage, this.pb);
      this.pushCapsule(this.pa, this.pb, part.r, part.r, stage as StageFrame, index);
      if (part === CROC_ROD_PUPPET[1] && this.pa.valid && this.pb.valid) {
        bodyS = (this.pa.s + this.pb.s) * 0.5;
        bodyT = (this.pa.t + this.pb.t) * 0.5;
      }
      if (part === CROC_ROD_PUPPET[4] && this.pb.valid) {
        upperS = this.pb.s;
        upperT = this.pb.t;
      }
      if (part.jaw && this.pb.valid) {
        lowerS = this.pb.s;
        lowerT = this.pb.t;
      }
    }
    actor.capsuleCount = this.capsuleCount - start;
    actor.palmValid = false;
    if (actor.capsuleCount < 3) {
      this.markAbsent(actor);
      return;
    }
    this.finishBounds(actor);
    // The puppet's body is always solid: use it as "where the puppet is".
    actor.centroidS = bodyS;
    actor.centroidT = bodyT;
    actor.handMinS = actor.minS;
    actor.handMaxS = actor.maxS;
    actor.handMinT = actor.minT;
    actor.handMaxT = actor.maxT;
    actor.present = true;
    actor.presentTime += dt;
    actor.pose = 'none';
    // Map trigger to the same aperture scale as a hand (open ~1.0, closed ~0.2).
    actor.aperture = 0.2 + 0.85 * jawOpen;
    const edges = actor.mouth.update(actor.aperture, dt);
    actor.mouthOpened = edges.opened;
    actor.mouthClosed = edges.closed;
    actor.knuckleS = upperS * 0.6 + actor.centroidS * 0.4;
    actor.knuckleT = Math.max(upperT, actor.centroidT) + 0.02;
    actor.upperS = upperS;
    actor.upperT = upperT;
    actor.lowerS = lowerS;
    actor.lowerT = lowerT;
    actor.mouthS = (upperS + lowerS) * 0.5;
    actor.mouthT = (upperT + lowerT) * 0.5;
    actor.tipS = upperS;
    actor.tipT = upperT;
    const h = actor.maxT - actor.minT;
    actor.sizeRatio = h / (0.22 * PUPPET_SCALE);
    void this.tmpC;
  }

  /**
   * Distance from a stage point to the nearest shadow (<= 0 means inside).
   * The forearm is excluded by default: you touch things with your hand.
   */
  distanceToShadow(s: number, t: number, actorMask = 0b1111, includeForearm = false): number {
    let best = Infinity;
    for (let i = 0; i < this.capsuleCount; i++) {
      const c = this.capsules[i];
      if (((actorMask >> c.actor) & 1) === 0) continue;
      if (c.forearm && !includeForearm) continue;
      const dx = c.bx - c.ax;
      const dy = c.by - c.ay;
      const len2 = dx * dx + dy * dy;
      let u = len2 > 1e-12 ? ((s - c.ax) * dx + (t - c.ay) * dy) / len2 : 0;
      u = u < 0 ? 0 : u > 1 ? 1 : u;
      const d = Math.hypot(s - (c.ax + dx * u), t - (c.ay + dy * u)) - c.r;
      if (d < best) best = d;
    }
    return best;
  }

  /** True if any actor is present. */
  anyPresent(): boolean {
    return this.actors.some((a) => a.present);
  }

  /** The most prominent present actor (prefers the dominant hand). */
  primaryActor(dominant: 'left' | 'right' = 'right'): Actor | null {
    const order = dominant === 'right' ? [1, 0, 3, 2] : [0, 1, 2, 3];
    for (const i of order) if (this.actors[i].present) return this.actors[i];
    return null;
  }
}

export { FINGERS };
