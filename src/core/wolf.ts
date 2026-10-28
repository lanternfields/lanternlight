/**
 * The Moon Wolf: a shadow wolf stalks toward the rabbit. As your shadow grows
 * it hesitates (slows, leans back); when your shadow is big enough (bring your
 * hand back toward you, or raise both hands) it cowers, rears back on a held
 * beat, then bolts. A moment later it peeks back and sits to sing to the moon.
 * It never hurts anyone: if it reaches the rabbit it just sits and grumbles.
 *
 * Every move follows a smooth velocity (STYLE_GUIDE 4): no linear starts or
 * stops, a crouch before the bolt, a slowing walk into each stop.
 */
export type WolfState = 'away' | 'prowl' | 'cower' | 'rear' | 'flee' | 'sit' | 'return' | 'howl' | 'rest';

export interface WolfEvents {
  growl: boolean;
  whimper: boolean;
  /** The bolt: it starts running (after the rear-back). */
  fled: boolean;
  /** The moment it rears back (the scare lands). */
  reared: boolean;
  howl: boolean;
}

/** Seconds the wolf holds its rear-back before bolting (anticipation). */
export const WOLF_REAR_TIME = 0.32;

export class Wolf {
  x = 1.0;
  y = 0;
  dir: 1 | -1 = -1;
  state: WolfState = 'away';
  /** 0..1 how scared it is right now. */
  fear = 0;
  /** 0..1 how much it hesitates (follows your shadow's size even before it is scared). */
  hesitate = 0;
  /** 0..1 crouch for animation. */
  crouch = 0;
  /** Walk-cycle phase (radians). */
  phase = 0;
  speed = 0.1;
  /** Current velocity. */
  vx = 0;
  /** Where it stops (and sits) by the rabbit. */
  stopX = 0.1;
  /** Where it sits to sing after the twist. */
  singX = 0.16;
  /** Seconds spent in the current state. */
  stateTime = 0;
  private growlTimer = 0;
  /** Latched once the wolf has walked into the light (it can't be scared before). */
  onStage = false;
  /** Off-stage x (it is gone once it runs past this). */
  exitX = 0.82;
  readonly events: WolfEvents = { growl: false, whimper: false, fled: false, reared: false, howl: false };

  private setState(s: WolfState): void {
    this.state = s;
    this.stateTime = 0;
  }

  enter(fromX = 0.66, speed = 0.1): void {
    this.x = fromX;
    this.dir = -1;
    this.setState('prowl');
    this.fear = 0;
    this.hesitate = 0;
    this.speed = speed;
    this.vx = -speed * 0.3;
    this.growlTimer = 1.2;
    this.onStage = false;
  }

  /** Peek back in and sit to sing to the moon. */
  befriend(): void {
    this.setState('return');
    this.dir = -1;
    // walks back in from beyond the edge of the light (no pop-in)
    this.x = Math.max(this.x, this.exitX + 0.18);
    this.vx = 0;
    this.fear = 0;
  }

  /**
   * @param scared true while the viewer's shadow is big enough
   * @param courage how big the shadow is relative to what scares the wolf (0..1+)
   */
  update(dt: number, scared: boolean, courage = 0): WolfEvents {
    const ev = this.events;
    ev.growl = ev.whimper = ev.fled = ev.reared = ev.howl = false;
    this.stateTime += dt;
    // velocity follows each state's target speed smoothly
    const ease = (target: number, rate: number): void => {
      this.vx += (target - this.vx) * (1 - Math.exp(-rate * dt));
      this.x += this.vx * dt;
      this.phase += Math.abs(this.vx) * dt * 70;
    };
    const stalking = this.state === 'prowl' || this.state === 'sit';
    // it hesitates as your shadow nears the size that scares it (a resting hand is ~0.8 of it)
    // (its ears flatten and it slows from about two thirds of the way there)
    const h = stalking ? Math.min(1, Math.max(0, (courage - 0.62) / 0.33)) : this.state === 'cower' || this.state === 'rear' ? 1 : 0;
    this.hesitate += (h - this.hesitate) * (1 - Math.exp(-6 * dt));
    const targetCrouch =
      this.state === 'cower' ? 1 : this.state === 'rear' ? 0.55 : this.state === 'prowl' ? 0.45 : this.state === 'sit' || this.state === 'howl' || this.state === 'rest' ? 0.35 : 0;
    this.crouch += (targetCrouch - this.crouch) * (1 - Math.exp(-8 * dt));
    switch (this.state) {
      case 'away':
        return ev;
      case 'prowl':
      case 'sit':
      case 'cower': {
        if (this.x < this.exitX - 0.2) this.onStage = true;
        scared = scared && this.onStage;
        if (scared) this.fear = Math.min(1, this.fear + dt * 1.5);
        else this.fear = Math.max(0, this.fear - dt * 0.55);
        if (this.fear >= 1) {
          // the scare lands: rear back and hold it, then bolt
          this.setState('rear');
          ev.reared = true;
          return ev;
        }
        if (this.fear > 0.22) {
          if (this.state !== 'cower') {
            ev.whimper = true;
            this.setState('cower');
          }
          // backs away a little while cowering
          ease(0.04, 5);
          return ev;
        }
        if (this.state === 'cower' && this.fear < 0.08) this.setState('prowl');
        if (this.state === 'prowl') {
          this.dir = -1;
          // a slow stalk that hesitates as your shadow grows, slowing into its stop
          const left = Math.max(0, this.x - this.stopX);
          const pace = this.speed * (1 - 0.75 * this.hesitate);
          ease(-Math.min(pace, left * 1.1 + 0.003), 4);
          if (this.x <= this.stopX + 0.003) {
            this.x = Math.max(this.x, this.stopX);
            this.setState('sit');
          }
        } else {
          ease(0, 5);
        }
        this.growlTimer -= dt;
        if (this.growlTimer <= 0) {
          this.growlTimer = this.state === 'sit' ? 2.2 : 3.2;
          ev.growl = true;
        }
        return ev;
      }
      case 'rear':
        // held anticipation pose (the puppet rears up, ears flat)
        ease(0.05, 8);
        if (this.stateTime >= WOLF_REAR_TIME) {
          this.setState('flee');
          this.dir = 1;
          ev.fled = true;
        }
        return ev;
      case 'flee':
        ease(1.1, 7);
        // gone once even its tail has left the light
        if (this.x > this.exitX + 0.5) this.setState('away');
        return ev;
      case 'return': {
        // peeks back in and eases to a stop where it sits to sing
        const left = Math.max(0, this.x - this.singX);
        ease(-Math.min(0.32, left * 2.2 + 0.004), 5);
        if (this.x <= this.singX + 0.004) {
          this.x = Math.max(this.x, this.singX);
          this.setState('howl');
          ev.howl = true;
        }
        return ev;
      }
      case 'howl':
      case 'rest':
        ease(0, 6);
        return ev;
    }
    return ev;
  }
}
