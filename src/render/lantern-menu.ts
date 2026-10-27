/**
 * The lantern menu: tap the lantern (fingertip, or controller ray + trigger)
 * and six round paper buttons fan out above it, within easy seated reach.
 * Buttons are pressed by poking them with a fingertip (or ray + trigger).
 * Icons are drawn as simple vector paths (no font glyph dependencies).
 */
import {
  CanvasTexture,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
} from '@iwsdk/core';

export type MenuAction = 'continue' | 'tales' | 'light' | 'gentle' | 'move' | 'leave' | 'hud';

interface ButtonDef {
  id: MenuAction;
  label: string;
  icon: (ctx: CanvasRenderingContext2D, s: number) => void;
}

const INK = '#3a2416';

const HUD_DEF: ButtonDef = {
  id: 'hud',
  label: 'HUD',
  icon: (c, s) => {
    c.lineWidth = 0.05 * s;
    c.beginPath();
    c.moveTo(-0.24 * s, 0.14 * s);
    c.lineTo(-0.1 * s, -0.02 * s);
    c.lineTo(0.02 * s, 0.08 * s);
    c.lineTo(0.24 * s, -0.16 * s);
    c.stroke();
  },
};

const DEFS: ButtonDef[] = [
  {
    id: 'continue',
    label: 'Continue',
    icon: (c, s) => {
      c.beginPath();
      c.moveTo(-0.18 * s, -0.24 * s);
      c.lineTo(0.26 * s, 0);
      c.lineTo(-0.18 * s, 0.24 * s);
      c.closePath();
      c.fill();
    },
  },
  {
    id: 'tales',
    label: 'Tales',
    icon: (c, s) => {
      for (const x of [-0.2, 0.2]) {
        c.beginPath();
        c.arc(x * s, 0, 0.13 * s, 0, Math.PI * 2);
        c.lineWidth = 0.05 * s;
        c.stroke();
      }
    },
  },
  {
    id: 'light',
    label: 'Dim',
    icon: (c, s) => {
      c.beginPath();
      c.arc(0, 0, 0.16 * s, 0, Math.PI * 2);
      c.lineWidth = 0.05 * s;
      c.stroke();
      c.beginPath();
      c.arc(0, 0, 0.16 * s, -Math.PI / 2, Math.PI / 2);
      c.fill();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        c.beginPath();
        c.moveTo(Math.cos(a) * 0.24 * s, Math.sin(a) * 0.24 * s);
        c.lineTo(Math.cos(a) * 0.31 * s, Math.sin(a) * 0.31 * s);
        c.stroke();
      }
    },
  },
  {
    id: 'gentle',
    label: 'Gentle',
    icon: (c, s) => {
      c.beginPath();
      c.moveTo(0, 0.24 * s);
      c.bezierCurveTo(-0.36 * s, 0, -0.22 * s, -0.3 * s, 0, -0.12 * s);
      c.bezierCurveTo(0.22 * s, -0.3 * s, 0.36 * s, 0, 0, 0.24 * s);
      c.fill();
    },
  },
  {
    id: 'move',
    label: 'Stage here',
    icon: (c, s) => {
      c.lineWidth = 0.05 * s;
      c.strokeRect(-0.24 * s, -0.17 * s, 0.48 * s, 0.34 * s);
      c.beginPath();
      c.arc(0, 0, 0.07 * s, 0, Math.PI * 2);
      c.fill();
    },
  },
  {
    id: 'leave',
    label: 'Leave',
    icon: (c, s) => {
      c.lineWidth = 0.06 * s;
      c.beginPath();
      c.moveTo(-0.18 * s, -0.18 * s);
      c.lineTo(0.18 * s, 0.18 * s);
      c.moveTo(0.18 * s, -0.18 * s);
      c.lineTo(-0.18 * s, 0.18 * s);
      c.stroke();
    },
  },
];

export class MenuButton {
  readonly mesh: Mesh;
  private readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly tex: CanvasTexture;
  /** 0..1 press animation. */
  pressT = 0;
  hover = 0;
  state = '';
  constructor(readonly def: ButtonDef) {
    this.canvas.width = 256;
    this.canvas.height = 320;
    this.ctx = this.canvas.getContext('2d')!;
    this.tex = new CanvasTexture(this.canvas);
    this.tex.colorSpace = SRGBColorSpace;
    this.tex.minFilter = LinearFilter;
    this.tex.generateMipmaps = false;
    this.mesh = new Mesh(
      new PlaneGeometry(0.075, 0.094),
      new MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false, toneMapped: false }),
    );
    this.mesh.renderOrder = 40;
    this.draw();
  }

  setState(state: string): void {
    if (state === this.state) return;
    this.state = state;
    this.draw();
  }

  private draw(): void {
    const c = this.ctx;
    const W = this.canvas.width;
    c.clearRect(0, 0, W, this.canvas.height);
    const r = 110;
    c.save();
    c.translate(W / 2, 128);
    const g = c.createRadialGradient(0, -20, 10, 0, 0, r);
    g.addColorStop(0, '#fff3dc');
    g.addColorStop(1, '#f0c98f');
    c.fillStyle = g;
    c.shadowColor = 'rgba(255,170,80,0.8)';
    c.shadowBlur = 24;
    c.beginPath();
    c.arc(0, 0, r, 0, Math.PI * 2);
    c.fill();
    c.shadowBlur = 0;
    c.strokeStyle = '#7a4a26';
    c.lineWidth = 6;
    c.stroke();
    c.fillStyle = INK;
    c.strokeStyle = INK;
    c.lineCap = 'round';
    this.def.icon(c, 200);
    c.restore();
    c.fillStyle = '#ffe9c8';
    c.font = 'italic 38px Georgia, "Noto Serif", serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.shadowColor = 'rgba(0,0,0,0.9)';
    c.shadowBlur = 8;
    const label = this.state ? `${this.def.label} ${this.state}` : this.def.label;
    c.fillText(label, W / 2, 288, W - 8);
    this.tex.needsUpdate = true;
  }
}

export class LanternMenu {
  readonly group = new Group();
  readonly buttons: MenuButton[];
  open = false;
  /** 0..1 fan-out animation. */
  t = 0;

  constructor(tester = false) {
    this.buttons = (tester ? [...DEFS, HUD_DEF] : DEFS).map((d) => new MenuButton(d));
    for (const b of this.buttons) this.group.add(b.mesh);
    this.group.visible = false;
  }

  /** Lays the buttons out as a compact 3 x 2 grid above the lantern, facing the viewer. */
  layout(time: number, reduceMotion: boolean): void {
    const n = this.buttons.length;
    const ease = this.t * this.t * (3 - 2 * this.t);
    // order: [continue, tales, leave] on top, [dim, gentle, stage here] below
    const slots = [
      [-1, 1],
      [0, 1],
      [-1, 0],
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 2],
    ];
    for (let i = 0; i < n; i++) {
      const b = this.buttons[i];
      const [col, row] = slots[i];
      const x = col * 0.1 * ease;
      const y = (0.13 + row * 0.115) * ease + 0.04 + (reduceMotion ? 0 : Math.sin(time * 1.3 + i) * 0.0015);
      const u = col / 2;
      b.mesh.position.set(x, y, -0.01 * Math.abs(col) - 0.005 * b.pressT);
      b.mesh.rotation.y = -u * 0.35;
      const sc = (0.6 + 0.4 * ease) * (1 - 0.12 * b.pressT) * (1 + 0.06 * b.hover);
      b.mesh.scale.setScalar(sc);
      b.pressT = Math.max(0, b.pressT - 0.08);
    }
    this.group.visible = this.t > 0.01;
  }
}
