/**
 * Shadow-quality stills: five hand poses on the paper scroll (no room scan,
 * clean emulator UI, narrow camera), for before/after comparisons.
 *   node e2e/pose-stills.mjs <label>
 * Writes artifacts/stills-<label>-<pose>.png and a 5-up strip.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { OUT, launch, openApp, enterXR, remote, setHand, shot, waitFor } from './lib.mjs';

const label = process.argv[2] ?? 'now';
const POSES = [
  { name: 'open', pose: 'open', pitch: 0, yaw: 0, roll: 0 },
  { name: 'rabbit', pose: 'peace', pitch: 0, yaw: 0, roll: 0 },
  { name: 'crocodile', pose: 'relaxed', pitch: 0, yaw: 0, roll: -70 },
  { name: 'fist', pose: 'fist', pitch: 0, yaw: 0, roll: 0 },
  { name: 'call', pose: 'call', pitch: 0, yaw: 0, roll: 0 },
];

const { browser, page } = await launch({ width: 900, height: 700 });
await openApp(page, { room: 'none' });
await enterXR(page);
await page.evaluate(() => {
  for (const el of [...document.body.children]) {
    if (el.id === 'scene-container' || el.id === 'landing' || el.tagName === 'SCRIPT') continue;
    if (el.querySelector('canvas')) {
      for (const c of el.children) if (c.tagName !== 'CANVAS') c.style.visibility = 'hidden';
    } else el.style.display = 'none';
  }
  window.IWER_DEVICE.fovy = (40 * Math.PI) / 180;
});
await remote(page, 'set_transform', { device: 'headset', position: { x: 0, y: 1.25, z: 0 }, orientation: { pitch: -6, yaw: 0, roll: 0 } });
await page.evaluate(() => window.__lantern.app.requestReplace());
await remote(page, 'set_input_mode', { mode: 'hand' });
await remote(page, 'set_connected', { device: 'hand-left', connected: false });
await waitFor(page, `(s) => s.scene === 'intro' && s.beat !== 'dim'`, 30000);
// an empty, lit stage: enter a tale with no hand in view, then hold the story still
await setHand(page, { device: 'hand-right', x: 0.3, y: 0.6, z: 0.1, pose: 'relaxed' });
await page.evaluate(() => window.__lantern.goto('croc'));
await page.waitForTimeout(300);
await page.evaluate(() => {
  const a = window.__lantern.app;
  a.freezeStory = true;
  a.story.view.ghost.visible = 0;
  a.story.view.caption = '';
  for (const f of a.story.view.fireflies) f.alive = false;
});
// fingers-up, palm-to-the-wall orientation: the one with the biggest open-hand silhouette
let bestO = { pitch: 0, yaw: 0, roll: 0, area: 0 };
for (const pitch of [-60, -30, 0, 30, 60, 90]) {
  for (const yaw of [-30, 0, 30]) {
    await setHand(page, { device: 'hand-right', x: 0.0, y: 1.04, z: -0.4, pose: 'open', pitch, yaw, roll: 0 });
    await page.waitForTimeout(120);
    const a = (await page.evaluate(() => window.__lantern.snapshot())).actors[1];
    if (!a.present) continue;
    const [x0, x1, y0, y1] = a.handBox;
    const area = (x1 - x0) * (y1 - y0);
    if (area > bestO.area) bestO = { pitch, yaw, roll: 0, area };
  }
}
console.log('ORIENTATION', JSON.stringify(bestO));
const files = [];
for (const p of POSES) {
  await setHand(page, { device: 'hand-right', x: 0.0, y: 1.04, z: -0.4, pose: p.pose, pitch: bestO.pitch + p.pitch, yaw: bestO.yaw + p.yaw, roll: p.roll });
  await page.waitForTimeout(900);
  files.push(await shot(page, `stills-${label}-${p.name}`));
}
await browser.close();
// 5-up strip (cropped to the stage area in the upper middle of the frame)
const args = ['-y', '-loglevel', 'error'];
for (const f of files) args.push('-i', f);
const crops = files.map((_, i) => `[${i}]crop=560:400:170:60[c${i}]`).join(';');
args.push('-filter_complex', `${crops};${files.map((_, i) => `[c${i}]`).join('')}hstack=inputs=${files.length}`, path.join(OUT, `stills-${label}-strip.png`));
spawnSync('ffmpeg', args, { stdio: 'inherit' });
console.log('STRIP', path.join(OUT, `stills-${label}-strip.png`));
