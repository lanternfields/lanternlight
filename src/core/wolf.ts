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
          ev.fled = true;
          return ev;
        }
        if (this.fear > 0.22) {
          if (this.state !== 'cower') ev.whimper = true;
          this.state = 'cower';
          // backs away a little while cowering
          this.x = Math.min(0.95, this.x + dt * 0.03);
          return ev;
        }
        if (this.state === 'cower' && this.fear < 0.08) this.state = 'prowl';
        if (this.state === 'prowl') {
          this.dir = -1;
          this.x -= this.speed * dt;
          this.phase += dt * 7;
          if (this.x <= this.stopX) {
            this.x = this.stopX;
            this.state = 'sit';
          }
        }
        this.growlTimer -= dt;
        if (this.growlTimer <= 0) {
          this.growlTimer = this.state === 'sit' ? 2.2 : 3.5;
          ev.growl = true;
        }
        return ev;
      }
      case 'flee':
        this.x += dt * 0.6;
        this.phase += dt * 16;
        if (this.x > 1.05) this.state = 'away';
        return ev;
      case 'return':
        this.x -= dt * 0.09;
        this.phase += dt * 5;
        if (this.x <= 0.3) {
          this.x = 0.3;
          this.state = 'howl';
          ev.howl = true;
        }
        return ev;
      case 'howl':
        return ev;
    }
    return ev;
  }
}
