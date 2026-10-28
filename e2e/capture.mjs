/**
 * Deterministic, frame-stepped capture of the REAL app in IWER.
 *
 * A virtual clock (capture/vclock.js) freezes requestAnimationFrame and time;
 * for every output frame we: let the director pose the emulated hand
 * (capture/director.js), advance the clock by exactly 1/60 s (the app, the
 * emulator and its room renderer each run one frame), screenshot, repeat.
 * Output is perfectly smooth 60 fps regardless of how slow software rendering
 * is. Nothing is composited or faked; the emulator's own UI is hidden.
 *
 *   node e2e/capture.mjs [room] [yaw] [name] [maxSeconds]
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { BASE, OUT, installPoses, setRoom } from './lib.mjs';

const room = process.argv[2] ?? 'music_room';
const yaw = Number(process.argv[3] ?? 90);
const name = process.argv[4] ?? 'capture';
const maxSeconds = Number(process.argv[5] ?? 240);
const choreo = process.argv[6] ?? 'coreLoop';
const FPS = 60;
const W = Number(process.env.CAPTURE_W ?? 1920);
const H = Number(process.env.CAPTURE_H ?? 1080);
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const framesDir = path.join(OUT, `${name}-frames`);
fs.rmSync(framesDir, { recursive: true, force: true });
fs.mkdirSync(framesDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required'],
});
const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: W, height: H } });
await context.addInitScript({ path: path.join(here, 'capture', 'vclock.js') });
const page = await context.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));

let n = 0;
const grab = async () => {
  const file = path.join(framesDir, String(n++).padStart(6, '0') + '.jpg');
  await page.screenshot({ path: file, type: 'jpeg', quality: 92 });
};

await page.goto(BASE + '?capture=1', { waitUntil: 'load', timeout: 120000 }); // recording look (emulator only)
await page.waitForFunction(() => !!window.__lantern && !!window.IWER_DEVICE, null, { timeout: 120000 });
await installPoses(page);
await setRoom(page, room);
await page.waitForTimeout(1500);
// 1.5 s on the landing page (static), then Begin.
await grab();
for (let i = 1; i < FPS * 1.5; i++) {
  fs.copyFileSync(path.join(framesDir, '000000.jpg'), path.join(framesDir, String(n++).padStart(6, '0') + '.jpg'));
}
await page.click('#begin');
await page.waitForFunction(() => window.__lantern.snapshot().phase !== 'landing', null, { timeout: 60000 });
await page.evaluate(
  ({ yaw }) => {
    for (const el of [...document.body.children]) {
      if (el.id === 'scene-container' || el.id === 'landing' || el.tagName === 'SCRIPT') continue;
      if (el.querySelector('canvas')) {
        for (const c of el.children) if (c.tagName !== 'CANVAS') c.style.visibility = 'hidden';
      } else el.style.display = 'none';
    }
    const d = window.IWER_DEVICE;
    d.fovy = (50 * Math.PI) / 180; // frame the stage: the show fills the shot
    d.position.x = 0;
    d.position.y = 1.25;
    d.position.z = 0;
    // seated, facing `yaw`, eyes slightly down
    const r = Math.PI / 180;
    const a = -4 * r;
    const s = yaw * r;
    const l = Math.cos(0.5 * a), c = Math.sin(0.5 * a), u = Math.cos(0.5 * s), dd = Math.sin(0.5 * s);
    d.quaternion.w = l * u;
    d.quaternion.x = c * u;
    d.quaternion.y = l * dd;
    d.quaternion.z = -c * dd;
    d.remote.dispatch('set_input_mode', { mode: 'hand' });
    d.remote.dispatch('set_connected', { device: 'hand-left', connected: false });
  },
  { yaw },
);
await page.waitForTimeout(800);
await page.evaluate(() => {
  window.__lantern.app.requestReplace();
  window.__lantern.goto('intro'); // restart the prologue from the dimming
});
await page.addScriptTag({ path: path.join(here, 'capture', 'director.js') });
await page.waitForTimeout(400);
await page.evaluate((c) => {
  window.__director.start(c);
  window.__vclock.enable();
}, choreo);

const t0 = Date.now();
let last = { done: false, t: 0 };
while (!last.done && last.t < maxSeconds) {
  last = await page.evaluate((fps) => {
    const r = window.__director.tick(1 / fps);
    window.__vclock.step(1000 / fps);
    return r;
  }, FPS);
  await grab();
  if (n % 600 === 0) console.log('FRAME', n, 't', last.t.toFixed(1), last.scene, last.beat, `${((Date.now() - t0) / 1000).toFixed(0)}s real`);
}
const marks = await page.evaluate(() => window.__director.marks);
await browser.close();
fs.writeFileSync(path.join(OUT, `${name}.marks.json`), JSON.stringify({ fps: FPS, landingSeconds: 1.5, marks }, null, 2));
const mp4 = path.join(OUT, `${name}.mp4`);
const ff = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(framesDir, '%06d.jpg'), '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4], { encoding: 'utf8' });
if (ff.status !== 0) console.log('ffmpeg failed', ff.stderr);
console.log('VIDEO', mp4, 'frames', n, 'seconds', (n / FPS).toFixed(1), 'real', ((Date.now() - t0) / 1000).toFixed(0) + 's');
