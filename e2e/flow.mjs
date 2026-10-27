/**
 * Full hands-only playthrough in the emulator:
 * prologue (shadow found, rabbit born) -> shadow-touch menu -> Hungry Crocodile
 * (eat 7 fireflies by pinching) -> menu -> Rabbit's Bridge (3 crossings).
 * Never connects a controller. Writes screenshots + a JSON report.
 *
 *   node e2e/flow.mjs [room]
 */
import { launch, openApp, enterXR, snap, shot, remote, setHand, waitFor, writeJSON } from './lib.mjs';
import { steer, findBarOrientation } from './steer.mjs';

const room = process.argv[2] ?? 'living_room';
const t0 = Date.now();
const report = { room, steps: [], ok: false };
const step = (name, data = {}) => {
  const s = { name, t: +((Date.now() - t0) / 1000).toFixed(1), ...data };
  report.steps.push(s);
  console.log('STEP', JSON.stringify(s));
};

const { browser, page, logs } = await launch();
try {
  await openApp(page, { room });
  await enterXR(page);
  await remote(page, 'set_input_mode', { mode: 'hand' });
  await remote(page, 'set_connected', { device: 'hand-left', connected: false });
  // Keep the right hand out of the light until the theatre is ready.
  await setHand(page, { x: 0.25, y: 0.8, z: -0.1, pose: 'relaxed' });
  let s = await snap(page);
  step('entered', { stage: s.stage, lantern: s.lantern, planes: s.planes });
  await waitFor(page, `(s) => s.beat === 'wave'`, 30000);
  await shot(page, `${room}-01-wave`);
  step('ghost wave shown');

  // Raise the hand into the light.
  const base = { device: 'hand-right', x: 0.02, y: 1.5, z: -0.42, pitch: 0, yaw: 0, roll: 0, pose: 'open' };
  const r = await steer(page, base, [0.05, 0.05]);
  step('hand in light', { error: r.error });
  await waitFor(page, `(s) => s.beat === 'rabbitHint'`, 20000);
  await shot(page, `${room}-02-hint`);
  step('rabbit hint');

  // Make the rabbit (peace sign).
  await setHand(page, { ...r.hand, pose: 'peace' });
  await waitFor(page, `(s) => s.stats.rabbitBirths >= 1`, 15000);
  await page.waitForTimeout(600);
  await shot(page, `${room}-03-rabbit-born`);
  step('rabbit born');
  await setHand(page, { ...r.hand, pose: 'open', y: 0.8, x: 0.3 });
  await waitFor(page, `(s) => s.scene === 'menu'`, 20000);
  await page.waitForTimeout(1500);
  await shot(page, `${room}-04-menu`);
  step('menu');

  // Touch the crocodile lantern with the shadow.
  s = await snap(page);
  const crocIcon = s.view.icons.find((i) => i.id === 'croc');
  const r2 = await steer(page, { ...base }, [crocIcon.s, crocIcon.t]);
  step('touching croc icon', { error: r2.error });
  await waitFor(page, `(s) => s.scene === 'croc'`, 20000);
  await page.waitForTimeout(1500);
  await shot(page, `${room}-05-croc`);
  step('croc tale');

  // Feed the crocodile: chase fireflies with the mouth and pinch.
  let hand = { ...r2.hand, pose: 'relaxed', roll: -70 };
  const crocStart = Date.now();
  let shots = 0;
  while (Date.now() - crocStart < 150000) {
    s = await snap(page);
    if (s.scene !== 'croc' || s.stats.eaten >= 7) break;
    const ff = s.view.fireflies[0];
    if (!ff) {
      await page.waitForTimeout(300);
      continue;
    }
    await remote(page, 'set_select_value', { device: 'hand-right', value: 0 });
    const res = await steer(page, hand, [ff[0], ff[1]], { which: 'mouth', iterations: 6, tolerance: 0.03 });
    hand = res.hand;
    await page.waitForTimeout(250);
    if (shots < 2) await shot(page, `${room}-06-croc-open-${shots++}`);
    await remote(page, 'set_select_value', { device: 'hand-right', value: 1 }); // pinch = bite
    await page.waitForTimeout(350);
    await remote(page, 'set_select_value', { device: 'hand-right', value: 0 });
    await page.waitForTimeout(150);
  }
  s = await snap(page);
  step('croc fed', { eaten: s.stats.eaten, chomps: s.stats.chomps });
  await shot(page, `${room}-07-croc-done`);
  await setHand(page, { ...hand, y: 0.8, x: 0.3 });
  await waitFor(page, `(s) => s.scene === 'menu'`, 30000);
  await page.waitForTimeout(1200);

  // Rabbit's Bridge.
  s = await snap(page);
  const bridgeIcon = s.view.icons.find((i) => i.id === 'bridge');
  const r3 = await steer(page, { ...base }, [bridgeIcon.s, bridgeIcon.t]);
  step('touching bridge icon', { error: r3.error });
  await waitFor(page, `(s) => s.scene === 'bridge'`, 20000);
  await page.waitForTimeout(1500);
  await shot(page, `${room}-08-bridge`);

  // A flat hand held sideways: find the orientation that casts the longest bar.
  let bar = { device: 'hand-right', x: 0.0, y: 1.3, z: -0.42, pose: 'flat' };
  const cands = [];
  for (const pitch of [-30, 0, 30]) for (const yaw of [-90, 90]) for (const roll of [-90, 0, 90, 180]) cands.push({ pitch, yaw, roll });
  const best = await findBarOrientation(page, bar, cands);
  step('bar orientation', best);
  bar = { ...bar, pitch: best.pitch, yaw: best.yaw, roll: best.roll };
  const bridgeStart = Date.now();
  let lastRound = -1;
  while (Date.now() - bridgeStart < 150000) {
    s = await snap(page);
    if (s.scene !== 'bridge') break;
    const rounds = s.stats.crossings;
    if (rounds !== lastRound) {
      lastRound = rounds;
      // Bigger gaps need a bigger shadow: bring the hand toward the lantern.
      bar = { ...bar, z: [-0.42, -0.36, -0.28][Math.min(rounds, 2)] };
      const res = await steer(page, bar, [0.0, -0.36 - 0.01], { which: 'handTop', iterations: 8, tolerance: 0.012 });
      bar = res.hand;
      step('bridge placed', { round: rounds, error: res.error, handBox: (await snap(page)).actors[1].handBox });
      await shot(page, `${room}-09-bridge-round${rounds}`);
    }
    await page.waitForTimeout(400);
  }
  s = await snap(page);
  step('bridge done', { crossings: s.stats.crossings, splashes: s.stats.splashes, completed: s.progress.completed });
  await setHand(page, { device: 'hand-right', x: 0.3, y: 0.8, z: -0.1, pose: 'relaxed' });
  await waitFor(page, `(s) => s.scene === 'menu'`, 30000);
  await page.waitForTimeout(1500);

  // The Moon Wolf: make yourself big when the wolf prowls (hand toward the lantern).
  s = await snap(page);
  const wolfIcon = s.view.icons.find((i) => i.id === 'wolf');
  const r4 = await steer(page, { ...base }, [wolfIcon.s, wolfIcon.t]);
  step('touching wolf icon', { error: r4.error });
  await waitFor(page, `(s) => s.scene === 'wolf'`, 20000);
  await setHand(page, { ...r4.hand, y: 0.8, x: 0.3 });
  const near = { ...base, pose: 'open' };
  const centred = await steer(page, near, [0.0, 0.05]);
  const closeToLantern = { ...centred.hand, z: centred.hand.z + 0.24, y: centred.hand.y - 0.03 };
  const wolfStart = Date.now();
  let shotDone = false;
  while (Date.now() - wolfStart < 150000) {
    s = await snap(page);
    if (s.scene !== 'wolf' || s.progress.completed.wolf) break;
    const ws = s.view.wolfState;
    if (ws === 'prowl' || ws === 'sit' || ws === 'cower') {
      await setHand(page, closeToLantern);
      if (!shotDone && ws === 'cower') {
        await shot(page, `${room}-10-wolf-cower`);
        shotDone = true;
      }
    } else {
      await setHand(page, { ...centred.hand, y: 0.8, x: 0.3 });
    }
    await page.waitForTimeout(300);
  }
  s = await snap(page);
  await shot(page, `${room}-11-wolf-howl`);
  step('wolf done', { completed: s.progress.completed, size: s.actors[1].size });
  await waitFor(page, `(s) => s.scene === 'finale' || s.scene === 'menu'`, 30000);
  await page.waitForTimeout(3500);
  await shot(page, `${room}-12-finale`);
  s = await snap(page);
  report.ok = s.progress.completed.croc && s.progress.completed.bridge && s.progress.completed.wolf;
  report.final = s;
} catch (e) {
  step('ERROR', { message: e.message });
  await shot(page, `${room}-error`);
  report.final = await snap(page).catch(() => null);
}
report.errors = logs.filter((l) => /PAGEERROR|error/i.test(l)).slice(0, 20);
writeJSON(`flow-${room}`, report);
console.log('RESULT', report.ok ? 'PASS' : 'FAIL', room, ((Date.now() - t0) / 1000).toFixed(0) + 's');
await browser.close();
process.exit(report.ok ? 0 : 1);
