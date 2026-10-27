/**
 * The visible rod puppet held by a controller: a flat black card crocodile on
 * a wooden stick, built from the exact capsules that cast its shadow, so the
 * thing in your hand and the shadow on the wall always match. The jaw hinges
 * with the trigger.
 */
import {
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  Shape,
  ShapeGeometry,
} from '@iwsdk/core';
import { CROC_ROD_PUPPET } from '../core/shadow-model.js';

function stadium(ax: number, ay: number, bx: number, by: number, r: number): Shape {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1e-6;
  const ang = Math.atan2(dy, dx);
  const s = new Shape();
  s.absarc(0, 0, r, Math.PI / 2, (Math.PI * 3) / 2, false);
  s.absarc(len, 0, r, -Math.PI / 2, Math.PI / 2, false);
  s.closePath();
  const pts = s.getPoints(10).map((p) => {
    const x = p.x * Math.cos(ang) - p.y * Math.sin(ang) + ax;
    const y = p.x * Math.sin(ang) + p.y * Math.cos(ang) + ay;
    return { x, y };
  });
  const out = new Shape();
  out.setFromPoints(pts as never);
  return out;
}

export class RodPuppetVisual {
  readonly group = new Group();
  private readonly jaw = new Group();
  constructor(readonly handedness: 'left' | 'right') {
    const mirror = handedness === 'left' ? -1 : 1;
    const card = new MeshBasicMaterial({ color: 0x120c08, side: DoubleSide });
    const wood = new MeshBasicMaterial({ color: 0x6b4426 });
    const [rod, ...parts] = CROC_ROD_PUPPET;
    const stick = new Mesh(new CylinderGeometry(rod.r, rod.r, rod.b[1] - rod.a[1] + 0.03, 8), wood);
    stick.position.set(0, (rod.a[1] + rod.b[1]) / 2, 0);
    this.group.add(stick);
    const bodyShapes: Shape[] = [];
    for (const p of parts) {
      if (p.jaw) {
        this.jaw.position.set(p.a[0] * mirror, p.a[1], 0);
        const g = new ShapeGeometry(stadium(0, 0, (p.b[0] - p.a[0]) * mirror, p.b[1] - p.a[1], p.r), 4);
        this.jaw.add(new Mesh(g, card));
      } else {
        bodyShapes.push(stadium(p.a[0] * mirror, p.a[1], p.b[0] * mirror, p.b[1], p.r));
      }
    }
    this.group.add(new Mesh(new ShapeGeometry(bodyShapes, 4), card));
    this.group.add(this.jaw);
    this.group.visible = false;
  }

  /** trigger 0 = jaws open, 1 = closed (matches the shadow model). */
  update(trigger: number): void {
    const open = 1 - Math.min(1, Math.max(0, trigger));
    const mirror = this.handedness === 'left' ? -1 : 1;
    this.jaw.rotation.z = -open * 0.55 * mirror;
  }
}
