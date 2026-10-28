/**
 * A stand-in for your real hand where passthrough can't show it (the desktop
 * emulator, and the virtual theatre on headsets without passthrough): a
 * smooth, lantern-lit hand built from the same 25 tracked joints that cast
 * the shadow. Rounded joints, tapered bones and a soft palm; warm light from
 * the lantern, a touch of rim light, no outlines (STYLE_GUIDE 1).
 */
import {
  CylinderGeometry,
  InstancedMesh,
  Matrix4,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  Group,
  InstancedBufferAttribute,
} from '@iwsdk/core';
import { HandFrame, J, SHADOW_BONES } from '../core/hand-model.js';

const VERT = /* glsl */ `
  varying vec3 vN;
  varying vec3 vW;
  void main() {
    vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vW = w.xyz;
    vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;
// Tapered bones: a unit cylinder whose radius goes from iRad.x (bottom) to
// iRad.y (top), so each bone meets its joint spheres without a seam.
const BONE_VERT = /* glsl */ `
  attribute vec2 iRad;
  varying vec3 vN;
  varying vec3 vW;
  void main() {
    float r = mix(iRad.x, iRad.y, position.y + 0.5);
    vec3 p = vec3(position.x * r, position.y, position.z * r);
    vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.0);
    vW = w.xyz;
    vec3 n = normalize(vec3(normal.x, (iRad.x - iRad.y), normal.z));
    vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * n);
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;
const FRAG = /* glsl */ `
  uniform vec3 uLantern;
  uniform float uGlow;
  varying vec3 vN;
  varying vec3 vW;
  void main() {
    vec3 n = normalize(vN);
    vec3 toL = uLantern - vW;
    float d = length(toL);
    float lambert = max(dot(n, toL / d), 0.0);
    float falloff = 1.0 / (1.0 + d * d * 6.0);
    vec3 v = normalize(cameraPosition - vW);
    float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0);
    // your hand in a dimmed room: mostly dark, warmed by the lantern, a soft rim
    vec3 skin = vec3(0.42, 0.29, 0.22);
    vec3 lamp = vec3(1.0, 0.68, 0.38);
    vec3 col = skin * (0.035 + lamp * lambert * falloff * 0.9 * uGlow) + lamp * rim * 0.16 * uGlow;
    gl_FragColor = vec4(col, 1.0);
  }
`;

const MAX_BONES = SHADOW_BONES.length;

class StandInHand {
  readonly group = new Group();
  private readonly joints: InstancedMesh;
  private readonly bones: InstancedMesh;
  private readonly palm: InstancedMesh;
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly a = new Vector3();
  private readonly b = new Vector3();
  private readonly d = new Vector3();
  private readonly s = new Vector3();
  private readonly ex = new Vector3();
  private readonly ez = new Vector3();
  private static readonly UP = new Vector3(0, 1, 0);

  private readonly rad = new Float32Array(MAX_BONES * 2);
  private readonly radAttr = new InstancedBufferAttribute(this.rad, 2);

  constructor(material: ShaderMaterial, boneMaterial: ShaderMaterial) {
    this.joints = new InstancedMesh(new SphereGeometry(1, 20, 14), material, 25);
    const bone = new CylinderGeometry(1, 1, 1, 20, 1, true);
    this.radAttr.setUsage(35048);
    bone.setAttribute('iRad', this.radAttr);
    this.bones = new InstancedMesh(bone, boneMaterial, MAX_BONES);
    this.palm = new InstancedMesh(new SphereGeometry(1, 24, 16), material, 1);
    for (const im of [this.joints, this.bones, this.palm]) {
      im.frustumCulled = false;
      this.group.add(im);
    }
  }

  update(hand: HandFrame): void {
    this.group.visible = hand.tracked;
    if (!hand.tracked) return;
    const j = hand.joints;
    for (let i = 0; i < 25; i++) {
      const r = hand.radii[i];
      this.m.makeScale(r, r, r).setPosition(j[i].x, j[i].y, j[i].z);
      this.joints.setMatrixAt(i, this.m);
    }
    this.joints.instanceMatrix.needsUpdate = true;
    let n = 0;
    for (const [ia, ib] of SHADOW_BONES) {
      this.a.set(j[ia].x, j[ia].y, j[ia].z);
      this.b.set(j[ib].x, j[ib].y, j[ib].z);
      this.d.subVectors(this.b, this.a);
      const len = this.d.length();
      if (len < 1e-4) continue;
      this.q.setFromUnitVectors(StandInHand.UP, this.d.divideScalar(len));
      this.s.set(1, len, 1);
      this.a.add(this.b).multiplyScalar(0.5);
      this.m.compose(this.a, this.q, this.s);
      this.rad[n * 2] = hand.radii[ia];
      this.rad[n * 2 + 1] = hand.radii[ib];
      this.bones.setMatrixAt(n++, this.m);
    }
    this.bones.count = n;
    this.bones.instanceMatrix.needsUpdate = true;
    this.radAttr.needsUpdate = true;
    // palm: a flattened ellipsoid from the wrist to the knuckles
    this.a.set(j[J.wrist].x, j[J.wrist].y, j[J.wrist].z);
    this.b.set((j[J.indexProx].x + j[J.pinkyProx].x) / 2, (j[J.indexProx].y + j[J.pinkyProx].y) / 2, (j[J.indexProx].z + j[J.pinkyProx].z) / 2);
    this.d.subVectors(this.b, this.a);
    const len = this.d.length() || 1e-3;
    const across = Math.hypot(j[J.indexProx].x - j[J.pinkyProx].x, j[J.indexProx].y - j[J.pinkyProx].y, j[J.indexProx].z - j[J.pinkyProx].z);
    // orient: y along the palm, x across it
    const ex = this.ex.set(j[J.indexProx].x - j[J.pinkyProx].x, j[J.indexProx].y - j[J.pinkyProx].y, j[J.indexProx].z - j[J.pinkyProx].z).normalize();
    const ey = this.d.divideScalar(len);
    const ez = this.ez.crossVectors(ex, ey).normalize();
    ex.crossVectors(ey, ez).normalize();
    this.m.makeBasis(ex, ey, ez);
    this.m.scale(this.s.set(across * 0.62, len * 0.56, 0.014));
    this.a.add(this.b).multiplyScalar(0.5);
    this.m.setPosition(this.a);
    this.palm.setMatrixAt(0, this.m);
    this.palm.instanceMatrix.needsUpdate = true;
  }
}

export class HandStandIns {
  readonly group = new Group();
  readonly material = new ShaderMaterial({
    uniforms: { uLantern: { value: new Vector3(0, 0.8, -0.3) }, uGlow: { value: 1 } },
    vertexShader: VERT,
    fragmentShader: FRAG,
  });
  readonly boneMaterial = new ShaderMaterial({
    uniforms: this.material.uniforms,
    vertexShader: BONE_VERT,
    fragmentShader: FRAG,
  });
  private readonly hands = [new StandInHand(this.material, this.boneMaterial), new StandInHand(this.material, this.boneMaterial)];

  constructor() {
    for (const h of this.hands) this.group.add(h.group);
    this.group.visible = false;
  }

  update(visible: boolean, hands: readonly HandFrame[], lantern: Vector3, glow: number): void {
    this.group.visible = visible;
    if (!visible) return;
    (this.material.uniforms.uLantern.value as Vector3).copy(lantern);
    this.material.uniforms.uGlow.value = 0.35 + 0.65 * glow;
    for (let i = 0; i < 2; i++) this.hands[i].update(hands[i]);
  }
}
