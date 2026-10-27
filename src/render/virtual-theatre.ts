/**
 * VR fallback "virtual theatre" for headsets/browsers without immersive-ar
 * (e.g. the original Quest): a dim, warm little room - floor, low table under
 * the lantern, a soft dome - so the paper-scroll show is fully playable.
 * ~600 triangles, 3 draw calls. Only visible in an opaque (VR) session.
 */
import {
  BackSide,
  BoxGeometry,
  CircleGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  ShaderMaterial,
  SphereGeometry,
} from '@iwsdk/core';

export class VirtualTheatre {
  readonly group = new Group();
  readonly table: Mesh;

  constructor() {
    const dome = new Mesh(
      new SphereGeometry(7, 24, 12),
      new ShaderMaterial({
        side: BackSide,
        depthWrite: false,
        vertexShader: /* glsl */ `
          varying vec3 vP;
          void main() { vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
        `,
        fragmentShader: /* glsl */ `
          varying vec3 vP;
          void main() {
            float h = normalize(vP).y;
            vec3 top = vec3(0.035, 0.025, 0.045);
            vec3 mid = vec3(0.075, 0.045, 0.04);
            vec3 col = mix(mid, top, smoothstep(0.0, 0.7, h));
            col = mix(col, vec3(0.02, 0.015, 0.015), smoothstep(0.0, -0.4, h));
            gl_FragColor = vec4(col, 1.0);
          }
        `,
      }),
    );
    dome.renderOrder = -200;
    const floor = new Mesh(
      new CircleGeometry(4, 40),
      new ShaderMaterial({
        depthWrite: true,
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() { vUv = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
        `,
        fragmentShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            float r = length(vUv);
            vec3 col = mix(vec3(0.11, 0.07, 0.05), vec3(0.02, 0.015, 0.012), smoothstep(0.05, 0.6, r));
            gl_FragColor = vec4(col, 1.0);
          }
        `,
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    this.table = new Mesh(new BoxGeometry(0.7, 0.04, 0.45), new MeshBasicMaterial({ color: 0x2e1d12 }));
    this.group.add(dome, floor, this.table);
    this.group.visible = false;
  }

  /** Puts the table top just under the lantern. */
  placeTable(x: number, y: number, z: number, yaw: number): void {
    this.table.position.set(x, y - 0.02, z);
    this.table.rotation.y = yaw;
  }
}
