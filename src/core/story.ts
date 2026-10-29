/**
 * Lanternlight's story director: prologue -> shadow-touch menu -> tales.
 *
 * Pure logic: consumes the ShadowModel each frame and produces a StageView
 * (what to draw) plus sound events. No rendering, no DOM, deterministic for a
 * given input sequence (seeded PRNG), so every beat is unit-testable.
 *
 * Interaction rules that keep it robust without headset tuning:
 *  - The shadow itself is the cursor: menus are "touch it with your shadow and
 *    hold" (large targets, dwell), identical for hands and rod puppets.
 *  - No fail states and no timers that punish; every beat has an assist that
 *    eventually completes it for you.
 */
import { Capsule2D, ShadowModel, Actor } from './shadow-model.js';
import { Rabbit, RabbitWorld } from './rabbit.js';
import { clamp, dist2, mulberry32, pointSegmentDistance } from './math.js';
import { clamp01, easeInCubic, easeInOutSine } from './ease.js';
import { PoseId } from './hand-features.js';
import { Wolf, WolfState } from './wolf.js';
import { COPY, Prompt } from './copy.js';

export type SceneId = 'intro' | 'menu' | 'croc' | 'bridge' | 'wolf' | 'finale';
export type TaleId = 'croc' | 'bridge' | 'wolf';
/** A title card: one per tale, and the finale's. */
export type TitleId = TaleId | 'finale';

export type SoundEvent =
  | 'ignite'
  | 'shadowFound'
  | 'rabbitBorn'
  | 'hop'
  | 'land'
  | 'splash'
  | 'peer'
  | 'chompOpen'
  | 'chomp'
  | 'eat'
  | 'iconTick'
  | 'select'
  | 'taleComplete'
  | 'roundComplete'
  | 'whoosh'
  | 'growl'
  | 'whimper'
  | 'wolfFlee'
  | 'howl'
  | 'bow'
  | 'title'
  | 'scare'
  | 'curtain'
  | 'goodnight'
  | 'ribbon'
  | 'chirp'
  | 'perch'
  | 'spark'
  | 'lightsUp';

export interface StoryEvent {
  type: SoundEvent;
  s: number;
  t: number;
  /** Optional magnitude (e.g. how many fireflies eaten). */
  value: number;
}

export type GhostPose = 'open' | 'rabbit' | 'mouth' | 'bridge' | 'point';

export interface FireflyView {
  x: number;
  y: number;
  glow: number;
  alive: boolean;
  /** 0..1 dissolve after being eaten. */
  eaten: number;
}

export interface IconView {
  id: TaleId;
  s: number;
  t: number;
  r: number;
  fill: number;
  visible: number;
  completed: boolean;
  label: string;
  /** An icon only fills after a shadow has been off it at least once. */
  armed: boolean;
}

export interface StageView {
  scene: SceneId;
  /** 0..1 how lit the light pool is. */
  light: number;
  /** 0..1 extra warmth (fireflies eaten, celebrations). */
  warmth: number;
  /** 0..1 fraction of the user's dim setting currently applied to the room. */
  dim: number;
  /** 0..1 lantern flame (ignition). */
  flame: number;
  /** 0..1 fade for scene transitions (0 = fully visible). */
  fade: number;
  ghost: { visible: number; pose: GhostPose; s: number; t: number; scale: number; phase: number };
  rabbit: {
    visible: number;
    x: number;
    y: number;
    dir: number;
    hopping: boolean;
    squash: number;
    swimming: boolean;
    peering: boolean;
    /** Drawing scale (1 = normal; the wolf tale is staged bigger). */
    scale: number;
    /** 0..1 trembling (secondary motion while the wolf stalks). */
    tremble: number;
  };
  fireflies: FireflyView[];
  icons: IconView[];
  /** Scenery capsules (solid, drawn as cut-outs). */
  scenery: Capsule2D[];
  sceneryCount: number;
  /** Water line (stage t) or NaN. */
  waterY: number;
  /** Croc overlay on an actor (eye + teeth). */
  croc: {
    visible: number;
    eyeS: number;
    eyeT: number;
    upperS: number;
    upperT: number;
    lowerS: number;
    lowerT: number;
    open: number;
    /** Index of the actor wearing the crocodile (-1 = none). */
    actor: number;
    /** Count of fireflies swallowed (the renderer starts a swallow glow when it changes). */
    gulps: number;
    /** 0..1 how full it is: the swallowed fireflies keep glowing in its throat. */
    full: number;
  };
  /** The full crocodile drifting off down the river, its throat still glowing (the tale's close). */
  nightLight: { visible: number; x: number; y: number; dir: number; glow: number };
  /** The finale's paper bird. */
  bird: {
    visible: number;
    x: number;
    y: number;
    dir: number;
    /** True while it flies (wings beat), false when it stands. */
    flying: boolean;
    /** Increments on each landing (the renderer plays the settle bounce). */
    landings: number;
    /** 0..1 the lantern's spark it carries in its beak. */
    carry: number;
    /** Body tilt (radians, nose up > 0). */
    tilt: number;
  };
  /**
   * The lantern's spark crossing the room to the wall (finale): travel 0..1
   * from the real lantern's flame to stage (s, t); < 0 = none.
   */
  spark: { travel: number; s: number; t: number };
  /** Half-width of the bridge tale's gap (NaN when there is none): lit ripples play in it. */
  gap: number;
  /** 0..1 the lamplight brightens as your shadow grows big enough to scare the wolf. */
  brighten: number;
  /** Celebration sparkles 0..1. */
  sparkle: number;
  /** Short caption; empty = none. */
  caption: string;
  /** Tale progress 0..1 for the progress beads. */
  progress: number;
  /** The burrow (home) marker for the bridge tale. */
  burrow: { visible: number; s: number; t: number };
  /** The Moon Wolf. */
  wolf: {
    visible: number;
    x: number;
    y: number;
    dir: number;
    state: WolfState;
    crouch: number;
    phase: number;
    fear: number;
    /** 0..1 it hesitates as your shadow grows. */
    hesitate: number;
    /** Seconds in its current state (pose timing). */
    stateTime: number;
    /** Signed speed (stretch while bolting). */
    vx: number;
    /** Drawing scale. */
    scale: number;
  };
  /** The moon (a disc of light). */
  moon: { visible: number; s: number; t: number; r: number; glow: number };
  /** How big your shadow is vs. how big it needs to be (wolf tale HUD hint), 0..1+. */
  courage: number;
  /** The title card at the start of a tale or the finale ('' = none); t = seconds into it. */
  title: { id: TitleId | ''; t: number };
  /** 0..1 how much of the scene's set is shown (it fades in as the title card leaves). */
  set: number;
  /** On-stage words (STORY_TEXT.md): one storyteller line at a time, and a hand prompt. */
  text: TextView;
  /** 0..1 a flare of lamplight when the wolf is scared off (decays). */
  flare: number;
  /** 0..1 the wall trembles with the scare (decays fast). */
  tremble: number;
}

export interface TextView {
  /** The storyteller line on the ribbon banner ('' = none). */
  line: string;
  /** 0..1 banner presence (unfurls in, fades out). */
  lineAlpha: number;
  /** Increments for every new line (the renderer redraws then). */
  lineId: number;
  /** Hand prompt in a few words ('' = none), shown only when the player stalls. */
  prompt: string;
  /** The longer, explanatory prompt for the full-captions setting. */
  promptFull: string;
  /** 0..1 prompt presence. */
  promptAlpha: number;
  /** Small-caps title above the title card's emblem ('' = none). */
  title: string;
}

/** Title-card words per card (from the copy table). */
export const TITLES: Record<TitleId, string> = {
  croc: COPY.TITLE_I,
  bridge: COPY.TITLE_II,
  wolf: COPY.TITLE_III,
  finale: COPY.TITLE_F,
};

// ------------------------------------------------------------ silhouettes
// Story silhouettes never overlap, and keep at least about one body-width
// between them (the critic: Pip and the wolf merged into one blob). The
// extents are the drawn puppets' (stage units at scale 1, facing +x).

/** The rabbit puppet's drawing scale (its model is ~0.16 stage units tall at 1). */
export const RABBIT_DRAW_SCALE = 1.55;
export interface Extent {
  /** Reach behind (tail) and in front (nose) of the origin. */
  back: number;
  front: number;
  height: number;
  /** Torso width: the "one body-width" of the spacing rule. */
  body: number;
}
export const PIP_EXTENT: Extent = { back: 0.085 * RABBIT_DRAW_SCALE, front: 0.077 * RABBIT_DRAW_SCALE, height: 0.165 * RABBIT_DRAW_SCALE, body: 0.1 * RABBIT_DRAW_SCALE };
/** The lanky wolf (render/wolf-puppet.ts), standing; rearing lifts its head but shortens its reach. */
export const WOLF_EXTENT: Extent = { back: 0.24, front: 0.235, height: 0.31, body: 0.19 };
/** The finale's paper bird (render/bird-puppet.ts, drawn at 1.8x its model). */
export const BIRD_EXTENT: Extent = { back: 0.047 * 1.8, front: 0.041 * 1.8, height: 0.058 * 1.8, body: 0.05 * 1.8 };
/** Where the bird's beak is, from its feet (facing +x): it carries the spark there. */
export const BIRD_BEAK: readonly [number, number] = [0.04 * 1.8, 0.045 * 1.8];
/** The full crocodile drifting off (head and back above the water line). */
export const NIGHT_CROC_EXTENT: Extent = { back: 0.15 * 1.7, front: 0.156 * 1.7, height: 0.05 * 1.7, body: 0.2 * 1.7 };

export interface SilhouetteBox {
  id: 'pip' | 'wolf' | 'bird' | 'croc';
  s0: number;
  s1: number;
  t0: number;
  t1: number;
  body: number;
}

function boxOf(id: SilhouetteBox['id'], e: Extent, x: number, y: number, dir: number, scale: number, out: SilhouetteBox, stretch = 1): void {
  const front = e.front * scale * stretch;
  const back = e.back * scale * stretch;
  out.id = id;
  out.s0 = dir >= 0 ? x - back : x - front;
  out.s1 = dir >= 0 ? x + front : x + back;
  out.t0 = y;
  out.t1 = y + e.height * scale;
  out.body = e.body * scale;
}

/**
 * The story's paper characters currently on stage, as boxes (stage units).
 * Fills `out` (grown as needed) and returns how many there are.
 */
export function silhouettes(v: StageView, out: SilhouetteBox[]): number {
  let n = 0;
  const next = (): SilhouetteBox => (out[n] ??= { id: 'pip', s0: 0, s1: 0, t0: 0, t1: 0, body: 0 });
  const rv = v.rabbit;
  if (rv.visible > 0.3) boxOf('pip', PIP_EXTENT, rv.x, rv.y, rv.dir, rv.scale, next()), n++;
  const wv = v.wolf;
  if (wv.visible > 0.3 && wv.state !== 'away') {
    const stretch = wv.state === 'flee' ? 1.25 : 1;
    boxOf('wolf', WOLF_EXTENT, wv.x, wv.y, wv.dir, wv.scale, next(), stretch), n++;
  }
  const bv = v.bird;
  if (bv.visible > 0.3) boxOf('bird', BIRD_EXTENT, bv.x, bv.y, bv.dir, 1, next()), n++;
  const nl = v.nightLight;
  if (nl.visible > 0.3) boxOf('croc', NIGHT_CROC_EXTENT, nl.x, nl.y - 0.02, nl.dir, 1, next()), n++;
  return n;
}

/** The gap the spacing rule asks for between two silhouettes: about one body-width (the smaller one's). */
export function requiredGap(a: SilhouetteBox, b: SilhouetteBox): number {
  return Math.min(a.body, b.body) * 0.9;
}

/** Horizontal or vertical clearance between two boxes (negative = they overlap). */
export function clearance(a: SilhouetteBox, b: SilhouetteBox): number {
  const gx = Math.max(a.s0 - b.s1, b.s0 - a.s1);
  const gy = Math.max(a.t0 - b.t1, b.t0 - a.t1);
  return Math.max(gx, gy);
}

/** A storyteller line stays up this long (STORY_TEXT.md: ~3.5 s, or 1 s per 6 words). */
export function lineDuration(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(3.5, words / 6);
}
/** Prompts: the pictogram (ghost hint) after this many seconds of stalling... */
export const PROMPT_PICTOGRAM_AFTER = 4;
/** ...and the words only after this many. */
export const PROMPT_WORDS_AFTER = 8;

/** Title card timing (STYLE_GUIDE 3/4): in, hold, out (seconds). */
export const TITLE_IN = 0.4;
export const TITLE_HOLD = 2.0;
export const TITLE_OUT = 0.5;
export const TITLE_DURATION = TITLE_IN + TITLE_HOLD + TITLE_OUT;
/** Scene transitions: fade out, then in (seconds). */
export const FADE_OUT = 0.6;
export const FADE_IN = 0.6;

export interface StorySettings {
  /** Bigger targets, faster dwell, stronger assists. */
  gentle: boolean;
  /** No camera-like motion of stage content (reduces particles & sways). */
  reduceMotion: boolean;
  dominant: 'left' | 'right';
}

export const DEFAULT_STORY_SETTINGS: StorySettings = {
  gentle: false,
  reduceMotion: false,
  dominant: 'right',
};

export interface Progress {
  completed: Record<TaleId, boolean>;
  firefliesEaten: number;
  crossings: number;
  discovered: PoseId[];
  visits: number;
}

export function createProgress(): Progress {
  return {
    completed: { croc: false, bridge: false, wolf: false },
    firefliesEaten: 0,
    crossings: 0,
    discovered: [],
    visits: 0,
  };
}

const MAX_FIREFLIES = 5;
const MAX_SCENERY = 16;
export const GROUND_T = -0.36;

function makeCapsule(): Capsule2D {
  return { ax: 0, ay: 0, bx: 0, by: 0, r: 0, soft: 0.004, actor: -1 };
}

function createView(): StageView {
  const fireflies: FireflyView[] = [];
  for (let i = 0; i < MAX_FIREFLIES; i++) fireflies.push({ x: 0, y: 0, glow: 0, alive: false, eaten: 0 });
  const scenery: Capsule2D[] = [];
  for (let i = 0; i < MAX_SCENERY; i++) scenery.push(makeCapsule());
  return {
    scene: 'intro',
    light: 0,
    warmth: 0,
    dim: 0,
    flame: 0,
    fade: 0,
    ghost: { visible: 0, pose: 'open', s: 0, t: 0, scale: 1, phase: 0 },
    rabbit: { visible: 0, x: 0, y: GROUND_T, dir: 1, hopping: false, squash: 1, swimming: false, peering: false, scale: 1, tremble: 0 },
    fireflies,
    icons: [
      { id: 'croc', s: -0.42, t: 0.05, r: 0.11, fill: 0, visible: 0, completed: false, label: 'The Hungry Crocodile', armed: false },
      { id: 'bridge', s: 0.0, t: 0.1, r: 0.11, fill: 0, visible: 0, completed: false, label: "Rabbit's Bridge", armed: false },
      { id: 'wolf', s: 0.42, t: 0.05, r: 0.11, fill: 0, visible: 0, completed: false, label: 'The Moon Wolf', armed: false },
    ],
    scenery,
    sceneryCount: 0,
    waterY: NaN,
    croc: { visible: 0, eyeS: 0, eyeT: 0, upperS: 0, upperT: 0, lowerS: 0, lowerT: 0, open: 0, actor: -1, gulps: 0, full: 0 },
    nightLight: { visible: 0, x: 0, y: 0, dir: -1, glow: 0 },
    bird: { visible: 0, x: 0.9, y: 0.1, dir: -1, flying: true, landings: 0, carry: 0, tilt: 0 },
    spark: { travel: -1, s: 0, t: 0 },
    gap: NaN,
    brighten: 0,
    sparkle: 0,
    caption: '',
    progress: 0,
    burrow: { visible: 0, s: 0.62, t: GROUND_T },
    wolf: { visible: 0, x: 1, y: GROUND_T, dir: -1, state: 'away', crouch: 0, phase: 0, fear: 0, hesitate: 0, stateTime: 0, vx: 0, scale: 1 },
    moon: { visible: 0, s: 0.46, t: 0.3, r: 0.075, glow: 0 },
    courage: 0,
    title: { id: '', t: 0 },
    set: 1,
    text: { line: '', lineAlpha: 0, lineId: 0, prompt: '', promptFull: '', promptAlpha: 0, title: '' },
    flare: 0,
    tremble: 0,
  };
}

function approach(v: number, target: number, rate: number, dt: number): number {
  return v + (target - v) * (1 - Math.exp(-rate * dt));
}

const PRESENT_ORDER_R = [1, 0, 3, 2];
const PRESENT_ORDER_L = [0, 1, 2, 3];

/** Stage-units distance inside the shadow needed for a dwell "touch". */
const TOUCH_DEPTH = 0.005;

export class Story {
  readonly view: StageView = createView();
  readonly events: StoryEvent[] = [];
  settings: StorySettings;
  progress: Progress;
  scene: SceneId = 'intro';
  /** Sub-state within a scene. */
  beat = '';
  beatTime = 0;
  sceneTime = 0;
  time = 0;
  readonly rabbit = new Rabbit();
  private rng = mulberry32(7);
  private pendingScene: SceneId | null = null;
  private transition = 0;
  private fadeIn = 1;
  /** Crocodile tale */
  private eaten = 0;
  private readonly eatTarget = 7;
  private spawnTimer = 0;
  private idleNoHand = 0;
  private sinceChomp = 0;
  /** Jaw line recorded while each actor's mouth was open: [us, ut, ls, lt]. */
  private readonly jaws: Float32Array[] = [0, 1, 2, 3].map(() => new Float32Array(4));
  /** Bridge tale */
  private round = 0;
  /** Gap half-widths per crossing: one crossing (the critic: a single, clear beat). */
  private readonly rounds = [0.19];
  private peerTime = 0;
  /** Seconds the rabbit has waited for help this round (drives the plank assist). */
  private waitTime = 0;
  /** Pip has stepped onto your hand this crossing (the stall prompt stays away). */
  private bridgeHelped = false;
  /** Seconds Pip has been stuck waiting this crossing (drives the plank assist). */
  private plankWait = 0;
  /** Seconds since Pip was last on your hand's shadow. */
  private offHand = 0;
  private readonly plank = { active: false, t: 0, done: false, index: 0 };
  private homeFromX = 0;
  private homeFromY = 0;
  private readonly world: RabbitWorld;
  /** Moon Wolf tale */
  readonly wolf = new Wolf();
  private wolfRound = 0;
  private roundTime = 0;
  private awayTime = 0;
  /** Debug/test hooks: last selected icon, counters. */
  readonly stats = { selections: 0, chomps: 0, eaten: 0, crossings: 0, splashes: 0, rabbitBirths: 0, assists: 0 };

  constructor(settings: StorySettings = DEFAULT_STORY_SETTINGS, progress: Progress = createProgress()) {
    this.settings = settings;
    this.progress = progress;
    this.world = {
      scenery: this.view.scenery,
      sceneryCount: 0,
      shadows: [],
      shadowCount: 0,
      waterY: -10,
      respawnX: -0.6,
      respawnY: GROUND_T,
      homeX: 10,
    };
    this.enter('intro');
  }

  // ---------------------------------------------------------- narration
  private readonly lineQueue: { text: string; hold: boolean }[] = [];
  private lineT = 0;
  private lineDur = 3.5;
  private lineHold = false;
  private promptWant = '';
  private promptWantFull = '';

  /**
   * Queues a storyteller line (one at a time; `hold` keeps it up until the
   * scene changes). An empty line (a beat the script leaves silent) is skipped.
   */
  say(text: string, hold = false): void {
    if (!text) return;
    this.lineQueue.push({ text, hold });
  }

  /**
   * True when no line is up or waiting (a held line does not count): scenes
   * never cut while the storyteller is mid-line.
   */
  linesIdle(): boolean {
    return this.lineQueue.length === 0 && (!this.view.text.line || this.lineHold);
  }

  /** Asks for a hand prompt this frame ('' = none). Shown only while asked for. */
  private ask(prompt: Prompt | null): void {
    this.promptWant = prompt ? prompt[0] : '';
    this.promptWantFull = prompt ? prompt[1] : '';
  }

  private updateNarration(dt: number): void {
    const tv = this.view.text;
    tv.title = this.view.title.id ? TITLES[this.view.title.id] : '';
    if (tv.line) {
      this.lineT += dt;
      const leaving = (!this.lineHold && this.lineT > this.lineDur) || (this.lineHold && this.lineQueue.length > 0);
      if (leaving) {
        tv.lineAlpha = Math.max(0, tv.lineAlpha - dt / 0.4);
        if (tv.lineAlpha <= 0) tv.line = '';
      } else tv.lineAlpha = Math.min(1, tv.lineAlpha + dt / 0.4);
    }
    // a new line waits for the title card and for the previous line to leave
    if (!tv.line && this.lineQueue.length > 0 && !this.view.title.id) {
      const next = this.lineQueue.shift()!;
      tv.line = next.text;
      tv.lineId++;
      this.emit(next.text === COPY.F5 && this.scene === 'finale' ? 'goodnight' : 'ribbon', 0, 0.3);
      tv.lineAlpha = 0;
      this.lineT = 0;
      this.lineHold = next.hold;
      this.lineDur = lineDuration(next.text);
    }
    // prompts: cross-fade when the words change, dissolve when no longer asked
    const want = this.promptWant;
    if (tv.prompt !== want || tv.promptFull !== this.promptWantFull) {
      tv.promptAlpha = Math.max(0, tv.promptAlpha - dt / 0.3);
      if (tv.promptAlpha <= 0) {
        tv.prompt = want;
        tv.promptFull = this.promptWantFull;
      }
    } else if (want || this.promptWantFull) tv.promptAlpha = Math.min(1, tv.promptAlpha + dt / 0.4);
    this.view.caption = tv.line;
  }

  /** The tale's opening lines have been queued (after its title card). */
  private saidOpen = false;

  private emit(type: SoundEvent, s = 0, t = 0, value = 0): void {
    this.events.push({ type, s, t, value });
    if (type === 'taleComplete') this.talesPlayed++;
  }
  /** Tales finished this evening (the hub counts the evening down: H1, H2, H3). */
  talesPlayed = 0;

  private setBeat(beat: string): void {
    this.beat = beat;
    this.beatTime = 0;
  }

  /** Jump straight to a scene (tests, demo mode, menu). */
  enter(scene: SceneId): void {
    this.scene = scene;
    this.view.scene = scene;
    this.sceneTime = 0;
    this.view.caption = '';
    this.view.progress = 0;
    this.view.sparkle = 0;
    this.view.burrow.visible = 0;
    for (const f of this.view.fireflies) {
      f.alive = false;
      f.eaten = 0;
      f.glow = 0;
    }
    for (const icon of this.view.icons) {
      icon.fill = 0;
      icon.armed = false;
    }
    if (scene !== 'wolf' && scene !== 'finale') {
      this.view.moon.visible = 0;
      this.view.wolf.visible = 0;
      this.wolf.state = 'away';
    }
    this.setScenery(scene);
    const tale = scene === 'croc' || scene === 'bridge' || scene === 'wolf';
    const carded = tale || scene === 'finale';
    this.view.title.id = carded ? scene : '';
    this.view.title.t = 0;
    this.lineQueue.length = 0;
    this.finaleStarted = false;
    // after the finale the hub keeps holding "Goodnight." (no flicker between scenes)
    const tv = this.view.text;
    const keepGoodnight = scene === 'menu' && this.finaleSeen && this.lineHold && tv.line === COPY.F5;
    // scene changes happen under a full fade: the old scene's line goes with it
    // (it never reappears half-faded over the next scene's title card)
    if (!keepGoodnight) {
      this.lineHold = false;
      this.lineDur = 0;
      tv.line = '';
      tv.lineAlpha = 0;
    }
    if (carded) this.lineDur = 0; // the previous scene's line leaves now
    this.ask(null);
    this.view.rabbit.scale = 1;
    this.view.rabbit.tremble = 0;
    this.view.wolf.scale = 1;
    this.view.brighten = 0;
    this.view.nightLight.visible = 0;
    this.view.bird.visible = 0;
    this.view.bird.carry = 0;
    this.view.spark.travel = -1;
    this.view.gap = NaN;
    this.view.croc.full = 0;
    this.saidOpen = false;
    this.said.clear();
    if (scene === 'menu' && !keepGoodnight) {
      if (this.finaleSeen) this.say(COPY.F5, true);
      else {
        const n = this.talesPlayed;
        this.say(n === 0 ? COPY.H1 : n === 1 ? COPY.H2 : COPY.H3);
      }
    }
    if (scene === 'menu' && this.view.flame < 0.5) this.emit('ignite');
    if (carded) this.emit('title', 0, 0, scene === 'croc' ? 0 : scene === 'bridge' ? 1 : scene === 'wolf' ? 2 : 3);
    this.view.set = carded ? 0 : 1;
    this.view.croc.actor = -1;
    switch (scene) {
      case 'intro':
        this.setBeat('dim');
        this.view.rabbit.visible = 0;
        break;
      case 'menu':
        this.setBeat('open');
        this.rabbit.place(0.0, GROUND_T, 1);
        break;
      case 'croc':
        this.setBeat('teach');
        this.eaten = 0;
        this.spawnTimer = 0;
        this.idleNoHand = 0;
        this.sinceChomp = 0;
        // Pip, small, watching from the far-bank reeds (out of the firefly band)
        this.rabbit.place(Story.CROC_PIP_X, GROUND_T, -1);
        this.rabbit.restTime = 1e9;
        this.view.rabbit.visible = 0;
        this.view.rabbit.scale = Story.CROC_PIP_SCALE;
        break;
      case 'bridge':
        this.round = 0;
        this.setupRound();
        this.setBeat('cross');
        break;
      case 'wolf':
        this.wolfRound = 0;
        this.roundTime = 0;
        this.awayTime = 0;
        this.wolf.state = 'away';
        this.wolf.x = 1.05;
        this.wolf.y = GROUND_T;
        // Pip by its burrow with the moon rising right behind it: the wolf's
        // walk toward the moon reads as a walk toward Pip
        this.rabbit.place(Story.WOLF_PIP_X, GROUND_T, 1);
        this.rabbit.restTime = 1e9; // the rabbit sits tight by its burrow
        this.view.rabbit.scale = Story.WOLF_RABBIT_SCALE;
        this.wolf.stopX = this.wolfClearX(Story.WOLF_SCALE) + 0.01;
        this.wolf.singX = this.wolf.stopX;
        this.view.burrow.visible = 1;
        this.view.burrow.s = Story.WOLF_PIP_X - 0.25;
        this.view.burrow.t = GROUND_T;
        // just behind Pip's head (Pip faces the wolf)
        this.view.moon.s = Story.WOLF_PIP_X + 0.04;
        this.view.moon.t = Story.MOON_LOW;
        this.view.moon.r = 0.1;
        this.setBeat('moonrise');
        break;
      case 'finale':
        // Pip and the wolf under the moon; the bird flits in with nowhere to land
        // low between them, under the storyteller's ribbon
        this.view.moon.s = -0.06;
        this.view.moon.t = -0.03;
        this.view.moon.r = 0.075;
        this.rabbit.place(Story.FINALE_PIP_X, GROUND_T, 1);
        this.rabbit.restTime = 1e9;
        this.wolf.state = 'rest';
        this.wolf.x = Story.FINALE_WOLF_X;
        this.wolf.y = GROUND_T;
        this.wolf.dir = -1;
        this.wolf.vx = 0;
        this.view.moon.visible = 0;
        // it flutters in out of the dark, in the open air between them
        this.view.bird.x = -0.02;
        this.view.bird.y = 0.0;
        this.view.bird.dir = -1;
        this.view.bird.flying = true;
        this.perch.hold = 0;
        this.perch.lost = 0;
        this.perch.actor = -1;
        this.finaleWait = 0;
        this.birdVX = 0;
        this.birdVY = 0;
        this.setBeat('flit');
        break;
    }
  }

  private setScenery(scene: SceneId): void {
    const v = this.view;
    let n = 0;
    const seg = (ax: number, ay: number, bx: number, by: number, r: number): void => {
      const c = v.scenery[n++];
      c.ax = ax;
      c.ay = ay;
      c.bx = bx;
      c.by = by;
      c.r = r;
      c.soft = 0.004;
      c.actor = -1;
    };
    v.waterY = NaN;
    if (scene === 'croc') {
      // The crocodile's river: low earth banks at both ends, water between.
      seg(-0.8, GROUND_T - 0.03, -0.55, GROUND_T - 0.05, 0.05);
      seg(0.55, GROUND_T - 0.05, 0.8, GROUND_T - 0.03, 0.05);
      v.waterY = GROUND_T + 0.005;
    } else if (scene === 'intro' || scene === 'menu' || scene === 'finale') {
      // A low ground strip across the stage (theatre floor).
      seg(-0.78, GROUND_T - 0.03, 0.78, GROUND_T - 0.03, 0.03);
    } else if (scene === 'wolf') {
      // A moonlit meadow: ground with two soft hills.
      seg(-0.8, GROUND_T - 0.03, 0.8, GROUND_T - 0.03, 0.03);
      seg(-0.78, GROUND_T - 0.06, -0.52, GROUND_T - 0.06, 0.07);
      seg(0.55, GROUND_T - 0.07, 0.8, GROUND_T - 0.07, 0.08);
    } else if (scene === 'bridge') {
      const g = this.rounds[Math.min(this.round, this.rounds.length - 1)];
      seg(-0.8, GROUND_T - 0.04, -g, GROUND_T - 0.04, 0.04);
      seg(g, GROUND_T - 0.04, 0.8, GROUND_T - 0.04, 0.04);
      // Bank lips so the edges read as earth, not a ruler.
      seg(-g, GROUND_T - 0.05, -g + 0.015, GROUND_T - 0.12, 0.03);
      seg(g, GROUND_T - 0.05, g - 0.015, GROUND_T - 0.12, 0.03);
      v.waterY = GROUND_T - 0.13;
    }
    v.sceneryCount = n;
    this.world.sceneryCount = n;
  }

  private setupRound(): void {
    this.setScenery('bridge');
    const g = this.rounds[Math.min(this.round, this.rounds.length - 1)];
    this.rabbit.place(-0.58, GROUND_T, 1);
    this.world.waterY = this.view.waterY;
    this.world.respawnX = -g - 0.03;
    this.world.respawnY = GROUND_T;
    this.world.homeX = 0.56;
    this.view.burrow.visible = 1;
    this.view.burrow.s = 0.62;
    this.view.burrow.t = GROUND_T;
    this.peerTime = 0;
    this.waitTime = 0;
    this.plankWait = 0;
    this.offHand = 0;
    this.bridgeHelped = false;
    this.plank.active = false;
    this.plank.done = false;
  }

  /** The bridge assist: a paper plank drops into the gap (eased, with a bounce). */
  private updatePlank(dt: number, gap: number): void {
    const pl = this.plank;
    const before = pl.t;
    pl.t = Math.min(1, pl.t + dt / 0.9);
    // fall with ease-in, then a small settle bounce
    const u = pl.t < 0.7 ? easeInCubic(pl.t / 0.7) : 1 - Math.sin(((pl.t - 0.7) / 0.3) * Math.PI) * 0.06;
    const y = GROUND_T + 0.32 * (1 - u) - 0.012;
    if (before < 0.7 && pl.t >= 0.7) this.emit('land', 0, GROUND_T, 1);
    const n = pl.index;
    if (n >= this.view.scenery.length) return;
    const c = this.view.scenery[n];
    c.ax = -gap - 0.05;
    c.ay = y;
    c.bx = gap + 0.05;
    c.by = y;
    c.r = 0.014;
    c.soft = 0.004;
    c.actor = -1;
    // drawn and stood on from this frame on (the count is reset by setScenery)
    this.view.sceneryCount = n + 1;
    this.world.sceneryCount = n + 1;
    if (pl.t >= 1) {
      // settled: keep it as permanent scenery for this round
      this.plank.active = false;
      this.plank.done = true;
    }
  }

  private requestScene(scene: SceneId): void {
    if (this.pendingScene) return;
    this.pendingScene = scene;
    this.transition = 0;
    this.emit('whoosh');
  }

  /** Advance the story. `model` must already be built for this frame. */
  update(dt: number, model: ShadowModel): void {
    this.events.length = 0;
    dt = Math.min(dt, 0.1);
    this.time += dt;
    this.sceneTime += dt;
    this.beatTime += dt;
    const v = this.view;
    this.world.shadows = model.capsules;
    this.world.shadowCount = model.capsuleCount;

    // Scene transitions: fade out, switch, fade in.
    if (this.pendingScene) {
      this.transition += dt / FADE_OUT;
      v.fade = Math.max(v.fade, easeInOutSine(this.transition));
      if (this.transition >= 1) {
        const next = this.pendingScene;
        this.pendingScene = null;
        this.enter(next);
        this.fadeIn = 0;
      }
    } else if (this.fadeIn < 1) {
      this.fadeIn = Math.min(1, this.fadeIn + dt / FADE_IN);
      v.fade = Math.min(v.fade, 1 - easeInOutSine(this.fadeIn));
    } else {
      v.fade = 0;
    }

    v.ghost.phase += dt;
    if (v.title.id) {
      this.updateTitle(dt);
      if (v.title.id) {
        this.syncWolfView();
        this.syncRabbitView();
        v.sparkle = approach(v.sparkle, 0, 1.2, dt);
        this.ask(null);
        this.updateNarration(dt);
        return;
      }
    }
    if (!this.saidOpen) {
      this.saidOpen = true;
      if (this.scene === 'croc') {
        this.say(COPY.I1);
        this.say(COPY.I2);
      } else if (this.scene === 'bridge') {
        this.say(COPY.II1);
        this.say(COPY.II2);
      } else if (this.scene === 'wolf') this.say(COPY.III1);
    }
    switch (this.scene) {
      case 'intro':
        this.updateIntro(dt, model);
        break;
      case 'menu':
        this.updateMenu(dt, model);
        break;
      case 'croc':
        this.updateCroc(dt, model);
        break;
      case 'bridge':
        this.updateBridge(dt, model);
        break;
      case 'wolf':
        this.updateWolf(dt, model);
        break;
      case 'finale':
        this.updateFinale(dt, model);
        break;
    }
    this.syncWolfView();
    this.syncRabbitView();
    v.sparkle = approach(v.sparkle, 0, 1.2, dt);
    v.flare = approach(v.flare, 0, 2.6, dt);
    v.tremble = Math.max(0, v.tremble - dt / 0.35);
    this.updateNarration(dt);
  }

  /**
   * The wordless title card: the stage holds still while the card shows, then
   * the set fades in as it leaves and the tale begins (its beat clock restarts).
   */
  private updateTitle(dt: number): void {
    const v = this.view;
    v.title.t += dt;
    v.light = 1;
    v.dim = 1;
    v.flame = 1;
    v.caption = '';
    v.ghost.visible = approach(v.ghost.visible, 0, 6, dt);
    v.croc.visible = approach(v.croc.visible, 0, 6, dt);
    const out = (v.title.t - TITLE_IN - TITLE_HOLD) / TITLE_OUT;
    v.set = easeInOutSine(clamp01(out));
    if (this.scene !== 'intro' && this.scene !== 'menu') v.rabbit.visible = v.set;
    if (this.scene === 'finale') {
      // Pip and the wolf are already sitting under the moon as the card leaves
      this.wolf.state = 'rest';
      v.wolf.scale = Story.FINALE_WOLF_SCALE;
      v.moon.visible = v.set;
      v.moon.glow = 0.8;
      v.warmth = approach(v.warmth, 0.35, 2, dt);
    }
    if (this.scene === 'wolf') v.moon.visible = 0;
    if (v.title.t >= TITLE_DURATION) {
      v.title.id = '';
      v.set = 1;
      this.beatTime = 0;
      this.sceneTime = 0;
    }
  }

  private syncRabbitView(): void {
    const r = this.rabbit;
    const rv = this.view.rabbit;
    rv.x = r.x;
    rv.y = r.y;
    rv.dir = r.dir;
    rv.hopping = r.state === 'hop' || r.state === 'climb';
    rv.squash = r.squash;
    rv.swimming = r.state === 'swim';
  }

  private syncWolfView(): void {
    const w = this.wolf;
    const wv = this.view.wolf;
    wv.x = w.x;
    wv.y = w.y;
    wv.dir = w.dir;
    wv.state = w.state;
    wv.crouch = w.crouch;
    wv.phase = w.phase;
    wv.fear = w.fear;
    wv.hesitate = w.hesitate;
    wv.stateTime = w.stateTime;
    wv.vx = w.vx;
    wv.visible = w.state === 'away' ? 0 : 1;
  }

  /** Pip's near edge plus one body-width of clear air: the wolf's nose stays beyond this. */
  private wolfClearX(scale: number): number {
    const pip = this.rabbit.x + PIP_EXTENT.front * this.view.rabbit.scale;
    const gap = Math.min(PIP_EXTENT.body * this.view.rabbit.scale, WOLF_EXTENT.body * scale);
    return pip + gap + WOLF_EXTENT.front * scale;
  }

  /** Lines said once per scene visit (by copy ID). */
  private readonly said = new Set<string>();
  private sayOnce(id: keyof typeof COPY, hold = false): void {
    if (this.said.has(id)) return;
    this.said.add(id);
    this.say(COPY[id] as string, hold);
  }

  /** True when every tale has been completed at least once. */
  allComplete(): boolean {
    const c = this.progress.completed;
    return c.croc && c.bridge && c.wolf;
  }

  /**
   * How big the viewer's shadow is now: the largest actor's size ratio, plus a
   * bonus when two hands (or puppets) are raised together.
   */
  bigness(model: ShadowModel): number {
    let best = 0;
    let count = 0;
    for (const a of model.actors) {
      if (!a.present || !this.actorInPool(a)) continue;
      count++;
      best = Math.max(best, a.sizeRatio);
    }
    return best + (count >= 2 ? 0.25 : 0);
  }

  private actorInPool(a: Actor): boolean {
    return Math.abs(a.centroidS) < 0.72 && Math.abs(a.centroidT) < 0.55;
  }

  /** The actor performing: the dominant hand if it is in the light, else any hand or puppet that is. */
  private presentActor(model: ShadowModel): Actor | null {
    const order = this.settings.dominant === 'right' ? PRESENT_ORDER_R : PRESENT_ORDER_L;
    for (const i of order) {
      const a = model.actors[i];
      if (a.present && this.actorInPool(a)) return a;
    }
    return null;
  }

  /**
   * True while the story asks the viewer to change their shadow's size (the
   * last bridge, scaring the wolf): fingertip taps on the lantern are ignored
   * then, so a hand pulled back toward the body never opens the menu by accident.
   */
  get sizeBeat(): boolean {
    return (this.scene === 'bridge' && this.beat === 'cross' && this.round >= 1) || (this.scene === 'wolf' && this.beat === 'scare');
  }

  private rabbitPoseSeen(model: ShadowModel): Actor | null {
    for (const a of model.actors) {
      if (!a.present) continue;
      if (a.kind === 'rod') {
        if (a.mouthClosed) return a; // trigger squeeze
        continue;
      }
      const ok: PoseId[] = this.settings.gentle ? ['rabbit', 'point', 'horns'] : ['rabbit'];
      if (ok.includes(a.pose)) return a;
    }
    return null;
  }

  // ---------------------------------------------------------------- intro
  private updateIntro(dt: number, model: ShadowModel): void {
    const v = this.view;
    const actor = this.presentActor(model);
    switch (this.beat) {
      case 'dim':
        v.dim = clamp(this.beatTime / 2.2, 0, 1);
        if (this.beatTime > 0.8 && v.flame === 0) this.emit('ignite');
        v.flame = clamp((this.beatTime - 0.8) / 0.8, 0, 1);
        v.light = clamp((this.beatTime - 1.2) / 1.4, 0, 1);
        if (this.beatTime > 2.6) {
          this.say(COPY.P1);
          this.setBeat('wave');
        }
        break;
      case 'wave':
        v.light = 1;
        v.dim = 1;
        v.flame = 1;
        v.ghost.pose = 'open';
        v.ghost.s = 0;
        v.ghost.t = 0.02;
        v.ghost.scale = 1;
        v.ghost.visible = approach(v.ghost.visible, actor ? 0 : 0.55, 3, dt);
        this.ask(!actor && this.beatTime > PROMPT_WORDS_AFTER ? COPY.REACH : null);
        if (actor && actor.presentTime > 0.45) {
          this.emit('shadowFound', actor.centroidS, actor.centroidT);
          v.sparkle = 1;
          this.say(COPY.P2);
          this.ask(null);
          this.setBeat('play');
        } else if (this.beatTime > (this.settings.gentle ? 12 : 20)) {
          // Assist: no hand in the light yet (tracking trouble, hands resting
          // elsewhere): the show goes on and the rabbit comes anyway.
          this.stats.assists++;
          this.setBeat('play');
        }
        break;
      case 'play':
        v.ghost.visible = approach(v.ghost.visible, 0, 4, dt);
        if (this.beatTime > 2.4) this.setBeat('rabbitHint');
        break;
      case 'rabbitHint': {
        const seen = this.rabbitPoseSeen(model);
        const target = actor ?? model.primaryActor(this.settings.dominant);
        v.ghost.pose = 'rabbit';
        v.ghost.s = target ? clamp(target.centroidS + 0.32, -0.5, 0.5) : 0.25;
        v.ghost.t = target ? clamp(target.centroidT, -0.2, 0.25) : 0.05;
        v.ghost.scale = 0.9;
        v.ghost.visible = approach(v.ghost.visible, 0.5, 2, dt);
        this.ask(!seen && this.beatTime > PROMPT_WORDS_AFTER ? COPY.EARS : null);
        // Assist: after a while the rabbit arrives anyway (no fail state).
        const assistAfter = this.settings.gentle ? 14 : 24;
        if (seen || this.beatTime > assistAfter) {
          const from = seen ?? target;
          const s = from ? clamp(from.tipS, -0.6, 0.6) : -0.2;
          const t = from ? clamp(from.tipT, GROUND_T, 0.4) : 0.1;
          this.rabbit.place(s, t, s > 0 ? -1 : 1);
          this.rabbit.state = 'fall';
          v.rabbit.visible = 0;
          this.stats.rabbitBirths++;
          this.emit('rabbitBorn', s, t);
          v.sparkle = 1;
          this.ask(null);
          // (P3 waits for Pip to land: Pip springs off your fingers, maybe through the ribbon's band)
          this.discover('rabbit');
          this.setBeat('born');
        }
        break;
      }
      case 'born':
        v.ghost.visible = approach(v.ghost.visible, 0, 5, dt);
        v.rabbit.visible = approach(v.rabbit.visible, 1, 6, dt);
        this.stepRabbit(dt, true);
        // Pip's introduction reads in the prologue before the menu
        const landed = this.rabbit.state === 'idle' && this.rabbit.y + PIP_EXTENT.height * v.rabbit.scale < 0.12;
        if ((landed && this.beatTime > 0.4) || this.beatTime > 2.5) this.sayOnce('P3');
        // Pip's introduction reads in full before the hub
        const ready = (this.beatTime > 4.6 && this.rabbit.state === 'idle') || this.beatTime > 9;
        if (((ready && this.linesIdle()) || this.beatTime > 16) && !this.pendingScene) {
          this.progress.visits++;
          this.requestScene('menu');
        }
        break;
    }
  }

  private stepRabbit(dt: number, active: boolean): void {
    // Keep the rabbit wandering on the floor during intro/menu.
    const r = this.rabbit;
    if (this.scene !== 'bridge') {
      if (r.x > 0.55) r.dir = -1;
      if (r.x < -0.55) r.dir = 1;
      this.world.waterY = -10;
      this.world.homeX = 10;
    }
    const ev = r.update(dt, this.world, active);
    if (ev.hopped) this.emit('hop', r.x, r.y);
    if (ev.landed) this.emit('land', r.x, r.y, ev.landedOnShadow ? 1 : 0);
    if (ev.landed && ev.landedOnShadow && this.scene === 'bridge') this.sayOnce('II4');
    if (ev.splashed) {
      this.stats.splashes++;
      this.emit('splash', r.x, r.y);
    }
    if (ev.peering) {
      this.view.rabbit.peering = true;
    } else if (r.state !== 'idle') {
      this.view.rabbit.peering = false;
    }
  }

  // ----------------------------------------------------------------- menu
  private updateMenu(dt: number, model: ShadowModel): void {
    const v = this.view;
    v.light = approach(v.light, 1, 3, dt);
    v.dim = approach(v.dim, 1, 2, dt);
    v.flame = approach(v.flame, 1, 3, dt);
    v.ghost.visible = approach(v.ghost.visible, 0, 4, dt);
    v.rabbit.visible = approach(v.rabbit.visible, 1, 4, dt);
    // The rabbit potters about slowly.
    this.rabbit.restTime = 1.4;
    this.stepRabbit(dt, true);
    const dwell = this.settings.gentle ? 0.75 : 1.1;
    // Generous: any part of your hand's shadow within ~a third of the icon's
    // radius counts (spread fingers leave gaps); the dwell prevents accidents.
    const reach = this.settings.gentle ? 0.5 : 0.35;
    for (let ii = 0; ii < v.icons.length; ii++) {
      const icon = v.icons[ii];
      icon.completed = this.progress.completed[icon.id];
      // linear 0..1 over 0.5 s, staggered 0.12 s; the renderer eases it
      icon.visible = clamp01((this.sceneTime - 0.4 - ii * 0.12) / 0.5);
      if (this.pendingScene) continue;
      const d = model.distanceToShadow(icon.s, icon.t);
      const touching = d < icon.r * reach - TOUCH_DEPTH;
      // A shadow already resting on an icon when the menu appears (e.g. right
      // after a tale) must leave it first; and give the menu a moment to appear.
      if (!touching) icon.armed = true;
      if (touching && icon.armed && this.sceneTime > 1.0) {
        const before = icon.fill;
        icon.fill = Math.min(1, icon.fill + dt / dwell);
        if (Math.floor(before * 4) !== Math.floor(icon.fill * 4)) this.emit('iconTick', icon.s, icon.t, icon.fill);
        if (icon.fill >= 1) {
          this.stats.selections++;
          this.emit('select', icon.s, icon.t);
          v.sparkle = 1;
          this.rabbit.restTime = 0.28;
          this.requestScene(icon.id);
        }
      } else {
        icon.fill = Math.max(0, icon.fill - dt * 1.2);
      }
    }
    // The script has no words here; full captions explain after a long pause.
    let anyFill = false;
    for (const i of v.icons) if (i.fill > 0) anyFill = true;
    this.ask(!anyFill && this.sceneTime > PROMPT_WORDS_AFTER + 2 ? COPY.MENU : null);
  }

  // ------------------------------------------------------------ crocodile
  private spawnFirefly(): void {
    let f: FireflyView | null = null;
    for (const x of this.view.fireflies) if (!x.alive && x.eaten === 0 && !f) f = x;
    if (!f) return;
    // inside the lamplight, where the crocodile can be seen catching them
    const side = this.rng() < 0.5 ? -1 : 1;
    f.x = side * (0.24 + this.rng() * 0.14);
    f.y = -0.12 + this.rng() * 0.22;
    f.alive = true;
    f.glow = 0;
    f.eaten = 0;
  }

  private updateCroc(dt: number, model: ShadowModel): void {
    const v = this.view;
    v.light = 1;
    v.dim = 1;
    const actor = this.presentActor(model);
    const gentle = this.settings.gentle;
    // Pip watches from the far-bank reeds, and ducks (ears flat) at every snap
    v.rabbit.visible = approach(v.rabbit.visible, 1, 4, dt);
    v.rabbit.scale = Story.CROC_PIP_SCALE;
    v.rabbit.tremble = Math.max(0, v.rabbit.tremble - dt / 0.8);
    this.stepRabbit(dt, false);
    if (this.beat === 'glow') {
      this.updateNightLight(dt);
      // the last catch finishes its burst; any firefly still about fades away
      for (const f of v.fireflies) {
        if (f.eaten > 0) {
          f.eaten = Math.min(1, f.eaten + dt * 1.6);
          if (f.eaten >= 1) f.eaten = 0;
        } else if (f.alive) {
          f.glow = Math.max(0, f.glow - dt * 1.5);
          if (f.glow <= 0) f.alive = false;
        }
      }
      v.croc.visible = approach(v.croc.visible, 0, 2.5, dt);
      v.ghost.visible = approach(v.ghost.visible, 0, 5, dt);
      v.warmth = approach(v.warmth, 0.7, 2, dt);
      // the tale ends once the crocodile has drifted off and the storyteller is done
      if (this.beatTime > 5.2 && this.linesIdle()) {
        v.warmth = 0;
        this.requestScene(this.allComplete() && !this.finaleSeen ? 'finale' : 'menu');
      }
      return;
    }
    // Croc overlay follows the active actor's mouth.
    if (actor) {
      v.croc.visible = approach(v.croc.visible, 1, 6, dt);
      v.croc.actor = model.actors.indexOf(actor);
      v.croc.eyeS = actor.knuckleS;
      v.croc.eyeT = actor.knuckleT + 0.035;
      v.croc.upperS = actor.upperS;
      v.croc.upperT = actor.upperT;
      v.croc.lowerS = actor.lowerS;
      v.croc.lowerT = actor.lowerT;
      v.croc.open = actor.mouth.openness;
      this.idleNoHand = 0;
    } else {
      v.croc.visible = approach(v.croc.visible, 0, 4, dt);
      this.idleNoHand += dt;
    }
    this.sinceChomp += dt;
    const stall = Math.max(this.idleNoHand, this.sinceChomp);
    const showGhost = (this.beat === 'teach' && this.beatTime > 1.5) || stall > PROMPT_PICTOGRAM_AFTER;
    v.ghost.pose = 'mouth';
    v.ghost.s = 0.3;
    v.ghost.t = 0.12;
    v.ghost.scale = 0.85;
    v.ghost.visible = approach(v.ghost.visible, showGhost && !actor ? 0.5 : showGhost ? 0.25 : 0, 2.5, dt);
    this.ask((this.beat === 'teach' || this.beat === 'feed') && stall > PROMPT_WORDS_AFTER ? COPY.SNAP : null);
    if (actor && actor.mouth.open && this.beat === 'feed') this.sayOnce('I3');

    if (this.beat === 'teach') {
      if (this.beatTime > 1.2 && this.beatTime - dt <= 1.2) {
        this.spawnFirefly();
        this.spawnFirefly();
      }
      if (actor && actor.presentTime > 0.6) this.setBeat('feed');
    }
    if (this.beat === 'teach' || this.beat === 'feed') {
      let alive = 0;
      for (const f of v.fireflies) if (f.alive) alive++;
      this.spawnTimer += dt;
      if (alive < 3 && this.spawnTimer > 1.3 && this.eaten + alive < this.eatTarget) {
        this.spawnTimer = 0;
        this.spawnFirefly();
      }
      const mouthOpen = !!actor && actor.mouth.open;
      const attractR = gentle ? 0.3 : 0.22;
      for (let i = 0; i < v.fireflies.length; i++) {
        const f = v.fireflies[i];
        if (f.eaten > 0) {
          f.eaten = Math.min(1, f.eaten + dt * 1.6);
          if (f.eaten >= 1) f.eaten = 0;
          continue;
        }
        if (!f.alive) continue;
        f.glow = Math.min(1, f.glow + dt * 1.5);
        const wobble = this.settings.reduceMotion ? 0.3 : 1;
        let vx = Math.sin(this.time * 0.7 + i * 2.1) * 0.05 * wobble - f.x * 0.06;
        let vy = Math.cos(this.time * 0.9 + i * 1.3) * 0.04 * wobble - (f.y - 0.08) * 0.08;
        if (actor && mouthOpen) {
          const d = dist2(f.x, f.y, actor.mouthS, actor.mouthT);
          if (d < attractR && d > 1e-4) {
            const pull = (gentle ? 0.34 : 0.2) * (1 - d / attractR);
            vx += ((actor.mouthS - f.x) / d) * pull;
            vy += ((actor.mouthT - f.y) / d) * pull;
          }
        }
        // fireflies stay inside the lamplight
        // (kept low enough that the whole crocodile chasing them stays in the light)
        f.x = clamp(f.x + vx * dt, -0.42, 0.42);
        f.y = clamp(f.y + vy * dt, -0.18, 0.15);
      }
      // Chomp! A firefly is caught if it is anywhere along the open jaws
      // (recorded while the mouth was open) or near where the jaws met.
      for (let ai = 0; ai < model.actors.length; ai++) {
        const a = model.actors[ai];
        if (!a.present) continue;
        const jaw = this.jaws[ai];
        if (a.mouthOpened) this.emit('chompOpen', a.mouthS, a.mouthT);
        if (a.mouth.open) {
          jaw[0] = a.upperS;
          jaw[1] = a.upperT;
          jaw[2] = a.lowerS;
          jaw[3] = a.lowerT;
        }
        if (!a.mouthClosed) continue;
        this.stats.chomps++;
        this.sinceChomp = 0;
        this.emit('chomp', a.mouthS, a.mouthT);
        // Pip ducks into the reeds
        v.rabbit.tremble = 1;
        this.rabbit.bounce(-2.6);
        const eatR = gentle ? 0.15 : 0.11;
        let gulped = 0;
        for (const f of v.fireflies) {
          if (!f.alive || gulped >= 2) continue;
          const dJaw = pointSegmentDistance(f.x, f.y, jaw[0], jaw[1], jaw[2], jaw[3]);
          if (dJaw <= eatR * 0.8 || dist2(f.x, f.y, a.mouthS, a.mouthT) <= eatR) {
            f.alive = false;
            f.eaten = 0.01;
            gulped++;
            this.eaten++;
            this.stats.eaten++;
            this.progress.firefliesEaten++;
            this.emit('eat', f.x, f.y, this.eaten);
            v.croc.gulps++;
            v.croc.full = Math.min(1, this.eaten / this.eatTarget);
            v.warmth = Math.min(1, this.eaten / this.eatTarget);
            if (this.eaten === 1) this.sayOnce('I4');
          }
        }
      }
      v.progress = this.eaten / this.eatTarget;
      if (this.eaten >= this.eatTarget) {
        this.setBeat('glow');
        this.emit('taleComplete');
        v.sparkle = 1;
        this.progress.completed.croc = true;
        this.ask(null);
        this.sayOnce('I5');
        // the full crocodile slips off your hand into the river, its throat still glowing
        const nl = v.nightLight;
        const from = actor ? actor.knuckleS : 0;
        nl.x = clamp(from, -0.32, Story.CROC_PIP_X - PIP_EXTENT.back * Story.CROC_PIP_SCALE - NIGHT_CROC_EXTENT.back - 0.2);
        nl.y = v.waterY + 0.006;
        nl.dir = -1;
        nl.visible = 0;
        nl.glow = 1;
        this.driftV = 0;
      }
    }
  }

  private driftV = 0;
  /** The close of tale I: the full crocodile drifts off down the river, a night-light. */
  private updateNightLight(dt: number): void {
    const nl = this.view.nightLight;
    const t = this.beatTime;
    // surfaces (0.6 s), then drifts away downstream, easing up to speed
    nl.visible = clamp01(t / 0.6) * clamp01((nl.x + 1.02) / 0.18);
    if (t > 0.9) {
      this.driftV = approach(this.driftV, 0.2, 1.2, dt);
      nl.x -= this.driftV * dt;
    }
    nl.y = this.view.waterY + 0.006;
    nl.glow = 0.85 + 0.15 * Math.sin(this.time * 2.1);
  }

  // --------------------------------------------------------------- bridge
  private updateBridge(dt: number, model: ShadowModel): void {
    const v = this.view;
    v.light = 1;
    v.dim = 1;
    v.croc.visible = approach(v.croc.visible, 0, 6, dt);
    v.rabbit.visible = approach(v.rabbit.visible, 1, 5, dt);
    this.rabbit.restTime = 0.28;
    v.gap = this.rounds[Math.min(this.round, this.rounds.length - 1)];
    if (this.beat === 'cross') {
      this.stepRabbit(dt, true);
      const r = this.rabbit;
      if (v.rabbit.peering && r.state === 'idle') this.peerTime += dt;
      else if (r.state === 'hop') this.peerTime = Math.max(0, this.peerTime - dt);
      // once Pip has stepped onto your hand the bridge is working: no stall
      // hint or prompt again this crossing, however long Pip pauses on it
      if (r.onShadow) {
        this.bridgeHelped = true;
        this.waitTime = 0;
        this.offHand = 0;
      } else this.offHand += dt;
      // ...until the hand has gone (Pip off it for a while, or fallen in): then
      // help is needed again (a quick hop between shadow and bank doesn't count)
      if (r.state === 'fall' || r.state === 'swim' || r.state === 'climb' || (this.offHand > 1.5 && r.state === 'idle')) {
        this.bridgeHelped = false;
      }
      const waiting = this.peerTime > (this.settings.gentle ? 1.5 : 2.5);
      const needHelp = !this.bridgeHelped && waiting;
      // the plank's clock runs whenever Pip is stuck waiting, prompt or not
      if (waiting) this.plankWait += dt;
      const g = this.rounds[Math.min(this.round, this.rounds.length - 1)];
      v.ghost.pose = 'bridge';
      v.ghost.s = 0;
      v.ghost.t = GROUND_T + 0.02;
      v.ghost.scale = (2 * g + 0.12) / 0.5;
      // the last, widest gap: the pictogram grows toward you (bring it closer)
      if (this.round === 2) v.ghost.scale *= 1 + 0.18 * (0.5 + 0.5 * Math.sin(this.time * 2.2));
      v.ghost.visible = approach(v.ghost.visible, needHelp ? 0.45 : 0, 2.5, dt);
      if (needHelp) this.waitTime += dt;
      this.ask(needHelp && this.waitTime > PROMPT_WORDS_AFTER - 2.5 ? (this.round === 2 ? COPY.CLOSER : COPY.BRIDGE) : null);
      if (!this.plank.active && !this.plank.done && this.plankWait > (this.settings.gentle ? 9 : 16)) {
        this.plank.active = true;
        this.plank.t = 0;
        this.plank.index = this.world.sceneryCount;
        this.stats.assists++;
        this.sayOnce('II3');
        this.emit('whoosh', 0, GROUND_T);
      }
      if (this.plank.active) this.updatePlank(dt, g);
      v.progress = (this.round + (r.x > 0 ? 0.5 : 0)) / this.rounds.length;
      if (r.state === 'home') {
        this.stats.crossings++;
        this.progress.crossings++;
        this.emit('roundComplete', r.x, r.y, this.round + 1);
        v.sparkle = 1;
        this.setBeat('celebrate');
      }
    } else if (this.beat === 'celebrate') {
      v.ghost.visible = approach(v.ghost.visible, 0, 5, dt);
      this.ask(null);
      // Pip hops to the burrow's door and goes in
      const t = this.beatTime;
      const r = this.rabbit;
      if (t < dt * 1.5) {
        this.homeFromX = r.x;
        this.homeFromY = r.y;
      }
      const door = v.burrow.s;
      const hop = Math.min(1, t / 0.75);
      const e = hop * hop * (3 - 2 * hop);
      r.x = this.homeFromX + (door - this.homeFromX) * e;
      r.y = this.homeFromY + (GROUND_T + 0.01 - this.homeFromY) * e + Math.sin(Math.PI * hop) * 0.07;
      r.dir = door >= this.homeFromX ? 1 : -1;
      v.rabbit.hopping = hop < 1;
      if (hop >= 1) {
        // into the doorway: a little squash, then gone inside
        const inn = Math.min(1, (t - 0.75) / 0.35);
        v.rabbit.visible = 1 - inn * inn;
        if (inn < dt * 4) r.bounce(-3);
      }
      if (this.beatTime > 1.4) {
        this.round++;
        if (this.round >= this.rounds.length) {
          this.progress.completed.bridge = true;
          this.emit('taleComplete');
          this.sayOnce('II5');
          this.setBeat('end');
        } else {
          this.setupRound();
          this.setBeat('cross');
        }
      }
    } else if (this.beat === 'end') {
      v.warmth = approach(v.warmth, 0.6, 2, dt);
      v.rabbit.visible = 0;
      if (this.beatTime > 4.0 && this.linesIdle()) {
        v.warmth = 0;
        this.requestScene(this.allComplete() && !this.finaleSeen ? 'finale' : 'menu');
      }
    }
  }

  // ------------------------------------------------------------- moon wolf
  // Staged in the middle of the light: Pip by its burrow with the moon rising
  // right behind it, the lanky wolf stalking in from the right toward them
  // both, your shadow looming above. One scare, read in the scene itself:
  // as your shadow grows the wolf's ears flatten, Pip trembles and the
  // lamplight brightens; at the threshold it rears back, then bolts. Then the
  // twist (III3) and the song (III4, III5), with time for every line.
  private readonly wolfThresholds = [1.25];
  /** The lanky wolf: about 1.6x Pip's height. */
  static readonly WOLF_SCALE = 1.3;
  static readonly WOLF_RABBIT_SCALE = 1.0;
  static readonly WOLF_PIP_X = -0.42;
  /** Moonrise: from below Pip's feet to right behind Pip's head. */
  static readonly MOON_LOW = -0.42;
  static readonly MOON_UP = -0.1;
  /** Tale I: Pip, small, in the far-bank reeds. */
  static readonly CROC_PIP_X = 0.64;
  static readonly CROC_PIP_SCALE = 0.6;
  /** The finale: Pip and the wolf under the moon, the bird between them. */
  static readonly FINALE_PIP_X = -0.47;
  static readonly FINALE_WOLF_X = 0.45;
  static readonly FINALE_WOLF_SCALE = 1.0;
  private twistSaid = false;
  private twistAt = 0;
  private sang = false;

  /** Size the shadow must reach (gentle mode & assist lower it). */
  wolfThreshold(): number {
    const base = this.wolfThresholds[Math.min(this.wolfRound, this.wolfThresholds.length - 1)];
    const gentle = this.settings.gentle ? 0.15 : 0;
    // Assist: after 8 s of trying, the wolf gets more timid, 0.05 per second,
    // until simply holding a hand up in the light is enough.
    const assist = Math.min(0.32, Math.max(0, this.roundTime - 8) * 0.05);
    return Math.max(1.0, base - gentle - assist);
  }

  private updateWolf(dt: number, model: ShadowModel): void {
    const v = this.view;
    v.light = 1;
    v.dim = 1;
    v.croc.visible = approach(v.croc.visible, 0, 6, dt);
    v.rabbit.visible = approach(v.rabbit.visible, 1, 5, dt);
    v.rabbit.scale = Story.WOLF_RABBIT_SCALE;
    v.wolf.scale = Story.WOLF_SCALE;
    // moonrise, right behind Pip
    v.moon.visible = approach(v.moon.visible, 1, 1.5, dt);
    v.moon.t = Story.MOON_LOW + (Story.MOON_UP - Story.MOON_LOW) * easeInOutSine(clamp01(this.sceneTime / 3.4));
    v.moon.glow = approach(v.moon.glow, this.beat === 'howl' || this.beat === 'end' ? 1 : 0.5, 2, dt);
    this.stepRabbit(dt, false);
    const w = this.wolf;
    const big = this.bigness(model);
    const need = this.wolfThreshold();
    v.courage = clamp(big / need, 0, 1.2);
    const stalking = w.state === 'prowl' || w.state === 'sit' || w.state === 'cower';
    // Pip trembles from the stalk until the song settles it (III5: "Pip stops shaking")
    const settled = this.beat === 'end' || (this.beat === 'howl' && (v.text.line === COPY.III5 || (!COPY.III5 && this.sang)));
    const shake = this.beat === 'scare' ? (stalking && w.x < 0.66 ? 1 : 0.5) : this.beat === 'howl' && !settled ? 0.45 : 0;
    v.rabbit.tremble = approach(v.rabbit.tremble, shake, settled ? 1.6 : 4, dt);
    // the lamplight brightens as your shadow grows toward what scares the wolf
    v.brighten = approach(v.brighten, this.beat === 'scare' && stalking ? clamp01((v.courage - 0.55) / 0.45) : 0, 3, dt);
    switch (this.beat) {
      case 'moonrise':
        if (this.beatTime > 1.2) {
          w.enter(0.78, 0.1);
          this.setBeat('scare');
        }
        break;
      case 'scare': {
        this.roundTime += dt;
        const ev = w.update(dt, big >= need, v.courage);
        if (w.x < 0.62 && w.state === 'prowl') this.sayOnce('III2');
        if (ev.growl) this.emit('growl', w.x, w.y);
        if (ev.whimper) this.emit('whimper', w.x, w.y);
        if (ev.reared) {
          // the scare lands: a flare of light and a tremble of the wall
          v.flare = 1;
          v.tremble = 1;
          this.emit('scare', w.x, w.y, 1);
        }
        if (ev.fled) {
          v.sparkle = 0.7;
          this.emit('wolfFlee', w.x, w.y, 1);
        }
        if (w.state === 'away') {
          this.awayTime += dt;
          if (this.awayTime > 0.45) {
            this.awayTime = 0;
            this.wolfRound++;
            w.befriend();
            this.twistSaid = false;
            this.twistAt = 0;
            this.sang = false;
            this.setBeat('howl');
          }
        }
        // the pictogram (a big open hand that grows) after a pause, words later
        const scaredNow = w.state === 'rear' || w.state === 'flee' || w.state === 'away';
        const stall = scaredNow ? 0 : this.roundTime;
        v.ghost.pose = 'open';
        v.ghost.s = 0.42;
        v.ghost.t = 0.12;
        v.ghost.scale = 1 + 0.5 * (0.5 + 0.5 * Math.sin(this.time * 1.6));
        v.ghost.visible = approach(v.ghost.visible, stall > PROMPT_PICTOGRAM_AFTER + 1 ? 0.3 : 0, 2, dt);
        this.ask(stall > PROMPT_WORDS_AFTER + 6 ? COPY.CLOSER : stall > PROMPT_WORDS_AFTER ? COPY.BIG : null);
        v.progress = scaredNow ? 1 : 0;
        break;
      }
      case 'howl': {
        const ev = w.update(dt, false);
        v.ghost.visible = approach(v.ghost.visible, 0, 5, dt);
        this.ask(null);
        // the image first, then the words: the twist line once the wolf is back in the light
        if (!this.twistSaid && w.x < 0.62) {
          this.twistAt += dt;
          if (this.twistAt > 0.3) {
            this.twistSaid = true;
            this.sayOnce('III3');
          }
        }
        if (ev.howl) {
          this.emit('howl', w.x, w.y);
          v.sparkle = 1;
          this.sang = true;
          this.sayOnce('III4');
          this.sayOnce('III5');
        }
        // a second verse while the storyteller finishes
        if (w.state === 'howl' && w.stateTime > 6.5 && w.stateTime - dt <= 6.5) this.emit('howl', w.x, w.y, 1);
        // the song holds until every line has been read (III4 + III5 need ~8 s)
        if (w.state === 'howl' && w.stateTime > 4 && this.linesIdle()) {
          this.progress.completed.wolf = true;
          this.emit('taleComplete');
          this.setBeat('end');
        }
        break;
      }
      case 'end':
        w.update(dt, false);
        if (this.beatTime > 1.2 && this.linesIdle()) this.requestScene(this.allComplete() && !this.finaleSeen ? 'finale' : 'menu');
        break;
    }
  }

  // ------------------------------------------------------- the last light
  // Pip and the wolf under the moon; a paper bird flits about with nowhere to
  // land (F1) until you hold one finger up, very still. It lands on your
  // finger's shadow (F2), flies to the heart of the lamplight where a spark
  // from the real lantern meets it, and carries the light away (F3). The
  // lantern dims, the pool fades and the room's dimming lifts (F4): your own
  // room returns. "Goodnight." (F5) holds until you reach into the light again.

  /** The finale has been seen (the hub then holds "Goodnight."). */
  finaleSeen = false;
  /** The finale's opening (its first line) has run for this visit. */
  private finaleStarted = false;
  /** The pointing finger the bird is waiting for: hold time with hysteresis. */
  private readonly perch = { hold: 0, lost: 0, actor: -1, tipS: 0, tipT: 0, rawS: 0, rawT: 0, speed: 0, fallback: false };
  /** Seconds spent waiting for a finger this visit (the fallback's clock; never reset by a near-landing). */
  private finaleWait = 0;
  private birdVX = 0;
  private birdVY = 0;
  private wake = 0;
  private chirpIn = 1.2;
  /** Seconds a finger must be held still before the bird comes. */
  static readonly PERCH_HOLD = 0.9;
  /** Without a finger, the bird lands here on the stage line (between Pip and the wolf). */
  static readonly BIRD_FALLBACK_X = -0.07;
  /** Where the lantern's spark meets the bird: the heart of the lamplight. */
  static readonly SPARK_S = 0.0;
  /** The lantern's flame once the bird has the light: low, warm, still glowing. */
  static readonly HEARTH_FLAME = 0.4;
  static readonly SPARK_T = 0.02;

  /** True while the story wants hand poses classified (the finale's pointing finger). */
  get wantsPose(): boolean {
    return this.scene === 'finale' && (this.beat === 'flit' || this.beat === 'approach' || this.beat === 'perched');
  }

  /**
   * The finger the bird may land on: a hand pointing one finger (in gentle
   * mode any open hand) or a rod puppet, held still. Stillness builds up a
   * hold below 0.12 stage units/s and resets above 0.3 or after 0.4 s without
   * the finger: brief tracking or pose flickers don't reset it.
   */
  private perchFinger(model: ShadowModel, dt: number): Actor | null {
    const p = this.perch;
    let best: Actor | null = null;
    let idx = -1;
    for (let i = 0; i < model.actors.length; i++) {
      const a = model.actors[i];
      if (!a.present || !this.actorInPool(a)) continue;
      const ok = a.kind === 'rod' || a.pose === 'point' || (this.settings.gentle && a.pose !== 'fist' && a.pose !== 'none');
      if (!ok) continue;
      // keep the finger we were following
      if (!best || i === p.actor) {
        best = a;
        idx = i;
      }
    }
    if (best) {
      if (idx === p.actor) {
        // speed of the smoothed fingertip (~0.17 s): tracking jitter averages out, real motion doesn't
        const ps = p.tipS;
        const pt = p.tipT;
        p.tipS = approach(p.tipS, best.tipS, 6, dt);
        p.tipT = approach(p.tipT, best.tipT, 6, dt);
        const sp = Math.hypot(p.tipS - ps, p.tipT - pt) / Math.max(dt, 1e-3);
        p.speed = approach(p.speed, sp, 10, dt);
      } else {
        p.actor = idx;
        p.speed = 0.5;
        p.hold = 0;
        p.tipS = best.tipS;
        p.tipT = best.tipT;
      }
      p.rawS = best.tipS;
      p.rawT = best.tipT;
      p.lost = 0;
    } else p.lost += dt;
    if (best && p.speed < 0.12) p.hold += dt;
    else if (p.speed > 0.3 || p.lost > 0.4) p.hold = 0;
    return best && p.hold >= Story.PERCH_HOLD ? best : null;
  }

  /** Flies the bird toward a goal on a damped spring (curved, eased paths). */
  private flyBird(gx: number, gy: number, stiff: number, dt: number): number {
    const b = this.view.bird;
    const zeta = 0.75;
    const ax = stiff * stiff * (gx - b.x) - 2 * zeta * stiff * this.birdVX;
    const ay = stiff * stiff * (gy - b.y) - 2 * zeta * stiff * this.birdVY;
    this.birdVX += ax * dt;
    this.birdVY += ay * dt;
    const sp = Math.hypot(this.birdVX, this.birdVY);
    if (sp > 0.7) {
      this.birdVX *= 0.7 / sp;
      this.birdVY *= 0.7 / sp;
    }
    b.x += this.birdVX * dt;
    b.y += this.birdVY * dt;
    b.flying = true;
    if (Math.abs(this.birdVX) > 0.04) b.dir = this.birdVX > 0 ? 1 : -1;
    b.tilt = approach(b.tilt, clamp(this.birdVY * 1.6, -0.45, 0.45), 8, dt);
    return Math.hypot(gx - b.x, gy - b.y);
  }

  private updateFinale(dt: number, model: ShadowModel): void {
    const v = this.view;
    const b = v.bird;
    const p = this.perch;
    v.wolf.scale = Story.FINALE_WOLF_SCALE;
    v.rabbit.scale = 1;
    v.rabbit.visible = approach(v.rabbit.visible, 1, 4, dt);
    if (this.beat !== 'lightsUp' && this.beat !== 'goodnight') v.moon.visible = approach(v.moon.visible, 1, 2, dt);
    this.stepRabbit(dt, false);
    this.wolf.update(dt, false);
    if (!this.finaleStarted) {
      this.finaleStarted = true;
      this.emit('curtain', 0, 0);
      this.sayOnce('F1');
    }
    const t = this.beatTime;
    const lit = this.beat === 'flit' || this.beat === 'approach' || this.beat === 'perched' || this.beat === 'spark';
    if (lit) {
      v.light = 1;
      v.dim = 1;
      v.flame = 1;
      v.warmth = approach(v.warmth, 0.35, 1.5, dt);
      v.moon.glow = 0.8;
    }
    switch (this.beat) {
      case 'flit': {
        // nowhere to land: darts about the open air between Pip and the wolf,
        // under the storyteller's ribbon and clear of them both
        b.visible = approach(b.visible, 1, 2, dt);
        const ph = this.time * 0.75;
        const tx = -0.075 + 0.08 * Math.sin(ph) + 0.02 * Math.sin(ph * 3.1 + 1);
        const ty = -0.06 + 0.07 * Math.sin(ph * 1.6 + 0.5) + 0.015 * Math.sin(ph * 4.3);
        this.flyBird(tx, ty, 2.4, dt);
        this.chirpIn -= dt;
        if (this.chirpIn <= 0) {
          this.chirpIn = 2.2 + this.rng() * 1.6;
          this.emit('chirp', b.x, b.y);
        }
        const finger = this.perchFinger(model, dt);
        // the pictogram (one pointing finger) after a pause, the words later
        v.ghost.pose = 'point';
        v.ghost.s = 0.0;
        v.ghost.t = -0.02;
        v.ghost.scale = 0.85;
        const stall = p.hold > 0 ? 0 : t;
        v.ghost.visible = approach(v.ghost.visible, stall > PROMPT_PICTOGRAM_AFTER ? 0.4 : 0, 2.5, dt);
        this.ask(stall > PROMPT_WORDS_AFTER ? COPY.FINGER : null);
        this.finaleWait += dt;
        const fallbackAfter = this.settings.gentle ? 14 : 20;
        if (finger || this.finaleWait > fallbackAfter) {
          p.fallback = !finger;
          if (!finger) this.stats.assists++;
          this.ask(null);
          this.setBeat('approach');
        }
        break;
      }
      case 'approach': {
        v.ghost.visible = approach(v.ghost.visible, 0, 5, dt);
        let gx = Story.BIRD_FALLBACK_X;
        let gy = GROUND_T + 0.002;
        if (!p.fallback) {
          this.perchFinger(model, dt);
          if (p.lost > 0.8) {
            // the finger went away: back to flitting about
            p.hold = 0;
            this.setBeat('flit');
            break;
          }
          gx = p.rawS;
          gy = p.rawT + 0.003;
        } else if (Math.abs(b.x - gx) > 0.04) {
          // to the stage line: stay up in the air until right above the spot, then drop in
          gy = Math.max(gy, -0.04);
        }
        // an eased glide that tightens as it nears the perch
        const d = this.flyBird(gx, gy, 2.6 + 5 * clamp01(t / 1.3), dt);
        if (t > 6 && d > 0.05 && !p.fallback) {
          // it could not catch up with the finger: back to flitting about
          p.hold = 0;
          this.setBeat('flit');
          break;
        }
        if ((d < 0.01 && t > 0.6) || (t > 3 && d < 0.05)) {
          b.x = gx;
          b.y = gy;
          this.birdVX = this.birdVY = 0;
          b.flying = false;
          b.landings++;
          b.tilt = 0;
          this.emit('perch', gx, gy);
          this.sayOnce('F2');
          // Pip is delighted
          this.rabbit.bounce(-3.5);
          this.setBeat('perched');
        }
        break;
      }
      case 'perched': {
        // stands on the fingertip, following it softly, and looks about
        if (!p.fallback) {
          this.perchFinger(model, dt);
          if (p.lost < 0.5) {
            b.x = approach(b.x, p.rawS, 14, dt);
            b.y = approach(b.y, p.rawT + 0.003, 14, dt);
          }
        }
        b.flying = false;
        b.tilt = approach(b.tilt, 0, 6, dt);
        if ((t > 1.5 && t - dt <= 1.5) || (t > 2.6 && t - dt <= 2.6)) b.dir = -b.dir;
        if (t > 1.0 && t - dt <= 1.0) this.emit('chirp', b.x, b.y, 1);
        const gone = !p.fallback && p.lost > 1.0 && t > 1.5;
        if ((t > 3.0 && this.linesIdle()) || t > 10 || gone) {
          this.setBeat('spark');
          v.spark.s = Story.SPARK_S;
          v.spark.t = Story.SPARK_T;
          v.spark.travel = 0;
          this.emit('spark', Story.SPARK_S, Story.SPARK_T);
        }
        break;
      }
      case 'spark': {
        // a spark leaves the real lantern and crosses the room; the bird flies to meet it
        v.spark.travel = Math.min(1, t / 1.5);
        // faces the spark, its beak (not its feet) where the spark arrives
        const dir = b.x > Story.SPARK_S + 0.01 ? -1 : 1;
        this.flyBird(Story.SPARK_S - dir * BIRD_BEAK[0], Story.SPARK_T - BIRD_BEAK[1], 3.2, dt);
        b.dir = dir;
        if (t >= 1.5) {
          v.spark.travel = -1;
          b.carry = 1;
          this.sayOnce('F3');
          this.emit('chirp', b.x, b.y, 2);
          this.setBeat('away');
        }
        break;
      }
      case 'away': {
        // off it goes with the light, up and out of the pool; the lantern dims
        // up first (clear over Pip), then away to the left
        this.flyBird(t < 0.7 ? Story.SPARK_S - 0.08 : -1.1, 0.02, 2.0, dt);
        v.flame = approach(v.flame, Story.HEARTH_FLAME, 0.8, dt);
        v.light = approach(v.light, 0.45, 0.6, dt);
        v.warmth = approach(v.warmth, 0, 1, dt);
        if (b.x < -0.98 || t > 5) {
          b.visible = 0;
          b.carry = 0;
          this.sayOnce('F4');
          this.emit('lightsUp');
          this.setBeat('lightsUp');
        }
        break;
      }
      case 'lightsUp': {
        // the pool fades and the room's dimming lifts: the real room returns
        const u = easeInOutSine(clamp01(t / 3.5));
        v.light = Math.min(v.light, 0.45 * (1 - u));
        v.moon.visible = Math.min(v.moon.visible, 1 - u);
        v.dim = 1 - u;
        // the lantern stays lit low and warm: a night-light for the room
        v.flame = approach(v.flame, Story.HEARTH_FLAME, 0.8, dt);
        v.warmth = 0;
        if (t > 3.5 && this.linesIdle()) {
          this.finaleSeen = true;
          this.say(COPY.F5, true);
          this.setBeat('goodnight');
          this.wake = 0;
        }
        break;
      }
      case 'goodnight': {
        v.light = 0;
        v.dim = 0;
        v.moon.visible = 0;
        v.flame = approach(v.flame, Story.HEARTH_FLAME, 0.8, dt);
        // the stories wake again when you reach into the lantern's light
        const a = this.presentActor(model);
        this.wake = a ? this.wake + dt : 0;
        if (t > 5 && this.wake > 1.2) this.requestScene('menu');
        break;
      }
    }
  }

  private discover(pose: PoseId): void {
    if (!this.progress.discovered.includes(pose)) this.progress.discovered.push(pose);
  }
}
