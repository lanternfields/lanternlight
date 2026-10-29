/**
 * On-stage words, in the three treatments of STORY_TEXT.md:
 *  - 'banner': a storyteller line in EB Garamond italic, lettered in lamplight
 *    on a paper-cut ribbon that unfurls in the upper third of the light pool;
 *  - 'prompt': a few words in small caps (warm ivory) under the stage, below
 *    the ghost-hand pictogram, only when the player stalls;
 *  - 'title': the tale's small-caps title with its roman numeral, in dark ink,
 *    letter-spaced, inside the light above the title card's emblem ring.
 * Drawn once per string into a 2x mipmapped canvas; the unfurl and the fades
 * run in the shader (no per-frame redraw). Sizes are in stage units, chosen so
 * the x-height is >= 34 px in the 1080p capture and >= 1.4 deg in the headset.
 */
import {
  CanvasTexture,
  DoubleSide,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  PlaneGeometry,
  SRGBColorSpace,
  ShaderMaterial,
} from '@iwsdk/core';
import { FONT, fontsReady } from './text.js';

export type TextStyle = 'banner' | 'prompt' | 'title';

interface StyleSpec {
  /** Canvas size (px). */
  w: number;
  h: number;
  /** Quad width in stage units (height follows the canvas aspect). */
  units: number;
  /** Font size in stage units. */
  em: number;
}

const SPECS: Record<TextStyle, StyleSpec> = {
  // italic lower case: x-height ~0.4 em -> 0.14 em gives ~0.056 stage units
  banner: { w: 2048, h: 900, units: 1.44, em: 0.14 },
  // small caps (~0.46 em tall) -> 0.13 em gives ~0.06 units
  prompt: { w: 2048, h: 420, units: 1.6, em: 0.125 },
  title: { w: 3072, h: 300, units: 1.5, em: 0.12 },
};

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const FRAG = /* glsl */ `
  uniform sampler2D tMap;
  uniform float uOpacity;
  uniform float uReveal;
  varying vec2 vUv;
  void main() {
    vec4 c = texture2D(tMap, vUv);
    // unfurl from the centre outward (the ribbon opens like a scroll)
    float d = abs(vUv.x - 0.5) * 2.0;
    float m = 1.0 - smoothstep(uReveal - 0.06, uReveal, d);
    float a = c.a * m * uOpacity;
    if (a < 0.003) discard;
    gl_FragColor = vec4(c.rgb, a);
  }
`;

export class StageText {
  readonly mesh: Mesh;
  readonly material: ShaderMaterial;
  readonly spec: StyleSpec;
  private readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: CanvasTexture;
  private current = '\u0000';
  /** Height of the quad in stage units. */
  readonly heightUnits: number;
  /** Size of what was drawn (the ribbon itself), in stage units. */
  contentW = 0;
  contentH = 0;

  constructor(readonly style: TextStyle) {
    this.spec = SPECS[style];
    this.canvas.width = this.spec.w;
    this.canvas.height = this.spec.h;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.magFilter = LinearFilter;
    this.texture.minFilter = LinearMipmapLinearFilter;
    this.texture.generateMipmaps = true;
    this.texture.anisotropy = 4;
    this.material = new ShaderMaterial({
      uniforms: { tMap: { value: this.texture }, uOpacity: { value: 0 }, uReveal: { value: 1.1 } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      side: DoubleSide,
    });
    this.heightUnits = (this.spec.units * this.spec.h) / this.spec.w;
    this.mesh = new Mesh(new PlaneGeometry(1, 1), this.material);
    this.mesh.renderOrder = style === 'title' ? 32 : 31;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    void fontsReady.then(() => {
      const t = this.current;
      this.current = '\u0000';
      if (t !== '\u0000') this.set(t);
    });
  }

  set(text: string): void {
    if (text === this.current) return;
    this.current = text;
    const { ctx, canvas } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (text) {
      if (this.style === 'banner') this.drawBanner(text);
      else if (this.style === 'prompt') this.drawPrompt(text);
      else this.drawTitle(text);
    }
    this.texture.needsUpdate = true;
  }

  /** Opacity 0..1 and the unfurl 0..1 (1 = fully open). */
  show(opacity: number, reveal = 1): void {
    const u = this.material.uniforms;
    u.uOpacity.value = opacity;
    u.uReveal.value = reveal * 1.1;
    this.mesh.visible = this.current.length > 0 && opacity > 0.01;
  }

  private px(units: number): number {
    return (units * this.spec.w) / this.spec.units;
  }

  /**
   * The rows as authored (copy.ts breaks lines at phrase boundaries with
   * "\n"; nothing is re-wrapped here), and the font size that makes the
   * widest row fit `maxW` px (never larger than `fontPx`).
   */
  private layout(text: string, fontPx: number, maxW: number, pitch: number, setFont: (px: number) => void): { rows: string[]; fontPx: number } {
    const rows = text.split('\n');
    setFont(fontPx);
    let widest = 0;
    for (const r of rows) widest = Math.max(widest, this.ctx.measureText(r).width);
    // fit the widest row, and the rows' height (canvas height ~ two rows)
    const k = Math.min(1, maxW / Math.max(1, widest), (this.canvas.height * 0.98) / (rows.length * fontPx * pitch));
    if (k < 1) {
      fontPx *= k;
      setFont(fontPx);
    }
    return { rows, fontPx };
  }

  private drawBanner(text: string): void {
    const { ctx, canvas } = this;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const { rows, fontPx } = this.layout(text, this.px(this.spec.em), canvas.width * 0.8, 1.45, (px) => {
      ctx.font = `italic ${px}px ${FONT}`;
    });
    let tw = 0;
    for (const r of rows) tw = Math.max(tw, ctx.measureText(r).width);
    const rowH = fontPx * 1.18;
    const bandH = rowH * rows.length + fontPx * 0.5;
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const half = Math.min(canvas.width * 0.47, tw / 2 + fontPx * 0.9);
    const notch = fontPx * 0.55;
    const curl = fontPx * 0.16;
    const ppu = this.spec.w / this.spec.units;
    this.contentW = (2 * (half + notch * 1.6)) / ppu;
    this.contentH = (bandH + curl * 2.2) / ppu;
    // the paper-cut ribbon: a band with a gentle sag and swallowtail ends
    const top = cy - bandH / 2;
    const bot = cy + bandH / 2;
    ctx.save();
    ctx.shadowColor = 'rgba(8,5,3,0.55)';
    ctx.shadowBlur = fontPx * 0.12;
    ctx.fillStyle = 'rgba(14,9,6,0.93)';
    ctx.beginPath();
    ctx.moveTo(cx - half - notch * 1.6, top + curl);
    ctx.quadraticCurveTo(cx, top + curl * 2.2, cx + half + notch * 1.6, top + curl);
    ctx.lineTo(cx + half + notch * 0.6, cy + curl);
    ctx.lineTo(cx + half + notch * 1.6, bot + curl);
    ctx.quadraticCurveTo(cx, bot + curl * 2.2, cx - half - notch * 1.6, bot + curl);
    ctx.lineTo(cx - half - notch * 0.6, cy + curl);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // a fine cut line inside the edge, as on cut paper
    ctx.save();
    ctx.strokeStyle = 'rgba(255,214,150,0.22)';
    ctx.lineWidth = Math.max(2, fontPx * 0.025);
    ctx.beginPath();
    ctx.moveTo(cx - half, top + curl + fontPx * 0.14);
    ctx.quadraticCurveTo(cx, top + curl * 2.2 + fontPx * 0.14, cx + half, top + curl + fontPx * 0.14);
    ctx.moveTo(cx - half, bot + curl - fontPx * 0.14);
    ctx.quadraticCurveTo(cx, bot + curl * 2.2 - fontPx * 0.14, cx + half, bot + curl - fontPx * 0.14);
    ctx.stroke();
    ctx.restore();
    // the words, lettered in lamplight
    ctx.save();
    ctx.fillStyle = '#ffe8bf';
    ctx.shadowColor = 'rgba(255,190,110,0.45)';
    ctx.shadowBlur = fontPx * 0.12;
    const y0 = cy + curl * 1.6 - (rowH * (rows.length - 1)) / 2;
    rows.forEach((r, i) => ctx.fillText(r, cx, y0 + i * rowH));
    ctx.restore();
  }

  private setSmallCaps(fontPx: number, weight = 500): void {
    const ctx = this.ctx as CanvasRenderingContext2D & { fontVariantCaps?: string; letterSpacing?: string };
    ctx.font = `small-caps ${weight} ${fontPx}px ${FONT}`;
    if ('fontVariantCaps' in ctx) ctx.fontVariantCaps = 'small-caps';
  }

  private drawPrompt(text: string): void {
    const { ctx, canvas } = this;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const { rows, fontPx } = this.layout(text, this.px(this.spec.em * 1.25), canvas.width * 0.94, 1.02, (px) => {
      this.setSmallCaps(px);
      (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${Math.round(px * 0.06)}px`;
    });
    const rowH = fontPx * 1.02;
    const y0 = canvas.height / 2 - (rowH * (rows.length - 1)) / 2;
    // a soft dark halo keeps it legible on any wall
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(10,6,4,0.85)';
    ctx.lineWidth = fontPx * 0.16;
    rows.forEach((r, i) => ctx.strokeText(r, canvas.width / 2, y0 + i * rowH));
    ctx.fillStyle = '#fff2dc';
    rows.forEach((r, i) => ctx.fillText(r, canvas.width / 2, y0 + i * rowH));
  }

  private drawTitle(text: string): void {
    const { ctx, canvas } = this;
    const fontPx = this.px(this.spec.em);
    this.setSmallCaps(fontPx, 500);
    (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${Math.round(fontPx * 0.1)}px`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // ink, no outline: dark letters sitting inside the title card's pool of light
    ctx.fillStyle = '#1a0f08';
    ctx.fillText(text, canvas.width / 2, canvas.height * 0.54, canvas.width * 0.96);
  }
}
