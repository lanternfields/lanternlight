/**
 * Recording props (?capture=1 in the emulator only): a small wooden side
 * table under the lantern when it floats, so the establishing shot reads as a
 * real room. Lit by the lantern like everything else. Never shown on a headset.
 */
import { BoxGeometry, CylinderGeometry, Group, Mesh, ShaderMaterial, Vector3 } from '@iwsdk/core';

const VERT = /* glsl */ `
  varying vec3 vN;
  varying vec3 vW;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    vN = normalize(mat3(modelMatrix) * normal);
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
    float lambert = max(dot(n, toL / d), 0.0) * 0.8 + 0.2;
    float falloff = 1.0 / (1.0 + d * d * 9.0);
    vec3 wood = vec3(0.32, 0.2, 0.12);
    vec3 lamp = vec3(1.0, 0.66, 0.36);
    gl_FragColor = vec4(wood * (0.05 + lamp * lambert * falloff * 2.2 * uGlow), 1.0);
  }
`;

export class CaptureProps {
  readonly group = new Group();
  private readonly material = new ShaderMaterial({
    uniforms: { uLantern: { value: new Vector3() }, uGlow: { value: 1 } },
    vertexShader: VERT,
    fragmentShader: FRAG,
  });
  private readonly top: Mesh;
  private readonly legs: Mesh[] = [];

  constructor() {
    this.top = new Mesh(new BoxGeometry(0.46, 0.03, 0.34), this.material);
    this.group.add(this.top);
    for (let i = 0; i < 4; i++) {
      const leg = new Mesh(new CylinderGeometry(0.016, 0.013, 1, 16), this.material);
      this.legs.push(leg);
      this.group.add(leg);
    }
    this.group.visible = false;
  }

  /** @param base the lantern's base point; @param floorY the floor height */
  update(visible: boolean, base: Vector3, floorY: number, lantern: Vector3, glow: number, yaw: number): void {
    this.group.visible = visible && base.y - floorY > 0.25;
    if (!this.group.visible) return;
    (this.material.uniforms.uLantern.value as Vector3).copy(lantern);
    this.material.uniforms.uGlow.value = 0.35 + 0.65 * glow;
    const topY = base.y - 0.016;
    this.group.position.set(base.x, 0, base.z);
    this.group.rotation.set(0, yaw, 0);
    this.top.position.set(0, topY, 0);
    const h = topY - floorY - 0.015;
    const xs = [-0.19, 0.19, -0.19, 0.19];
    const zs = [-0.13, -0.13, 0.13, 0.13];
    for (let i = 0; i < 4; i++) {
      this.legs[i].scale.set(1, h, 1);
      this.legs[i].position.set(xs[i], floorY + h / 2, zs[i]);
    }
  }
}
