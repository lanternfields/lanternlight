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
  uniform float uLift;
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
    // cut-outs are paper in front of the light: they hide glows behind them
    float glow = m.b * (1.0 - 0.92 * clamp(m.g * (1.0 - m.a), 0.0, 1.0));
    vec2 q = vec2(st.x / (uAspect * 0.5 + 0.03), st.y / 0.58);
    float qr = length(q);
    // lamplight: a hot core, a long warm falloff, a soft tail into the room
    float pool = (1.0 - smoothstep(0.42, mix(1.06, 1.28, uLift), qr)) * (0.82 + 0.18 * (1.0 - smoothstep(0.0, 0.55, qr)));
    // recordings: a longer, softer tail so a phone screen can read the edges
    pool += uLift * 0.1 * (1.0 - smoothstep(0.9, 1.7, qr));
    pool *= uLight * (0.94 + 0.06 * uFlicker);
    // colour temperature: lamp-core at the centre, lamp-mid, lamp-edge at the rim
    vec3 core = vec3(1.0, 0.851, 0.627);
    vec3 mid = vec3(0.969, 0.651, 0.353);
    vec3 rim = vec3(0.722, 0.329, 0.118);
    vec3 warm = mix(mix(core, mid, smoothstep(0.05, 0.6, qr)), rim, smoothstep(0.6, 1.0, qr));
    warm = mix(warm, core, uWarmth * 0.5);
    vec3 shadowCol = vec3(0.031, 0.024, 0.02);
    vec3 glowCol = vec3(1.0, 0.902, 0.659);
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
      float pa = paperMask * 0.97 * (1.0 - uFade * 0.6);
      gl_FragColor = vec4(col * pa, pa); // premultiplied
    } else {
      // Premultiplied: lamplight ADDS warm light over the real wall (it can
      // brighten, not just tint), shadows darken it. out = rgb + (1-a)*wall.
      float lit = pool * (1.0 - shadow);
      float addK = uContrast > 0.5 ? 0.62 : 0.52;
      vec3 add = (uContrast > 0.5 ? vec3(1.0, 0.96, 0.88) : warm) * lit * addK;
      float dimA = lit * (uContrast > 0.5 ? 0.22 : 0.16); // a little multiply = richer colour
      float shadowA = (uContrast > 0.5 ? 0.97 : 0.88) * shadow * smoothstep(0.0, 0.25, pool);
      vec3 rgb = add * (1.0 - shadowA) + shadowCol * shadowA;
      float g = clamp(glow, 0.0, 1.0) * min(1.0, pool * 1.5 + 0.25);
      rgb += glowCol * g * 0.9;
      float a = max(dimA, shadowA) + g * 0.2;
      float f = 1.0 - uFade;
      rgb *= f;
      a *= f;
      if (a < 0.002 && dot(rgb, rgb) < 1e-5) discard;
      gl_FragColor = vec4(rgb, a);
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
        uLift: { value: 0 },
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
      premultipliedAlpha: true,
    });
    this.mesh = new Mesh(new PlaneGeometry(1, 1), this.material);
    this.mesh.renderOrder = 10;
    this.mesh.frustumCulled = false;
    // Scroll dowels (unlit, warm-lit wood).
    const wood = new MeshBasicMaterial({ color: 0x5a3a24 });
    const capMat = new MeshBasicMaterial({ color: 0x2b1b12 });
    for (const y of [0.5, -0.5]) {
      const rod = new Mesh(new CylinderGeometry(0.5, 0.5, 1, 32, 1), wood);
      rod.rotation.z = Math.PI / 2;
      rod.userData.y = y;
      this.rods.add(rod);
      for (const side of [-1, 1]) {
        const cap = new Mesh(new CylinderGeometry(0.7, 0.7, 1, 32, 1), capMat);
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
        uFake: { value: 0 },
        uFloorY: { value: 0 },
        uHouse: { value: 1 },
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
        uniform float uFake;
        uniform float uFloorY;
        uniform float uHouse;
        varying vec3 vWorld;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vnoise(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
        }
        float fbm(vec2 p) { return vnoise(p) * 0.55 + vnoise(p * 2.7 + 3.1) * 0.3 + vnoise(p * 7.9 + 1.7) * 0.15; }
        /**
         * Capture only (the desktop emulator has no real room): a believable
         * dim room - a plaster wall lit by the lantern's spill around the stage,
         * a dark wooden floor, darkness beyond. Opaque, so the emulator's grey
         * placeholder room never shows. Never used with real passthrough.
         */
        vec4 fakeRoom(vec3 ro, vec3 rd) {
          float tw = 1e9;
          vec2 st = vec2(0.0);
          float dn = dot(uNormal, rd);
          if (dn < -1e-4) {
            float t = dot(uNormal, uOrigin - ro) / dn;
            if (t > 0.0) {
              tw = t;
              vec3 hit = ro + rd * t - uOrigin;
              st = vec2(dot(hit, uRight), dot(hit, uUp));
            }
          }
          float tf = rd.y < -1e-4 ? (uFloorY - ro.y) / rd.y : 1e9;
          vec3 lampCol = vec3(1.0, 0.62, 0.32);
          vec3 col = vec3(0.012, 0.009, 0.008);
          if (tw < tf && tw < 1e8) {
            // plaster: soft large blotches, fine grain, a hint of trowel strokes
            float g = fbm(st * 2.2) * 0.6 + fbm(st * 9.0 + 4.0) * 0.3 + vnoise(st * vec2(40.0, 22.0)) * 0.1;
            vec3 albedo = vec3(0.64, 0.57, 0.5) * (0.86 + 0.26 * g);
            // lamplight falls off around the stage (a warm vignette), darker far away
            vec2 q = vec2(st.x / (uHeight * (uAspect * 0.5 + 0.35)), st.y / (uHeight * 0.85));
            float r = length(q);
            float spill = exp(-r * r * 0.55) * 0.46 + exp(-r * r * 2.4) * 0.22;
            // the lantern's own glow on the wall below and beside it
            vec3 wp = uOrigin + uRight * st.x + uUp * st.y;
            float dl = length(wp - uLantern);
            spill += 0.1 / (1.0 + dl * dl * 6.0);
            col = albedo * (0.045 + 0.2 * uHouse + lampCol * spill * uLanternGlow);
          } else if (tf < 1e8) {
            vec3 hit = ro + rd * tf;
            float grain = vnoise(vec2(hit.x * 1.5, hit.z * 26.0)) * 0.5 + vnoise(hit.xz * 6.0) * 0.5;
            vec3 wood = vec3(0.16, 0.1, 0.065) * (0.8 + 0.3 * grain);
            float dl = length(hit.xz - uLantern.xz);
            float spill = 0.75 / (1.0 + dl * dl * 4.0) + 0.12 * exp(-pow(length(hit - uOrigin) / (uHeight * 2.5), 2.0));
            col = wood * (0.045 + 0.2 * uHouse + lampCol * spill * uLanternGlow);
          }
          return vec4(col, 1.0);
        }
        void main() {
          vec3 ro = cameraPosition;
          vec3 rd = normalize(vWorld - ro);
          if (uFake > 0.5) {
            gl_FragColor = fakeRoom(ro, rd);
            return;
          }
          float hole = 0.0;
          float spillWall = 0.0;
          float denom = dot(uNormal, rd);
          if (denom < -1e-4) {
            float t = dot(uNormal, uOrigin - ro) / denom;
            if (t > 0.0) {
              vec3 hit = ro + rd * t - uOrigin;
              vec2 st = vec2(dot(hit, uRight), dot(hit, uUp)) / uHeight;
              vec2 q = vec2(st.x / (uAspect * 0.5 + 0.1), st.y / 0.7);
              hole = (1.0 - smoothstep(0.45, 1.25, length(q))) * uPool;
              spillWall = (1.0 - smoothstep(0.7, 1.9, length(q))) * uPool;
            }
          }
          // Lantern light spilling on the table and the viewer's hands.
          vec3 toL = uLantern - ro;
          float along = max(dot(toL, rd), 0.0);
          float miss = length(toL - rd * along);
          float spill = exp(-pow(miss / 0.33, 2.0)) * uLanternGlow;
          float a = uDim * (1.0 - max(hole * 0.9, spill * 0.75));
          // house lights down to a warm black; around the stage the room is
          // lamp-lit amber rather than revealed grey (STYLE_GUIDE palette)
          vec3 house = vec3(0.043, 0.027, 0.02);
          vec3 lampSpill = vec3(0.36, 0.17, 0.06);
          float w = clamp(max(spillWall * 0.75, spill * 0.6), 0.0, 1.0);
          vec3 col = mix(house, lampSpill, w);
          a = max(a, w * 0.42 * step(0.001, uDim));
          gl_FragColor = vec4(col, a);
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
