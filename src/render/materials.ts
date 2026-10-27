/**
 * Shader materials for the offscreen shadow stage.
 *
 * The stage render target is a 4-channel mask, written with MAX blending so
 * overlapping shapes union cleanly (no double-darkening):
 *   R: cast shadows (hands, rod puppets) - soft, penumbra-sized edges
 *   G: cut-out shadows (creatures, scenery, ghost hints)
 *   B: light (fireflies, sparkles, lantern-icons)
 *   A: holes (eyes cut into puppets let light through)
 */
import {
  CustomBlending,
  DoubleSide,
  MaxEquation,
  OneFactor,
  ShaderMaterial,
  Vector4,
} from '@iwsdk/core';

export const CH_SHADOW = new Vector4(1, 0, 0, 0);
export const CH_CUTOUT = new Vector4(0, 1, 0, 0);
export const CH_LIGHT = new Vector4(0, 0, 1, 0);
export const CH_HOLE = new Vector4(0, 0, 0, 1);

function maxBlend(m: ShaderMaterial): ShaderMaterial {
  m.blending = CustomBlending;
  m.blendEquation = MaxEquation;
  m.blendEquationAlpha = MaxEquation;
  m.blendSrc = OneFactor;
  m.blendDst = OneFactor;
  m.blendSrcAlpha = OneFactor;
  m.blendDstAlpha = OneFactor;
  m.transparent = true;
  m.depthTest = false;
  m.depthWrite = false;
  m.side = DoubleSide;
  return m;
}

/**
 * Instanced capsules with signed-distance soft edges.
 * Per instance: iSeg = (ax, ay, bx, by), iRad = (radius, softness, strength).
 */
export function createCapsuleMaterial(channel: Vector4): ShaderMaterial {
  return maxBlend(
    new ShaderMaterial({
      uniforms: { uChannel: { value: channel.clone() }, uStrength: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute vec4 iSeg;
        attribute vec3 iRad;
        varying vec2 vP;
        varying vec4 vSeg;
        varying vec3 vRad;
        void main() {
          vec2 a = iSeg.xy;
          vec2 b = iSeg.zw;
          vec2 axis = b - a;
          float len = length(axis);
          vec2 dir = len > 1e-6 ? axis / len : vec2(1.0, 0.0);
          vec2 perp = vec2(-dir.y, dir.x);
          float e = iRad.x + iRad.y;
          vec2 c = (a + b) * 0.5;
          vec2 p = c + dir * position.x * (len + 2.0 * e) + perp * position.y * (2.0 * e);
          vP = p;
          vSeg = iSeg;
          vRad = iRad;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 0.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec4 uChannel;
        uniform float uStrength;
        varying vec2 vP;
        varying vec4 vSeg;
        varying vec3 vRad;
        void main() {
          vec2 pa = vP - vSeg.xy;
          vec2 ba = vSeg.zw - vSeg.xy;
          float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-9), 0.0, 1.0);
          float d = length(pa - ba * h) - vRad.x;
          float w = max(vRad.y, 0.002);
          float v = 1.0 - smoothstep(-w * 0.5, w * 0.5, d);
          if (v <= 0.002) discard;
          gl_FragColor = uChannel * (v * vRad.z * uStrength);
        }
      `,
    }),
  );
}

/** Solid fill (palm polygons, puppet shapes). */
export function createFlatMaterial(channel: Vector4, strength = 1): ShaderMaterial {
  return maxBlend(
    new ShaderMaterial({
      uniforms: { uChannel: { value: channel.clone() }, uStrength: { value: strength } },
      vertexShader: /* glsl */ `
        void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform vec4 uChannel;
        uniform float uStrength;
        void main() { gl_FragColor = uChannel * uStrength; }
      `,
    }),
  );
}

/**
 * Instanced soft glow discs. Per instance: iGlow = (x, y, radius, intensity).
 */
export function createGlowMaterial(channel: Vector4): ShaderMaterial {
  return maxBlend(
    new ShaderMaterial({
      uniforms: { uChannel: { value: channel.clone() } },
      vertexShader: /* glsl */ `
        attribute vec4 iGlow;
        varying vec2 vUv;
        varying float vI;
        void main() {
          vUv = position.xy * 2.0;
          vI = iGlow.w;
          vec2 p = iGlow.xy + position.xy * 2.0 * iGlow.z;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 0.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec4 uChannel;
        varying vec2 vUv;
        varying float vI;
        void main() {
          float r = length(vUv);
          float core = exp(-r * r * 18.0);
          float halo = exp(-r * r * 3.0) * 0.45;
          float v = (core + halo) * vI * (1.0 - smoothstep(0.85, 1.0, r));
          if (v <= 0.002) discard;
          gl_FragColor = uChannel * v;
        }
      `,
    }),
  );
}

/** Menu lantern-icon: glowing ring with a dwell-fill arc. */
export function createIconMaterial(): ShaderMaterial {
  return maxBlend(
    new ShaderMaterial({
      uniforms: {
        uFill: { value: 0 },
        uVisible: { value: 0 },
        uDone: { value: 0 },
        uTime: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = position.xy * 2.0;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uFill;
        uniform float uVisible;
        uniform float uDone;
        uniform float uTime;
        varying vec2 vUv;
        const float PI = 3.14159265;
        void main() {
          float r = length(vUv);
          float ang = atan(vUv.x, vUv.y); // 0 at top, clockwise
          float a01 = fract(ang / (2.0 * PI) + 1.0);
          float ring = exp(-pow((r - 0.86) / 0.035, 2.0));
          float arc = ring * step(a01, uFill) * 1.6;
          float disc = (1.0 - smoothstep(0.0, 0.84, r)) * (0.22 + 0.1 * sin(uTime * 2.0));
          float light = (ring * 0.55 + arc + disc + uDone * 0.15 * (1.0 - smoothstep(0.7, 0.86, r))) * uVisible;
          if (light <= 0.002) discard;
          gl_FragColor = vec4(0.0, 0.0, min(light, 1.0), 0.0);
        }
      `,
    }),
  );
}
