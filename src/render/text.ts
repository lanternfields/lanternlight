/**
 * Minimal crisp text for captions and labels: a CanvasTexture on a quad.
 * Re-renders only when the string changes. Uses system serif fonts (no font
 * downloads, no licensing questions).
 */
import {
  CanvasTexture,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
} from '@iwsdk/core';

const FONT = '"Georgia", "Noto Serif", "Times New Roman", serif';

export class TextLabel {
  readonly mesh: Mesh;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: CanvasTexture;
  private readonly material: MeshBasicMaterial;
  private current = '\u0000';
  /** Height of the quad in metres. */
  heightM: number;
  opacity = 1;

  constructor(
    widthPx = 1024,
    heightPx = 128,
    heightM = 0.06,
    private readonly color = '#ffe8c4',
    private readonly shadowColor = 'rgba(20,10,4,0.85)',
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = widthPx;
    this.canvas.height = heightPx;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.minFilter = LinearFilter;
    this.texture.generateMipmaps = false;
    this.material = new MeshBasicMaterial({ map: this.texture, transparent: true, depthWrite: false, toneMapped: false });
    this.heightM = heightM;
    this.mesh = new Mesh(new PlaneGeometry(1, 1), this.material);
    this.mesh.scale.set((heightM * widthPx) / heightPx, heightM, 1);
    this.mesh.renderOrder = 30;
    this.mesh.visible = false;
  }

  set(text: string): void {
    if (text === this.current) return;
    this.current = text;
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    this.mesh.visible = text.length > 0;
    if (!text) return;
    const size = Math.round(canvas.height * 0.52);
    ctx.font = `italic ${size}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = this.shadowColor;
    ctx.shadowBlur = size * 0.35;
    ctx.fillStyle = this.color;
    ctx.fillText(text, canvas.width / 2, canvas.height / 2, canvas.width * 0.96);
    this.texture.needsUpdate = true;
  }

  setOpacity(o: number): void {
    this.material.opacity = o;
    this.mesh.visible = this.current.length > 0 && o > 0.01;
  }
}
