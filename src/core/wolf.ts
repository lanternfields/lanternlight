/**
 * The Moon Wolf: a shadow wolf prowls toward the rabbit; it cowers, then
 * flees, when your shadow is big enough (bring your hand back toward you,
 * or raise both hands). It comes back a little bolder each time. It never
 * hurts anyone: if it reaches the rabbit it just sits there and grumbles.
 */
export type WolfState = 'away' | 'prowl' | 'cower' | 'flee' | 'sit' | 'return' | 'howl';

export interface WolfEvents {
  growl: boolean;
  whimper: boolean;
  fled: boolean;
  howl: boolean;
}

export class Wolf {
  x = 1.0;
  y = 0;
  dir: 1 | -1 = -1;
  state: WolfState = 'away';
  /** 0..1 how scared it is right now. */
  fear = 0;
  /** 0..1 crouch for animation. */
  crouch = 0;
  /** Walk-cycle phase (radians). */
  phase = 0;
  speed = 0.065;
  /** Current velocity: every move eases in and out (STYLE_GUIDE 4). */
  vx = 0;
  /** Anticipation before fleeing (seconds of crouch left). */
  private bolt = 0;
  /** Rabbit position: the wolf stops (and sits) this far from it. */
  stopX = -0.3;
  private growlTimer = 0;
  /** Latched once the wolf has walked into view (it can't be scared before). */
  onStage = false;
  readonly events: WolfEvents = { growl: false, whimper: false, fled: false, howl: false };

  enter(fromX = 0.92, speed = 0.065): void {
    this.x = fromX;
    this.dir = -1;
    this.state = 'prowl';
    this.fear = 0;
    this.speed = speed;
    this.vx = -speed * 0.3;
    this.growlTimer = 1.5;
    this.onStage = false;
  }

  /** Walk in calmly and sit to howl at the moon. */
  befriend(): void {
    this.state = 'return';
    this.dir = -1;
    this.x = Math.max(this.x, 0.95);
    this.fear = 0;
  }

  /**
   * @param scared true while the viewer's shadow is big enough
   */
  update(dt: number, scared: boolean): WolfEvents {
    const ev = this.events;
    ev.growl = ev.whimper = ev.fled = ev.howl = false;
    // velocity follows each state's target speed smoothly (no linear starts/stops)
    const ease = (target: number, rate: number): void => {
      this.vx += (target - this.vx) * (1 - Math.exp(-rate * dt));
      this.x += this.vx * dt;
      this.phase += Math.abs(this.vx) * dt * 105;
    };
    const targetCrouch = this.state === 'cower' ? 1 : this.state === 'sit' || this.state === 'howl' ? 0.35 : 0;
    this.crouch += (targetCrouch - this.crouch) * (1 - Math.exp(-8 * dt));
    switch (this.state) {
      case 'away':
        return ev;
      case 'prowl':
      case 'sit':
      case 'cower': {
        if (this.x < 0.84) this.onStage = true;
        scared = scared && this.onStage;
        if (scared) this.fear = Math.min(1, this.fear + dt * 1.25);
        else this.fear = Math.max(0, this.fear - dt * 0.55);
        if (this.fear >= 1) {
          this.state = 'flee';
          this.dir = 1;
          this.bolt = 0.16; // a crouch, then it bolts
          ev.fled = true;
          return ev;
        }
        if (this.fear > 0.22) {
          if (this.state !== 'cower') ev.whimper = true;
          this.state = 'cower';
          // backs away a little while cowering
          ease(this.x < 0.95 ? 0.03 : 0, 5);
          return ev;
        }
        if (this.state === 'cower' && this.fear < 0.08) this.state = 'prowl';
        if (this.state === 'prowl') {
          this.dir = -1;
          // slows to a stop as it reaches the rabbit, then sits
          const left = Math.max(0, this.x - this.stopX);
          ease(-Math.min(this.speed, left * 1.1 + 0.003), 4);
          if (this.x <= this.stopX + 0.003) {
            this.x = Math.max(this.x, this.stopX);
            this.state = 'sit';
          }
        } else {
          ease(0, 5);
        }
        this.growlTimer -= dt;
        if (this.growlTimer <= 0) {
          this.growlTimer = this.state === 'sit' ? 2.2 : 3.5;
          ev.growl = true;
        }
        return ev;
      }
      case 'flee':
        if (this.bolt > 0) {
          this.bolt -= dt;
          ease(0, 10);
        } else ease(0.6, 6);
        if (this.x > 1.05) this.state = 'away';
        return ev;
      case 'return': {
        // walks in and eases to a stop where it sits to sing
        const left = Math.max(0, this.x - 0.3);
        ease(-Math.min(0.09, left * 1.2 + 0.004), 3);
        if (this.x <= 0.303) {
          this.x = Math.max(this.x, 0.3);
          this.state = 'howl';
          ev.howl = true;
        }
        return ev;
      }
      case 'howl':
        ease(0, 6);
        return ev;
    }
    return ev;
  }
}
