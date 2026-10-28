/**
 * Smoke-test the DEPLOYED site (GitHub Pages) in headless Chromium with the
 * IWER emulator injected (the production build ships without it): base path,
 * assets, XR session start, hand shadows, controller rod puppets, tester HUD,
 * and the WebXR input-profile models fetched from the CDN.
 *
 *   node e2e/live-check.mjs [url]
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const url = process.argv[2] ?? 'https://lanternfields.github.io/lanternlight/?tester=1';
const OUT = path.resolve('artifacts');
fs.mkdirSync(OUT, { recursive: true });
const require = createRequire(import.meta.url);
const iwerPath = require.resolve('iwer/build/iwer.min.js');
const iwer = fs.readFileSync(iwerPath, 'utf8');

const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
await context.addInitScript({
  content: `${iwer};\n(() => { const d = new IWER.XRDevice(IWER.metaQuest3); d.installRuntime({ forceInstall: true }); window.IWER_DEVICE = d; })();`,
});
const page = await context.newPage();
const errors = [];
const failed = [];
const requests = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
page.on('requestfailed', (r) => failed.push(`${r.failure()?.errorText} ${r.url()}`));
page.on('response', (r) => {
  requests.push({ status: r.status(), url: r.url() });
  if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`);
});

const report = { url, ok: false, checks: {} };
const check = (name, pass, detail = '') => {
  report.checks[name] = { pass, detail };
  console.log(pass ? 'PASS' : 'FAIL', name, detail);
};
try {
  await page.goto(url, { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => !!window.__lantern, null, { timeout: 60000 });
  const landing = await page.evaluate(() => ({
    title: document.title,
    build: document.getElementById('build')?.textContent,
    begin: document.getElementById('begin')?.textContent,
    disabled: document.getElementById('begin')?.disabled,
  }));
  check('landing renders', landing.title === 'Lanternlight', JSON.stringify(landing));
  check('tester mode on', /tester mode/.test(landing.build ?? ''), landing.build);
  check('Begin enabled (AR supported via emulator)', landing.disabled === false && landing.begin === 'Light the lantern');
  await page.screenshot({ path: path.join(OUT, 'live-landing.png') });

  await page.click('#begin');
  await page.waitForFunction(() => window.__lantern.snapshot().phase === 'show', null, { timeout: 60000 });
  let s = await page.evaluate(() => window.__lantern.snapshot());
  check('XR session started', s.phase === 'show', `stage ${s.stage?.kind} (${s.stage?.reason}), session ${s.session?.mode}`);

  // hands
  await page.evaluate(async () => {
    const r = window.IWER_DEVICE.remote;
    await r.dispatch('set_input_mode', { mode: 'hand' });
    await r.dispatch('set_hand_pose', { device: 'hand-right', poseId: 'open' });
    await r.dispatch('set_transform', { device: 'hand-right', position: { x: 0.0, y: 1.42, z: -0.42 }, orientation: { pitch: 60, yaw: 0, roll: 0 } });
  });
  await page.waitForTimeout(4000);
  s = await page.evaluate(() => window.__lantern.snapshot());
  const hand = s.actors[1];
  check('hand tracked and casting a shadow', s.inputMode === 'hands' && hand.present && s.capsules > 20, `capsules ${s.capsules}, beat ${s.beat}`);
  check('tester HUD visible', s.hud === true);
  await page.screenshot({ path: path.join(OUT, 'live-hands.png') });

  // controllers -> rod puppets
  await page.evaluate(async () => {
    const r = window.IWER_DEVICE.remote;
    await r.dispatch('set_input_mode', { mode: 'controller' });
    await r.dispatch('set_transform', { device: 'controller-right', position: { x: 0.05, y: 1.3, z: -0.4 } });
  });
  await page.waitForTimeout(4000);
  s = await page.evaluate(() => window.__lantern.snapshot());
  const rod = s.actors[3];
  check('controller rod puppet casting a shadow', s.inputMode === 'controllers' && rod.present, `capsules ${s.capsules}`);
  await page.screenshot({ path: path.join(OUT, 'live-controllers.png') });

  const profiles = requests.filter((r) => /webxr-input-profiles|generic-hand|oculus-touch|meta-quest-touch/i.test(r.url));
  check('input-profile models load from CDN', profiles.length > 0 && profiles.every((r) => r.status < 400), `${profiles.length} requests, e.g. ${profiles[0]?.url ?? '-'}`);
  const own = requests.filter((r) => r.url.startsWith('https://lanternfields.github.io/'));
  check('all own assets 2xx (base path ok)', own.length > 0 && own.every((r) => r.status < 400), `${own.length} requests`);
  check('no failed requests', failed.length === 0, failed.slice(0, 5).join(' | '));
  check('no console errors', errors.length === 0, errors.slice(0, 5).join(' | '));
  report.ok = Object.values(report.checks).every((c) => c.pass);
  report.snapshot = s;
} catch (e) {
  check('ERROR', false, e.message);
}
report.errors = errors;
report.failed = failed;
fs.writeFileSync(path.join(OUT, 'live-check.json'), JSON.stringify(report, null, 2));
console.log('RESULT', report.ok ? 'PASS' : 'FAIL');
await browser.close();
process.exit(report.ok ? 0 : 1);
