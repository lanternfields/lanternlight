/**
 * The shadow rabbit: hops along anything solid (scenery or your shadow), waits
 * politely at edges, rides your hand when it moves, and never "dies": if it
 * falls in the river it paddles back to where it started.
 */
import { Ground, groundAt, hopPosition } from './physics2d.js';
import { Capsule2D } from './shadow-model.js';

export type RabbitState = 'idle' | 'hop' | 'fall' | 'swim' | 'climb' | 'home';

export interface RabbitEvents {
  hopped: boolean;
  landed: boolean;
  landedOnShadow: boolean;
  splashed: boolean;
  reachedHome: boolean;
  peering: boolean;
}

export interface RabbitWorld {
  scenery: readonly Capsule2D[];
  sceneryCount: number;
  shadows: readonly Capsule2D[];
  shadowCount: number;
  /** River surface height; below this the rabbit swims. */
  waterY: number;
  /** Rabbit swims back to this x (the near bank edge) after a splash. */
  respawnX: number;
  respawnY: number;
  /** Reaching x >= homeX ends the crossing. */
  homeX: number;
}

export class Rabbit {
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  dir: 1 | -1 = 1;
  state: RabbitState = 'idle';
  /** 0..1 progress through the current hop. */
  hopT = 0;
  idleTime = 0;
  /** Squash/stretch for animation (1 = rest; > 1 stretched, < 1 squashed). A damped spring. */
  squash = 1;
  private squashV = 0;
  /** Anticipation: a short crouch before each hop (STYLE_GUIDE 4.2). */
  crouchTime = 0.085;
  private crouching = -1;
  private hopTx = 0;
  private hopTy = 0;
  /** Is it currently standing on a shadow (riding your hand)? */
  onShadow = false;
  hopDuration = 0.34;
  hopLength = 0.085;
  maxHopReach = 0.13;
  stepUp = 0.13;
  maxDrop = 0.32;
  restTime = 0.28;
  gravity = -2.4;
  swimSpeed = 0.16;

  readonly events: RabbitEvents = {
    hopped: false,
    landed: false,
    landedOnShadow: false,
    splashed: false,
    reachedHome: false,
    peering: false,
  };

  private hx0 = 0;
  private hy0 = 0;
  private hx1 = 0;
  private hy1 = 0;
  private hLift = 0;
  private readonly g: Ground = { y: 0, source: -1, isShadow: false };
  private readonly pos = { x: 0, y: 0 };

  place(x: number, y: number, dir: 1 | -1 = 1): void {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.dir = dir;
    this.state = 'idle';
    this.idleTime = 0;
    this.hopT = 0;
    this.crouching = -1;
    this.squash = 1;
    this.squashV = 0;
  }

  private ground(w: RabbitWorld, x: number, maxY: number, stepUp: number): Ground {
    return groundAt(x, maxY, w.scenery, w.sceneryCount, w.shadows, w.shadowCount, this.g, stepUp);
  }

  update(dt: number, w: RabbitWorld, active = true): RabbitEvents {
    const ev = this.events;
    ev.hopped = ev.landed = ev.landedOnShadow = ev.splashed = ev.reachedHome = ev.peering = false;
    // squash & stretch on a springy body: impulses at take-off and landing,
    // a slight overshoot as it recovers (no snapping)
    const target = this.crouching >= 0 ? 0.8 : 1;
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.squashV += (520 * (target - this.squash) - 2 * 0.42 * 22.8 * this.squashV) * h;
      this.squash += this.squashV * h;
    }
    switch (this.state) {
      case 'home':
        return ev;
      case 'idle': {
        // Stay glued to the support under the feet (ride moving shadows).
        const g = this.ground(w, this.x, this.y + 0.06, 0);
        if (g.y === -Infinity || g.y < this.y - 0.07) {
          this.state = 'fall';
          this.vy = 0;
          return ev;
        }
        this.y += (g.y - this.y) * (1 - Math.exp(-25 * dt));
        this.onShadow = g.isShadow;
        if (this.x >= w.homeX) {
          this.state = 'home';
          ev.reachedHome = true;
          return ev;
        }
        this.idleTime += dt;
        if (this.crouching >= 0) {
          this.crouching += dt;
          if (this.crouching >= this.crouchTime) {
            this.crouching = -1;
            this.startHop(this.hopTx, this.hopTy);
            ev.hopped = true;
          }
          return ev;
        }
        if (!active || this.idleTime < this.restTime) return ev;
        // Look for the farthest reachable landing spot up to maxHopReach.
        let landed = false;
        for (let reach = this.hopLength; reach <= this.maxHopReach + 1e-6; reach += 0.022) {
          const tx = this.x + this.dir * reach;
          const tg = this.ground(w, tx, this.y + this.stepUp, 0);
          if (tg.y === -Infinity) continue;
          if (tg.y < this.y - this.maxDrop) continue;
          if (tg.y < w.waterY) continue;
          // crouch first, then spring off
          this.hopTx = tx;
          this.hopTy = tg.y;
          this.crouching = 0;
          landed = true;
          break;
        }
        if (!landed) {
          ev.peering = true;
          this.idleTime = this.restTime * 0.5;
        }
        return ev;
      }
      case 'hop': {
        this.hopT += dt / this.hopDuration;
        hopPosition(this.hx0, this.hy0, this.hx1, this.hy1, this.hLift, this.hopT, this.pos);
        this.x = this.pos.x;
        this.y = this.pos.y;
        if (this.hopT >= 1) {
          const g = this.ground(w, this.x, this.y + 0.06, 0);
          if (g.y !== -Infinity && Math.abs(g.y - this.y) < 0.08) {
            this.y = g.y;
            this.state = 'idle';
            this.idleTime = 0;
            this.squashV -= 4.2; // landing squash
            this.onShadow = g.isShadow;
            ev.landed = true;
            ev.landedOnShadow = g.isShadow;
          } else {
            // The ground moved away mid-hop.
            this.state = 'fall';
            this.vy = 0;
          }
        }
        return ev;
      }
      case 'fall': {
        const prevY = this.y;
        this.vy += this.gravity * dt;
        this.y += this.vy * dt;
        const g = this.ground(w, this.x, prevY + 0.01, 0);
        if (g.y !== -Infinity && this.y <= g.y && prevY >= g.y - 0.02) {
          this.y = g.y;
          this.vy = 0;
          this.state = 'idle';
          this.idleTime = 0;
          this.squashV -= 5.5;
          this.onShadow = g.isShadow;
          ev.landed = true;
          ev.landedOnShadow = g.isShadow;
        } else if (this.y <= w.waterY) {
          this.y = w.waterY;
          this.vy = 0;
          this.state = 'swim';
          ev.splashed = true;
        }
        return ev;
      }
      case 'swim': {
        const back = w.respawnX < this.x ? -1 : 1;
        this.dir = back as 1 | -1;
        this.x += back * this.swimSpeed * dt;
        this.y = w.waterY + Math.sin(this.x * 60) * 0.004;
        if ((back < 0 && this.x <= w.respawnX + 0.04) || (back > 0 && this.x >= w.respawnX - 0.04)) {
          this.startHop(w.respawnX, w.respawnY);
          this.state = 'climb';
        }
        return ev;
      }
      case 'climb': {
        this.hopT += dt / (this.hopDuration * 1.4);
        hopPosition(this.hx0, this.hy0, this.hx1, this.hy1, this.hLift, this.hopT, this.pos);
        this.x = this.pos.x;
        this.y = this.pos.y;
        if (this.hopT >= 1) {
          this.state = 'idle';
          this.idleTime = -0.6; // catch its breath
          this.dir = w.homeX > this.x ? 1 : -1;
          ev.landed = true;
        }
        return ev;
      }
    }
    return ev;
  }

  private startHop(tx: number, ty: number): void {
    this.hx0 = this.x;
    this.hy0 = this.y;
    this.hx1 = tx;
    this.hy1 = ty;
    this.hLift = 0.045 + Math.max(0, ty - this.y) * 1.1;
    this.hopT = 0;
    this.state = 'hop';
    this.squashV += 5.2; // stretch out of the crouch
  }

  /** A little bounce from outside (e.g. taking a bow). */
  bounce(v: number): void {
    this.squashV += v;
  }
}
