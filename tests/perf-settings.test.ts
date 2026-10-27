import { describe, expect, it } from 'vitest';
import { AdaptiveQuality, FrameStats, QUALITY_LEVELS } from '../src/core/perf.js';
import {
  DEFAULT_SETTINGS,
  KeyValueStore,
  loadProgress,
  loadSettings,
  saveProgress,
  saveSettings,
} from '../src/core/settings.js';
import { createProgress } from '../src/core/story.js';

class MemStore implements KeyValueStore {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.has(k) ? this.data.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
}

describe('frame stats', () => {
  it('computes percentiles over a rolling window', () => {
    const s = new FrameStats(100);
    for (let i = 1; i <= 100; i++) s.push(i);
    expect(s.percentile(50)).toBeCloseTo(50, 0);
    expect(s.percentile(90)).toBeCloseTo(90, 0);
    for (let i = 0; i < 100; i++) s.push(5);
    expect(s.percentile(99)).toBe(5);
    expect(s.summary().worst).toBe(100);
  });
});

describe('adaptive quality', () => {
  /** Feeds `seconds` of frames at `hz`, with a missed vsync every `missEvery` frames. */
  const run = (q: AdaptiveQuality, hz: number, seconds: number, opts: { jitter?: number; missEvery?: number; seed?: number } = {}) => {
    const period = 1000 / hz;
    let seed = opts.seed ?? 3;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
    for (let i = 0; i < seconds * hz; i++) {
      let ms = period + rnd() * (opts.jitter ?? 0.1);
      if (opts.missEvery && i % opts.missEvery === 0) ms += period; // one dropped vsync
      q.update(ms, ms / 1000);
    }
  };
  const top = QUALITY_LEVELS.length - 1;

  it('holds top quality at 72 and 90 Hz with ordinary timer jitter (review H1)', () => {
    for (const hz of [72, 90]) {
      const q = new AdaptiveQuality();
      run(q, hz, 60, { jitter: 0.4 });
      expect(q.level).toBe(top);
      expect(q.changes.length).toBe(0);
    }
  });

  it('uses the session refresh period when known', () => {
    const q = new AdaptiveQuality();
    q.periodMs = 1000 / 90;
    run(q, 90, 30, { jitter: 0.3 });
    expect(q.level).toBe(top);
    expect(q.period()).toBeCloseTo(11.11, 1);
  });

  it('estimates the period from the frames when the session does not say', () => {
    const q = new AdaptiveQuality();
    run(q, 72, 5);
    expect(q.period()).toBeCloseTo(13.89, 1);
  });

  it('steps down under sustained missed frames, then recovers', () => {
    const q = new AdaptiveQuality();
    run(q, 72, 4);
    expect(q.level).toBe(top);
    run(q, 72, 4, { missEvery: 3 }); // a third of the frames miss
    expect(q.level).toBeLessThan(top);
    run(q, 72, 12, { missEvery: 3 });
    expect(q.level).toBe(0);
    run(q, 72, 200);
    expect(q.level).toBe(top);
  });

  it('waits longer before retrying a level that failed (no flapping)', () => {
    const q = new AdaptiveQuality();
    run(q, 72, 4);
    run(q, 72, 1.6, { missEvery: 3 }); // ~2.1 s of load: one step's worth
    const dropped = q.level;
    expect(dropped).toBe(top - 1);
    // clean frames: first retry after upAfter (6 s) x 2 (one failure) = 12 s
    run(q, 72, 9); // more than the normal 6 s wait
    expect(q.level).toBe(dropped);
    run(q, 72, 8);
    expect(q.level).toBe(top);
  });

  it('ignores a single long frame (shader compile hitch)', () => {
    const q = new AdaptiveQuality();
    run(q, 72, 5);
    q.update(120, 0.12);
    run(q, 72, 3);
    expect(q.changes.length).toBe(0);
  });

  it('stays in the dead band with occasional misses', () => {
    const q = new AdaptiveQuality();
    run(q, 72, 60, { missEvery: 20 }); // 5% misses
    expect(q.changes.length).toBe(0);
  });

  it('respects the device cap', () => {
    const q = new AdaptiveQuality(undefined, 1);
    q.maxLevel = 2;
    run(q, 72, 120);
    expect(q.level).toBe(2);
  });
});

describe('settings & progress persistence', () => {
  it('round-trips and clamps', () => {
    const st = new MemStore();
    saveSettings({ ...DEFAULT_SETTINGS, dimLevel: 2, gentle: true, dominant: 'left' }, st);
    const s = loadSettings(st);
    expect(s.dimLevel).toBe(0.85);
    expect(s.gentle).toBe(true);
    expect(s.dominant).toBe('left');
  });

  it('survives corrupted or missing storage', () => {
    const st = new MemStore();
    st.setItem('lanternlight.settings.v1', '{not json');
    expect(loadSettings(st)).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS);
    const broken: KeyValueStore = {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('blocked');
      },
    };
    expect(() => saveSettings(DEFAULT_SETTINGS, broken)).not.toThrow();
    expect(loadProgress(broken)).toEqual(createProgress());
  });

  it('progress round-trips', () => {
    const st = new MemStore();
    const p = createProgress();
    p.completed.croc = true;
    p.discovered.push('rabbit');
    p.visits = 3;
    saveProgress(p, st);
    const q = loadProgress(st);
    expect(q.completed.croc).toBe(true);
    expect(q.completed.bridge).toBe(false);
    expect(q.discovered).toEqual(['rabbit']);
    expect(q.visits).toBe(3);
  });
});
