/**
 * Lanternlight application: owns the show state and wires the pure core
 * (src/core) to IWSDK/WebXR input, rendering and audio.
 *
 * Frame flow (driven by the systems in src/systems):
 *   captureInput()  XRFrame -> hands (25 joints), controllers (rod puppets),
 *                   detected planes, head pose
 *   step()          placement -> ShadowModel.build -> Story.update ->
 *                   ShadowStage render -> composite/dim/lantern/text -> audio
 */
import { Matrix4, Quaternion, Vector3, VisibilityState, World } from '@iwsdk/core';
import { AudioEngine } from './audio/audio-engine.js';
import { HandFrame, JOINT_COUNT, createHandFrame } from './core/hand-model.js';
import { V3 } from './core/math.js';
import { AdaptiveQuality, FrameStats, QUALITY_LEVELS } from './core/perf.js';
import { computeFocalLight, createProjected, nominalHandPoint, projectToStage, stageToWorld } from './core/projection.js';
import { browserStore, loadProgress, loadSettings, saveProgress, saveSettings, Settings } from './core/settings.js';
import { RodInput, ShadowModel, createRodInput } from './core/shadow-model.js';
import {
  LanternPlacement,
  Obstacle,
  PlaneInfo,
  StagePlacement,
  chooseLantern,
  chooseStage,
  DEFAULT_PLACEMENT,
} from './core/stage-placement.js';
import { GENTLE_CLASSIFIER, DEFAULT_CLASSIFIER } from './core/hand-features.js';
import { SceneId, Story } from './core/story.js';
import { RoomDim, StageComposite } from './render/composite.js';
import { Lantern } from './render/lantern.js';
import { STAGE_PAD, ShadowStage } from './render/shadow-stage.js';
import { HandStandIns } from './render/hand-stand-in.js';
import { TextLabel } from './render/text.js';
import { LanternMenu, MenuAction } from './render/lantern-menu.js';
import { RodPuppetVisual } from './render/rod-puppet.js';
import { HudData, TesterHud } from './render/tester-hud.js';
import { VirtualTheatre } from './render/virtual-theatre.js';

import { detectDevice, initialQuality, maxQuality, preferredFrameRate } from './core/device.js';
export { detectDevice, initialQuality };

export const BUILD: string = typeof __BUILD__ === 'string' ? __BUILD__ : 'dev';
import { J } from './core/hand-model.js';

export type Phase = 'landing' | 'placing' | 'show' | 'paused';

interface JointCache {
  spaces: XRJointSpace[];
  poses: Float32Array;
  radii: Float32Array;
}

export class App {
  readonly settings: Settings;
  readonly story: Story;
  readonly model = new ShadowModel();
  readonly hands: HandFrame[] = [createHandFrame('left'), createHandFrame('right')];
  readonly rods: RodInput[] = [createRodInput('left'), createRodInput('right')];
  readonly planes: PlaneInfo[] = [];
  /** Furniture boxes from mesh detection (monitors, shelves, sofas...). */
  readonly obstacles: Obstacle[] = [];
  placement: StagePlacement | null = null;
  lanternPlacement: LanternPlacement | null = null;
  readonly focal = new V3();
  private readonly flameLight = new V3();
  readonly head = new V3();
  readonly headForward = new V3(0, 0, -1);
  readonly headUp = new V3(0, 1, 0);
  phase: Phase = 'landing';
  /** Debug/stills: hold the story still while shadows stay live. */
  freezeStory = false;
  /** True when IWER (the emulator) is driving the session. */
  readonly emulated: boolean;
  inputMode: 'hands' | 'controllers' | 'none' = 'none';

  readonly stage = new ShadowStage();
  readonly composite: StageComposite;
  readonly dim = new RoomDim();
  readonly lantern = new Lantern();
  readonly caption = new TextLabel(2400, 200, 0.05);
  /** Lantern-lit stand-ins for your hands where passthrough can't show them. */
  readonly standIns = new HandStandIns();
  private readonly flameW = new Vector3();
  readonly iconLabels = [new TextLabel(1600, 200, 0.04), new TextLabel(1600, 200, 0.04), new TextLabel(1600, 200, 0.04)];
  /** Caption shown now and its eased opacity (captions cross-fade, never pop). */
  private capShown = '';
  private capAlpha = 0;
  readonly audio = new AudioEngine();
  readonly menu: LanternMenu;
  readonly theatre = new VirtualTheatre();
  readonly device = detectDevice(typeof navigator !== 'undefined' ? navigator.userAgent : '');
  /** What the running session actually gave us (shown in the tester HUD). */
  session = { mode: 'none' as 'ar' | 'vr' | 'none', features: [] as string[], planesSeen: 0, meshesSeen: 0, hitTest: false };
  private hitSource: XRHitTestSource | undefined;
  private hitWall: { point: V3; normal: V3; time: number } | null = null;
  readonly hud = new TesterHud();
  readonly tester: boolean;
  /** What a tester has tried this session (auto-ticked checklist). */
  readonly tried = { left: false, right: false, controllers: false, menu: false, moved: false, recentered: false };
  readonly puppets = [new RodPuppetVisual('left'), new RodPuppetVisual('right')];
  /** Controller rays (world): origin xyz + direction xyz per hand. */
  readonly rays = [new Float32Array(6), new Float32Array(6)];
  readonly rayValid = [false, false];
  private readonly prevTrigger = [0, 0];
  private tapTime = 0;
  private tapArmed = true;
  private menuIdle = 0;
  private readonly lastTip = [new V3(), new V3()];
  private menuCooldown = 0;
  private readonly buttonArmed: boolean[] = [];
  readonly menuLog: MenuAction[] = [];
  readonly quality = new AdaptiveQuality();
  readonly frameStats = new FrameStats(600);
  readonly cpuStats = new FrameStats(600);

  private readonly jointCache = new Map<XRInputSource, JointCache>();
  private readonly handSeenAt = [0, 0];
  /** Seconds the head has been steady while a re-place waits (review M5). */
  private replaceSteady = 0;
  private replaceWait = 0;
  private readonly lastForward = new V3(0, 0, -1);
  private listenedRef: XRReferenceSpace | null = null;
  private readonly tmpM = new Matrix4();
  private readonly tmpM2 = new Matrix4();
  private readonly tmpV = new Vector3();
  private readonly tmpQ = new Quaternion();
  private readonly tmpScale = new Vector3();
  private readonly tmpV3 = new V3();
  private placingTime = 0;
  private replacePending = false;
  private placementLockedAt = -1;
  private lastFrameAt = 0;
  private sessionTime = 0;
  private saveTimer = 0;
  private readonly store = browserStore();

  constructor(readonly world: World, opts: { tester?: boolean } = {}) {
    this.tester = !!opts.tester;
    this.menu = new LanternMenu(this.tester);
    this.hud.enabled = this.tester;
    this.settings = loadSettings(this.store);
    const progress = loadProgress(this.store);
    this.story = new Story(
      { gentle: this.settings.gentle, reduceMotion: this.settings.reduceMotion, dominant: this.settings.dominant },
      progress,
    );
    this.applyClassifier();
    this.emulated = typeof (window as unknown as { IWER_DEVICE?: unknown }).IWER_DEVICE !== 'undefined';
    this.composite = new StageComposite(this.stage.target.texture);
    const root = world.createTransformEntity(undefined, { persistent: true });
    const add = (o: import('@iwsdk/core').Object3D) => world.createTransformEntity(o, { parent: root, persistent: true });
    add(this.dim.mesh);
    add(this.composite.mesh);
    add(this.composite.rods);
    add(this.lantern.group);
    add(this.caption.mesh);
    add(this.menu.group);
    add(this.hud.mesh);
    add(this.theatre.group);
    add(this.standIns.group);
    const grips = world.playerSpaceEntities.gripSpaces;
    world.createTransformEntity(this.puppets[0].group, { parent: grips.left, persistent: true });
    world.createTransformEntity(this.puppets[1].group, { parent: grips.right, persistent: true });
    for (let i = 0; i < this.menu.buttons.length; i++) this.buttonArmed.push(true);
    for (const l of this.iconLabels) add(l.mesh);
    this.setShowVisible(false);
    world.visibilityState.subscribe((state) => this.onVisibility(state));
  }

  applyClassifier(): void {
    const opts = this.settings.gentle ? GENTLE_CLASSIFIER : DEFAULT_CLASSIFIER;
    for (const a of this.model.actors) a.classifier.options = opts;
  }

  updateSettings(patch: Partial<Settings>): void {
    Object.assign(this.settings, patch);
    this.story.settings.gentle = this.settings.gentle;
    this.story.settings.reduceMotion = this.settings.reduceMotion;
    this.story.settings.dominant = this.settings.dominant;
    this.applyClassifier();
    this.audio.setVolume(this.settings.volume);
    saveSettings(this.settings, this.store);
    if (this.placement && patch.stageScale !== undefined) this.place(true);
  }

  private setShowVisible(v: boolean): void {
    this.dim.mesh.visible = v;
    this.composite.mesh.visible = v;
    this.lantern.group.visible = v;
    if (!v) {
      this.composite.rods.visible = false;
      this.caption.mesh.visible = false;
      this.menu.open = false;
      this.menu.t = 0;
      this.menu.group.visible = false;
      for (const p of this.puppets) p.group.visible = false;
      for (const l of this.iconLabels) l.mesh.visible = false;
      this.standIns.group.visible = false;
    }
  }

  private onVisibility(state: VisibilityState): void {
    if (state === VisibilityState.NonImmersive) {
      if (this.phase !== 'landing') this.endShow();
      return;
    }
    if (state === VisibilityState.Visible) {
      if (this.phase === 'landing') this.beginSession();
      else if (this.phase === 'paused') {
        this.phase = 'show';
        this.audio.resume();
        // the pause itself is not a slow frame
        this.quality.reset();
        this.lastFrameAt = 0;
      }
      try {
        this.world.renderer.xr.setFoveation(this.quality.current.foveation);
      } catch {
        /* not supported */
      }
    } else if (this.phase === 'show') {
      // Headset taken off / system menu: pause cleanly.
      this.phase = 'paused';
      this.audio.suspend();
      saveProgress(this.story.progress, this.store);
    }
  }

  private beginSession(): void {
    const session = this.world.session;
    const blend = (session as XRSession & { environmentBlendMode?: string })?.environmentBlendMode;
    this.session.mode = blend === 'opaque' ? 'vr' : 'ar';
    this.session.features = [...((session as XRSession & { enabledFeatures?: string[] })?.enabledFeatures ?? [])];
    this.session.planesSeen = 0;
    this.session.meshesSeen = 0;
    this.hitWall = null;
    this.hitSource = undefined;
    this.session.hitTest = false;
    this.theatre.group.visible = this.session.mode === 'vr';
    this.quality.level = Math.min(this.quality.level, initialQuality(this.device));
    this.quality.maxLevel = maxQuality(this.device);
    this.quality.reset();
    this.requestFrameRate(session);
    if (session && this.session.mode === 'ar') {
      session
        .requestReferenceSpace('viewer')
        .then((space) => this.world.requestHitTestSource({ space }))
        .then((src) => {
          this.hitSource = src ?? undefined;
          this.session.hitTest = !!src;
        })
        .catch(() => undefined);
    }
    this.phase = 'placing';
    this.placingTime = 0;
    this.placementLockedAt = -1;
    this.sessionTime = 0;
    this.placement = null;
    this.audio.start();
    this.audio.setVolume(this.settings.volume);
    // Entering XR from the browser's own button skips Begin: resume audio on
    // the first select/squeeze (a user gesture) as well.
    if (session) {
      const resume = () => this.audio.start();
      session.addEventListener('selectstart', resume, { once: true });
      session.addEventListener('squeezestart', resume, { once: true });
    }
    if (this.story.scene !== 'intro' || this.story.beat !== 'dim') this.story.enter('intro');
  }

  /** Asks for 90 Hz where the device has headroom; the quality controller follows the real rate. */
  private requestFrameRate(session: XRSession | undefined | null): void {
    const s = session as (XRSession & { supportedFrameRates?: Float32Array; frameRate?: number; updateTargetFrameRate?: (r: number) => Promise<void> }) | null | undefined;
    if (!s) return;
    const want = preferredFrameRate(this.device, s.supportedFrameRates);
    if (want && s.updateTargetFrameRate && s.frameRate !== want) {
      s.updateTargetFrameRate(want).catch(() => undefined);
    }
  }

  private endShow(): void {
    saveProgress(this.story.progress, this.store);
    this.phase = 'landing';
    this.setShowVisible(false);
    this.audio.suspend();
    this.jointCache.clear();
    this.story.enter('intro');
  }

  // ------------------------------------------------------------------ input
  captureInput(): void {
    const frame = this.world.xrFrame;
    const ref = this.world.xrReferenceSpace;
    const session = this.world.session;
    const player = this.world.player;
    player.updateMatrixWorld();
    const pm = player.matrixWorld;
    // head
    const headObj = player.head;
    headObj.updateMatrixWorld();
    headObj.getWorldPosition(this.tmpV);
    this.head.set(this.tmpV.x, this.tmpV.y, this.tmpV.z);
    headObj.getWorldQuaternion(this.tmpQ);
    this.tmpV.set(0, 0, -1).applyQuaternion(this.tmpQ);
    this.headForward.set(this.tmpV.x, this.tmpV.y, this.tmpV.z);
    this.tmpV.set(0, 1, 0).applyQuaternion(this.tmpQ);
    this.headUp.set(this.tmpV.x, this.tmpV.y, this.tmpV.z);

    for (const h of this.hands) h.tracked = false;
    for (const r of this.rods) r.connected = false;
    const nowMs = performance.now();
    this.rayValid[0] = this.rayValid[1] = false;
    if (!frame || !ref || !session) {
      this.inputMode = 'none';
      return;
    }
    let anyHand = false;
    let anyController = false;
    for (const source of session.inputSources) {
      const handed = source.handedness === 'left' ? 0 : source.handedness === 'right' ? 1 : -1;
      if (handed < 0) continue;
      if (source.hand) {
        const cache = this.jointsFor(source);
        let ok = false;
        const f = frame as XRFrame & {
          fillPoses?: (spaces: Iterable<XRSpace>, base: XRSpace, out: Float32Array) => boolean;
          fillJointRadii?: (spaces: Iterable<XRJointSpace>, out: Float32Array) => boolean;
        };
        if (f.fillPoses) {
          ok = f.fillPoses(cache.spaces, ref, cache.poses);
          f.fillJointRadii?.(cache.spaces, cache.radii);
        } else {
          ok = true;
          for (let i = 0; i < cache.spaces.length; i++) {
            const pose = frame.getJointPose?.(cache.spaces[i], ref);
            if (!pose) {
              ok = false;
              break;
            }
            cache.poses.set(pose.transform.matrix, i * 16);
            cache.radii[i] = pose.radius ?? cache.radii[i];
          }
        }
        if (!ok) continue;
        const hand = this.hands[handed];
        for (let i = 0; i < JOINT_COUNT; i++) {
          const o = i * 16;
          this.tmpV.set(cache.poses[o + 12], cache.poses[o + 13], cache.poses[o + 14]).applyMatrix4(pm);
          hand.joints[i].set(this.tmpV.x, this.tmpV.y, this.tmpV.z);
          const r = cache.radii[i];
          if (r > 0.001 && r < 0.05) hand.radii[i] = r;
        }
        hand.tracked = true;
        this.handSeenAt[handed] = nowMs;
        anyHand = true;
      } else if (source.gripSpace) {
        const pose = frame.getPose(source.gripSpace, ref);
        if (!pose) continue;
        this.tmpM.fromArray(pose.transform.matrix);
        this.tmpM2.multiplyMatrices(pm, this.tmpM);
        this.tmpM2.decompose(this.tmpV, this.tmpQ, this.tmpScale);
        const rod = this.rods[handed];
        rod.connected = true;
        rod.handedness = handed === 0 ? 'left' : 'right';
        rod.position.set(this.tmpV.x, this.tmpV.y, this.tmpV.z);
        rod.quaternion[0] = this.tmpQ.x;
        rod.quaternion[1] = this.tmpQ.y;
        rod.quaternion[2] = this.tmpQ.z;
        rod.quaternion[3] = this.tmpQ.w;
        rod.trigger = source.gamepad?.buttons[0]?.value ?? 0;
        anyController = true;
        const rp = frame.getPose(source.targetRaySpace, ref);
        if (rp) {
          this.tmpM.fromArray(rp.transform.matrix);
          this.tmpM2.multiplyMatrices(pm, this.tmpM);
          const ray = this.rays[handed];
          this.tmpV.setFromMatrixPosition(this.tmpM2);
          ray[0] = this.tmpV.x;
          ray[1] = this.tmpV.y;
          ray[2] = this.tmpV.z;
          this.tmpV.set(0, 0, -1).transformDirection(this.tmpM2);
          ray[3] = this.tmpV.x;
          ray[4] = this.tmpV.y;
          ray[5] = this.tmpV.z;
          this.rayValid[handed] = true;
        }
      }
    }
    this.holdLostHands(nowMs);
    if (this.hands[0].tracked || this.hands[1].tracked) anyHand = true;
    this.pruneJointCache(session);
    this.watchReferenceReset();
    this.inputMode = anyHand ? 'hands' : anyController ? 'controllers' : 'none';
    this.captureHitTest(frame, ref, pm);
    if (this.hands[0].tracked) this.tried.left = true;
    if (this.hands[1].tracked) this.tried.right = true;
    if (anyController) this.tried.controllers = true;
    this.capturePlanes(frame, ref, pm);
  }

  /** Gaze hit-test: a fallback way to find a wall when there is no room scan. */
  private captureHitTest(frame: XRFrame, ref: XRReferenceSpace, pm: Matrix4): void {
    if (!this.hitSource || (this.placementLockedAt >= 0 && !this.replacePending)) return;
    const results = frame.getHitTestResults(this.hitSource);
    if (!results.length) return;
    const pose = results[0].getPose(ref);
    if (!pose) return;
    this.tmpM.fromArray(pose.transform.matrix);
    this.tmpM2.multiplyMatrices(pm, this.tmpM);
    this.tmpV.setFromMatrixPosition(this.tmpM2);
    const point = new V3(this.tmpV.x, this.tmpV.y, this.tmpV.z);
    this.tmpV.set(0, 1, 0).transformDirection(this.tmpM2); // hit pose +Y = surface normal
    if (Math.abs(this.tmpV.y) > 0.35) return; // not a wall
    this.hitWall = { point, normal: new V3(this.tmpV.x, 0, this.tmpV.z), time: this.sessionTime };
  }

  /** A synthetic wall plane (3 m x 2.6 m) around the latest hit-test point. */
  private hitTestWall(): PlaneInfo | null {
    const h = this.hitWall;
    if (!h) return null;
    const n = h.normal;
    const l = Math.hypot(n.x, n.z) || 1;
    const tx = -n.z / l;
    const tz = n.x / l;
    const p = h.point;
    const pts = [
      new V3(p.x - tx * 1.5, Math.max(0, p.y - 1.3), p.z - tz * 1.5),
      new V3(p.x + tx * 1.5, Math.max(0, p.y - 1.3), p.z + tz * 1.5),
      new V3(p.x + tx * 1.5, p.y + 1.3, p.z + tz * 1.5),
      new V3(p.x - tx * 1.5, p.y + 1.3, p.z - tz * 1.5),
    ];
    return { id: 'hit-test', orientation: 'vertical', label: 'wall', points: pts, normal: new V3(n.x / l, 0, n.z / l) };
  }

  /**
   * Tracking-loss grace: a hand that drops out for a moment (fast motion,
   * fingers occluding each other) keeps its last pose for up to 200 ms, so its
   * shadow doesn't blink and the story doesn't see the hand leave.
   */
  private holdLostHands(nowMs: number): void {
    for (let h = 0; h < 2; h++) {
      const hand = this.hands[h];
      if (!hand.tracked && this.handSeenAt[h] > 0 && nowMs - this.handSeenAt[h] < 200) hand.tracked = true;
    }
  }

  /** Drops cached joint spaces of input sources that have gone away. */
  private pruneJointCache(session: XRSession): void {
    if (this.jointCache.size <= 2) return;
    const live = session.inputSources;
    for (const src of [...this.jointCache.keys()]) {
      let found = false;
      for (const s of live) if (s === src) found = true;
      if (!found) this.jointCache.delete(src);
    }
  }

  private jointsFor(source: XRInputSource): JointCache {
    let c = this.jointCache.get(source);
    if (!c) {
      const spaces = Array.from(source.hand!.values());
      c = { spaces, poses: new Float32Array(spaces.length * 16), radii: new Float32Array(spaces.length) };
      this.jointCache.set(source, c);
    }
    return c;
  }

  private capturePlanes(frame: XRFrame, ref: XRReferenceSpace, pm: Matrix4): void {
    // Planes only matter until the stage is locked (or a re-place is asked for).
    if (this.placementLockedAt >= 0 && !this.replacePending) return;
    const detected = (frame as XRFrame & { detectedPlanes?: Set<XRPlane> }).detectedPlanes;
    if (!detected) return;
    this.planes.length = 0;
    detected.forEach((plane) => {
      const pose = frame.getPose(plane.planeSpace, ref);
      if (!pose) return;
      this.tmpM.fromArray(pose.transform.matrix);
      this.tmpM2.multiplyMatrices(pm, this.tmpM);
      const points: V3[] = [];
      for (const p of plane.polygon) {
        this.tmpV.set(p.x, p.y, p.z).applyMatrix4(this.tmpM2);
        points.push(new V3(this.tmpV.x, this.tmpV.y, this.tmpV.z));
      }
      this.tmpV.set(0, 1, 0).transformDirection(this.tmpM2);
      const label = (plane as XRPlane & { semanticLabel?: string }).semanticLabel ?? '';
      this.planes.push({
        id: String(this.planes.length) + ':' + label,
        orientation: plane.orientation === 'horizontal' ? 'horizontal' : plane.orientation === 'vertical' ? 'vertical' : 'unknown',
        label,
        points,
        normal: new V3(this.tmpV.x, this.tmpV.y, this.tmpV.z),
      });
    });
    this.session.planesSeen = Math.max(this.session.planesSeen, this.planes.length);
    const meshes = (frame as XRFrame & { detectedMeshes?: Set<XRMesh> }).detectedMeshes;
    if (!meshes) return;
    this.obstacles.length = 0;
    meshes.forEach((mesh) => {
      const label = (mesh as XRMesh & { semanticLabel?: string }).semanticLabel ?? '';
      if (/global/i.test(label)) return; // the whole-room mesh is not furniture
      const verts = mesh.vertices;
      if (!verts || verts.length < 9 || verts.length > 3 * 4096) return;
      const pose = frame.getPose(mesh.meshSpace, ref);
      if (!pose) return;
      this.tmpM.fromArray(pose.transform.matrix);
      this.tmpM2.multiplyMatrices(pm, this.tmpM);
      const min = new V3(Infinity, Infinity, Infinity);
      const max = new V3(-Infinity, -Infinity, -Infinity);
      for (let i = 0; i < verts.length; i += 3) {
        this.tmpV.set(verts[i], verts[i + 1], verts[i + 2]).applyMatrix4(this.tmpM2);
        min.set(Math.min(min.x, this.tmpV.x), Math.min(min.y, this.tmpV.y), Math.min(min.z, this.tmpV.z));
        max.set(Math.max(max.x, this.tmpV.x), Math.max(max.y, this.tmpV.y), Math.max(max.z, this.tmpV.z));
      }
      this.obstacles.push({ label, min, max });
    });
    this.session.meshesSeen = Math.max(this.session.meshesSeen, this.obstacles.length);
  }

  // -------------------------------------------------------------- placement
  /** Places stage + lantern from the current head pose and planes. */
  place(keepStory = false): void {
    const opts = { ...DEFAULT_PLACEMENT, sizeScale: this.settings.stageScale };
    if (this.session.mode === 'vr') {
      // Virtual theatre: no real room, the scroll is the stage.
      this.placement = chooseStage([], this.head, this.headForward, opts);
      this.placement.reason = 'virtual-theatre';
    } else {
      const planes = this.planes.length > 0 ? this.planes : [];
      const hitWall = this.planes.length === 0 ? this.hitTestWall() : null;
      this.placement = chooseStage(hitWall ? [hitWall] : planes, this.head, this.headForward, opts, this.obstacles);
      if (hitWall && this.placement.kind === 'wall') this.placement.reason = 'hit-test';
    }
    this.lanternPlacement = chooseLantern(this.planes, this.head, this.headForward, this.settings.dominant);
    if (this.session.mode === 'vr') {
      // In the virtual theatre the lantern stands on a little table.
      const lp = this.lanternPlacement.position;
      lp.y = this.head.y - 0.5;
      this.lanternPlacement.onSurface = true;
      this.theatre.placeTable(lp.x + this.headForward.x * 0.08, lp.y, lp.z + this.headForward.z * 0.08, Math.atan2(this.headForward.x, this.headForward.z));
    }
    const fr = this.placement.frame;
    computeFocalLight(fr, this.head, this.focal);
    this.calibrateNominal();
    this.composite.place(fr, this.placement.kind === 'scroll');
    this.dim.setStage(fr);
    this.stage.setLayout(fr.aspect, QUALITY_LEVELS[this.quality.level].stageResolution);
    const lp = this.lanternPlacement.position;
    this.lantern.place(lp.x, lp.y, lp.z, this.lanternPlacement.onSurface);
    this.audio.stagePos.x = fr.origin.x;
    this.audio.stagePos.y = fr.origin.y;
    this.audio.stagePos.z = fr.origin.z;
    Object.assign(this.audio.stageRight, fr.right);
    Object.assign(this.audio.stageUp, fr.up);
    this.audio.stageHeight = fr.height;
    this.lantern.flamePosition(this.audio.lanternPos);
    void keepStory;
  }

  private calibrateNominal(): void {
    if (!this.placement) return;
    const fr = this.placement.frame;
    const wrist = nominalHandPoint(fr, this.head, new V3());
    wrist.y -= 0.05;
    const knuckle = new V3(wrist.x, wrist.y + 0.09, wrist.z);
    const a = createProjected();
    const b = createProjected();
    projectToStage(wrist, this.focal, fr, a);
    projectToStage(knuckle, this.focal, fr, b);
    if (a.valid && b.valid) {
      this.model.nominalPalmShadow = Math.hypot(b.s - a.s, b.t - a.t);
      this.model.nominalMagnification = (a.magnification + b.magnification) / 2;
    }
    // (penumbra flame radius lives in shadow-model: FLAME_RADIUS)
  }

  // ------------------------------------------------------------------- step
  step(dt: number, time: number): void {
    const t0 = performance.now();
    if (this.lastFrameAt > 0) this.frameStats.push(t0 - this.lastFrameAt);
    const frameMs = this.lastFrameAt > 0 ? t0 - this.lastFrameAt : 0;
    this.lastFrameAt = t0;
    if (this.phase === 'landing' || this.phase === 'paused') return;
    this.sessionTime += dt;

    if (this.phase === 'placing') {
      this.placingTime += dt;
      // Wait briefly for room planes (Space Setup) to arrive; never block.
      if (this.planes.length > 0 || this.placingTime > 1.2) {
        this.place();
        this.phase = 'show';
        this.setShowVisible(true);
        this.audio.lanternPos.y = this.lantern.group.position.y;
      } else {
        return;
      }
    }
    // Late planes (or a hit-test wall): upgrade a scroll to a wall while the
    // lights are still dimming.
    if (
      this.placementLockedAt < 0 &&
      this.placement?.kind === 'scroll' &&
      this.placement.reason === 'no-planes' &&
      (this.planes.length > 0 || this.hitWall)
    ) {
      this.place();
    }
    if (this.placementLockedAt < 0 && this.story.scene === 'intro' && this.story.beat !== 'dim') {
      this.placementLockedAt = this.sessionTime;
    }

    if (this.replacePending && this.readyToReplace(dt)) {
      this.replacePending = false;
      this.place();
    }
    this.lastForward.copy(this.headForward);
    const fr = this.placement!.frame;
    const needPose = this.story.scene === 'intro' || this.story.scene === 'menu';
    this.model.head.copy(this.head);
    // viewer right = forward x up (horizontal)
    this.model.right.set(-this.headForward.z, 0, this.headForward.x);
    // the flame sways a few millimetres: so do the shadows
    const fl = this.settings.reduceMotion ? 0 : this.lantern.flicker * this.story.view.flame;
    this.flameLight.set(this.focal.x + fl * 0.0035, this.focal.y + Math.abs(fl) * 0.0025, this.focal.z);
    this.model.build(this.hands, this.rods, this.flameLight, fr, dt, needPose);
    this.updateMenu(dt, time);
    if (!this.menu.open && !this.freezeStory) this.story.update(dt, this.model);
    else this.story.events.length = 0;
    const view = this.story.view;
    const reduce = this.settings.reduceMotion;

    // Quality adaptation: missed vsyncs against the session's real refresh rate.
    const rate = (this.world.session as (XRSession & { frameRate?: number }) | undefined)?.frameRate;
    this.quality.periodMs = rate && rate > 0 ? 1000 / rate : 0;
    if (frameMs > 0 && this.quality.update(frameMs, dt)) {
      const q = this.quality.current;
      this.stage.setLayout(fr.aspect, q.stageResolution);
      try {
        this.world.renderer.xr.setFoveation(q.foveation);
      } catch {
        /* ignore */
      }
      console.info('[lanternlight] quality ->', q.level, this.quality.changes.at(-1));
    }

    // Offscreen shadow stage.
    this.stage.update(this.model, view, time, reduce, this.lantern.flicker * view.flame);
    this.stage.render(this.world.renderer);

    // Composite + room + lantern.
    this.lantern.update(time, view.flame, reduce);
    this.lantern.flamePosition(this.flameW);
    this.standIns.update(this.emulated || this.session.mode === 'vr', this.hands, this.flameW, view.flame);
    for (let i = 0; i < 2; i++) {
      const vis = this.rods[i].connected;
      this.puppets[i].group.visible = vis;
      if (vis) this.puppets[i].update(this.rods[i].trigger);
    }
    const u = this.composite.material.uniforms;
    u.uLight.value = view.light;
    u.uWarmth.value = view.warmth;
    u.uFlicker.value = this.lantern.flicker * view.flame;
    u.uFade.value = view.fade;
    u.uContrast.value = this.settings.highContrast ? 1 : 0;
    u.uDetail.value = this.quality.current.shaderDetail && !this.settings.highContrast ? 1 : 0;
    u.uTime.value = time;
    u.uUnroll.value = Math.min(1, view.light * 1.4 + view.dim * 0.3);
    const du = this.dim.material.uniforms;
    du.uDim.value = this.session.mode === 'vr' ? 0 : this.settings.dimLevel * view.dim;
    du.uPool.value = view.light;
    this.lantern.flamePosition(du.uLantern.value as Vector3);
    du.uLanternGlow.value = view.flame;
    this.dim.mesh.position.set(this.head.x, this.head.y, this.head.z);

    this.textDt = dt;
    this.updateText(view.caption);
    this.updateHud(dt);

    // Audio.
    this.audio.updateListener(this.head, this.headForward, this.headUp);
    const sc = this.story.scene;
    const music = sc === 'menu' || sc === 'bridge' || sc === 'finale' ? 1 : sc === 'croc' ? 0.7 : sc === 'wolf' ? 0.35 : view.light > 0.5 ? 0.5 : 0;
    this.audio.tick(dt, view.flame, music * (1 - view.fade));
    for (const e of this.story.events) this.audio.play(e.type, e.s, e.t, e.value);

    this.saveTimer += dt;
    if (this.saveTimer > 5) {
      this.saveTimer = 0;
      saveProgress(this.story.progress, this.store);
    }
    this.cpuStats.push(performance.now() - t0);
  }

  private textDt = 1 / 72;

  private updateText(caption: string): void {
    const fr = this.placement!.frame;
    const view = this.story.view;
    const want = this.settings.captions ? caption : '';
    // cross-fade: fade the old caption out (0.18 s), switch, fade the new one in (0.35 s)
    const dt = this.textDt;
    if (want !== this.capShown) {
      this.capAlpha = Math.max(0, this.capAlpha - dt / 0.18);
      if (this.capAlpha <= 0 || this.capShown === '') {
        this.capShown = want;
        this.caption.set(want);
      }
    } else if (want) {
      this.capAlpha = Math.min(1, this.capAlpha + dt / 0.35);
    }
    if (this.capShown) {
      const p = this.tmpV3;
      stageToWorld(fr, 0, -0.5 - STAGE_PAD * 0.5, p);
      this.caption.mesh.position.set(p.x + fr.normal.x * 0.01, p.y + fr.normal.y * 0.01, p.z + fr.normal.z * 0.01);
      this.caption.mesh.quaternion.copy(this.composite.mesh.quaternion);
      const s = fr.height * 0.088;
      this.caption.mesh.scale.set(s * (2400 / 200), s, 1);
      const a = this.capAlpha;
      this.caption.setOpacity(a * a * (3 - 2 * a) * (1 - view.fade));
    } else this.caption.setOpacity(0);
    for (let i = 0; i < this.iconLabels.length; i++) {
      const icon = view.icons[i];
      const label = this.iconLabels[i];
      // wordless by default: a tale's name appears only while you choose it
      const show = view.scene === 'menu' && icon.visible > 0.05 && icon.fill > 0.02;
      label.set(show ? icon.label : '');
      if (!show) continue;
      const p = this.tmpV3;
      stageToWorld(fr, icon.s, icon.t - icon.r - 0.075, p);
      label.mesh.position.set(p.x + fr.normal.x * 0.01, p.y + fr.normal.y * 0.01, p.z + fr.normal.z * 0.01);
      label.mesh.quaternion.copy(this.composite.mesh.quaternion);
      const s = fr.height * 0.085;
      label.mesh.scale.set(s * (1600 / 200), s, 1);
      const f = Math.min(1, icon.fill * 4);
      label.setOpacity(f * f * (3 - 2 * f) * icon.visible * (1 - view.fade));
    }
  }

  // ------------------------------------------------------------ lantern menu
  private readonly flame = new V3();
  private readonly btnPos = new Vector3();

  private updateMenu(dt: number, time: number): void {
    const flame = this.flame;
    this.lantern.flamePosition(flame);
    this.menuCooldown = Math.max(0, this.menuCooldown - dt);
    // Fingertip taps on the lantern: a deliberate, slow touch held ~0.35 s,
    // so a hand passing by while performing never opens the menu.
    let near = false;
    for (let hi = 0; hi < 2; hi++) {
      const h = this.hands[hi];
      if (!h.tracked) continue;
      const tip = h.joints[J.indexTip];
      const last = this.lastTip[hi];
      const speed = dt > 0 ? Math.hypot(tip.x - last.x, tip.y - last.y, tip.z - last.z) / dt : 0;
      last.copy(tip);
      const d = Math.hypot(tip.x - flame.x, tip.y - flame.y, tip.z - flame.z);
      if (d < 0.075 && speed < 0.45 && !this.story.sizeBeat) near = true;
    }
    if (!near) {
      this.tapArmed = true;
      this.tapTime = 0;
    } else if (this.tapArmed) {
      this.tapTime += dt;
      if (this.tapTime > 0.35 && this.menuCooldown <= 0) {
        this.tapArmed = false;
        this.toggleMenu();
      }
    }
    // Controller: point at the lantern (or a button) and pull the trigger.
    for (let i = 0; i < 2; i++) {
      const rod = this.rods[i];
      const trig = rod.connected ? rod.trigger : 0;
      const edge = trig > 0.7 && this.prevTrigger[i] <= 0.7;
      this.prevTrigger[i] = trig;
      if (!edge || !this.rayValid[i]) continue;
      const r = this.rays[i];
      if (this.menu.open) {
        const hit = this.rayButton(r);
        if (hit >= 0) this.press(hit);
      } else if (this.raySphere(r, flame.x, flame.y, flame.z, 0.12) && this.menuCooldown <= 0) {
        this.toggleMenu();
      }
    }
    // Menu animation & placement: above the lantern, facing the viewer.
    const m = this.menu;
    m.t = Math.min(1, Math.max(0, m.t + (m.open ? dt : -dt) * 4));
    m.group.position.set(this.lantern.group.position.x, this.lantern.group.position.y, this.lantern.group.position.z);
    m.group.rotation.set(0, Math.atan2(this.head.x - m.group.position.x, this.head.z - m.group.position.z), 0);
    m.buttons[2].setState(Math.round(this.settings.dimLevel * 100) + '%');
    m.buttons[3].setState(this.settings.gentle ? 'on' : 'off');
    m.buttons[5].setState('');
    m.layout(time, this.settings.reduceMotion);
    if (!m.open || m.t < 0.8) {
      this.menuIdle = 0;
      return;
    }
    // An idle menu (e.g. opened by accident) quietly resumes the show.
    this.menuIdle += dt;
    if (this.menuIdle > 12) {
      this.toggleMenu(false);
      return;
    }
    // Fingertip pokes.
    for (let b = 0; b < m.buttons.length; b++) {
      const btn = m.buttons[b];
      btn.mesh.getWorldPosition(this.btnPos);
      let touching = false;
      for (const h of this.hands) {
        if (!h.tracked) continue;
        const tip = h.joints[J.indexTip];
        const d = Math.hypot(tip.x - this.btnPos.x, tip.y - this.btnPos.y, tip.z - this.btnPos.z);
        if (d < 0.038) touching = true;
      }
      btn.hover += ((touching ? 1 : 0) - btn.hover) * 0.3;
      if (touching) this.menuIdle = 0;
      if (touching && this.buttonArmed[b]) {
        this.buttonArmed[b] = false;
        this.press(b);
      } else if (!touching) {
        this.buttonArmed[b] = true;
      }
    }
  }

  private raySphere(r: Float32Array, cx: number, cy: number, cz: number, rad: number): boolean {
    const ox = cx - r[0];
    const oy = cy - r[1];
    const oz = cz - r[2];
    const t = ox * r[3] + oy * r[4] + oz * r[5];
    if (t < 0) return false;
    const px = r[0] + r[3] * t - cx;
    const py = r[1] + r[4] * t - cy;
    const pz = r[2] + r[5] * t - cz;
    return px * px + py * py + pz * pz <= rad * rad;
  }

  private rayButton(r: Float32Array): number {
    let best = -1;
    let bestT = Infinity;
    for (let b = 0; b < this.menu.buttons.length; b++) {
      this.menu.buttons[b].mesh.getWorldPosition(this.btnPos);
      const ox = this.btnPos.x - r[0];
      const oy = this.btnPos.y - r[1];
      const oz = this.btnPos.z - r[2];
      const t = ox * r[3] + oy * r[4] + oz * r[5];
      if (t < 0 || t > bestT) continue;
      if (this.raySphere(r, this.btnPos.x, this.btnPos.y, this.btnPos.z, 0.04)) {
        best = b;
        bestT = t;
      }
    }
    return best;
  }

  toggleMenu(open = !this.menu.open): void {
    this.menu.open = open;
    if (open) this.tried.menu = true;
    this.menuCooldown = 0.6;
    // A finger already resting on a button must lift before it can press.
    for (let i = 0; i < this.buttonArmed.length; i++) this.buttonArmed[i] = false;
    this.audio.play(open ? 'select' : 'whoosh', 0, -0.5);
  }

  press(index: number): void {
    const btn = this.menu.buttons[index];
    btn.pressT = 1;
    const action = btn.def.id;
    this.menuLog.push(action);
    this.audio.play('iconTick', 0, -0.5, 0.75);
    switch (action) {
      case 'continue':
        this.toggleMenu(false);
        break;
      case 'tales':
        this.story.enter('menu');
        this.toggleMenu(false);
        break;
      case 'light': {
        const steps = [0.4, 0.75, 0.9];
        const i = steps.findIndex((v) => v > this.settings.dimLevel + 0.01);
        this.updateSettings({ dimLevel: i < 0 ? steps[0] : steps[i] });
        break;
      }
      case 'gentle':
        this.updateSettings({ gentle: !this.settings.gentle });
        break;
      case 'hud':
        this.hud.enabled = !this.hud.enabled;
        break;
      case 'move':
        this.tried.moved = true;
        this.requestReplace();
        this.toggleMenu(false);
        break;
      case 'leave':
        this.toggleMenu(false);
        this.world.exitXR();
        break;
    }
  }

  // -------------------------------------------------------------- tester HUD
  private updateHud(dt: number): void {
    const lp = this.lantern.group.position;
    const side = this.settings.dominant === 'right' ? -1 : 1;
    const rx = -this.headForward.z;
    const rz = this.headForward.x;
    const rl = Math.hypot(rx, rz) || 1;
    this.hud.mesh.position.set(lp.x + (rx / rl) * 0.17 * side, lp.y + 0.16, lp.z + (rz / rl) * 0.17 * side);
    this.hud.mesh.rotation.set(-0.35, Math.atan2(this.head.x - this.hud.mesh.position.x, this.head.z - this.hud.mesh.position.z), 0, 'YXZ');
    this.hud.update(dt, () => this.hudData());
  }

  private hudData(): HudData {
    const f = this.frameStats.summary();
    const st = this.story.stats;
    const pr = this.story.progress;
    return {
      build: BUILD,
      fps: f.p50 > 0 ? 1000 / f.p50 : 0,
      p50: f.p50,
      p90: f.p90,
      cpu: this.cpuStats.summary().p50,
      quality: this.quality.level,
      stage: this.placement ? `${this.placement.kind} (${this.placement.reason}) ${this.placement.distance.toFixed(2)} m` : '-',
      input: this.inputMode,
      device: `${this.device} · ${this.session.mode.toUpperCase()}`,
      caps: [
        this.session.features.includes('hand-tracking') ? 'hands' : 'no-hands',
        `planes ${this.session.planesSeen}`,
        `meshes ${this.session.meshesSeen}`,
        this.session.hitTest ? 'hit-test' : 'no-hit-test',
      ].join(' · '),
      checklist: [
        { label: 'Make the rabbit', done: st.rabbitBirths > 0 },
        { label: 'Feed the crocodile', done: pr.completed.croc },
        { label: "Rabbit's bridge", done: pr.completed.bridge },
        { label: 'Scare the Moon Wolf', done: pr.completed.wolf },
        { label: 'Use both hands', done: this.tried.left && this.tried.right },
        { label: 'Try controllers', done: this.tried.controllers },
        { label: 'Lantern menu + Stage here', done: this.tried.menu && this.tried.moved },
      ],
    };
  }

  /**
   * Re-place the stage and lantern where the viewer is looking - once the
   * menu has closed and the head has been steady for a moment (so the stage
   * doesn't land where the menu was).
   */
  requestReplace(): void {
    this.replacePending = true;
    this.replaceSteady = 0;
    this.replaceWait = 0;
  }

  /** True when the head has been steady (< 12 deg/s) for 0.7 s, or after 6 s. */
  private readyToReplace(dt: number): boolean {
    if (this.menu.open) return false;
    this.replaceWait += dt;
    const f = this.headForward;
    const l = this.lastForward;
    const dotp = Math.min(1, Math.max(-1, f.x * l.x + f.y * l.y + f.z * l.z));
    const degPerS = dt > 0 ? (Math.acos(dotp) * 180) / Math.PI / dt : 0;
    if (degPerS < 12) this.replaceSteady += dt;
    else this.replaceSteady = 0;
    return (this.replaceWait > 0.8 && this.replaceSteady > 0.7) || this.replaceWait > 6;
  }

  /** Quest recenter / reference-space reset: the stage would float, so re-place it (review M6). */
  private watchReferenceReset(): void {
    const ref = this.world.xrReferenceSpace as XRReferenceSpace | undefined;
    if (!ref || ref === this.listenedRef) return;
    this.listenedRef = ref;
    ref.addEventListener('reset', () => {
      this.tried.recentered = true;
      this.requestReplace();
    });
  }

  /** Test/demo hook: jump to a scene. */
  goto(scene: SceneId): void {
    this.story.enter(scene);
  }

  /** JSON-safe snapshot for tests and the perf log. */
  snapshot(): Record<string, unknown> {
    const p = this.placement;
    const r = this.world.renderer.info;
    return {
      phase: this.phase,
      inputMode: this.inputMode,
      emulated: this.emulated,
      scene: this.story.scene,
      beat: this.story.beat,
      stage: p
        ? {
            kind: p.kind,
            reason: p.reason,
            distance: +p.distance.toFixed(3),
            height: +p.frame.height.toFixed(3),
            aspect: +p.frame.aspect.toFixed(3),
            origin: [p.frame.origin.x, p.frame.origin.y, p.frame.origin.z].map((v) => +v.toFixed(3)),
            normal: [p.frame.normal.x, p.frame.normal.y, p.frame.normal.z].map((v) => +v.toFixed(3)),
          }
        : null,
      lantern: this.lanternPlacement
        ? { onSurface: this.lanternPlacement.onSurface, position: [this.lanternPlacement.position.x, this.lanternPlacement.position.y, this.lanternPlacement.position.z].map((v) => +v.toFixed(3)) }
        : null,
      planes: this.planes.length,
      obstacles: this.obstacles.map((o) => o.label),
      planeLabels: this.planes.map((pl) => pl.label + '/' + pl.orientation),
      actors: this.model.actors.map((a) => ({
        kind: a.kind,
        hand: a.handedness,
        present: a.present,
        pose: a.pose,
        aperture: +a.aperture.toFixed(3),
        mouthOpen: a.mouth.open,
        size: +a.sizeRatio.toFixed(3),
        centroid: [+a.centroidS.toFixed(3), +a.centroidT.toFixed(3)],
        box: [a.minS, a.maxS, a.minT, a.maxT].map((v) => +v.toFixed(3)),
        handBox: [a.handMinS, a.handMaxS, a.handMinT, a.handMaxT].map((v) => +v.toFixed(3)),
        tip: [+a.tipS.toFixed(3), +a.tipT.toFixed(3)],
        mouth: [+a.mouthS.toFixed(3), +a.mouthT.toFixed(3)],
        ext: Object.fromEntries(Object.entries(a.features.extension).map(([k, v]) => [k, +v.toFixed(2)])),
      })),
      capsules: this.model.capsuleCount,
      rabbit: { x: +this.story.rabbit.x.toFixed(3), y: +this.story.rabbit.y.toFixed(3), state: this.story.rabbit.state },
      stats: { ...this.story.stats },
      progress: JSON.parse(JSON.stringify(this.story.progress)),
      view: {
        light: +this.story.view.light.toFixed(2),
        dim: +this.story.view.dim.toFixed(2),
        ghost: +this.story.view.ghost.visible.toFixed(2),
        caption: this.story.view.caption,
        icons: this.story.view.icons.map((i) => ({ id: i.id, fill: +i.fill.toFixed(2), s: i.s, t: i.t })),
        fireflies: this.story.view.fireflies.filter((f) => f.alive).map((f) => [+f.x.toFixed(3), +f.y.toFixed(3)]),
        wolfState: this.story.wolf.state,
        wolfX: +this.story.wolf.x.toFixed(3),
        courage: +this.story.view.courage.toFixed(2),
      },
      perf: {
        frame: this.frameStats.summary(),
        cpu: this.cpuStats.summary(),
        quality: this.quality.level,
        qualityChanges: this.quality.changes,
        drawCalls: r.render.calls,
        triangles: r.render.triangles,
        stagePassCalls: this.stage.lastCalls,
        stagePassTriangles: this.stage.lastTriangles,
        stageTarget: [this.stage.target.width, this.stage.target.height],
        textures: r.memory.textures,
        geometries: r.memory.geometries,
      },
      audio: { state: this.audio.ctx?.state ?? 'none', played: this.audio.played },
      build: BUILD,
      device: this.device,
      session: { ...this.session },
      tester: this.tester,
      hud: this.hud.enabled,
      menu: { open: this.menu.open, t: +this.menu.t.toFixed(2), log: [...this.menuLog], dim: this.settings.dimLevel, gentle: this.settings.gentle },
    };
  }
}
