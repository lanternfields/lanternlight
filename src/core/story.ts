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

export type SceneId = 'intro' | 'menu' | 'croc' | 'bridge' | 'wolf' | 'finale';
export type TaleId = 'croc' | 'bridge' | 'wolf';

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
  | 'title';

export interface StoryEvent {
  type: SoundEvent;
  s: number;
  t: number;
  /** Optional magnitude (e.g. how many fireflies eaten). */
  value: number;
}

export type GhostPose = 'open' | 'rabbit' | 'mouth' | 'bridge';

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
  };
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
  /** The wordless title card at the start of a tale ('' = none); t = seconds into it. */
  title: { id: TaleId | ''; t: number };
  /** 0..1 how much of the scene's set is shown (it fades in as the title card leaves). */
  set: number;
  /** On-stage words (STORY_TEXT.md): one storyteller line at a time, and a hand prompt. */
  text: TextView;
  /** 0..1 a flare of lamplight when the wolf is scared off (decays). */
  flare: number;
  /** 0..1 the wall trembles with the scare (decays fast). */
  tremble: number;
  /** 0..1 the ring around the moon that fills as your shadow grows (wolf tale). */
  courageRing: number;
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

/** The storyteller's lines and the prompts (verbatim from STORY_TEXT.md). */
export const LINES = {
  lit: 'Every wall is a stage, once the lantern is lit.',
  found: 'There you are.',
  pip: 'This is Pip. Pip is small, and the night is very large.',
  choose: 'Choose a story.',
  crocOpen1: 'Down by the river, the fireflies are dancing\u2026',
  crocOpen2: '\u2026and someone is hungry.',
  crocClose: 'Full at last, the crocodile drifts off to sleep.',
  bridgeOpen: 'Pip wants to go home, but the bridge is broken.',
  bridgePlank: 'A little help from the river.',
  bridgeClose: 'Home by moonlight. Pip will tell everyone about you.',
  wolfOpen: 'Something is moving in the tall grass\u2026',
  wolfTwist: 'But the wolf only wanted to sing to the moon.',
  wolfClose: 'Some shadows are only lonely.',
  sleepy: 'The lantern is getting sleepy.',
  thanks: 'Thank you for lending us your hands.',
  goodnight: 'Goodnight.',
} as const;

export const PROMPTS = {
  raise: ['Raise a hand into the light', 'Raise one hand between the lantern and the wall'],
  rabbit: ['Two fingers up', 'Hold up two fingers, like rabbit ears'],
  menu: ['', 'Rest your shadow on a lantern to open its story'],
  snap: ['Open\u2026 and snap', 'Open your hand like jaws, then snap it shut on a firefly'],
  bridge: ['Lay your hand flat. Be the bridge.', 'Hold your hand flat and sideways so its shadow spans the river'],
  closer: ['Bring it closer to you', 'Bring your hand back toward you: its shadow grows bigger'],
  big: ['Make your shadow big', 'Bring your hand back toward you, or raise both hands, to make your shadow big'],
} as const;

export const TITLES: Record<TaleId, string> = {
  croc: 'I \u00b7 The Hungry River',
  bridge: 'II \u00b7 The Broken Bridge',
  wolf: 'III \u00b7 The Moon Wolf',
};

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
    croc: { visible: 0, eyeS: 0, eyeT: 0, upperS: 0, upperT: 0, lowerS: 0, lowerT: 0, open: 0, actor: -1, gulps: 0 },
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
    courageRing: 0,
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
  private readonly rounds = [0.13, 0.19, 0.25];
  private peerTime = 0;
  /** Seconds the rabbit has waited for help this round (drives the plank assist). */
  private waitTime = 0;
  private readonly plank = { active: false, t: 0, done: false, index: 0 };
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

  /** Queues a storyteller line (one at a time; `hold` keeps it up until the scene changes). */
  say(text: string, hold = false): void {
    this.lineQueue.push({ text, hold });
  }

  /** Asks for a hand prompt this frame ('' = none). Shown only while asked for. */
  private ask(prompt: readonly [string, string] | null): void {
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
  }

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
    this.view.title.id = tale ? scene : '';
    this.view.title.t = 0;
    this.lineQueue.length = 0;
    if (this.lineHold) this.lineHold = false;
    if (tale) this.lineDur = 0; // the previous scene's line leaves now
    this.ask(null);
    this.view.rabbit.scale = 1;
    this.view.rabbit.tremble = 0;
    this.view.wolf.scale = 1;
    this.view.courageRing = 0;
    this.saidOpen = false;
    if (scene === 'menu') this.say(LINES.choose);
    if (tale) this.emit('title', 0, 0, scene === 'croc' ? 0 : scene === 'bridge' ? 1 : 2);
    this.view.set = tale ? 0 : 1;
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
        this.view.rabbit.visible = 0;
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
        this.wolf.stopX = 0.12;
        this.wolf.singX = 0.18;
        // in the middle third of the light, the moon clear of where the hand goes
        this.rabbit.place(-0.3, GROUND_T, 1);
        this.rabbit.restTime = 1e9; // the rabbit sits tight by its burrow
        this.view.burrow.visible = 1;
        this.view.burrow.s = -0.47;
        this.view.burrow.t = GROUND_T;
        this.view.moon.s = -0.42;
        this.view.moon.t = 0.27;
        this.setBeat('moonrise');
        break;
      case 'finale':
        this.view.moon.s = 0.46;
        this.view.moon.t = 0.3;
        this.rabbit.place(-0.5, GROUND_T, 1);
        this.rabbit.restTime = 0.5;
        this.wolf.state = 'howl';
        this.wolf.x = 0.32;
        this.wolf.y = GROUND_T;
        this.wolf.dir = -1;
        this.view.moon.visible = 1;
        this.setBeat('bows');
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
        this.say(LINES.crocOpen1);
        this.say(LINES.crocOpen2);
      } else if (this.scene === 'bridge') this.say(LINES.bridgeOpen);
      else if (this.scene === 'wolf') this.say(LINES.wolfOpen);
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
        this.updateFinale(dt);
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
    if (this.scene === 'bridge' || this.scene === 'wolf') v.rabbit.visible = v.set;
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
          this.say(LINES.lit);
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
        this.ask(!actor && this.beatTime > PROMPT_WORDS_AFTER ? PROMPTS.raise : null);
        if (actor && actor.presentTime > 0.45) {
          this.emit('shadowFound', actor.centroidS, actor.centroidT);
          v.sparkle = 1;
          this.say(LINES.found);
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
        this.ask(!seen && this.beatTime > PROMPT_WORDS_AFTER ? PROMPTS.rabbit : null);
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
          this.say(LINES.pip);
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
        if (((this.beatTime > 4.6 && this.rabbit.state === 'idle') || this.beatTime > 9) && !this.pendingScene) {
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
    v.dim = 1;
    v.flame = 1;
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
    this.ask(!anyFill && this.sceneTime > PROMPT_WORDS_AFTER + 2 ? PROMPTS.menu : null);
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
    this.ask((this.beat === 'teach' || this.beat === 'feed') && stall > PROMPT_WORDS_AFTER ? PROMPTS.snap : null);

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
            v.warmth = Math.min(1, this.eaten / this.eatTarget);
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
        this.say(LINES.crocClose);
      }
    } else if (this.beat === 'glow') {
      v.warmth = 1;
      if (this.beatTime > 4.6) {
        v.warmth = 0;
        this.requestScene(this.allComplete() && !this.finaleSeen ? 'finale' : 'menu');
      }
    }
  }

  // --------------------------------------------------------------- bridge
  private updateBridge(dt: number, model: ShadowModel): void {
    const v = this.view;
    v.light = 1;
    v.dim = 1;
    v.croc.visible = approach(v.croc.visible, 0, 6, dt);
    v.rabbit.visible = approach(v.rabbit.visible, 1, 5, dt);
    this.rabbit.restTime = 0.28;
    if (this.beat === 'cross') {
      this.stepRabbit(dt, true);
      const r = this.rabbit;
      if (v.rabbit.peering && r.state === 'idle') this.peerTime += dt;
      else if (r.state === 'hop') this.peerTime = Math.max(0, this.peerTime - dt);
      const needHelp = this.peerTime > (this.settings.gentle ? 1.5 : 2.5);
      const g = this.rounds[Math.min(this.round, this.rounds.length - 1)];
      v.ghost.pose = 'bridge';
      v.ghost.s = 0;
      v.ghost.t = GROUND_T + 0.02;
      v.ghost.scale = (2 * g + 0.12) / 0.5;
      // the last, widest gap: the pictogram grows toward you (bring it closer)
      if (this.round === 2) v.ghost.scale *= 1 + 0.18 * (0.5 + 0.5 * Math.sin(this.time * 2.2));
      v.ghost.visible = approach(v.ghost.visible, needHelp ? 0.45 : 0, 2.5, dt);
      if (needHelp) this.waitTime += dt;
      this.ask(needHelp && this.waitTime > PROMPT_WORDS_AFTER - 2.5 ? (this.round === 2 ? PROMPTS.closer : PROMPTS.bridge) : null);
      if (!this.plank.active && !this.plank.done && this.waitTime > (this.settings.gentle ? 9 : 16)) {
        this.plank.active = true;
        this.plank.t = 0;
        this.plank.index = this.world.sceneryCount;
        this.stats.assists++;
        this.say(LINES.bridgePlank);
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
      if (this.beatTime > 1.6) {
        this.round++;
        if (this.round >= this.rounds.length) {
          this.progress.completed.bridge = true;
          this.emit('taleComplete');
          this.say(LINES.bridgeClose);
          this.setBeat('end');
        } else {
          this.setupRound();
          this.setBeat('cross');
        }
      }
    } else if (this.beat === 'end') {
      v.warmth = approach(v.warmth, 0.6, 2, dt);
      if (this.beatTime > 4.6) {
        v.warmth = 0;
        this.requestScene(this.allComplete() && !this.finaleSeen ? 'finale' : 'menu');
      }
    }
  }

  // ------------------------------------------------------------- moon wolf
  // Staged big, in the middle of the light: the rabbit left by its burrow
  // under the moon, the wolf stalking in from the right, your shadow above.
  // One scare: as your shadow grows the wolf hesitates and the moon's ring
  // fills; at the threshold it rears back, then bolts; the twist follows at once.
  private readonly wolfThresholds = [1.25];
  static readonly WOLF_SCALE = 1.55;
  static readonly WOLF_RABBIT_SCALE = 1.45;

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
    v.moon.visible = approach(v.moon.visible, 1, 1.5, dt);
    v.moon.glow = approach(v.moon.glow, this.beat === 'howl' || this.beat === 'end' ? 1 : 0.5, 2, dt);
    this.stepRabbit(dt, false);
    const w = this.wolf;
    const big = this.bigness(model);
    const need = this.wolfThreshold();
    v.courage = clamp(big / need, 0, 1.2);
    const stalking = w.state === 'prowl' || w.state === 'sit' || w.state === 'cower';
    v.rabbit.tremble = approach(v.rabbit.tremble, this.beat === 'scare' && stalking && w.x < 0.5 ? 1 : 0, 4, dt);
    v.courageRing = approach(v.courageRing, this.beat === 'scare' && w.state !== 'flee' && w.state !== 'away' ? 1 : 0, 4, dt);
    switch (this.beat) {
      case 'moonrise':
        if (this.beatTime > 1.2) {
          w.enter(0.66, 0.1);
          this.setBeat('scare');
        }
        break;
      case 'scare': {
        this.roundTime += dt;
        const ev = w.update(dt, big >= need, v.courage);
        if (ev.growl) this.emit('growl', w.x, w.y);
        if (ev.whimper) this.emit('whimper', w.x, w.y);
        if (ev.reared) {
          // the scare lands: a flare of light and a tremble of the wall
          v.flare = 1;
          v.tremble = 1;
          this.emit('wolfFlee', w.x, w.y, 1);
        }
        if (ev.fled) v.sparkle = 0.7;
        if (w.state === 'away') {
          this.awayTime += dt;
          if (this.awayTime > 0.45) {
            this.awayTime = 0;
            this.wolfRound++;
            w.befriend();
            this.say(LINES.wolfTwist);
            this.setBeat('howl');
          }
        }
        // the pictogram (a big open hand that grows) after a pause, words later
        const scaredNow = w.state === 'rear' || w.state === 'flee' || w.state === 'away';
        const stall = scaredNow ? 0 : this.roundTime;
        v.ghost.pose = 'open';
        v.ghost.s = 0.3;
        v.ghost.t = 0.1;
        v.ghost.scale = 1 + 0.5 * (0.5 + 0.5 * Math.sin(this.time * 1.6));
        v.ghost.visible = approach(v.ghost.visible, stall > PROMPT_PICTOGRAM_AFTER + 1 ? 0.3 : 0, 2, dt);
        this.ask(stall > PROMPT_WORDS_AFTER + 6 ? PROMPTS.closer : stall > PROMPT_WORDS_AFTER ? PROMPTS.big : null);
        v.progress = scaredNow ? 1 : 0;
        break;
      }
      case 'howl': {
        const ev = w.update(dt, false);
        v.ghost.visible = approach(v.ghost.visible, 0, 5, dt);
        this.ask(null);
        if (ev.howl) {
          this.emit('howl', w.x, w.y);
          v.sparkle = 1;
          this.say(LINES.wolfClose);
        }
        if (w.state === 'howl' && w.stateTime > 4.8) {
          this.progress.completed.wolf = true;
          this.emit('taleComplete');
          this.setBeat('end');
        }
        break;
      }
      case 'end':
        w.update(dt, false);
        if (this.beatTime > 1.2) this.requestScene(this.allComplete() && !this.finaleSeen ? 'finale' : 'menu');
        break;
    }
  }

  /** Curtain call, once all three tales are done. */
  finaleSeen = false;
  private updateFinale(dt: number): void {
    const v = this.view;
    v.light = 1;
    v.dim = 1;
    v.warmth = approach(v.warmth, 0.8, 1.5, dt);
    v.moon.visible = 1;
    v.moon.glow = 1;
    v.rabbit.visible = approach(v.rabbit.visible, 1, 4, dt);
    this.stepRabbit(dt, true);
    // fireflies drift in like stage lights
    if (this.beatTime < dt * 1.5) {
      for (let i = 0; i < 4; i++) {
        const f = v.fireflies[i];
        f.alive = true;
        f.glow = 0;
        f.x = -0.5 + i * 0.33;
        f.y = 0.38;
      }
    }
    for (let i = 0; i < v.fireflies.length; i++) {
      const f = v.fireflies[i];
      if (!f.alive) continue;
      f.glow = Math.min(1, f.glow + dt);
      f.x += Math.sin(this.time * 0.8 + i * 1.7) * 0.02 * dt;
      f.y += Math.cos(this.time * 0.6 + i) * 0.015 * dt;
    }
    const t = this.beatTime;
    if (t > 1.5 && t - dt <= 1.5) {
      this.emit('bow', -0.2, GROUND_T);
      this.rabbit.bounce(-4.5);
    }
    if (t > 3.0 && t - dt <= 3.0) {
      this.emit('howl', this.wolf.x, GROUND_T);
      this.wolf.crouch = 0.9;
    }
    if (this.beatTime < dt * 1.5) {
      this.say(LINES.sleepy);
      this.say(LINES.thanks);
      this.say(LINES.goodnight, true);
    }
    v.sparkle = t > 1.5 && t < 6 ? 1 : v.sparkle;
    if (t > 15) {
      this.finaleSeen = true;
      v.warmth = 0;
      this.requestScene('menu');
    }
  }

  private discover(pose: PoseId): void {
    if (!this.progress.discovered.includes(pose)) this.progress.discovered.push(pose);
  }
}
