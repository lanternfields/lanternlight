/**
 * The prologue's "big and small" beat: the shadow grows as your hand comes
 * near you (toward the effective light) and shrinks again as it reaches for
 * the wall. Pure logic (thresholds, hysteresis, the assist), so it is
 * unit-testable; the story drives Pip's reactions from its flags.
 *
 * `size` is the shadow's sizeRatio (the hand's mean light-distance
 * magnification over a comfortably held hand's, shadow-model.ts). Its real
 * range, measured through the app's own projection (tests/size-beat.test.ts):
 * on an ordinary wall (1.5 m or more) pulling the hand back 15 cm gives ~1.25,
 * 20 cm ~1.36; reaching 10 cm toward the wall ~0.88. Near walls (small stages)
 * are less sensitive (20 cm back ~1.17 at 0.8 m), so the thresholds relax
 * while the player tries, and the assist completes the beat regardless: there
 * is no fail state.
 */
import { clamp01 } from './ease.js';

export type SizePhase = 'grow' | 'shrink' | 'done';

/** "Clearly big": on at this size, off again below it minus SIZE_HYSTERESIS (the wolf's scare starts at 1.25 too). */
export const SIZE_BIG_ON = 1.25;
/** "Clearly small": on at this size, off again above it plus SIZE_HYSTERESIS. */
export const SIZE_SMALL_ON = 0.92;
/** The gap between the on and off thresholds (a hand hovering at a threshold never flickers Pip). */
export const SIZE_HYSTERESIS = 0.1;
/** The goal must be held this long (s): a one-frame tracking spike never counts. */
export const SIZE_HOLD = 0.3;
/** The thresholds start to relax this long into a phase (s)... */
export const SIZE_RELAX_FROM = 6;
/** ...by this much at the assist (big down to 1.13, small up to 0.98)... */
export const SIZE_RELAX_BIG = 0.12;
export const SIZE_RELAX_SMALL = 0.06;
/** ...and the assist completes the phase this long into it (s; gentle mode sooner). */
export const SIZE_ASSIST: readonly [number, number] = [13, 9];
/** Gentle mode: easier thresholds from the start. */
export const SIZE_GENTLE_BIG = 0.07;
export const SIZE_GENTLE_SMALL = 0.03;
/** Moving at least this much toward the goal counts as trying (resets the stall clock). */
export const SIZE_PROGRESS = 0.02;

export interface SizeBeatEvents {
  /** The shadow has been clearly big (the grow phase is done). */
  grew: boolean;
  /** ...then clearly small (the beat is done). */
  shrank: boolean;
  /** The assist completed the phase. */
  assisted: boolean;
}

export class SizeBeat {
  phase: SizePhase = 'grow';
  /** True while the shadow counts as big (with hysteresis): Pip ducks. */
  big = false;
  /** True while it counts as small (with hysteresis). */
  small = false;
  /** Seconds in the current phase (the assist's clock: never reset by trying). */
  phaseTime = 0;
  /** Seconds the phase's goal has been held. */
  held = 0;
  /** Seconds without moving toward the phase's goal (the hints' clock). */
  stall = 0;
  /** The grow phase was completed by the assist (the shadow never got big). */
  grewAssisted = false;
  assists = 0;
  /** The furthest the shadow has got toward this phase's goal. */
  private best = NaN;
  readonly events: SizeBeatEvents = { grew: false, shrank: false, assisted: false };

  reset(): void {
    this.phase = 'grow';
    this.big = false;
    this.small = false;
    this.grewAssisted = false;
    this.startPhase('grow');
  }

  private startPhase(phase: SizePhase): void {
    this.phase = phase;
    this.phaseTime = 0;
    this.held = 0;
    this.stall = 0;
    this.best = NaN;
  }

  /** Seconds after which the assist completes a phase. */
  assistAfter(gentle = false): number {
    return SIZE_ASSIST[gentle ? 1 : 0];
  }

  private relax(gentle: boolean): number {
    return clamp01((this.phaseTime - SIZE_RELAX_FROM) / (this.assistAfter(gentle) - SIZE_RELAX_FROM));
  }

  /** The size that counts as big right now (it relaxes while the player tries). */
  bigOn(gentle = false): number {
    return SIZE_BIG_ON - (gentle ? SIZE_GENTLE_BIG : 0) - SIZE_RELAX_BIG * (this.phase === 'grow' ? this.relax(gentle) : 0);
  }

  /** The size that counts as small right now. */
  smallOn(gentle = false): number {
    return SIZE_SMALL_ON + (gentle ? SIZE_GENTLE_SMALL : 0) + SIZE_RELAX_SMALL * (this.phase === 'shrink' ? this.relax(gentle) : 0);
  }

  /**
   * Advance by `dt` with the shadow's size now (null = no shadow in the light).
   * Returns this frame's events (the same object every frame).
   */
  update(dt: number, size: number | null, gentle = false): SizeBeatEvents {
    const ev = this.events;
    ev.grew = ev.shrank = ev.assisted = false;
    if (this.phase === 'done') {
      this.updateFlags(size, gentle);
      return ev;
    }
    this.phaseTime += dt;
    this.updateFlags(size, gentle);
    const growing = this.phase === 'grow';
    // the hints wait for a pause: moving toward the goal restarts their clock
    if (size !== null && (Number.isNaN(this.best) || (growing ? size > this.best + SIZE_PROGRESS : size < this.best - SIZE_PROGRESS))) {
      const first = Number.isNaN(this.best);
      this.best = size;
      if (!first) this.stall = 0;
    }
    const goal = growing ? this.big : this.small;
    this.held = goal ? this.held + dt : 0;
    if (!goal) this.stall += dt;
    else this.stall = 0;
    // the assist only steps in while the goal isn't met: a shadow that is big
    // (or small) right now finishes its hold and counts as the player's own
    const assist = !goal && this.phaseTime >= this.assistAfter(gentle);
    if (this.held >= SIZE_HOLD || assist) {
      if (assist) {
        ev.assisted = true;
        this.assists++;
      }
      if (growing) {
        ev.grew = true;
        this.grewAssisted = ev.assisted;
        // a shadow that never grew isn't asked to shrink: the beat simply ends
        this.startPhase(ev.assisted ? 'done' : 'shrink');
      } else {
        ev.shrank = true;
        this.startPhase('done');
      }
    }
    return ev;
  }

  private updateFlags(size: number | null, gentle: boolean): void {
    if (size === null) {
      this.big = false;
      this.small = false;
      return;
    }
    const bigOn = this.bigOn(gentle);
    if (!this.big && size >= bigOn) this.big = true;
    else if (this.big && size < bigOn - SIZE_HYSTERESIS) this.big = false;
    const smallOn = this.smallOn(gentle);
    if (!this.small && size <= smallOn) this.small = true;
    else if (this.small && size > smallOn + SIZE_HYSTERESIS) this.small = false;
  }
}
