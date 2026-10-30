/**
 * The paper-cut crocodile that dresses your hand in The Hungry River
 * (STYLE_GUIDE §3). The silhouette sells it, not small detail:
 *  - a long, flat snout: one clean tapered top line from the brow to a little
 *    past the fingertips (it bridges the knuckle bumps), with a nostril bump
 *    at its tip;
 *  - a raised eye (brow bump and a cut-out eye that blinks);
 *  - a few bold scutes behind the eye, along the back of the hand and the
 *    start of the arm (the crocodile's back), none on the snout;
 *  - a few big teeth, only while the jaw is open; they settle after a snap;
 *  - swallowed fireflies glow in the throat, inside the head behind the jaw.
 *
 * Everything hangs off ONE smoothed head frame, not off fingertips: its origin
 * is the knuckle line, its axis the snout direction, both on critically damped
 * springs, so tracking noise and finger wiggles never make the eye wander. The
 * eye sits at a fixed place in that frame (the upper back of the snout) and is
 * clamped inside the head's silhouette; edge offsets are measured on the real
 * shadow edge but each goes through its own spring.
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
/** The dorsal ridge behind the head: small, low, regular scutes along the neck (head-axis u, behind the knuckles)... */
const BACK_SCUTES: readonly number[] = [-0.34, -0.5, -0.66, -0.82];
/** ...and on along the arm (fractions of its length), fading with it. */
const ARM_SCUTES: readonly number[] = [0.1, 0.24, 0.38, 0.52];
/** One scute: height and base radius (low triangles leaning back, not spikes). */
const SCUTE_H = 0.0135;
const SCUTE_R = 0.0075;
/** Where the snout's clean top line starts (behind the knuckles: no step there) and ends (past the fingertips). */
const SNOUT_U: readonly [number, number] = [-0.36, 1.16];
/** The closed-mouth smile: a zigzag of small interlocking teeth along the jaw line (head-axis u). */
const SMILE_U: readonly [number, number] = [0.3, 1.0];
const SMILE_TEETH = 8;
/** Teeth along the mouth gap (fractions of it), upper; the lower jaw has all but the last. */
const TEETH: readonly number[] = [0.38, 0.58, 0.78, 0.93];
/** The jaw must be this open before teeth show (0..1). */
const TEETH_OPEN = 0.3;

/** Where along its length the arm's shadow fade starts and ends (the capsule shader's smoothstep). */
const ARM_FADE: readonly [number, number] = [0.08, 0.95];

export class CrocOverlay {
  // the head frame (origin, snout angle, snout length, top-edge offsets)
  private readonly ox = new Spring(0, 14, 1);
  private readonly oy = new Spring(0, 14, 1);
  private readonly ang = new Spring(0, 11, 1);
  private readonly len = new Spring(0.23, 9, 1);
  private readonly top = new Spring(0.035, 7, 1);
  private readonly tipTop = new Spring(0.025, 7, 1);
  /** +1/-1: which side of the snout axis is its top (away from the lower jaw); flips only when sure. */
  private side = 1;
  private sideVotes = 0;
  // lower jaw (thumb) tip, smoothed
  private readonly lx = new Spring(0, 14, 1);
  private readonly ly = new Spring(0, 14, 1);
  // the drawn eye, smoothed once more
  private readonly eyeX = new Spring(0, 18, 1);
  private readonly eyeY = new Spring(0, 18, 1);
  private readonly back = BACK_SCUTES.map(() => new Spring(0.03, 9, 1));
  private readonly toothUp = TEETH.map(() => new Spring(0, 12, 1));
  private readonly toothDn = TEETH.map(() => new Spring(0, 12, 1));
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
    const at = (u: number, off: number): [number, number] => [ox + dx * len * u + px * off, oy + dy * len * u + py * off];

    // ---- the snout's top edge, measured at the knuckles and near the tip (smoothed slowly)
    const topRaw = inside(ox, oy) ? edge(ox, oy, px, py, 30) : 0.03 * k;
    const topOff = Math.max(0.012 * k, Math.min(0.08 * k, this.top.update(topRaw, dt)));
    const [ux, uy] = at(0.82, 0);
    const tipRaw = inside(ux, uy) ? edge(ux, uy, px, py, 30) : topOff * 0.6;
    const tipOff = Math.max(0.006 * k, Math.min(topOff, this.tipTop.update(tipRaw, dt)));

    // ---- one long, flat snout: a tapered capsule whose top edge is a single
    // straight line from behind the knuckles (no step there) to well past the
    // fingertips (it fills the dips between the knuckles; its underside stays
    // inside the head), ending in a slightly bulbous nostril tip
    const slope = (tipOff - topOff) / 0.82;
    // (forward of the knuckles the line tapers to the tip; behind them it stays
    // a touch under the knuckle top, so the head piece adds length, not forehead)
    const topAt = (u: number): number => (u >= 0 ? topOff + slope * u : topOff * 0.94);
    const ra = Math.min(0.02 * k, topAt(SNOUT_U[0]) * 0.55);
    const rb = Math.max(0.006 * k, Math.min(ra * 0.55, tipOff * 0.45));
    const [sax, say] = at(SNOUT_U[0], topAt(SNOUT_U[0]) - ra);
    const [sbx, sby] = at(SNOUT_U[1], Math.max(rb, topAt(SNOUT_U[1])) - rb);
    details.pushRaw(sax, say, sbx, sby, ra, SOFT, vis, rb);
    const [nx0, ny0] = at(SNOUT_U[1] - 0.04, Math.max(rb, topAt(SNOUT_U[1] - 0.04)) - 0.008 * k);
    details.pushRaw(nx0 - dx * 0.008 * k, ny0 - dy * 0.008 * k, nx0 + dx * 0.008 * k, ny0 + dy * 0.008 * k, 0.012 * k, SOFT, vis, 0.011 * k);

    // ---- the eye turret: a small, low, rounded bump on the head's top line,
    // at the back of the head, with the cut-out eye in it (and a blink)
    let [ex, ey] = at(0.1, topAt(0.1) + 0.003 * k);
    if (!this.init) {
      this.eyeX.snap(ex);
      this.eyeY.snap(ey);
    }
    ex = this.eyeX.update(ex, dt);
    ey = this.eyeY.update(ey, dt);
    details.pushRaw(ex - dx * 0.01 * k - px * 0.004 * k, ey - dy * 0.01 * k - py * 0.004 * k, ex + dx * 0.01 * k - px * 0.004 * k, ey + dy * 0.01 * k - py * 0.004 * k, 0.014 * k, SOFT, vis, 0.014 * k);
    const blink = keyLoop(time, 4.4, BLINK);
    holes.pushRaw(ex, ey, ex + dx * 0.003 * k, ey + dy * 0.003 * k, 0.0062 * k * blink, 0.002, vis);

    // ---- the dorsal ridge: small, low, regular scutes along the neck behind the head
    for (let i = 0; i < BACK_SCUTES.length; i++) {
      const u = BACK_SCUTES[i];
      const [jx, jy] = at(u, 0);
      const raw = inside(jx, jy) ? edge(jx, jy, px, py, 30) : -1;
      if (raw < 0) continue; // past the hand (the arm carries its own)
      const off = this.back[i].update(raw, dt);
      const bx = jx + px * (off - 0.003 * k);
      const by = jy + py * (off - 0.003 * k);
      const h = SCUTE_H * k;
      details.pushRaw(bx, by, bx + px * h - dx * h * 0.55, by + py * h - dy * h * 0.55, SCUTE_R * k, SOFT, vis, 0.0015);
    }
    // ...and on the start of the arm, fading with it
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
      const r0 = c.r;
      const r1 = c.rb ?? c.r;
      for (let i = 0; i < ARM_SCUTES.length; i++) {
        const u = ARM_SCUTES[i];
        const r = r0 + (r1 - r0) * u;
        const s = clamp01((u - ARM_FADE[0]) / (ARM_FADE[1] - ARM_FADE[0]));
        const fade = 1 - (1 - (c.fadeB ?? 1)) * s * s * (3 - 2 * s);
        const bx = c.ax + fx * u + qx * r * 0.85;
        const by = c.ay + fy * u + qy * r * 0.85;
        const h = SCUTE_H * k * (1 - i * 0.08);
        details.pushRaw(bx, by, bx + qx * h + (fx / fl) * h * 0.55, by + qy * h + (fy / fl) * h * 0.55, SCUTE_R * k, SOFT, vis * fade, 0.0015);
      }
    }

    // ---- a few big teeth line the real mouth gap: they slide out only once the
    // jaw is open and bounce when it snaps shut; each tooth's reach has its own spring
    const isOpen = open > 0.35;
    if (this.wasOpen && !isOpen) this.teeth.velocity -= 9;
    this.wasOpen = isOpen;
    const out = this.teeth.update(clamp01((open - TEETH_OPEN) * 2.2), dt);
    const tl0 = 0.04 * k * Math.max(0, Math.min(1.15, out));
    const cx = ox + (lx - ox) * 0.3;
    const cy = oy + (ly - oy) * 0.3;
    const mx = ox + dx * len * 0.92 * 0.5 + (lx - ox) * 0.5;
    const my = oy + dy * len * 0.92 * 0.5 + (ly - oy) * 0.5;
    let gx = mx - cx;
    let gy = my - cy;
    const gl = Math.hypot(gx, gy) || 1e-3;
    gx /= gl;
    gy /= gl;
    let tnx = -gy;
    let tny = gx;
    if (tnx * px + tny * py < 0) {
      tnx = -tnx;
      tny = -tny;
    }
    for (let i = 0; i < TEETH.length; i++) {
      const u = TEETH[i];
      const x = cx + gx * gl * u;
      const y = cy + gy * gl * u;
      const closed = inside(x, y);
      const upRaw = closed ? 0 : edgeFromGap(inside, x, y, tnx, tny, step, 40);
      const dnRaw = closed ? 0 : edgeFromGap(inside, x, y, -tnx, -tny, step, 40);
      const up = this.toothUp[i].update(Math.max(0, upRaw) * step, dt);
      const dn = this.toothDn[i].update(Math.max(0, dnRaw) * step, dt);
      const gap = up + dn;
      const tl = Math.min(tl0 * (i === TEETH.length - 1 ? 1.15 : 1), gap * 0.45);
      if (tl < 0.004 * k || closed) continue;
      const ubx = x + tnx * (up + 0.6 * step);
      const uby = y + tny * (up + 0.6 * step);
      details.pushRaw(ubx, uby, ubx - tnx * tl, uby - tny * tl, 0.011 * k, SOFT, vis, 0.0016);
      if (i < TEETH.length - 1) {
        const lbx = x - tnx * (dn + 0.6 * step);
        const lby = y - tny * (dn + 0.6 * step);
        details.pushRaw(lbx, lby, lbx + tnx * tl * 0.85, lby + tny * tl * 0.85, 0.01 * k, SOFT, vis, 0.0016);
      }
    }

    // ---- the smile: with the jaw shut, a zigzag of small interlocking teeth
    // along the jaw line (light through a thin cut), the strongest cue that
    // this is a crocodile; it gives way to the big teeth as the jaw opens
    const smile = vis * (1 - clamp01(out * 1.5));
    if (smile > 0.02) {
      let prev: [number, number] | null = null;
      for (let i = 0; i <= SMILE_TEETH; i++) {
        const f = i / SMILE_TEETH;
        const u = SMILE_U[0] + (SMILE_U[1] - SMILE_U[0]) * f;
        // the jaw line: under the upper jaw, turning up a little at the back (the smile)
        const seam = -0.42 * Math.max(topAt(u), 0.012 * k) + 0.012 * k * (1 - f) * (1 - f);
        const zig = (i % 2 === 0 ? 1 : -1) * 0.0075 * k * (1 - 0.3 * f);
        // set a little inside the jaw: a point too near the edge moves up into
        // the head, so the zigzag stays one continuous line
        let q = at(u, seam + zig);
        for (let j = 0; j < 8 && model.distanceToShadow(q[0], q[1], mask) > -0.006 * k; j++) {
          q = [q[0] + px * 0.003 * k, q[1] + py * 0.003 * k];
        }
        if (prev) holes.pushRaw(prev[0], prev[1], q[0], q[1], 0.0021 * k, 0.0015, smile);
        prev = q;
      }
    }

    // ---- the throat: inside the head, behind the jaw and below the eye line
    // (never out along the arm), where swallowed fireflies keep glowing
    let [tx, ty] = at(-0.06, -0.012 * k);
    for (let i = 0; i < 8 && !(model.distanceToShadow(tx, ty, mask) <= -0.02 * k); i++) {
      tx += dx * 0.006 * k;
      ty += dy * 0.006 * k;
    }
    // ---- a catch: a flash in the mouth, then the firefly glows down into the throat
    if (this.flash > 0) {
      glows.push(mx, my, 0.14 * k, 0.8 * this.flash * vis);
      glows.push(mx, my, 0.04 * k, this.flash * vis);
    }
    if (this.gulp < 1) {
      const g = Math.min(1, easeOutBack(this.gulp, 0.6));
      const sx = ox + dx * len * 0.5;
      const sy = oy + dy * len * 0.5;
      glows.push(sx + (tx - sx) * g, sy + (ty - sy) * g, 0.05 * k, 0.8 * (1 - this.gulp * 0.5) * vis);
    }
    // the swallowed fireflies don't go out: the throat glows (one soft warm
    // light, not a speck), bigger and brighter the fuller it is
    if (full > 0) {
      const pulse = 0.85 + 0.15 * Math.sin(time * 2.4);
      // (the first catch lights it as the firefly arrives)
      const settle = this.gulp < 1 && full < 0.2 ? this.gulp : 1;
      glows.push(tx, ty, (0.08 + 0.05 * full) * k, (0.24 + 0.3 * full) * pulse * vis * settle);
      glows.push(tx, ty, (0.04 + 0.015 * full) * k, (0.32 + 0.3 * full) * pulse * vis * settle);
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
