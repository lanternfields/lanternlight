/**
 * Finds a hand orientation whose shadow reads as a crocodile: long and level
 * (fingers pointing along the stage), thumb below the fingers. Used to tune
 * the capture director's crocodile gesture.  node e2e/croc-orient.mjs
 */
import { launch, openApp, enterXR, setHand, snap, remote } from './lib.mjs';

const { browser, page } = await launch();
await openApp(page, { room: 'office_small' });
await enterXR(page);
await page.waitForFunction(() => window.__lantern.snapshot().phase === 'show', null, { timeout: 60000 });
await remote(page, 'set_input_mode', { mode: 'hand' });
await page.evaluate(() => window.__lantern.goto('croc'));
const st = (await snap(page)).stage;
const n = st.normal;
// nominal hand: 0.42 m toward the stage, 0.22 m below the eyes (head ~1.6 m in IWER)
const head = await page.evaluate(() => { const h = window.__lantern.app.head; return [h.x, h.y, h.z]; });
const P = { x: head[0] - n[0] * 0.42, y: head[1] - 0.22, z: head[2] - n[2] * 0.42 };
const stageYaw = (Math.atan2(n[0], n[2]) * 180) / Math.PI;
console.log('stage', st.kind, st.reason, 'yaw', stageYaw.toFixed(0), 'hand at', P);
const results = [];
const poses = (process.argv[2] ?? 'flat,relaxed,open').split(',');
const combos = []; for (const p of [-90, -45, 0, 45, 90]) for (const y of [-90, 90]) for (const r of [-90, 0, 90]) combos.push([p, y, r]);
const list = process.argv[3] ? process.argv[3].split(';').map((c) => c.split(':').map(Number)) : combos;
for (const pose of poses) {
  for (const [pitch, yaw, roll] of list) {
    await setHand(page, { pose, x: P.x, y: P.y, z: P.z, pitch, yaw: yaw + stageYaw, roll });
    await page.waitForTimeout(200);
    const s = await snap(page);
    const a = s.actors[1];
    if (!a.present) continue;
    const [s0, s1, t0, t1] = a.handBox;
    const w = s1 - s0;
    const h = t1 - t0;
    // thumb below the fingers: the lower jaw (thumb tip) under the upper jaw (index/middle tips)
    const snapUL = await page.evaluate(() => {
      const ac = window.__lantern.app.model.actors[1];
      return { ut: ac.upperT, lt: ac.lowerT, us: ac.upperS, ks: ac.knuckleS };
    });
    if (process.argv[3]) await page.screenshot({ path: `artifacts/croc-${pose}_${pitch}_${yaw}_${roll}.png` });
    results.push({ pose, pitch, yaw, roll, ratio: +(w / h).toFixed(2), thumbBelow: snapUL.lt < snapUL.ut, pointsRight: snapUL.us > snapUL.ks, ap: a.aperture });
  }
}
results.sort((p, q) => q.ratio - p.ratio);
for (const r of results) console.log(JSON.stringify(r));
await browser.close();
