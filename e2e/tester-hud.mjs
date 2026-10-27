import { launch, openApp, enterXR, snap, shot, remote, setHand } from './lib.mjs';
const { browser, page } = await launch();
await openApp(page, { query: '?tester=1', room: 'music_room' });
await enterXR(page);
await remote(page, 'set_input_mode', { mode: 'hand' });
await page.waitForTimeout(2500);
// Look down-left toward the lantern + HUD
const s0 = await snap(page);
const lp = s0.lantern.position;
await remote(page, 'set_transform', { device: 'headset', position: { x: 0, y: 1.6, z: 0 }, orientation: { pitch: -38, yaw: 12, roll: 0 } });
await setHand(page, { x: 0.1, y: 1.3, z: -0.35, pose: 'peace' });
await page.waitForTimeout(1500);
await shot(page, 'tester-hud');
const s = await snap(page);
console.log(JSON.stringify({ build: s.build, tester: s.tester, hud: s.hud, lantern: lp }));
await browser.close();
