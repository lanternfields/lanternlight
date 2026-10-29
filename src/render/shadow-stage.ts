/**
 * The offscreen shadow stage: renders every shadow, cut-out and light into a
 * small 4-channel mask texture (see materials.ts), in stage units, once per
 * frame. The composite shader on the wall/scroll then turns the mask into
 * lamplight and shadow. Cost: one tiny ortho pass (<= 512 px wide).
 */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  EllipseCurve,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  LinearFilter,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  ShaderMaterial,
  Scene,
  Shape,
  ShapeGeometry,
  UnsignedByteType,
  Vector4,
  WebGLRenderTarget,
  WebGLRenderer,
} from '@iwsdk/core';
import { Actor, Capsule2D, PALM_POINTS, ShadowModel } from '../core/shadow-model.js';
import { StageView, GROUND_T, RABBIT_DRAW_SCALE } from '../core/story.js';
import { GhostCaster } from '../core/ghost.js';
import { Spring, easeOutBack, easeOutCubic, keyLoop, smoothNoise } from '../core/ease.js';
import { WolfPuppet } from './wolf-puppet.js';
import { CrocOverlay } from './croc-overlay.js';
import { TitleCard } from './title-card.js';
import { BirdPuppet } from './bird-puppet.js';
import { NIGHT_CROC_THROAT, NightCroc, createCrocHead } from './croc-art.js';
import { drawBurrowDoor, drawFirefly, drawLilies, drawReeds, drawReflection, drawRipples, drawStars } from './scenery-art.js';
import {
  CH_CUTOUT,
  CH_HOLE,
  CH_LIGHT,
  CH_SHADOW,
  createShadowBlurMaterial,
  createCapsuleMaterial,
  createFlatMaterial,
  createGlowMaterial,
  createIconMaterial,
} from './materials.js';

/**
 * Margin around the stage (stage units) that is still rendered: wide enough
 * that the lamplight falls off and forearms fade out before the quad's edge,
 * so the stage never ends on a hard lit rectangle.
 */
export const STAGE_PAD = 0.32;
/** Edge softness of paper cut-outs and holes (stage units): one soft-edge model (STYLE_GUIDE 1). */
export const PAPER_EDGE = 0.0045;
const EAR_TWITCH: readonly (readonly [number, number])[] = [
  [0, 0],
  [4.6, 0],
  [4.72, 0.22],
  [4.9, -0.05],
  [5.05, 0],
];
/** Rabbit puppet scale (its model is ~0.16 stage units tall at 1). */
export const RABBIT_SCALE = RABBIT_DRAW_SCALE;
/** A hand that leaves tracking dissolves over this long (never a one-frame vanish). */
const LOST_FADE = 0.35;
const LOST_MAX = 48;
/** Firefly trail: points kept per firefly, and how often one is laid down. */
const TRAIL_N = 7;
const TRAIL_EVERY = 0.035;

class CapsuleBatch {
  readonly mesh: Mesh;
  private readonly geo: InstancedBufferGeometry;
  private readonly seg: Float32Array;
  private readonly rad: Float32Array;
  private readonly segAttr: InstancedBufferAttribute;
  private readonly radAttr: InstancedBufferAttribute;
  private readonly fade: Float32Array;
  private readonly fadeAttr: InstancedBufferAttribute;
  count = 0;

  constructor(
    readonly max: number,
    channel: Vector4,
  ) {
    const base = new PlaneGeometry(1, 1);
    this.geo = new InstancedBufferGeometry();
    this.geo.index = base.index;
    this.geo.setAttribute('position', base.getAttribute('position'));
    this.seg = new Float32Array(max * 4);
    this.rad = new Float32Array(max * 4);
    this.fade = new Float32Array(max);
    this.segAttr = new InstancedBufferAttribute(this.seg, 4);
    this.radAttr = new InstancedBufferAttribute(this.rad, 4);
    this.fadeAttr = new InstancedBufferAttribute(this.fade, 1);
    this.segAttr.setUsage(35048); // DynamicDrawUsage
    this.radAttr.setUsage(35048);
    this.fadeAttr.setUsage(35048);
    this.geo.setAttribute('iSeg', this.segAttr);
    this.geo.setAttribute('iRad', this.radAttr);
    this.geo.setAttribute('iFade', this.fadeAttr);
    this.geo.instanceCount = 0;
    this.mesh = new Mesh(this.geo, createCapsuleMaterial(channel));
    this.mesh.frustumCulled = false;
  }

  begin(): void {
    this.count = 0;
  }

  push(c: Capsule2D, strength = 1, radiusScale = 1, softOverride = -1): void {
    if (this.count >= this.max) return;
    const i = this.count++;
    this.seg[i * 4] = c.ax;
    this.seg[i * 4 + 1] = c.ay;
    this.seg[i * 4 + 2] = c.bx;
    this.seg[i * 4 + 3] = c.by;
    this.rad[i * 4] = c.r * radiusScale;
    this.rad[i * 4 + 1] = (c.rb ?? c.r) * radiusScale;
    this.rad[i * 4 + 2] = softOverride >= 0 ? softOverride : c.soft;
    this.rad[i * 4 + 3] = strength;
    this.fade[i] = c.fadeB ?? 1;
  }

  pushRaw(ax: number, ay: number, bx: number, by: number, r: number, soft: number, strength = 1, rb = r, fadeB = 1): void {
    if (this.count >= this.max) return;
    const i = this.count++;
    this.seg[i * 4] = ax;
    this.seg[i * 4 + 1] = ay;
    this.seg[i * 4 + 2] = bx;
    this.seg[i * 4 + 3] = by;
    this.rad[i * 4] = r;
    this.rad[i * 4 + 1] = rb;
    this.rad[i * 4 + 2] = soft;
    this.rad[i * 4 + 3] = strength;
    this.fade[i] = fadeB;
  }

  end(): void {
    this.geo.instanceCount = this.count;
    this.segAttr.needsUpdate = true;
    this.radAttr.needsUpdate = true;
    this.fadeAttr.needsUpdate = true;
    this.mesh.visible = this.count > 0;
  }
}

class GlowBatch {
  readonly mesh: Mesh;
  private readonly geo: InstancedBufferGeometry;
  private readonly data: Float32Array;
  private readonly attr: InstancedBufferAttribute;
  count = 0;
  constructor(readonly max: number) {
    const base = new PlaneGeometry(1, 1);
    this.geo = new InstancedBufferGeometry();
    this.geo.index = base.index;
    this.geo.setAttribute('position', base.getAttribute('position'));
    this.data = new Float32Array(max * 4);
    this.attr = new InstancedBufferAttribute(this.data, 4);
    this.attr.setUsage(35048);
    this.geo.setAttribute('iGlow', this.attr);
    this.mesh = new Mesh(this.geo, createGlowMaterial(CH_LIGHT));
    this.mesh.frustumCulled = false;
  }
  begin(): void {
    this.count = 0;
  }
  push(x: number, y: number, r: number, intensity: number): void {
    if (this.count >= this.max || intensity <= 0.001) return;
    const i = this.count++;
    this.data[i * 4] = x;
    this.data[i * 4 + 1] = y;
    this.data[i * 4 + 2] = r;
    this.data[i * 4 + 3] = intensity;
  }
  end(): void {
    this.geo.instanceCount = this.count;
    this.attr.needsUpdate = true;
    this.mesh.visible = this.count > 0;
  }
}

function ellipse(cx: number, cy: number, rx: number, ry: number, rot = 0, segments = 40): Shape {
  const shape = new Shape();
  const curve = new EllipseCurve(cx, cy, rx, ry, 0, Math.PI * 2, false, rot);
  const pts = curve.getPoints(segments);
  shape.setFromPoints(pts);
  return shape;
}

/** The rabbit shadow puppet (stage units, origin at its feet, facing +x). */
export function createRabbitPuppet(): { group: Group; eye: Mesh; ears: Group; body: Group } {
  const cut = createFlatMaterial(CH_CUTOUT);
  const hole = createFlatMaterial(CH_HOLE);
  const group = new Group();
  const body = new Group();
  group.add(body);
  const bodyShapes = [
    ellipse(0, 0.045, 0.05, 0.034),
    ellipse(-0.026, 0.036, 0.034, 0.033),
    ellipse(0.045, 0.083, 0.025, 0.023),
    ellipse(0.06, 0.075, 0.016, 0.012, -0.3),
    ellipse(-0.072, 0.055, 0.013, 0.013),
    ellipse(0.04, 0.009, 0.013, 0.01),
    ellipse(-0.03, 0.006, 0.032, 0.008),
  ];
  body.add(new Mesh(new ShapeGeometry(bodyShapes, 6), cut));
  const ears = new Group();
  ears.position.set(0.04, 0.1, 0);
  ears.add(new Mesh(new ShapeGeometry([ellipse(-0.006, 0.03, 0.009, 0.032, -0.28), ellipse(0.01, 0.028, 0.008, 0.03, -0.05)], 6), cut));
  body.add(ears);
  const eye = new Mesh(new ShapeGeometry(ellipse(0.054, 0.088, 0.0048, 0.0052), 4), hole);
  body.add(eye);
  return { group, eye, ears, body };
}

/** Animated wavy water band (cut-out) from waterY down past the stage bottom. */
function createWater(width: number): { mesh: Mesh; update: (waterY: number, time: number, calm: boolean) => void } {
  const cols = 48;
  const geo = new BufferGeometry();
  const pos = new Float32Array((cols + 1) * 2 * 3);
  const idx: number[] = [];
  for (let i = 0; i < cols; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  geo.setIndex(idx);
  const attr = new BufferAttribute(pos, 3);
  attr.setUsage(35048);
  geo.setAttribute('position', attr);
  const mesh = new Mesh(geo, createFlatMaterial(CH_CUTOUT, 0.92));
  mesh.frustumCulled = false;
  const update = (waterY: number, time: number, calm: boolean) => {
    for (let i = 0; i <= cols; i++) {
      const x = -width / 2 + (width * i) / cols;
      const amp = calm ? 0.003 : 0.007;
      const y = waterY + Math.sin(x * 34 + time * 1.7) * amp + Math.sin(x * 61 - time * 2.3) * amp * 0.5;
      pos[i * 6] = x;
      pos[i * 6 + 1] = y;
      pos[i * 6 + 3] = x;
      pos[i * 6 + 4] = -0.5 - STAGE_PAD - 0.05;
    }
    attr.needsUpdate = true;
  };
  return { mesh, update };
}

function createPalm(): Mesh {
  const geo = new BufferGeometry();
  const pos = new Float32Array(PALM_POINTS * 3);
  const attr = new BufferAttribute(pos, 3);
  attr.setUsage(35048);
  geo.setAttribute('position', attr);
  // fan from the palm centre (last point) around the closed contour
  const idx: number[] = [];
  const centre = PALM_POINTS - 1;
  for (let i = 0; i < centre; i++) idx.push(centre, i, (i + 1) % centre);
  geo.setIndex(idx);
  const m = new Mesh(geo, createFlatMaterial(CH_SHADOW));
  m.frustumCulled = false;
  return m;
}

export class ShadowStage {
  readonly target: WebGLRenderTarget;
  /** Ping-pong target for the penumbra blur. */
  private readonly temp: WebGLRenderTarget;
  private readonly blurMat = createShadowBlurMaterial();
  private readonly blurScene = new Scene();
  private readonly blurCam = new OrthographicCamera(-1, 1, 1, -1, -1, 1);
  /** Penumbra for this frame (stage units) - set by update(). */
  penumbra = 0.01;
  readonly scene = new Scene();
  readonly camera = new OrthographicCamera(-1, 1, 1, -1, -1, 1);
  aspect = 1.45;
  resolution = 512;

  private readonly hands = new CapsuleBatch(128, CH_SHADOW);
  private readonly palms: Mesh[] = [createPalm(), createPalm()];
  private readonly scenery = new CapsuleBatch(192, CH_CUTOUT);
  /** The ghost hint is a cast shadow too (R channel, same penumbra as a hand). */
  private readonly ghostHand = new CapsuleBatch(64, CH_SHADOW);
  private readonly ghostPalm = createPalm();
  private readonly ghostCaster = new GhostCaster();
  private readonly details = new CapsuleBatch(128, CH_CUTOUT);
  private readonly holes = new CapsuleBatch(32, CH_HOLE);
  private readonly glows = new GlowBatch(224);
  private readonly crocOverlay = new CrocOverlay();
  private readonly title = new TitleCard();
  private readonly titleDisc = new Mesh(new PlaneGeometry(1, 1), createIconMaterial());
  private readonly bird = new BirdPuppet();
  private readonly nightCroc = new NightCroc();
  private readonly iconCroc = createCrocHead();
  /** Each actor's last shadow, kept to dissolve it when the hand is lost. */
  private readonly lostCaps: Float32Array[] = [0, 1, 2, 3].map(() => new Float32Array(LOST_MAX * 8));
  private readonly lostN = [0, 0, 0, 0];
  private readonly lostFade = [0, 0, 0, 0];
  private readonly trails = new Float32Array(8 * TRAIL_N * 2);
  private readonly trailAlive: boolean[] = [];
  private trailClock = 0;
  private readonly beakTrail = new Float32Array(6 * 2);
  private readonly beakXY: [number, number] = [0, 0];
  private focus = 1;
  private readonly rabbitTilt = new Spring(0, 12, 0.7);
  private readonly rabbitEars = new Spring(0, 11, 0.38);
  private prevRabbitY = 0;
  private lastTime = -1;
  private lastGulps = 0;
  private readonly rabbit = createRabbitPuppet();
  private readonly iconRabbit = createRabbitPuppet();
  private readonly wolf = new WolfPuppet();
  private readonly iconWolf = new WolfPuppet();
  private readonly moon: Mesh;
  private readonly water = createWater(1.8);
  private readonly icons: Mesh[] = [];
  private readonly clearColor = new Color(0, 0, 0);

  constructor() {
    this.target = new WebGLRenderTarget(512, 320, {
      format: RGBAFormat,
      type: UnsignedByteType,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
      // 4x MSAA: crisp, smooth edges on the paper cut-outs (tiny target, cheap)
      samples: 4,
    });
    this.temp = this.target.clone();
    this.temp.samples = 0;
    const quad = new Mesh(new PlaneGeometry(1, 1), this.blurMat);
    quad.frustumCulled = false;
    this.blurScene.add(quad);
    this.scene.add(
      this.water.mesh,
      this.scenery.mesh,
      this.hands.mesh,
      this.palms[0],
      this.palms[1],
      this.ghostHand.mesh,
      this.ghostPalm,
      this.details.mesh,
      this.title.group,
      this.rabbit.group,
      this.iconRabbit.group,
      this.wolf.group,
      this.iconWolf.group,
      this.bird.group,
      this.nightCroc.group,
      this.iconCroc.group,
      this.glows.mesh,
      this.holes.mesh,
    );
    this.moon = new Mesh(new ShapeGeometry(ellipse(0, 0, 1, 1, 0, 40), 1), createFlatMaterial(CH_LIGHT, 0.95));
    this.moon.frustumCulled = false;
    this.scene.add(this.moon);
    for (let i = 0; i < 3; i++) {
      const icon = new Mesh(new PlaneGeometry(1, 1), createIconMaterial());
      icon.frustumCulled = false;
      this.icons.push(icon);
      this.scene.add(icon);
    }
    this.titleDisc.frustumCulled = false;
    this.titleDisc.visible = false;
    this.scene.add(this.titleDisc);
    this.iconCroc.group.visible = false;
    // Draw order matters only for readability; MAX blending is order independent.
    this.setLayout(1.45, 512);
  }

  /** Resizes the target for the stage aspect and quality resolution. */
  setLayout(aspect: number, resolution: number): void {
    if (Math.abs(aspect - this.aspect) < 1e-3 && resolution === this.resolution && this.target.width > 1) {
      return;
    }
    this.aspect = aspect;
    this.resolution = resolution;
    const w = aspect + 2 * STAGE_PAD;
    const h = 1 + 2 * STAGE_PAD;
    const px = Math.round(resolution);
    const py = Math.max(64, Math.round((resolution * h) / w));
    this.target.setSize(px, py);
    this.temp.setSize(px, py);
    this.camera.left = -w / 2;
    this.camera.right = w / 2;
    this.camera.top = h / 2;
    this.camera.bottom = -h / 2;
    this.camera.updateProjectionMatrix();
  }

  update(model: ShadowModel, view: StageView, time: number, reduceMotion: boolean, flicker = 0): void {
    const dt = this.lastTime < 0 ? 1 / 72 : Math.min(0.1, Math.max(0, time - this.lastTime));
    this.lastTime = time;
    const set = view.set;
    // penumbra breathes a little with the flame; the bridge tale brings the
    // shadows into focus, so a flat hand reads as a hand (fingers and all)
    this.focus += ((view.scene === 'bridge' ? 0.38 : 1) - this.focus) * (1 - Math.exp(-3 * dt));
    this.penumbra = model.penumbra * this.focus * (1 + (reduceMotion ? 0 : 0.08 * flicker));
    this.glows.begin();
    this.details.begin();
    this.holes.begin();

    // ---- cast shadows (hands & rod puppets)
    this.hands.begin();
    for (let i = 0; i < model.capsuleCount; i++) this.hands.push(model.capsules[i]);
    this.dissolveLost(model, dt);
    this.hands.end();
    for (let h = 0; h < 2; h++) {
      const a = model.actors[h];
      if (a.present || this.lostFade[h] <= 0) this.updatePalm(this.palms[h], a, 1);
      else {
        // the lost hand's palm dissolves with its fingers (its contour is last frame's)
        const palm = this.palms[h];
        const f = this.lostFade[h];
        palm.visible = palm.visible && f > 0.01;
        (palm.material as ShaderMaterial).uniforms.uStrength.value = f * f * (3 - 2 * f);
      }
    }

    // ---- ghost hint: cast by the same caster as a real hand, only fainter
    const g = view.ghost;
    this.ghostHand.begin();
    this.ghostCaster.update(g.pose, g.s, g.t, g.scale, g.phase, g.visible, dt);
    const gs = g.visible * 0.55;
    if (this.ghostCaster.visible) {
      const gm = this.ghostCaster.model;
      for (let i = 0; i < gm.capsuleCount; i++) this.ghostHand.push(gm.capsules[i], gs);
    }
    this.ghostHand.end();
    this.updatePalm(this.ghostPalm, this.ghostCaster.model.actors[1], gs, !this.ghostCaster.visible);

    // ---- scenery (the set fades in as a tale's title card leaves)
    this.scenery.begin();
    for (let i = 0; i < view.sceneryCount; i++) this.scenery.push(view.scenery[i], set);
    // grass tufts along floor capsules
    for (let i = 0; i < view.sceneryCount; i++) {
      const c = view.scenery[i];
      if (Math.abs(c.by - c.ay) > 0.02 || Math.abs(c.bx - c.ax) < 0.2) continue;
      const top = Math.max(c.ay, c.by) + c.r;
      const x0 = Math.min(c.ax, c.bx);
      const x1 = Math.max(c.ax, c.bx);
      for (let x = x0 + 0.03; x < x1 - 0.02; x += 0.075) {
        const sway = reduceMotion ? 0 : smoothNoise(time * 0.5 + x * 7, 3) * 0.004;
        const hgt = 0.018 + ((x * 137) % 0.012);
        this.scenery.pushRaw(x, top - 0.004, x - 0.006 + sway, top + hgt, 0.0035, 0.003, set, 0.0012);
        this.scenery.pushRaw(x + 0.008, top - 0.004, x + 0.012 + sway, top + hgt * 0.8, 0.003, 0.003, set, 0.001);
      }
    }
    if (view.scene === 'croc') {
      drawReeds(this.scenery, GROUND_T - 0.01, time, reduceMotion, set);
      if (Number.isFinite(view.waterY)) drawLilies(this.scenery, view.waterY, time, reduceMotion, set);
    }
    // the bridge tale: lamplight rippling on the water in the gap
    if (view.scene === 'bridge' && Number.isFinite(view.gap) && Number.isFinite(view.waterY)) {
      drawRipples(this.glows, -view.gap, view.gap, view.waterY, time, reduceMotion, set);
    }
    // burrow mound with a lit doorway
    if (view.burrow.visible > 0.01) {
      const b = view.burrow;
      const bv = b.visible * set;
      this.scenery.pushRaw(b.s - 0.06, b.t + 0.005, b.s + 0.06, b.t + 0.005, 0.045, 0.004, bv);
      drawBurrowDoor(this.holes, this.glows, b.s, b.t, bv, time, reduceMotion);
    }
    this.scenery.end();

    // ---- water
    const hasWater = Number.isFinite(view.waterY);
    this.water.mesh.visible = hasWater;
    if (hasWater) {
      this.water.update(view.waterY, time, reduceMotion);
      (this.water.mesh.material as ShaderMaterial).uniforms.uStrength.value = 0.92 * set;
    }

    // ---- the crocodile your hand becomes
    const croc = view.croc;
    if (croc.gulps !== this.lastGulps) {
      if (croc.gulps > this.lastGulps) this.crocOverlay.swallow();
      this.lastGulps = croc.gulps;
    }
    const crocActor = croc.actor >= 0 && croc.visible > 0.05 ? model.actors[croc.actor] : null;
    this.crocOverlay.update(dt, model, crocActor && crocActor.present ? crocActor : null, croc.visible, croc.open, time, this.details, this.holes, this.glows, croc.full);
    // ...and the full crocodile drifting off down the river, a night-light
    const nl = view.nightLight;
    this.nightCroc.update(nl.x, nl.y, nl.dir, nl.visible * set, time, reduceMotion);
    if (nl.visible > 0.02) {
      const tx = nl.x + nl.dir * NIGHT_CROC_THROAT[0];
      const ty = nl.y + NIGHT_CROC_THROAT[1];
      const g = nl.glow * nl.visible;
      this.glows.push(tx, ty + 0.01, 0.11, 0.42 * g);
      this.glows.push(tx, ty, 0.035, 0.95 * g);
      if (hasWater) drawReflection(this.glows, tx, view.waterY - 0.01, g * 1.6, ty, time);
    }

    // ---- menu icons: appear with a little overshoot, staggered (story sets 0..1)
    for (let i = 0; i < view.icons.length; i++) {
      const icon = view.icons[i];
      const mesh = this.icons[i];
      const mat = mesh.material as ShaderMaterial;
      const vis = easeOutCubic(icon.visible);
      mesh.visible = icon.visible > 0.01 && view.scene === 'menu';
      mesh.position.set(icon.s, icon.t, 0);
      mesh.scale.setScalar(icon.r * 2 * (0.55 + 0.45 * easeOutBack(icon.visible, 1.7)));
      mat.uniforms.uFill.value = icon.fill;
      mat.uniforms.uVisible.value = vis;
      mat.uniforms.uDone.value = icon.completed ? 1 : 0;
      mat.uniforms.uTime.value = time;
      if (!mesh.visible) continue;
      const k0 = 0.55 + 0.45 * easeOutBack(icon.visible, 1.7);
      if (icon.id === 'bridge') {
        // a little plank bridge under the icon rabbit
        this.details.pushRaw(icon.s - 0.07 * k0, icon.t - 0.045 * k0, icon.s + 0.07 * k0, icon.t - 0.045 * k0, 0.006 * k0, 0.003, vis);
      }
    }
    // the croc medallion: a side profile with open jaws (reads at a glance, unlike a stick)
    const crocIcon = view.icons[0];
    const ic = this.iconCroc;
    ic.group.visible = view.scene === 'menu' && crocIcon.visible > 0.05;
    if (ic.group.visible) {
      const k0 = 0.55 + 0.45 * easeOutBack(crocIcon.visible, 1.7);
      const k = ((crocIcon.r * 1.62) / 0.36) * k0;
      ic.group.position.set(crocIcon.s + 0.006 * k0, crocIcon.t + 0.004 * k0, 0);
      ic.group.scale.set(k, k, 1);
      ic.group.rotation.z = 0.1 + (reduceMotion ? 0 : 0.04 * Math.sin(time * 2.2));
      for (const m of ic.materials) m.uniforms.uStrength.value = easeOutCubic(crocIcon.visible);
    }
    const wolfIcon = view.icons[2];
    const iw = this.iconWolf;
    if (wolfIcon && view.scene === 'menu' && wolfIcon.visible > 0.05) {
      const k0 = 0.55 + 0.45 * easeOutBack(wolfIcon.visible, 1.7);
      iw.update(wolfIcon.s - 0.004 * k0, wolfIcon.t - 0.058 * k0, 1, 'howl', 0.35, 0, 1, time);
      iw.group.scale.set(0.36 * k0, 0.36 * k0, 1);
    } else {
      iw.group.visible = false;
    }
    const ir = this.iconRabbit.group;
    const bridgeIcon = view.icons[1];
    ir.visible = view.scene === 'menu' && bridgeIcon.visible > 0.05;
    const kb = 0.55 + 0.45 * easeOutBack(bridgeIcon.visible, 1.7);
    ir.position.set(bridgeIcon.s - 0.005 * kb, bridgeIcon.t - 0.039 * kb, 0);
    ir.scale.setScalar(0.62 * kb);

    // ---- title card: a disc of lamplight with the tale's emblem
    this.title.update(view.title.id, view.title.t, time);
    const ta = this.title.alpha;
    const tm = this.titleDisc;
    tm.visible = ta > 0.01;
    if (tm.visible) {
      const u = (tm.material as ShaderMaterial).uniforms;
      tm.scale.setScalar(0.62 * this.title.scale);
      u.uVisible.value = ta;
      u.uFill.value = 0;
      u.uTime.value = time;
      this.glows.push(0, 0, 0.3 * this.title.scale, 0.75 * ta);
      // the title sits in the light too (ink on lamplight)
      for (const gx of [-0.32, 0, 0.32]) this.glows.push(gx, 0.34, 0.3, 0.62 * ta);
      if (view.title.id === 'croc') {
        // the firefly the crocodile is snapping at
        drawFirefly(this.glows, 0.19 * this.title.scale, 0.0, ta, 0, time, reduceMotion);
      } else if (view.title.id === 'wolf') {
        this.glows.push(0.13, 0.12, 0.07, 0.95 * ta);
      } else if (view.title.id === 'finale') {
        // the spark in the bird's beak
        const sp = this.title.spark;
        this.glows.push(sp[0], sp[1], 0.06, 0.75 * ta);
        this.glows.push(sp[0], sp[1], 0.018, 1.0 * ta);
      }
    }

    // ---- rabbit: squash & stretch from the body spring, ears and tilt follow through
    const rv = view.rabbit;
    const rg = this.rabbit.group;
    rg.visible = rv.visible > 0.02;
    if (rg.visible) {
      const vy = dt > 0 ? (rv.y - this.prevRabbitY) / dt : 0;
      this.prevRabbitY = rv.y;
      // trembling while the wolf stalks: a small fast shiver (intentional secondary motion)
      const shiver = reduceMotion ? 0 : Math.sin(time * 44) * 0.0022 * rv.tremble;
      rg.position.set(rv.x + shiver, rv.y, 0);
      const sq = Math.max(0.6, Math.min(1.4, rv.squash));
      const k = RABBIT_SCALE * rv.scale;
      rg.scale.set(rv.dir * (1 / Math.sqrt(sq)) * k, sq * k, 1);
      // lean into the hop: nose up rising, down falling
      const tilt = this.rabbitTilt.update(rv.hopping ? Math.max(-0.3, Math.min(0.35, vy * 0.35)) : 0, dt);
      this.rabbit.body.rotation.z = tilt;
      // ears lag behind the body's vertical motion and twitch now and then
      const twitch = reduceMotion ? 0 : keyLoop(time + rv.x * 3, 5.3, EAR_TWITCH);
      const earT = rv.peering
        ? -0.15 + Math.sin(time * 6) * 0.08
        : -Math.max(-0.5, Math.min(0.5, vy * 0.55)) + twitch * (1 - rv.tremble) - 0.55 * rv.tremble;
      this.rabbit.ears.rotation.z = this.rabbitEars.update(earT, dt);
    }

    // ---- wolf & moon
    const wv = view.wolf;
    const mv = view.moon;
    const wolfSet = view.scene === 'wolf' || view.scene === 'finale' ? set : 1;
    this.wolf.update(wv.x, wv.y, wv.dir, wv.state, wv.crouch, wv.phase, wv.visible * wolfSet, time, wv.scale, wv.hesitate, wv.vx);

    // ---- the finale's bird, and the lantern's spark it carries away
    const bv = view.bird;
    const bvis = view.scene === 'finale' ? bv.visible * set : 0;
    this.bird.update(bv.x, bv.y, bv.dir, bv.flying, bv.tilt, bvis, bv.landings, time, reduceMotion);
    const bt = this.beakTrail;
    if (bvis > 0.02) {
      this.bird.beak(bv.x, bv.y, bv.dir, bv.tilt, this.beakXY);
      const bx = this.beakXY[0];
      const by = this.beakXY[1];
      if (bv.carry > 0.01) {
        for (let i = bt.length / 2 - 1; i > 0; i--) {
          bt[i * 2] = bt[(i - 1) * 2];
          bt[i * 2 + 1] = bt[(i - 1) * 2 + 1];
        }
        bt[0] = bx;
        bt[1] = by;
        for (let i = 1; i < bt.length / 2; i++) this.glows.push(bt[i * 2], bt[i * 2 + 1], 0.022 - i * 0.002, 0.45 * (1 - i / 6) * bv.carry);
        this.glows.push(bx, by, 0.075, 0.55 * bv.carry);
        this.glows.push(bx, by, 0.02, 1.0 * bv.carry);
      } else {
        for (let i = 0; i < bt.length / 2; i++) {
          bt[i * 2] = bx;
          bt[i * 2 + 1] = by;
        }
      }
    }
    // the spark arriving on the wall from the lantern (the app draws its flight across the room)
    const sp = view.spark;
    if (sp.travel > 0.6) {
      const u = (sp.travel - 0.6) / 0.4;
      this.glows.push(sp.s, sp.t, 0.03 + 0.05 * u, 0.9 * u);
      this.glows.push(sp.s, sp.t, 0.016, u);
    }
    this.moon.visible = mv.visible > 0.02;
    this.moon.position.set(mv.s, mv.t, 0);
    this.moon.scale.setScalar(mv.r * (0.85 + 0.15 * mv.visible));
    (this.moon.material as ShaderMaterial).uniforms.uStrength.value = 0.95 * mv.visible;

    // ---- light: moon halo, stars, fireflies & sparkles
    if (mv.visible > 0.02) this.glows.push(mv.s, mv.t, mv.r * 2.6, (0.35 + 0.45 * mv.glow) * mv.visible);
    if (view.scene === 'wolf' || view.scene === 'finale') drawStars(this.glows, mv.visible, time, reduceMotion);
    const river = view.scene === 'croc' && hasWater;
    this.trailClock += dt;
    const lay = this.trailClock >= TRAIL_EVERY;
    if (lay) this.trailClock = 0;
    const tr = this.trails;
    for (let i = 0; i < view.fireflies.length && i < 8; i++) {
      const f = view.fireflies[i];
      const o = i * TRAIL_N * 2;
      if (f.alive) {
        if (!this.trailAlive[i]) {
          for (let k = 0; k < TRAIL_N; k++) {
            tr[o + k * 2] = f.x;
            tr[o + k * 2 + 1] = f.y;
          }
        } else if (lay) {
          for (let k = TRAIL_N - 1; k > 0; k--) {
            tr[o + k * 2] = tr[o + (k - 1) * 2];
            tr[o + k * 2 + 1] = tr[o + (k - 1) * 2 + 1];
          }
          tr[o] = f.x;
          tr[o + 1] = f.y;
        }
        // a fading trail of light behind it (the core and halo are drawn on top)
        if (!reduceMotion) {
          for (let k = 1; k < TRAIL_N; k++) {
            const u = k / TRAIL_N;
            this.glows.push(tr[o + k * 2], tr[o + k * 2 + 1], 0.026 * (1 - u * 0.6), 0.42 * (1 - u) * f.glow);
          }
        }
        drawFirefly(this.glows, f.x, f.y, f.glow, i, time, reduceMotion);
        if (river) drawReflection(this.glows, f.x, view.waterY, f.glow, f.y, time);
      } else if (f.eaten > 0) {
        // a burst of light where it was caught
        const e = easeOutCubic(f.eaten);
        this.glows.push(f.x, f.y, 0.05 + e * 0.16, (1 - e) * 0.95);
      }
      this.trailAlive[i] = f.alive;
    }
    if (view.sparkle > 0.02 && !reduceMotion) {
      for (let k = 0; k < 10; k++) {
        const ang = k * 2.399 + time * 0.7;
        const rr = 0.12 + 0.25 * easeOutCubic(1 - view.sparkle) + (k % 3) * 0.04;
        this.glows.push(Math.cos(ang) * rr * 1.3, Math.sin(ang) * rr + 0.05, 0.018, view.sparkle * (0.5 + 0.5 * Math.sin(time * 12 + k)));
      }
    }
    this.glows.end();
    this.details.end();
    this.holes.end();
  }

  /**
   * A hand that is no longer tracked keeps its last shadow for a moment and
   * dissolves it (eased), instead of vanishing in one frame.
   */
  private dissolveLost(model: ShadowModel, dt: number): void {
    for (let ai = 0; ai < model.actors.length && ai < 4; ai++) {
      const a = model.actors[ai];
      const buf = this.lostCaps[ai];
      if (a.present) {
        let n = 0;
        const end = a.capsuleStart + a.capsuleCount;
        for (let i = a.capsuleStart; i < end && n < LOST_MAX; i++, n++) {
          const c = model.capsules[i];
          const o = n * 8;
          buf[o] = c.ax;
          buf[o + 1] = c.ay;
          buf[o + 2] = c.bx;
          buf[o + 3] = c.by;
          buf[o + 4] = c.r;
          buf[o + 5] = c.rb ?? c.r;
          buf[o + 6] = c.soft;
          buf[o + 7] = c.fadeB ?? 1;
        }
        this.lostN[ai] = n;
        this.lostFade[ai] = n > 0 ? 1 : 0;
        continue;
      }
      if (this.lostFade[ai] <= 0) continue;
      this.lostFade[ai] = Math.max(0, this.lostFade[ai] - dt / LOST_FADE);
      const f = this.lostFade[ai];
      const k = f * f * (3 - 2 * f);
      for (let n = 0; n < this.lostN[ai]; n++) {
        const o = n * 8;
        this.hands.pushRaw(buf[o], buf[o + 1], buf[o + 2], buf[o + 3], buf[o + 4], buf[o + 6], k, buf[o + 5], buf[o + 7]);
      }
    }
  }

  /** Debug/test: the crocodile overlay's smoothed eye position, or null. */
  debugCroc(): [number, number] | null {
    return this.crocOverlay.eye();
  }

  /** Copies an actor's palm contour into a palm mesh (strength = shadow opacity). */
  private updatePalm(palm: Mesh, a: Actor, strength: number, hide = false): void {
    palm.visible = !hide && a.present && a.palmValid && strength > 0.005;
    if (!palm.visible) return;
    const attr = palm.geometry.getAttribute('position') as BufferAttribute;
    const arr = attr.array as Float32Array;
    for (let k = 0; k < PALM_POINTS; k++) {
      arr[k * 3] = a.palm[k * 2];
      arr[k * 3 + 1] = a.palm[k * 2 + 1];
      arr[k * 3 + 2] = 0;
    }
    attr.needsUpdate = true;
    (palm.material as ShaderMaterial).uniforms.uStrength.value = strength;
  }

  render(renderer: WebGLRenderer): void {
    const xr = renderer.xr;
    const prevXr = xr.enabled;
    const prevTarget = renderer.getRenderTarget();
    const prevAlpha = renderer.getClearAlpha();
    renderer.getClearColor(this.prevClear);
    xr.enabled = false;
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(this.clearColor, 0);
    renderer.clear(true, false, false);
    renderer.render(this.scene, this.camera);
    this.lastCalls = renderer.info.render.calls;
    this.lastTriangles = renderer.info.render.triangles;
    // Penumbra: blur the cast-shadow channel, horizontal then vertical.
    // Both radii are in stage units, so the look is the same at every quality level.
    const widthUnits = this.aspect + 2 * STAGE_PAD;
    const pxPerUnit = this.target.width / widthUnits;
    const radiusPx = Math.min(32, this.penumbra * pxPerUnit);
    const paperPx = PAPER_EDGE * pxPerUnit;
    {
      const u = this.blurMat.uniforms;
      const k = radiusPx / 4; // 4 taps per side span the radius
      const kp = paperPx / 4;
      u.tSrc.value = this.target.texture;
      (u.uStep.value as Vector4).set(k / this.target.width, 0, kp / this.target.width, 0);
      renderer.setRenderTarget(this.temp);
      renderer.render(this.blurScene, this.blurCam);
      u.tSrc.value = this.temp.texture;
      (u.uStep.value as Vector4).set(0, k / this.target.height, 0, kp / this.target.height);
      renderer.setRenderTarget(this.target);
      renderer.render(this.blurScene, this.blurCam);
      this.lastCalls += 2;
    }
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(this.prevClear, prevAlpha);
    xr.enabled = prevXr;
  }

  private readonly prevClear = new Color();
  /** Draw calls / triangles of the last offscreen pass (perf budget checks). */
  lastCalls = 0;
  lastTriangles = 0;
}
