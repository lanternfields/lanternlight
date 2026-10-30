/**
 * Room robustness sweep over every IWER captured room (+ no scene data at all).
 *
 * Primary (the landing page says "Sit facing a wall"): for each room, the
 * viewer sits at its table or desk if it has one (0.45 m back from its edge,
 * toward the room's middle), else at the room origin, and faces the middle of
 * EACH wall in turn (0.6-4.5 m away, turned toward the seat within 60 degrees). The stage must land on a usable wall in 85%+ of these
 * seats. Failures are split into genuine blockers (a window, screen, mirror,
 * shelving or an opening covering the wall; furniture in front) and others.
 *
 * Secondary (informational): the old fixed compass headings (0/90/180/270).
 *
 * Every seat: the stage is placed (wall or scroll), faces the viewer, sits in
 * a comfortable view cone (after the viewer turns when nudged to), a raised
 * hand casts a visible shadow inside the light, and the lantern sits on a
 * table whenever one is within reach.
 *
 *   node e2e/rooms.mjs
 */
import { launch, openApp, enterXR, snap, shot, remote, setHand, writeJSON } from './lib.mjs';

const ROOMS = ['living_room', 'meeting_room', 'music_room', 'office_large', 'office_small', 'none'];
const COMPASS = [0, 90, 180, 270];
const GENUINE = new Set(['window', 'windowframe', 'screen', 'mirror', 'shelf', 'invisiblewallface']);
const results = [];
let failures = 0;

const { browser, page, logs } = await launch({ width: 960, height: 600 });

/** Opens the room and returns the seat and the yaws that face each wall. */
async function survey(room) {
  await openApp(page, { room });
  await enterXR(page);
  if (room !== 'none') await page.waitForFunction(() => window.__lantern.app.planes.length > 0, null, { timeout: 4000 }).catch(() => undefined);
  await page.waitForTimeout(300);
  return page.evaluate(() => {
    const planes = window.__lantern.app.planes;
    const norm = (l) => (l || '').toLowerCase().replace(/[^a-z]/g, '');
    // the seat: at the table or desk nearest the room's middle, else the origin
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
    let seat = { x: 0, y: 1.25, z: 0, at: 'origin' };
    if (best) {
      let dx = -best.cx;
      let dz = -best.cz;
      const l = Math.hypot(dx, dz) || 1;
      dx /= l;
      dz /= l;
      let ext = 0;
      for (const [x, z] of best.pts) ext = Math.max(ext, (x - best.cx) * dx + (z - best.cz) * dz);
      seat = { x: best.cx + dx * (ext + 0.45), y: best.y + 0.47, z: best.cz + dz * (ext + 0.45), at: 'table' };
    }
    // one seat facing each wall (squarely), 0.6-4.5 m away; the same direction once
    const yaws = [];
    for (const p of planes) {
      if (p.orientation !== 'vertical' || p.points.length < 3) continue;
      if (!['wall', 'wallface', '', 'other', 'unknown'].includes(norm(p.label))) continue;
      let nx = p.normal.x;
      let nz = p.normal.z;
      const nl = Math.hypot(nx, nz) || 1;
      nx /= nl;
      nz /= nl;
      const q = p.points[0];
      let D = (seat.x - q.x) * nx + (seat.z - q.z) * nz;
      if (D < 0) {
        nx = -nx;
        nz = -nz;
        D = -D;
      }
      if (D < 0.6 || D > 4.5) continue;
      // face the middle of the wall (IWER yaw: forward = (-sin yaw, 0, -cos yaw)),
      // if the wall faces the seat within 60 degrees
      const cx = p.points.reduce((a, q2) => a + q2.x, 0) / p.points.length;
      const cz = p.points.reduce((a, q2) => a + q2.z, 0) / p.points.length;
      const dx = cx - seat.x;
      const dz = cz - seat.z;
      const dl = Math.hypot(dx, dz) || 1;
      if ((-dx * nx - dz * nz) / dl < Math.cos((60 * Math.PI) / 180)) continue;
      const yaw = (Math.atan2(-dx, -dz) * 180) / Math.PI;
      const y = Math.round(((yaw % 360) + 360) % 360);
      if (!yaws.some((o) => Math.abs(((o - y + 540) % 360) - 180) < 10)) yaws.push(y);
    }
    return { seat, yaws };
  });
}

async function runSeat(room, seat, yaw, mode) {
  await openApp(page, { room });
  await enterXR(page);
  if (room !== 'none') await page.waitForFunction(() => window.__lantern.app.planes.length > 0, null, { timeout: 4000 }).catch(() => undefined);
  await page.waitForTimeout(300);
  await remote(page, 'set_transform', { device: 'headset', position: { x: seat.x, y: seat.y, z: seat.z }, orientation: { pitch: 0, yaw, roll: 0 } });
  await page.waitForTimeout(200);
  await page.evaluate(() => window.__lantern.app.requestReplace());
  await remote(page, 'set_input_mode', { mode: 'hand' });
  await remote(page, 'set_connected', { device: 'hand-left', connected: false });
  await page.waitForTimeout(2600);
  let s = await snap(page);
  let face = yaw;
  const placed = s.stage;
  // nudged to turn a little (a wall 30-45 degrees to the side): turn toward the stage
  if (placed.turnDeg) {
    const dx = placed.origin[0] - seat.x;
    const dz = placed.origin[2] - seat.z;
    face = (Math.atan2(-dx, -dz) * 180) / Math.PI;
    await remote(page, 'set_transform', { device: 'headset', position: { x: seat.x, y: seat.y, z: seat.z }, orientation: { pitch: 0, yaw: face, roll: 0 } });
    await page.waitForTimeout(600);
  }
  // a comfortable hand: 0.42 m forward, 0.17 m below the eyes, facing the stage
  const rad = (face * Math.PI) / 180;
  const fx = -Math.sin(rad);
  const fz = -Math.cos(rad);
  await setHand(page, { x: seat.x + fx * 0.42, y: seat.y - 0.17, z: seat.z + fz * 0.42, pose: 'open', yaw: face, pitch: 0, roll: 0 });
  await page.waitForTimeout(700);
  s = await snap(page);
  const st = s.stage;
  const a = s.actors[1];
  const head = [seat.x, seat.y, seat.z];
  const toHead = head.map((h, i) => h - st.origin[i]);
  const facing = toHead[0] * st.normal[0] + toHead[1] * st.normal[1] + toHead[2] * st.normal[2];
  const cos = (-toHead[0] * fx + -toHead[2] * fz) / Math.hypot(toHead[0], toHead[2]);
  const angle = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
  const inLight = a.present && Math.abs(a.centroid[0]) < 0.6 && Math.abs(a.centroid[1]) < 0.45;
  const nudgeCleared = !placed.turnDeg || s.turn === 0;
  const ok = facing > 0.3 && angle < 35 && inLight && s.phase === 'show' && nudgeCleared;
  if (!ok) failures++;
  const reason = st.reason || '';
  const labels = reason.startsWith('wall-covered:') ? reason.slice(13).split(',') : [];
  const genuine = st.kind === 'scroll' && (reason === 'wall-occluded' || (labels.length > 0 && labels.every((l) => GENUINE.has(l))));
  const r = {
    mode,
    room,
    yaw: Math.round(yaw),
    seat: seat.at,
    ok,
    kind: st.kind,
    reason,
    genuine,
    turnDeg: placed.turnDeg ? Math.round(placed.turnDeg) : 0,
    distance: st.distance,
    height: st.height,
    angle: +angle.toFixed(1),
    lanternOnTable: s.lantern.onSurface,
    tablesInReach: s.lantern.surfacesInReach,
    wallsInRange: s.wallsInRange,
    labels: s.planeLabels,
    shadow: a.centroid,
  };
  results.push(r);
  console.log('ROOM', JSON.stringify({ ...r, labels: undefined }));
  await shot(page, `room-${mode}-${room}-yaw${Math.round(yaw)}`);
}

try {
  for (const room of ROOMS) {
    const { seat, yaws } = await survey(room);
    for (const yaw of yaws) await runSeat(room, seat, yaw, 'walls');
    for (const yaw of COMPASS) await runSeat(room, seat, yaw, 'compass');
  }
} catch (e) {
  console.log('ERROR', e.message);
  failures++;
}

// primary: seated facing a wall, the stage lands on it in 85%+ of seats
const walls = results.filter((r) => r.mode === 'walls');
const onWall = walls.filter((r) => r.kind === 'wall').length;
const wallFails = walls.filter((r) => r.kind !== 'wall');
const genuine = wallFails.filter((r) => r.genuine).length;
if (walls.length && onWall < 0.85 * walls.length) {
  console.log('WALLS', `a wall stage in ${onWall} of ${walls.length} wall-facing seats (want 85%+); genuine blockers ${genuine}, other ${wallFails.length - genuine}`);
  failures++;
}
for (const r of wallFails) console.log('BLOCKED', r.room, r.yaw, r.reason, r.genuine ? '(genuine)' : '(other)');
// secondary (informational): fixed compass headings, among seats with a wall in range
const compass = results.filter((r) => r.mode === 'compass' && r.wallsInRange > 0);
const compassOnWall = compass.filter((r) => r.kind === 'wall').length;
// the lantern sits on a real table whenever one is within reach of the seat
const reach = results.filter((r) => r.tablesInReach > 0);
const onTable = reach.filter((r) => r.lanternOnTable).length;
if (onTable < reach.length) {
  console.log('LANTERN', `on a table in ${onTable} of ${reach.length} seats with a table in reach`);
  failures += reach.length - onTable;
}
const errors = logs.filter((l) => /PAGEERROR/i.test(l));
const summary = {
  wallFacing: `${onWall}/${walls.length}`,
  genuineBlockers: genuine,
  otherFailures: wallFails.length - genuine,
  compass: `${compassOnWall}/${compass.length}`,
  lanternOnTable: `${onTable}/${reach.length}`,
  turnNudges: results.filter((r) => r.turnDeg).length,
};
writeJSON('rooms', { summary, results, failures, errors: errors.slice(0, 20) });
console.log(
  'RESULT',
  failures === 0 && errors.length === 0 ? 'PASS' : 'FAIL',
  `wall-facing seats on a wall: ${summary.wallFacing}`,
  `(genuine blockers ${genuine}, other ${summary.otherFailures})`,
  `compass: ${summary.compass}`,
  `lantern on table: ${summary.lanternOnTable}`,
  `turn nudges: ${summary.turnNudges}`,
  `seat checks failed: ${failures}`,
  'page errors:',
  errors.length,
);
await browser.close();
process.exit(failures === 0 && errors.length === 0 ? 0 : 1);
