/**
 * A small glowing chevron in the lantern's light that points toward a stage
 * placed a little off to the side ("Turn a little to your left"): a camera-
 * facing sprite just above the flame, pulsing gently, gone once you turn.
 */
import { AdditiveBlending, CanvasTexture, Sprite, SpriteMaterial, Vector3 } from '@iwsdk/core';

function chevron(dir: 1 | -1): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.translate(64, 64);
  g.scale(dir, 1);
  g.shadowColor = 'rgba(255,170,80,0.9)';
  g.shadowBlur = 14;
  g.strokeStyle = 'rgba(255,226,170,1)';
  g.lineWidth = 14;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  // two nested chevrons pointing toward +x (flipped for the left)
  for (const x of [-18, 12]) {
    g.beginPath();
    g.moveTo(x - 14, -30);
    g.lineTo(x + 14, 0);
    g.lineTo(x - 14, 30);
    g.stroke();
  }
  return new CanvasTexture(c);
}

export class TurnArrow {
  readonly sprite: Sprite;
  private readonly right: CanvasTexture;
  private readonly left: CanvasTexture;
  private readonly material: SpriteMaterial;
  private alpha = 0;

  constructor() {
    this.right = chevron(1);
    this.left = chevron(-1);
    this.material = new SpriteMaterial({ map: this.right, blending: AdditiveBlending, transparent: true, depthWrite: false });
    this.sprite = new Sprite(this.material);
    this.sprite.scale.set(0.06, 0.06, 1);
    this.sprite.renderOrder = 35;
    this.sprite.visible = false;
  }

  /**
   * @param dir +1 to the viewer's right, -1 to the left, 0 = hide
   * @param flame the lantern flame (world)
   * @param right the viewer's right (world, horizontal unit)
   */
  update(dir: number, flame: Readonly<Vector3>, right: { x: number; z: number }, time: number, dt: number): void {
    this.alpha += ((dir !== 0 ? 1 : 0) - this.alpha) * (1 - Math.exp(-5 * dt));
    this.sprite.visible = this.alpha > 0.02;
    if (!this.sprite.visible) return;
    if (dir !== 0) this.material.map = dir > 0 ? this.right : this.left;
    // just above the flame, nudged toward the stage's side, drifting that way
    const nudge = 0.05 + 0.015 * Math.sin(time * 4);
    const s = dir >= 0 ? 1 : -1;
    this.sprite.position.set(flame.x + right.x * nudge * s, flame.y + 0.13, flame.z + right.z * nudge * s);
    this.material.opacity = this.alpha * (0.7 + 0.3 * Math.sin(time * 4));
  }
}
