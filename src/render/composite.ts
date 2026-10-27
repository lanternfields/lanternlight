/**
 * Main-scene visuals for the stage:
 *  - StageComposite: the lit wall patch / paper scroll that turns the shadow
 *    mask into lamplight and shadow (one quad, one texture fetch).
 *  - RoomDim: an inside-out sphere that dims the real room like theatre house
 *    lights, leaving the stage and the lantern's glow bright.
 *  - Scroll rods: the wooden dowels of the paper scroll fallback stage.
 */
import {
  BackSide,
  CylinderGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  PlaneGeometry,
  ShaderMaterial,
  SphereGeometry,
  Texture,
  Vector3,
} from '@iwsdk/core';
import { StageFrame } from '../core/projection.js';
import { STAGE_PAD } from './shadow-stage.js';

const STAGE_FRAG = /* glsl */ `
  uniform sampler2D tStage;
  uniform float uAspect;
  uniform float uPad;
  uniform float uLight;
  uniform float uWarmth;
  uniform float uFlicker;
  uniform float uFade;
  uniform float uScroll;
  uniform float uContrast;
  uniform float uDetail;
  uniform float uTime;
  uniform float uUnroll;
  varying vec2 vUv;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }

  void main() {
    vec2 st = vec2((vUv.x - 0.5) * (uAspect + 2.0 * uPad), (vUv.y - 0.5) * (1.0 + 2.0 * uPad));
    vec4 m = texture2D(tStage, vUv);
    float shadow = clamp(max(m.r, m.g) * (1.0 - m.a), 0.0, 1.0);
    float glow = m.b;
    vec2 q = vec2(st.x / (uAspect * 0.5 + 0.03), st.y / 0.58);
    float pool = 1.0 - smoothstep(0.5, 1.04, length(q));
    pool *= uLight * (0.94 + 0.06 * uFlicker);
    vec3 warm = mix(vec3(1.0, 0.64, 0.3), vec3(1.0, 0.78, 0.46), uWarmth);
    vec3 shadowCol = vec3(0.03, 0.022, 0.028);
    vec3 glowCol = vec3(1.0, 0.86, 0.48);
    if (uContrast > 0.5) {
      warm = vec3(1.0, 0.96, 0.88);
      shadowCol = vec3(0.0);
      glowCol = vec3(1.0, 0.95, 0.6);
    }
    if (uScroll > 0.5) {
      float halfW = uAspect * 0.5;
      float halfH = 0.5 * uUnroll;
      float inX = 1.0 - smoothstep(halfW - 0.004, halfW + 0.004, abs(st.x));
      float inY = 1.0 - smoothstep(halfH - 0.004, halfH + 0.004, abs(st.y - (0.5 - halfH)));
      float paperMask = inX * inY;
      if (paperMask < 0.002) discard;
      float fibers = uDetail * (vnoise(st * vec2(90.0, 14.0)) * 0.6 + vnoise(st * 220.0) * 0.4);
      vec3 paper = (uContrast > 0.5 ? vec3(0.98) : vec3(0.95, 0.9, 0.8)) * (0.93 + 0.07 * fibers);
      float edge = smoothstep(halfW - 0.05, halfW, abs(st.x)) * 0.12;
      vec3 lit = paper * (0.16 + 1.05 * pool * warm) * (1.0 - edge);
      float sh = shadow * (0.25 + 0.75 * smoothstep(0.0, 0.35, pool));
      vec3 col = mix(lit, shadowCol + paper * 0.03, sh);
      col += glow * glowCol * 0.85;
      gl_FragColor = vec4(col, paperMask * 0.97 * (1.0 - uFade * 0.6));
    } else {
      float lightA = uContrast > 0.5 ? 0.55 : 0.42;
      float shadowA = uContrast > 0.5 ? 0.97 : 0.88;
      float a = pool * mix(lightA, shadowA, shadow);
      vec3 col = mix(warm, shadowCol, shadow);
      col = mix(col, glowCol, clamp(glow, 0.0, 1.0));
      a = max(a, clamp(glow, 0.0, 1.0) * 0.9 * min(1.0, pool * 1.5 + 0.2));
      a *= (1.0 - uFade);
      if (a < 0.002) discard;
      gl_FragColor = vec4(col, a);
    }
  }
`;

export class StageComposite {
  readonly mesh: Mesh;
  readonly material: ShaderMaterial;
  readonly rods = new Group();
  private readonly basis = new Matrix4();

  constructor(stageTexture: Texture) {
    this.material = new ShaderMaterial({
      uniforms: {
        tStage: { value: stageTexture },
        uAspect: { value: 1.45 },
        uPad: { value: STAGE_PAD },
        uLight: { value: 0 },
        uWarmth: { value: 0 },
        uFlicker: { value: 0 },
        uFade: { value: 0 },
        uScroll: { value: 0 },
        uContrast: { value: 0 },
        uDetail: { value: 1 },
        uTime: { value: 0 },
        uUnroll: { value: 1 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: STAGE_FRAG,
      transparent: true,
      depthWrite: false,
      blending: NormalBlending,
    });
    this.mesh = new Mesh(new PlaneGeometry(1, 1), this.material);
    this.mesh.renderOrder = 10;
    this.mesh.frustumCulled = false;
    // Scroll dowels (unlit, warm-lit wood).
    const wood = new MeshBasicMaterial({ color: 0x5a3a24 });
    const capMat = new MeshBasicMaterial({ color: 0x2b1b12 });
    for (const y of [0.5, -0.5]) {
      const rod = new Mesh(new CylinderGeometry(0.5, 0.5, 1, 12, 1), wood);
      rod.rotation.z = Math.PI / 2;
      rod.userData.y = y;
      this.rods.add(rod);
      for (const side of [-1, 1]) {
        const cap = new Mesh(new CylinderGeometry(0.7, 0.7, 1, 12, 1), capMat);
        cap.rotation.z = Math.PI / 2;
        cap.userData.y = y;
        cap.userData.side = side;
        this.rods.add(cap);
      }
    }
    this.rods.visible = false;
  }

  /** Positions the quad (and scroll rods) on the stage frame. */
  place(frame: StageFrame, scroll: boolean): void {
    const { origin, right, up, normal, height, aspect } = frame;
    this.basis.makeBasis(
      new Vector3(right.x, right.y, right.z),
      new Vector3(up.x, up.y, up.z),
      new Vector3(normal.x, normal.y, normal.z),
    );
    this.mesh.position.set(origin.x, origin.y, origin.z);
    this.mesh.quaternion.setFromRotationMatrix(this.basis);
    this.mesh.scale.set((aspect + 2 * STAGE_PAD) * height, (1 + 2 * STAGE_PAD) * height, 1);
    this.material.uniforms.uAspect.value = aspect;
    this.material.uniforms.uScroll.value = scroll ? 1 : 0;
    this.rods.visible = scroll;
    if (scroll) {
      this.rods.position.copy(this.mesh.position);
      this.rods.quaternion.copy(this.mesh.quaternion);
      const w = aspect * height;
      const r = 0.011;
      for (const child of this.rods.children) {
        const side = child.userData.side as number | undefined;
        const y = (child.userData.y as number) * height;
        if (side === undefined) {
          child.position.set(0, y + Math.sign(y) * r * 0.6, 0.012);
          child.scale.set(r * 2, w + 0.05, r * 2);
        } else {
          child.position.set(side * (w / 2 + 0.03), y + Math.sign(y) * r * 0.6, 0.012);
          child.scale.set(r * 2.2, 0.012, r * 2.2);
        }
      }
    }
  }
}

/** House lights: dims passthrough everywhere except the lit stage and lantern. */
export class RoomDim {
  readonly mesh: Mesh;
  readonly material: ShaderMaterial;
  constructor() {
    this.material = new ShaderMaterial({
      uniforms: {
        uDim: { value: 0 },
        uOrigin: { value: new Vector3() },
        uNormal: { value: new Vector3(0, 0, 1) },
        uRight: { value: new Vector3(1, 0, 0) },
        uUp: { value: new Vector3(0, 1, 0) },
        uHeight: { value: 1 },
        uAspect: { value: 1.45 },
        uPool: { value: 0 },
        uLantern: { value: new Vector3(0, 0.8, -0.3) },
        uLanternGlow: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uDim;
        uniform vec3 uOrigin;
        uniform vec3 uNormal;
        uniform vec3 uRight;
        uniform vec3 uUp;
        uniform float uHeight;
        uniform float uAspect;
        uniform float uPool;
        uniform vec3 uLantern;
        uniform float uLanternGlow;
        varying vec3 vWorld;
        void main() {
          vec3 ro = cameraPosition;
          vec3 rd = normalize(vWorld - ro);
          float hole = 0.0;
          float denom = dot(uNormal, rd);
          if (denom < -1e-4) {
            float t = dot(uNormal, uOrigin - ro) / denom;
            if (t > 0.0) {
              vec3 hit = ro + rd * t - uOrigin;
              vec2 st = vec2(dot(hit, uRight), dot(hit, uUp)) / uHeight;
              vec2 q = vec2(st.x / (uAspect * 0.5 + 0.1), st.y / 0.7);
              hole = (1.0 - smoothstep(0.45, 1.25, length(q))) * uPool;
            }
          }
          // Lantern light spilling on the table and the viewer's hands.
          vec3 toL = uLantern - ro;
          float along = max(dot(toL, rd), 0.0);
          float miss = length(toL - rd * along);
          float spill = exp(-pow(miss / 0.33, 2.0)) * uLanternGlow;
          float a = uDim * (1.0 - max(hole * 0.9, spill * 0.75));
          gl_FragColor = vec4(0.012, 0.01, 0.02, a);
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      side: BackSide,
    });
    this.mesh = new Mesh(new SphereGeometry(6, 32, 16), this.material);
    this.mesh.renderOrder = -100;
    this.mesh.frustumCulled = false;
  }

  setStage(frame: StageFrame): void {
    const u = this.material.uniforms;
    (u.uOrigin.value as Vector3).set(frame.origin.x, frame.origin.y, frame.origin.z);
    (u.uNormal.value as Vector3).set(frame.normal.x, frame.normal.y, frame.normal.z);
    (u.uRight.value as Vector3).set(frame.right.x, frame.right.y, frame.right.z);
    (u.uUp.value as Vector3).set(frame.up.x, frame.up.y, frame.up.z);
    u.uHeight.value = frame.height;
    u.uAspect.value = frame.aspect;
  }
}
