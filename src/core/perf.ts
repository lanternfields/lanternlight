/**
 * Frame-time statistics and the adaptive quality controller.
 *
 * Quest 3 WebXR budget: 13.9 ms at 72 Hz, 11.1 ms at 90 Hz. The controller
 * steps quality down when the p90 frame time stays above the budget and back up
 * after a long stretch of headroom (asymmetric hysteresis, so it never flaps).
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

export const QUALITY_LEVELS: readonly QualityLevel[] = [
  { level: 0, stageResolution: 256, particles: 12, shaderDetail: false, foveation: 1 },
  { level: 1, stageResolution: 384, particles: 24, shaderDetail: true, foveation: 0.75 },
  { level: 2, stageResolution: 512, particles: 48, shaderDetail: true, foveation: 0.5 },
];

export interface AdaptiveOptions {
  /** Frame budget in ms (stepping down above this). */
  budgetMs: number;
  /** Step up only when p90 is below this. */
  headroomMs: number;
  /** Seconds over budget before stepping down. */
  downAfter: number;
  /** Seconds of headroom before stepping up. */
  upAfter: number;
  /** Ignore the first seconds of a session (shader compiles, asset uploads). */
  warmup: number;
}

export const DEFAULT_ADAPTIVE: AdaptiveOptions = {
  budgetMs: 14,
  headroomMs: 10,
  downAfter: 2,
  upAfter: 8,
  warmup: 3,
};

export class AdaptiveQuality {
  level: number;
  readonly stats = new FrameStats(120);
  readonly changes: { t: number; from: number; to: number; p90: number }[] = [];
  private over = 0;
  private under = 0;
  private elapsed = 0;
  private sinceChange = 0;

  constructor(
    public options: AdaptiveOptions = DEFAULT_ADAPTIVE,
    initialLevel = QUALITY_LEVELS.length - 1,
  ) {
    this.level = initialLevel;
  }

  get current(): QualityLevel {
    return QUALITY_LEVELS[this.level];
  }

  /** Feed one frame. Returns true if the level changed. */
  update(frameMs: number, dt: number): boolean {
    this.elapsed += dt;
    this.sinceChange += dt;
    if (this.elapsed < this.options.warmup) return false;
    this.stats.push(frameMs);
    if (this.stats.count < 30) return false;
    const p90 = this.stats.percentile(90);
    if (p90 > this.options.budgetMs) {
      this.over += dt;
      this.under = 0;
    } else if (p90 < this.options.headroomMs) {
      this.under += dt;
      this.over = 0;
    } else {
      this.over = Math.max(0, this.over - dt);
      this.under = Math.max(0, this.under - dt);
    }
    if (this.over >= this.options.downAfter && this.level > 0 && this.sinceChange > 1) {
      this.setLevel(this.level - 1, p90);
      return true;
    }
    if (this.under >= this.options.upAfter && this.level < QUALITY_LEVELS.length - 1) {
      this.setLevel(this.level + 1, p90);
      return true;
    }
    return false;
  }

  private setLevel(to: number, p90: number): void {
    this.changes.push({ t: Math.round(this.elapsed * 10) / 10, from: this.level, to, p90: Math.round(p90 * 100) / 100 });
    this.level = to;
    this.over = 0;
    this.under = 0;
    this.sinceChange = 0;
    this.stats.reset();
  }
}
