/**
 * The lantern's spark (the finale): a small glowing mote that leaves the real
 * lantern's flame and arcs across the room to the wall, where the paper bird
 * takes it. A few additive sprites (a head and a short trail), no lights.
 */
import { AdditiveBlending, CanvasTexture, Group, Sprite, SpriteMaterial, Vector3 } from '@iwsdk/core';

const TRAIL = 5;

function glowTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,250,235,1)');
  grad.addColorStop(0.18, 'rgba(255,214,140,0.9)');
  grad.addColorStop(0.5, 'rgba(255,160,60,0.28)');
  grad.addColorStop(1, 'rgba(255,140,40,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new CanvasTexture(c);
}

export class LanternSpark {
  readonly group = new Group();
  private readonly sprites: Sprite[] = [];
  private readonly a = new Vector3();
  private readonly b = new Vector3();
  private readonly c = new Vector3();
  private readonly p = new Vector3();

  constructor() {
    const tex = glowTexture();
    for (let i = 0; i <= TRAIL; i++) {
      const m = new SpriteMaterial({ map: tex, blending: AdditiveBlending, depthWrite: false, transparent: true });
      const s = new Sprite(m);
      s.renderOrder = 30;
      s.frustumCulled = false;
      this.sprites.push(s);
      this.group.add(s);
    }
    this.group.visible = false;
  }

  /**
   * @param travel 0..1 along the arc (< 0 hides it)
   * @param from the flame (world)
   * @param to the stage point on the wall (world), already lifted off the surface
   * @param up world up, for the arc's lift
   */
  update(travel: number, from: Readonly<Vector3>, to: Readonly<Vector3>): void {
    this.group.visible = travel >= 0 && travel < 1;
    if (!this.group.visible) return;
    this.a.copy(from);
    this.b.copy(to);
    // control point: halfway, lifted so the spark rises out of the lantern first
    this.c.copy(this.a).add(this.b).multiplyScalar(0.5);
    this.c.y += 0.22 + 0.15 * this.a.distanceTo(this.b);
    for (let i = 0; i <= TRAIL; i++) {
      const lag = i * 0.035;
      const u = Math.max(0, travel - lag);
      // ease in-out along the arc: it lifts off slowly, then flies
      const e = u * u * (3 - 2 * u);
      const k = 1 - e;
      this.p.copy(this.a).multiplyScalar(k * k).addScaledVector(this.c, 2 * k * e).addScaledVector(this.b, e * e);
      const s = this.sprites[i];
      s.position.copy(this.p);
      const head = i === 0;
      const size = head ? 0.05 : 0.032 * (1 - i / (TRAIL + 2));
      s.scale.set(size, size, 1);
      // the head flares as it leaves the flame; the trail fades behind it
      (s.material as SpriteMaterial).opacity = travel - lag <= 0 ? 0 : head ? 1 : 0.55 * (1 - i / (TRAIL + 1));
    }
  }
}
