/**
 * Visual check shots (clean emulator UI): a wall stage with a hand shadow, the
 * paper scroll, and a close look at the lantern.
 *   node e2e/look.mjs [prefix]
 */
import { launch, openApp, enterXR, remote, setHand, shot, waitFor } from './lib.mjs';

const prefix = process.argv[2] ?? 'look';

async function clean(page) {
  await page.evaluate(() => {
    for (const el of [...document.body.children]) {
      if (el.id === 'scene-container' || el.id === 'landing' || el.tagName === 'SCRIPT') continue;
      if (el.querySelector('canvas')) {
        for (const c of el.children) if (c.tagName !== 'CANVAS') c.style.visibility = 'hidden';
      } else el.style.display = 'none';
    }
    window.IWER_DEVICE.fovy = (62 * Math.PI) / 180;
  });
}

async function scene(page, room, yaw, name, { lookDown = false } = {}) {
  await openApp(page, { room });
  await enterXR(page);
  await clean(page);
  await remote(page, 'set_transform', { device: 'headset', position: { x: 0, y: 1.25, z: 0 }, orientation: { pitch: -4, yaw, roll: 0 } });
  await page.evaluate(() => window.__lantern.app.requestReplace());
  await remote(page, 'set_input_mode', { mode: 'hand' });
  await remote(page, 'set_connected', { device: 'hand-left', connected: false });
  await waitFor(page, `(s) => s.scene === 'intro' && s.beat !== 'dim'`, 30000);
  const rad = (yaw * Math.PI) / 180;
  const fx = -Math.sin(rad);
  const fz = -Math.cos(rad);
  await setHand(page, { x: fx * 0.42 + fz * -0.03, y: 1.06, z: fz * 0.42 - fx * -0.03, pose: 'open', yaw });
  await page.waitForTimeout(1800);
  await shot(page, `${prefix}-${name}`);
  if (lookDown) {
    await remote(page, 'set_transform', { device: 'headset', position: { x: 0, y: 1.25, z: 0 }, orientation: { pitch: -42, yaw: yaw + 14, roll: 0 } });
    await page.waitForTimeout(900);
    await shot(page, `${prefix}-${name}-lantern`);
  }
}

const { browser, page } = await launch({ width: 1280, height: 720 });
await scene(page, 'music_room', 90, 'wall', { lookDown: true });
await scene(page, 'living_room', 0, 'scroll');
await browser.close();
