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
    const ev = run(story, model, 16); // title card, the rabbit waits at the edge, then the prompt
    expect(ev).not.toContain('splash');
    expect(story.view.ghost.visible).toBeGreaterThan(0.2);
    expect(story.view.text.prompt).toBe('Lay your hand flat. Be the bridge.');
  });
});

describe('story: title cards', () => {
  it('each tale opens with a wordless title card, then its set fades in', () => {
    const model = new ShadowModel();
    for (const id of ['croc', 'bridge', 'wolf'] as const) {
      const story = new Story();
      story.enter(id);
      expect(story.view.title.id).toBe(id);
      expect(story.view.set).toBe(0);
      run(story, model, 1.0);
      expect(story.view.title.id).toBe(id);
      expect(story.view.text.title).toMatch(/^I+ · The /);
      run(story, model, 2.2);
      expect(story.view.title.id).toBe('');
      expect(story.view.set).toBe(1);
    }
  });

  it('scene changes fade out and in with eased, matching durations', () => {
    const model = new ShadowModel();
    const hand = new FakeHand(model);
    const story = new Story();
    story.enter('menu');
    const fades: number[] = [];
    run(story, model, 6, (t) => {
      const ic = story.view.icons[0];
      // off the icon first (icons arm only after a shadow has left them), then on it
      if (t < 1.2) hand.set(0.3, -0.2);
      else hand.set(ic.s, ic.t);
      fades.push(story.view.fade);
    });
    // it went dark and came back, without jumps
    expect(Math.max(...fades)).toBeGreaterThan(0.95);
    for (let i = 1; i < fades.length; i++) expect(Math.abs(fades[i] - fades[i - 1])).toBeLessThan(0.08);
  });
});

describe('story: never stuck (review H3, bridge assist)', () => {
  it('the non-dominant hand in the light passes the prologue while the dominant one rests outside it', () => {
    const model = new ShadowModel();
    const story = new Story();
    run(story, model, 3);
    expect(story.beat).toBe('wave');
    const right = model.actors[1];
    const left = new FakeHand(model);
    // left hand performs in the light (drive actors[0] by swapping)
    run(story, model, 2, () => {
      left.set(0, 0);
      // move what FakeHand wrote to the left actor, and park the right hand outside the pool
      const a = model.actors[1];
      const l = model.actors[0];
      Object.assign(l, { present: true, presentTime: a.presentTime, centroidS: 0, centroidT: 0, pose: 'open' });
      model.capsules[0].actor = 0;
      right.present = true;
      right.centroidS = 0.95;
      right.centroidT = -0.6;
    });
    expect(['play', 'rabbitHint']).toContain(story.beat);
  });

  it('with no hand at all the prologue still moves on (assist timeouts)', () => {
    const model = new ShadowModel();
    const story = new Story();
    run(story, model, 70);
    expect(story.scene).toBe('menu');
    expect(story.stats.assists).toBeGreaterThan(0);
  });

  it('if nobody builds a bridge, a paper plank drops in and the rabbit crosses', () => {
    const model = new ShadowModel();
    const story = new Story();
    story.enter('bridge');
    const ev = run(story, model, 40);
    expect(story.stats.assists).toBeGreaterThan(0);
    expect(story.stats.crossings).toBeGreaterThanOrEqual(1);
    expect(ev).not.toContain('splash');
  });

  it('size beats are flagged so lantern taps are ignored', () => {
    const story = new Story();
    story.enter('wolf');
    const model = new ShadowModel();
    run(story, model, 6); // title card + moonrise
    expect(story.sizeBeat).toBe(true);
    story.enter('croc');
    expect(story.sizeBeat).toBe(false);
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

describe('story: the moon wolf', () => {
  const big = (hand: FakeHand, ratio: number) => {
    hand.set(0.05, 0.02);
    hand.actor.sizeRatio = ratio;
  };

  it('one big shadow scares the wolf (rear, then bolt), it peeks back and sings; about 20 s in all', () => {
    const model = new ShadowModel();
    const hand = new FakeHand(model);
    const story = new Story();
    story.enter('wolf');
    const ev: string[] = [];
    for (let i = 0; i < 72 * 120 && story.scene === 'wolf'; i++) {
      // the viewer makes themselves huge whenever the wolf is close
      if (story.wolf.state === 'prowl' || story.wolf.state === 'cower' || story.wolf.state === 'sit') big(hand, 1.8);
      else hand.hide();
      story.update(1 / 72, model);
      for (const e of story.events) ev.push(e.type);
    }
    expect(ev.filter((e) => e === 'wolfFlee').length).toBe(1);
    expect(ev).toContain('howl');
    expect(story.progress.completed.wolf).toBe(true);
    // staged as one beat: the whole tale (with its title card) stays short
    expect(story.time).toBeLessThan(26);
  });

  it('with no help the wolf only sits by the rabbit (no harm) and the hint appears', () => {
    const model = new ShadowModel();
    const story = new Story();
    story.enter('wolf');
    run(story, model, 30);
    expect(story.wolf.state).toBe('sit');
    expect(story.rabbit.state).toBe('idle');
    expect(story.view.ghost.visible).toBeGreaterThan(0.2);
    expect(story.view.text.prompt).not.toBe('');
  });

  it('the assist makes the wolf more timid over time', () => {
    const model = new ShadowModel();
    const story = new Story();
    story.enter('wolf');
    run(story, model, 4);
    const first = story.wolfThreshold();
    run(story, model, 20);
    expect(story.wolfThreshold()).toBeLessThan(first - 0.15);
    // so a modestly bigger shadow now works
    const hand = new FakeHand(model);
    const ev = run(story, model, 4, () => big(hand, 1.2));
    expect(ev).toContain('wolfFlee');
  });

  it('two hands together count as bigger', () => {
    const model = new ShadowModel();
    const story = new Story();
    const left = model.actors[0];
    const hand = new FakeHand(model);
    hand.set(0.1, 0);
    hand.actor.sizeRatio = 1.0;
    left.present = true;
    left.sizeRatio = 1.0;
    left.centroidS = -0.1;
    left.centroidT = 0;
    expect(story.bigness(model)).toBeCloseTo(1.25, 5);
  });

  it('after all three tales the curtain call plays once, then the menu', () => {
    const progress = createProgress();
    progress.completed.croc = true;
    progress.completed.bridge = true;
    const model = new ShadowModel();
    const hand = new FakeHand(model);
    const story = new Story(DEFAULT_STORY_SETTINGS, progress);
    story.enter('wolf');
    const scenes = new Set<string>();
    const ev: string[] = [];
    for (let i = 0; i < 72 * 150; i++) {
      if (story.scene === 'wolf' && ['prowl', 'cower', 'sit'].includes(story.wolf.state)) big(hand, 1.8);
      else hand.hide();
      story.update(1 / 72, model);
      scenes.add(story.scene);
      for (const e of story.events) ev.push(e.type);
      if (story.scene === 'menu' && scenes.has('finale')) break;
    }
    expect(scenes.has('finale')).toBe(true);
    expect(ev).toContain('bow');
    expect(story.scene).toBe('menu');
    expect(story.finaleSeen).toBe(true);
  });
});
