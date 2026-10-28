/**
 * Wordless title cards (STYLE_GUIDE §3): when a tale begins, a disc of
 * lamplight opens in the middle of the stage with a paper-cut rod puppet
 * emblem of the tale (0.4 s in with a little overshoot, 1.4 s hold, 0.5 s out).
 * Built from the same cut-out puppets as the show, so it reads as one set.
 */
import { Group, Mesh, Object3D, ShaderMaterial } from '@iwsdk/core';
import { CH_CUTOUT, CH_HOLE, createFlatMaterial } from './materials.js';
import { circleShape, pathGeometry } from './paths.js';
import { WolfPuppet } from './wolf-puppet.js';
import { ShapeGeometry } from '@iwsdk/core';
import { easeInCubic, easeOutBack, easeOutCubic } from '../core/ease.js';

import { TITLE_DURATION, TITLE_HOLD, TITLE_IN, TITLE_OUT } from '../core/story.js';

export type TitleId = 'croc' | 'bridge' | 'wolf';

// A crocodile head on its rod, jaws open, facing right (stage units).
const CROC_HEAD = [
  'M -0.17 0.010 Q -0.12 0.030 -0.085 0.045 Q -0.068 0.084 -0.036 0.074 Q -0.016 0.068 -0.004 0.050',
  'L 0.030 0.046 Q 0.045 0.053 0.060 0.045 L 0.100 0.040 Q 0.124 0.054 0.140 0.047',
  'Q 0.163 0.041 0.166 0.026 Q 0.167 0.013 0.150 0.010 L -0.030 -0.002',
  'L 0.118 -0.060 Q 0.140 -0.068 0.134 -0.082 Q 0.040 -0.066 -0.050 -0.040',
  'Q -0.110 -0.030 -0.170 -0.030 Q -0.196 -0.010 -0.170 0.010 Z',
].join(' ');

function upperJawY(x: number): number {
  return -0.002 + ((x + 0.03) / 0.18) * 0.012;
}
function lowerJawY(x: number): number {
  return -0.002 - ((x + 0.03) / 0.148) * 0.058;
}
function topY(x: number): number {
  return 0.01 + ((x + 0.17) / 0.085) * 0.035;
}

function crocTeeth(): string {
  const parts: string[] = [];
  for (const [x, len] of [
    [0.0, 0.012],
    [0.03, 0.014],
    [0.06, 0.013],
    [0.09, 0.014],
    [0.125, 0.018],
  ]) {
    const y = upperJawY(x) + 0.003;
    parts.push(`M ${x - 0.0075} ${y} L ${x + 0.0075} ${y} L ${x + 0.001} ${y - len} Z`);
  }
  for (const [x, len] of [
    [0.012, 0.011],
    [0.042, 0.013],
    [0.072, 0.013],
    [0.1, 0.015],
  ]) {
    const y = lowerJawY(x) - 0.003;
    parts.push(`M ${x - 0.0065} ${y} L ${x + 0.0065} ${y} L ${x - 0.001} ${y + len} Z`);
  }
  // scutes along the back of the neck
  for (const x of [-0.158, -0.132, -0.106]) {
    const y = topY(x) - 0.003;
    parts.push(`M ${x - 0.01} ${y} L ${x + 0.008} ${y} L ${x - 0.003} ${y + 0.016} Z`);
  }
  return parts.join(' ');
}

function rod(x: number, y0: number, y1: number, r = 0.0045): string {
  return `M ${x - r} ${y0} L ${x + r} ${y0} L ${x + r * 0.8} ${y1} Q ${x} ${y1 - r} ${x - r * 0.8} ${y1} Z`;
}

// A sitting rabbit on a plank bridge over water (the bridge tale).
const RABBIT = [
  'M -0.040 0.000 Q -0.072 0.004 -0.070 0.036 Q -0.068 0.068 -0.034 0.078',
  'Q -0.010 0.086 0.010 0.080 Q 0.022 0.096 0.030 0.104',
  // ears: back ear, then front ear
  'Q 0.012 0.150 0.020 0.176 Q 0.028 0.186 0.034 0.170 Q 0.036 0.136 0.042 0.110',
  'Q 0.046 0.150 0.058 0.172 Q 0.068 0.180 0.070 0.164 Q 0.064 0.128 0.052 0.104',
  // head and nose
  'Q 0.072 0.098 0.080 0.084 Q 0.084 0.072 0.070 0.068 Q 0.050 0.064 0.044 0.056',
  // chest and front paw
  'Q 0.046 0.030 0.040 0.008 Q 0.050 0.004 0.052 0.000 Z',
  // tail
  'M -0.062 0.018 Q -0.088 0.016 -0.086 0.034 Q -0.082 0.048 -0.066 0.040 Z',
].join(' ');

const WAVES = (() => {
  const parts: string[] = [];
  // water band below the plank: a wavy top edge
  let d = 'M -0.20 -0.075';
  for (let i = 0; i <= 10; i++) {
    const x = -0.2 + i * 0.04;
    d += ` Q ${x + 0.01} ${-0.062} ${x + 0.02} ${-0.07} Q ${x + 0.03} ${-0.078} ${x + 0.04} ${-0.07}`;
  }
  d += ' L 0.24 -0.14 L -0.20 -0.14 Z';
  parts.push(d);
  // banks and the plank
  parts.push('M -0.21 -0.03 Q -0.16 -0.02 -0.14 -0.04 L -0.12 -0.10 L -0.21 -0.10 Z');
  parts.push('M 0.21 -0.03 Q 0.16 -0.02 0.14 -0.04 L 0.12 -0.10 L 0.21 -0.10 Z');
  parts.push('M -0.165 -0.022 L 0.165 -0.022 Q 0.17 -0.03 0.165 -0.036 L -0.165 -0.036 Q -0.17 -0.03 -0.165 -0.022 Z');
  return parts.join(' ');
})();

export class TitleCard {
  readonly group = new Group();
  private readonly cards: Record<TitleId, Group>;
  private readonly materials: Record<TitleId, ShaderMaterial[]>;
  private readonly wolf = new WolfPuppet();
  /** 0..1 current card alpha (the renderer adds the light disc behind it). */
  alpha = 0;
  scale = 1;
  current: TitleId | '' = '';

  constructor() {
    const mk = (): Group => {
      const g = new Group();
      g.visible = false;
      this.group.add(g);
      return g;
    };
    const croc = mk();
    const bridge = mk();
    const wolf = mk();
    this.cards = { croc, bridge, wolf };
    const cut = (): ShaderMaterial => createFlatMaterial(CH_CUTOUT, 1);
    const hole = (): ShaderMaterial => createFlatMaterial(CH_HOLE, 1);

    // croc: head on a rod, slightly tilted up as if snapping at the firefly
    const cm = [cut(), cut(), hole()];
    const head = new Group();
    head.add(new Mesh(pathGeometry(CROC_HEAD + ' ' + crocTeeth(), 12), cm[0]));
    head.add(new Mesh(pathGeometry(rod(-0.115, -0.03, -0.24), 4), cm[1]));
    head.add(new Mesh(new ShapeGeometry(circleShape(-0.043, 0.057, 0.0095, 20), 1), cm[2]));
    head.rotation.z = 0.08;
    head.position.set(-0.03, 0.02, 0);
    croc.add(head);

    // bridge: rabbit sitting on the plank
    const bm = [cut(), cut(), hole()];
    const rabbit = new Group();
    rabbit.add(new Mesh(pathGeometry(RABBIT, 12), bm[0]));
    rabbit.add(new Mesh(new ShapeGeometry(circleShape(0.063, 0.086, 0.0055, 16), 1), bm[2]));
    rabbit.position.set(-0.01, -0.022, 0);
    rabbit.scale.setScalar(1.05);
    bridge.add(rabbit);
    bridge.add(new Mesh(pathGeometry(WAVES, 8), bm[1]));

    // wolf: the show's own wolf puppet, sitting and howling
    const wm: ShaderMaterial[] = [];
    this.wolf.update(-0.05, -0.14, 1, 'howl', 0, 0, 1, 0);
    const holder = new Group();
    holder.scale.set(1.1, 1.1, 1);
    holder.add(this.wolf.group);
    wolf.add(holder);
    collectMaterials(this.wolf.group, wm);
    this.materials = { croc: cm, bridge: bm, wolf: wm };
    this.group.visible = false;
  }

  /**
   * @param id the tale whose card is showing ('' = none)
   * @param t seconds since the card began
   */
  update(id: TitleId | '', t: number, time: number): void {
    this.current = id;
    if (!id || t >= TITLE_DURATION) {
      this.group.visible = false;
      this.alpha = 0;
      return;
    }
    let a: number;
    let sc: number;
    if (t < TITLE_IN) {
      const u = t / TITLE_IN;
      a = easeOutCubic(u);
      sc = 0.82 + 0.18 * easeOutBack(u, 1.6);
    } else if (t < TITLE_IN + TITLE_HOLD) {
      a = 1;
      sc = 1 + 0.02 * Math.sin((t - TITLE_IN) * 1.6);
    } else {
      const u = (t - TITLE_IN - TITLE_HOLD) / TITLE_OUT;
      a = 1 - easeInCubic(u);
      sc = 1 + 0.06 * easeInCubic(u);
    }
    this.alpha = a;
    this.scale = sc;
    this.group.visible = true;
    for (const k of TITLE_IDS) this.cards[k].visible = k === id;
    const card = this.cards[id];
    card.scale.set(sc, sc, 1);
    // a gentle bob, like a puppet held on its rod
    card.position.set(0, 0.012 * Math.sin(time * 2.1), 0);
    if (id === 'croc') card.children[0].rotation.z = 0.08 + 0.05 * Math.sin(time * 3.3);
    if (id === 'wolf') this.wolf.update(-0.05, -0.14, 1, 'howl', 0, 0, 1, time);
    for (const m of this.materials[id]) m.uniforms.uStrength.value = a;
  }
}

const TITLE_IDS: readonly TitleId[] = ['croc', 'bridge', 'wolf'];

function collectMaterials(root: Object3D, out: ShaderMaterial[]): void {
  root.traverse((o) => {
    const m = (o as Mesh).material as ShaderMaterial | undefined;
    if (m && m.uniforms?.uStrength && !out.includes(m)) out.push(m);
  });
}
