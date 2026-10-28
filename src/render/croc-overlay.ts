/**
 * The paper-cut crocodile that dresses your hand in The Hungry Crocodile
 * (STYLE_GUIDE §3): an eye that blinks, a brow, a nostril bump on the snout
 * tip, ridged scutes along the snout and down the forearm (the crocodile's
 * back), and teeth that slide out as the jaw opens and settle after a snap.
 * Everything is attached to the hand's own shadow and gently smoothed so
 * tracking noise never makes it shiver.
 */
import type { Actor, ShadowModel } from '../core/shadow-model.js';
import { Spring, approach, clamp01, easeOutBack, keyLoop } from '../core/ease.js';

export interface CapsuleSink {
  pushRaw(ax: number, ay: number, bx: number, by: number, r: number, soft: number, strength?: number, rb?: number): void;
}
export interface GlowSink {
  push(x: number, y: number, r: number, intensity: number): void;
}

const BLINK: readonly (readonly [number, number])[] = [
  [0, 1],
  [3.6, 1],
  [3.68, 0.15],
  [3.8, 1],
];

const SOFT = 0.0035;

export class CrocOverlay {
  // smoothed anchor points
  private ex = 0;
  private ey = 0;
  private ux = 0;
  private uy = 0;
  private lx = 0;
  private ly = 0;
  private init = false;
  private readonly teeth = new Spring(0, 26, 0.45);
  private wasOpen = false;
  /** 0..1 travel of the last swallowed firefly down the throat (>= 1 = none). */
  gulp = 1;

  update(
    dt: number,
    model: ShadowModel,
    actor: Actor | null,
    visible: number,
    open: number,
    time: number,
    details: CapsuleSink,
    holes: CapsuleSink,
    glows: GlowSink,
  ): void {
    this.gulp = Math.min(1, this.gulp + dt / 0.7);
    if (!actor || visible < 0.05) {
      this.init = false;
      return;
    }
    // anchors: eye just above the knuckles, the two jaw tips
    const rate = 28;
    if (!this.init) {
      this.ex = actor.knuckleS;
      this.ey = actor.knuckleT;
      this.ux = actor.upperS;
      this.uy = actor.upperT;
      this.lx = actor.lowerS;
      this.ly = actor.lowerT;
      this.init = true;
    } else {
      this.ex = approach(this.ex, actor.knuckleS, rate, dt);
      this.ey = approach(this.ey, actor.knuckleT, rate, dt);
      this.ux = approach(this.ux, actor.upperS, rate, dt);
      this.uy = approach(this.uy, actor.upperT, rate, dt);
      this.lx = approach(this.lx, actor.lowerS, rate, dt);
      this.ly = approach(this.ly, actor.lowerT, rate, dt);
    }
    let dx = this.ux - this.ex;
    let dy = this.uy - this.ey;
    const len = Math.hypot(dx, dy) || 1e-3;
    dx /= len;
    dy /= len;
    const k = len / 0.23; // overlay scale relative to a comfortably held hand
    // perpendicular pointing away from the lower jaw = the top of the snout
    let px = -dy;
    let py = dx;
    if ((this.lx - this.ex) * px + (this.ly - this.ey) * py > 0) {
      px = -px;
      py = -py;
    }
    const vis = visible;
    const mask = 1 << model.actors.indexOf(actor);
    const inside = (x: number, y: number): boolean => model.distanceToShadow(x, y, mask) <= 0;
    /** From (x, y) inside the shadow, march along (nx, ny) to the edge; returns the step count. */
    const toEdge = (x: number, y: number, nx: number, ny: number, step: number, max: number): number => {
      let i = 0;
      while (i < max && inside(x + nx * step * (i + 1), y + ny * step * (i + 1))) i++;
      return i;
    };
    const step = 0.004 * Math.max(0.6, k);

    // ---- the top of the snout: scutes and the nostril bump sit on its real edge
    let topX = this.ex;
    let topY = this.ey;
    for (let i = 0; i < 5; i++) {
      const u = 0.12 + i * 0.16;
      const jx = this.ex + dx * len * u;
      const jy = this.ey + dy * len * u;
      if (!inside(jx, jy)) continue;
      const n = toEdge(jx, jy, px, py, step, 40);
      const bx = jx + px * step * (n - 0.6);
      const by = jy + py * step * (n - 0.6);
      if (i === 0) {
        topX = bx;
        topY = by;
      }
      const h = (i === 4 ? 0.011 : 0.014 - i * 0.0012) * k;
      if (i === 4) {
        // nostril bump near the snout tip
        details.pushRaw(bx - dx * 0.008 * k, by - dy * 0.008 * k, bx + dx * 0.006 * k, by + dy * 0.006 * k, 0.009 * k, SOFT, vis, 0.0068 * k);
      } else {
        // scutes, tipped slightly back
        details.pushRaw(bx, by, bx + px * h - dx * h * 0.35, by + py * h - dy * h * 0.35, 0.0058 * k, SOFT, vis, 0.0012);
      }
    }

    // ---- eye with a brow, just under the top edge above the knuckles
    const eyeX = topX - px * 0.02 * k + dx * 0.02 * k;
    const eyeY = topY - py * 0.02 * k + dy * 0.02 * k;
    details.pushRaw(eyeX - dx * 0.02 * k + px * 0.016 * k, eyeY - dy * 0.02 * k + py * 0.016 * k, eyeX + dx * 0.016 * k + px * 0.016 * k, eyeY + dy * 0.016 * k + py * 0.016 * k, 0.015 * k, SOFT, vis, 0.011 * k);
    const blink = keyLoop(time, 4.4, BLINK);
    holes.pushRaw(eyeX, eyeY, eyeX + dx * 0.004 * k, eyeY + dy * 0.004 * k, 0.0085 * k * blink, 0.002, vis);

    // ---- the back: scutes along the forearm, fading with it
    const fa = forearm(model, actor);
    if (fa >= 0) {
      const c = model.capsules[fa];
      const fx = c.bx - c.ax;
      const fy = c.by - c.ay;
      const fl = Math.hypot(fx, fy) || 1e-3;
      // top side = the side the snout's top faces
      let qx = -fy / fl;
      let qy = fx / fl;
      if (qx * px + qy * py < 0) {
        qx = -qx;
        qy = -qy;
      }
      const ra = c.r;
      const rb = c.rb ?? c.r;
      for (let i = 0; i < 6; i++) {
        const u = 0.08 + i * 0.12;
        const r = ra + (rb - ra) * u;
        const fade = 1 - u * (1 - (c.fadeB ?? 1));
        const bx = c.ax + fx * u + qx * r * 0.82;
        const by = c.ay + fy * u + qy * r * 0.82;
        const h = (0.017 - i * 0.0014) * k;
        details.pushRaw(bx, by, bx + qx * h + (fx / fl) * h * 0.3, by + qy * h + (fy / fl) * h * 0.3, 0.007 * k, SOFT, vis * fade, 0.0014);
      }
    }

    // ---- teeth line the real mouth gap: they slide out as the jaw opens
    // (anticipation) and bounce when it snaps shut (follow-through)
    const isOpen = open > 0.35;
    if (this.wasOpen && !isOpen) this.teeth.velocity -= 9;
    this.wasOpen = isOpen;
    const out = this.teeth.update(clamp01((open - 0.12) * 1.7), dt);
    const tl0 = 0.016 * k * Math.max(0, Math.min(1.15, out));
    if (tl0 > 0.002) {
      // the gap runs from near the mouth corner to between the jaw tips
      const cx = this.ex + (this.lx - this.ex) * 0.3;
      const cy = this.ey + (this.ly - this.ey) * 0.3;
      const mx = (this.ux + this.lx) / 2;
      const my = (this.uy + this.ly) / 2;
      let gx = mx - cx;
      let gy = my - cy;
      const gl = Math.hypot(gx, gy) || 1e-3;
      gx /= gl;
      gy /= gl;
      let nx = -gy;
      let ny = gx;
      if ((this.ux - cx) * nx + (this.uy - cy) * ny < 0) {
        nx = -nx;
        ny = -ny;
      }
      for (let i = 0; i < 6; i++) {
        const u = 0.3 + i * 0.12;
        const x = cx + gx * gl * u;
        const y = cy + gy * gl * u;
        if (inside(x, y)) continue; // the jaws are closed here
        const up = edgeFromGap(inside, x, y, nx, ny, step, 40);
        const dn = edgeFromGap(inside, x, y, -nx, -ny, step, 40);
        if (up < 0 || dn < 0) continue;
        const gap = (up + dn) * step;
        const tl = Math.min(tl0 * (i === 5 ? 1.2 : 1), gap * 0.42);
        if (tl < 0.002) continue;
        const ubx = x + nx * (up + 0.6) * step;
        const uby = y + ny * (up + 0.6) * step;
        details.pushRaw(ubx, uby, ubx - nx * tl, uby - ny * tl, 0.0052 * k, SOFT, vis, 0.0011);
        if (i < 5) {
          const lbx = x - nx * (dn + 0.6) * step;
          const lby = y - ny * (dn + 0.6) * step;
          details.pushRaw(lbx, lby, lbx + nx * tl * 0.85, lby + ny * tl * 0.85, 0.0046 * k, SOFT, vis, 0.0011);
        }
      }
    }

    // ---- a swallowed firefly glows on its way down the throat
    if (this.gulp < 1) {
      const g = easeOutBack(this.gulp, 0.6);
      let gx = this.ex + dx * len * (0.55 - g * 0.6);
      let gy = this.ey + dy * len * (0.55 - g * 0.6);
      if (fa >= 0 && g > 0.9) {
        const c = model.capsules[fa];
        const w = (g - 0.9) / 0.1;
        gx += (c.ax + (c.bx - c.ax) * 0.35 - gx) * w;
        gy += (c.ay + (c.by - c.ay) * 0.35 - gy) * w;
      }
      glows.push(gx, gy, 0.03 * k, 0.65 * (1 - this.gulp * 0.8) * vis);
    }
  }

  /** The smoothed eye anchor (motion tests), or null when not shown. */
  eye(): [number, number] | null {
    return this.init ? [this.ex, this.ey] : null;
  }

  /** Starts the swallow glow (call when a firefly is eaten). */
  swallow(): void {
    this.gulp = 0;
  }
}

/** Steps from a point in the mouth gap to the jaw's edge along (nx, ny), or -1 if none within reach. */
function edgeFromGap(inside: (x: number, y: number) => boolean, x: number, y: number, nx: number, ny: number, step: number, max: number): number {
  for (let i = 0; i < max; i++) if (inside(x + nx * step * (i + 1), y + ny * step * (i + 1))) return i;
  return -1;
}

/** Index of the actor's forearm capsule, or -1. */
function forearm(model: ShadowModel, actor: Actor): number {
  const end = actor.capsuleStart + actor.capsuleCount;
  for (let i = actor.capsuleStart; i < end; i++) if (model.capsules[i].forearm) return i;
  return -1;
}
