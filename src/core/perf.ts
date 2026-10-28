/**
 * Frame-time statistics and the adaptive quality controller.
 *
 * Quest 3 WebXR budget: 13.9 ms at 72 Hz, 11.1 ms at 90 Hz. The controller
 * counts missed vsyncs against the display's real period (see AdaptiveQuality).
 */

export class FrameStats {
  private readonly buf: Float32Array;
  private head = 0;
  count = 0;
  total = 0;
  worst = 0;
  private readonly sorted: Float32Array;

  constructor(public readonly capacity = 240) {
    this.buf = new Float32Array(capacity);
    this.sorted = new Float32Array(capacity);
  }

  push(ms: number): void {
    this.buf[this.head] = ms;
    this.head = (this.head + 1) % this.capacity;
    this.count = Math.min(this.count + 1, this.capacity);
    this.total++;
    if (ms > this.worst) this.worst = ms;
  }

  reset(): void {
    this.head = 0;
    this.count = 0;
    this.worst = 0;
  }

  /** Percentile (0..100) over the window. Sorts a scratch copy (no allocation). */
  percentile(p: number): number {
    const n = this.count;
    if (n === 0) return 0;
    const s = this.sorted.subarray(0, n);
    s.set(this.buf.subarray(0, n));
    s.sort();
    // nearest-rank percentile
    const idx = Math.min(n - 1, Math.max(0, Math.ceil((p / 100) * n) - 1));
    return s[idx];
  }

  mean(): number {
    let sum = 0;
    for (let i = 0; i < this.count; i++) sum += this.buf[i];
    return this.count ? sum / this.count : 0;
  }

  summary(): { n: number; mean: number; p50: number; p90: number; p99: number; worst: number } {
    return {
      n: this.count,
      mean: round2(this.mean()),
      p50: round2(this.percentile(50)),
      p90: round2(this.percentile(90)),
      p99: round2(this.percentile(99)),
      worst: round2(this.worst),
    };
  }
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

export interface QualityLevel {
  level: number;
  /** Offscreen shadow-stage render target size (px, longest side). */
  stageResolution: number;
  /** Max live particles (fireflies trails, dust motes). */
  particles: number;
  /** Paper grain + flicker shader detail. */
  shaderDetail: boolean;
  /** WebXR fixed foveation (0..1). */
  foveation: number;
}

/**
 * Quality only ever trades resolution and foveation: the look (soft edges,
 * paper grain on the scroll) stays the same at every level because the
 * penumbra is specified in stage units.
 */
export const QUALITY_LEVELS: readonly QualityLevel[] = [
  // (sizes cover the stage plus its soft margin: ~490 px per stage unit at the top level)
  { level: 0, stageResolution: 480, particles: 12, shaderDetail: true, foveation: 1 },
  { level: 1, stageResolution: 640, particles: 24, shaderDetail: true, foveation: 0.75 },
  { level: 2, stageResolution: 960, particles: 48, shaderDetail: true, foveation: 0.5 },
  { level: 3, stageResolution: 1280, particles: 48, shaderDetail: true, foveation: 0.35 },
];

export interface AdaptiveOptions {
  /** Fraction of missed vsyncs (smoothed) that counts as "over budget". */
  downMissRate: number;
  /** Fraction of missed vsyncs below which a step up may be tried. */
  upMissRate: number;
  /** Seconds over budget before stepping down. */
  downAfter: number;
  /** Seconds of clean frames before stepping up (doubles after each failed try). */
  upAfter: number;
  /** Ignore the first seconds of a session (shader compiles, asset uploads). */
  warmup: number;
  /** Time constant (s) of the smoothed miss rate. */
  tau: number;
}

export const DEFAULT_ADAPTIVE: AdaptiveOptions = {
  downMissRate: 0.12,
  upMissRate: 0.02,
  downAfter: 1.5,
  upAfter: 6,
  warmup: 3,
  tau: 1.0,
};

/** Common display refresh periods (ms): 120, 90, 80, 72, 60 Hz. */
const PERIODS = [1000 / 120, 1000 / 90, 1000 / 80, 1000 / 72, 1000 / 60];

/** Snaps a measured frame interval to the nearest common refresh period. */
export function snapPeriod(ms: number): number {
  let best = PERIODS[0];
  for (const p of PERIODS) if (Math.abs(p - ms) < Math.abs(best - ms)) best = p;
  return best;
}

/**
 * Adaptive quality from **missed vsyncs**, not raw frame times: a frame counts
 * as missed when its interval exceeds 1.5 display periods. The period comes
 * from the XR session (XRSession.frameRate) when known, otherwise from the
 * fastest recent intervals snapped to a common refresh rate, so ordinary
 * timer jitter at 72/90 Hz never looks like a missed frame.
 *
 * Hysteresis: step down after downAfter s above downMissRate; step up after
 * upAfter s below upMissRate. A level that failed before waits twice as long
 * before it is retried (capped at 60 s), so the controller never flaps.
 */
export class AdaptiveQuality {
  level: number;
  /** Highest level this device may use. */
  maxLevel: number;
  /** Display period in ms (0 = estimate from the frames). */
  periodMs = 0;
  readonly stats = new FrameStats(120);
  readonly changes: { t: number; from: number; to: number; missRate: number }[] = [];
  /** Smoothed fraction of frames that missed vsync. */
  missRate = 0;
  private over = 0;
  private under = 0;
  private elapsed = 0;
  private sinceChange = 0;
  private readonly failures: number[] = QUALITY_LEVELS.map(() => 0);

  constructor(
    public options: AdaptiveOptions = DEFAULT_ADAPTIVE,
    initialLevel = QUALITY_LEVELS.length - 1,
  ) {
    this.level = initialLevel;
    this.maxLevel = QUALITY_LEVELS.length - 1;
  }

  get current(): QualityLevel {
    return QUALITY_LEVELS[this.level];
  }

  /** The period used to judge frames (ms). */
  period(): number {
    if (this.periodMs > 0) return this.periodMs;
    if (this.stats.count < 10) return 1000 / 60;
    return snapPeriod(this.stats.percentile(10));
  }

  /** Clears the measurements (new session, after a pause). */
  reset(): void {
    this.stats.reset();
    this.missRate = 0;
    this.over = 0;
    this.under = 0;
    this.elapsed = 0;
    this.sinceChange = 0;
  }

  /** Feed one frame interval. Returns true if the level changed. */
  update(frameMs: number, dt: number): boolean {
    this.elapsed += dt;
    this.sinceChange += dt;
    if (this.elapsed < this.options.warmup) return false;
    this.stats.push(frameMs);
    if (this.stats.count < 30) return false;
    const o = this.options;
    if (this.level > this.maxLevel) {
      this.setLevel(this.maxLevel);
      return true;
    }
    const missed = frameMs > this.period() * 1.5 ? 1 : 0;
    const a = 1 - Math.exp(-dt / o.tau);
    this.missRate += (missed - this.missRate) * a;
    if (this.missRate > o.downMissRate) {
      this.over += dt;
      this.under = 0;
    } else if (this.missRate < o.upMissRate) {
      this.under += dt;
      this.over = Math.max(0, this.over - dt);
    } else {
      this.over = Math.max(0, this.over - dt);
      this.under = 0;
    }
    if (this.over >= o.downAfter && this.level > 0 && this.sinceChange > 1) {
      this.failures[this.level]++;
      this.setLevel(this.level - 1);
      return true;
    }
    if (this.level < this.maxLevel) {
      const wait = Math.min(60, o.upAfter * Math.pow(2, this.failures[this.level + 1]));
      if (this.under >= wait) {
        this.setLevel(this.level + 1);
        return true;
      }
    }
    return false;
  }

  private setLevel(to: number): void {
    this.changes.push({ t: Math.round(this.elapsed * 10) / 10, from: this.level, to, missRate: Math.round(this.missRate * 100) / 100 });
    this.level = to;
    this.over = 0;
    this.under = 0;
    this.sinceChange = 0;
    // keep the interval history (the period estimate) but restart the miss rate
    this.missRate = 0;
  }
}
