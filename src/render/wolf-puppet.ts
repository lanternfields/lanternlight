/**
 * The shadow wolf: a lanky paper cut-out in Pip's round paper-cut language
 * (smooth curves, no hard corners): long legs, a deep chest and tucked
 * waist, a long snout, tall ears and a big brush tail, each part on its own
 * pivot. About 0.31 stage units tall at scale 1 (Pip is ~0.26): the wolf tale
 * stages it at ~1.6x Pip's height. Animated procedurally for prowling,
 * cowering, rearing, fleeing, sitting, resting and howling, with a cut-out eye
 * that lets the lamplight through. Extents: core/story.ts WOLF_EXTENT.
 */
import { Group, Mesh, ShapeGeometry } from '@iwsdk/core';
import type { WolfState } from '../core/wolf.js';
import { CH_CUTOUT, CH_HOLE, createFlatMaterial } from './materials.js';
import { Spring } from '../core/ease.js';
import { circleShape, pathShapes } from './paths.js';

// ---- the parts (model units, origin at the feet, facing +x)
const TORSO =
  'M -0.098 0.178 Q -0.02 0.19 0.05 0.193 Q 0.098 0.192 0.114 0.166 Q 0.124 0.13 0.09 0.106 ' +
  'Q 0.062 0.096 0.034 0.116 Q -0.02 0.126 -0.064 0.12 Q -0.106 0.116 -0.115 0.146 Q -0.118 0.172 -0.098 0.178 Z';
/** The neck rises from the withers to the head's pivot. */
const NECK = 'M 0.046 0.186 Q 0.078 0.214 0.1 0.238 Q 0.122 0.236 0.134 0.222 Q 0.128 0.18 0.116 0.15 Q 0.09 0.17 0.046 0.186 Z';
// head parts, relative to the head pivot (at the top of the neck)
const SKULL = 'M -0.026 0.012 Q -0.022 0.036 0.006 0.04 Q 0.034 0.04 0.044 0.024 Q 0.05 0.008 0.04 -0.008 Q 0.02 -0.02 -0.006 -0.016 Q -0.03 -0.008 -0.026 0.012 Z';
const SNOUT =
  'M 0.026 0.031 Q 0.064 0.026 0.104 0.01 Q 0.119 0.004 0.118 -0.005 Q 0.114 -0.012 0.1 -0.011 ' +
  'Q 0.064 -0.008 0.028 -0.012 Z';
const JAW = 'M 0.006 -0.008 Q 0.044 -0.024 0.084 -0.016 Q 0.06 -0.004 0.012 0.004 Z';
const RUFF = 'M -0.018 0.024 Q -0.036 0.006 -0.03 -0.02 Q -0.02 -0.014 -0.014 -0.026 Q -0.004 -0.012 0.004 -0.004 Z';
// ears on their own pivot (flatten back when scared)
const EARS =
  'M -0.022 0.0 Q -0.022 0.03 -0.01 0.052 Q -0.002 0.05 0.002 0.02 Z ' +
  'M -0.004 0.002 Q -0.002 0.034 0.011 0.057 Q 0.021 0.052 0.023 0.006 Z';
// the brush tail on its pivot at the rump
const TAIL =
  'M 0.004 0.009 Q -0.04 0.03 -0.09 0.018 Q -0.124 0.008 -0.136 -0.014 Q -0.14 -0.03 -0.124 -0.034 ' +
  'Q -0.112 -0.026 -0.104 -0.032 Q -0.084 -0.022 -0.072 -0.026 Q -0.04 -0.014 0.006 -0.009 Z';
// legs hang from their pivots (shoulder / hip)
const FRONT_LEG =
  'M -0.013 0.012 Q -0.012 -0.07 -0.008 -0.118 Q -0.008 -0.134 0.004 -0.135 L 0.018 -0.135 ' +
  'Q 0.025 -0.13 0.015 -0.123 Q 0.007 -0.119 0.006 -0.108 Q 0.009 -0.06 0.013 0.012 Z';
const HIND_LEG =
  'M -0.024 0.014 Q -0.032 -0.03 -0.014 -0.062 Q -0.017 -0.1 -0.013 -0.12 Q -0.013 -0.135 0.0 -0.135 L 0.014 -0.135 ' +
  'Q 0.021 -0.13 0.011 -0.123 Q 0.004 -0.119 0.004 -0.107 Q 0.004 -0.08 0.012 -0.052 Q 0.026 -0.02 0.02 0.014 Z';

const HIP_X = -0.08;
const HIP_Y = 0.132;
const HEAD_X = 0.115;
const HEAD_Y = 0.228;

export class WolfPuppet {
  readonly group = new Group();
  private readonly body = new Group();
  private readonly head = new Group();
  private readonly tail = new Group();
  private readonly ears = new Group();
  private readonly legs: Group[] = [];

  constructor() {
    const cut = createFlatMaterial(CH_CUTOUT);
    const hole = createFlatMaterial(CH_HOLE);
    const geo = (d: string): ShapeGeometry => new ShapeGeometry(pathShapes(d), 8);
    this.group.add(this.body);
    this.body.add(new Mesh(geo(TORSO + ' ' + NECK), cut));
    this.head.position.set(HEAD_X, HEAD_Y, 0);
    this.head.add(new Mesh(geo(SKULL + ' ' + SNOUT + ' ' + JAW + ' ' + RUFF), cut));
    this.ears.position.set(0.0, 0.03, 0);
    this.ears.add(new Mesh(geo(EARS), cut));
    this.head.add(this.ears);
    // an almond eye, slanting up toward the snout
    const eye = new Mesh(new ShapeGeometry(circleShape(0, 0, 1, 16), 1), hole);
    eye.position.set(0.024, 0.017, 0);
    eye.scale.set(0.0075, 0.0042, 1);
    eye.rotation.z = 0.32;
    this.head.add(eye);
    this.body.add(this.head);
    this.tail.position.set(-0.108, 0.168, 0);
    this.tail.add(new Mesh(geo(TAIL), cut));
    this.body.add(this.tail);
    // legs: front pair and back pair, pivoting at the shoulder/hip
    for (const [x, hind, near] of [
      [0.07, false, true],
      [0.052, false, false],
      [HIP_X + 0.004, true, true],
      [HIP_X - 0.014, true, false],
    ] as [number, boolean, boolean][]) {
      const leg = new Group();
      leg.position.set(x, 0.135, near ? 0 : -0.001);
      leg.add(new Mesh(geo(hind ? HIND_LEG : FRONT_LEG), cut));
      this.legs.push(leg);
      this.body.add(leg);
    }
    this.group.visible = false;
  }

  // Every pose parameter goes through a spring (STYLE_GUIDE 4): state changes
  // blend instead of snapping, the tail follows through.
  private readonly sSwing = new Spring(0, 12, 1);
  private readonly sSit = new Spring(0, 8, 0.85);
  private readonly sHead = new Spring(0, 13, 0.75);
  private readonly sTail = new Spring(0, 9, 0.55);
  private readonly sBodyRot = new Spring(0, 11, 0.85);
  private readonly sBodyY = new Spring(0, 14, 0.9);
  private readonly sEars = new Spring(0, 16, 0.6);
  private readonly sRear = new Spring(0, 18, 0.55);
  private readonly sStretch = new Spring(0, 14, 0.8);
  private lastTime = -1;
  private wasVisible = false;

  /**
   * @param scale drawing scale (1 = ~0.31 stage units tall)
   * @param hesitate 0..1 how much it hesitates (leans back, ears flatten)
   * @param vx its speed (it stretches as it bolts)
   */
  update(
    x: number,
    y: number,
    dir: number,
    state: WolfState,
    crouch: number,
    phase: number,
    visible: number,
    time: number,
    scale = 1,
    hesitate = 0,
    vx = 0,
  ): void {
    this.group.visible = visible > 0.02 && state !== 'away';
    if (!this.group.visible) {
      this.wasVisible = false;
      return;
    }
    const dt = this.lastTime < 0 ? 0 : Math.min(0.1, Math.max(0, time - this.lastTime));
    this.lastTime = time;
    this.group.position.set(x, y, 0);
    const walking = state === 'prowl' || state === 'flee' || state === 'return';
    const sitting = state === 'sit' || state === 'howl' || state === 'rest';
    const cower = state === 'cower';
    const rear = state === 'rear';
    const stalk = state === 'prowl';
    // bolting: stretched long and low (squash & stretch), from its speed
    const stretch = this.sStretch.update(state === 'flee' ? Math.min(1, Math.abs(vx) / 1.1) : 0, dt);
    const k = scale;
    this.group.scale.set(dir * k * (1 + 0.2 * stretch), k * (1 - 0.1 * stretch), 1);
    const headT =
      state === 'howl'
        ? 0.95 + Math.sin(time * 2.2) * 0.05
        : state === 'rest'
          ? -0.12 + Math.sin(time * 0.9) * 0.03
          : rear
            ? 0.42
            : cower
              ? -0.5 * crouch
              : sitting
                ? -0.38
                : stalk
                  ? -0.28 + 0.3 * hesitate + Math.sin(time * 1.7) * 0.03
                  : Math.sin(time * 1.7) * 0.04;
    const tailT = rear
      ? -1.0
      : cower
        ? -0.95 * crouch
        : state === 'flee'
          ? 0.3 + Math.sin(phase * 2) * 0.1
          : sitting
            ? -0.7 + Math.sin(time * 1.3) * 0.06
            : stalk
              ? -0.2 - 0.6 * hesitate + Math.sin(time * 2.4) * 0.05
              : 0.15 + Math.sin(time * 2.4) * 0.1;
    // ears: up and alert while stalking, flattening back as your shadow grows
    const earsT = rear || cower || state === 'flee' ? -1.15 : stalk ? -1.0 * hesitate : state === 'howl' ? 0.08 : 0;
    this.ears.rotation.z = this.sEars.update(earsT, dt);
    const bodyRotT = stalk ? -0.04 + 0.12 * hesitate : cower ? -0.08 : 0;
    const bodyYT = -0.02 * crouch + (walking ? Math.abs(Math.sin(phase)) * 0.004 : 0);
    if (!this.wasVisible) {
      // appearing: start in pose, no blend from a stale one
      this.sSwing.snap(walking ? 0.34 : 0);
      this.sSit.snap(sitting ? 1 : 0);
      this.sHead.snap(headT);
      this.sTail.snap(tailT);
      this.sBodyRot.snap(bodyRotT);
      this.sBodyY.snap(bodyYT);
      this.sRear.snap(rear ? 1 : 0);
      this.wasVisible = true;
    }
    // rearing up on its hind legs (held anticipation before the bolt)
    const rearAmt = this.sRear.update(rear ? 1 : 0, dt);
    const amp = this.sSwing.update(walking ? (state === 'flee' ? 0.62 : 0.32) : 0, dt);
    const swing = Math.sin(phase) * amp;
    const sit = Math.max(0, Math.min(1, this.sSit.update(sitting ? 1 : 0, dt)));
    // the body tips up about the hips: sitting (and lowered onto its haunches) or rearing
    const tip = 0.42 * sit + 0.48 * rearAmt + this.sBodyRot.update(bodyRotT, dt);
    const lower = 0.072 * sit;
    const c = Math.cos(tip);
    const s = Math.sin(tip);
    this.body.rotation.z = tip;
    this.body.position.set(HIP_X - (HIP_X * c - HIP_Y * s), HIP_Y - (HIP_X * s + HIP_Y * c) - lower + this.sBodyY.update(bodyYT, dt), 0);
    // walk (alternating pairs) blended with sitting (front legs upright, hind legs folded forward)
    const l = this.legs;
    l[0].rotation.z = swing * (1 - sit) - tip * sit + 0.06 * sit;
    l[1].rotation.z = -swing * (1 - sit) - tip * sit + 0.12 * sit;
    l[2].rotation.z = -swing * (1 - sit) + 1.35 * sit;
    l[3].rotation.z = swing * (1 - sit) + 1.25 * sit;
    if (rearAmt > 0.01) {
      // front legs up and forward, hind legs braced
      l[0].rotation.z += 0.95 * rearAmt;
      l[1].rotation.z += 0.75 * rearAmt;
      l[2].rotation.z -= 0.48 * rearAmt;
      l[3].rotation.z -= 0.42 * rearAmt;
    }
    this.head.rotation.z = this.sHead.update(headT, dt) - tip * 0.5 * (1 - sit);
    this.tail.rotation.z = this.sTail.update(tailT, dt) - tip * 0.6;
  }
}
