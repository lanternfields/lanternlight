/**
 * Paper crocodiles (STYLE_GUIDE 1): the open-jawed side profile used on the
 * title card and the hub medallion, and the full crocodile floating low in
 * the river at the close of tale I, its swallowed fireflies glowing in its
 * throat through a cut-out window (the "night-light"). Facing +x.
 */
import { Group, Mesh, ShaderMaterial, ShapeGeometry } from '@iwsdk/core';
import { CH_CUTOUT, CH_HOLE, createFlatMaterial } from './materials.js';
import { circleShape, pathGeometry, pathShapes } from './paths.js';

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

// The full crocodile floating in the river: only its back, eye bump and long
// snout show above the water line (y = 0); the rest is under the water.
const FLOATING =
  'M -0.15 -0.02 Q -0.15 0.0 -0.12 0.006 Q -0.08 0.016 -0.04 0.024 Q 0.0 0.028 0.03 0.03 ' +
  'Q 0.036 0.046 0.05 0.046 Q 0.062 0.045 0.066 0.03 Q 0.1 0.022 0.13 0.018 Q 0.146 0.024 0.152 0.016 ' +
  'Q 0.156 0.006 0.148 0.0 L 0.15 -0.03 L -0.15 -0.03 Z';
const FLOAT_SCUTES = (() => {
  const parts: string[] = [];
  for (const [x, h] of [
    [-0.11, 0.01],
    [-0.085, 0.013],
    [-0.06, 0.015],
    [-0.035, 0.016],
    [-0.01, 0.015],
    [0.012, 0.012],
  ]) {
    const y = 0.006 + ((x + 0.12) / 0.15) * 0.022;
    parts.push(`M ${x - 0.009} ${y - 0.004} L ${x + 0.008} ${y - 0.004} L ${x - 0.002} ${y + h} Z`);
  }
  return parts.join(' ');
})();
/** The lit window in its throat (just behind the jaw), in model units. */
export const NIGHT_CROC_THROAT: readonly [number, number] = [0.085 * 1.7, 0.004 * 1.7];
/** Drawing scale of the floating crocodile. */
const NIGHT_K = 1.7;

/** The night-light crocodile: a floating cut-out with an eye hole and a lit throat window. */
export class NightCroc {
  readonly group = new Group();
  private readonly materials: ShaderMaterial[];
  constructor() {
    const cut = createFlatMaterial(CH_CUTOUT, 1);
    const hole = createFlatMaterial(CH_HOLE, 1);
    this.group.add(new Mesh(new ShapeGeometry(pathShapes(FLOATING + ' ' + FLOAT_SCUTES), 10), cut));
    this.group.add(new Mesh(new ShapeGeometry(circleShape(0.051, 0.035, 0.0055, 14), 1), hole));
    const win = new Mesh(new ShapeGeometry(circleShape(0, 0, 1, 24), 1), hole);
    win.position.set(NIGHT_CROC_THROAT[0] / NIGHT_K, NIGHT_CROC_THROAT[1] / NIGHT_K, 0);
    win.scale.set(0.026, 0.012, 1);
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
