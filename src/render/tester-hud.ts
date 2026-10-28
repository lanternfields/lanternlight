/**
 * Tester HUD (enabled with ?tester=1 or the landing-page checkbox): a small
 * paper card next to the lantern with live FPS / frame times / quality level,
 * the build label, and a checklist that ticks itself as the tester explores.
 * Redrawn twice a second (one 512x512 canvas texture).
 */
import { FONT, fontsReady } from './text.js';
import {
  CanvasTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
} from '@iwsdk/core';

export interface HudData {
  build: string;
  fps: number;
  p50: number;
  p90: number;
  cpu: number;
  quality: number;
  stage: string;
  input: string;
  device: string;
  caps: string;
  checklist: { label: string; done: boolean }[];
}

export class TesterHud {
  readonly mesh: Mesh;
  private readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly tex: CanvasTexture;
  private timer = 0;
  enabled = false;

  constructor() {
    // drawn in 512 x 600 units at 2x for crisp text (STYLE_GUIDE 2)
    this.canvas.width = 1024;
    this.canvas.height = 1200;
    this.ctx = this.canvas.getContext('2d')!;
    this.tex = new CanvasTexture(this.canvas);
    this.tex.colorSpace = SRGBColorSpace;
    this.tex.magFilter = LinearFilter;
    this.tex.minFilter = LinearMipmapLinearFilter;
    this.tex.generateMipmaps = true;
    this.tex.anisotropy = 4;
    void fontsReady.then(() => {
      this.timer = 0;
    });
    this.mesh = new Mesh(
      new PlaneGeometry(0.16, 0.1875),
      new MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false, toneMapped: false }),
    );
    this.mesh.renderOrder = 45;
    this.mesh.visible = false;
  }

  update(dt: number, data: () => HudData): void {
    this.mesh.visible = this.enabled;
    if (!this.enabled) return;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.5;
    const d = data();
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    c.setTransform(2, 0, 0, 2, 0, 0);
    const W = 512;
    const H = 600;
    c.fillStyle = 'rgba(20,12,8,0.86)';
    c.beginPath();
    c.roundRect(4, 4, W - 8, H - 8, 28);
    c.fill();
    c.strokeStyle = '#f2a04a';
    c.lineWidth = 3;
    c.stroke();
    c.textBaseline = 'top';
    c.fillStyle = '#ffd59a';
    c.font = `500 36px ${FONT}`;
    c.fillText('Tester', 28, 22);
    c.font = `22px ${FONT}`;
    c.fillStyle = '#c9b59a';
    c.fillText(d.build, 160, 32);
    const good = d.p90 <= 14;
    c.font = `500 46px ${FONT}`;
    c.fillStyle = good ? '#9be39b' : d.p90 <= 18 ? '#ffd27a' : '#ff8a7a';
    c.fillText(`${Math.round(d.fps)} fps`, 28, 72);
    c.font = `25px ${FONT}`;
    c.fillStyle = '#f6e7cf';
    c.fillText(`frame p50 ${d.p50.toFixed(1)} ms  p90 ${d.p90.toFixed(1)} ms`, 28, 130);
    c.fillText(`cpu ${d.cpu.toFixed(2)} ms  quality ${d.quality}`, 28, 162);
    c.fillText(`stage ${d.stage}`, 28, 194);
    c.fillText(`input ${d.input}`, 28, 226);
    c.fillText(d.device, 28, 258);
    c.font = `21px ${FONT}`;
    c.fillStyle = '#c9b59a';
    c.fillText(d.caps, 28, 290);
    c.font = `27px ${FONT}`;
    let y = 326;
    for (const item of d.checklist) {
      c.fillStyle = item.done ? '#9be39b' : '#c9b59a';
      c.fillText(`${item.done ? '✓' : '○'}  ${item.label}`, 28, y);
      y += 34;
    }
    this.tex.needsUpdate = true;
  }
}
