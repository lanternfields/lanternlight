/**
 * Tiny allocation-free vector helpers for the pure core modules.
 *
 * The core (src/core) deliberately does not import Three.js so it can be unit
 * tested in Node and reasoned about in isolation. Hot paths take `out`
 * parameters and never allocate.
 */

export class V3 {
  constructor(
    public x = 0,
    public y = 0,
    public z = 0,
  ) {}
  set(x: number, y: number, z: number): this {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }
  copy(v: Readonly<V3>): this {
    this.x = v.x;
    this.y = v.y;
    this.z = v.z;
    return this;
  }
  clone(): V3 {
    return new V3(this.x, this.y, this.z);
  }
}

export interface V2 {
  x: number;
  y: number;
}

export function v3(x = 0, y = 0, z = 0): V3 {
  return new V3(x, y, z);
}

export function add(out: V3, a: Readonly<V3>, b: Readonly<V3>): V3 {
  out.x = a.x + b.x;
  out.y = a.y + b.y;
  out.z = a.z + b.z;
  return out;
}

export function sub(out: V3, a: Readonly<V3>, b: Readonly<V3>): V3 {
  out.x = a.x - b.x;
  out.y = a.y - b.y;
  out.z = a.z - b.z;
  return out;
}

export function scale(out: V3, a: Readonly<V3>, s: number): V3 {
  out.x = a.x * s;
  out.y = a.y * s;
  out.z = a.z * s;
  return out;
}

/** out = a + b * s */
export function addScaled(
  out: V3,
  a: Readonly<V3>,
  b: Readonly<V3>,
  s: number,
): V3 {
  out.x = a.x + b.x * s;
  out.y = a.y + b.y * s;
  out.z = a.z + b.z * s;
  return out;
}

export function dot(a: Readonly<V3>, b: Readonly<V3>): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(out: V3, a: Readonly<V3>, b: Readonly<V3>): V3 {
  const x = a.y * b.z - a.z * b.y;
  const y = a.z * b.x - a.x * b.z;
  const z = a.x * b.y - a.y * b.x;
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
}

export function length(a: Readonly<V3>): number {
  return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
}

export function dist(a: Readonly<V3>, b: Readonly<V3>): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function normalize(out: V3, a: Readonly<V3>): V3 {
  const l = length(a);
  if (l < 1e-9) {
    out.x = 0;
    out.y = 0;
    out.z = 0;
    return out;
  }
  return scale(out, a, 1 / l);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Frame-rate independent exponential smoothing factor. */
export function damp(lambda: number, dt: number): number {
  return 1 - Math.exp(-lambda * dt);
}

export function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Distance from point p to segment ab in 2D. */
export function pointSegmentDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 1e-12 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = clamp(t, 0, 1);
  return dist2(px, py, ax + dx * t, ay + dy * t);
}

/** Deterministic small PRNG (mulberry32) so tales and tests are repeatable. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
