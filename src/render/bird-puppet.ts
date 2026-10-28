/**
 * The finale's paper bird, in Pip's round paper-cut language: a round body
 * and head, a fan tail, a small beak and one wing on a pivot. It flies with
 * quick wing beats, tilts with its climb, and lands with a little squash and
 * settle bounce. Origin at its feet, facing +x. Extents: core/story.ts
 * BIRD_EXTENT (this drawing at BIRD_K).
 */
import { Group, Mesh, ShapeGeometry } from '@iwsdk/core';
import { CH_CUTOUT, CH_HOLE, createFlatMaterial } from './materials.js';
import { circleShape, pathShapes } from './paths.js';
import { Spring } from '../core/ease.js';

/** Drawing scale of the model below (stage units). */
export const BIRD_K = 1.8;

const BODY =
  'M -0.022 0.026 Q -0.02 0.042 -0.002 0.043 Q 0.008 0.05 0.016 0.055 Q 0.028 0.057 0.03 0.046 ' +
  'Q 0.03 0.034 0.02 0.024 Q 0.014 0.012 0.0 0.012 Q -0.016 0.012 -0.022 0.026 Z';
const BEAK = 'M 0.028 0.05 Q 0.035 0.048 0.04 0.043 Q 0.034 0.041 0.027 0.042 Z';
const TAIL =
  'M -0.014 0.03 Q -0.03 0.038 -0.042 0.048 Q -0.046 0.04 -0.04 0.032 Q -0.047 0.027 -0.043 0.02 ' +
  'Q -0.03 0.02 -0.014 0.018 Z';
const LEGS = 'M -0.002 0.014 L 0.001 0.014 L -0.001 0.0 L -0.004 0.0 Z M 0.006 0.014 L 0.009 0.014 L 0.008 0.0 L 0.005 0.0 Z';
const WING = 'M 0.008 0.0 Q -0.006 0.018 -0.03 0.016 Q -0.024 0.006 -0.028 -0.002 Q -0.012 -0.008 0.008 0.0 Z';

export class BirdPuppet {
  readonly group = new Group();
  private readonly body = new Group();
  private readonly wing = new Group();
  private readonly legs: Mesh;
  private readonly squash = new Spring(0, 16, 0.32);
  private readonly wingS = new Spring(0, 30, 0.7);
  private landings = 0;
  private lastTime = -1;

  constructor() {
    const cut = createFlatMaterial(CH_CUTOUT);
    const hole = createFlatMaterial(CH_HOLE);
    const geo = (d: string): ShapeGeometry => new ShapeGeometry(pathShapes(d), 8);
    this.group.add(this.body);
    this.body.add(new Mesh(geo(BODY + ' ' + BEAK + ' ' + TAIL), cut));
    this.legs = new Mesh(geo(LEGS), cut);
    this.body.add(this.legs);
    this.wing.position.set(0.004, 0.032, 0);
    this.wing.add(new Mesh(geo(WING), cut));
    this.body.add(this.wing);
    const eye = new Mesh(new ShapeGeometry(circleShape(0.021, 0.048, 0.0027, 12), 1), hole);
    this.body.add(eye);
    this.group.visible = false;
  }

  /** The beak tip in stage units (where it carries the lantern's spark). */
  beak(x: number, y: number, dir: number, tilt: number, out: [number, number]): [number, number] {
    const bx = 0.04 * BIRD_K;
    const by = 0.045 * BIRD_K;
    const c = Math.cos(tilt);
    const s = Math.sin(tilt);
    out[0] = x + dir * (bx * c - by * s);
    out[1] = y + bx * s + by * c;
    return out;
  }

  update(x: number, y: number, dir: number, flying: boolean, tilt: number, visible: number, landings: number, time: number, calm: boolean): void {
    this.group.visible = visible > 0.02;
    const dt = this.lastTime < 0 ? 0 : Math.min(0.1, Math.max(0, time - this.lastTime));
    this.lastTime = time;
    if (!this.group.visible) return;
    if (landings !== this.landings) {
      // touch-down: a squash, then a little settle bounce
      if (landings > this.landings) this.squash.velocity -= 7;
      this.landings = landings;
    }
    const sq = this.squash.update(0, dt);
    this.group.position.set(x, y, 0);
    this.group.scale.set(dir * BIRD_K * (1 - 0.35 * sq), BIRD_K * (1 + 0.5 * sq), 1);
    this.body.rotation.z = tilt;
    // wings: quick beats in flight (a glide now and then), folded when standing
    let w: number;
    if (flying) {
      const beat = calm ? 0.2 : Math.sin(time * Math.PI * 2 * 6.5);
      const glide = calm ? 0 : Math.max(0, Math.sin(time * 0.9) - 0.75) * 4;
      w = 0.25 + (0.85 - 0.6 * Math.min(1, glide)) * beat;
    } else {
      // a small wing flick now and then while perched
      const flick = calm ? 0 : Math.max(0, Math.sin(time * 1.3) - 0.94) * 12;
      w = 0.05 + 0.5 * flick;
    }
    this.wing.rotation.z = flying ? w : this.wingS.update(w, dt);
    if (flying) this.wingS.snap(w);
    this.legs.visible = !flying;
  }
}
