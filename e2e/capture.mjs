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
import { BASE, OUT, aimAtStage, installPoses, setRoom } from './lib.mjs';

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
await page.evaluate(() => window.__lantern.app.requestReplace());
// recording framing: the stage fills ~70% of the frame height (captures only)
console.log('AIM', JSON.stringify(await aimAtStage(page)));
// The three camera poses of a recording, all looking at the same live scene:
// close (the stage), wide (lantern, hand and wall: proves the chain), and a
// side view of the hand for the picture-in-picture inset. The viewer's pose
// is locked first, so moving the camera never changes the show.
await page.evaluate(() => {
  const app = window.__lantern.app;
  app.lockCaptureHead();
  const d = window.IWER_DEVICE;
  const fr = app.placement.frame;
  const H = fr.height;
  const head = { x: d.position.x, y: d.position.y, z: d.position.z };
  const look = (pos, target, fovDeg) => {
    const dx = target.x - pos.x;
    const dy = target.y - pos.y;
    const dz = target.z - pos.z;
    const yaw = Math.atan2(-dx, -dz);
    const pitch = Math.atan2(dy, Math.hypot(dx, dz));
    const l = Math.cos(0.5 * pitch), c = Math.sin(0.5 * pitch), u = Math.cos(0.5 * yaw), sn = Math.sin(0.5 * yaw);
    return { pos, q: { w: l * u, x: c * u, y: l * sn, z: -c * sn }, fovy: (fovDeg * Math.PI) / 180 };
  };
  const add = (a, v, k) => ({ x: a.x + v.x * k, y: a.y + v.y * k, z: a.z + v.z * k });
  const lp = app.lanternPlacement ? app.lanternPlacement.position : { x: head.x, y: head.y - 0.4, z: head.z - 0.3 };
  const centre = add(fr.origin, fr.up, -0.1 * H);
  const up = { x: 0, y: 1, z: 0 };
  // wide: over the viewer's shoulder, the lantern and the hand in the foreground, the wall beyond
  let wpos = add(head, fr.normal, 0.62);
  wpos = add(wpos, up, 0.26);
  wpos = add(wpos, fr.right, 0.34);
  const wtarget = { x: centre.x * 0.62 + lp.x * 0.38, y: centre.y * 0.62 + lp.y * 0.38, z: centre.z * 0.62 + lp.z * 0.38 };
  // inset: a three-quarter view from the wall side and the viewer's right, so the
  // open palm faces the camera and "back toward you" reads as moving away from it
  let ipos = add(head, fr.right, 0.5);
  ipos = add(ipos, fr.normal, -0.92);
  ipos = add(ipos, up, -0.08);
  let itarget = add(head, fr.normal, -0.36);
  itarget = add(itarget, up, -0.2);
  window.__shots = {
    close: { pos: { ...head }, q: { w: d.quaternion.w, x: d.quaternion.x, y: d.quaternion.y, z: d.quaternion.z }, fovy: d.fovy },
    wide: look(wpos, wtarget, 60),
    inset: look(ipos, itarget, 44),
  };
  // The inset is framed tight on the hand and the lantern each frame (the
  // critic: the hand read as a tiny lump): from the wall side, a little to the
  // right and above, so the hand shows the same profile its shadow does.
  const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
  const len = (v) => Math.hypot(v.x, v.y, v.z) || 1;
  let dir = add(add(add({ x: 0, y: 0, z: 0 }, fr.normal, -0.78), fr.right, 0.48), up, 0.22);
  const dl = len(dir);
  dir = { x: dir.x / dl, y: dir.y / dl, z: dir.z / dl };
  const insetFov = 30;
  let smooth = null;
  window.__insetShot = (fresh) => {
    if (fresh) smooth = null;
    const hp = window.IWER_DEVICE.hands.right.position;
    const lantern = app.lantern.group.position;
    const h = { x: hp.x, y: hp.y + 0.03, z: hp.z };
    // the hand is the subject: two thirds hand, one third lantern
    const target = { x: h.x * 0.68 + lantern.x * 0.32, y: h.y * 0.68 + lantern.y * 0.32, z: h.z * 0.68 + lantern.z * 0.32 };
    const span = len(sub(h, lantern)) + 0.2;
    const dist = Math.max(0.32, Math.min(0.85, (span / (2 * Math.tan((insetFov * Math.PI) / 360))) * 0.62));
    // eased, so the inset camera glides rather than jitters with the hand
    if (!smooth) smooth = { ...target, dist };
    const k = 0.12;
    smooth.x += (target.x - smooth.x) * k;
    smooth.y += (target.y - smooth.y) * k;
    smooth.z += (target.z - smooth.z) * k;
    smooth.dist += (dist - smooth.dist) * k;
    const pos = add(smooth, dir, smooth.dist);
    return look(pos, smooth, insetFov);
  };
  const slerp = (a, b, t) => {
    let cos = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
    let bb = b;
    if (cos < 0) {
      cos = -cos;
      bb = { x: -b.x, y: -b.y, z: -b.z, w: -b.w };
    }
    let k0 = 1 - t;
    let k1 = t;
    if (cos < 0.9995) {
      const th = Math.acos(cos);
      const sn = Math.sin(th);
      k0 = Math.sin((1 - t) * th) / sn;
      k1 = Math.sin(t * th) / sn;
    }
    return { x: a.x * k0 + bb.x * k1, y: a.y * k0 + bb.y * k1, z: a.z * k0 + bb.z * k1, w: a.w * k0 + bb.w * k1 };
  };
  window.__setCamera = (a, b, t) => {
    const p = { x: a.pos.x + (b.pos.x - a.pos.x) * t, y: a.pos.y + (b.pos.y - a.pos.y) * t, z: a.pos.z + (b.pos.z - a.pos.z) * t };
    const q = slerp(a.q, b.q, t);
    d.position.x = p.x;
    d.position.y = p.y;
    d.position.z = p.z;
    d.quaternion.x = q.x;
    d.quaternion.y = q.y;
    d.quaternion.z = q.z;
    d.quaternion.w = q.w;
    d.fovy = a.fovy + (b.fovy - a.fovy) * t;
  };
});
await page.waitForTimeout(300);
await page.evaluate(() => window.__lantern.goto('intro')); // restart the prologue from the dimming
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
const insetsDir = path.join(OUT, `${name}-insets`);
fs.rmSync(insetsDir, { recursive: true, force: true });
fs.mkdirSync(insetsDir, { recursive: true });
const insetAlpha = {};
const insetRibbon = {};
const ribbonLog = [];
let prevInset = false;
while (!last.done && last.t < maxSeconds) {
  last = await page.evaluate((fps) => {
    const r = window.__director.tick(1 / fps);
    const app = window.__lantern.app;
    const sh = window.__shots;
    // the camera for this frame: close <-> wide (eased by the director)
    const w = r.shot ? r.shot.wide : 0;
    window.__setCamera(sh.close, sh.wide, w);
    app.captureShot = w > 0.02 ? 'wide' : 'close';
    // the stand-in hands dissolve away well before the camera reaches the stage close-up
    const sf = Math.max(0, Math.min(1, (w - 0.45) / 0.35));
    app.standInFade = sf * sf * (3 - 2 * sf);
    window.__vclock.step(1000 / fps);
    r.audio = [app.story.view.flame, app.lastMusic, app.story.events.map((e) => [e.type, e.s, e.t, e.value]), app.audio.ambience];
    const rb = app.ribbonStats;
    r.ribbon = [rb.line, +rb.opacity.toFixed(4), +rb.story.toFixed(5), +rb.hands.toFixed(5), app.captureShot];
    r.ribbonBox = [+app.banner.contentW.toFixed(4), +app.banner.contentH.toFixed(4)];
    return r;
  }, FPS);
  ribbonLog.push([n / FPS, ...last.ribbon]);
  audioLog.push([n / FPS, last.audio[0], last.audio[1], last.audio[2], last.audio[3]]);
  const frameIndex = n;
  await grab();
  const insetNow = !!(last.shot && last.shot.inset > 0.01);
  if (insetNow) {
    // the inset: the same instant from the side (a zero-length frame: nothing advances)
    await page.evaluate((fresh) => {
      const app = window.__lantern.app;
      app.captureShot = 'inset';
      app.standInFade = 1;
      const ins = window.__insetShot(fresh);
      window.__setCamera(ins, ins, 0);
      window.__vclock.step(0);
    }, !prevInset);
    await page.screenshot({ path: path.join(insetsDir, String(frameIndex).padStart(6, '0') + '.jpg'), type: 'jpeg', quality: 90 });
    insetAlpha[frameIndex] = +last.shot.inset.toFixed(3);
    // the ribbon's size (stage units) and the camera blend, so the inset keeps clear of it
    if (last.ribbon[1] > 0.01) insetRibbon[frameIndex] = [last.ribbonBox[0], last.ribbonBox[1], +last.shot.wide.toFixed(3)];
  }
  prevInset = insetNow;
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
      for (const [t, flame, music, evs, amb] of frames) {
        eng.clock = t;
        eng.ambience = amb || '';
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
// ---- legibility proof: every storyteller line, fully opaque for its whole hold?
{
  const runs = [];
  let cur = null;
  for (const [t, line, op, story, hands, shot] of ribbonLog) {
    if (!line || op <= 0.001) {
      if (cur) runs.push(cur);
      cur = null;
      continue;
    }
    if (!cur || cur.line !== line) {
      if (cur) runs.push(cur);
      cur = { line, start: t, full: -1, leave: -1, end: t, dips: 0, minHeld: 1, story: 0, hands: 0, shots: new Set() };
    }
    cur.end = t;
    if (op >= 0.999) {
      if (cur.full < 0) cur.full = t;
      else if (cur.leave >= 0 && cur.leave < t - 1.5 / FPS) cur.dips++;
      cur.leave = t;
    }
    if (cur.full >= 0) cur.story = Math.max(cur.story, story);
    cur.hands = Math.max(cur.hands, hands);
    cur.shots.add(shot);
  }
  if (cur) runs.push(cur);
  // within the hold (fully up .. starts to leave), the opacity never dips
  for (const r of runs) {
    r.held = r.full >= 0 && r.leave >= 0 ? +(r.leave - r.full).toFixed(2) : 0;
    r.shots = [...r.shots];
    for (const k of ['start', 'full', 'leave', 'end']) r[k] = +(+r[k]).toFixed(2);
  }
  // (a short beat such as III1a, "The moon is up.", holds ~1.5 s; every other line ~3.2 s)
  const ok = runs.every((r) => r.full >= 0 && r.dips === 0 && r.story === 0 && r.held >= 1.4);
  fs.writeFileSync(path.join(OUT, `${name}.legibility.json`), JSON.stringify({ ok, rule: 'each line reaches full opacity, is held at least 1.4 s, never dips while held, and no story character or the moon lies under it', lines: runs }, null, 2));
  console.log('LEGIBILITY', ok ? 'OK' : 'FAIL', runs.length, 'lines', runs.filter((r) => r.dips || r.story).map((r) => r.line).join(' | '));
}
fs.writeFileSync(path.join(OUT, `${name}.marks.json`), JSON.stringify({ fps: FPS, landingSeconds: 1.5, marks }, null, 2));
// picture-in-picture: composite the hand insets onto their frames
if (Object.keys(insetAlpha).length) {
  fs.writeFileSync(path.join(insetsDir, 'alpha.json'), JSON.stringify(insetAlpha));
  fs.writeFileSync(path.join(insetsDir, 'ribbon.json'), JSON.stringify(insetRibbon));
  const ins = spawnSync('python', ['-I', path.join(here, 'tools', 'inset_composite.py'), framesDir, insetsDir], { encoding: 'utf8' });
  console.log('INSETS', Object.keys(insetAlpha).length, ins.status === 0 ? 'composited' : 'FAILED ' + ins.stderr);
}
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
