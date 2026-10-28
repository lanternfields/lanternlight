/** Measures the crocodile composite poses (aperture, silhouette) in the real app.  node e2e/croc-pose.mjs */
import path from 'node:path';
import { launch, openApp, enterXR, setHand, snap, remote } from './lib.mjs';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const { browser, page } = await launch();
await openApp(page, { room: 'office_small' });
await enterXR(page);
await remote(page, 'set_input_mode', { mode: 'hand' });
await page.addScriptTag({ path: path.join(here, 'capture', 'director.js') });
await page.evaluate(() => window.__lantern.goto('croc'));
console.log('poses', await page.evaluate(() => window.__director.poseNames().join(',')));
const st = (await snap(page)).stage;
const head = await page.evaluate(() => { const h = window.__lantern.app.head; return [h.x, h.y, h.z]; });
const P = { x: head[0], y: head[1] - 0.22, z: head[2] - 0.42 };
const orients = (process.argv[2] ?? '0:-90:90').split(';').map((c) => c.split(':').map(Number));
for (const [pitch, yaw, roll] of orients) {
  for (const name of ['crocOpen', 'crocBite']) {
    await setHand(page, { x: P.x, y: P.y, z: P.z, pitch, yaw, roll });
    await page.evaluate((n) => window.__director.debugPose(n), name);
    await page.waitForTimeout(500);
    const s = await snap(page);
    const a = s.actors[1];
    const [s0, s1, t0, t1] = a.handBox;
    console.log(JSON.stringify({ name, pitch, yaw, roll, present: a.present, ap: a.aperture, ratio: +((s1 - s0) / (t1 - t0)).toFixed(2) }));
    await page.screenshot({ path: `artifacts/crocpose-${name}_${pitch}_${yaw}_${roll}.png` });
  }
}
await browser.close();
