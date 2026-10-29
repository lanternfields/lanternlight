/**
 * Headless end-to-end harness: Playwright (headless Chromium shell, SwiftShader
 * WebGL) + IWER, the WebXR emulator that the IWSDK dev plugin injects on
 * localhost. Drives the real app with emulated hands/controllers through IWER's
 * remote-control API and reads app state from window.__lantern.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

export const BASE = process.env.LANTERN_URL ?? 'https://localhost:8081/';
export const OUT = path.resolve(process.env.LANTERN_OUT ?? 'artifacts');
fs.mkdirSync(OUT, { recursive: true });

export async function launch({ width = 1280, height = 800 } = {}) {
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required'],
  });
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width, height } });
  const page = await context.newPage();
  const logs = [];
  page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`PAGEERROR: ${e.message}`));
  return { browser, context, page, logs };
}

const POSES = JSON.parse(fs.readFileSync(new URL('./fixtures/iwer-poses.json', import.meta.url), 'utf8'));

export async function openApp(page, { query = '', room } = {}) {
  await page.goto(BASE + query, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => !!window.__lantern && !!window.IWER_DEVICE, null, { timeout: 120000 });
  await installPoses(page);
  if (room) await setRoom(page, room);
}

/**
 * The IWER build pinned by IWSDK 1.0.1 ships 3 hand poses; inject IWER 2.7's
 * captured-skeleton library (e2e/fixtures/iwer-poses.json) into both hands.
 */
export async function installPoses(page) {
  await page.evaluate((poses) => {
    for (const side of ['left', 'right']) {
      const h = window.IWER_DEVICE.hands[side];
      const sym = Object.getOwnPropertySymbols(h).find((s) => h[s] && h[s].poses);
      if (sym) Object.assign(h[sym].poses, poses);
    }
  }, POSES);
}

/** Loads one of IWER's captured rooms, or 'none' for no scene data. */
export async function setRoom(page, room) {
  await page.evaluate(async (room) => {
    const sem = window.IWER_DEVICE.sem;
    if (!sem) return;
    if (room === 'none') {
      sem.deleteAll();
      return;
    }
    await sem.loadDefaultEnvironment(room);
  }, room);
  await page.waitForTimeout(500);
}

export async function remote(page, method, params = {}) {
  return page.evaluate(
    async ({ method, params }) => {
      const r = window.IWER_DEVICE.remote;
      return r.dispatch(method, params);
    },
    { method, params },
  );
}

export async function enterXR(page) {
  await page.click('#begin');
  await page.waitForFunction(() => window.__lantern.snapshot().phase === 'show', null, { timeout: 60000 });
}

export async function snap(page) {
  return page.evaluate(() => window.__lantern.snapshot());
}

export async function waitFor(page, predicateSrc, timeout = 60000) {
  await page.waitForFunction(new Function('return (' + predicateSrc + ')(window.__lantern.snapshot())'), null, {
    timeout,
    polling: 100,
  });
}

export async function shot(page, name) {
  const file = path.join(OUT, name + '.png');
  await page.screenshot({ path: file });
  return file;
}

/** Places an emulated hand (target-ray origin) with a pose and orientation (deg). */
export async function setHand(page, { device = 'hand-right', x = 0.05, y = 1.42, z = -0.42, pose, pitch = 0, yaw = 0, roll = 0 } = {}) {
  if (pose) await remote(page, 'set_hand_pose', { device, poseId: pose });
  await remote(page, 'set_transform', { device, position: { x, y, z }, orientation: { pitch, yaw, roll } });
}

/** Smoothly moves a hand over `seconds` in `steps` frames (no remote animate in this IWER). */
export async function moveHand(page, from, to, seconds = 1, steps = 20) {
  for (let i = 1; i <= steps; i++) {
    const u = i / steps;
    const e = u * u * (3 - 2 * u);
    const p = {};
    for (const k of ['x', 'y', 'z', 'pitch', 'yaw', 'roll']) {
      const a = from[k] ?? 0;
      const b = to[k] ?? a;
      p[k] = a + (b - a) * e;
    }
    await setHand(page, { ...from, ...p, pose: i === 1 ? to.pose ?? from.pose : undefined });
    await page.waitForTimeout((seconds * 1000) / steps);
  }
}

export function writeJSON(name, data) {
  const file = path.join(OUT, name + '.json');
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  return file;
}

/**
 * Recording framing (captures only): once the stage is placed, aim the
 * emulated headset at the stage so the stage fills ~`fill` of the frame
 * height, with the storyteller's bands (above the light and under the
 * stage) still in frame. Never used for headset play.
 */
export async function aimAtStage(page, { fill = 0.67, centreT = -0.06 } = {}) {
  await page.waitForFunction(() => {
    const app = window.__lantern.app;
    return !!app.placement && !app.replacePending;
  }, null, { timeout: 20000 });
  return page.evaluate(
    ({ fill, centreT }) => {
      const app = window.__lantern.app;
      const fr = app.placement.frame;
      const d = window.IWER_DEVICE;
      const H = fr.height;
      const tx = fr.origin.x + fr.up.x * centreT * H;
      const ty = fr.origin.y + fr.up.y * centreT * H;
      const tz = fr.origin.z + fr.up.z * centreT * H;
      const dx = tx - d.position.x;
      const dy = ty - d.position.y;
      const dz = tz - d.position.z;
      const dist = Math.hypot(dx, dy, dz);
      const yaw = Math.atan2(-dx, -dz);
      const pitch = Math.atan2(dy, Math.hypot(dx, dz));
      const l = Math.cos(0.5 * pitch), c = Math.sin(0.5 * pitch), u = Math.cos(0.5 * yaw), s = Math.sin(0.5 * yaw);
      d.quaternion.w = l * u;
      d.quaternion.x = c * u;
      d.quaternion.y = l * s;
      d.quaternion.z = -c * s;
      // the stage (1 unit tall) should take `fill` of the frame height
      d.fovy = 2 * Math.atan((H / fill) / 2 / dist);
      return { dist: +dist.toFixed(2), fovyDeg: +((d.fovy * 180) / Math.PI).toFixed(1), pitchDeg: +((pitch * 180) / Math.PI).toFixed(1) };
    },
    { fill, centreT },
  );
}
