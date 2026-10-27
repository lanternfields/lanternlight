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
import { PoseId } from './hand-features.js';

export type SceneId = 'intro' | 'menu' | 'croc' | 'bridge';
export type TaleId = 'croc' | 'bridge';

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
  | 'whoosh';

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
  };
  fireflies: FireflyView[];
  icons: IconView[];
  /** Scenery capsules (solid, drawn as cut-outs). */
  scenery: Capsule2D[];
  sceneryCount: number;
  /** Water line (stage t) or NaN. */
  waterY: number;
  /** Croc overlay on an actor (eye + teeth). */
  croc: { visible: number; eyeS: number; eyeT: number; upperS: number; upperT: number; lowerS: number; lowerT: number; open: number };
  /** Celebration sparkles 0..1. */
  sparkle: number;
  /** Short caption; empty = none. */
  caption: string;
  /** Tale progress 0..1 for the progress beads. */
  progress: number;
  /** The burrow (home) marker for the bridge tale. */
  burrow: { visible: number; s: number; t: number };
}

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
    completed: { croc: false, bridge: false },
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
    rabbit: { visible: 0, x: 0, y: GROUND_T, dir: 1, hopping: false, squash: 1, swimming: false, peering: false },
    fireflies,
    icons: [
      { id: 'croc', s: -0.34, t: 0.12, r: 0.12, fill: 0, visible: 0, completed: false, label: 'The Hungry Crocodile', armed: false },
      { id: 'bridge', s: 0.34, t: 0.12, r: 0.12, fill: 0, visible: 0, completed: false, label: "Rabbit's Bridge", armed: false },
    ],
    scenery,
    sceneryCount: 0,
    waterY: NaN,
    croc: { visible: 0, eyeS: 0, eyeT: 0, upperS: 0, upperT: 0, lowerS: 0, lowerT: 0, open: 0 },
    sparkle: 0,
    caption: '',
    progress: 0,
    burrow: { visible: 0, s: 0.62, t: GROUND_T },
  };
}

function approach(v: number, target: number, rate: number, dt: number): number {
  return v + (target - v) * (1 - Math.exp(-rate * dt));
}

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
  private readonly world: RabbitWorld;
  /** Debug/test hooks: last selected icon, counters. */
  readonly stats = { selections: 0, chomps: 0, eaten: 0, crossings: 0, splashes: 0, rabbitBirths: 0 };

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
    this.setScenery(scene);
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
    if (scene === 'intro' || scene === 'menu') {
      // A low ground strip across the stage (theatre floor).
      seg(-0.78, GROUND_T - 0.03, 0.78, GROUND_T - 0.03, 0.03);
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
      this.transition += dt / 0.7;
      v.fade = clamp(this.transition, 0, 1);
      if (this.transition >= 1) {
        const next = this.pendingScene;
        this.pendingScene = null;
        this.enter(next);
      }
    } else {
      v.fade = approach(v.fade, 0, 5, dt);
    }

    v.ghost.phase += dt;
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
    }
    this.syncRabbitView();
    v.sparkle = approach(v.sparkle, 0, 1.2, dt);
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

  private actorInPool(a: Actor): boolean {
    return Math.abs(a.centroidS) < 0.72 && Math.abs(a.centroidT) < 0.55;
  }

  private presentActor(model: ShadowModel): Actor | null {
    const a = model.primaryActor(this.settings.dominant);
    return a && this.actorInPool(a) ? a : null;
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
        if (this.beatTime > 2.6) this.setBeat('wave');
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
        if (actor && actor.presentTime > 0.45) {
          this.emit('shadowFound', actor.centroidS, actor.centroidT);
          v.sparkle = 1;
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
          this.discover('rabbit');
          this.setBeat('born');
        }
        break;
      }
      case 'born':
        v.ghost.visible = approach(v.ghost.visible, 0, 5, dt);
        v.rabbit.visible = approach(v.rabbit.visible, 1, 6, dt);
        this.stepRabbit(dt, true);
        if (this.beatTime > 2.6 && this.rabbit.state === 'idle' && !this.pendingScene) {
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
    for (const icon of v.icons) {
      icon.completed = this.progress.completed[icon.id];
      icon.visible = approach(icon.visible, this.sceneTime > 0.4 ? 1 : 0, 3, dt);
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
    // Gentle caption if nobody has touched anything for a while.
    const anyFill = v.icons.some((i) => i.fill > 0);
    v.caption = !anyFill && this.sceneTime > 6 ? 'Touch a lantern with your shadow' : '';
  }

  // ------------------------------------------------------------ crocodile
  private spawnFirefly(): void {
    const f = this.view.fireflies.find((x) => !x.alive && x.eaten === 0);
    if (!f) return;
    const side = this.rng() < 0.5 ? -1 : 1;
    f.x = side * (0.55 + this.rng() * 0.1);
    f.y = -0.15 + this.rng() * 0.45;
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
    const showGhost = this.beat === 'teach' || this.idleNoHand > 4 || this.sinceChomp > 9;
    v.ghost.pose = 'mouth';
    v.ghost.s = 0.3;
    v.ghost.t = 0.12;
    v.ghost.scale = 0.85;
    v.ghost.visible = approach(v.ghost.visible, showGhost && !actor ? 0.5 : showGhost ? 0.25 : 0, 2.5, dt);
    v.caption = this.beat === 'teach' && this.beatTime > 1.5 ? 'Open and close your hand' : '';

    if (this.beat === 'teach') {
      if (this.beatTime > 1.2 && this.beatTime - dt <= 1.2) {
        this.spawnFirefly();
        this.spawnFirefly();
      }
      if (actor && actor.presentTime > 0.6) this.setBeat('feed');
    }
    if (this.beat === 'teach' || this.beat === 'feed') {
      const alive = v.fireflies.filter((f) => f.alive).length;
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
        f.x = clamp(f.x + vx * dt, -0.66, 0.66);
        f.y = clamp(f.y + vy * dt, -0.3, 0.42);
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
      }
    } else if (this.beat === 'glow') {
      v.warmth = 1;
      v.caption = 'A very happy crocodile';
      if (this.beatTime > 3.5) {
        v.warmth = 0;
        this.requestScene('menu');
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
      v.ghost.visible = approach(v.ghost.visible, needHelp ? 0.45 : 0, 2.5, dt);
      v.caption = needHelp && this.round === 0 ? 'Make a bridge with your hand' : needHelp && this.round === 2 ? 'Bring your hand closer to the lantern' : '';
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
      v.caption = '';
      if (this.beatTime > 1.6) {
        this.round++;
        if (this.round >= this.rounds.length) {
          this.progress.completed.bridge = true;
          this.emit('taleComplete');
          this.setBeat('end');
        } else {
          this.setupRound();
          this.setBeat('cross');
        }
      }
    } else if (this.beat === 'end') {
      v.caption = 'Home, safe and sound';
      v.warmth = approach(v.warmth, 0.6, 2, dt);
      if (this.beatTime > 3) {
        v.warmth = 0;
        this.requestScene('menu');
      }
    }
  }

  private discover(pose: PoseId): void {
    if (!this.progress.discovered.includes(pose)) this.progress.discovered.push(pose);
  }
}
