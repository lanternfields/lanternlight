import { describe, expect, it } from 'vitest';
import { ShadowModel, Actor } from '../src/core/shadow-model.js';
import { Story, GROUND_T, createProgress, DEFAULT_STORY_SETTINGS } from '../src/core/story.js';
import { PoseId } from '../src/core/hand-features.js';

/**
 * A puppeteer that drives the ShadowModel directly (as the real build step
 * would) so the story can be tested frame by frame.
 */
class FakeHand {
  constructor(private readonly model: ShadowModel) {}
  get actor(): Actor {
    return this.model.actors[1];
  }
  /** Places a blob of shadow (a short fat capsule) at s,t. */
  set(s: number, t: number, pose: PoseId = 'open', aperture = 0.3, width = 0.1): void {
    const m = this.model;
    const a = this.actor;
    a.present = true;
    a.presentTime += 1 / 72;
    a.pose = pose;
    a.capsuleStart = 0;
    a.capsuleCount = 1;
    m.capsuleCount = 1;
    const c = m.capsules[0];
    c.ax = s - width;
    c.ay = t;
    c.bx = s + width;
    c.by = t;
    c.r = 0.06;
    c.actor = 1;
    a.minS = s - width - 0.06;
    a.maxS = s + width + 0.06;
    a.minT = t - 0.06;
    a.maxT = t + 0.06;
    a.centroidS = s;
    a.centroidT = t;
    a.tipS = s + width;
    a.tipT = t + 0.05;
    a.knuckleS = s;
    a.knuckleT = t + 0.03;
    a.upperS = s + width;
    a.upperT = t + 0.02;
    a.lowerS = s + width;
    a.lowerT = t - 0.02;
    a.mouthS = s + width;
    a.mouthT = t;
    const edges = a.mouth.update(aperture, 1 / 72);
    a.mouthOpened = edges.opened;
    a.mouthClosed = edges.closed;
  }
  /** A flat bar (bridge) from s0 to s1 at height t. */
  bar(s0: number, s1: number, t: number): void {
    this.set((s0 + s1) / 2, t, 'open', 0.3, (s1 - s0) / 2);
    this.model.capsules[0].r = 0.025;
  }
  hide(): void {
    const a = this.actor;
    a.present = false;
    a.presentTime = 0;
    a.capsuleCount = 0;
    a.mouthClosed = false;
    a.mouthOpened = false;
    this.model.capsuleCount = 0;
  }
}

function run(story: Story, model: ShadowModel, seconds: number, each?: (t: number) => void): string[] {
  const events: string[] = [];
  const frames = Math.round(seconds * 72);
  for (let i = 0; i < frames; i++) {
    each?.(i / 72);
    story.update(1 / 72, model);
    for (const e of story.events) events.push(e.type);
  }
  return events;
}

describe('story: first five minutes', () => {
  it('dims, lights, finds your shadow, and a rabbit is born from your fingers', () => {
    const model = new ShadowModel();
    const hand = new FakeHand(model);
    const story = new Story();
    let ev = run(story, model, 3);
    expect(ev).toContain('ignite');
    expect(story.view.dim).toBeCloseTo(1, 2);
    expect(story.beat).toBe('wave');
    ev = run(story, model, 1.5, () => hand.set(0, 0));
    expect(ev).toContain('shadowFound');
    ev = run(story, model, 3, () => hand.set(0, 0));
    expect(story.beat).toBe('rabbitHint');
    ev = run(story, model, 1, () => hand.set(0, 0, 'rabbit'));
    expect(ev).toContain('rabbitBorn');
    // Rabbit drops to the ground and the menu opens.
    ev = run(story, model, 5, () => hand.hide());
    expect(story.scene).toBe('menu');
    expect(Math.abs(story.rabbit.y - GROUND_T)).toBeLessThan(0.02);
  });

  it('the rabbit arrives anyway if the pose is never found (no fail state)', () => {
    const model = new ShadowModel();
    const hand = new FakeHand(model);
    const story = new Story();
    run(story, model, 3);
    run(story, model, 1.5, () => hand.set(0, 0, 'fist'));
    const ev = run(story, model, 30, () => hand.set(0, 0, 'fist'));
    expect(ev).toContain('rabbitBorn');
  });

  it('a controller rod puppet can complete the prologue (trigger = rabbit)', () => {
    const model = new ShadowModel();
    const rod = model.actors[3];
    const story = new Story();
    run(story, model, 3);
    const setRod = (closing: boolean) => {
      rod.present = true;
      rod.kind = 'rod';
      rod.presentTime += 1 / 72;
      rod.centroidS = 0;
      rod.centroidT = 0;
      rod.tipS = 0.1;
      rod.tipT = 0.1;
      const e = rod.mouth.update(closing ? 0.2 : 1.0, 1 / 72);
      rod.mouthOpened = e.opened;
      rod.mouthClosed = e.closed;
    };
    run(story, model, 4, () => setRod(false));
    const ev = run(story, model, 1, () => setRod(true));
    expect(ev).toContain('rabbitBorn');
  });
});

describe('story: shadow-touch menu', () => {
  it('holding your shadow on a lantern selects its tale', () => {
    const model = new ShadowModel();
    const hand = new FakeHand(model);
    const story = new Story();
    story.enter('menu');
    run(story, model, 1);
    const icon = story.view.icons[0];
    const ev = run(story, model, 2.5, () => hand.set(icon.s, icon.t));
    expect(ev).toContain('select');
    run(story, model, 1.5, () => hand.hide());
    expect(story.scene).toBe('croc');
  });

  it('brushing past an icon does not select it', () => {
    const model = new ShadowModel();
    const hand = new FakeHand(model);
    const story = new Story();
    story.enter('menu');
    run(story, model, 1);
    const icon = story.view.icons[1];
    let ev = run(story, model, 0.5, () => hand.set(icon.s, icon.t));
    ev = ev.concat(run(story, model, 2, () => hand.hide()));
    ev = ev.concat(run(story, model, 0.5, () => hand.set(icon.s, icon.t)));
    expect(ev).not.toContain('select');
  });
});

describe('story: the hungry crocodile', () => {
  it('chomping near fireflies eats them and completes the tale', () => {
    const model = new ShadowModel();
    const hand = new FakeHand(model);
    const story = new Story();
    story.enter('croc');
    let open = true;
    let phase = 0;
    let ev: string[] = [];
    for (let i = 0; i < 72 * 90 && story.scene === 'croc'; i++) {
      // Chase the nearest live firefly with the mouth, chomping every ~0.6 s.
      const ff = story.view.fireflies.find((f) => f.alive);
      phase += 1 / 72;
      if (phase > 0.3) {
        phase = 0;
        open = !open;
      }
      if (ff) hand.set(ff.x - 0.1, ff.y, 'open', open ? 1.0 : 0.2);
      else hand.set(0, 0, 'open', 0.3);
      story.update(1 / 72, model);
      for (const e of story.events) ev.push(e.type);
    }
    expect(ev.filter((e) => e === 'eat').length).toBe(7);
    expect(ev).toContain('taleComplete');
    expect(story.progress.completed.croc).toBe(true);
    expect(story.scene).toBe('menu');
  });
});

describe("story: rabbit's bridge", () => {
  it('three crossings over a hand bridge complete the tale', () => {
    const model = new ShadowModel();
    const hand = new FakeHand(model);
    const story = new Story();
    story.enter('bridge');
    const ev: string[] = [];
    for (let i = 0; i < 72 * 120 && story.scene === 'bridge'; i++) {
      // A puppeteer holding a flat hand across the river.
      hand.bar(-0.36, 0.36, GROUND_T - 0.025);
      story.update(1 / 72, model);
      for (const e of story.events) ev.push(e.type);
    }
    expect(ev.filter((e) => e === 'roundComplete').length).toBe(3);
    expect(story.progress.completed.bridge).toBe(true);
    expect(story.scene).toBe('menu');
  });

  it('without help the rabbit waits and a hint appears; no splash', () => {
    const model = new ShadowModel();
    const story = new Story();
    story.enter('bridge');
    const ev = run(story, model, 8);
    expect(ev).not.toContain('splash');
    expect(story.view.ghost.visible).toBeGreaterThan(0.2);
    expect(story.view.caption).not.toBe('');
  });
});

describe('progress', () => {
  it('discovers the rabbit and counts visits', () => {
    const progress = createProgress();
    const model = new ShadowModel();
    const hand = new FakeHand(model);
    const story = new Story(DEFAULT_STORY_SETTINGS, progress);
    run(story, model, 3);
    run(story, model, 4.5, () => hand.set(0, 0));
    run(story, model, 1, () => hand.set(0, 0, 'rabbit'));
    run(story, model, 5, () => hand.hide());
    expect(progress.discovered).toContain('rabbit');
    expect(progress.visits).toBe(1);
  });
});

describe('story: menu arming', () => {
  it('a shadow resting on an icon when the menu opens does not reselect it', () => {
    const model = new ShadowModel();
    const hand = new FakeHand(model);
    const story = new Story();
    story.enter('menu');
    const icon = story.view.icons[0];
    let ev = run(story, model, 3, () => hand.set(icon.s, icon.t));
    expect(ev).not.toContain('select');
    ev = run(story, model, 0.5, () => hand.hide());
    ev = run(story, model, 2, () => hand.set(icon.s, icon.t));
    expect(ev).toContain('select');
  });
});
