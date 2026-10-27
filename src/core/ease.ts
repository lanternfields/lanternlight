/**
 * Motion helpers shared by every animated element (see STYLE_GUIDE.md §4):
 * easing curves, critically damped springs and smooth noise. Pure functions
 * and tiny classes, no allocation per call.
 */

export const clamp01 = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t);

export const easeInCubic = (t: number): number => {
  t = clamp01(t);
  return t * t * t;
};

export const easeOutCubic = (t: number): number => {
  t = 1 - clamp01(t);
  return 1 - t * t * t;
};

export const easeInOutCubic = (t: number): number => {
  t = clamp01(t);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};

export const easeInOutSine = (t: number): number => -(Math.cos(Math.PI * clamp01(t)) - 1) / 2;

/** Ease out with a little overshoot (things appearing). */
export const easeOutBack = (t: number, s = 1.4): number => {
  t = clamp01(t) - 1;
  return 1 + (s + 1) * t * t * t + s * t * t;
};

/** 0 -> 1 -> 0 over [0,1] with eased ends and a hold in the middle. */
export function pulseHold(t: number, rise = 0.25, fall = 0.25): number {
  t = clamp01(t);
  if (t < rise) return easeInOutCubic(t / rise);
  if (t > 1 - fall) return easeInOutCubic((1 - t) / fall);
  return 1;
}

/**
 * Keyframed loop with holds: `keys` are [time, value] pairs over one period
 * (the first key's time should be 0, the period is `period`), eased in-out
 * between keys. Used for ghost-hint gestures: move, hold, move, hold.
 */
export function keyLoop(time: number, period: number, keys: readonly (readonly [number, number])[]): number {
  const n = keys.length;
  const t = ((time % period) + period) % period;
  for (let i = 0; i < n; i++) {
    const [t0, v0] = keys[i];
    const [t1raw, v1] = keys[(i + 1) % n];
    const t1 = i + 1 < n ? t1raw : period;
    if (t >= t0 && t < t1) return v0 + (v1 - v0) * easeInOutCubic((t - t0) / Math.max(1e-6, t1 - t0));
  }
  return keys[0][1];
}

/**
 * A damped spring toward a target (semi-implicit Euler, stable for dt up to
 * ~0.1 s at the frequencies used here). zeta = 1 is critically damped; < 1
 * overshoots a little (follow-through).
 */
export class Spring {
  value: number;
  velocity = 0;
  constructor(
    value = 0,
    /** Natural frequency (rad/s). */
    public omega = 14,
    /** Damping ratio. */
    public zeta = 1,
  ) {
    this.value = value;
  }

  update(target: number, dt: number): number {
    // sub-step for stability at low frame rates
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const acc = this.omega * this.omega * (target - this.value) - 2 * this.zeta * this.omega * this.velocity;
      this.velocity += acc * h;
      this.value += this.velocity * h;
    }
    return this.value;
  }

  snap(value: number): void {
    this.value = value;
    this.velocity = 0;
  }
}

/** Frame-rate independent exponential approach (ease-out). */
export function approach(v: number, target: number, rate: number, dt: number): number {
  return v + (target - v) * (1 - Math.exp(-rate * dt));
}

// Smooth 1D value noise (C1 continuous), for ambient motion without jitter.
function hash1(i: number): number {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** Smooth noise in [-1, 1]. */
export function smoothNoise(x: number, seed = 0): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  const a = hash1(i + seed * 57.3);
  const b = hash1(i + 1 + seed * 57.3);
  return (a + (b - a) * u) * 2 - 1;
}
