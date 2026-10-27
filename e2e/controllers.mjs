/**
 * Controller-only playthrough (the rod-puppet fallback): no hands ever
 * connected. Prologue (trigger = rabbit), shadow-touch menu with the puppet's
 * shadow, crocodile (trigger = bite), bridge (puppet's back is the bridge),
 * plus the lantern menu via ray + trigger.
 *
 *   node e2e/controllers.mjs [room]
 */
import { launch, openApp, enterXR, snap, shot, remote, setHand, waitFor, writeJSON } from './lib.mjs';
import { steer } from './steer.mjs';

const room = process.argv[2] ?? 'office_small';
const t0 = Date.now();
const report = { room, steps: [], ok: false };
const step = (name, data = {}) => {
  const s = { name, t: +((Date.now() - t0) / 1000).toFixed(1), ...data };
  report.steps.push(s);
  console.log('STEP', JSON.stringify(s));
};
const DEV = 'controller-right';
const ROD = 3; // actors[3] = right rod puppet
const trigger = async (page, v) => remote(page, 'set_select_value', { device: DEV, value: v });
const click = async (page) => {
  await trigger(page, 1);
  await page.waitForTimeout(250);
  await trigger(page, 0);
  await page.waitForTimeout(150);
};

const { browser, page, logs } = await launch();
try {
  await openApp(page, { room });
  await enterXR(page);
  await remote(page, 'set_input_mode', { mode: 'controller' });
  await remote(page, 'set_connected', { device: 'controller-left', connected: false });
  await setHand(page, { device: DEV, x: 0.3, y: 0.7, z: 0.1 });
  let s = await snap(page);
  step('entered', { input: s.inputMode, stage: s.stage });
  await waitFor(page, `(s) => s.beat === 'wave'`, 30000);

  const base = { device: DEV, x: 0.02, y: 1.25, z: -0.4, pitch: 0, yaw: 0, roll: 0 };
  let r = await steer(page, base, [0.05, 0.05], { actorIndex: ROD });
  step('puppet in light', { error: r.error });
  await waitFor(page, `(s) => s.beat === 'rabbitHint'`, 20000);
  await page.waitForTimeout(800);
  await shot(page, `ctrl-${room}-01-hint`);
  await click(page);
  await waitFor(page, `(s) => s.stats.rabbitBirths >= 1`, 10000);
  step('rabbit born (trigger)');
  await setHand(page, { ...r.hand, y: 0.7, x: 0.3 });
  await waitFor(page, `(s) => s.scene === 'menu'`, 60000);
  await page.waitForTimeout(1200);

  s = await snap(page);
  const crocIcon = s.view.icons.find((i) => i.id === 'croc');
  // approach from below, on the icon's own side (never across the middle icon)
  const approach = (icon) => ({ ...base, x: icon.s * 0.35, y: base.y - 0.12 });
  await setHand(page, approach(crocIcon));
  await page.waitForTimeout(300);
  r = await steer(page, approach(crocIcon), [crocIcon.s, crocIcon.t], { actorIndex: ROD });
  await waitFor(page, `(s) => s.scene === 'croc'`, 40000);
  step('croc via puppet shadow touch', { error: r.error });
  await page.waitForTimeout(1500);
  let hand = r.hand;
  const crocStart = Date.now();
  while (Date.now() - crocStart < 120000) {
    s = await snap(page);
    if (s.scene !== 'croc' || s.stats.eaten >= 7) break;
    const ff = s.view.fireflies[0];
    if (!ff) {
      await page.waitForTimeout(300);
      continue;
    }
    const res = await steer(page, hand, ff, { which: 'mouth', actorIndex: ROD, iterations: 6, tolerance: 0.03 });
    hand = res.hand;
    await page.waitForTimeout(250);
    await click(page);
  }
  s = await snap(page);
  step('croc fed', { eaten: s.stats.eaten, chomps: s.stats.chomps });
  await shot(page, `ctrl-${room}-02-croc`);
  await setHand(page, { ...hand, y: 0.7, x: 0.3 });
  await waitFor(page, `(s) => s.scene === 'menu'`, 30000);
  await page.waitForTimeout(1200);

  s = await snap(page);
  const bridgeIcon = s.view.icons.find((i) => i.id === 'bridge');
  await setHand(page, approach(bridgeIcon));
  await page.waitForTimeout(300);
  r = await steer(page, approach(bridgeIcon), [bridgeIcon.s, bridgeIcon.t], { actorIndex: ROD });
  await waitFor(page, `(s) => s.scene === 'bridge'`, 40000);
  step('bridge via puppet shadow touch');
  await page.waitForTimeout(1500);
  let bar = { ...base, y: 1.15 };
  const bridgeStart = Date.now();
  let last = -1;
  while (Date.now() - bridgeStart < 120000) {
    s = await snap(page);
    if (s.scene !== 'bridge') break;
    if (s.stats.crossings !== last) {
      last = s.stats.crossings;
      const res = await steer(page, bar, [0.0, -0.37], { which: 'handTop', actorIndex: ROD, iterations: 8, tolerance: 0.012 });
      bar = res.hand;
      step('puppet bridge placed', { round: last, error: res.error });
      await shot(page, `ctrl-${room}-03-bridge-${last}`);
    }
    await page.waitForTimeout(400);
  }
  s = await snap(page);
  step('bridge done', { crossings: s.stats.crossings, completed: s.progress.completed });

  // Lantern menu: point at the lantern and pull the trigger, then "Continue".
  await page.waitForFunction(() => window.__lantern.snapshot().scene === 'menu', null, { timeout: 30000 });
  const lp = s.lantern.position;
  const head = [0, 1.6, 0];
  const yaw = (Math.atan2(-(lp[0] - 0.15), -(lp[2] - -0.1)) * 180) / Math.PI;
  const pitch = (Math.atan2(lp[1] + 0.085 - 1.25, Math.hypot(lp[0] - 0.15, lp[2] + 0.1)) * 180) / Math.PI;
  await setHand(page, { device: DEV, x: 0.15, y: 1.25, z: -0.1, pitch, yaw, roll: 0 });
  await page.waitForTimeout(300);
  await click(page);
  await page.waitForTimeout(800);
  s = await snap(page);
  step('lantern menu via ray', { open: s.menu.open });
  await shot(page, `ctrl-${room}-04-lantern-menu`);
  void head;
  report.ok = s.progress.completed.croc && s.progress.completed.bridge && s.menu.open && s.inputMode === 'controllers';
  report.final = s;
} catch (e) {
  step('ERROR', { message: e.message });
  await shot(page, `ctrl-${room}-error`);
  report.final = await snap(page).catch(() => null);
}
report.errors = logs.filter((l) => /PAGEERROR/i.test(l)).slice(0, 20);
writeJSON(`controllers-${room}`, report);
console.log('RESULT', report.ok ? 'PASS' : 'FAIL', room, ((Date.now() - t0) / 1000).toFixed(0) + 's');
await browser.close();
process.exit(report.ok ? 0 : 1);
