/**
 * Room robustness sweep: every IWER captured room (+ no scene data at all),
 * seated, facing 4 directions. In a room with a table or desk the viewer sits
 * at it (as a player would); otherwise at the room origin. For each: the stage
 * must be placed (wall or scroll), face the viewer, sit inside a comfortable
 * view cone, and a hand raised to the comfortable spot must cast a visible
 * shadow inside the light. Then: the lantern sits on a table whenever one is
 * in reach, and a wall becomes the stage in 85%+ of seats with a wall in range.
 *
 *   node e2e/rooms.mjs
 */
import { launch, openApp, enterXR, snap, shot, remote, setRoom, setHand, writeJSON } from './lib.mjs';

const ROOMS = ['living_room', 'meeting_room', 'music_room', 'office_large', 'office_small', 'none'];
const YAWS = [0, 90, 180, 270];
const results = [];
let failures = 0;

const { browser, page, logs } = await launch({ width: 960, height: 600 });
try {
  for (const room of ROOMS) {
    for (const yaw of YAWS) {
      await openApp(page, { room });
      await enterXR(page);
      // wait for the room's planes (none in the empty room)
      if (room !== 'none') await page.waitForFunction(() => window.__lantern.app.planes.length > 0, null, { timeout: 4000 }).catch(() => undefined);
      await page.waitForTimeout(300);
      // The seat: at the room's table or desk if it has one (0.45 m back from its
      // edge, toward the room's middle, eyes ~0.47 m above it), else the origin.
      const seat = await page.evaluate(() => {
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
        if (!best) return { x: 0, y: 1.25, z: 0, at: 'origin' };
        let dx = -best.cx;
        let dz = -best.cz;
        const l = Math.hypot(dx, dz) || 1;
        dx /= l;
        dz /= l;
        let ext = 0;
        for (const [x, z] of best.pts) ext = Math.max(ext, (x - best.cx) * dx + (z - best.cz) * dz);
        return { x: best.cx + dx * (ext + 0.45), y: best.y + 0.47, z: best.cz + dz * (ext + 0.45), at: 'table' };
      });
      // Seated viewer facing `yaw`; then re-place the stage.
      await remote(page, 'set_transform', { device: 'headset', position: { x: seat.x, y: seat.y, z: seat.z }, orientation: { pitch: 0, yaw, roll: 0 } });
      await page.waitForTimeout(200);
      await page.evaluate(() => window.__lantern.app.requestReplace());
      await remote(page, 'set_input_mode', { mode: 'hand' });
      await remote(page, 'set_connected', { device: 'hand-left', connected: false });
      await page.waitForTimeout(2600);
      // Comfortable hand: 0.42 m forward, 0.22 m below the eyes, facing the stage.
      const rad = (yaw * Math.PI) / 180;
      const fx = -Math.sin(rad);
      const fz = -Math.cos(rad);
      await setHand(page, { x: seat.x + fx * 0.42, y: seat.y - 0.17, z: seat.z + fz * 0.42, pose: 'open', yaw, pitch: 0, roll: 0 });
      await page.waitForTimeout(700);
      const s = await snap(page);
      const st = s.stage;
      const a = s.actors[1];
      // checks
      const head = [seat.x, seat.y, seat.z];
      const toHead = head.map((h, i) => h - st.origin[i]);
      const facing = toHead[0] * st.normal[0] + toHead[1] * st.normal[1] + toHead[2] * st.normal[2];
      const dirX = -toHead[0];
      const dirZ = -toHead[2];
      const cos = (dirX * fx + dirZ * fz) / Math.hypot(dirX, dirZ);
      const angle = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
      const inLight = a.present && Math.abs(a.centroid[0]) < 0.6 && Math.abs(a.centroid[1]) < 0.45;
      const ok = facing > 0.3 && angle < 35 && inLight && s.phase === 'show';
      if (!ok) failures++;
      const r = { room, yaw, ok, kind: st.kind, reason: st.reason, distance: st.distance, height: st.height, angle: +angle.toFixed(1), lanternOnTable: s.lantern.onSurface, tablesInReach: s.lantern.surfacesInReach, wallsInRange: s.wallsInRange, seat: seat.at, labels: s.planeLabels, planes: s.planes, shadow: a.centroid, size: a.size };
      results.push(r);
      console.log('ROOM', JSON.stringify(r));
      await shot(page, `room-${room}-yaw${yaw}`);
    }
  }
} catch (e) {
  console.log('ERROR', e.message);
  failures++;
}
// the lantern sits on a real table whenever a table is within reach of the seat
const reach = results.filter((r) => r.tablesInReach > 0);
const onTable = reach.filter((r) => r.lanternOnTable).length;
if (onTable < reach.length) {
  console.log('LANTERN', `on a table in ${onTable} of ${reach.length} runs with a table in reach`);
  failures += reach.length - onTable;
}
// scene understanding that holds up: a wall stage in 85%+ of seats with a wall in range
const walled = results.filter((r) => r.wallsInRange > 0);
const onWall = walled.filter((r) => r.kind === 'wall').length;
if (walled.length && onWall < 0.85 * walled.length) {
  console.log('WALLS', `a wall stage in ${onWall} of ${walled.length} runs with a wall in range (want 85%+)`);
  failures++;
}
const errors = logs.filter((l) => /PAGEERROR/i.test(l));
writeJSON('rooms', { results, failures, lanternOnTable: `${onTable}/${reach.length}`, wallStage: `${onWall}/${walled.length}`, errors: errors.slice(0, 20) });
console.log('RESULT', failures === 0 && errors.length === 0 ? 'PASS' : 'FAIL', `${results.length - failures}/${results.length}`, 'walls:', results.filter((r) => r.kind === 'wall').length, 'scrolls:', results.filter((r) => r.kind === 'scroll').length, 'lantern on table:', `${onTable}/${reach.length}`, 'wall stage:', `${onWall}/${walled.length}`, 'page errors:', errors.length);
await browser.close();
process.exit(failures === 0 && errors.length === 0 ? 0 : 1);
