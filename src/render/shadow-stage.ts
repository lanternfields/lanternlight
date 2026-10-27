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
  Scene,
  Shape,
  ShapeGeometry,
  UnsignedByteType,
  Vector4,
  WebGLRenderTarget,
  WebGLRenderer,
} from '@iwsdk/core';
import { Capsule2D, PALM_POINTS, ShadowModel, CROC_ROD_PUPPET } from '../core/shadow-model.js';
import { StageView, GROUND_T } from '../core/story.js';
import { ghostCapsules } from '../core/ghost.js';
import {
  CH_CUTOUT,
  CH_HOLE,
  CH_LIGHT,
  CH_SHADOW,
  createCapsuleMaterial,
  createFlatMaterial,
  createGlowMaterial,
  createIconMaterial,
} from './materials.js';

export const STAGE_PAD = 0.1;
/** Rabbit puppet scale (its model is ~0.15 stage units tall at 1). */
export const RABBIT_SCALE = 1.55;

class CapsuleBatch {
  readonly mesh: Mesh;
  private readonly geo: InstancedBufferGeometry;
  private readonly seg: Float32Array;
  private readonly rad: Float32Array;
  private readonly segAttr: InstancedBufferAttribute;
  private readonly radAttr: InstancedBufferAttribute;
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
    this.rad = new Float32Array(max * 3);
    this.segAttr = new InstancedBufferAttribute(this.seg, 4);
    this.radAttr = new InstancedBufferAttribute(this.rad, 3);
    this.segAttr.setUsage(35048); // DynamicDrawUsage
    this.radAttr.setUsage(35048);
    this.geo.setAttribute('iSeg', this.segAttr);
    this.geo.setAttribute('iRad', this.radAttr);
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
    this.rad[i * 3] = c.r * radiusScale;
    this.rad[i * 3 + 1] = softOverride >= 0 ? softOverride : c.soft;
    this.rad[i * 3 + 2] = strength;
  }

  pushRaw(ax: number, ay: number, bx: number, by: number, r: number, soft: number, strength = 1): void {
    if (this.count >= this.max) return;
    const i = this.count++;
    this.seg[i * 4] = ax;
    this.seg[i * 4 + 1] = ay;
    this.seg[i * 4 + 2] = bx;
    this.seg[i * 4 + 3] = by;
    this.rad[i * 3] = r;
    this.rad[i * 3 + 1] = soft;
    this.rad[i * 3 + 2] = strength;
  }

  end(): void {
    this.geo.instanceCount = this.count;
    this.segAttr.needsUpdate = true;
    this.radAttr.needsUpdate = true;
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

function ellipse(cx: number, cy: number, rx: number, ry: number, rot = 0, segments = 20): Shape {
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
  const idx: number[] = [];
  for (let i = 1; i < PALM_POINTS - 1; i++) idx.push(0, i, i + 1);
  geo.setIndex(idx);
  const m = new Mesh(geo, createFlatMaterial(CH_SHADOW));
  m.frustumCulled = false;
  return m;
}

export class ShadowStage {
  readonly target: WebGLRenderTarget;
  readonly scene = new Scene();
  readonly camera = new OrthographicCamera(-1, 1, 1, -1, -1, 1);
  aspect = 1.45;
  resolution = 512;

  private readonly hands = new CapsuleBatch(128, CH_SHADOW);
  private readonly palms: Mesh[] = [createPalm(), createPalm()];
  private readonly scenery = new CapsuleBatch(48, CH_CUTOUT);
  private readonly ghost = new CapsuleBatch(32, CH_CUTOUT);
  private readonly details = new CapsuleBatch(64, CH_CUTOUT);
  private readonly holes = new CapsuleBatch(8, CH_HOLE);
  private readonly glows = new GlowBatch(64);
  private readonly rabbit = createRabbitPuppet();
  private readonly iconRabbit = createRabbitPuppet();
  private readonly water = createWater(1.8);
  private readonly icons: Mesh[] = [];
  private readonly ghostBuf: Capsule2D[] = [];
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
    });
    this.scene.add(
      this.water.mesh,
      this.scenery.mesh,
      this.hands.mesh,
      this.palms[0],
      this.palms[1],
      this.ghost.mesh,
      this.details.mesh,
      this.rabbit.group,
      this.iconRabbit.group,
      this.glows.mesh,
      this.holes.mesh,
    );
    for (let i = 0; i < 2; i++) {
      const icon = new Mesh(new PlaneGeometry(1, 1), createIconMaterial());
      icon.frustumCulled = false;
      this.icons.push(icon);
      this.scene.add(icon);
    }
    for (let i = 0; i < 32; i++) this.ghostBuf.push({ ax: 0, ay: 0, bx: 0, by: 0, r: 0, soft: 0, actor: -2 });
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
    this.camera.left = -w / 2;
    this.camera.right = w / 2;
    this.camera.top = h / 2;
    this.camera.bottom = -h / 2;
    this.camera.updateProjectionMatrix();
  }

  update(model: ShadowModel, view: StageView, time: number, reduceMotion: boolean): void {
    // ---- cast shadows (hands & rod puppets)
    this.hands.begin();
    for (let i = 0; i < model.capsuleCount; i++) this.hands.push(model.capsules[i]);
    this.hands.end();
    for (let h = 0; h < 2; h++) {
      const a = model.actors[h];
      const palm = this.palms[h];
      palm.visible = a.present && a.palmValid;
      if (!palm.visible) continue;
      const attr = palm.geometry.getAttribute('position') as BufferAttribute;
      const arr = attr.array as Float32Array;
      for (let k = 0; k < PALM_POINTS; k++) {
        arr[k * 3] = a.palm[k * 2];
        arr[k * 3 + 1] = a.palm[k * 2 + 1];
        arr[k * 3 + 2] = 0;
      }
      attr.needsUpdate = true;
    }

    // ---- scenery
    this.scenery.begin();
    for (let i = 0; i < view.sceneryCount; i++) this.scenery.push(view.scenery[i]);
    // grass tufts along floor capsules
    for (let i = 0; i < view.sceneryCount; i++) {
      const c = view.scenery[i];
      if (Math.abs(c.by - c.ay) > 0.02 || Math.abs(c.bx - c.ax) < 0.2) continue;
      const top = Math.max(c.ay, c.by) + c.r;
      const x0 = Math.min(c.ax, c.bx);
      const x1 = Math.max(c.ax, c.bx);
      for (let x = x0 + 0.03; x < x1 - 0.02; x += 0.075) {
        const sway = reduceMotion ? 0 : Math.sin(time * 1.3 + x * 9) * 0.004;
        const hgt = 0.018 + ((x * 137) % 0.012);
        this.scenery.pushRaw(x, top - 0.004, x - 0.006 + sway, top + hgt, 0.0035, 0.003);
        this.scenery.pushRaw(x + 0.008, top - 0.004, x + 0.012 + sway, top + hgt * 0.8, 0.003, 0.003);
      }
    }
    // burrow mound
    if (view.burrow.visible > 0.01) {
      const b = view.burrow;
      this.scenery.pushRaw(b.s - 0.06, b.t + 0.005, b.s + 0.06, b.t + 0.005, 0.045, 0.004, b.visible);
    }
    this.scenery.end();

    // ---- water
    const hasWater = Number.isFinite(view.waterY);
    this.water.mesh.visible = hasWater;
    if (hasWater) this.water.update(view.waterY, time, reduceMotion);

    // ---- ghost hint
    this.ghost.begin();
    if (view.ghost.visible > 0.01) {
      const n = ghostCapsules(view.ghost.pose, view.ghost.s, view.ghost.t, view.ghost.scale, view.ghost.phase, this.ghostBuf, 32);
      const pulse = reduceMotion ? 1 : 0.8 + 0.2 * Math.sin(time * 2.2);
      for (let i = 0; i < n; i++) this.ghost.push(this.ghostBuf[i], view.ghost.visible * 0.62 * pulse);
    }
    this.ghost.end();

    // ---- details: crocodile overlay, icon glyphs
    this.details.begin();
    this.holes.begin();
    const croc = view.croc;
    if (croc.visible > 0.05) {
      // brow bump over the eye
      this.details.pushRaw(croc.eyeS - 0.022, croc.eyeT - 0.004, croc.eyeS + 0.018, croc.eyeT + 0.004, 0.017, 0.006, croc.visible);
      this.holes.pushRaw(croc.eyeS, croc.eyeT + 0.002, croc.eyeS, croc.eyeT + 0.002, 0.0085, 0.003, croc.visible);
      // teeth along both jaws, pointing into the mouth gap
      const open = croc.open;
      if (open > 0.15) {
        const ux = croc.eyeS - croc.upperS;
        const uy = croc.eyeT - croc.upperT;
        const len = Math.hypot(ux, uy) || 1;
        const dx = ux / len;
        const dy = uy / len;
        // perpendicular toward the lower jaw
        let px = -dy;
        let py = dx;
        if ((croc.lowerS - croc.upperS) * px + (croc.lowerT - croc.upperT) * py < 0) {
          px = -px;
          py = -py;
        }
        const tooth = 0.016 * Math.min(1, open * 1.5);
        for (let k = 1; k <= 4; k++) {
          const u = k * 0.028;
          const bx = croc.upperS + dx * u;
          const by = croc.upperT + dy * u;
          this.details.pushRaw(bx, by, bx + px * tooth, by + py * tooth, 0.0045, 0.003, croc.visible);
          const lx = croc.lowerS + dx * u;
          const ly = croc.lowerT + dy * u;
          this.details.pushRaw(lx, ly, lx - px * tooth * 0.8, ly - py * tooth * 0.8, 0.0042, 0.003, croc.visible);
        }
      }
    }
    // Menu icon glyphs.
    for (let i = 0; i < view.icons.length; i++) {
      const icon = view.icons[i];
      const mesh = this.icons[i];
      const mat = mesh.material as import('@iwsdk/core').ShaderMaterial;
      mesh.visible = icon.visible > 0.01 && view.scene === 'menu';
      mesh.position.set(icon.s, icon.t, 0);
      mesh.scale.setScalar(icon.r * 2);
      mat.uniforms.uFill.value = icon.fill;
      mat.uniforms.uVisible.value = icon.visible;
      mat.uniforms.uDone.value = icon.completed ? 1 : 0;
      mat.uniforms.uTime.value = time;
      if (!mesh.visible) continue;
      if (icon.id === 'croc') {
        // the croc puppet spans ~0.4 m; fit it inside the ring
        const k = (icon.r * 1.45) / 0.26;
        for (const part of CROC_ROD_PUPPET.slice(1)) {
          this.details.pushRaw(
            icon.s + (part.a[0] + 0.02) * k,
            icon.t + (part.a[1] - 0.2) * k,
            icon.s + (part.b[0] + 0.02) * k,
            icon.t + (part.b[1] - 0.2) * k,
            part.r * k,
            0.003,
            icon.visible,
          );
        }
      } else {
        // a little plank bridge under the icon rabbit
        this.details.pushRaw(icon.s - 0.07, icon.t - 0.045, icon.s + 0.07, icon.t - 0.045, 0.006, 0.003, icon.visible);
      }
    }
    const ir = this.iconRabbit.group;
    const bridgeIcon = view.icons[1];
    ir.visible = view.scene === 'menu' && bridgeIcon.visible > 0.05;
    ir.position.set(bridgeIcon.s - 0.005, bridgeIcon.t - 0.039, 0);
    ir.scale.setScalar(0.62);
    this.details.end();
    this.holes.end();

    // ---- rabbit
    const rv = view.rabbit;
    const rg = this.rabbit.group;
    rg.visible = rv.visible > 0.02;
    if (rg.visible) {
      rg.position.set(rv.x, rv.y, 0);
      const sq = rv.squash;
      const k = RABBIT_SCALE;
      rg.scale.set(rv.dir * (1 / Math.sqrt(sq)) * k, sq * k, 1);
      this.rabbit.body.rotation.z = rv.hopping ? 0.18 : 0;
      this.rabbit.ears.rotation.z = rv.hopping ? 0.25 : rv.peering ? -0.15 + Math.sin(time * 6) * 0.08 : Math.sin(time * 0.9) * 0.05;
      const fade = rv.visible;
      for (const child of [rg]) child.visible = fade > 0.02;
    }

    // ---- light: fireflies & sparkles
    this.glows.begin();
    for (let i = 0; i < view.fireflies.length; i++) {
      const f = view.fireflies[i];
      if (f.alive) {
        const flick = reduceMotion ? 1 : 0.75 + 0.25 * Math.sin(time * 9 + i * 1.7);
        this.glows.push(f.x, f.y, 0.04, f.glow * flick);
      } else if (f.eaten > 0) {
        // a little burst of light where it was eaten
        this.glows.push(f.x, f.y, 0.03 + f.eaten * 0.08, (1 - f.eaten) * 0.8);
      }
    }
    if (view.sparkle > 0.02 && !reduceMotion) {
      for (let k = 0; k < 10; k++) {
        const ang = k * 2.399 + time * 0.7;
        const rr = 0.12 + 0.25 * (1 - view.sparkle) + (k % 3) * 0.04;
        this.glows.push(Math.cos(ang) * rr * 1.3, Math.sin(ang) * rr + 0.05, 0.018, view.sparkle * (0.5 + 0.5 * Math.sin(time * 12 + k)));
      }
    }
    this.glows.end();
    void GROUND_T;
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
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(this.prevClear, prevAlpha);
    xr.enabled = prevXr;
  }

  private readonly prevClear = new Color();
  /** Draw calls / triangles of the last offscreen pass (perf budget checks). */
  lastCalls = 0;
  lastTriangles = 0;
}
