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
  const run = (q: AdaptiveQuality, ms: number, seconds: number) => {
    for (let i = 0; i < seconds * 72; i++) q.update(ms, 1 / 72);
  };

  it('steps down under sustained load and back up with headroom', () => {
    const q = new AdaptiveQuality();
    const top = QUALITY_LEVELS.length - 1;
    expect(q.level).toBe(top);
    run(q, 8, 4); // warmup + fine
    expect(q.level).toBe(top);
    run(q, 18, 4);
    expect(q.level).toBeLessThan(top);
    run(q, 18, 6);
    expect(q.level).toBe(0);
    run(q, 7, 30);
    expect(q.level).toBe(top);
    expect(q.changes.length).toBeGreaterThanOrEqual(4);
  });

  it('does not flap in the dead band', () => {
    const q = new AdaptiveQuality();
    run(q, 12, 60);
    expect(q.changes.length).toBe(0);
  });

  it('ignores a single long frame (shader compile hitch)', () => {
    const q = new AdaptiveQuality();
    run(q, 8, 5);
    q.update(120, 1 / 72);
    run(q, 8, 3);
    expect(q.changes.length).toBe(0);
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
