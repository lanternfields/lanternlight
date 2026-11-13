/**
 * The prologue's big-and-small beat (after P3): bring your hand near you and
 * its shadow grows big (Pip ducks); reach for the wall and it is small again
 * (Pip relaxes and hops up beside it). Thresholds come from the real range of
 * sizeRatio, with hysteresis, hints only after a pause, and an assist that
 * completes the beat regardless (no fail states).
 */
import { describe, expect, it } from 'vitest';
import { V3 } from '../src/core/math.js';
import { NOMINAL_PENUMBRA, relativePenumbra, computeFocalLight, createProjected, createStageFrame, nominalHandPoint, orientStage, projectToStage, stageHeightForDistance } from '../src/core/projection.js';
import { ShadowModel } from '../src/core/shadow-model.js';
import { createHandFrame } from '../src/core/hand-model.js';
import { POSES, makeHand } from './fixtures/synthetic-hand.js';
import {
  SIZE_ASSIST,
  SIZE_BIG_ON,
  SIZE_HOLD,
  SIZE_HYSTERESIS,
  SIZE_RELAX_BIG,
  SIZE_SMALL_ON,
  SizeBeat,
} from '../src/core/size-beat.js';
import { COPY } from '../src/core/copy.js';
import { DEFAULT_STORY_SETTINGS, PIP_EXTENT, PROMPT_PICTOGRAM_AFTER, Story } from '../src/core/story.js';

const DT = 1 / 72;

function feed(sb: SizeBeat, seconds: number, size: number | null, gentle = false): { grew: number; shrank: number; assisted: number } {
  const n = { grew: 0, shrank: 0, assisted: 0 };
  for (let i = 0; i < Math.round(seconds * 72); i++) {
    const ev = sb.update(DT, size, gentle);
    if (ev.grew) n.grew++;
    if (ev.shrank) n.shrank++;
    if (ev.assisted) n.assisted++;
  }
  return n;
}

describe('size beat: the thresholds come from the real range of sizeRatio', () => {
  /** A real (synthetic) open hand's sizeRatio, `back` metres nearer the viewer than the comfortable hold. */
  function sizeAt(wall: number, back: number): number {
    return modelAt(wall, back).actors[1].sizeRatio;
  }
  function modelAt(wall: number, back: number): ShadowModel {
    const head = new V3(0, 1.2, 0);
    const st = createStageFrame();
    st.origin.set(0, 1.2, -wall);
    orientStage(st, new V3(0, 0, 1));
    st.height = stageHeightForDistance(wall);
    const light = computeFocalLight(st, head, new V3());
    const m = new ShadowModel();
    // calibrated as the app does (App.calibrateNominal)
    const wrist = nominalHandPoint(st, head, new V3());
    wrist.y -= 0.05;
    const a = createProjected();
    const b = createProjected();
    projectToStage(wrist, light, st, a);
    projectToStage(new V3(wrist.x, wrist.y + 0.09, wrist.z), light, st, b);
    m.nominalMagnification = (a.magnification + b.magnification) / 2;
    const hand = makeHand(POSES.open, { position: new V3(wrist.x, wrist.y, wrist.z + back) });
    m.build([createHandFrame('left'), hand], [], light, st, DT);
    expect(m.actors[1].present).toBe(true);
    return m;
  }

  it('on an ordinary wall: ~15-20 cm back toward you is clearly big, ~10 cm toward the wall clearly small', () => {
    for (const wall of [1.5, 2.2, 3.2]) {
      const rest = sizeAt(wall, 0);
      // a comfortable hold is neither big nor small, with room to spare
      expect(rest).toBeGreaterThan(SIZE_SMALL_ON + 0.05);
      expect(rest).toBeLessThan(SIZE_BIG_ON - SIZE_HYSTERESIS);
      expect(sizeAt(wall, 0.2)).toBeGreaterThan(SIZE_BIG_ON);
      expect(sizeAt(wall, -0.12)).toBeLessThan(SIZE_SMALL_ON);
    }
  });

  it('the shadow is big and soft near you, small and sharp by the wall (the comfortable hold just under the cap)', () => {
    for (const wall of [0.8, 1.5, 2.2, 3.2]) {
      const near = modelAt(wall, 0.2).penumbra;
      const rest = modelAt(wall, 0).penumbra;
      const far = modelAt(wall, -0.12).penumbra;
      expect(rest).toBeCloseTo(NOMINAL_PENUMBRA, 3);
      expect(near).toBeGreaterThan(rest);
      expect(far).toBeLessThan(rest * 0.9);
      for (const p of [near, rest, far]) {
        expect(p).toBeGreaterThanOrEqual(0.004);
        expect(p).toBeLessThanOrEqual(0.01);
      }
    }
    expect(relativePenumbra(1, 2.5)).toBeCloseTo(NOMINAL_PENUMBRA, 6);
    expect(relativePenumbra(0.2, 2.5)).toBe(0.004);
    expect(relativePenumbra(5, 2.5)).toBe(0.01);
  });

  it('on a near wall (a less sensitive, small stage) the relaxed thresholds are still in easy reach', () => {
    for (const wall of [0.8, 1.0, 1.2]) {
      expect(sizeAt(wall, 0.25)).toBeGreaterThan(SIZE_BIG_ON - SIZE_RELAX_BIG);
      expect(sizeAt(wall, -0.18)).toBeLessThan(SIZE_SMALL_ON);
    }
  });
});

describe('size beat: logic', () => {
  it('big, then small, completes it', () => {
    const sb = new SizeBeat();
    sb.reset();
    expect(feed(sb, 2, 1.0).grew).toBe(0);
    expect(sb.phase).toBe('grow');
    expect(feed(sb, 0.6, 1.4).grew).toBe(1);
    expect(sb.phase).toBe('shrink');
    expect(sb.big).toBe(true);
    expect(feed(sb, 0.6, 0.86).shrank).toBe(1);
    expect(sb.phase).toBe('done');
    expect(sb.assists).toBe(0);
    expect(sb.big).toBe(false);
  });

  it('it has to be big first: small on its own does nothing', () => {
    const sb = new SizeBeat();
    sb.reset();
    feed(sb, 3, 0.8);
    expect(sb.phase).toBe('grow');
  });

  it('a tracking spike shorter than the hold never counts', () => {
    const sb = new SizeBeat();
    sb.reset();
    feed(sb, 1, 1.0);
    for (let k = 0; k < 20; k++) {
      feed(sb, SIZE_HOLD * 0.6, 1.6);
      feed(sb, 0.2, 1.0);
    }
    expect(sb.phase).toBe('grow');
  });

  it('hysteresis: a hand hovering at the threshold never flickers Pip', () => {
    const sb = new SizeBeat();
    sb.reset();
    feed(sb, 0.6, 1.4);
    expect(sb.phase).toBe('shrink');
    let flips = 0;
    let was = sb.big;
    // jitter around the "on" threshold: stays big
    for (let i = 0; i < 300; i++) {
      sb.update(DT, SIZE_BIG_ON + (i % 2 ? 0.02 : -0.02), false);
      if (sb.big !== was) flips++;
      was = sb.big;
    }
    expect(flips).toBe(0);
    expect(sb.big).toBe(true);
    // only well under it does the giant go
    feed(sb, 0.1, SIZE_BIG_ON - SIZE_HYSTERESIS + 0.01);
    expect(sb.big).toBe(true);
    feed(sb, 0.1, SIZE_BIG_ON - SIZE_HYSTERESIS - 0.01);
    expect(sb.big).toBe(false);
    // and the same for small: hovering at its threshold, once on, stays on
    feed(sb, 0.1, SIZE_SMALL_ON - 0.01);
    expect(sb.small).toBe(true);
    for (let i = 0; i < 100; i++) sb.update(DT, SIZE_SMALL_ON + (i % 2 ? 0.03 : -0.03), false);
    expect(sb.small).toBe(true);
  });

  it('no hand at all: the assist ends the beat (a shadow that never grew is not asked to shrink)', () => {
    const sb = new SizeBeat();
    sb.reset();
    const n = feed(sb, SIZE_ASSIST[0] - 0.1, null);
    expect(n.grew).toBe(0);
    const m = feed(sb, 0.2, null);
    expect(m.grew).toBe(1);
    expect(m.assisted).toBe(1);
    expect(sb.grewAssisted).toBe(true);
    expect(sb.phase).toBe('done');
  });

  it('gentle mode assists sooner and with easier thresholds', () => {
    const sb = new SizeBeat();
    sb.reset();
    expect(sb.bigOn(true)).toBeLessThan(sb.bigOn(false));
    expect(sb.smallOn(true)).toBeGreaterThan(sb.smallOn(false));
    expect(feed(sb, SIZE_ASSIST[1] + 0.1, null, true).assisted).toBe(1);
  });

  it('it grew but never shrinks: the assist completes the shrink too', () => {
    const sb = new SizeBeat();
    sb.reset();
    feed(sb, 0.6, 1.4);
    const n = feed(sb, SIZE_ASSIST[0] + 0.1, 1.05);
    expect(n.shrank).toBe(1);
    expect(n.assisted).toBe(1);
    expect(sb.phase).toBe('done');
  });

  it('the thresholds relax while the player tries, before the assist', () => {
    const sb = new SizeBeat();
    sb.reset();
    const start = sb.bigOn();
    // a modest 1.17 (a near wall, ~25 cm back) counts once relaxed, before the assist
    const n = feed(sb, SIZE_ASSIST[0] - 0.2, 1.17);
    expect(n.grew).toBe(1);
    expect(n.assisted).toBe(0);
    expect(start).toBe(SIZE_BIG_ON);
  });

  it('the hints wait for a pause: moving toward the goal restarts their clock', () => {
    const sb = new SizeBeat();
    sb.reset();
    // a slow, steady pull toward you (0.95 -> 1.1 over 6 s) is trying, not pausing
    let maxStall = 0;
    for (let i = 0; i < 6 * 72; i++) {
      sb.update(DT, 0.95 + (0.15 * i) / (6 * 72), false);
      maxStall = Math.max(maxStall, sb.stall);
    }
    expect(maxStall).toBeLessThan(1);
    // holding still is a pause
    feed(sb, PROMPT_PICTOGRAM_AFTER + 0.5, 1.1);
    expect(sb.phase).toBe('grow');
    expect(sb.stall).toBeGreaterThan(PROMPT_PICTOGRAM_AFTER);
  });
});

describe('size beat: in the prologue', () => {
  /** A hand's shadow at the stage's middle with a given size (as story.test.ts's FakeHand). */
  function shadow(model: ShadowModel, size: number | null): void {
    const a = model.actors[1];
    if (size === null) {
      a.present = false;
      a.presentTime = 0;
      a.capsuleCount = 0;
      model.capsuleCount = 0;
      return;
    }
    a.present = true;
    a.presentTime += DT;
    a.pose = 'open';
    a.capsuleStart = 0;
    a.capsuleCount = 1;
    model.capsuleCount = 1;
    const c = model.capsules[0];
    const h = 0.2 * size;
    c.ax = 0;
    c.ay = 0.05 - h / 2;
    c.bx = 0;
    c.by = 0.05 + h / 2;
    c.r = 0.1 * size;
    c.actor = 1;
    a.sizeRatio = size;
    a.minS = a.handMinS = -0.1 * size;
    a.maxS = a.handMaxS = 0.1 * size;
    a.minT = a.handMinT = 0.05 - h / 2 - c.r;
    a.maxT = a.handMaxT = 0.05 + h / 2 + c.r;
    a.centroidS = 0;
    a.centroidT = 0.05;
    a.tipS = 0;
    a.tipT = a.maxT;
  }

  /** Story at the start of the big-and-small beat (P3 read, Pip on the floor). */
  function atSizeBeat(gentle = false): { story: Story; model: ShadowModel } {
    lines = [];
    const story = new Story({ ...DEFAULT_STORY_SETTINGS, gentle });
    const model = new ShadowModel();
    let i = 0;
    while (story.beat !== 'size' && i++ < 72 * 60) {
      // reach in, make the rabbit, then take the hand away while P3 reads
      if (story.beat === 'wave' || story.beat === 'play') shadow(model, 1);
      else if (story.beat === 'rabbitHint') {
        shadow(model, 1);
        model.actors[1].pose = 'rabbit';
      } else shadow(model, null);
      story.update(DT, model);
    }
    expect(story.beat).toBe('size');
    return { story, model };
  }

  /** Every storyteller line shown, in order (one entry per showing). */
  let lines: string[] = [];
  function step(story: Story, model: ShadowModel, seconds: number, size: number | null, each?: () => void): string[] {
    for (let i = 0; i < Math.round(seconds * 72); i++) {
      shadow(model, size);
      story.update(DT, model);
      each?.();
      const l = story.view.text.line;
      if (l && lines[lines.length - 1] !== l) lines.push(l);
    }
    return lines;
  }

  it('comes between P3 and the hub, with its lines in order, and Pip watches from beside your shadow', () => {
    const { story, model } = atSizeBeat();
    lines = [];
    step(story, model, 3.2, 1.0);
    expect(lines).toEqual([COPY.P4]);
    expect(story.sizeBeat).toBe(true);
    // right hand (the default): Pip waits on the left, facing your shadow, clear of it
    expect(story.rabbit.x).toBeLessThan(-0.3);
    expect(story.rabbit.dir).toBe(1);
    const pipFront = story.rabbit.x + PIP_EXTENT.front;
    expect(pipFront).toBeLessThan(model.actors[1].handMinS);
    step(story, model, 1.2, 1.45);
    step(story, model, 1.2, 0.86);
    step(story, model, 9, null);
    expect(story.scene === 'menu' || story['pendingScene'] === 'menu').toBe(true);
    expect(lines).toEqual([COPY.P4, COPY.P5, COPY.H1]);
  });

  it('Pip ducks and leans back from the big shadow, then relaxes and hops up beside the small one', () => {
    const { story, model } = atSizeBeat();
    step(story, model, 3.2, 1.0);
    const x0 = story.rabbit.x;
    step(story, model, 1.0, 1.5);
    expect(story.rabbit.hunch).toBeGreaterThan(0.8);
    expect(story.view.rabbit.tremble).toBeGreaterThan(0.6);
    expect(story.rabbit.squash).toBeLessThan(0.86);
    // back, away from the shadow, still facing it
    expect(story.rabbit.x).toBeLessThan(x0 - 0.03);
    expect(story.rabbit.dir).toBe(1);
    let hops = 0;
    step(story, model, 2.5, 0.85, () => {
      if (story.rabbit.events.hopped) hops++;
    });
    expect(story.bigSmall.phase).toBe('done');
    expect(story.rabbit.hunch).toBeLessThan(0.3);
    expect(hops).toBeGreaterThan(0);
    // beside the (small) shadow, not inside it
    expect(story.rabbit.x + PIP_EXTENT.front).toBeLessThan(model.actors[1].handMinS);
    expect(story.rabbit.x).toBeGreaterThan(x0 - 0.01);
  });

  it('a competent player gets through it in about 8-12 s, with no hint shown', () => {
    const { story, model } = atSizeBeat();
    let t = 0;
    let ghost = 0;
    let prompt = '';
    const each = (): void => {
      t += DT;
      ghost = Math.max(ghost, story.view.ghost.visible);
      prompt ||= story.view.text.prompt;
    };
    // reads P4, then brings the hand in (2.5 s), then reaches out once P5 is up
    step(story, model, 3.0, 1.0, each);
    step(story, model, 1.5, 1.4, each);
    while (story.view.text.line !== COPY.P5 && t < 10) step(story, model, DT, 1.4, each);
    step(story, model, 1.5, 0.86, each);
    while (story.scene === 'intro' && !story['pendingScene'] && t < 20) step(story, model, DT, 0.86, each);
    expect(t).toBeGreaterThan(7);
    expect(t).toBeLessThan(12);
    expect(ghost).toBe(0);
    expect(prompt).toBe('');
  });

  it('after a pause the ghost hand shows the motion, then the words; the assist completes it anyway', () => {
    const { story, model } = atSizeBeat();
    let ghost = 0;
    const prompts = new Set<string>();
    const each = (): void => {
      ghost = Math.max(ghost, story.view.ghost.visible);
      if (story.view.text.prompt) prompts.add(story.view.text.prompt);
    };
    step(story, model, 11, 1.0, each);
    expect(ghost).toBeGreaterThan(0.2);
    expect(prompts.has(COPY.CLOSER[0])).toBe(true);
    // ...it grows at last but never shrinks: FARTHER, then the assist
    step(story, model, 2, 1.4, each);
    step(story, model, 11, 1.1, each);
    expect(prompts.has(COPY.FARTHER[0])).toBe(true);
    step(story, model, 12, 1.1, each);
    expect(story.scene === 'menu' || story['pendingScene'] === 'menu').toBe(true);
  });

  it('no hand at all: the show goes on to the hub (no fail state)', () => {
    const { story, model } = atSizeBeat();
    step(story, model, SIZE_ASSIST[0] + 9, null);
    expect(story.scene === 'menu' || story['pendingScene'] === 'menu').toBe(true);
    expect(story.bigSmall.grewAssisted).toBe(true);
  });

  it('a left hand: Pip watches from the right', () => {
    const story = new Story({ ...DEFAULT_STORY_SETTINGS, dominant: 'left' });
    const model = new ShadowModel();
    let i = 0;
    while (story.beat !== 'size' && i++ < 72 * 60) {
      story.update(DT, model);
    }
    expect(story.beat).toBe('size');
    step(story, model, 4, null);
    expect(story.rabbit.x).toBeGreaterThan(0.3);
    expect(story.rabbit.dir).toBe(-1);
  });
});
