/**
 * Comfort & accessibility settings and save data, persisted to localStorage
 * (wrapped so private browsing or blocked storage never breaks the show).
 */
import { Progress, createProgress } from './story.js';

export interface Settings {
  /** How much the real room dims during the show, 0..0.85. */
  dimLevel: number;
  /** Stage size multiplier. */
  stageScale: number;
  /** Bigger targets, faster dwell, stronger assists. */
  gentle: boolean;
  /** High-contrast stage (pure light / pure shadow, no paper grain). */
  highContrast: boolean;
  /** Fewer particles, no sway. */
  reduceMotion: boolean;
  /** Show the storyteller's lines and the short hand prompts. */
  captions: boolean;
  /** Full captions: prompts also explain what to do, at length (accessibility). */
  fullCaptions: boolean;
  /** Master volume 0..1. */
  volume: number;
  /** Dominant hand. */
  dominant: 'left' | 'right';
  /** Mixed reality: draw the real hands in front of the stage (hand occlusion). */
  occluder: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  dimLevel: 0.75,
  stageScale: 1,
  gentle: false,
  highContrast: false,
  reduceMotion: false,
  captions: true,
  fullCaptions: false,
  volume: 0.8,
  dominant: 'right',
  occluder: true,
};

/**
 * Whether the hand occluder is on: the `occluder` URL parameter wins
 * (`?occluder=0` turns it off for a tester whose hand looks cut off), else the
 * saved setting.
 */
export function occluderEnabled(search: string, setting: boolean): boolean {
  const v = new URLSearchParams(search).get('occluder');
  if (v === null) return setting;
  const s = v.trim().toLowerCase();
  if (s === '0' || s === 'off' || s === 'false' || s === 'no') return false;
  if (s === '1' || s === 'on' || s === 'true' || s === 'yes' || s === '') return true;
  return setting;
}

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const SETTINGS_KEY = 'lanternlight.settings.v1';
const PROGRESS_KEY = 'lanternlight.progress.v1';

function safeStore(store: KeyValueStore | null | undefined): KeyValueStore | null {
  return store ?? null;
}

export function loadSettings(store?: KeyValueStore | null): Settings {
  const s = safeStore(store);
  const out: Settings = { ...DEFAULT_SETTINGS };
  if (!s) return out;
  try {
    const raw = s.getItem(SETTINGS_KEY);
    if (!raw) return out;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    if (typeof parsed.dimLevel === 'number') out.dimLevel = Math.min(0.85, Math.max(0, parsed.dimLevel));
    if (typeof parsed.stageScale === 'number') out.stageScale = Math.min(1.3, Math.max(0.7, parsed.stageScale));
    if (typeof parsed.gentle === 'boolean') out.gentle = parsed.gentle;
    if (typeof parsed.highContrast === 'boolean') out.highContrast = parsed.highContrast;
    if (typeof parsed.reduceMotion === 'boolean') out.reduceMotion = parsed.reduceMotion;
    if (typeof parsed.captions === 'boolean') out.captions = parsed.captions;
    if (typeof parsed.fullCaptions === 'boolean') out.fullCaptions = parsed.fullCaptions;
    if (typeof parsed.occluder === 'boolean') out.occluder = parsed.occluder;
    if (typeof parsed.volume === 'number') out.volume = Math.min(1, Math.max(0, parsed.volume));
    if (parsed.dominant === 'left' || parsed.dominant === 'right') out.dominant = parsed.dominant;
  } catch {
    /* corrupted or blocked storage: defaults */
  }
  return out;
}

export function saveSettings(settings: Settings, store?: KeyValueStore | null): void {
  const s = safeStore(store);
  if (!s) return;
  try {
    s.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}

export function loadProgress(store?: KeyValueStore | null): Progress {
  const s = safeStore(store);
  const out = createProgress();
  if (!s) return out;
  try {
    const raw = s.getItem(PROGRESS_KEY);
    if (!raw) return out;
    const p = JSON.parse(raw) as Partial<Progress>;
    if (p.completed) {
      out.completed.croc = !!p.completed.croc;
      out.completed.bridge = !!p.completed.bridge;
      out.completed.wolf = !!(p.completed as { wolf?: boolean }).wolf;
    }
    if (typeof p.firefliesEaten === 'number') out.firefliesEaten = p.firefliesEaten;
    if (typeof p.crossings === 'number') out.crossings = p.crossings;
    if (Array.isArray(p.discovered)) out.discovered = p.discovered.filter((x) => typeof x === 'string');
    if (typeof p.visits === 'number') out.visits = p.visits;
  } catch {
    /* ignore */
  }
  return out;
}

export function saveProgress(progress: Progress, store?: KeyValueStore | null): void {
  const s = safeStore(store);
  if (!s) return;
  try {
    s.setItem(PROGRESS_KEY, JSON.stringify(progress));
  } catch {
    /* ignore */
  }
}

/** Returns window.localStorage if usable, else null. */
export function browserStore(): KeyValueStore | null {
  try {
    const ls = (globalThis as { localStorage?: KeyValueStore }).localStorage;
    if (!ls) return null;
    const k = '__lanternlight_probe__';
    ls.setItem(k, '1');
    return ls;
  } catch {
    return null;
  }
}
