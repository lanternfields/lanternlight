/**
 * WebXR hand skeleton layout (25 joints, in XRHand iteration order) and the
 * bone list used to build a hand's shadow silhouette.
 * Spec: https://www.w3.org/TR/webxr-hand-input-1/#skeleton-joints-section
 */
import { V3 } from './math.js';

export const JOINT_NAMES = [
  'wrist',
  'thumb-metacarpal',
  'thumb-phalanx-proximal',
  'thumb-phalanx-distal',
  'thumb-tip',
  'index-finger-metacarpal',
  'index-finger-phalanx-proximal',
  'index-finger-phalanx-intermediate',
  'index-finger-phalanx-distal',
  'index-finger-tip',
  'middle-finger-metacarpal',
  'middle-finger-phalanx-proximal',
  'middle-finger-phalanx-intermediate',
  'middle-finger-phalanx-distal',
  'middle-finger-tip',
  'ring-finger-metacarpal',
  'ring-finger-phalanx-proximal',
  'ring-finger-phalanx-intermediate',
  'ring-finger-phalanx-distal',
  'ring-finger-tip',
  'pinky-finger-metacarpal',
  'pinky-finger-phalanx-proximal',
  'pinky-finger-phalanx-intermediate',
  'pinky-finger-phalanx-distal',
  'pinky-finger-tip',
] as const;

export const JOINT_COUNT = 25;

export const J = {
  wrist: 0,
  thumbMeta: 1,
  thumbProx: 2,
  thumbDist: 3,
  thumbTip: 4,
  indexMeta: 5,
  indexProx: 6,
  indexInter: 7,
  indexDist: 8,
  indexTip: 9,
  middleMeta: 10,
  middleProx: 11,
  middleInter: 12,
  middleDist: 13,
  middleTip: 14,
  ringMeta: 15,
  ringProx: 16,
  ringInter: 17,
  ringDist: 18,
  ringTip: 19,
  pinkyMeta: 20,
  pinkyProx: 21,
  pinkyInter: 22,
  pinkyDist: 23,
  pinkyTip: 24,
} as const;

export type Finger = 'thumb' | 'index' | 'middle' | 'ring' | 'pinky';
export const FINGERS: readonly Finger[] = [
  'thumb',
  'index',
  'middle',
  'ring',
  'pinky',
];

/** Joint chains from the knuckle (proximal) to the tip for each finger. */
export const FINGER_CHAINS: Record<Finger, readonly number[]> = {
  thumb: [J.thumbMeta, J.thumbProx, J.thumbDist, J.thumbTip],
  index: [J.indexProx, J.indexInter, J.indexDist, J.indexTip],
  middle: [J.middleProx, J.middleInter, J.middleDist, J.middleTip],
  ring: [J.ringProx, J.ringInter, J.ringDist, J.ringTip],
  pinky: [J.pinkyProx, J.pinkyInter, J.pinkyDist, J.pinkyTip],
};

/**
 * Bones drawn as capsules for the shadow. Each pair is [jointA, jointB].
 * Palm bones are included so the silhouette stays solid even when the palm
 * polygon is seen edge-on.
 */
export const SHADOW_BONES: readonly (readonly [number, number])[] = [
  // thumb
  [J.wrist, J.thumbMeta],
  [J.thumbMeta, J.thumbProx],
  [J.thumbProx, J.thumbDist],
  [J.thumbDist, J.thumbTip],
  // palm rays
  [J.wrist, J.indexProx],
  [J.wrist, J.middleProx],
  [J.wrist, J.ringProx],
  [J.wrist, J.pinkyProx],
  [J.indexProx, J.middleProx],
  [J.middleProx, J.ringProx],
  [J.ringProx, J.pinkyProx],
  [J.thumbMeta, J.indexProx],
  // fingers
  [J.indexProx, J.indexInter],
  [J.indexInter, J.indexDist],
  [J.indexDist, J.indexTip],
  [J.middleProx, J.middleInter],
  [J.middleInter, J.middleDist],
  [J.middleDist, J.middleTip],
  [J.ringProx, J.ringInter],
  [J.ringInter, J.ringDist],
  [J.ringDist, J.ringTip],
  [J.pinkyProx, J.pinkyInter],
  [J.pinkyInter, J.pinkyDist],
  [J.pinkyDist, J.pinkyTip],
];

/** Convex-ish palm outline (filled) used under the bone capsules. */
export const PALM_POLYGON: readonly number[] = [
  J.wrist,
  J.thumbMeta,
  J.indexProx,
  J.middleProx,
  J.ringProx,
  J.pinkyProx,
];

/** Fallback joint radii (metres) when the runtime does not report radii. */
export const DEFAULT_RADII: readonly number[] = [
  0.021, // wrist
  0.019, 0.013, 0.011, 0.009, // thumb
  0.021, 0.011, 0.009, 0.008, 0.007, // index
  0.021, 0.011, 0.009, 0.008, 0.007, // middle
  0.019, 0.010, 0.008, 0.007, 0.006, // ring
  0.018, 0.009, 0.008, 0.007, 0.006, // pinky
];

/** One tracked hand in world space. */
export interface HandFrame {
  handedness: 'left' | 'right';
  tracked: boolean;
  joints: V3[];
  radii: Float32Array;
}

export function createHandFrame(handedness: 'left' | 'right'): HandFrame {
  const joints: V3[] = [];
  for (let i = 0; i < JOINT_COUNT; i++) joints.push(new V3());
  const radii = new Float32Array(JOINT_COUNT);
  radii.set(DEFAULT_RADII);
  return { handedness, tracked: false, joints, radii };
}
