/**
 * Style-audit stills (STYLE_GUIDE.md): frame-steps the REAL app in IWER with
 * the capture director's `stills` choreography and saves a PNG at each snap:
 * prologue (ghost hints, the rabbit), menu, the first 3 seconds of each tale
 * (0.5 / 1.5 / 3.0 s), a chomp, the bridge, the wolf, the curtain call; then
 * close-ups of the lantern and the tester card, and a labelled contact sheet.
 *
 *   node e2e/style-stills.mjs <label> [room] [yaw]
 *   LANTERN_URL=https://localhost:8082/ node e2e/style-stills.mjs before
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { BASE, OUT, installPoses, setRoom } from './lib.mjs';

const label = process.argv[2] ?? 'after';
const room = process.argv[3] ?? 'music_room';
const yaw = Number(process.argv[4] ?? 90);
const choreo = process.argv[5] ?? 'stills';
const W = Number(process.env.STILLS_W ?? 1920);
const H = Number(process.env.STILLS_H ?? 1080);
const FPS = 60;
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const dir = path.join(OUT, 'style', label);
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-certificate-errors'],
});
const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: W, height: H } });
await context.addInitScript({ path: path.join(here, 'capture', 'vclock.js') });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

await page.goto(BASE + (process.env.STILLS_QUERY ?? '?tester=1&capture=1'), { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => !!window.__lantern && !!window.IWER_DEVICE, null, { timeout: 120000 });
await installPoses(page);
await setRoom(page, room);
await page.waitForTimeout(1500);
await page.screenshot({ path: path.join(dir, '00-landing.png') });
await page.click('#begin');
await page.waitForFunction(() => window.__lantern.snapshot().phase !== 'landing', null, { timeout: 60000 });

const setHead = async (pos, pitchDeg, yawDeg) =>
  page.evaluate(
    ({ pos, pitchDeg, yawDeg }) => {
      const d = window.IWER_DEVICE;
      d.position.x = pos[0];
      d.position.y = pos[1];
      d.position.z = pos[2];
      const r = Math.PI / 180;
      const a = pitchDeg * r;
      const s = yawDeg * r;
      const l = Math.cos(0.5 * a), c = Math.sin(0.5 * a), u = Math.cos(0.5 * s), dd = Math.sin(0.5 * s);
      d.quaternion.w = l * u;
      d.quaternion.x = c * u;
      d.quaternion.y = l * dd;
      d.quaternion.z = -c * dd;
    },
    { pos, pitchDeg, yawDeg },
  );

await page.evaluate(() => {
  for (const el of [...document.body.children]) {
    if (el.id === 'scene-container' || el.id === 'landing' || el.tagName === 'SCRIPT') continue;
    if (el.querySelector('canvas')) {
      for (const c of el.children) if (c.tagName !== 'CANVAS') c.style.visibility = 'hidden';
    } else el.style.display = 'none';
  }
  const d = window.IWER_DEVICE;
  d.fovy = ((Number(window.__FOVY) || 50) * Math.PI) / 180;
  d.remote.dispatch('set_input_mode', { mode: 'hand' });
  d.remote.dispatch('set_connected', { device: 'hand-left', connected: false });
  window.__lantern.app.hud.enabled = false;
});
await setHead([0, 1.25, 0], -4, yaw);
await page.waitForTimeout(800);
await page.evaluate(() => {
  window.__lantern.app.requestReplace();
  window.__lantern.goto('intro');
});
// (tuning: CROC_ORIENT="pitch,yaw,roll" overrides the crocodile's hand orientation)
if (process.env.CROC_ORIENT) await page.evaluate((o) => (window.__CROC_ORIENT = o.split(',').map(Number)), process.env.CROC_ORIENT);
if (process.env.CROC_TUNE) await page.evaluate((o) => (window.__CROC_TUNE = o.split(';').map((t) => t.split(',').map(Number))), process.env.CROC_TUNE);
await page.addScriptTag({ path: path.join(here, 'capture', 'director.js') });
await page.waitForTimeout(400);
await page.evaluate((c) => {
  window.__director.start(c);
  window.__vclock.enable();
}, choreo);

const shots = [];
const motion = [];
const t0 = Date.now();
let r = { done: false, t: 0 };
while (!r.done && r.t < 200) {
  r = await page.evaluate((fps) => {
    const res = window.__director.tick(1 / fps);
    window.__vclock.step(1000 / fps);
    // per-frame motion samples (STYLE_GUIDE 4: prove there is no popping or jitter)
    const app = window.__lantern.app;
    const v = app.story.view;
    const a = app.model.actors[1];
    const ffi = v.fireflies.findIndex((f) => f.alive);
    const ff = ffi >= 0 ? v.fireflies[ffi] : null;
    const co = app.stage.debugCroc ? app.stage.debugCroc() : null;
    res.m = {
      t: res.t,
      scene: v.scene,
      fade: v.fade,
      rabbit: v.rabbit.visible > 0.5 ? [v.rabbit.x, v.rabbit.y, v.rabbit.squash] : null,
      wolf: v.wolf.visible > 0.5 ? [v.wolf.x, v.wolf.y] : null,
      firefly: ff ? [ff.x, ff.y] : null,
      fireflyId: ffi,
      hand: a.present ? [a.tipS, a.tipT] : null,
      croc: co,
      ghost: v.ghost.visible,
      icon: v.icons[0].visible,
      title: v.title.id ? v.title.t : -1,
    };
    return res;
  }, FPS);
  motion.push(r.m);
  if (r.snap) {
    const file = path.join(dir, `${String(shots.length + 1).padStart(2, '0')}-${r.snap}.png`);
    await page.screenshot({ path: file });
    shots.push({ name: r.snap, file, t: +r.t.toFixed(2), scene: r.scene, beat: r.beat });
    console.log('SNAP', r.snap, r.t.toFixed(1), `${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
}

// Close-ups: the lantern, then the tester card beside it.
const step = (n) => page.evaluate((n) => {
  for (let i = 0; i < n; i++) {
    window.__director.tick(1 / 60);
    window.__vclock.step(1000 / 60);
  }
}, n);
const lantern = await page.evaluate(() => {
  const app = window.__lantern.app;
  const p = app.lanternPlacement?.position ?? { x: 0, y: 0.8, z: -0.3 };
  return [p.x, p.y, p.z];
});
const look = async (target, dist, name) => {
  const from = [target[0] + 0.0, target[1] + dist * 0.55, target[2] + dist];
  // aim from a point in front of/above the target back at it
  const dx = target[0] - from[0];
  const dy = target[1] - from[1];
  const dz = target[2] - from[2];
  const yawDeg = (Math.atan2(-dx, -dz) * 180) / Math.PI;
  const pitchDeg = (Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI;
  await setHead(from, pitchDeg, yawDeg);
  await step(20);
  const file = path.join(dir, `${String(shots.length + 1).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file });
  shots.push({ name, file });
  console.log('SNAP', name);
};
await page.evaluate(() => window.__lantern.goto('menu'));
await step(90);
await look(lantern, 0.42, 'lantern-closeup');
await page.evaluate(() => {
  window.__lantern.app.hud.enabled = true;
});
await step(60);
const hud = await page.evaluate(() => {
  const m = window.__lantern.app.hud.mesh;
  m.updateMatrixWorld();
  const e = m.matrixWorld.elements;
  return [e[12], e[13], e[14]];
});
await look(hud, 0.3, 'tester-card');
await browser.close();

fs.writeFileSync(path.join(dir, 'shots.json'), JSON.stringify({ label, room, yaw, W, H, shots, errors }, null, 2));
fs.writeFileSync(path.join(dir, 'motion.json'), JSON.stringify({ fps: FPS, samples: motion }));
const mp = spawnSync('python', ['-I', path.join(here, 'tools', 'motion_plot.py'), path.join(dir, 'motion.json'), path.join(OUT, 'style', `${label}-motion`)], { encoding: 'utf8' });
console.log(mp.stdout.trim());
if (mp.status !== 0) console.log('motion plot failed', mp.stderr);
// Contact sheet (PIL): 4 columns, labelled.
const py = spawnSync('python', ['-I', path.join(here, 'tools', 'contact_sheet.py'), dir, path.join(OUT, 'style', `${label}-sheet.png`), '4'], { encoding: 'utf8' });
if (py.status !== 0) console.log('contact sheet failed', py.stderr);
console.log('STILLS', shots.length, 'errors', errors.length, path.join(OUT, 'style', `${label}-sheet.png`));
