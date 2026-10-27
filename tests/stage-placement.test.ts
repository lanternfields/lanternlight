import { describe, expect, it } from 'vitest';
import { V3, mulberry32, dot, sub } from '../src/core/math.js';
import {
  DEFAULT_PLACEMENT,
  PlaneInfo,
  chooseLantern,
  chooseStage,
  normalizeLabel,
} from '../src/core/stage-placement.js';

/** Vertical rectangle on the plane z = zWall (normal +Z), x in [x0,x1], y in [y0,y1]. */
function wallZ(id: string, zWall: number, x0: number, x1: number, y0: number, y1: number, label = 'wall', normalSign = 1): PlaneInfo {
  return {
    id,
    orientation: 'vertical',
    label,
    normal: new V3(0, 0, normalSign),
    points: [new V3(x0, y0, zWall), new V3(x1, y0, zWall), new V3(x1, y1, zWall), new V3(x0, y1, zWall)],
  };
}

function table(id: string, y: number, x0: number, x1: number, z0: number, z1: number, label = 'table'): PlaneInfo {
  return {
    id,
    orientation: 'horizontal',
    label,
    normal: new V3(0, 1, 0),
    points: [new V3(x0, y, z0), new V3(x1, y, z0), new V3(x1, y, z1), new V3(x0, y, z1)],
  };
}

const head = new V3(0, 1.2, 0);
const fwd = new V3(0, 0, -1);

describe('stage placement', () => {
  it('labels normalise', () => {
    expect(normalizeLabel('WALL_FACE')).toBe('wallface');
    expect(normalizeLabel('Wall Art')).toBe('wallart');
    expect(normalizeLabel(undefined)).toBe('');
  });

  it('chooses the wall in front of the viewer', () => {
    const p = chooseStage([wallZ('w', -2, -2, 2, 0, 2.6)], head, fwd);
    expect(p.kind).toBe('wall');
    expect(p.planeId).toBe('w');
    expect(p.distance).toBeCloseTo(2, 5);
    expect(p.frame.origin.z).toBeCloseTo(-2 + 0.004, 3);
    expect(Math.abs(p.frame.origin.x)).toBeLessThan(0.01);
    expect(p.frame.normal.z).toBeCloseTo(1, 5);
    expect(p.frame.right.x).toBeCloseTo(1, 5);
    expect(p.frame.up.y).toBeCloseTo(1, 5);
    expect(p.frame.origin.y).toBeLessThan(head.y);
  });

  it('flips a wall normal that points away from the viewer', () => {
    const p = chooseStage([wallZ('w', -2, -2, 2, 0, 2.6, 'wall', -1)], head, fwd);
    expect(p.kind).toBe('wall');
    expect(p.frame.normal.z).toBeCloseTo(1, 5);
  });

  it('falls back to the scroll when there is no scan', () => {
    const p = chooseStage([], head, fwd);
    expect(p.kind).toBe('scroll');
    expect(p.reason).toBe('no-planes');
    expect(p.frame.origin.z).toBeCloseTo(-DEFAULT_PLACEMENT.scrollDistance, 5);
  });

  it('falls back when the wall is too far, too close, behind or off to the side', () => {
    expect(chooseStage([wallZ('w', -5, -3, 3, 0, 3)], head, fwd).reason).toBe('wall-too-far');
    expect(chooseStage([wallZ('w', -0.4, -3, 3, 0, 3)], head, fwd).reason).toBe('wall-too-close');
    expect(chooseStage([wallZ('w', 2, -3, 3, 0, 3)], head, fwd).kind).toBe('scroll');
    // wall to the right (normal -X) at 90 degrees from gaze
    const side: PlaneInfo = {
      id: 's',
      orientation: 'vertical',
      label: 'wall',
      normal: new V3(-1, 0, 0),
      points: [new V3(1.5, 0, -2), new V3(1.5, 0, 2), new V3(1.5, 2.5, 2), new V3(1.5, 2.5, -2)],
    };
    expect(chooseStage([side], head, fwd).kind).toBe('scroll');
  });

  it('avoids a window by shifting along the wall, or uses the scroll if the wall is all glass', () => {
    const w = wallZ('w', -2, -3, 3, 0, 2.6);
    const win = wallZ('win', -2, -0.5, 0.5, 0.7, 2.0, 'WINDOW_FRAME');
    const p = chooseStage([w, win], head, fwd);
    expect(p.kind).toBe('wall');
    expect(Math.abs(p.frame.origin.x)).toBeGreaterThan(0.2);
    const glass = wallZ('g', -2, -3, 3, 0.3, 2.4, 'WINDOW_FRAME');
    const q = chooseStage([w, glass], head, fwd);
    expect(q.kind).toBe('scroll');
  });

  it('a small wall patch shrinks the stage or is rejected', () => {
    const p = chooseStage([wallZ('w', -2, -0.6, 0.6, 0.5, 1.8)], head, fwd);
    if (p.kind === 'wall') {
      expect(p.frame.height * p.frame.aspect).toBeLessThanOrEqual(1.2);
    } else {
      expect(p.reason).toBe('wall-too-small');
    }
  });

  it('fuzz: 3000 random rooms always yield a valid, viewer-facing stage', () => {
    const rng = mulberry32(2026);
    let walls = 0;
    let scrolls = 0;
    const rel = new V3();
    for (let n = 0; n < 3000; n++) {
      const w = 2.5 + rng() * 5;
      const d = 2.5 + rng() * 5;
      const hgt = 2.3 + rng() * 1.2;
      const cx = (rng() - 0.5) * (w - 1);
      const cz = (rng() - 0.5) * (d - 1);
      const h = new V3(cx, 0.9 + rng() * 0.7, cz);
      const yaw = rng() * Math.PI * 2;
      const f = new V3(Math.sin(yaw), (rng() - 0.5) * 0.4, -Math.cos(yaw));
      const planes: PlaneInfo[] = [
        wallZ('n', -d / 2, -w / 2, w / 2, 0, hgt, rng() < 0.5 ? 'wall' : 'WALL_FACE'),
        wallZ('s', d / 2, -w / 2, w / 2, 0, hgt, 'wall', -1),
        { id: 'e', orientation: 'vertical', label: 'wall', normal: new V3(-1, 0, 0), points: [new V3(w / 2, 0, -d / 2), new V3(w / 2, 0, d / 2), new V3(w / 2, hgt, d / 2), new V3(w / 2, hgt, -d / 2)] },
        { id: 'w', orientation: 'vertical', label: 'wall', normal: new V3(1, 0, 0), points: [new V3(-w / 2, 0, d / 2), new V3(-w / 2, 0, -d / 2), new V3(-w / 2, hgt, -d / 2), new V3(-w / 2, hgt, d / 2)] },
        table('t', 0.7 + rng() * 0.1, cx - 0.6, cx + 0.6, cz - 0.9, cz - 0.2),
      ];
      if (rng() < 0.6) {
        const wx = (rng() - 0.5) * w * 0.8;
        planes.push(wallZ('win', -d / 2, wx - 0.6, wx + 0.6, 0.8, 2.0, 'WINDOW_FRAME'));
      }
      if (rng() < 0.3) planes.length = 0; // no scan at all
      const p = chooseStage(planes, h, f);
      const fr = p.frame;
      for (const v of [fr.origin, fr.normal, fr.right, fr.up]) {
        expect(Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)).toBe(true);
      }
      expect(fr.height).toBeGreaterThan(0.2);
      expect(fr.height).toBeLessThan(2.0);
      expect(Math.hypot(fr.normal.x, fr.normal.y, fr.normal.z)).toBeCloseTo(1, 4);
      sub(rel, h, fr.origin);
      expect(dot(rel, fr.normal)).toBeGreaterThan(0.3); // faces the viewer
      // comfortably inside the view cone horizontally
      const toStage = new V3(-rel.x, 0, -rel.z);
      const fh = new V3(f.x, 0, f.z);
      const cos = (toStage.x * fh.x + toStage.z * fh.z) / (Math.hypot(toStage.x, toStage.z) * Math.hypot(fh.x, fh.z));
      expect(cos).toBeGreaterThan(Math.cos((60 * Math.PI) / 180));
      if (p.kind === 'wall') {
        walls++;
        expect(p.distance).toBeGreaterThanOrEqual(DEFAULT_PLACEMENT.minDistance);
        expect(p.distance).toBeLessThanOrEqual(DEFAULT_PLACEMENT.maxDistance);
      } else scrolls++;
    }
    expect(walls).toBeGreaterThan(500);
    expect(scrolls).toBeGreaterThan(500);
  });
});

describe('lantern placement', () => {
  it('sits on a table in front of the viewer', () => {
    const l = chooseLantern([table('t', 0.75, -0.6, 0.6, -0.9, -0.15)], head, fwd);
    expect(l.onSurface).toBe(true);
    expect(l.position.y).toBeCloseTo(0.75, 5);
    expect(l.position.z).toBeLessThan(-0.15);
  });

  it('floats when there is no table', () => {
    const l = chooseLantern([], head, fwd);
    expect(l.onSurface).toBe(false);
    expect(l.position.y).toBeCloseTo(head.y - 0.45, 5);
  });

  it('ignores the floor and tables at the wrong height', () => {
    const floor = table('f', 0, -3, 3, -3, 3, 'floor');
    const high = table('h', 1.4, -1, 1, -1, 0, 'table');
    expect(chooseLantern([floor, high], head, fwd).onSurface).toBe(false);
  });

  it('left-handed viewers get the lantern on the other side', () => {
    const r = chooseLantern([], head, fwd, 'right');
    const l = chooseLantern([], head, fwd, 'left');
    expect(r.position.x).toBeLessThan(l.position.x);
  });
});

describe('furniture occlusion', () => {
  const eye = new V3(0, 1.2, 0);
  it('a desk against the wall pushes the stage above the desk top', () => {
    const wall = wallZ('w', -1.1, -2, 2, 0, 2.6);
    const desk = table('d', 0.76, -0.8, 0.8, -1.1, -0.45, 'table');
    const p = chooseStage([wall, desk], eye, fwd);
    expect(p.kind).toBe('wall');
    const bottom = p.frame.origin.y - p.frame.height / 2;
    expect(bottom).toBeGreaterThan(0.76);
  });

  it('a monitor on the desk raises the stage further (or falls back)', () => {
    const wall = wallZ('w', -1.1, -2, 2, 0, 2.6);
    const desk = table('d', 0.76, -0.8, 0.8, -1.1, -0.45, 'table');
    const monitor = { label: 'SCREEN', min: new V3(-0.35, 0.76, -1.0), max: new V3(0.35, 1.18, -0.92) };
    const p = chooseStage([wall, desk], eye, fwd, undefined, [monitor]);
    if (p.kind === 'wall') {
      const bottom = p.frame.origin.y - p.frame.height / 2;
      // sight line over the monitor's top edge, extended to the wall
      const yLine = 1.2 + ((1.18 - 1.2) * 1.1) / 1.0;
      expect(bottom).toBeGreaterThan(yLine);
    } else {
      // the scroll must hang in front of the monitor, not inside it
      expect(p.distance).toBeLessThan(0.92 - 0.1);
      expect(p.distance).toBeGreaterThanOrEqual(0.7);
    }
  });

  it('the scroll never hangs inside a nearby wall', () => {
    const near = wallZ('w', -0.95, -0.2, 0.2, 0, 2.6); // too narrow to be a stage
    const p = chooseStage([near], eye, fwd);
    expect(p.kind).toBe('scroll');
    expect(p.distance).toBeLessThan(0.95);
  });

  it('objects off to the side do not matter', () => {
    const wall = wallZ('w', -2, -3, 3, 0, 2.6);
    const sideTable = table('d', 0.9, 1.5, 2.5, -1.9, -1.2, 'table');
    const p = chooseStage([wall, sideTable], eye, fwd);
    expect(p.kind).toBe('wall');
    expect(p.frame.origin.y).toBeCloseTo(1.1, 1);
  });
});
