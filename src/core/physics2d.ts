/**
 * Minimal 2D "shadow ground" physics: stage-space capsules (hand shadows and
 * scenery) are solid from above. Small creatures stand on them, ride them, and
 * fall off them. Everything is analytic and allocation free.
 */
import { Capsule2D } from './shadow-model.js';

export interface Interval {
  lo: number;
  hi: number;
}

/**
 * Vertical extent of a capsule at column x (the intersection of the vertical
 * line with the capsule is convex, so it is a single interval).
 * Returns false when the column misses the capsule.
 */
export function capsuleColumn(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  r: number,
  x: number,
  out: Interval,
): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  if (Math.abs(dx) < 1e-9) {
    const u = x - ax;
    if (Math.abs(u) > r) return false;
    const h = Math.sqrt(r * r - u * u);
    out.hi = Math.max(ay, by) + h;
    out.lo = Math.min(ay, by) - h;
    return true;
  }
  // Domain of t where the column is within r of the segment's x-projection.
  let t0 = (x - r - ax) / dx;
  let t1 = (x + r - ax) / dx;
  if (t0 > t1) {
    const tmp = t0;
    t0 = t1;
    t1 = tmp;
  }
  t0 = Math.max(0, t0);
  t1 = Math.min(1, t1);
  if (t0 > t1) return false;
  const m = dy / dx;
  const k = (r * m) / Math.sqrt(1 + m * m);
  const evalTop = (t: number): number => {
    const u = x - ax - t * dx;
    const s = r * r - u * u;
    return ay + t * dy + Math.sqrt(s > 0 ? s : 0);
  };
  const evalBot = (t: number): number => {
    const u = x - ax - t * dx;
    const s = r * r - u * u;
    return ay + t * dy - Math.sqrt(s > 0 ? s : 0);
  };
  const clampT = (t: number): number => (t < t0 ? t0 : t > t1 ? t1 : t);
  // Maximiser of the top boundary: u* = -k ; minimiser of the bottom: u* = +k.
  const tTop = clampT((x - ax + k) / dx);
  const tBot = clampT((x - ax - k) / dx);
  out.hi = evalTop(tTop);
  out.lo = evalBot(tBot);
  return true;
}

export interface Ground {
  /** Height of the supporting surface (stage units), -Infinity if none. */
  y: number;
  /** Which capsule supports (index into the combined list), -1 if none. */
  source: number;
  /** True if the support is a shadow (hand / puppet), false if scenery. */
  isShadow: boolean;
}

const _iv: Interval = { lo: 0, hi: 0 };

/**
 * Highest support at column x whose top is at or below `maxY`.
 * Shapes whose interval straddles maxY are treated as support only if their
 * top is within `stepUp` above maxY (we pop onto them), otherwise ignored.
 */
export function groundAt(
  x: number,
  maxY: number,
  scenery: readonly Capsule2D[],
  sceneryCount: number,
  shadows: readonly Capsule2D[],
  shadowCount: number,
  out: Ground,
  stepUp = 0.0,
): Ground {
  out.y = -Infinity;
  out.source = -1;
  out.isShadow = false;
  const limit = maxY + stepUp;
  for (let i = 0; i < sceneryCount; i++) {
    const c = scenery[i];
    if (!capsuleColumn(c.ax, c.ay, c.bx, c.by, c.r, x, _iv)) continue;
    if (_iv.hi <= limit && _iv.hi > out.y) {
      out.y = _iv.hi;
      out.source = i;
      out.isShadow = false;
    }
  }
  for (let i = 0; i < shadowCount; i++) {
    const c = shadows[i];
    // Only the hand (or puppet) is ground; the forearm's shadow is scenery-free.
    if (c.forearm) continue;
    if (!capsuleColumn(c.ax, c.ay, c.bx, c.by, c.r * 0.92, x, _iv)) continue;
    if (_iv.hi <= limit && _iv.hi > out.y) {
      out.y = _iv.hi;
      out.source = i;
      out.isShadow = true;
    }
  }
  return out;
}

/** Simple ballistic hop path: parabola from (x0,y0) to (x1,y1) with apex lift. */
export function hopPosition(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  lift: number,
  u: number,
  out: { x: number; y: number },
): { x: number; y: number } {
  const t = u < 0 ? 0 : u > 1 ? 1 : u;
  out.x = x0 + (x1 - x0) * t;
  out.y = y0 + (y1 - y0) * t + 4 * lift * t * (1 - t);
  return out;
}
