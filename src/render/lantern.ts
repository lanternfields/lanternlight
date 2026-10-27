/**
 * The paper lantern: a procedural lathe body with bamboo ribs, wooden caps and
 * a handle, glowing from inside. On a table it throws a warm pool onto the
 * real surface; with no table it floats like a sky-lantern, breathing gently.
 * ~1.1k triangles, 5 draw calls, no textures.
 */
import {
  AdditiveBlending,
  CircleGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  ShaderMaterial,
  TorusGeometry,
  Vector2,
} from '@iwsdk/core';

export class Lantern {
  readonly group = new Group();
  readonly body: Mesh;
  private readonly bodyMat: ShaderMaterial;
  private readonly halo: Mesh;
  private readonly haloMat: ShaderMaterial;
  private readonly pool: Mesh;
  private readonly poolMat: ShaderMaterial;
  /** Visual centre of the flame relative to the group origin (metres). */
  readonly flameOffset = 0.085;
  private baseY = 0;
  floating = false;
  flame = 0;
  private flickerSeed = Math.random() * 100;
  flicker = 0;

  constructor() {
    const pts: Vector2[] = [];
    const n = 14;
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const y = 0.022 + u * 0.13;
      const r = 0.026 + Math.sin(u * Math.PI) * 0.034 + (u < 0.1 ? 0.004 : 0);
      pts.push(new Vector2(r, y));
    }
    this.bodyMat = new ShaderMaterial({
      uniforms: { uFlame: { value: 0 }, uFlicker: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vN;
        varying vec3 vView;
        void main() {
          vUv = uv;
          vN = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vView = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uFlame;
        uniform float uFlicker;
        varying vec2 vUv;
        varying vec3 vN;
        varying vec3 vView;
        void main() {
          // Thin bamboo ribs and paper seams, lit from inside by the flame.
          float ribs = smoothstep(0.0, 0.035, abs(fract(vUv.x * 10.0) - 0.5) * 2.0 - 0.015);
          float bands = 1.0 - 0.22 * (1.0 - smoothstep(0.0, 0.05, abs(fract(vUv.y * 5.0 + 0.5) - 0.5)));
          float facing = abs(dot(normalize(vN), normalize(vView)));
          float inner = mix(0.7, 1.0, facing);
          float core = 1.0 - smoothstep(0.0, 0.9, abs(vUv.y - 0.5) * 2.0);
          float lum = uFlame * (0.65 + 0.35 * core) * inner * (0.92 + 0.08 * uFlicker);
          vec3 cool = vec3(0.36, 0.3, 0.24);   // unlit paper
          vec3 hot = vec3(1.0, 0.72, 0.4);     // glowing paper
          vec3 white = vec3(1.0, 0.93, 0.78);  // hot spot round the flame
          vec3 col = mix(cool, hot, smoothstep(0.0, 0.8, lum));
          col = mix(col, white, smoothstep(0.75, 1.0, lum * core));
          col *= mix(0.72, 1.0, ribs) * bands;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
      side: DoubleSide,
    });
    this.body = new Mesh(new LatheGeometry(pts, 20), this.bodyMat);
    const wood = new MeshBasicMaterial({ color: 0x3a2618 });
    const top = new Mesh(new CylinderGeometry(0.028, 0.03, 0.012, 16), wood);
    top.position.y = 0.158;
    const base = new Mesh(new CylinderGeometry(0.03, 0.032, 0.014, 16), wood);
    base.position.y = 0.012;
    const handle = new Mesh(new TorusGeometry(0.022, 0.0028, 6, 18, Math.PI), wood);
    handle.position.y = 0.164;
    this.haloMat = new ShaderMaterial({
      uniforms: { uI: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv * 2.0 - 1.0;
          // camera-facing billboard
          vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          mv.xy += position.xy * vec2(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz));
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uI;
        varying vec2 vUv;
        void main() {
          float r = length(vUv);
          float g = (exp(-r * r * 9.0) * 0.8 + exp(-r * r * 2.5) * 0.35) * uI;
          gl_FragColor = vec4(vec3(1.0, 0.64, 0.3) * g, 0.0);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      // premultiplied additive = blendFunc(ONE, ONE): pure added light over passthrough
      premultipliedAlpha: true,
    });
    this.halo = new Mesh(new PlaneGeometry(0.5, 0.5), this.haloMat);
    this.halo.position.y = this.flameOffset;
    this.halo.renderOrder = 20;
    this.poolMat = new ShaderMaterial({
      uniforms: { uI: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform float uI;
        varying vec2 vUv;
        void main() {
          float r = length(vUv);
          float g = (1.0 - smoothstep(0.0, 1.0, r)) * uI;
          gl_FragColor = vec4(vec3(1.0, 0.6, 0.26) * g * 0.5, 0.0);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      // premultiplied additive = blendFunc(ONE, ONE): pure added light over passthrough
      premultipliedAlpha: true,
    });
    this.pool = new Mesh(new CircleGeometry(0.3, 32), this.poolMat);
    this.pool.rotation.x = -Math.PI / 2;
    this.pool.position.y = 0.002;
    this.pool.renderOrder = 5;
    this.group.add(this.body, top, base, handle, this.halo, this.pool);
  }

  place(x: number, y: number, z: number, onSurface: boolean): void {
    this.group.position.set(x, y, z);
    this.baseY = y;
    this.floating = !onSurface;
    this.pool.visible = onSurface;
  }

  /** World-space flame centre written into out (x, y, z). */
  flamePosition(out: { x: number; y: number; z: number }): void {
    out.x = this.group.position.x;
    out.y = this.group.position.y + this.flameOffset;
    out.z = this.group.position.z;
  }

  update(time: number, flame: number, reduceMotion: boolean): void {
    this.flame = flame;
    const f =
      Math.sin(time * 7.3 + this.flickerSeed) * 0.5 +
      Math.sin(time * 13.1 + this.flickerSeed * 2) * 0.3 +
      Math.sin(time * 23.7) * 0.2;
    this.flicker = reduceMotion ? 0 : f;
    this.bodyMat.uniforms.uFlame.value = flame;
    this.bodyMat.uniforms.uFlicker.value = this.flicker;
    this.haloMat.uniforms.uI.value = flame * (0.85 + 0.15 * this.flicker);
    this.poolMat.uniforms.uI.value = flame * (0.9 + 0.1 * this.flicker);
    if (this.floating && !reduceMotion) {
      this.group.position.y = this.baseY + Math.sin(time * 0.9) * 0.008;
      this.group.rotation.z = Math.sin(time * 0.7) * 0.03;
    } else {
      this.group.position.y = this.baseY;
      this.group.rotation.z = 0;
    }
  }
}
