/**
 * Runs the whole headless emulator suite against a running dev server
 * (npm run dev:emu) and writes artifacts/e2e-summary.json:
 *   - hands-only playthrough (living_room: paper scroll)
 *   - controller-only playthrough (office_small: wall stage)
 *   - room sweep (5 captured rooms + no scan, 4 headings each)
 *   - perf budget check (draw calls / triangles, main + offscreen pass) and
 *     frame-time stats as logged by the app (SwiftShader: NOT device numbers)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve('artifacts');
const BUDGET = { drawCalls: 80, triangles: 100000 };
const runs = [
  ['flow', ['e2e/flow.mjs', 'living_room'], 'flow-living_room.json'],
  ['controllers', ['e2e/controllers.mjs', 'office_small'], 'controllers-office_small.json'],
  ['rooms', ['e2e/rooms.mjs'], 'rooms.json'],
];
const summary = { when: new Date().toISOString(), results: {}, perf: {}, ok: true };
for (const [name, args, file] of runs) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 20 * 60 * 1000 });
  const line = (r.stdout || '').split('\n').find((l) => l.startsWith('RESULT')) ?? 'RESULT ?';
  const pass = r.status === 0;
  summary.ok &&= pass;
  summary.results[name] = { pass, line, seconds: Math.round((Date.now() - t0) / 1000) };
  console.log(name.padEnd(12), pass ? 'PASS' : 'FAIL', line);
  try {
    const report = JSON.parse(fs.readFileSync(path.join(OUT, file), 'utf8'));
    const perf = report.final?.perf;
    if (perf) {
      const calls = perf.drawCalls + (perf.stagePassCalls ?? 0);
      const tris = perf.triangles + (perf.stagePassTriangles ?? 0);
      const within = calls <= BUDGET.drawCalls && tris <= BUDGET.triangles;
      summary.ok &&= within;
      summary.perf[name] = { calls, tris, within, frame: perf.frame, cpu: perf.cpu, quality: perf.quality, qualityChanges: perf.qualityChanges };
      console.log(''.padEnd(12), `draw calls ${calls} (<= ${BUDGET.drawCalls}), triangles ${tris} (<= ${BUDGET.triangles}), app cpu p50 ${perf.cpu.p50} ms, frame p50 ${perf.frame.p50} ms (SwiftShader)`);
    }
  } catch {
    /* report missing */
  }
}
fs.writeFileSync(path.join(OUT, 'e2e-summary.json'), JSON.stringify(summary, null, 2));
console.log(summary.ok ? 'ALL PASS' : 'FAILURES');
process.exit(summary.ok ? 0 : 1);
