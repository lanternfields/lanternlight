/**
 * A crocodile glides, it doesn't rear: The Hungry River's fireflies dance low
 * over the water (about level with the lantern), left of Pip; a flat hand
 * skimming that band catches all of them; the hint shows that flat, side-on
 * hand there; the fed crocodile floats clear of the water line.
 */
import { describe, expect, it } from 'vitest';
import { ShadowModel } from '../src/core/shadow-model.js';
import { GhostCaster } from '../src/core/ghost.js';
import { COPY } from '../src/core/copy.js';
import {
  FIREFLY_T,
  FIREFLY_X,
  GROUND_T,
  NIGHT_CROC_EXTENT,
  NIGHT_CROC_FLOAT,
  NIGHT_CROC_SNOUT_MIN_X,
  PIP_EXTENT,
  Story,
  lineDuration,
} from '../src/core/story.js';

/** A hand's shadow blob with its mouth where we say (as in story-v2.test.ts). */
function skim(model: ShadowModel, s: number, t: number, aperture: number): void {
  const a = model.actors[1];
  a.present = true;
  a.presentTime += 1 / 72;
  a.pose = 'open';
  a.capsuleStart = 0;
  a.capsuleCount = 1;
  a.sizeRatio = 1;
  model.capsuleCount = 1;
  const c = model.capsules[0];
  // flat: a long low capsule trailing left of the mouth
  c.ax = s - 0.3;
  c.ay = t;
  c.bx = s;
  c.by = t;
  c.r = 0.035;
  c.actor = 1;
  a.minS = s - 0.33;
  a.maxS = s + 0.03;
  a.minT = t - 0.035;
  a.maxT = t + 0.035;
  a.centroidS = s - 0.15;
  a.centroidT = t;
  a.tipS = s;
  a.tipT = t;
  a.knuckleS = s - 0.08;
  a.knuckleT = t + 0.01;
  a.upperS = s + 0.02;
  a.upperT = t + 0.015;
  a.lowerS = s + 0.01;
  a.lowerT = t - 0.02;
  a.mouthS = s;
  a.mouthT = t;
  const e = a.mouth.update(aperture, 1 / 72);
  a.mouthOpened = e.opened;
  a.mouthClosed = e.closed;
}

describe('the fireflies dance low over the water', () => {
  it('the band sits in the lower third, above the water line and below the storyteller', () => {
    expect(FIREFLY_T[0]).toBeGreaterThan(GROUND_T + 0.04);
    expect(FIREFLY_T[1]).toBeLessThan(-0.12);
  });

  it('they stay in the band, left of Pip, and a flat hand skimming it catches all seven', () => {
    const model = new ShadowModel();
    const story = new Story();
    story.enter('croc');
    let open = true;
    let phase = 0;
    let eats = 0;
    let worstPipGap = Infinity;
    for (let i = 0; i < 72 * 120 && story.scene === 'croc'; i++) {
      const ff = story.view.fireflies.find((f) => f.alive);
      phase += 1 / 72;
      if (phase > 0.3) {
        phase = 0;
        open = !open;
      }
      if (ff) skim(model, ff.x, ff.y, open ? 1.0 : 0.2);
      else skim(model, 0.05, (FIREFLY_T[0] + FIREFLY_T[1]) / 2, 0.3);
      story.update(1 / 72, model);
      eats += story.events.filter((e) => e.type === 'eat').length;
      for (const f of story.view.fireflies) {
        if (!f.alive) continue;
        expect(f.y).toBeGreaterThanOrEqual(FIREFLY_T[0] - 1e-9);
        expect(f.y).toBeLessThanOrEqual(FIREFLY_T[1] + 1e-9);
        expect(f.x).toBeGreaterThanOrEqual(FIREFLY_X[0] - 1e-9);
        expect(f.x).toBeLessThanOrEqual(FIREFLY_X[1] + 1e-9);
        const rv = story.view.rabbit;
        if (rv.visible > 0.5) worstPipGap = Math.min(worstPipGap, rv.x - PIP_EXTENT.back * rv.scale - f.x);
      }
    }
    expect(eats).toBe(7);
    expect(story.progress.completed.croc).toBe(true);
    // a snapping mouth on the nearest firefly is still well clear of Pip
    expect(worstPipGap).toBeGreaterThan(0.2);
  });
});

describe('the crocodile hint', () => {
  it('is a flat, side-on hand in the firefly band: its arm runs along it, not down', () => {
    const story = new Story();
    story.enter('croc');
    const model = new ShadowModel();
    for (let i = 0; i < 72 * 3; i++) story.update(1 / 72, model);
    const v = story.view.ghost;
    expect(v.pose).toBe('mouth');
    expect(v.t).toBeGreaterThanOrEqual(FIREFLY_T[0]);
    expect(v.t).toBeLessThanOrEqual(FIREFLY_T[1]);
    const g = new GhostCaster();
    g.update('mouth', v.s, v.t, v.scale, 0.8, 0.5, 1 / 60);
    const m = g.model;
    const fa = m.capsules.slice(0, m.capsuleCount).find((c) => c.forearm)!;
    expect(fa).toBeTruthy();
    const dx = fa.bx - fa.ax;
    const dy = fa.by - fa.ay;
    // the arm trails off to the left, at most ~25 degrees from horizontal
    expect(dx).toBeLessThan(0);
    expect(Math.abs(dy)).toBeLessThan(Math.abs(dx) * Math.tan((25 * Math.PI) / 180));
  });
});

describe('the fed crocodile', () => {
  it('floats with its eye bump and ridge clear of the water line', () => {
    expect(NIGHT_CROC_FLOAT).toBeGreaterThan(0.015);
    expect(NIGHT_CROC_EXTENT.height).toBeGreaterThan(0.13);
  });

  it('surfaces clear of the reeds and stays while its line is read, then drifts off', () => {
    const model = new ShadowModel();
    const story = new Story();
    story.enter('croc');
    let open = true;
    let phase = 0;
    let surfacedX = NaN;
    let i5Start = -1;
    let xAtI5 = NaN;
    let movedDuringLine = false;
    let visibleDuringLine = true;
    let drifted = false;
    for (let i = 0; i < 72 * 150 && story.scene === 'croc'; i++) {
      const t = i / 72;
      const ff = story.view.fireflies.find((f) => f.alive);
      phase += 1 / 72;
      if (phase > 0.3) {
        phase = 0;
        open = !open;
      }
      if (story.view.nightLight.glow === 0) {
        if (ff) skim(model, ff.x, ff.y, open ? 1.0 : 0.2);
        else skim(model, 0.05, (FIREFLY_T[0] + FIREFLY_T[1]) / 2, 0.3);
      } else skim(model, -0.9, 0.3, 0.3); // fed: the hand leaves the light
      story.update(1 / 72, model);
      const nl = story.view.nightLight;
      if (nl.visible > 0.2 && Number.isNaN(surfacedX)) surfacedX = nl.x;
      const reading = story.view.text.line === COPY.I5 && story.view.text.lineAlpha > 0.5;
      if (reading && i5Start < 0) {
        i5Start = t;
        xAtI5 = nl.x;
      }
      if (i5Start >= 0 && t - i5Start < lineDuration(COPY.I5) * 0.75) {
        if (Math.abs(nl.x - xAtI5) > 1e-6) movedDuringLine = true;
        if (nl.visible < 0.5) visibleDuringLine = false;
      }
      if (i5Start >= 0 && nl.x < xAtI5 - 0.05) drifted = true;
    }
    expect(surfacedX - NIGHT_CROC_EXTENT.front).toBeGreaterThanOrEqual(NIGHT_CROC_SNOUT_MIN_X - 1e-6);
    expect(i5Start).toBeGreaterThan(0);
    expect(movedDuringLine).toBe(false);
    expect(visibleDuringLine).toBe(true);
    expect(drifted).toBe(true);
    expect(story.progress.completed.croc).toBe(true);
  });
});
