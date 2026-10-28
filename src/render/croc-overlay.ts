/**
 * The paper-cut crocodile that dresses your hand in The Hungry River
 * (STYLE_GUIDE §3): an eye that blinks, a brow, a nostril bump, ridged scutes
 * along the snout and down the forearm (the crocodile's back), and teeth that
 * slide out as the jaw opens and settle after a snap.
 *
 * Everything hangs off ONE smoothed head frame, not off fingertips: its origin
 * is the knuckle line, its axis the snout direction, both on critically damped
 * springs, so tracking noise and finger wiggles never make the eye wander. The
 * eye sits at a fixed place in that frame (the upper back of the snout) and is
 * clamped inside the head's silhouette; scute and tooth offsets are measured
 * on the real shadow edge but each goes through its own spring.
 */
import type { Actor, ShadowModel } from '../core/shadow-model.js';
import { Spring, clamp01, easeOutBack, keyLoop } from '../core/ease.js';

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
const N_SCUTES = 4;
const N_TEETH = 6;

export class CrocOverlay {
  // the head frame (origin, snout angle, snout length, top-edge offset)
  private readonly ox = new Spring(0, 14, 1);
  private readonly oy = new Spring(0, 14, 1);
  private readonly ang = new Spring(0, 11, 1);
  private readonly len = new Spring(0.23, 9, 1);
  private readonly top = new Spring(0.035, 7, 1);
  /** +1/-1: which side of the snout axis is its top (away from the lower jaw); flips only when sure. */
  private side = 1;
  private sideVotes = 0;
  // lower jaw (thumb) tip, smoothed
  private readonly lx = new Spring(0, 14, 1);
  private readonly ly = new Spring(0, 14, 1);
  // the drawn eye, smoothed once more
  private readonly eyeX = new Spring(0, 18, 1);
  private readonly eyeY = new Spring(0, 18, 1);
  private readonly scute = Array.from({ length: N_SCUTES }, () => new Spring(0.03, 9, 1));
  private readonly toothUp = Array.from({ length: N_TEETH }, () => new Spring(0, 12, 1));
  private readonly toothDn = Array.from({ length: N_TEETH }, () => new Spring(0, 12, 1));
  private init = false;
  private readonly teeth = new Spring(0, 26, 0.45);
  private wasOpen = false;
  /** 0..1 travel of the last swallowed firefly down the throat (>= 1 = none). */
  gulp = 1;
  /** 0..1 a flash in the mouth when it catches one. */
  flash = 0;

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
    full = 0,
  ): void {
    this.gulp = Math.min(1, this.gulp + dt / 0.7);
    this.flash = Math.max(0, this.flash - dt / 0.25);
    if (!actor || visible < 0.05) {
      this.init = false;
      return;
    }
    // ---- raw head frame from stable joints: knuckle line -> fingertips
    const rawDx = actor.upperS - actor.knuckleS;
    const rawDy = actor.upperT - actor.knuckleT;
    const rawLen = Math.hypot(rawDx, rawDy) || 1e-3;
    let rawAng = Math.atan2(rawDy, rawDx);
    if (!this.init) {
      this.ox.snap(actor.knuckleS);
      this.oy.snap(actor.knuckleT);
      this.ang.snap(rawAng);
      this.len.snap(rawLen);
      this.lx.snap(actor.lowerS);
      this.ly.snap(actor.lowerT);
    } else {
      // unwrap so the angle spring never spins the long way round
      while (rawAng - this.ang.value > Math.PI) rawAng -= Math.PI * 2;
      while (rawAng - this.ang.value < -Math.PI) rawAng += Math.PI * 2;
    }
    const ox = this.ox.update(actor.knuckleS, dt);
    const oy = this.oy.update(actor.knuckleT, dt);
    const a = this.ang.update(rawAng, dt);
    const len = Math.max(0.05, this.len.update(rawLen, dt));
    const lx = this.lx.update(actor.lowerS, dt);
    const ly = this.ly.update(actor.lowerT, dt);
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const k = len / 0.23; // overlay scale relative to a comfortably held hand
    // the top of the snout: away from the lower jaw (with hysteresis)
    const lowerSide = (lx - ox) * -dy + (ly - oy) * dx > 0 ? -1 : 1;
    if (!this.init) {
      this.side = lowerSide;
      this.sideVotes = 0;
    } else if (lowerSide !== this.side) {
      this.sideVotes += dt;
      if (this.sideVotes > 0.3) {
        this.side = lowerSide;
        this.sideVotes = 0;
      }
    } else this.sideVotes = 0;
    const px = -dy * this.side;
    const py = dx * this.side;
    const vis = visible;
    const mask = 1 << model.actors.indexOf(actor);
    const inside = (x: number, y: number): boolean => model.distanceToShadow(x, y, mask) <= 0;
    const step = 0.004 * Math.max(0.6, k);
    const edge = (x: number, y: number, nx: number, ny: number, max: number): number => {
      let i = 0;
      while (i < max && inside(x + nx * step * (i + 1), y + ny * step * (i + 1))) i++;
      return i * step;
    };

    // ---- the snout's top edge (measured at the knuckles, smoothed slowly)
    const topRaw = inside(ox, oy) ? edge(ox, oy, px, py, 30) : 0.03 * k;
    const topOff = Math.max(0.012 * k, Math.min(0.08 * k, this.top.update(topRaw, dt)));

    // ---- eye: fixed in the head frame on the upper back of the snout, clamped inside
    let ex = ox + dx * len * 0.16 + px * (topOff - 0.022 * k);
    let ey = oy + dy * len * 0.16 + py * (topOff - 0.022 * k);
    for (let i = 0; i < 10 && !(model.distanceToShadow(ex, ey, mask) <= -0.006 * k); i++) {
      ex -= px * 0.004 * k;
      ey -= py * 0.004 * k;
    }
    if (!this.init) {
      this.eyeX.snap(ex);
      this.eyeY.snap(ey);
    }
    ex = this.eyeX.update(ex, dt);
    ey = this.eyeY.update(ey, dt);
    // brow above the eye, then the eye hole (with a blink)
    details.pushRaw(ex - dx * 0.02 * k + px * 0.014 * k, ey - dy * 0.02 * k + py * 0.014 * k, ex + dx * 0.016 * k + px * 0.014 * k, ey + dy * 0.016 * k + py * 0.014 * k, 0.016 * k, SOFT, vis, 0.012 * k);
    const blink = keyLoop(time, 4.4, BLINK);
    holes.pushRaw(ex, ey, ex + dx * 0.004 * k, ey + dy * 0.004 * k, 0.0095 * k * blink, 0.002, vis);

    // ---- scutes along the snout top and a nostril bump at its tip (bold)
    for (let i = 0; i < N_SCUTES; i++) {
      const u = 0.3 + i * 0.17;
      const jx = ox + dx * len * u;
      const jy = oy + dy * len * u;
      const raw = inside(jx, jy) ? edge(jx, jy, px, py, 30) : topOff;
      const off = this.scute[i].update(raw, dt);
      const bx = jx + px * (off - 0.003);
      const by = jy + py * (off - 0.003);
      if (i === N_SCUTES - 1) {
        details.pushRaw(bx - dx * 0.012 * k, by - dy * 0.012 * k, bx + dx * 0.009 * k, by + dy * 0.009 * k, 0.0135 * k, SOFT, vis, 0.0095 * k);
      } else {
        const h = (0.027 - i * 0.0025) * k;
        details.pushRaw(bx, by, bx + px * h - dx * h * 0.35, by + py * h - dy * h * 0.35, 0.0098 * k, SOFT, vis, 0.0016);
      }
    }

    // ---- the back: scutes along the forearm, fading with it
    const fa = forearm(model, actor);
    if (fa >= 0) {
      const c = model.capsules[fa];
      const fx = c.bx - c.ax;
      const fy = c.by - c.ay;
      const fl = Math.hypot(fx, fy) || 1e-3;
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
        const h = (0.03 - i * 0.0022) * k;
        details.pushRaw(bx, by, bx + qx * h + (fx / fl) * h * 0.3, by + qy * h + (fy / fl) * h * 0.3, 0.011 * k, SOFT, vis * fade, 0.0018);
      }
    }

    // ---- teeth line the real mouth gap: they slide out as the jaw opens and
    // bounce when it snaps shut; each tooth's reach goes through its own spring
    const isOpen = open > 0.35;
    if (this.wasOpen && !isOpen) this.teeth.velocity -= 9;
    this.wasOpen = isOpen;
    const out = this.teeth.update(clamp01((open - 0.12) * 1.7), dt);
    const tl0 = 0.03 * k * Math.max(0, Math.min(1.15, out));
    const cx = ox + (lx - ox) * 0.3;
    const cy = oy + (ly - oy) * 0.3;
    const mx = ox + dx * len * 0.92 * 0.5 + (lx - ox) * 0.5;
    const my = oy + dy * len * 0.92 * 0.5 + (ly - oy) * 0.5;
    let gx = mx - cx;
    let gy = my - cy;
    const gl = Math.hypot(gx, gy) || 1e-3;
    gx /= gl;
    gy /= gl;
    let nx = -gy;
    let ny = gx;
    if (nx * px + ny * py < 0) {
      nx = -nx;
      ny = -ny;
    }
    for (let i = 0; i < N_TEETH; i++) {
      const u = 0.3 + i * 0.12;
      const x = cx + gx * gl * u;
      const y = cy + gy * gl * u;
      const closed = inside(x, y);
      const upRaw = closed ? 0 : edgeFromGap(inside, x, y, nx, ny, step, 40);
      const dnRaw = closed ? 0 : edgeFromGap(inside, x, y, -nx, -ny, step, 40);
      const up = this.toothUp[i].update(Math.max(0, upRaw) * step, dt);
      const dn = this.toothDn[i].update(Math.max(0, dnRaw) * step, dt);
      const gap = up + dn;
      const tl = Math.min(tl0 * (i === N_TEETH - 1 ? 1.2 : 1), gap * 0.48);
      if (tl < 0.002 || closed) continue;
      const ubx = x + nx * (up + 0.6 * step);
      const uby = y + ny * (up + 0.6 * step);
      details.pushRaw(ubx, uby, ubx - nx * tl, uby - ny * tl, 0.0088 * k, SOFT, vis, 0.0014);
      if (i < N_TEETH - 1) {
        const lbx = x - nx * (dn + 0.6 * step);
        const lby = y - ny * (dn + 0.6 * step);
        details.pushRaw(lbx, lby, lbx + nx * tl * 0.85, lby + ny * tl * 0.85, 0.008 * k, SOFT, vis, 0.0014);
      }
    }

    // ---- the throat: between the knuckles and the wrist, where swallowed fireflies keep glowing
    let tx = ox - dx * len * 0.3;
    let ty = oy - dy * len * 0.3;
    if (fa >= 0) {
      const c = model.capsules[fa];
      tx = ox + (c.ax - ox) * 0.65;
      ty = oy + (c.ay - oy) * 0.65;
    }
    // ---- a catch: a flash in the mouth, then the firefly glows down into the throat
    if (this.flash > 0) {
      glows.push(mx, my, 0.14 * k, 0.8 * this.flash * vis);
      glows.push(mx, my, 0.04 * k, this.flash * vis);
    }
    if (this.gulp < 1) {
      const g = Math.min(1, easeOutBack(this.gulp, 0.6));
      const sx = ox + dx * len * 0.55;
      const sy = oy + dy * len * 0.55;
      glows.push(sx + (tx - sx) * g, sy + (ty - sy) * g, 0.045 * k, 0.9 * (1 - this.gulp * 0.5) * vis);
    }
    // the swallowed fireflies don't go out: the throat glows, brighter the fuller it is
    if (full > 0) {
      const pulse = 0.85 + 0.15 * Math.sin(time * 2.4);
      // (the first catch lights it as the firefly arrives)
      const settle = this.gulp < 1 && full < 0.2 ? this.gulp : 1;
      glows.push(tx, ty, (0.07 + 0.05 * full) * k, (0.22 + 0.3 * full) * pulse * vis * settle);
      glows.push(tx, ty, (0.026 + 0.012 * full) * k, (0.5 + 0.45 * full) * pulse * vis * settle);
    }
    this.init = true;
    this.lastEye[0] = ex;
    this.lastEye[1] = ey;
  }

  private readonly lastEye: [number, number] = [0, 0];

  /** The drawn eye position (motion tests), or null when not shown. */
  eye(): [number, number] | null {
    return this.init ? [this.lastEye[0], this.lastEye[1]] : null;
  }

  /** Starts the catch: a mouth flash and the swallow glow. */
  swallow(): void {
    this.gulp = 0;
    this.flash = 1;
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
