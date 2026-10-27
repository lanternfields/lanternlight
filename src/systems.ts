/**
 * ECS systems: thin, ordered entry points into the App.
 *  priority 0  InputCaptureSystem  - XRFrame -> hands/controllers/planes
 *  priority 10 ShowSystem          - placement, story, shadow stage, audio
 *  priority 40 HandVisualSystem    - real hands are visible through passthrough,
 *                                    so IWSDK's hand meshes are hidden on device
 *                                    (kept in the emulator for clarity).
 */
import { createSystem } from '@iwsdk/core';
import type { App } from './app.js';

let app: App | null = null;
export function bindApp(a: App): void {
  app = a;
}

export class InputCaptureSystem extends createSystem({}) {
  update(): void {
    app?.captureInput();
  }
}

export class ShowSystem extends createSystem({}) {
  update(delta: number, time: number): void {
    app?.step(delta, time);
  }
}

export class HandVisualSystem extends createSystem({}) {
  update(): void {
    if (!app) return;
    // In passthrough you see your real hands and controllers; the emulator and
    // the virtual theatre (no passthrough) need stand-ins (review M7).
    const show = (app.emulated || app.session.mode === 'vr') && app.phase !== 'landing';
    const adapters = this.input.xr.visualAdapters;
    for (const side of ['left', 'right'] as const) {
      const hand = adapters.hand[side].visual?.model;
      if (hand) hand.visible = show;
      const ctrl = adapters.controller[side].visual?.model;
      if (ctrl) ctrl.visible = show;
    }
  }
}
