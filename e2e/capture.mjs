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
// The soundtrack: every frame's story sound events, flame and music level, at
// the frame's video time. Rendered offline afterwards by the app's own engine.
const audioLog = [];
while (!last.done && last.t < maxSeconds) {
  last = await page.evaluate((fps) => {
    const r = window.__director.tick(1 / fps);
    window.__vclock.step(1000 / fps);
    const app = window.__lantern.app;
    r.audio = [app.story.view.flame, app.lastMusic, app.story.events.map((e) => [e.type, e.s, e.t, e.value])];
    return r;
  }, FPS);
  audioLog.push([n / FPS, last.audio[0], last.audio[1], last.audio[2]]);
  await grab();
  if (n % 600 === 0) console.log('FRAME', n, 't', last.t.toFixed(1), last.scene, last.beat, `${((Date.now() - t0) / 1000).toFixed(0)}s real`);
}
const marks = await page.evaluate(() => window.__director.marks);

// ---- render the soundtrack offline (same procedural engine, exact sync)
let wavPath = null;
try {
  const total = n / FPS;
  const info = await page.evaluate(
    async ({ frames, total }) => {
      const app = window.__lantern.app;
      const Eng = app.audio.constructor;
      const sr = 48000;
      const ctx = new OfflineAudioContext(2, Math.ceil((total + 0.5) * sr), sr);
      const eng = new Eng();
      eng.volume = 0.85;
      for (const k of ['stagePos', 'stageRight', 'stageUp', 'lanternPos']) Object.assign(eng[k], app.audio[k]);
      eng.stageHeight = app.audio.stageHeight;
      eng.startOffline(ctx);
      const h = app.head;
      const f = app.headForward;
      const u = app.headUp;
      eng.setListener({ x: h.x, y: h.y, z: h.z }, { x: f.x, y: f.y, z: f.z }, { x: u.x, y: u.y, z: u.z });
      for (const [t, flame, music, evs] of frames) {
        eng.clock = t;
        eng.tick(1 / 60, flame, music);
        for (const e of evs) eng.play(e[0], e[1], e[2], e[3]);
      }
      const buf = await ctx.startRendering();
      const L = buf.getChannelData(0);
      const R = buf.getChannelData(1);
      const pcm = new Int16Array(L.length * 2);
      let peak = 0;
      for (let i = 0; i < L.length; i++) {
        const l = Math.max(-1, Math.min(1, L[i]));
        const r = Math.max(-1, Math.min(1, R[i]));
        peak = Math.max(peak, Math.abs(l), Math.abs(r));
        pcm[2 * i] = l * 32767;
        pcm[2 * i + 1] = r * 32767;
      }
      window.__pcm = new Uint8Array(pcm.buffer);
      return { bytes: window.__pcm.length, sr, peak, played: eng.played };
    },
    { frames: audioLog, total },
  );
  const chunks = [];
  const STEP = 3 * 1024 * 1024;
  for (let off = 0; off < info.bytes; off += STEP) {
    const b64 = await page.evaluate(
      ({ off, len }) => {
        const a = window.__pcm.subarray(off, off + len);
        let s = '';
        for (let k = 0; k < a.length; k += 0x8000) s += String.fromCharCode.apply(null, a.subarray(k, k + 0x8000));
        return btoa(s);
      },
      { off, len: STEP },
    );
    chunks.push(Buffer.from(b64, 'base64'));
  }
  const data = Buffer.concat(chunks);
  const hdr = Buffer.alloc(44);
  hdr.write('RIFF', 0);
  hdr.writeUInt32LE(36 + data.length, 4);
  hdr.write('WAVE', 8);
  hdr.write('fmt ', 12);
  hdr.writeUInt32LE(16, 16);
  hdr.writeUInt16LE(1, 20);
  hdr.writeUInt16LE(2, 22);
  hdr.writeUInt32LE(info.sr, 24);
  hdr.writeUInt32LE(info.sr * 4, 28);
  hdr.writeUInt16LE(4, 32);
  hdr.writeUInt16LE(16, 34);
  hdr.write('data', 36);
  hdr.writeUInt32LE(data.length, 40);
  wavPath = path.join(OUT, `${name}.wav`);
  fs.writeFileSync(wavPath, Buffer.concat([hdr, data]));
  console.log('AUDIO', wavPath, 'sounds', info.played, 'peak', info.peak.toFixed(3));
} catch (e) {
  console.log('AUDIO failed', e.message);
}
await browser.close();
fs.writeFileSync(path.join(OUT, `${name}.marks.json`), JSON.stringify({ fps: FPS, landingSeconds: 1.5, marks }, null, 2));
const mp4 = path.join(OUT, `${name}.mp4`);
const ff = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(framesDir, '%06d.jpg'), '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4], { encoding: 'utf8' });
if (ff.status !== 0) console.log('ffmpeg failed', ff.stderr);
if (wavPath) {
  // mux the soundtrack onto the frames
  const silent = mp4.replace(/\.mp4$/, '-silent.mp4');
  fs.renameSync(mp4, silent);
  const mx = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', silent, '-i', wavPath, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-ar', '48000', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', mp4], { encoding: 'utf8' });
  if (mx.status !== 0) console.log('mux failed', mx.stderr);
}
console.log('VIDEO', mp4, 'frames', n, 'seconds', (n / FPS).toFixed(1), 'real', ((Date.now() - t0) / 1000).toFixed(0) + 's');
