/**
 * Paper crocodiles (STYLE_GUIDE 1): the open-jawed side profile used on the
 * title card and the hub medallion, and the full crocodile floating low in
 * the river at the close of tale I, its swallowed fireflies glowing in its
 * throat through a cut-out window (the "night-light"). Facing +x.
 */
import { Group, Mesh, ShaderMaterial, ShapeGeometry } from '@iwsdk/core';
import { CH_CUTOUT, CH_HOLE, createFlatMaterial } from './materials.js';
import { circleShape, pathGeometry, pathShapes } from './paths.js';
import { NIGHT_CROC_SCALE } from '../core/story.js';

/** A crocodile head, jaws open, facing right (stage units, ~0.34 long). */
export const CROC_HEAD = [
  'M -0.17 0.010 Q -0.12 0.030 -0.085 0.045 Q -0.068 0.084 -0.036 0.074 Q -0.016 0.068 -0.004 0.050',
  'L 0.030 0.046 Q 0.045 0.053 0.060 0.045 L 0.100 0.040 Q 0.124 0.054 0.140 0.047',
  'Q 0.163 0.041 0.166 0.026 Q 0.167 0.013 0.150 0.010 L -0.030 -0.002',
  'L 0.118 -0.060 Q 0.140 -0.068 0.134 -0.082 Q 0.040 -0.066 -0.050 -0.040',
  'Q -0.110 -0.030 -0.170 -0.030 Q -0.196 -0.010 -0.170 0.010 Z',
].join(' ');
/** Where its eye hole goes. */
export const CROC_HEAD_EYE: readonly [number, number, number] = [-0.043, 0.057, 0.0095];

function upperJawY(x: number): number {
  return -0.002 + ((x + 0.03) / 0.18) * 0.012;
}
function lowerJawY(x: number): number {
  return -0.002 - ((x + 0.03) / 0.148) * 0.058;
}
function topY(x: number): number {
  return 0.01 + ((x + 0.17) / 0.085) * 0.035;
}

/** Bold teeth along both jaws and scutes along the back of the neck. */
export function crocTeeth(): string {
  const parts: string[] = [];
  for (const [x, len] of [
    [0.0, 0.014],
    [0.03, 0.017],
    [0.06, 0.016],
    [0.09, 0.017],
    [0.125, 0.021],
  ]) {
    const y = upperJawY(x) + 0.003;
    parts.push(`M ${x - 0.009} ${y} L ${x + 0.009} ${y} L ${x + 0.001} ${y - len} Z`);
  }
  for (const [x, len] of [
    [0.012, 0.013],
    [0.042, 0.016],
    [0.072, 0.016],
    [0.1, 0.018],
  ]) {
    const y = lowerJawY(x) - 0.003;
    parts.push(`M ${x - 0.008} ${y} L ${x + 0.008} ${y} L ${x - 0.001} ${y + len} Z`);
  }
  for (const x of [-0.158, -0.132, -0.106]) {
    const y = topY(x) - 0.003;
    parts.push(`M ${x - 0.012} ${y} L ${x + 0.01} ${y} L ${x - 0.003} ${y + 0.02} Z`);
  }
  return parts.join(' ');
}

/** The open-jawed head as a cut-out with its eye hole (a medallion or card emblem). */
export function createCrocHead(): { group: Group; materials: ShaderMaterial[] } {
  const cut = createFlatMaterial(CH_CUTOUT, 1);
  const hole = createFlatMaterial(CH_HOLE, 1);
  const group = new Group();
  group.add(new Mesh(pathGeometry(CROC_HEAD + ' ' + crocTeeth(), 12), cut));
  const [ex, ey, er] = CROC_HEAD_EYE;
  group.add(new Mesh(new ShapeGeometry(circleShape(ex, ey, er, 20), 1), hole));
  return { group, materials: [cut, hole] };
}

// The full crocodile floating in the river, in side profile, unmistakable at
// a glance: a long tail rising to a ridged back, the raised eye bump, and a
// long, flat snout with a nostril bump and a smiling mouth line. The water
// line is y = 0; below it the cut-out runs on under the water.
const FLOATING =
  'M -0.165 0.002 Q -0.14 0.01 -0.11 0.016 Q -0.07 0.024 -0.035 0.034 Q -0.005 0.044 0.02 0.04 ' +
  'Q 0.034 0.037 0.044 0.046 Q 0.054 0.066 0.068 0.062 Q 0.08 0.056 0.09 0.046 ' +
  'L 0.148 0.036 Q 0.156 0.045 0.165 0.04 Q 0.177 0.034 0.172 0.025 Q 0.166 0.016 0.152 0.013 ' +
  'Q 0.11 0.006 0.084 0.0 L 0.084 -0.03 L -0.165 -0.03 Z';
/** Height of the back's top edge at x (piecewise linear through the outline's points). */
function floatBackY(x: number): number {
  const pts: readonly (readonly [number, number])[] = [
    [-0.165, 0.002],
    [-0.11, 0.016],
    [-0.035, 0.034],
    [0.0, 0.042],
    [0.02, 0.04],
  ];
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    if (x <= x1) return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
  }
  return pts[pts.length - 1][1];
}
// a bold ridge of scutes along the back and the root of the tail
const FLOAT_SCUTES = (() => {
  const parts: string[] = [];
  for (const [x, h] of [
    [-0.125, 0.009],
    [-0.098, 0.012],
    [-0.07, 0.015],
    [-0.042, 0.017],
    [-0.014, 0.017],
    [0.012, 0.013],
  ]) {
    const y = floatBackY(x) - 0.004;
    parts.push(`M ${x - 0.011} ${y} L ${x + 0.009} ${y} L ${x - 0.003} ${y + h} Z`);
  }
  return parts.join(' ');
})();
// the mouth line: a thin cut along the snout that turns up at the back (a smile)
const FLOAT_MOUTH = 'M 0.088 0.0255 Q 0.11 0.0175 0.163 0.0195 L 0.163 0.0235 Q 0.112 0.022 0.091 0.0295 Z';
/** Drawing scale of the floating crocodile. */
const NIGHT_K = NIGHT_CROC_SCALE;
/** The lit window in its throat (behind the jaw, under the eye bump), in stage units at that scale. */
export const NIGHT_CROC_THROAT: readonly [number, number] = [0.05 * NIGHT_K, 0.02 * NIGHT_K];

/** The night-light crocodile: a floating cut-out with an eye hole and a lit throat window. */
export class NightCroc {
  readonly group = new Group();
  private readonly materials: ShaderMaterial[];
  constructor() {
    const cut = createFlatMaterial(CH_CUTOUT, 1);
    const hole = createFlatMaterial(CH_HOLE, 1);
    this.group.add(new Mesh(new ShapeGeometry(pathShapes(FLOATING + ' ' + FLOAT_SCUTES), 10), cut));
    this.group.add(new Mesh(new ShapeGeometry(circleShape(0.062, 0.054, 0.0065, 16), 1), hole));
    this.group.add(new Mesh(new ShapeGeometry(pathShapes(FLOAT_MOUTH), 8), hole));
    const win = new Mesh(new ShapeGeometry(circleShape(0, 0, 1, 24), 1), hole);
    win.position.set(NIGHT_CROC_THROAT[0] / NIGHT_K, NIGHT_CROC_THROAT[1] / NIGHT_K, 0);
    win.scale.set(0.024, 0.012, 1);
    this.group.add(win);
    this.materials = [cut, hole];
    this.group.visible = false;
  }

  update(x: number, y: number, dir: number, visible: number, time: number, calm: boolean): void {
    this.group.visible = visible > 0.02;
    if (!this.group.visible) return;
    // a lazy bob on the current
    const bob = calm ? 0 : Math.sin(time * 1.6) * 0.003;
    this.group.position.set(x, y + bob, 0);
    this.group.scale.set(dir * NIGHT_K, NIGHT_K, 1);
    this.group.rotation.z = calm ? 0 : Math.sin(time * 1.1 + 0.6) * 0.02;
    for (const m of this.materials) m.uniforms.uStrength.value = visible;
  }
}
