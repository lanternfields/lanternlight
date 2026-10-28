/**
 * The shadow wolf: an articulated paper cut-out (body, head, ears, tail and
 * four legs on pivots), animated procedurally for prowling, cowering, fleeing,
 * sitting and howling. Drawn into the shadow stage's cut-out channel, with a
 * cut-out eye that lets the lamplight through.
 */
import { EllipseCurve, Group, Mesh, Shape, ShapeGeometry, Vector2 } from '@iwsdk/core';
import type { WolfState } from '../core/wolf.js';
import { CH_CUTOUT, CH_HOLE, createFlatMaterial } from './materials.js';
import { Spring } from '../core/ease.js';

function ellipse(cx: number, cy: number, rx: number, ry: number, rot = 0, seg = 40): Shape {
  const s = new Shape();
  s.setFromPoints(new EllipseCurve(cx, cy, rx, ry, 0, Math.PI * 2, false, rot).getPoints(seg));
  return s;
}

function poly(pts: [number, number][]): Shape {
  return new Shape(pts.map(([x, y]) => new Vector2(x, y)));
}

export class WolfPuppet {
  readonly group = new Group();
  private readonly body = new Group();
  private readonly head = new Group();
  private readonly tail = new Group();
  private readonly legs: Group[] = [];

  constructor() {
    const cut = createFlatMaterial(CH_CUTOUT);
    const hole = createFlatMaterial(CH_HOLE);
    this.group.add(this.body);
    this.body.add(
      new Mesh(
        new ShapeGeometry(
          [
            ellipse(0, 0.105, 0.1, 0.042),
            ellipse(0.068, 0.112, 0.05, 0.05),
            ellipse(-0.07, 0.1, 0.04, 0.038),
            // scruffy back fur
            poly([
              [-0.06, 0.135],
              [-0.03, 0.158],
              [0.0, 0.142],
              [0.03, 0.162],
              [0.06, 0.145],
              [0.02, 0.12],
            ]),
          ],
          4,
        ),
        cut,
      ),
    );
    // head on a neck pivot
    this.head.position.set(0.095, 0.135, 0);
    this.head.add(
      new Mesh(
        new ShapeGeometry(
          [
            ellipse(0.03, 0.03, 0.04, 0.03),
            poly([
              [0.04, 0.045],
              [0.105, 0.028],
              [0.108, 0.018],
              [0.098, 0.01],
              [0.045, 0.008],
            ]),
            poly([
              [0.005, 0.045],
              [0.018, 0.098],
              [0.035, 0.052],
            ]),
            poly([
              [0.028, 0.05],
              [0.048, 0.094],
              [0.058, 0.048],
            ]),
          ],
          4,
        ),
        cut,
      ),
    );
    this.head.add(new Mesh(new ShapeGeometry(ellipse(0.05, 0.038, 0.0055, 0.0045), 4), hole));
    this.body.add(this.head);
    // bushy tail
    this.tail.position.set(-0.098, 0.118, 0);
    this.tail.add(new Mesh(new ShapeGeometry(ellipse(-0.06, 0.012, 0.068, 0.02, 0.35), 4), cut));
    this.body.add(this.tail);
    // legs: front pair and back pair, pivoting at the shoulder/hip
    for (const [x, near] of [
      [0.07, true],
      [0.055, false],
      [-0.07, true],
      [-0.085, false],
    ] as [number, boolean][]) {
      const leg = new Group();
      leg.position.set(x, 0.085, near ? 0 : -0.001);
      leg.add(
        new Mesh(
          new ShapeGeometry([ellipse(0, -0.04, 0.0115, 0.045), ellipse(0.008, -0.083, 0.014, 0.007)], 4),
          cut,
        ),
      );
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
  private lastTime = -1;
  private wasVisible = false;

  update(x: number, y: number, dir: number, state: WolfState, crouch: number, phase: number, visible: number, time: number): void {
    this.group.visible = visible > 0.02 && state !== 'away';
    if (!this.group.visible) {
      this.wasVisible = false;
      return;
    }
    const dt = this.lastTime < 0 ? 0 : Math.min(0.1, Math.max(0, time - this.lastTime));
    this.lastTime = time;
    this.group.position.set(x, y, 0);
    const k = 1.15;
    this.group.scale.set(dir * k, k, 1);
    const walking = state === 'prowl' || state === 'flee' || state === 'return';
    const sitting = state === 'sit' || state === 'howl';
    const cower = state === 'cower';
    const headT =
      state === 'howl' ? 0.65 + Math.sin(time * 2.2) * 0.04 : cower ? -0.45 * crouch : sitting ? -0.32 : Math.sin(time * 1.7) * 0.04;
    const tailT = cower ? -1.1 * crouch : state === 'flee' ? 0.2 + Math.sin(phase * 2) * 0.1 : sitting ? -0.5 : 0.25 + Math.sin(time * 2.4) * 0.12;
    const bodyRotT = sitting ? 0.32 : cower ? -0.06 : 0;
    const bodyYT = -0.028 * crouch + (walking ? Math.abs(Math.sin(phase)) * 0.004 : 0);
    if (!this.wasVisible) {
      // appearing: start in pose, no blend from a stale one
      this.sSwing.snap(walking ? 0.38 : 0);
      this.sSit.snap(sitting ? 1 : 0);
      this.sHead.snap(headT);
      this.sTail.snap(tailT);
      this.sBodyRot.snap(bodyRotT);
      this.sBodyY.snap(bodyYT);
      this.wasVisible = true;
    }
    const amp = this.sSwing.update(walking ? (state === 'flee' ? 0.7 : 0.38) : 0, dt);
    const swing = Math.sin(phase) * amp;
    const sit = Math.max(0, Math.min(1, this.sSit.update(sitting ? 1 : 0, dt)));
    // walk (alternating pairs) blended with the sitting pose (back legs folded)
    const l = this.legs;
    l[0].rotation.z = swing * (1 - sit) + -0.3 * sit;
    l[1].rotation.z = -swing * (1 - sit) + -0.25 * sit;
    l[2].rotation.z = -swing * (1 - sit) + -1.1 * sit;
    l[3].rotation.z = swing * (1 - sit) + -1.0 * sit;
    this.body.position.y = this.sBodyY.update(bodyYT, dt);
    this.body.rotation.z = this.sBodyRot.update(bodyRotT, dt);
    this.head.rotation.z = this.sHead.update(headT, dt);
    this.tail.rotation.z = this.sTail.update(tailT, dt);
  }
}
