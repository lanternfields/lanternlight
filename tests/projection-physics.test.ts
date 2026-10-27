import { describe, expect, it } from 'vitest';
import { V3, mulberry32, pointSegmentDistance } from '../src/core/math.js';
import {
  computeFocalLight,
  createProjected,
  createStageFrame,
  orientStage,
  penumbraWidth,
  projectToStage,
  stageHeightForDistance,
  stageToWorld,
} from '../src/core/projection.js';
import { capsuleColumn, groundAt, Interval } from '../src/core/physics2d.js';
import { Capsule2D, ShadowModel, createRodInput } from '../src/core/shadow-model.js';
import { Rabbit, RabbitWorld } from '../src/core/rabbit.js';
import { POSES, makeHand } from './fixtures/synthetic-hand.js';
import { createHandFrame } from '../src/core/hand-model.js';

function wallStage(distance: number) {
  const st = createStageFrame();
  st.origin.set(0, 1.2, -distance);
  orientStage(st, new V3(0, 0, 1));
  st.height = stageHeightForDistance(distance);
  return st;
}

describe('projection', () => {
  it('projects along the light ray with the right magnification', () => {
    const st = wallStage(2);
    const out = createProjected();
    projectToStage(new V3(0, 1.2, -0.5), new V3(0, 1.2, 0), st, out);
    expect(out.valid).toBe(true);
    expect(out.s).toBeCloseTo(0, 6);
    expect(out.t).toBeCloseTo(0, 6);
    expect(out.magnification).toBeCloseTo(4, 6);
    projectToStage(new V3(0.1, 1.25, -1), new V3(0, 1.2, 0), st, out);
    expect(out.s * st.height).toBeCloseTo(0.2, 6);
    expect(out.t * st.height).toBeCloseTo(0.1, 6);
  });

  it('rejects points behind the light', () => {
    const st = wallStage(2);
    const out = createProjected();
    projectToStage(new V3(0, 1.2, 0.3), new V3(0, 1.2, 0), st, out);
    expect(out.valid).toBe(false);
  });

  it('stageToWorld inverts projectToStage on the surface', () => {
    const st = wallStage(1.7);
    const w = new V3();
    stageToWorld(st, 0.3, -0.2, w);
    const out = createProjected();
    projectToStage(w, new V3(0.4, 1.0, 0.5), st, out);
    expect(out.s).toBeCloseTo(0.3, 5);
    expect(out.t).toBeCloseTo(-0.2, 5);
  });

  it('the focal light keeps the nominal shadow size stable across wall distances', () => {
    const head = new V3(0, 1.2, 0);
    const sizes: number[] = [];
    for (const d of [0.8, 1.2, 1.9, 2.6, 3.2]) {
      const st = wallStage(d);
      const light = computeFocalLight(st, head, new V3());
      // nominal hand: 0.42 m forward, 0.22 m down, 0.19 m tall
      const a = createProjected();
      const b = createProjected();
      projectToStage(new V3(0, 0.98 - 0.095, -0.42), light, st, a);
      projectToStage(new V3(0, 0.98 + 0.095, -0.42), light, st, b);
      sizes.push(b.t - a.t);
      // and the comfortable hand lands near the middle of the stage
      expect(Math.abs((a.t + b.t) / 2)).toBeLessThan(0.12);
    }
    for (const s of sizes) {
      expect(s).toBeGreaterThan(0.3);
      expect(s).toBeLessThan(0.62);
    }
  });

  it('bringing the hand toward the lantern grows the shadow', () => {
    const st = wallStage(2);
    const head = new V3(0, 1.2, 0);
    const light = computeFocalLight(st, head, new V3());
    const size = (z: number) => {
      const a = createProjected();
      const b = createProjected();
      projectToStage(new V3(0, 0.9, z), light, st, a);
      projectToStage(new V3(0, 1.06, z), light, st, b);
      return b.t - a.t;
    };
    expect(size(-0.2)).toBeGreaterThan(size(-0.42) * 1.25);
    expect(size(-0.7)).toBeLessThan(size(-0.42));
  });

  it('your hand never hides its own shadow from your eyes', () => {
    const head = new V3(0, 1.2, 0);
    for (const d of [0.8, 1.5, 2.2, 3.2]) {
      const st = wallStage(d);
      const light = computeFocalLight(st, head, new V3());
      for (const [hx, hy, hz] of [[0, 0.98, -0.42], [0.1, 1.05, -0.35], [-0.1, 0.92, -0.5]]) {
        const hand = new V3(hx, hy, hz);
        const p = createProjected();
        projectToStage(hand, light, st, p);
        const w = stageToWorld(st, p.s, p.t, new V3());
        const a = [hand.x - head.x, hand.y - head.y, hand.z - head.z];
        const b = [w.x - head.x, w.y - head.y, w.z - head.z];
        const cos = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (Math.hypot(...a) * Math.hypot(...b));
        expect((Math.acos(cos) * 180) / Math.PI).toBeGreaterThan(12);
      }
    }
  });

  it('penumbra is bounded', () => {
    const st = wallStage(2);
    expect(penumbraWidth(1.0, st, 0.025)).toBeGreaterThan(0);
    expect(penumbraWidth(50, st, 0.025)).toBeLessThanOrEqual(0.06);
  });
});

describe('capsule column (analytic) matches brute force', () => {
  it('random capsules', () => {
    const rng = mulberry32(42);
    const iv: Interval = { lo: 0, hi: 0 };
    let checked = 0;
    for (let n = 0; n < 2000; n++) {
      const ax = rng() * 2 - 1;
      const ay = rng() * 2 - 1;
      const bx = rng() * 2 - 1;
      const by = rng() * 2 - 1;
      const r = 0.01 + rng() * 0.2;
      const x = rng() * 2 - 1;
      const hit = capsuleColumn(ax, ay, bx, by, r, x, iv);
      // brute force: scan y
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i <= 4000; i++) {
        const y = -1.4 + (2.8 * i) / 4000;
        if (pointSegmentDistance(x, y, ax, ay, bx, by) <= r) {
          lo = Math.min(lo, y);
          hi = Math.max(hi, y);
        }
      }
      if (!Number.isFinite(lo)) {
        // brute force may miss razor-thin slivers; analytic must agree when the sliver is substantial
        if (hit) expect(iv.hi - iv.lo).toBeLessThan(0.003);
        continue;
      }
      expect(hit).toBe(true);
      expect(Math.abs(iv.hi - hi)).toBeLessThan(0.002);
      expect(Math.abs(iv.lo - lo)).toBeLessThan(0.002);
      checked++;
    }
    expect(checked).toBeGreaterThan(300);
  });
});

function cap(ax: number, ay: number, bx: number, by: number, r: number, actor = -1): Capsule2D {
  return { ax, ay, bx, by, r, soft: 0.01, actor };
}

describe('ground query', () => {
  it('returns the highest support below the limit', () => {
    const scenery = [cap(-1, -0.4, 1, -0.4, 0.02), cap(-0.2, 0.1, 0.2, 0.1, 0.02)];
    const g = { y: 0, source: -1, isShadow: false };
    groundAt(0, 0.5, scenery, 2, [], 0, g);
    expect(g.y).toBeCloseTo(0.12, 3);
    groundAt(0, 0.0, scenery, 2, [], 0, g);
    expect(g.y).toBeCloseTo(-0.38, 3);
    groundAt(0.5, 0.5, scenery, 2, [], 0, g);
    expect(g.y).toBeCloseTo(-0.38, 3);
  });
});

describe('rabbit', () => {
  const G = -0.36;
  function riverWorld(gap: number, shadows: Capsule2D[] = []): RabbitWorld {
    return {
      scenery: [cap(-0.8, G - 0.04, -gap, G - 0.04, 0.04), cap(gap, G - 0.04, 0.8, G - 0.04, 0.04)],
      sceneryCount: 2,
      shadows,
      shadowCount: shadows.length,
      waterY: G - 0.13,
      respawnX: -gap - 0.03,
      respawnY: G,
      homeX: 0.56,
    };
  }

  it('waits at the edge of a gap instead of jumping in', () => {
    const r = new Rabbit();
    r.place(-0.55, G, 1);
    const w = riverWorld(0.2);
    let peered = false;
    for (let i = 0; i < 72 * 10; i++) {
      const e = r.update(1 / 72, w);
      if (e.peering) peered = true;
      expect(r.state).not.toBe('swim');
    }
    expect(peered).toBe(true);
    expect(r.x).toBeLessThan(-0.15);
    expect(r.x).toBeGreaterThan(-0.3);
  });

  it('crosses on a shadow bridge and reaches home', () => {
    const r = new Rabbit();
    r.place(-0.55, G, 1);
    const bridge = [cap(-0.3, G - 0.025, 0.3, G - 0.02, 0.025, 1)];
    const w = riverWorld(0.2, bridge);
    let onShadow = false;
    for (let i = 0; i < 72 * 30 && r.state !== 'home'; i++) {
      r.update(1 / 72, w);
      if (r.onShadow) onShadow = true;
    }
    expect(onShadow).toBe(true);
    expect(r.state).toBe('home');
  });

  it('falls, swims back and tries again when the bridge vanishes', () => {
    const r = new Rabbit();
    r.place(-0.55, G, 1);
    const bridge = [cap(-0.3, G - 0.025, 0.3, G - 0.02, 0.025, 1)];
    const w = riverWorld(0.2, bridge);
    let splashed = false;
    for (let i = 0; i < 72 * 30; i++) {
      if (r.onShadow && r.x > -0.05 && w.shadowCount === 1) w.shadowCount = 0; // pull the hand away
      const e = r.update(1 / 72, w);
      if (e.splashed) splashed = true;
      expect(Number.isFinite(r.x) && Number.isFinite(r.y)).toBe(true);
    }
    expect(splashed).toBe(true);
    expect(r.state).toBe('idle');
    expect(r.x).toBeLessThan(-0.15); // back on the near bank
  });

  it('rides a moving shadow', () => {
    const r = new Rabbit();
    r.place(0, 0.1, 1);
    r.restTime = 1000; // stand still
    const plank = cap(-0.2, 0.05, 0.2, 0.05, 0.03, 1);
    const w: RabbitWorld = { scenery: [], sceneryCount: 0, shadows: [plank], shadowCount: 1, waterY: -10, respawnX: 0, respawnY: 0, homeX: 10 };
    for (let i = 0; i < 72; i++) r.update(1 / 72, w);
    for (let i = 0; i < 72; i++) {
      plank.ay += 0.001;
      plank.by += 0.001;
      r.update(1 / 72, w);
    }
    expect(r.state).toBe('idle');
    expect(r.y).toBeCloseTo(plank.ay + plank.r, 1);
  });
});

describe('shadow model', () => {
  const head = new V3(0, 1.2, 0);
  const st = wallStage(2);
  const light = computeFocalLight(st, head, new V3());

  it('builds a solid silhouette for a tracked hand', () => {
    const m = new ShadowModel();
    const hand = makeHand(POSES.open, { position: new V3(0, 0.92, -0.42) });
    m.build([createHandFrame('left'), hand], [], light, st, 1 / 72);
    const a = m.actors[1];
    expect(a.present).toBe(true);
    expect(a.capsuleCount).toBe(25);
    expect(a.maxT - a.minT).toBeGreaterThan(0.25);
    expect(m.distanceToShadow(a.centroidS, a.centroidT)).toBeLessThan(0.02);
    expect(m.distanceToShadow(0.7, 0.45)).toBeGreaterThan(0.05);
  });

  it('a hand behind the light casts nothing', () => {
    const m = new ShadowModel();
    const hand = makeHand(POSES.open, { position: new V3(0, 1.2, 2.5) });
    m.build([createHandFrame('left'), hand], [], light, st, 1 / 72);
    expect(m.actors[1].present).toBe(false);
  });

  it('rod puppet casts a croc and the trigger closes its jaws', () => {
    const m = new ShadowModel();
    const rod = createRodInput('right');
    rod.connected = true;
    rod.position.set(0.05, 0.95, -0.4);
    rod.trigger = 0;
    let closed = 0;
    for (let i = 0; i < 40; i++) {
      m.build([], [createRodInput('left'), rod], light, st, 1 / 72);
    }
    expect(m.actors[3].present).toBe(true);
    expect(m.actors[3].capsuleCount).toBeGreaterThan(5);
    expect(m.actors[3].mouth.open).toBe(true);
    rod.trigger = 1;
    for (let i = 0; i < 40; i++) {
      m.build([], [createRodInput('left'), rod], light, st, 1 / 72);
      if (m.actors[3].mouthClosed) closed++;
    }
    expect(closed).toBe(1);
  });
});
