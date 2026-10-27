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
 * Instanced tapered ("uneven") capsules with exact 2D signed distance, so a
 * finger narrows from knuckle to a round tip with no steps at the joints.
 * Per instance: iSeg = (ax, ay, bx, by), iRad = (ra, rb, edge, strength),
 * iFade = strength multiplier at b (the forearm fades out).
 * SDF after Inigo Quilez, "2D distance functions: uneven capsule" (MIT).
 */
export function createCapsuleMaterial(channel: Vector4): ShaderMaterial {
  return maxBlend(
    new ShaderMaterial({
      uniforms: { uChannel: { value: channel.clone() }, uStrength: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute vec4 iSeg;
        attribute vec4 iRad;
        attribute float iFade;
        varying vec2 vP;
        varying vec4 vSeg;
        varying vec4 vRad;
        varying float vFade;
        void main() {
          vec2 a = iSeg.xy;
          vec2 b = iSeg.zw;
          vec2 axis = b - a;
          float len = length(axis);
          vec2 dir = len > 1e-6 ? axis / len : vec2(1.0, 0.0);
          vec2 perp = vec2(-dir.y, dir.x);
          float e = max(iRad.x, iRad.y) + iRad.z;
          vec2 c = (a + b) * 0.5;
          vec2 p = c + dir * position.x * (len + 2.0 * e) + perp * position.y * (2.0 * e);
          vP = p;
          vSeg = iSeg;
          vRad = iRad;
          vFade = iFade;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 0.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec4 uChannel;
        uniform float uStrength;
        varying vec2 vP;
        varying vec4 vSeg;
        varying vec4 vRad;
        varying float vFade;
        float cro(vec2 a, vec2 b) { return a.x * b.y - a.y * b.x; }
        float sdUnevenCapsule(vec2 p, vec2 pa, vec2 pb, float ra, float rb) {
          p -= pa;
          pb -= pa;
          float h = dot(pb, pb);
          float b = ra - rb;
          if (h <= b * b + 1e-10) return length(p) - max(ra, rb);
          vec2 q = vec2(dot(p, vec2(pb.y, -pb.x)), dot(p, pb)) / h;
          q.x = abs(q.x);
          vec2 c = vec2(sqrt(h - b * b), b);
          float k = cro(c, q);
          float m = dot(c, q);
          float n = dot(q, q);
          if (k < 0.0) return sqrt(h * n) - ra;
          else if (k > c.x) return sqrt(h * (n + 1.0 - 2.0 * q.y)) - rb;
          return m - ra;
        }
        void main() {
          vec2 a = vSeg.xy;
          vec2 b = vSeg.zw;
          float d = sdUnevenCapsule(vP, a, b, vRad.x, vRad.y);
          float w = max(vRad.z, 0.0015);
          float v = 1.0 - smoothstep(-w * 0.5, w * 0.5, d);
          if (v <= 0.002) discard;
          vec2 ba = b - a;
          float t = clamp(dot(vP - a, ba) / max(dot(ba, ba), 1e-9), 0.0, 1.0);
          float fade = mix(1.0, vFade, smoothstep(0.35, 1.0, t));
          gl_FragColor = uChannel * (v * vRad.w * fade * uStrength);
        }
      `,
    }),
  );
}

/**
 * Separable gaussian blur of the cast-shadow channel (R) only; the cut-out,
 * light and hole channels pass through crisp. 9 taps, radius in texels.
 */
export function createShadowBlurMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      tSrc: { value: null },
      uStep: { value: new Vector4(0, 0, 0, 0) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy * 2.0, 0.0, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D tSrc;
      uniform vec4 uStep; // xy = texel step along the blur axis (already scaled by radius/4)
      varying vec2 vUv;
      void main() {
        vec4 c = texture2D(tSrc, vUv);
        float r = c.r * 0.2270270270;
        r += texture2D(tSrc, vUv + uStep.xy * 1.0).r * 0.1945945946;
        r += texture2D(tSrc, vUv - uStep.xy * 1.0).r * 0.1945945946;
        r += texture2D(tSrc, vUv + uStep.xy * 2.0).r * 0.1216216216;
        r += texture2D(tSrc, vUv - uStep.xy * 2.0).r * 0.1216216216;
        r += texture2D(tSrc, vUv + uStep.xy * 3.0).r * 0.0540540541;
        r += texture2D(tSrc, vUv - uStep.xy * 3.0).r * 0.0540540541;
        r += texture2D(tSrc, vUv + uStep.xy * 4.0).r * 0.0162162162;
        r += texture2D(tSrc, vUv - uStep.xy * 4.0).r * 0.0162162162;
        gl_FragColor = vec4(r, c.g, c.b, c.a);
      }
    `,
    depthTest: false,
    depthWrite: false,
  });
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
