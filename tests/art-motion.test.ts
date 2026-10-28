import { describe, expect, it } from 'vitest';
import { GhostCaster } from '../src/core/ghost.js';
import { Spring, easeInOutCubic, easeOutBack, keyLoop, smoothNoise } from '../src/core/ease.js';
import { Rabbit, RabbitWorld } from '../src/core/rabbit.js';
import { Capsule2D } from '../src/core/shadow-model.js';

describe('ghost hints use the real hand caster (STYLE_GUIDE 1)', () => {
  it('casts tapered fingers, a palm contour and a fading forearm', () => {
    const g = new GhostCaster();
    g.update('open', 0, 0.02, 1, 0.5, 0.6, 1 / 72);
    const m = g.model;
    expect(g.visible).toBe(true);
    expect(m.capsuleCount).toBeGreaterThan(18);
    let tapered = 0;
    for (let i = 0; i < m.capsuleCount; i++) {
      const c = m.capsules[i];
      if (Math.abs((c.rb ?? c.r) - c.r) > 1e-4) tapered++;
    }
    expect(tapered).toBeGreaterThan(10);
    expect(m.actors[1].palmValid).toBe(true);
    const forearm = m.capsules.slice(0, m.capsuleCount).find((c) => c.forearm);
    expect(forearm?.fadeB).toBeLessThan(0.5);
  });

  it('lands where the story asks and scales with it', () => {
    const g = new GhostCaster();
    const box = (scale: number) => {
      g.update('open', 0.25, 0.05, scale, 0, 0.6, 1 / 72);
      const a = g.model.actors[1];
      return { cs: (a.handMinS + a.handMaxS) / 2, h: a.handMaxT - a.handMinT };
    };
    const b1 = box(1);
    const b2 = box(1.5);
    expect(Math.abs(b1.cs - 0.25)).toBeLessThan(0.16); // (the wave leans the hand a little)
    expect(b2.h / b1.h).toBeGreaterThan(1.35);
    expect(b2.h / b1.h).toBeLessThan(1.65);
    // a comfortably held hand's shadow is about half the stage tall
    expect(b1.h).toBeGreaterThan(0.3);
    expect(b1.h).toBeLessThan(0.6);
  });

  it('the crocodile hint opens, holds, snaps shut and rests (keyframes with holds)', () => {
    const g = new GhostCaster();
    const ap: number[] = [];
    for (let t = 0; t < 1.9; t += 1 / 60) {
      g.update('mouth', 0.3, 0.1, 0.85, t, 0.5, 1 / 60);
      ap.push(g.model.actors[1].aperture);
    }
    const open = Math.max(...ap);
    const shut = Math.min(...ap);
    expect(open - shut).toBeGreaterThan(0.4);
    // it holds open for a while (several consecutive frames near the max)
    const held = ap.filter((a) => a > open - 0.02).length;
    expect(held).toBeGreaterThan(20);
  });

  it('is invisible (and casts nothing) when the story hides it', () => {
    const g = new GhostCaster();
    g.update('rabbit', 0, 0, 1, 0, 0, 1 / 72);
    expect(g.visible).toBe(false);
    expect(g.model.capsuleCount).toBe(0);
  });
});

describe('motion helpers (STYLE_GUIDE 4)', () => {
  it('springs ease in and out, overshoot a little when underdamped, and settle', () => {
    const s = new Spring(0, 14, 0.85);
    const xs: number[] = [];
    for (let i = 0; i < 120; i++) xs.push(s.update(1, 1 / 60));
    // starts slowly (no velocity jump at the first frame)
    expect(xs[0]).toBeLessThan(0.06);
    expect(Math.max(...xs)).toBeGreaterThan(1.0);
    expect(Math.max(...xs)).toBeLessThan(1.06);
    expect(Math.abs(xs[119] - 1)).toBeLessThan(0.002);
  });

  it('is stable at low frame rates', () => {
    const s = new Spring(0, 26, 0.45);
    for (let i = 0; i < 40; i++) s.update(1, 0.1);
    expect(Math.abs(s.value - 1)).toBeLessThan(0.01);
  });

  it('keyframe loops hold on keys and ease between them', () => {
    const keys = [
      [0, 0],
      [1, 0],
      [1.5, 1],
      [2.5, 1],
    ] as const;
    expect(keyLoop(0.5, 3, keys)).toBe(0);
    expect(keyLoop(2, 3, keys)).toBe(1);
    expect(keyLoop(1.25, 3, keys)).toBeCloseTo(0.5, 5);
    expect(keyLoop(3.5, 3, keys)).toBe(0); // loops
  });

  it('easing curves start and end at rest; easeOutBack overshoots', () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    const peak = Math.max(...Array.from({ length: 101 }, (_, i) => easeOutBack(i / 100)));
    expect(peak).toBeGreaterThan(1.05);
    expect(easeOutBack(1)).toBeCloseTo(1, 6);
  });

  it('smooth noise has no jumps', () => {
    let worst = 0;
    for (let x = 0; x < 20; x += 0.01) worst = Math.max(worst, Math.abs(smoothNoise(x + 0.01) - smoothNoise(x)));
    expect(worst).toBeLessThan(0.05);
  });
});

describe('the rabbit anticipates its hops', () => {
  const floor: Capsule2D = { ax: -1, ay: -0.05, bx: 1, by: -0.05, r: 0.05, soft: 0.004, actor: -1 };
  const world: RabbitWorld = {
    scenery: [floor],
    sceneryCount: 1,
    shadows: [],
    shadowCount: 0,
    waterY: -10,
    respawnX: 0,
    respawnY: 0,
    homeX: 10,
  };
  it('crouches (squash < 1) before take-off, stretches in the air, squashes on landing', () => {
    const r = new Rabbit();
    r.place(-0.5, 0, 1);
    r.restTime = 0.1;
    let crouchMin = 1;
    let airMax = 1;
    let landMin = 1;
    let hopped = false;
    let landed = false;
    let framesBeforeHop = 0;
    for (let i = 0; i < 120; i++) {
      const ev = r.update(1 / 120, world, true);
      if (!hopped && r.state === 'idle') {
        framesBeforeHop++;
        crouchMin = Math.min(crouchMin, r.squash);
      }
      if (ev.hopped) hopped = true;
      if (r.state === 'hop') airMax = Math.max(airMax, r.squash);
      if (ev.landed) landed = true;
      if (landed) landMin = Math.min(landMin, r.squash);
      if (landed && i > 100) break;
    }
    expect(hopped).toBe(true);
    expect(crouchMin).toBeLessThan(0.93);
    expect(airMax).toBeGreaterThan(1.03);
    expect(landMin).toBeLessThan(0.97);
    // and the squash never pops: frame-to-frame changes stay small
    const r2 = new Rabbit();
    r2.place(-0.5, 0, 1);
    r2.restTime = 0.1;
    let prev = r2.squash;
    let worst = 0;
    for (let i = 0; i < 600; i++) {
      r2.update(1 / 120, world, true);
      worst = Math.max(worst, Math.abs(r2.squash - prev));
      prev = r2.squash;
    }
    expect(worst).toBeLessThan(0.06);
  });
});

describe('the wolf eases in and out', () => {
  it('accelerates from rest, slows to a stop by the rabbit, and crouches before it bolts', async () => {
    const { Wolf } = await import('../src/core/wolf.js');
    const w = new Wolf();
    w.enter(0.92, 0.065);
    const vs: number[] = [];
    for (let i = 0; i < 72 * 30 && w.state !== 'sit'; i++) {
      w.update(1 / 72, false);
      vs.push(w.vx);
    }
    expect(w.state).toBe('sit');
    // no velocity jumps anywhere
    for (let i = 1; i < vs.length; i++) expect(Math.abs(vs[i] - vs[i - 1])).toBeLessThan(0.006);
    // it was moving at full prowl speed in the middle and almost stopped at the end
    expect(Math.min(...vs)).toBeLessThan(-0.06);
    expect(Math.abs(vs[vs.length - 1])).toBeLessThan(0.03); // and it settles to 0 while sitting
    // scared: cowers, then rears back and HOLDS it (anticipation), then bolts
    for (let i = 0; i < 72 * 3 && w.state !== 'rear'; i++) w.update(1 / 72, true);
    expect(w.state).toBe('rear');
    const x0 = w.x;
    for (let i = 0; i < 20; i++) w.update(1 / 72, false);
    expect(w.state).toBe('rear');
    expect(Math.abs(w.x - x0)).toBeLessThan(0.02);
    for (let i = 0; i < 72; i++) w.update(1 / 72, false);
    expect(w.x - x0).toBeGreaterThan(0.3);
  });
});
