/**
 * Demo capture: the REAL app running in IWER, driven by scripted emulated
 * hands, recorded to video (Playwright screen recording -> ffmpeg mp4).
 * Emulator UI chrome is hidden for clean footage; nothing is faked.
 *
 *   node e2e/demo-capture.mjs [room] [yaw] [out-name]
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { BASE, OUT, installPoses, setRoom, remote, setHand, moveHand, snap, waitFor } from './lib.mjs';
import { steer } from './steer.mjs';

const room = process.argv[2] ?? 'music_room';
const yaw = Number(process.argv[3] ?? 90);
const name = process.argv[4] ?? `demo-${room}`;
const W = 1280;
const H = 720;
const vidDir = path.join(OUT, 'video-tmp');
fs.rmSync(vidDir, { recursive: true, force: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required'],
});
const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: W, height: H }, recordVideo: { dir: vidDir, size: { width: W, height: H } } });
const page = await context.newPage();
const marks = [];
const t0 = Date.now();
const mark = (label) => {
  marks.push({ label, t: +((Date.now() - t0) / 1000).toFixed(2) });
  console.log('MARK', label, marks.at(-1).t);
};

try {
  await page.goto(BASE + '?demo=1', { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => !!window.__lantern && !!window.IWER_DEVICE, null, { timeout: 120000 });
  await installPoses(page);
  await setRoom(page, room);
  mark('landing');
  await page.waitForTimeout(1500);
  await page.click('#begin');
  await page.waitForFunction(() => window.__lantern.snapshot().phase === 'show', null, { timeout: 60000 });
  // Clean footage: hide the emulator's developer UI (toolbar, panels, badges).
  await page.evaluate(() => {
    for (const el of [...document.body.children]) {
      if (el.id === 'scene-container' || el.id === 'landing' || el.tagName === 'SCRIPT') continue;
      if (el.querySelector('canvas')) {
        for (const c of el.children) if (c.tagName !== 'CANVAS') c.style.visibility = 'hidden';
      } else {
        el.style.display = 'none';
      }
    }
  });
  await remote(page, 'set_transform', { device: 'headset', position: { x: 0, y: 1.25, z: 0 }, orientation: { pitch: -4, yaw, roll: 0 } });
  await page.evaluate(() => window.__lantern.app.requestReplace());
  await remote(page, 'set_input_mode', { mode: 'hand' });
  await remote(page, 'set_connected', { device: 'hand-left', connected: false });
  // A slightly narrower camera for footage (the emulator's default is very wide).
  await page.evaluate(() => {
    try {
      window.IWER_DEVICE.fovy = (62 * Math.PI) / 180;
    } catch {
      /* ignore */
    }
  });
  const rad = (yaw * Math.PI) / 180;
  const fx = -Math.sin(rad);
  const fz = -Math.cos(rad);
  const at = (fwd, side, y) => ({ x: fx * fwd - fz * side, y, z: fz * fwd + fx * side });
  // Hand rests low, out of the light.
  await setHand(page, { ...at(0.25, 0.25, 0.75), yaw, pose: 'relaxed' });
  mark('entered');
  await waitFor(page, `(s) => s.beat === 'wave'`, 30000);
  await page.waitForTimeout(2500);
  mark('ghost-wave');
  // Raise the hand slowly into the light.
  const hand0 = { device: 'hand-right', ...at(0.25, 0.25, 0.75), yaw, pitch: 0, roll: 0, pose: 'relaxed' };
  const handUp = { device: 'hand-right', ...at(0.42, 0.03, 1.08), yaw, pitch: 0, roll: 0, pose: 'open' };
  await moveHand(page, hand0, handUp, 2.2, 26);
  mark('shadow');
  await page.waitForTimeout(1200);
  // A little wave.
  for (let i = 0; i < 2; i++) {
    await moveHand(page, handUp, { ...handUp, roll: 18 }, 0.5, 6);
    await moveHand(page, { ...handUp, roll: 18 }, { ...handUp, roll: -14 }, 0.6, 7);
  }
  await moveHand(page, { ...handUp, roll: -14 }, handUp, 0.4, 5);
  await waitFor(page, `(s) => s.beat === 'rabbitHint'`, 20000);
  await page.waitForTimeout(1800);
  mark('rabbit-hint');
  await setHand(page, { ...handUp, pose: 'peace' });
  await waitFor(page, `(s) => s.stats.rabbitBirths >= 1`, 15000);
  mark('rabbit-born');
  await page.waitForTimeout(2200);
  await moveHand(page, { ...handUp, pose: 'peace' }, { ...hand0, pose: 'relaxed' }, 1.4, 16);
  await waitFor(page, `(s) => s.scene === 'menu'`, 30000);
  await page.waitForTimeout(2500);
  mark('menu');
  // Touch the crocodile lantern with the shadow.
  let s = await snap(page);
  const croc = s.view.icons.find((i) => i.id === 'croc');
  await moveHand(page, hand0, handUp, 1.2, 14);
  const r = await steer(page, handUp, [croc.s, croc.t], { settle: 120 });
  await waitFor(page, `(s) => s.scene === 'croc'`, 30000);
  mark('croc');
  await page.waitForTimeout(1500);
  let hand = { ...r.hand, pose: 'relaxed', roll: -70 };
  const crocStart = Date.now();
  while (Date.now() - crocStart < 90000) {
    s = await snap(page);
    if (s.scene !== 'croc' || s.stats.eaten >= 7) break;
    const ff = s.view.fireflies[0];
    if (!ff) {
      await page.waitForTimeout(300);
      continue;
    }
    await remote(page, 'set_select_value', { device: 'hand-right', value: 0 });
    const res = await steer(page, hand, ff, { which: 'mouth', iterations: 5, tolerance: 0.04, settle: 120 });
    hand = res.hand;
    await page.waitForTimeout(400);
    await remote(page, 'set_select_value', { device: 'hand-right', value: 1 });
    await page.waitForTimeout(450);
    await remote(page, 'set_select_value', { device: 'hand-right', value: 0 });
    await page.waitForTimeout(200);
  }
  mark('croc-fed');
  await page.waitForTimeout(3500);
  await moveHand(page, hand, { ...hand0, pose: 'relaxed' }, 1.2, 12);
  await waitFor(page, `(s) => s.scene === 'menu'`, 30000);
  await page.waitForTimeout(1500);
  s = await snap(page);
  const bridge = s.view.icons.find((i) => i.id === 'bridge');
  await moveHand(page, hand0, handUp, 1.0, 12);
  await steer(page, handUp, [bridge.s, bridge.t], { settle: 120 });
  await waitFor(page, `(s) => s.scene === 'bridge'`, 30000);
  mark('bridge');
  await page.waitForTimeout(3500); // the rabbit waits at the edge, the hint appears
  let bar = { device: 'hand-right', ...at(0.42, 0.0, 1.0), pose: 'flat', pitch: -30, yaw: yaw + 90, roll: 0 };
  await moveHand(page, { ...hand0, pose: 'flat' }, bar, 1.4, 16);
  const res = await steer(page, bar, [0.0, -0.37], { which: 'handTop', iterations: 8, tolerance: 0.012, settle: 120 });
  bar = res.hand;
  await waitFor(page, `(s) => s.stats.crossings >= 1`, 60000);
  mark('rabbit-home');
  await page.waitForTimeout(3000);
  mark('end');
} catch (e) {
  console.log('ERROR', e.message);
  mark('error');
}
const video = page.video();
await context.close();
await browser.close();
const webm = await video.path();
const mp4 = path.join(OUT, name + '.mp4');
const ff = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', webm, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart', mp4], { encoding: 'utf8' });
if (ff.status !== 0) console.log('ffmpeg failed', ff.stderr);
fs.writeFileSync(path.join(OUT, name + '.marks.json'), JSON.stringify(marks, null, 2));
console.log('VIDEO', mp4);
