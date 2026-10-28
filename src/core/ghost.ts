/**
 * Ghost hints: a faint hand-shadow that shows (never tells) the shape to make.
 *
 * The ghost is cast by **the same caster as the player's hand** (STYLE_GUIDE
 * §1): a synthetic 25-joint skeleton is posed in front of a canonical stage and
 * projected by a ShadowModel, so it gets the same tapered fingers, contoured
 * palm, fading forearm and penumbra as a real hand. Only its strength differs.
 *
 * Gestures move on eased keyframes with holds (STYLE_GUIDE §4.9): wave, hold,
 * wave back; ears twitch, rest; jaws open, hold, snap shut, rest.
 */
import { HandFrame, createHandFrame } from './hand-model.js';
import { V3 } from './math.js';
import { ShadowModel } from './shadow-model.js';
import { StageFrame, createStageFrame } from './projection.js';
import { POSES, SyntheticPose, makeHand } from './synthetic-hand.js';
import { keyLoop } from './ease.js';

import type { GhostPose } from './story.js';

/** Stage units of shadow per metre of hand at ghost scale 1 (a comfortably held hand). */
export const GHOST_K = 2.4;
/** Canonical light distance from the canonical stage (metres = stage units). */
const LIGHT_Z = 1.2;

const WAVE: readonly (readonly [number, number])[] = [
  [0, -14],
  [0.18, -14],
  [0.7, 15],
  [0.88, 15],
];
const EAR_I: readonly (readonly [number, number])[] = [
  [0, 1],
  [1.1, 1],
  [1.3, 0.78],
  [1.5, 1],
  [1.68, 0.84],
  [1.86, 1],
];
const EAR_M: readonly (readonly [number, number])[] = [
  [0, 1],
  [1.2, 1],
  [1.4, 0.8],
  [1.6, 1],
  [1.78, 0.86],
  [1.96, 1],
];
/** Jaw openness: open, hold, SNAP shut, rest. */
const JAW: readonly (readonly [number, number])[] = [
  [0, 0],
  [0.55, 1],
  [1.15, 1],
  [1.32, 0],
  [1.9, 0],
];

export class GhostCaster {
  /** Holds the ghost's capsules and palm (actors[1]) after update(). */
  readonly model = new ShadowModel();
  private readonly stage: StageFrame = createStageFrame();
  private readonly light = new V3(0, 0, LIGHT_Z);
  private readonly none: HandFrame = createHandFrame('left');
  private readonly frames: HandFrame[] = [this.none, createHandFrame('right')];
  private readonly pose: SyntheticPose = { ...POSES.open };
  private readonly pos = new V3();
  visible = false;

  constructor() {
    const st = this.stage;
    st.origin.set(0, 0, 0);
    st.normal.set(0, 0, 1);
    st.right.set(1, 0, 0);
    st.up.set(0, 1, 0);
    st.height = 1;
  }

  /**
   * Rebuilds the ghost for this frame.
   * @param phase seconds since the hint began (drives the gesture)
   */
  update(kind: GhostPose, s: number, t: number, scale: number, phase: number, visible: number, dt: number): void {
    this.visible = visible > 0.01;
    if (!this.visible) {
      this.model.capsuleCount = 0;
      this.model.actors[1].present = false;
      return;
    }
    const p = this.pose;
    let roll = 0;
    let pitch = 0;
    let ox = 0;
    let oy = -0.09;
    switch (kind) {
      case 'open':
        Object.assign(p, POSES.open);
        roll = keyLoop(phase, 1.4, WAVE);
        break;
      case 'rabbit':
        Object.assign(p, POSES.rabbit);
        p.index = keyLoop(phase, 2.4, EAR_I);
        p.middle = keyLoop(phase, 2.4, EAR_M);
        roll = -12;
        break;
      case 'mouth': {
        Object.assign(p, POSES.mouthOpen);
        p.thumbOppose = 1 - keyLoop(phase, 1.9, JAW);
        roll = -90; // fingers point right, thumb underneath: a crocodile
        ox = -0.09;
        oy = 0;
        break;
      }
      case 'point':
        // one finger up, held very still (only a slow breath of motion)
        Object.assign(p, POSES.point);
        roll = 6 * Math.sin(phase * 0.8);
        break;
      case 'bridge':
        Object.assign(p, POSES.flat);
        roll = -90;
        pitch = 90; // palm down: seen edge-on it is a long low bar
        ox = -0.09;
        oy = 0;
        break;
    }
    const m = GHOST_K * scale;
    // hand plane where the light magnifies by m; wrist placed so its shadow lands at s + ox*m
    const z = LIGHT_Z * (1 - 1 / m);
    this.pos.set(s / m + ox, t / m + oy, z);
    const hand = makeHand(p, { position: this.pos, roll, pitch }, this.frames[1]);
    // the forearm runs toward a viewer sitting behind and above the hand
    this.model.head.set(this.pos.x + 0.08, this.pos.y + 0.24, z + 0.42);
    this.model.right.set(1, 0, 0);
    this.frames[0] = this.none;
    this.model.build(this.frames, NO_RODS, this.light, this.stage, dt, false);
    void hand;
  }
}

const NO_RODS: never[] = [];
