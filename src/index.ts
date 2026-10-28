/**
 * Lanternlight - a hand-shadow theatre for your room.
 * Entry point: creates the IWSDK World (mixed reality, hand tracking, plane
 * detection), the App, its systems, and the landing page controls.
 */
import '@fontsource/eb-garamond/latin-400.css';
import '@fontsource/eb-garamond/latin-400-italic.css';
import '@fontsource/eb-garamond/latin-500.css';
import { SessionMode, World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { App, BUILD } from './app.js';
import { HandVisualSystem, InputCaptureSystem, ShowSystem, bindApp } from './systems.js';
import type { SceneId } from './core/story.js';

declare global {
  interface Window {
    __lantern?: {
      app: App;
      snapshot: () => Record<string, unknown>;
      goto: (scene: SceneId) => void;
      begin: () => void;
      settings: (patch: Record<string, unknown>) => void;
    };
  }
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

World.create($('scene-container') as HTMLDivElement, projectOptions)
  .then(start)
  .catch((err) => {
    console.error('[lanternlight] failed to start', err);
    const notice = document.getElementById('notice');
    if (notice) notice.textContent = 'Lanternlight could not load in this browser. Please open it in the Meta Quest Browser.';
  });

async function start(world: World): Promise<void> {
  const params = new URLSearchParams(location.search);
  const tester = params.has('tester');
  const app = new App(world, { tester });
  $('build').textContent = BUILD + (tester ? ' · tester mode' : '');
  bindApp(app);
  world
    .registerSystem(InputCaptureSystem, { priority: 0 })
    .registerSystem(ShowSystem, { priority: 10 })
    .registerSystem(HandVisualSystem, { priority: 40 });

  const begin = $<HTMLButtonElement>('begin');
  const notice = $('notice');
  const landing = $('landing');

  // Reflect saved settings in the landing controls.
  const s = app.settings;
  $<HTMLInputElement>('opt-gentle').checked = s.gentle;
  $<HTMLInputElement>('opt-captions').checked = s.captions;
  $<HTMLInputElement>('opt-motion').checked = s.reduceMotion;
  $<HTMLInputElement>('opt-contrast').checked = s.highContrast;
  $<HTMLInputElement>('opt-dim').value = String(Math.round(s.dimLevel * 100));
  $<HTMLInputElement>('opt-left').checked = s.dominant === 'left';
  $('opts').addEventListener('change', () => {
    app.updateSettings({
      gentle: $<HTMLInputElement>('opt-gentle').checked,
      captions: $<HTMLInputElement>('opt-captions').checked,
      reduceMotion: $<HTMLInputElement>('opt-motion').checked,
      highContrast: $<HTMLInputElement>('opt-contrast').checked,
      dimLevel: Number($<HTMLInputElement>('opt-dim').value) / 100,
      dominant: $<HTMLInputElement>('opt-left').checked ? 'left' : 'right',
    });
  });

  let vrFallback = params.has('vr');
  const startXR = async () => {
    app.audio.start(); // inside the user gesture so audio may play
    notice.textContent = '';
    try {
      await Promise.resolve(world.launchXR(vrFallback ? { sessionMode: SessionMode.ImmersiveVR } : undefined));
    } catch (err) {
      console.warn('[lanternlight] could not start XR', err);
      notice.textContent =
        "The show couldn't start. Check that the headset's browser allows immersive mode, then press Begin again.";
    }
  };
  begin.addEventListener('click', startXR);

  const supports = async (mode: SessionMode) => {
    try {
      return !!navigator.xr && (await navigator.xr.isSessionSupported(mode));
    } catch {
      return false;
    }
  };
  const ar = await supports(SessionMode.ImmersiveAR);
  const vr = !ar && (await supports(SessionMode.ImmersiveVR));
  if (ar) {
    begin.disabled = false;
    begin.textContent = 'Begin';
  } else if (vr) {
    // No passthrough here (older headset or browser): play in a virtual theatre.
    vrFallback = true;
    begin.disabled = false;
    begin.textContent = 'Begin (virtual theatre)';
    notice.textContent = 'Mixed reality is not available on this device, so the show runs in a cosy virtual theatre.';
  } else {
    begin.textContent = 'Open on Meta Quest';
    notice.textContent = 'Lanternlight is a mixed reality experience. Open this page in the Meta Quest Browser.';
  }

  world.visibilityState.subscribe(() => {
    landing.classList.toggle('hidden', app.phase !== 'landing');
  });
  // The App moves out of 'landing' on the first visible XR frame.
  const poll = () => {
    landing.classList.toggle('hidden', app.phase !== 'landing');
    requestAnimationFrame(poll);
  };
  poll();

  window.__lantern = {
    app,
    snapshot: () => app.snapshot(),
    goto: (scene) => app.goto(scene),
    begin: startXR,
    settings: (patch) => app.updateSettings(patch as never),
  };
}
