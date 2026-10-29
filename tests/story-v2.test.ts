import { describe, expect, it } from 'vitest';
import { ShadowModel, Actor } from '../src/core/shadow-model.js';
import { PoseId } from '../src/core/hand-features.js';
import { COPY } from '../src/core/copy.js';
import {
  Story,
  GROUND_T,
  createProgress,
  DEFAULT_STORY_SETTINGS,
  SilhouetteBox,
  silhouettes,
  clearance,
  requiredGap,
  lineDuration,
} from '../src/core/story.js';

/** A hand's shadow blob (see story.test.ts), with its fingertip where we say. */
function setHand(model: ShadowModel, s: number, t: number, pose: PoseId = 'open', aperture = 0.3, size = 1): Actor {
  const a = model.actors[1];
  a.present = true;
  a.presentTime += 1 / 72;
  a.pose = pose;
  a.capsuleStart = 0;
  a.capsuleCount = 1;
  a.sizeRatio = size;
  model.capsuleCount = 1;
  const c = model.capsules[0];
  c.ax = s - 0.06;
  c.ay = t;
  c.bx = s + 0.06;
  c.by = t;
  c.r = 0.05;
  c.actor = 1;
  a.minS = s - 0.11;
  a.maxS = s + 0.11;
  a.minT = t - 0.05;
  a.maxT = t + 0.05;
  a.centroidS = s;
  a.centroidT = t;
  a.tipS = s;
  a.tipT = t + 0.1;
  a.knuckleS = s;
  a.knuckleT = t + 0.03;
  a.upperS = s + 0.06;
  a.upperT = t + 0.02;
  a.lowerS = s + 0.06;
  a.lowerT = t - 0.02;
  a.mouthS = s + 0.06;
  a.mouthT = t;
  const e = a.mouth.update(aperture, 1 / 72);
  a.mouthOpened = e.opened;
  a.mouthClosed = e.closed;
  return a;
}
function hide(model: ShadowModel): void {
  const a = model.actors[1];
  a.present = false;
  a.presentTime = 0;
  a.capsuleCount = 0;
  model.capsuleCount = 0;
}

/** Records the worst spacing between story silhouettes, frame by frame. */
class SpacingProbe {
  private readonly boxes: SilhouetteBox[] = [];
  worst = Infinity;
  where = '';
  check(story: Story, exempt?: (a: SilhouetteBox, b: SilhouetteBox) => boolean): void {
    const n = silhouettes(story.view, this.boxes);
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        const a = this.boxes[i];
        const b = this.boxes[j];
        if (exempt?.(a, b)) continue;
        const margin = clearance(a, b) - requiredGap(a, b);
        if (margin < this.worst) {
          this.worst = margin;
          this.where = `${story.scene}/${story.beat} ${a.id}-${b.id} clear ${clearance(a, b).toFixed(3)} need ${requiredGap(a, b).toFixed(3)}`;
        }
      }
  }
}

/** Collects every storyteller line shown, and whether a scene was ever cut mid-line. */
class LineProbe {
  readonly seen: string[] = [];
  readonly shownAt: number[] = [];
  cutMidLine = 0;
  private lastId = -1;
  check(story: Story, t: number): void {
    const tv = story.view.text;
    if (tv.line && tv.lineId !== this.lastId) {
      this.lastId = tv.lineId;
      this.seen.push(tv.line);
      this.shownAt.push(t);
    }
    // a scene change was requested this frame: the storyteller must be done
    if (story.events.some((e) => e.type === 'whoosh') && !story.linesIdle()) this.cutMidLine++;
  }
}

describe('story v2: the script', () => {
  it('every storyteller line is 12 words or fewer and has time to be read', () => {
    for (const [id, line] of Object.entries(COPY)) {
      if (typeof line !== 'string' || id.startsWith('TITLE')) continue;
      expect(line.split(/\s+/).filter(Boolean).length, id).toBeLessThanOrEqual(12);
      expect(lineDuration(line)).toBeGreaterThanOrEqual(3.5);
    }
  });

  it('the hub counts the evening down (H1, H2, H3)', () => {
    const story = new Story();
    story.enter('menu');
    expect(story['lineQueue'][0].text).toBe(COPY.H1);
    story.talesPlayed = 1;
    story.enter('menu');
    expect(story['lineQueue'][0].text).toBe(COPY.H2);
    story.talesPlayed = 2;
    story.enter('menu');
    expect(story['lineQueue'][0].text).toBe(COPY.H3);
  });
});

describe('story v2: tale I (Pip in the reeds, the night-light)', () => {
  it('Pip watches from the far bank, ducks at each snap; the full crocodile drifts off glowing; all lines read', () => {
    const model = new ShadowModel();
    const story = new Story();
    story.enter('croc');
    const spacing = new SpacingProbe();
    const lines = new LineProbe();
    let open = true;
    let phase = 0;
    let ducked = 0;
    let nightLight = 0;
    for (let i = 0; i < 72 * 120 && story.scene === 'croc'; i++) {
      const ff = story.view.fireflies.find((f) => f.alive);
      phase += 1 / 72;
      if (phase > 0.3) {
        phase = 0;
        open = !open;
      }
      if (ff) setHand(model, ff.x - 0.06, ff.y, 'open', open ? 1.0 : 0.2);
      else setHand(model, 0, -0.05, 'open', 0.3);
      story.update(1 / 72, model);
      lines.check(story, i / 72);
      // the player's hand is not a story silhouette; the night-light croc and Pip are
      spacing.check(story);
      if (story.events.some((e) => e.type === 'chomp')) ducked += story.view.rabbit.tremble > 0.9 ? 1 : 0;
      if (story.view.nightLight.visible > 0.5) nightLight++;
      const rv = story.view.rabbit;
      if (rv.visible > 0.5 && story.scene === 'croc') {
        // out of the firefly band (fireflies never pass |x| 0.42)
        expect(rv.x - 0.066).toBeGreaterThan(0.5);
      }
    }
    expect(story.progress.completed.croc).toBe(true);
    expect(ducked).toBeGreaterThan(3);
    expect(nightLight).toBeGreaterThan(72);
    expect(spacing.worst, spacing.where).toBeGreaterThanOrEqual(0);
    for (const id of ['I1', 'I2', 'I3', 'I4', 'I5'] as const) expect(lines.seen, id).toContain(COPY[id]);
    expect(lines.cutMidLine).toBe(0);
  });
});

describe('story v2: tale III (the moon behind Pip; time for the song)', () => {
  it('the wolf never merges with Pip, and III4 + III5 get about 8 s after the twist', () => {
    const model = new ShadowModel();
    const story = new Story();
    story.enter('wolf');
    const spacing = new SpacingProbe();
    const lines = new LineProbe();
    let t = 0;
    let twistAt = -1;
    let endAt = -1;
    let brightened = 0;
    for (let i = 0; i < 72 * 120 && story.scene === 'wolf'; i++) {
      t = i / 72;
      const w = story.wolf;
      if (['prowl', 'cower', 'sit'].includes(w.state) && w.x < 0.5) setHand(model, 0.45, 0.15, 'open', 0.3, 1.8);
      else hide(model);
      story.update(1 / 72, model);
      lines.check(story, t);
      spacing.check(story);
      brightened = Math.max(brightened, story.view.brighten);
      if (twistAt < 0 && story.view.text.line === COPY.III3) twistAt = t;
      if (endAt < 0 && story.beat === 'end') endAt = t;
      // the moon sits right behind Pip
      if (story.view.moon.visible > 0.5) expect(Math.abs(story.view.moon.s - story.rabbit.x)).toBeLessThan(0.06);
    }
    expect(story.progress.completed.wolf).toBe(true);
    expect(spacing.worst, spacing.where).toBeGreaterThanOrEqual(0);
    expect(brightened).toBeGreaterThan(0.5);
    for (const id of ['III1', 'III2', 'III3', 'III4', 'III5'] as const) expect(lines.seen, id).toContain(COPY[id]);
    expect(endAt - twistAt).toBeGreaterThan(8);
    expect(lines.cutMidLine).toBe(0);
  });
});

describe('story v2: the last light (finale)', () => {
  const finale = (): { story: Story; model: ShadowModel } => {
    const progress = createProgress();
    progress.completed.croc = progress.completed.bridge = progress.completed.wolf = true;
    const model = new ShadowModel();
    const story = new Story(DEFAULT_STORY_SETTINGS, progress);
    story.enter('finale');
    return { story, model };
  };

  it('a finger held still: the bird lands on it, takes the spark, the lights come up, Goodnight holds', () => {
    const { story, model } = finale();
    const spacing = new SpacingProbe();
    const lines = new LineProbe();
    const ev: string[] = [];
    let landedOnFinger = false;
    let minDim = 1;
    let minFlame = 1;
    for (let i = 0; i < 72 * 60; i++) {
      const t = i / 72;
      // a pointing finger comes up 6 s in, between Pip and the wolf, and holds very still
      if (t > 6 && story.beat !== 'goodnight') setHand(model, -0.02, -0.02, 'point');
      else hide(model);
      story.update(1 / 72, model);
      lines.check(story, t);
      for (const e of story.events) ev.push(e.type);
      // (the bird perched on your finger follows you; everything else keeps its distance)
      spacing.check(story, (a, b) => (a.id === 'bird' || b.id === 'bird') && story.beat === 'perched');
      const b = story.view.bird;
      if (story.beat === 'perched' && Math.hypot(b.x - -0.02, b.y - 0.08) < 0.02) landedOnFinger = true;
      minDim = Math.min(minDim, story.view.dim);
      minFlame = Math.min(minFlame, story.view.flame);
    }
    expect(landedOnFinger).toBe(true);
    expect(ev).toContain('perch');
    expect(ev).toContain('spark');
    expect(story.beat).toBe('goodnight');
    expect(story.view.text.line).toBe(COPY.F5);
    expect(story.finaleSeen).toBe(true);
    // the lantern dims and the room's dimming lifts
    expect(minDim).toBe(0);
    // ...to a low, warm night-light glow
    expect(minFlame).toBeLessThan(0.5);
    expect(lines.seen).toEqual([COPY.F1, COPY.F2, COPY.F3, COPY.F4, COPY.F5]);
    expect(spacing.worst, spacing.where).toBeGreaterThanOrEqual(0);
  });

  it('a moving finger does not count; with no still finger a prompt appears, then the bird lands on the stage line', () => {
    const { story, model } = finale();
    const spacing = new SpacingProbe();
    let prompted = false;
    let landedOnGround = false;
    for (let i = 0; i < 72 * 30 && !landedOnGround; i++) {
      const t = i / 72;
      // a finger waving about the whole time (never still)
      setHand(model, 0.2 * Math.sin(t * 3), 0.0, 'point');
      story.update(1 / 72, model);
      spacing.check(story);
      if (story.view.text.prompt === COPY.FINGER[0]) prompted = true;
      if (story.beat === 'perched') {
        landedOnGround = Math.abs(story.view.bird.y - GROUND_T) < 0.01;
        expect(t).toBeGreaterThan(12);
      }
    }
    expect(prompted).toBe(true);
    expect(landedOnGround).toBe(true);
    expect(spacing.worst, spacing.where).toBeGreaterThanOrEqual(0);
  });

  it('a still finger with real tracking jitter (a few mm on the wall) still counts as still', () => {
    const { story, model } = finale();
    run(story, model, 3.2, () => hide(model)); // title card
    let seed = 3;
    const noise = (): number => {
      // a deterministic ~N(0, 1)
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        seed = (seed * 16807) % 2147483647;
        sum += seed / 2147483647 - 0.5;
      }
      return sum * 1.7;
    };
    let landed = -1;
    for (let i = 0; i < 72 * 8 && landed < 0; i++) {
      const a = setHand(model, 0.0, -0.02, 'point');
      a.tipS += noise() * 0.004;
      a.tipT += noise() * 0.004;
      story.update(1 / 72, model);
      if (story.beat === 'perched') landed = i / 72;
    }
    expect(landed).toBeGreaterThan(0);
    expect(landed).toBeLessThan(5);
  });

  it('a brief pose flicker does not reset the hold (hysteresis)', () => {
    const { story, model } = finale();
    run(story, model, 3.2, () => hide(model)); // title card
    let flick = 0;
    let approached = false;
    for (let i = 0; i < 72 * 4 && !approached; i++) {
      // still finger, but every half second the pose drops for two frames
      flick = (flick + 1) % 36;
      setHand(model, 0.05, 0.0, flick < 2 ? 'none' : 'point');
      story.update(1 / 72, model);
      approached = story.beat === 'approach' || story.beat === 'perched';
    }
    expect(approached).toBe(true);
  });
});

function run(story: Story, model: ShadowModel, seconds: number, each?: () => void): void {
  for (let i = 0; i < Math.round(seconds * 72); i++) {
    each?.();
    story.update(1 / 72, model);
  }
}

describe('story v2: the bridge prompt never fires during success (judge)', () => {
  it('after help was needed, once Pip steps onto your hand no stall prompt or hint comes back', () => {
    const model = new ShadowModel();
    const story = new Story();
    story.enter('bridge');
    // nobody helps for a while: the hint and then the words appear
    run(story, model, 16, () => hide(model));
    expect(story.view.text.prompt).not.toBe('');
    let stepped = false;
    let steppedAt = 0;
    let promptedAfter = 0;
    for (let i = 0; i < 72 * 30 && story.scene === 'bridge' && story.beat === 'cross'; i++) {
      // a flat hand across the river, flush with the bank tops; for its first
      // 9 s it stops short of the far bank, so Pip waits on your hand
      const short = !stepped || i / 72 - steppedAt < 9;
      const a = setHand(model, 0, GROUND_T - 0.025, 'open');
      model.capsules[0].ax = -0.36;
      model.capsules[0].bx = short ? 0.02 : 0.36;
      model.capsules[0].r = 0.025;
      a.minS = -0.4;
      a.maxS = 0.4;
      story.update(1 / 72, model);
      if (story.rabbit.onShadow && !stepped) {
        stepped = true;
        steppedAt = i / 72;
      }
      if (stepped && story['promptWant'] !== '') promptedAfter++;
    }
    expect(stepped).toBe(true);
    expect(promptedAfter).toBe(0);
  });
});

describe('story v2: the bridge never soft-locks (review)', () => {
  it('if the hand goes away after Pip stepped on, the hint comes back and the plank still drops', () => {
    // (Pip is left standing at the edge of the bank: stuck, so help is needed again)
    const model = new ShadowModel();
    const story = new Story();
    story.enter('bridge');
    run(story, model, 4, () => hide(model)); // the title card, Pip walks to the edge
    let stepped = false;
    let hintAfterFall = false;
    for (let i = 0; i < 72 * 45 && story.scene === 'bridge' && story.beat === 'cross'; i++) {
      if (!stepped) {
        // a short hand Pip can step onto, then the player takes it away
        const a = setHand(model, 0, GROUND_T - 0.025, 'open');
        model.capsules[0].ax = -0.36;
        model.capsules[0].bx = 0.0;
        model.capsules[0].r = 0.025;
        a.minS = -0.4;
        a.maxS = 0.05;
        if (story.rabbit.onShadow) stepped = true;
      } else hide(model);
      story.update(1 / 72, model);
      if (stepped && story.view.ghost.visible > 0.2) hintAfterFall = true;
    }
    expect(stepped).toBe(true);
    expect(hintAfterFall).toBe(true);
    // the plank assist dropped and Pip got across
    expect(story.stats.assists).toBeGreaterThan(0);
    expect(story.stats.crossings).toBe(1);
  });
});
