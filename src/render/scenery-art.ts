/**
 * Set dressing drawn in the same capsule language as everything else
 * (STYLE_GUIDE §1): reeds and bulrushes swaying on the riverbanks, lily pads
 * bobbing on the water, firefly reflections on the river, stars over the
 * wolf's meadow, and the warm doorway of the rabbit's burrow. Pure decoration:
 * nothing here takes part in physics.
 */
import type { CapsuleSink, GlowSink } from './croc-overlay.js';
import { keyLoop, smoothNoise } from '../core/ease.js';

const SOFT = 0.0035;

interface Reed {
  x: number;
  h: number;
  lean: number;
  head: boolean;
  seed: number;
}

const REEDS: readonly Reed[] = [
  { x: -0.735, h: 0.25, lean: 0.02, head: true, seed: 1 },
  { x: -0.7, h: 0.31, lean: 0.035, head: true, seed: 2 },
  { x: -0.665, h: 0.2, lean: 0.045, head: false, seed: 3 },
  { x: -0.62, h: 0.24, lean: 0.06, head: true, seed: 4 },
  { x: -0.585, h: 0.15, lean: 0.05, head: false, seed: 5 },
  // the far bank leaves a gap in its reeds where Pip sits and watches (x ~0.64)
  { x: 0.552, h: 0.21, lean: -0.035, head: true, seed: 6 },
  { x: 0.578, h: 0.15, lean: -0.05, head: false, seed: 7 },
  { x: 0.712, h: 0.3, lean: -0.03, head: true, seed: 8 },
  { x: 0.742, h: 0.22, lean: -0.02, head: true, seed: 9 },
  { x: 0.772, h: 0.17, lean: -0.02, head: false, seed: 10 },
];

/** Reeds, bulrushes and arching leaves rooted at `base` (stage t). */
export function drawReeds(out: CapsuleSink, base: number, time: number, calm: boolean, strength: number): void {
  for (const r of REEDS) {
    const sway = calm ? 0 : smoothNoise(time * 0.45 + r.seed * 3.1, r.seed) * 0.012 + Math.sin(time * 0.9 + r.seed) * 0.004;
    const x0 = r.x;
    const y0 = base;
    // a gently curved stem: two segments, the upper one swaying more
    const mx = x0 + r.lean * 0.4 + sway * 0.35;
    const my = y0 + r.h * 0.55;
    const tx = x0 + r.lean + sway;
    const ty = y0 + r.h;
    out.pushRaw(x0, y0, mx, my, 0.0042, SOFT, strength, 0.0034);
    out.pushRaw(mx, my, tx, ty, 0.0034, SOFT, strength, 0.0016);
    if (r.head) {
      // bulrush seed head: a fat soft cigar just below the tip
      const hx0 = mx + (tx - mx) * 0.45;
      const hy0 = my + (ty - my) * 0.45;
      const hx1 = mx + (tx - mx) * 0.82;
      const hy1 = my + (ty - my) * 0.82;
      out.pushRaw(hx0, hy0, hx1, hy1, 0.0105, SOFT, strength, 0.0095);
    }
    // one long leaf arching away from the stem
    const side = r.lean >= 0 ? -1 : 1;
    const lx = x0 + side * r.h * 0.22 + sway * 0.6;
    const ly = y0 + r.h * 0.5;
    const lx2 = lx + side * r.h * 0.18 + sway;
    const ly2 = ly + r.h * 0.12;
    out.pushRaw(x0, y0, lx, ly, 0.005, SOFT, strength, 0.0035);
    out.pushRaw(lx, ly, lx2, ly2, 0.0035, SOFT, strength, 0.0008);
  }
}

const PADS = [-0.34, -0.08, 0.2, 0.42];

/** Lily pads (flat, bobbing) and one closed lotus bud on the water line. */
export function drawLilies(out: CapsuleSink, waterY: number, time: number, calm: boolean, strength: number): void {
  for (let i = 0; i < PADS.length; i++) {
    const bob = calm ? 0 : Math.sin(time * 1.3 + i * 1.9) * 0.003;
    const x = PADS[i] + (calm ? 0 : smoothNoise(time * 0.2 + i, 20 + i) * 0.01);
    const y = waterY + 0.004 + bob;
    const w = 0.032 + (i % 2) * 0.01;
    out.pushRaw(x - w, y, x + w, y + 0.002, 0.0055, SOFT, strength, 0.0065);
    if (i === 1) {
      // a lotus bud on a short stalk
      out.pushRaw(x + 0.006, y, x + 0.01, y + 0.03, 0.0026, SOFT, strength, 0.002);
      out.pushRaw(x + 0.01, y + 0.03, x + 0.012, y + 0.05, 0.0085, SOFT, strength, 0.0022);
      out.pushRaw(x + 0.01, y + 0.03, x - 0.002, y + 0.046, 0.006, SOFT, strength, 0.0016);
      out.pushRaw(x + 0.012, y + 0.03, x + 0.024, y + 0.045, 0.006, SOFT, strength, 0.0016);
    }
  }
}

/** Firefly light, readable at a glance: a hot core, a soft halo and a slow blink. */
export function drawFirefly(glows: GlowSink, x: number, y: number, glow: number, index: number, time: number, calm: boolean): void {
  const blink = calm ? 1 : keyLoop(time + index * 0.73, 2.6, FIREFLY_BLINK);
  const a = glow * blink;
  // 2.5x the old size: a soft halo, a bright body and a white-hot core
  glows.push(x, y, 0.17, 0.3 * a);
  glows.push(x, y, 0.06, 0.8 * a);
  glows.push(x, y, 0.024, 1.0 * a);
}

/** Lamplight rippling on the water between two banks (the bridge tale's gap). */
export function drawRipples(glows: GlowSink, s0: number, s1: number, waterY: number, time: number, calm: boolean, strength: number): void {
  if (strength <= 0.02) return;
  const n = 9;
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n;
    const drift = calm ? 0 : Math.sin(time * 0.6 + i * 2.3) * 0.012;
    const x = s0 + (s1 - s0) * u + drift;
    const y = waterY + 0.012 + (calm ? 0 : Math.sin(time * 2.1 + i * 1.7) * 0.003) + (i % 3) * 0.009;
    const tw = calm ? 0.8 : 0.55 + 0.45 * Math.sin(time * 3.1 + i * 1.9);
    // a short horizontal glint: two overlapping dots
    glows.push(x - 0.012, y, 0.016, 0.34 * tw * strength);
    glows.push(x + 0.012, y, 0.016, 0.34 * tw * strength);
  }
}
const FIREFLY_BLINK: readonly (readonly [number, number])[] = [
  [0, 1],
  [1.6, 1],
  [1.95, 0.45],
  [2.25, 1],
];

/** A firefly's reflection on the river, stretched by the ripples. */
export function drawReflection(glows: GlowSink, x: number, waterY: number, glow: number, height: number, time: number): void {
  const k = Math.max(0, 1 - (height - waterY) / 0.6);
  if (k <= 0.02) return;
  const shimmer = 0.7 + 0.3 * Math.sin(time * 5.1 + x * 31);
  for (let i = -1; i <= 1; i++) glows.push(x + i * 0.014, waterY - 0.018, 0.016, 0.22 * glow * k * shimmer * (i === 0 ? 1 : 0.6));
}

const STARS: readonly [number, number, number][] = [
  [-0.6, 0.42, 0.9],
  [-0.44, 0.36, 0.6],
  [-0.27, 0.44, 0.8],
  [-0.1, 0.39, 0.5],
  [0.08, 0.45, 0.7],
  [0.22, 0.4, 0.55],
  [0.62, 0.41, 0.75],
  [-0.66, 0.28, 0.45],
];

/** A few soft twinkling stars over the meadow. */
export function drawStars(glows: GlowSink, visible: number, time: number, calm: boolean): void {
  if (visible <= 0.02) return;
  for (let i = 0; i < STARS.length; i++) {
    const [x, y, b] = STARS[i];
    const tw = calm ? 1 : 0.65 + 0.35 * (0.5 + 0.5 * smoothNoise(time * 0.8 + i * 2.3, 40 + i));
    glows.push(x, y, 0.014, b * 0.55 * tw * visible);
  }
}

/** The burrow's doorway: a hole through the mound with warm light inside. */
export function drawBurrowDoor(holes: CapsuleSink, glows: GlowSink, s: number, t: number, visible: number, time: number, calm: boolean): void {
  if (visible <= 0.02) return;
  holes.pushRaw(s - 0.004, t + 0.012, s + 0.004, t + 0.012, 0.017, 0.003, visible);
  const flick = calm ? 1 : 0.85 + 0.15 * smoothNoise(time * 3, 77);
  glows.push(s, t + 0.012, 0.035, 0.55 * flick * visible);
}
