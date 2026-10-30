/**
 * Viewer's-eye stills that prove the placement behaviours a story capture in
 * one room can't show: a blocked wall's prompt, the turn nudge (before and
 * after turning), and the lantern standing on a real table.
 *
 * The seat is the sweep's (e2e/rooms.mjs): at the room's table or desk, else
 * the origin. Emulator UI is hidden, as in a capture.
 *
 *   node e2e/placement-stills.mjs     (writes artifacts/placement-*.png)
 */
import { launch, openApp, enterXR, snap, shot, remote, setHand } from './lib.mjs';

const CASES = [
  { name: 'placement-1-blocked-window', room: 'office_small', yaw: 95 },
  { name: 'placement-2-turn-nudge', room: 'office_small', yaw: 0, turn: true },
  // hand down, looking a little lower: the lantern standing on the tabletop, the stage beyond
  { name: 'placement-4-lantern-on-table', room: 'living_room', yaw: 92, pitch: -30, handDown: true },
];

const { browser, page, logs } = await launch({ width: 1280, height: 800 });

async function seatOf() {
  return page.evaluate(() => {
    const planes = window.__lantern.app.planes;
    const norm = (l) => (l || '').toLowerCase().replace(/[^a-z]/g, '');
    let best = null;
    for (const p of planes) {
      if (p.orientation !== 'horizontal' || p.points.length < 3) continue;
      if (!['table', 'desk'].includes(norm(p.label))) continue;
      const y = p.points.reduce((a, q) => a + q.y, 0) / p.points.length;
      if (y < 0.55 || y > 0.95) continue;
      const cx = p.points.reduce((a, q) => a + q.x, 0) / p.points.length;
      const cz = p.points.reduce((a, q) => a + q.z, 0) / p.points.length;
      const d = Math.hypot(cx, cz);
      if (!best || d < best.d) best = { d, cx, cz, y, pts: p.points.map((q) => [q.x, q.z]) };
    }
    if (!best) return { x: 0, y: 1.25, z: 0 };
    let dx = -best.cx;
    let dz = -best.cz;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    let ext = 0;
    for (const [x, z] of best.pts) ext = Math.max(ext, (x - best.cx) * dx + (z - best.cz) * dz);
    return { x: best.cx + dx * (ext + 0.45), y: best.y + 0.47, z: best.cz + dz * (ext + 0.45) };
  });
}

async function hideEmulatorUi() {
  await page.evaluate(() => {
    for (const el of [...document.body.children]) {
      if (el.id === 'scene-container' || el.id === 'landing' || el.tagName === 'SCRIPT') continue;
      if (el.querySelector('canvas')) {
        for (const c of el.children) if (c.tagName !== 'CANVAS') c.style.visibility = 'hidden';
      } else el.style.display = 'none';
    }
  });
}

async function raiseHand(seat, face) {
  const rad = (face * Math.PI) / 180;
  const fx = -Math.sin(rad);
  const fz = -Math.cos(rad);
  await setHand(page, { x: seat.x + fx * 0.42, y: seat.y - 0.17, z: seat.z + fz * 0.42, pose: 'open', yaw: face, pitch: 0, roll: 0 });
  await page.waitForTimeout(700);
}

const out = [];
for (const c of CASES) {
  await openApp(page, { room: c.room });
  await enterXR(page);
  await page.waitForFunction(() => window.__lantern.app.planes.length > 0, null, { timeout: 4000 }).catch(() => undefined);
  await page.waitForTimeout(300);
  await hideEmulatorUi();
  const seat = await seatOf();
  await remote(page, 'set_transform', { device: 'headset', position: seat, orientation: { pitch: -6, yaw: c.yaw, roll: 0 } });
  await page.waitForTimeout(200);
  await page.evaluate(() => window.__lantern.app.requestReplace());
  await remote(page, 'set_input_mode', { mode: 'hand' });
  await remote(page, 'set_connected', { device: 'hand-left', connected: false });
  await page.waitForTimeout(2600);
  let s = await snap(page);
  const st = s.stage;
  let face = c.yaw;
  if (c.turn) {
    // the nudge as the viewer first sees it, then after turning toward the stage
    out.push({ file: await shot(page, c.name + '-a-before'), kind: st.kind, reason: st.reason, turnDeg: st.turnDeg, notice: s.notice });
    const dx = st.origin[0] - seat.x;
    const dz = st.origin[2] - seat.z;
    face = (Math.atan2(-dx, -dz) * 180) / Math.PI;
    await remote(page, 'set_transform', { device: 'headset', position: seat, orientation: { pitch: -6, yaw: face, roll: 0 } });
    await page.waitForTimeout(600);
    await raiseHand(seat, face);
    s = await snap(page);
    out.push({ file: await shot(page, c.name.replace('-2-', '-3-') + '-b-after'), kind: s.stage.kind, reason: s.stage.reason, notice: s.notice });
    continue;
  }
  if (!c.handDown) await raiseHand(seat, face);
  if (c.pitch) {
    // look down a little: the lantern on the table and the stage in one view
    await remote(page, 'set_transform', { device: 'headset', position: seat, orientation: { pitch: c.pitch, yaw: face, roll: 0 } });
    await page.waitForTimeout(500);
  }
  s = await snap(page);
  out.push({ file: await shot(page, c.name), kind: s.stage.kind, reason: s.stage.reason, notice: s.notice, lanternOnTable: s.lantern.onSurface });
}
for (const o of out) console.log('STILL', JSON.stringify(o));
const errors = logs.filter((l) => l.startsWith('PAGEERROR'));
console.log('PAGEERRORS', errors.length);
for (const e of errors.slice(0, 5)) console.log(e);
await browser.close();
