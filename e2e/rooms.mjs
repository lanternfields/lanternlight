/**
 * Room robustness sweep: every IWER captured room (+ no scene data at all),
 * seated, facing 4 directions. For each: the stage must be placed (wall or
 * scroll), face the viewer, sit inside a comfortable view cone, and a hand
 * raised to the comfortable spot must cast a visible shadow inside the light.
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
      // Seated viewer at the room origin facing `yaw`; then re-place the stage.
      await remote(page, 'set_transform', { device: 'headset', position: { x: 0, y: 1.25, z: 0 }, orientation: { pitch: 0, yaw, roll: 0 } });
      await page.waitForTimeout(200);
      await page.evaluate(() => window.__lantern.app.requestReplace());
      await remote(page, 'set_input_mode', { mode: 'hand' });
      await remote(page, 'set_connected', { device: 'hand-left', connected: false });
      await page.waitForTimeout(2600);
      // Comfortable hand: 0.42 m forward, 0.22 m below the eyes, facing the stage.
      const rad = (yaw * Math.PI) / 180;
      const fx = -Math.sin(rad);
      const fz = -Math.cos(rad);
      await setHand(page, { x: fx * 0.42, y: 1.25 - 0.17, z: fz * 0.42, pose: 'open', yaw, pitch: 0, roll: 0 });
      await page.waitForTimeout(700);
      const s = await snap(page);
      const st = s.stage;
      const a = s.actors[1];
      // checks
      const head = [0, 1.25, 0];
      const toHead = head.map((h, i) => h - st.origin[i]);
      const facing = toHead[0] * st.normal[0] + toHead[1] * st.normal[1] + toHead[2] * st.normal[2];
      const dirX = -toHead[0];
      const dirZ = -toHead[2];
      const cos = (dirX * fx + dirZ * fz) / Math.hypot(dirX, dirZ);
      const angle = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
      const inLight = a.present && Math.abs(a.centroid[0]) < 0.6 && Math.abs(a.centroid[1]) < 0.45;
      const ok = facing > 0.3 && angle < 35 && inLight && s.phase === 'show';
      if (!ok) failures++;
      const r = { room, yaw, ok, kind: st.kind, reason: st.reason, distance: st.distance, height: st.height, angle: +angle.toFixed(1), lanternOnTable: s.lantern.onSurface, tablesInReach: s.lantern.surfacesInReach, planes: s.planes, shadow: a.centroid, size: a.size };
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
const errors = logs.filter((l) => /PAGEERROR/i.test(l));
writeJSON('rooms', { results, failures, lanternOnTable: `${onTable}/${reach.length}`, errors: errors.slice(0, 20) });
console.log('RESULT', failures === 0 && errors.length === 0 ? 'PASS' : 'FAIL', `${results.length - failures}/${results.length}`, 'walls:', results.filter((r) => r.kind === 'wall').length, 'scrolls:', results.filter((r) => r.kind === 'scroll').length, 'lantern on table:', `${onTable}/${reach.length}`, 'page errors:', errors.length);
await browser.close();
process.exit(failures === 0 && errors.length === 0 ? 0 : 1);
