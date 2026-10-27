/**
 * Rotation-invariant hand-shape features and a forgiving pose classifier.
 *
 * Design rule (we cannot tune on a headset): every feature is a ratio of
 * distances measured on the hand itself, so it does not depend on hand size,
 * hand orientation or where the hand is. Thresholds are generous and the
 * classifier uses hysteresis plus a hold time so a jittery joint never flips
 * the result. Core mechanics (shadow position/size, mouth aperture) do not use
 * the classifier at all; it is only used for "discoveries".
 */
import { FINGER_CHAINS, FINGERS, Finger, HandFrame, J } from './hand-model.js';
import { V3, clamp, dist } from './math.js';

export interface HandFeatures {
  /** 0 = fully curled, 1 = fully straight, per finger. */
  extension: Record<Finger, number>;
  /**
   * Thumb tip to the nearer of the index/middle tips, in palm-lengths
   * (~0 pinched/closed .. ~1+ open). Pinch is the most reliably tracked hand
   * gesture on Quest, so closing the crocodile's mouth is simply a pinch.
   */
  aperture: number;
  /** Spread between index and pinky tips relative to palm width (1 = together). */
  spread: number;
  /** Wrist to middle knuckle distance (metres) – the hand's own ruler. */
  palmLength: number;
}

export function createFeatures(): HandFeatures {
  return {
    extension: { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 },
    aperture: 0,
    spread: 1,
    palmLength: 0.09,
  };
}

function chainStraightness(hand: HandFrame, chain: readonly number[]): number {
  let along = 0;
  for (let i = 1; i < chain.length; i++) {
    along += dist(hand.joints[chain[i - 1]], hand.joints[chain[i]]);
  }
  if (along < 1e-6) return 0;
  const direct = dist(hand.joints[chain[0]], hand.joints[chain[chain.length - 1]]);
  return direct / along;
}

/**
 * Maps raw straightness (direct/along ratio) to 0..1 extension.
 * A fist is ~0.35-0.55, a straight finger ~0.97+. Thumb has its own range
 * because its chain starts at the metacarpal.
 */
function toExtension(f: Finger, straightness: number): number {
  const lo = f === 'thumb' ? 0.78 : 0.55;
  const hi = f === 'thumb' ? 0.96 : 0.93;
  return clamp((straightness - lo) / (hi - lo), 0, 1);
}

export function computeFeatures(hand: HandFrame, out: HandFeatures): HandFeatures {
  for (const f of FINGERS) {
    out.extension[f] = toExtension(f, chainStraightness(hand, FINGER_CHAINS[f]));
  }
  const j = hand.joints;
  out.palmLength = Math.max(0.04, dist(j[J.wrist], j[J.middleProx]));
  out.aperture =
    Math.min(dist(j[J.thumbTip], j[J.indexTip]), dist(j[J.thumbTip], j[J.middleTip])) / out.palmLength;
  const palmWidth = Math.max(0.02, dist(j[J.indexProx], j[J.pinkyProx]));
  out.spread = dist(j[J.indexTip], j[J.pinkyTip]) / palmWidth;
  return out;
}

/** Shapes the stories understand. */
export type PoseId =
  | 'none'
  | 'open'
  | 'fist'
  | 'rabbit'
  | 'point'
  | 'horns'
  | 'call';
// ('claw' was dropped: on captured skeletons a hooked finger is not separable
// from a straight one by distance ratios, and no story beat needs it.)

interface Template {
  id: PoseId;
  /** Target extension per finger [thumb, index, middle, ring, pinky]; NaN = don't care. */
  ext: readonly number[];
  /** Optional minimum aperture (fingertips must be apart from the thumb). */
  minAperture?: number;
}

const TEMPLATES: readonly Template[] = [
  { id: 'open', ext: [1, 1, 1, 1, 1] },
  { id: 'fist', ext: [NaN, 0, 0, 0, 0] },
  // Rabbit ears must not touch the thumb (rules out tripod/beak grips).
  { id: 'rabbit', ext: [NaN, 1, 1, 0, 0], minAperture: 0.6 },
  { id: 'point', ext: [NaN, 1, 0, 0, 0] },
  { id: 'horns', ext: [NaN, 1, 0, 0, 1] },
  { id: 'call', ext: [1, 0, 0, 0, 1] },
];

export interface PoseScore {
  id: PoseId;
  /** Mean absolute deviation from the template, 0 = perfect. */
  error: number;
}

const SCORE_VALUES = [0, 0, 0, 0, 0];
const byError = (a: PoseScore, b: PoseScore): number => a.error - b.error;

export function scorePoses(features: HandFeatures, out: PoseScore[]): PoseScore[] {
  const e = features.extension;
  const values = SCORE_VALUES;
  values[0] = e.thumb;
  values[1] = e.index;
  values[2] = e.middle;
  values[3] = e.ring;
  values[4] = e.pinky;
  // reuse the score objects (this runs every frame per hand)
  while (out.length < TEMPLATES.length) out.push({ id: 'none', error: 0 });
  out.length = TEMPLATES.length;
  let k = 0;
  for (const t of TEMPLATES) {
    let sum = 0;
    let n = 0;
    let worst = 0;
    for (let i = 0; i < 5; i++) {
      const target = t.ext[i];
      if (Number.isNaN(target)) continue;
      const d = Math.abs(values[i] - target);
      sum += d;
      worst = Math.max(worst, d);
      n++;
    }
    // Blend mean and worst so one badly mis-tracked finger cannot match a
    // template the rest of the hand clearly disagrees with.
    let error = 0.6 * (sum / n) + 0.4 * worst;
    if (t.minAperture !== undefined && features.aperture < t.minAperture) {
      error += (t.minAperture - features.aperture) * 1.5;
    }
    const slot = out[k++];
    slot.id = t.id;
    slot.error = error;
  }
  out.sort(byError);
  return out;
}

export interface ClassifierOptions {
  /** Max error to accept a pose. Larger = more forgiving. */
  acceptError: number;
  /** Error must stay under acceptError + hysteresis to keep a held pose. */
  hysteresis: number;
  /** Seconds a candidate pose must persist before it is reported. */
  holdTime: number;
  /** Required gap between the best and second-best template. */
  margin: number;
}

export const DEFAULT_CLASSIFIER: ClassifierOptions = {
  acceptError: 0.3,
  hysteresis: 0.12,
  holdTime: 0.3,
  margin: 0.05,
};

export const GENTLE_CLASSIFIER: ClassifierOptions = {
  acceptError: 0.4,
  hysteresis: 0.15,
  holdTime: 0.2,
  margin: 0.02,
};

/** Stateful pose detector with hysteresis and hold time. */
export class PoseClassifier {
  current: PoseId = 'none';
  private candidate: PoseId = 'none';
  private candidateTime = 0;
  private scores: PoseScore[] = [];
  constructor(public options: ClassifierOptions = DEFAULT_CLASSIFIER) {}

  reset(): void {
    this.current = 'none';
    this.candidate = 'none';
    this.candidateTime = 0;
  }

  update(features: HandFeatures | null, dt: number): PoseId {
    if (!features) {
      this.reset();
      return this.current;
    }
    const o = this.options;
    const scores = scorePoses(features, this.scores);
    // Keep the current pose while it is still within the hysteresis band.
    if (this.current !== 'none') {
      let cur: PoseScore | undefined;
      for (const sc of scores) if (sc.id === this.current) cur = sc;
      if (cur && cur.error <= o.acceptError + o.hysteresis) {
        this.candidate = this.current;
        this.candidateTime = 0;
        return this.current;
      }
    }
    const best = scores[0];
    const second = scores[1];
    let next: PoseId = 'none';
    if (best && best.error <= o.acceptError && (!second || second.error - best.error >= o.margin)) {
      next = best.id;
    }
    if (next !== this.candidate) {
      this.candidate = next;
      this.candidateTime = 0;
    } else {
      this.candidateTime += dt;
    }
    if (this.candidateTime >= o.holdTime || next === 'none') {
      if (next === 'none' && this.candidateTime < o.holdTime * 0.5) {
        return this.current;
      }
      this.current = next;
    }
    return this.current;
  }
}

/**
 * Mouth (aperture) state with hysteresis for the crocodile: reports `open`
 * above `openAt` and `closed` below `closeAt`; between them the previous state
 * is kept. The gap is wide on purpose (tracking noise is ~5-8 mm).
 */
export class MouthDetector {
  open = false;
  /** Smoothed 0..1 openness for animation. */
  openness = 0;
  constructor(
    public openAt = 0.75,
    public closeAt = 0.42,
  ) {}
  update(aperture: number, dt: number): { opened: boolean; closed: boolean } {
    const target = clamp((aperture - this.closeAt) / (this.openAt - this.closeAt), 0, 1);
    this.openness += (target - this.openness) * (1 - Math.exp(-18 * dt));
    let opened = false;
    let closed = false;
    if (!this.open && aperture >= this.openAt) {
      this.open = true;
      opened = true;
    } else if (this.open && aperture <= this.closeAt) {
      this.open = false;
      closed = true;
    }
    return { opened, closed };
  }
}
