/**
 * Procedural sound for Lanternlight - no audio files at all.
 *
 *  - Lantern: a soft crackle bed positioned at the lantern.
 *  - Music box: an original pentatonic lullaby, plucked with a kalimba-like
 *    voice (sine + inharmonic partials), slow and sparse.
 *  - Foley: hops, splashes, chomps, chimes, all synthesised.
 * Everything is spatialised (HRTF panners) at the stage or lantern.
 */
import type { SoundEvent } from '../core/story.js';

type Vec = { x: number; y: number; z: number };

// D major pentatonic, two octaves (Hz)
const SCALE = [293.66, 329.63, 369.99, 440.0, 493.88, 587.33, 659.25, 739.99, 880.0, 987.77];
// An original 16-step lullaby (scale indices, -1 = rest)
const LULLABY = [4, -1, 3, 5, 2, -1, 3, -1, 4, 6, 5, -1, 3, 2, 0, -1, 2, -1, 3, 4, 5, -1, 7, 6, 4, -1, 3, 2, 3, -1, -1, -1];

export class AudioEngine {
  ctx: BaseAudioContext | null = null;
  /**
   * Offline mode (the soundtrack of a frame-stepped capture): sounds are
   * scheduled at `clock` seconds instead of the context's current time, and
   * the context does not need to be running.
   */
  offline = false;
  clock = 0;
  private master!: GainNode;
  private limiter!: DynamicsCompressorNode;
  private humGain!: GainNode;
  /** Per-tale ambience: 'croc' (water, reeds), 'bridge' (wind), 'wolf' (crickets, wind). */
  ambience: string = '';
  private waterGain!: GainNode;
  private reedGain!: GainNode;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private bedClock = 0;
  private plipTimer = 0;
  private cricketTimer = 0;
  private reverb!: ConvolverNode;
  private reverbSend!: GainNode;
  private musicGain!: GainNode;
  private crackleGain!: GainNode;
  private lanternPanner!: PannerNode;
  private noiseBuffer!: AudioBuffer;
  private nextNote = 0;
  private step = 0;
  private crackleTimer = 0;
  volume = 0.8;
  musicOn = false;
  readonly stagePos: Vec = { x: 0, y: 1.2, z: -2 };
  readonly stageRight: Vec = { x: 1, y: 0, z: 0 };
  readonly stageUp: Vec = { x: 0, y: 1, z: 0 };
  stageHeight = 1;
  readonly lanternPos: Vec = { x: 0, y: 0.8, z: -0.3 };
  /** Count of sounds played (diagnostics/tests). */
  played = 0;

  private now(): number {
    return this.offline ? this.clock : this.ctx!.currentTime;
  }

  private live(): boolean {
    const ctx = this.ctx;
    return !!ctx && (this.offline || ctx.state === 'running');
  }

  /** Must be called from a user gesture (entering XR counts). */
  start(): void {
    if (this.ctx) {
      if (!this.offline) void (this.ctx as AudioContext).resume();
      return;
    }
    const AC = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
    if (!AC) return;
    this.build(new AC());
  }

  /** Builds the same graph on an OfflineAudioContext (capture soundtrack). */
  startOffline(ctx: OfflineAudioContext): void {
    this.offline = true;
    this.clock = 0;
    this.build(ctx);
  }

  private build(ctx: BaseAudioContext): void {
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    // a gentle limiter so chimes and the scare never clip
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -10;
    this.limiter.knee.value = 8;
    this.limiter.ratio.value = 6;
    this.limiter.attack.value = 0.004;
    this.limiter.release.value = 0.25;
    // the whole mix is high-passed at 60 Hz: no rumble under the show
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 60;
    hp.Q.value = 0.7;
    this.master.connect(hp);
    hp.connect(this.limiter);
    this.limiter.connect(ctx.destination);
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(1.8, 2.6);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.35;
    this.reverbSend.connect(this.reverb);
    this.reverb.connect(this.master);
    this.noiseBuffer = this.makeNoise(2);
    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = 0;
    this.musicGain.connect(this.master);
    this.musicGain.connect(this.reverbSend);
    this.crackleGain = ctx.createGain();
    this.crackleGain.gain.value = 0;
    this.lanternPanner = this.makePanner();
    this.crackleGain.connect(this.lanternPanner);
    this.lanternPanner.connect(this.master);
    // the lantern's warm hum: two soft sines, slowly beating, under the crackle
    this.humGain = ctx.createGain();
    this.humGain.gain.value = 0;
    this.humGain.connect(this.lanternPanner);
    for (const [f, a] of [
      [98, 1],
      [147.3, 0.45],
      [196.6, 0.18],
    ]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = a;
      o.connect(g).connect(this.humGain);
      o.start();
    }
    this.nextNote = this.now() + 0.5;
    this.buildAmbience(ctx);
  }

  /** Looping noise beds for each tale's ambience (levels follow `ambience`). */
  private buildAmbience(ctx: BaseAudioContext): void {
    const loop = (): AudioBufferSourceNode => {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      src.loop = true;
      src.start();
      return src;
    };
    // the river: low, soft and moving
    this.waterGain = ctx.createGain();
    this.waterGain.gain.value = 0;
    const wlp = ctx.createBiquadFilter();
    wlp.type = 'lowpass';
    wlp.frequency.value = 520;
    const wbp = ctx.createBiquadFilter();
    wbp.type = 'highpass';
    wbp.frequency.value = 140;
    loop().connect(wlp).connect(wbp).connect(this.waterGain).connect(this.master);
    // reeds: a dry, high whisper
    this.reedGain = ctx.createGain();
    this.reedGain.gain.value = 0;
    const rhp = ctx.createBiquadFilter();
    rhp.type = 'bandpass';
    rhp.frequency.value = 5200;
    rhp.Q.value = 0.8;
    loop().connect(rhp).connect(this.reedGain).connect(this.master);
    // wind: a slowly swelling band of noise
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 650;
    this.windFilter.Q.value = 0.9;
    loop().connect(this.windFilter).connect(this.windGain).connect(this.master);
  }

  /** Per-frame ambience: bed levels, river plips, crickets (all scheduled at now()). */
  private tickAmbience(dt: number): void {
    const now = this.now();
    const amb = this.ambience;
    this.bedClock += dt;
    const swell = 0.75 + 0.25 * Math.sin(this.bedClock * 0.35) * Math.sin(this.bedClock * 0.13 + 1);
    this.waterGain.gain.setTargetAtTime(amb === 'croc' ? 0.028 * swell : amb === 'bridge' ? 0.016 * swell : 0, now, 0.8);
    this.reedGain.gain.setTargetAtTime(amb === 'croc' ? 0.005 * swell : 0, now, 0.8);
    this.windGain.gain.setTargetAtTime(amb === 'bridge' ? 0.06 * swell : amb === 'wolf' ? 0.03 * swell : 0, now, 1.0);
    this.windFilter.frequency.setTargetAtTime(520 + 260 * Math.sin(this.bedClock * 0.21), now, 0.5);
    // the river: little plips and drips
    if (amb === 'croc') {
      this.plipTimer -= dt;
      if (this.plipTimer <= 0) {
        this.plipTimer = 0.35 + Math.random() * 1.1;
        const f = 650 + Math.random() * 700;
        this.tone(this.master, f, now, 0.07, 0.022, 'sine', f * 0.55);
      }
    }
    // crickets, high above everything (4-5 kHz chirps in threes)
    if (amb === 'wolf') {
      this.cricketTimer -= dt;
      if (this.cricketTimer <= 0) {
        this.cricketTimer = 0.45 + Math.random() * 0.6;
        const f = 4300 + Math.random() * 600;
        for (let i = 0; i < 3; i++) this.tone(this.master, f, now + i * 0.045, 0.028, 0.016, 'sine');
      }
    }
  }

  /** Static listener pose (the capture's seated camera). */
  setListener(pos: Vec, forward: Vec, up: Vec): void {
    this.updateListener(pos, forward, up);
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.ctx) this.master.gain.setTargetAtTime(v, this.now(), 0.1);
  }

  suspend(): void {
    if (!this.offline) void (this.ctx as AudioContext | null)?.suspend();
  }

  resume(): void {
    if (!this.offline) void (this.ctx as AudioContext | null)?.resume();
  }

  private makeNoise(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const d = buf.getChannelData(0);
    let seed = 12345;
    for (let i = 0; i < d.length; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      d[i] = (seed / 4294967296) * 2 - 1;
    }
    return buf;
  }

  private makeImpulse(seconds: number, decay: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let seed = 777 + c * 31;
      for (let i = 0; i < len; i++) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        d[i] = ((seed / 4294967296) * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  private makePanner(): PannerNode {
    const p = this.ctx!.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = 0.6;
    p.rolloffFactor = 0.6;
    return p;
  }

  /** Stage (s,t) -> world position for spatial sounds. */
  private stageWorld(s: number, t: number): Vec {
    const h = this.stageHeight;
    return {
      x: this.stagePos.x + this.stageRight.x * s * h + this.stageUp.x * t * h,
      y: this.stagePos.y + this.stageRight.y * s * h + this.stageUp.y * t * h,
      z: this.stagePos.z + this.stageRight.z * s * h + this.stageUp.z * t * h,
    };
  }

  private pannerAt(pos: Vec): PannerNode {
    const p = this.makePanner();
    p.positionX.value = pos.x;
    p.positionY.value = pos.y;
    p.positionZ.value = pos.z;
    p.connect(this.master);
    return p;
  }

  updateListener(pos: Vec, forward: Vec, up: Vec): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const l = ctx.listener;
    if (l.positionX) {
      l.positionX.value = pos.x;
      l.positionY.value = pos.y;
      l.positionZ.value = pos.z;
      l.forwardX.value = forward.x;
      l.forwardY.value = forward.y;
      l.forwardZ.value = forward.z;
      l.upX.value = up.x;
      l.upY.value = up.y;
      l.upZ.value = up.z;
    }
    this.lanternPanner.positionX.value = this.lanternPos.x;
    this.lanternPanner.positionY.value = this.lanternPos.y;
    this.lanternPanner.positionZ.value = this.lanternPos.z;
  }

  /** Per-frame: schedules music and crackle. */
  tick(dt: number, flame: number, musicLevel: number): void {
    if (!this.live()) return;
    const ctx = { currentTime: this.now() };
    this.crackleGain.gain.setTargetAtTime(flame * 0.5, ctx.currentTime, 0.3);
    // (the hum is a quiet presence under the crackle, not a bed: -12 dB)
    this.humGain.gain.setTargetAtTime(flame * 0.009, ctx.currentTime, 0.6);
    this.tickAmbience(dt);
    this.musicGain.gain.setTargetAtTime(musicLevel * 0.22, ctx.currentTime, 0.8);
    // crackle grains
    this.crackleTimer -= dt;
    if (flame > 0.05 && this.crackleTimer <= 0) {
      this.crackleTimer = 0.05 + Math.random() * 0.35;
      this.grain(this.crackleGain, 1800 + Math.random() * 3000, 0.012 + Math.random() * 0.02, 0.15 + Math.random() * 0.35);
    }
    // music box (look-ahead scheduling)
    if (musicLevel > 0.01) {
      const stepDur = 0.42;
      while (this.nextNote < ctx.currentTime + 0.25) {
        const idx = LULLABY[this.step % LULLABY.length];
        if (idx >= 0) this.pluck(SCALE[idx], this.nextNote, 0.5, this.musicGain);
        if (this.step % 8 === 0) this.pluck(SCALE[idx >= 0 ? Math.max(0, idx - 5) : 0] / 2, this.nextNote, 0.35, this.musicGain, 2.4);
        this.nextNote += stepDur * (this.step % 4 === 3 ? 1.35 : 1);
        this.step++;
      }
    } else {
      this.nextNote = ctx.currentTime + 0.3;
    }
  }

  private grain(dest: AudioNode, freq: number, dur: number, gain: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = 3;
    const g = ctx.createGain();
    const t = this.now();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp).connect(g).connect(dest);
    src.start(t, Math.random() * 1.5, dur + 0.02);
  }

  /** Kalimba-ish pluck. */
  private pluck(freq: number, when: number, gain: number, dest: AudioNode, decay = 1.4): void {
    const ctx = this.ctx!;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0, when);
    out.gain.linearRampToValueAtTime(gain, when + 0.004);
    out.gain.exponentialRampToValueAtTime(0.0001, when + decay);
    out.connect(dest);
    const partials: [number, number][] = [
      [1, 1],
      [2.76, 0.18],
      [5.4, 0.06],
    ];
    for (const [ratio, amp] of partials) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = freq * ratio;
      const g = ctx.createGain();
      g.gain.setValueAtTime(amp, when);
      g.gain.exponentialRampToValueAtTime(0.0001, when + decay / (ratio > 1 ? ratio * 0.8 : 1));
      o.connect(g).connect(out);
      o.start(when);
      o.stop(when + decay + 0.05);
    }
  }

  private tone(dest: AudioNode, freq: number, when: number, dur: number, gain: number, type: OscillatorType = 'sine', glideTo?: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, when);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, when + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(gain, when + Math.min(0.02, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    o.connect(g).connect(dest);
    o.start(when);
    o.stop(when + dur + 0.05);
  }

  private noiseHit(dest: AudioNode, when: number, dur: number, gain: number, type: BiquadFilterType, freq: number, freqTo?: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, when);
    if (freqTo) f.frequency.exponentialRampToValueAtTime(freqTo, when + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(gain, when + Math.min(0.03, dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(when, Math.random(), dur + 0.05);
  }

  /** Plays a story event at stage coordinates. */
  play(type: SoundEvent, s = 0, t = 0, value = 0): void {
    const ctx = this.ctx;
    if (!ctx || !this.live()) return;
    this.played++;
    const now = this.now() + 0.01;
    const at = this.pannerAt(this.stageWorld(s, t));
    const wet = ctx.createGain();
    wet.gain.value = 1;
    wet.connect(at);
    wet.connect(this.reverbSend);
    switch (type) {
      case 'ignite': {
        const lp = this.pannerAt(this.lanternPos);
        this.noiseHit(lp, now, 0.9, 0.5, 'bandpass', 300, 2400);
        this.tone(lp, 90, now, 0.6, 0.25, 'sine', 60);
        break;
      }
      case 'shadowFound':
        [0, 2, 4].forEach((i, k) => this.tone(wet, SCALE[i], now + k * 0.06, 2.2, 0.12));
        break;
      case 'rabbitBorn':
        this.tone(wet, 380, now, 0.35, 0.18, 'sine', 920);
        [5, 7, 9].forEach((i, k) => this.pluck(SCALE[i], now + 0.2 + k * 0.09, 0.25, wet, 1.0));
        break;
      case 'hop':
        this.noiseHit(wet, now, 0.08, 0.12, 'lowpass', 900);
        this.tone(wet, 700 + Math.random() * 120, now, 0.07, 0.03, 'sine', 1100);
        break;
      case 'land':
        this.tone(wet, value > 0 ? 160 : 120, now, 0.09, 0.12, 'sine', 70);
        break;
      case 'peer':
        this.tone(wet, 620, now, 0.1, 0.05, 'sine', 760);
        this.tone(wet, 560, now + 0.12, 0.12, 0.04, 'sine', 480);
        break;
      case 'splash':
        this.noiseHit(wet, now, 0.45, 0.35, 'highpass', 1200, 400);
        for (let i = 0; i < 6; i++) this.tone(wet, 500 + Math.random() * 900, now + 0.1 + i * 0.07, 0.06, 0.04, 'sine', 1400);
        break;
      case 'chompOpen':
        this.noiseHit(wet, now, 0.12, 0.03, 'bandpass', 500, 900);
        break;
      case 'chomp':
        // a wooden clack and a jaw thock
        this.noiseHit(wet, now, 0.03, 0.45, 'bandpass', 3200);
        this.tone(wet, 1250, now, 0.04, 0.2, 'triangle', 700);
        this.tone(wet, 170, now + 0.012, 0.16, 0.3, 'sine', 75);
        break;
      case 'eat': {
        // a little gulp, then a small glass chime (higher with each firefly):
        // the swallowed firefly glows on in the crocodile's throat
        const i = Math.min(SCALE.length - 1, 2 + value);
        this.tone(wet, 240, now + 0.04, 0.12, 0.14, 'sine', 130);
        this.pluck(SCALE[i], now + 0.12, 0.3, wet, 1.6);
        this.pluck(SCALE[i] * 2, now + 0.17, 0.1, wet, 1.0);
        this.tone(wet, SCALE[i] * 4, now + 0.2, 1.1, 0.045, 'sine');
        this.tone(wet, SCALE[i] * 6.02, now + 0.21, 0.7, 0.02, 'sine');
        break;
      }
      case 'chirp': {
        // the paper bird: two or three quick rising peeps
        const n = value === 2 ? 3 : 2;
        const base = 2300 + (value === 1 ? 300 : 0);
        for (let k = 0; k < n; k++) this.tone(wet, base + k * 180, now + k * 0.085, 0.06, 0.035, 'sine', base + 900 + k * 180);
        break;
      }
      case 'perch':
        // it lands: a soft flutter, then a settled little trill
        this.noiseHit(wet, now, 0.18, 0.05, 'bandpass', 2600, 1400);
        [7, 9].forEach((i, k) => this.pluck(SCALE[i] * 2, now + 0.12 + k * 0.07, 0.12, wet, 1.2));
        break;
      case 'spark': {
        // the lantern gives up its spark: a rising shimmer from the lantern itself
        const lp = this.pannerAt(this.lanternPos);
        this.noiseHit(lp, now, 0.6, 0.05, 'highpass', 4200, 7000);
        this.tone(lp, SCALE[4] * 2, now, 1.4, 0.05, 'sine', SCALE[9] * 2);
        [4, 7, 9].forEach((i, k) => this.pluck(SCALE[i] * 2, now + 0.9 + k * 0.08, 0.12, wet, 2.2));
        break;
      }
      case 'lightsUp':
        // the lamplight goes home with the bird: a long, soft falling chord
        [9, 7, 4, 2].forEach((i, k) => this.pluck(SCALE[i], now + k * 0.22, 0.14, wet, 3.2));
        this.tone(wet, SCALE[0] / 2, now + 0.3, 4.5, 0.05);
        break;
      case 'iconTick':
        this.pluck(SCALE[Math.min(9, 3 + Math.floor(value * 4))], now, 0.12, wet, 0.5);
        break;
      case 'select':
        [3, 5, 7, 8].forEach((i, k) => this.pluck(SCALE[i], now + k * 0.07, 0.25, wet, 1.4));
        break;
      case 'roundComplete':
        [4, 6, 8].forEach((i, k) => this.pluck(SCALE[i], now + k * 0.11, 0.3, wet, 1.6));
        break;
      case 'taleComplete':
        [0, 2, 4, 5, 7, 9].forEach((i, k) => this.pluck(SCALE[i], now + k * 0.12, 0.28, wet, 2.2));
        [0, 4].forEach((i) => this.tone(wet, SCALE[i] / 2, now, 3, 0.08));
        break;
      case 'whoosh':
        this.noiseHit(wet, now, 0.6, 0.12, 'bandpass', 400, 1600);
        break;
      case 'growl': {
        // a low, grumbly growl: buzzy tone under filtered noise, with flutter
        const ctx2 = this.ctx!;
        const o = ctx2.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(72, now);
        o.frequency.linearRampToValueAtTime(64, now + 0.9);
        const lp = ctx2.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 420;
        const g = ctx2.createGain();
        g.gain.setValueAtTime(0, now);
        g.gain.linearRampToValueAtTime(0.16, now + 0.12);
        g.gain.linearRampToValueAtTime(0.0001, now + 0.95);
        const lfo = ctx2.createOscillator();
        lfo.frequency.value = 23;
        const lfoGain = ctx2.createGain();
        lfoGain.gain.value = 0.04;
        lfo.connect(lfoGain).connect(g.gain);
        o.connect(lp).connect(g).connect(wet);
        o.start(now);
        lfo.start(now);
        o.stop(now + 1);
        lfo.stop(now + 1);
        this.noiseHit(wet, now, 0.8, 0.05, 'lowpass', 300);
        break;
      }
      case 'whimper':
        this.tone(wet, 880, now, 0.18, 0.05, 'sine', 640);
        this.tone(wet, 820, now + 0.22, 0.22, 0.04, 'sine', 560);
        break;
      case 'scare': {
        // the flare: a bright bloom of light in sound, a low thump under it
        this.noiseHit(wet, now, 0.55, 0.34, 'bandpass', 500, 4200);
        [4, 7, 9].forEach((i, k) => this.pluck(SCALE[i] * 2, now + 0.02 + k * 0.025, 0.3, wet, 1.4));
        this.tone(wet, 90, now, 0.35, 0.4, 'sine', 62);
        this.tone(wet, 980, now + 0.05, 0.24, 0.1, 'sine', 620); // a little yelp
        break;
      }
      case 'wolfFlee':
        // the bolt: quickening paws and a whoosh away
        for (let i = 0; i < 9; i++) this.noiseHit(wet, now + i * (0.07 - i * 0.004), 0.045, 0.06, 'lowpass', 750);
        this.noiseHit(wet, now + 0.05, 0.55, 0.07, 'bandpass', 1400, 380);
        break;
      case 'howl': {
        // a soft, musical howl: a gliding voice with vibrato, lots of reverb
        const ctx2 = this.ctx!;
        const o = ctx2.createOscillator();
        o.type = 'triangle';
        o.frequency.setValueAtTime(330, now);
        o.frequency.exponentialRampToValueAtTime(587, now + 0.7);
        o.frequency.exponentialRampToValueAtTime(494, now + 2.2);
        const vib = ctx2.createOscillator();
        vib.frequency.value = 5.5;
        const vibG = ctx2.createGain();
        vibG.gain.value = 9;
        vib.connect(vibG).connect(o.frequency);
        const bp = ctx2.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 900;
        bp.Q.value = 0.8;
        const g = ctx2.createGain();
        g.gain.setValueAtTime(0, now);
        g.gain.linearRampToValueAtTime(0.24, now + 0.35);
        g.gain.linearRampToValueAtTime(0.18, now + 1.6);
        g.gain.linearRampToValueAtTime(0.0001, now + 2.4);
        o.connect(bp).connect(g).connect(wet);
        o.start(now);
        vib.start(now);
        o.stop(now + 2.5);
        vib.stop(now + 2.5);
        // ...and the moon answers: a slow music-box phrase over a soft drone
        [7, 9, 7, 5, 4, 2, 4].forEach((i, k) => this.pluck(SCALE[i], now + 1.6 + k * 0.42, 0.2, wet, 2.4));
        this.tone(wet, SCALE[0] / 2, now + 1.4, 4.2, 0.05);
        this.tone(wet, SCALE[4] / 2, now + 1.4, 4.2, 0.035);
        break;
      }
      case 'curtain':
        // the curtain call: a low bell, then a warm rising fanfare
        this.tone(wet, SCALE[0] / 2, now, 3.2, 0.09);
        [0, 2, 4, 5, 7, 9].forEach((i, k) => this.pluck(SCALE[i], now + 0.15 + k * 0.1, 0.24, wet, 2.4));
        [4, 7].forEach((i) => this.pluck(SCALE[i] * 2, now + 0.8, 0.14, wet, 2.8));
        break;
      case 'goodnight':
        // the last chord of the lullaby, very soft and long
        [0, 2, 4].forEach((i, k) => this.pluck(SCALE[i] / 2, now + k * 0.18, 0.2, wet, 4.5));
        this.tone(wet, SCALE[0] / 4, now, 5, 0.06);
        break;
      case 'ribbon':
        // a paper ribbon unfurling: a soft flutter
        this.noiseHit(wet, now, 0.32, 0.03, 'bandpass', 1800, 900);
        this.noiseHit(wet, now + 0.08, 0.22, 0.02, 'highpass', 3000);
        break;
      case 'title': {
        // the curtain opens on a tale: a low bell, then a short rising phrase
        // whose shape differs per tale (value: 0 croc, 1 bridge, 2 wolf)
        const phrases = [
          [0, 2, 4, 7],
          [2, 4, 5, 7],
          [0, 3, 4, 8],
          [7, 4, 2, 0],
        ];
        const ph = phrases[Math.max(0, Math.min(3, value))];
        this.tone(wet, SCALE[0] / 2, now, 2.6, 0.07);
        ph.forEach((i, k) => this.pluck(SCALE[i], now + 0.12 + k * 0.14, 0.22 - k * 0.02, wet, 1.8));
        this.noiseHit(wet, now, 0.5, 0.04, 'bandpass', 2400, 600);
        break;
      }
      case 'bow':
        [2, 4, 7].forEach((i, k) => this.pluck(SCALE[i], now + k * 0.05, 0.22, wet, 2));
        break;
    }
  }
}
