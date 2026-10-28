/*
 * In-page "director" for frame-stepped demo capture. It puppeteers IWER's
 * emulated right hand through the REAL app, one exact frame at a time:
 *  - closed-loop shadow steering (inverse projection through the app's own
 *    stage frame and focal light), so the shadow lands where the shot needs it
 *  - smooth joint-by-joint blending between captured hand poses
 *  - critically-damped motion plus a subtle idle tremor, so it reads as a hand
 * Choreography is written as generator functions: each `yield` is one frame.
 * Requires: window.__lantern (the app) and window.IWER_DEVICE (the emulator)
 * with the IWER pose library injected (e2e/lib.mjs installPoses).
 */
(() => {
  const DEG = Math.PI / 180;
  const app = () => window.__lantern.app;
  const dev = window.IWER_DEVICE;
  const hand = dev.hands.right;
  const sym = Object.getOwnPropertySymbols(hand).find((s) => hand[s] && hand[s].poses);
  const poses = hand[sym].poses;

  // ---------------------------------------------------------------- math
  const qEuler = (pitch, yaw, roll) => {
    // identical to IWER's remote-control euler convention (degrees)
    const a = pitch * DEG;
    const s = yaw * DEG;
    const o = roll * DEG;
    const l = Math.cos(0.5 * a);
    const c = Math.sin(0.5 * a);
    const u = Math.cos(0.5 * s);
    const d = Math.sin(0.5 * s);
    const h = Math.cos(0.5 * o);
    const p = Math.sin(0.5 * o);
    return { w: l * u * h + c * d * p, x: c * u * h + l * d * p, y: l * d * h - c * u * p, z: l * u * p - c * d * h };
  };
  const qSlerp = (a, b, t) => {
    let cos = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
    let bx = b.x;
    let by = b.y;
    let bz = b.z;
    let bw = b.w;
    if (cos < 0) {
      cos = -cos;
      bx = -bx;
      by = -by;
      bz = -bz;
      bw = -bw;
    }
    let k0 = 1 - t;
    let k1 = t;
    if (cos < 0.9995) {
      const th = Math.acos(cos);
      const sn = Math.sin(th);
      k0 = Math.sin((1 - t) * th) / sn;
      k1 = Math.sin(t * th) / sn;
    }
    const q = { x: a.x * k0 + bx * k1, y: a.y * k0 + by * k1, z: a.z * k0 + bz * k1, w: a.w * k0 + bw * k1 };
    const n = Math.hypot(q.x, q.y, q.z, q.w) || 1;
    q.x /= n;
    q.y /= n;
    q.z /= n;
    q.w /= n;
    return q;
  };
  const matToQuat = (m) => {
    // column-major 4x4
    const m00 = m[0], m01 = m[4], m02 = m[8];
    const m10 = m[1], m11 = m[5], m12 = m[9];
    const m20 = m[2], m21 = m[6], m22 = m[10];
    const tr = m00 + m11 + m22;
    let q;
    if (tr > 0) {
      const s = 0.5 / Math.sqrt(tr + 1);
      q = { w: 0.25 / s, x: (m21 - m12) * s, y: (m02 - m20) * s, z: (m10 - m01) * s };
    } else if (m00 > m11 && m00 > m22) {
      const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
      q = { w: (m21 - m12) / s, x: 0.25 * s, y: (m01 + m10) / s, z: (m02 + m20) / s };
    } else if (m11 > m22) {
      const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
      q = { w: (m02 - m20) / s, x: (m01 + m10) / s, y: 0.25 * s, z: (m12 + m21) / s };
    } else {
      const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
      q = { w: (m10 - m01) / s, x: (m02 + m20) / s, y: (m12 + m21) / s, z: 0.25 * s };
    }
    const n = Math.hypot(q.x, q.y, q.z, q.w) || 1;
    return { x: q.x / n, y: q.y / n, z: q.z / n, w: q.w / n };
  };
  const writeMat = (out, q, p) => {
    const { x, y, z, w } = q;
    out[0] = 1 - 2 * (y * y + z * z);
    out[1] = 2 * (x * y + z * w);
    out[2] = 2 * (x * z - y * w);
    out[3] = 0;
    out[4] = 2 * (x * y - z * w);
    out[5] = 1 - 2 * (x * x + z * z);
    out[6] = 2 * (y * z + x * w);
    out[7] = 0;
    out[8] = 2 * (x * z + y * w);
    out[9] = 2 * (y * z - x * w);
    out[10] = 1 - 2 * (x * x + y * y);
    out[11] = 0;
    out[12] = p[0];
    out[13] = p[1];
    out[14] = p[2];
    out[15] = 1;
  };
  const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

  // ---------------------------------------------------------- pose blending
  const decomp = {};
  const decompose = (name) => {
    if (decomp[name]) return decomp[name];
    const src = poses[name] ?? poses.default;
    const out = {};
    for (const [joint, jt] of Object.entries(src.jointTransforms)) {
      const m = jt.offsetMatrix;
      out[joint] = { q: matToQuat(m), p: [m[12], m[13], m[14]], r: jt.radius };
    }
    decomp[name] = out;
    return out;
  };
  const blend = { jointTransforms: {} };
  for (const joint of Object.keys(poses.default.jointTransforms)) {
    blend.jointTransforms[joint] = { offsetMatrix: new Array(16).fill(0), radius: poses.default.jointTransforms[joint].radius };
  }
  if (poses.default.gripOffsetMatrix) blend.gripOffsetMatrix = poses.default.gripOffsetMatrix;
  poses.__blend = blend;
  const pose = { from: 'relaxed', to: 'relaxed', t: 1, dur: 0.4 };
  // (applyBlend below fills the blend from 'relaxed' before any snapshot)
  const applyBlend = () => {
    const A = decompose(pose.from);
    const B = decompose(pose.to);
    const t = ease(pose.t);
    for (const joint of Object.keys(blend.jointTransforms)) {
      const a = A[joint];
      const b = B[joint];
      const q = qSlerp(a.q, b.q, t);
      const p = [a.p[0] + (b.p[0] - a.p[0]) * t, a.p[1] + (b.p[1] - a.p[1]) * t, a.p[2] + (b.p[2] - a.p[2]) * t];
      writeMat(blend.jointTransforms[joint].offsetMatrix, q, p);
      blend.jointTransforms[joint].radius = a.r + (b.r - a.r) * t;
    }
    if (hand.poseId !== '__blend') hand.poseId = '__blend';
  };
  /** Composite pose: `base` with some joints taken from other poses. */
  const THUMB = ['thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip'];
  const composite = (name, base, overrides) => {
    const out = { ...decompose(base) };
    for (const [src, joints, w = 1] of overrides) {
      const d = decompose(src);
      for (const j of joints) {
        if (!d[j] || !out[j]) continue;
        const a = out[j];
        const b = d[j];
        out[j] = { q: qSlerp(a.q, b.q, w), p: [a.p[0] + (b.p[0] - a.p[0]) * w, a.p[1] + (b.p[1] - a.p[1]) * w, a.p[2] + (b.p[2] - a.p[2]) * w], r: a.r };
      }
    }
    decomp[name] = out;
  };
  // The crocodile: fingers together and straight (the upper jaw), the thumb
  // dropped (open) or pressed to the fingertips (bite).
  composite('crocOpen', 'flat', [['open', THUMB]]);
  {
    // bite: the thumb tip presses up to the (straight) index/middle fingertips
    composite('crocBite', 'flat', []);
    const d = decomp.crocBite;
    const it = d['index-finger-tip'].p;
    const mt = d['middle-finger-tip'].p;
    const goal = [(it[0] + mt[0]) / 2, (it[1] + mt[1]) / 2, (it[2] + mt[2]) / 2];
    const pull = (joint, w) => {
      const j = d[joint];
      d[joint] = { ...j, p: [j.p[0] + (goal[0] - j.p[0]) * w, j.p[1] + (goal[1] - j.p[1]) * w, j.p[2] + (goal[2] - j.p[2]) * w] };
    };
    pull('thumb-phalanx-distal', 0.55);
    pull('thumb-tip', 0.86);
  }
  const setPose = (name, dur = 0.45) => {
    if (pose.to === name) return;
    // blend from exactly what the hand shows now (smooth even mid-blend)
    const snap = {};
    for (const [joint, jt] of Object.entries(blend.jointTransforms)) {
      const m = jt.offsetMatrix;
      snap[joint] = { q: matToQuat(m), p: [m[12], m[13], m[14]], r: jt.radius };
    }
    decomp.__snap = snap;
    pose.from = '__snap';
    pose.to = name;
    pose.t = 0;
    pose.dur = dur;
  };

  // ------------------------------------------------------- stage helpers
  const frame = () => app().placement.frame;
  const stageYaw = () => {
    const n = frame().normal;
    return Math.atan2(n.x, n.z) / DEG;
  };
  const head = () => app().head;
  const actor = () => app().model.actors[1];
  const feature = (name) => {
    const a = actor();
    if (!a.present) return null;
    if (name === 'mouth') return [a.mouthS, a.mouthT];
    if (name === 'handTop') return [(a.handMinS + a.handMaxS) / 2, a.handMaxT];
    return [(a.handMinS + a.handMaxS) / 2, (a.handMinT + a.handMaxT) / 2];
  };
  /** World point whose shadow lands at stage (s,t) with magnification m. */
  const throughLight = (s, t, m) => {
    const f = frame();
    const E = app().focal;
    const H = f.height;
    const P = [
      f.origin.x + f.right.x * s * H + f.up.x * t * H,
      f.origin.y + f.right.y * s * H + f.up.y * t * H,
      f.origin.z + f.right.z * s * H + f.up.z * t * H,
    ];
    return [E.x + (P[0] - E.x) / m, E.y + (P[1] - E.y) / m, E.z + (P[2] - E.z) / m];
  };
  const restPoint = () => {
    const h = head();
    const yaw = stageYaw() * DEG;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const rx = -fz;
    const rz = fx;
    // low and close: out of the shot (in a headset your hand would simply be in your lap)
    return [h.x + fx * 0.16 + rx * 0.22, h.y - 0.85, h.z + fz * 0.16 + rz * 0.22];
  };

  // --------------------------------------------------------- hand control
  const ctl = {
    mode: 'rest', // 'rest' | 'shadow' | 'world'
    target: [0, 0], // stage target for 'shadow'
    feature: 'centroid',
    size: 1,
    world: [0, 1, -0.4],
    euler: { pitch: 60, yaw: 0, roll: 0 }, // relative to the stage
    off: [0, 0],
    pinch: 0,
    pinchTarget: 0,
    pinchRate: 7,
    pos: null,
    vel: [0, 0, 0],
    rot: { pitch: 60, yaw: 0, roll: 0 },
    rotVel: { pitch: 0, yaw: 0, roll: 0 },
    tau: 0.16,
  };
  // Damped springs (zeta 0.85: moves ease in, ease out and overshoot a touch).
  const ZETA = 0.85;
  const springStep = (x, v, goal, omega, dt) => {
    const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const acc = omega * omega * (goal - x) - 2 * ZETA * omega * v;
      v += acc * h;
      x += v * h;
    }
    return [x, v];
  };
  let time = 0;
  const tremor = (t, k) =>
    (Math.sin(t * 2.1 + k) + 0.6 * Math.sin(t * 5.3 + 2 * k + 1) + 0.3 * Math.sin(t * 11.7 + 3 * k + 2)) / 1.9;

  const control = (dt) => {
    let goal;
    if (ctl.mode === 'rest') goal = restPoint();
    else if (ctl.mode === 'world') goal = ctl.world;
    else {
      const f = feature(ctl.feature);
      if (f) {
        // integrate the shadow error into an aim offset (closed loop)
        const k = 3.2;
        ctl.off[0] += (ctl.target[0] - f[0]) * k * dt;
        ctl.off[1] += (ctl.target[1] - f[1]) * k * dt;
        ctl.off[0] = Math.max(-0.5, Math.min(0.5, ctl.off[0]));
        ctl.off[1] = Math.max(-0.5, Math.min(0.5, ctl.off[1]));
      }
      const m = app().model.nominalMagnification * ctl.size;
      goal = throughLight(ctl.target[0] + ctl.off[0], ctl.target[1] + ctl.off[1], m);
    }
    if (!ctl.pos) ctl.pos = [...goal];
    // omega from the old lag constant: a similar settle time, but no velocity jumps
    const omega = 1.6 / ctl.tau;
    for (let i = 0; i < 3; i++) [ctl.pos[i], ctl.vel[i]] = springStep(ctl.pos[i], ctl.vel[i], goal[i], omega, dt);
    for (const k of ['pitch', 'yaw', 'roll']) [ctl.rot[k], ctl.rotVel[k]] = springStep(ctl.rot[k], ctl.rotVel[k], ctl.euler[k], 7.5, dt);
    ctl.pinch += (ctl.pinchTarget - ctl.pinch) * (1 - Math.exp(-dt * ctl.pinchRate));
    // apply with a tiny living tremor
    const tr = 0.0011;
    hand.position.x = ctl.pos[0] + tremor(time, 0) * tr;
    hand.position.y = ctl.pos[1] + tremor(time, 1.7) * tr;
    hand.position.z = ctl.pos[2] + tremor(time, 3.1) * tr;
    const q = qEuler(ctl.rot.pitch + tremor(time, 4.2) * 0.5, stageYaw() + ctl.rot.yaw + tremor(time, 5.9) * 0.4, ctl.rot.roll + tremor(time, 7.3) * 0.5);
    hand.quaternion.x = q.x;
    hand.quaternion.y = q.y;
    hand.quaternion.z = q.z;
    hand.quaternion.w = q.w;
    if (hand.setPinchValueImmediate) hand.setPinchValueImmediate(ctl.pinch);
    else hand.updatePinchValue(ctl.pinch);
    pose.t = Math.min(1, pose.t + dt / Math.max(0.05, pose.dur));
    applyBlend();
  };

  // ------------------------------------------------------- choreography kit
  const S = () => app().story;
  function* wait(sec) {
    let t = 0;
    while (t < sec) t += yield;
  }
  function* until(pred, max = 60) {
    let t = 0;
    while (!pred() && t < max) t += yield;
  }
  const shadowTo = (s, t, opts = {}) => {
    if (ctl.mode !== 'shadow') ctl.off = [0, 0];
    ctl.mode = 'shadow';
    ctl.target = [s, t];
    ctl.feature = opts.feature ?? 'centroid';
    if (opts.size !== undefined) ctl.size = opts.size;
  };
  const rest = () => {
    ctl.mode = 'rest';
  };
  const orient = (pitch, yaw, roll) => {
    ctl.euler = { pitch, yaw, roll };
  };
  const icon = (id) => S().view.icons.find((i) => i.id === id);
  const marks = [];
  const mark = (label) => marks.push({ label, t: +time.toFixed(2) });
  let snapLabel = null;
  const snap = (label) => {
    snapLabel = label;
    mark('snap:' + label);
  };
  const goto = (scene) => window.__lantern.goto(scene);
  // a snapshot is taken after this frame renders: hold one frame before acting again
  function* shoot(label) {
    snap(label);
    yield;
  }

  function* chooseTale(id) {
    yield* until(() => S().scene === 'menu', 30);
    yield* wait(1.4);
    const ic = icon(id);
    setPose('open', 0.5);
    orient(60, 0, 0);
    ctl.tau = 0.22;
    shadowTo(ic.s, ic.t - 0.02);
    yield* until(() => S().scene === id, 20);
    ctl.tau = 0.16;
  }

  function* coreLoop() {
    mark('start');
    setPose('relaxed', 0.1);
    rest();
    yield* until(() => S().beat === 'wave', 20);
    yield* wait(2.0);
    // raise a hand into the light
    mark('raise');
    setPose('open', 0.8);
    orient(60, 0, 0);
    ctl.tau = 0.35;
    shadowTo(0.04, 0.02);
    yield* wait(1.6);
    ctl.tau = 0.16;
    // a friendly wave
    for (let i = 0; i < 3; i++) {
      orient(60, 0, 16);
      yield* wait(0.38);
      orient(60, 0, -12);
      yield* wait(0.38);
    }
    orient(60, 0, 0);
    yield* until(() => S().beat === 'rabbitHint', 15);
    yield* wait(1.6);
    mark('rabbit');
    setPose('peace', 0.5);
    yield* until(() => S().stats.rabbitBirths > 0, 20);
    yield* wait(2.2);
    setPose('relaxed', 0.6);
    rest();
    // ---- The Hungry Crocodile
    yield* chooseTale('croc');
    mark('croc');
    // hand down while the title card plays, then it becomes a crocodile:
    // fingers together, thumb dropped, side-on
    setPose('relaxed', 0.5);
    rest();
    yield* until(() => !S().view.title.id, 4);
    yield* wait(0.2);
    setPose('crocOpen', 0.6);
    orient(10, -90, 90);
    ctl.tau = 0.3;
    shadowTo(-0.02, -0.04, { feature: 'mouth', size: 1.1 });
    yield* wait(1.6);
    ctl.tau = 0.16;
    let t0 = time;
    while (S().scene === 'croc' && S().stats.eaten < 7 && time - t0 < 45) {
      const ff = S().view.fireflies.find((f) => f.alive && f.glow > 0.5);
      if (!ff) {
        yield;
        continue;
      }
      shadowTo(ff.x, ff.y, { feature: 'mouth' });
      setPose('crocOpen', 0.35);
      let tt = 0;
      while (tt < 3) {
        tt += yield;
        const m = feature('mouth');
        if (m && Math.hypot(m[0] - ff.x, m[1] - ff.y) < 0.045 && tt > 0.6) break;
      }
      // bite! (fast, then a held beat, then the jaw opens again)
      setPose('crocBite', 0.11);
      yield* wait(0.38);
      setPose('crocOpen', 0.32);
      yield* wait(0.4);
    }
    ctl.size = 1;
    mark('croc-fed');
    yield* until(() => S().scene !== 'croc', 15);
    rest();
    // ---- Rabbit's Bridge
    yield* chooseTale('bridge');
    mark('bridge');
    rest();
    yield* wait(3.2); // the rabbit waits at the edge; the hint appears
    setPose('flat', 0.6);
    orient(-30, 90, 0);
    ctl.tau = 0.3;
    t0 = time;
    while (S().scene === 'bridge' && S().stats.crossings < 3 && time - t0 < 70) {
      const round = S().stats.crossings;
      shadowTo(0.0, -0.37, { feature: 'handTop', size: [1.0, 1.08, 1.2][Math.min(2, round)] });
      yield;
    }
    ctl.tau = 0.16;
    mark('bridge-done');
    yield* wait(1.0);
    setPose('relaxed', 0.6);
    rest();
    // ---- The Moon Wolf
    yield* chooseTale('wolf');
    mark('wolf');
    yield* wolfBeat();
    mark('wolf-done');
    rest();
    yield* until(() => S().scene === 'finale' || S().scene === 'menu', 20);
    mark('finale');
    yield* until(() => S().scene === 'menu', 20);
    yield* wait(2.5);
    mark('end');
  }

  /**
   * The Moon Wolf as one beat (staged for the camera): the hand waits out the
   * title card, rises above and right of the wolf at normal size, then grows
   * smoothly as the wolf stalks into the light - past the threshold on the
   * first try - and drops out of the shot as the wolf bolts.
   */
  function* wolfBeat() {
    rest();
    setPose('relaxed', 0.4);
    yield* until(() => !S().view.title.id, 5);
    yield* wait(0.9);
    setPose('open', 0.6);
    orient(60, 0, 0);
    ctl.tau = 0.4;
    ctl.size = 1;
    // above and right of where the wolf will stop, so its shape stays clear
    shadowTo(0.42, 0.27, { size: 1 });
    yield* until(() => S().wolf.state === 'prowl' && S().wolf.x < 0.46, 10);
    // grow: a slow, continuous swell (the wolf hesitates as it builds)
    ctl.tau = 0.5;
    shadowTo(0.42, 0.27, { size: 1.62 });
    yield* until(() => S().wolf.state === 'rear' || S().wolf.state === 'flee', 8);
    mark('wolf-scared');
    yield* wait(0.45);
    ctl.tau = 0.35;
    rest();
    setPose('relaxed', 0.6);
    yield* until(() => S().wolf.state === 'howl', 10);
    mark('wolf-howl');
    yield* until(() => S().scene !== 'wolf', 16);
    ctl.size = 1;
    ctl.tau = 0.16;
    mark('wolf-done');
  }

  /** Just the wolf tale (its own clip). */
  function* wolfClip() {
    rest();
    setPose('relaxed', 0.1);
    yield* wait(0.3);
    goto('wolf');
    mark('wolf');
    yield* wolfBeat();
    yield* wait(0.8);
    mark('end');
  }

  /** The prologue and the crocodile's opening (text and staging check). */
  function* openingClip() {
    mark('start');
    setPose('relaxed', 0.1);
    rest();
    yield* until(() => S().beat === 'wave', 20);
    yield* wait(2.0);
    mark('raise');
    setPose('open', 0.8);
    orient(60, 0, 0);
    ctl.tau = 0.35;
    shadowTo(0.04, 0.02);
    yield* wait(1.6);
    ctl.tau = 0.16;
    for (let i = 0; i < 2; i++) {
      orient(60, 0, 16);
      yield* wait(0.38);
      orient(60, 0, -12);
      yield* wait(0.38);
    }
    orient(60, 0, 0);
    yield* until(() => S().beat === 'rabbitHint', 15);
    yield* wait(1.6);
    setPose('peace', 0.5);
    yield* until(() => S().stats.rabbitBirths > 0, 20);
    yield* wait(1.4);
    setPose('relaxed', 0.6);
    rest();
    yield* chooseTale('croc');
    mark('croc');
    setPose('relaxed', 0.5);
    rest();
    yield* until(() => !S().view.title.id, 5);
    yield* wait(0.2);
    setPose('crocOpen', 0.6);
    orient(10, -90, 90);
    ctl.tau = 0.3;
    shadowTo(-0.02, -0.04, { feature: 'mouth', size: 1.1 });
    yield* wait(7.5);
    mark('end');
  }

  /** Stills of each text treatment (STORY_TEXT.md). */
  function* textStills() {
    goto('intro');
    setPose('relaxed', 0.1);
    rest();
    yield* until(() => S().beat === 'wave', 20);
    yield* wait(1.2);
    yield* shoot('text-line-lit');
    yield* until(() => S().view.text.promptAlpha > 0.99, 12);
    yield* wait(0.3);
    yield* shoot('text-prompt-raise');
    setPose('open', 0.8);
    orient(60, 0, 0);
    ctl.tau = 0.35;
    shadowTo(0.04, 0.02);
    yield* until(() => S().view.text.line === 'There you are.' && S().view.text.lineAlpha > 0.99, 8);
    yield* shoot('text-line-found');
    ctl.tau = 0.16;
    yield* until(() => S().beat === 'rabbitHint', 15);
    yield* wait(1.4);
    setPose('peace', 0.5);
    yield* until(() => S().stats.rabbitBirths > 0, 20);
    yield* until(() => S().view.text.line.startsWith('This is Pip') && S().view.text.lineAlpha > 0.99, 8);
    yield* wait(0.6);
    yield* shoot('text-line-pip');
    setPose('relaxed', 0.6);
    rest();
    yield* until(() => S().scene === 'menu' && S().view.text.line === 'Choose a story.' && S().view.text.lineAlpha > 0.99, 15);
    yield* shoot('text-line-menu');
    goto('croc');
    yield* wait(1.3);
    yield* shoot('text-title-croc');
    setPose('crocOpen', 0.6);
    orient(10, -90, 90);
    yield* until(() => !S().view.title.id, 5);
    shadowTo(-0.02, -0.04, { feature: 'mouth', size: 1.1 });
    yield* until(() => S().view.text.lineAlpha > 0.99, 5);
    yield* wait(0.8);
    yield* shoot('text-line-croc');
    setPose('relaxed', 0.5);
    rest();
    goto('wolf');
    yield* wait(1.3);
    yield* shoot('text-title-wolf');
    yield* until(() => !S().view.title.id, 5);
    yield* until(() => S().view.text.lineAlpha > 0.99, 5);
    yield* wait(0.6);
    yield* shoot('text-line-wolf');
    goto('finale');
    yield* until(() => S().view.text.line === 'Goodnight.' && S().view.text.lineAlpha > 0.99, 20);
    yield* shoot('text-line-goodnight');
  }

  // ------------------------------------------------ stills for the style audit
  function* tale3(id, prefix) {
    yield* wait(0.5);
    yield* shoot(prefix + '-0.5');
    yield* wait(1.0);
    yield* shoot(prefix + '-1.5');
    yield* wait(1.5);
    yield* shoot(prefix + '-3.0');
  }
  function* stills() {
    goto('intro');
    setPose('relaxed', 0.1);
    rest();
    yield* until(() => S().beat === 'wave', 20);
    yield* wait(1.6);
    yield* shoot('prologue-ghost-wave');
    setPose('open', 0.8);
    orient(60, 0, 0);
    ctl.tau = 0.35;
    shadowTo(0.04, 0.02);
    yield* wait(2.0);
    yield* shoot('prologue-hand');
    ctl.tau = 0.16;
    yield* until(() => S().beat === 'rabbitHint', 15);
    yield* wait(1.5);
    yield* shoot('prologue-ghost-rabbit');
    setPose('peace', 0.5);
    yield* until(() => S().stats.rabbitBirths > 0, 20);
    yield* wait(1.3);
    yield* shoot('prologue-rabbit');
    setPose('open', 0.6);
    shadowTo(0.3, -0.12);
    yield* until(() => S().scene === 'menu', 20);
    yield* wait(2.4);
    yield* shoot('menu');
    // The Hungry Crocodile: the hand is already a crocodile when it starts
    setPose('relaxed', 0.4);
    rest();
    yield* wait(0.8);
    goto('croc');
    yield* wait(0.5);
    yield* shoot('croc-0.5');
    yield* wait(1.0);
    yield* shoot('croc-1.5');
    // the title card is leaving: the hand becomes a crocodile
    setPose('crocOpen', 0.6);
    orient(10, -90, 90);
    ctl.tau = 0.3;
    shadowTo(-0.02, -0.04, { feature: 'mouth', size: 1.1 });
    yield* wait(1.5);
    yield* shoot('croc-3.0');
    ctl.tau = 0.16;
    const ff = () => S().view.fireflies.find((f) => f.alive && f.glow > 0.5);
    yield* until(() => !!ff(), 6);
    const f = ff();
    if (f) {
      shadowTo(f.x, f.y, { feature: 'mouth' });
      yield* wait(1.1);
      yield* shoot('croc-aim');
      setPose('crocBite', 0.11);
      yield* wait(0.16);
      yield* shoot('croc-chomp');
      yield* wait(0.3);
      setPose('crocOpen', 0.32);
      yield* wait(0.5);
    }
    // Rabbit's Bridge
    setPose('relaxed', 0.5);
    rest();
    goto('bridge');
    yield* tale3('bridge', 'bridge');
    setPose('flat', 0.6);
    orient(-30, 90, 0);
    ctl.tau = 0.3;
    shadowTo(0.0, -0.37, { feature: 'handTop', size: 1.0 });
    yield* until(() => S().rabbit.onShadow, 12);
    yield* wait(0.3);
    yield* shoot('bridge-play');
    ctl.tau = 0.16;
    // The Moon Wolf
    setPose('relaxed', 0.5);
    rest();
    goto('wolf');
    yield* tale3('wolf', 'wolf');
    setPose('open', 0.5);
    orient(60, 0, 0);
    shadowTo(-0.05, 0.02, { size: 1 });
    yield* until(() => S().wolf.state === 'prowl' && S().wolf.x < 0.6, 12);
    ctl.tau = 0.32;
    ctl.size = 1.6;
    yield* until(() => S().wolf.state === 'cower' || S().wolf.state === 'flee', 8);
    yield* wait(0.3);
    yield* shoot('wolf-scare');
    ctl.size = 1;
    rest();
    goto('finale');
    yield* wait(3.4);
    yield* shoot('finale');
  }

  applyBlend();
  let gen = null;
  let done = false;
  window.__director = {
    marks,
    start(name = 'coreLoop') {
      gen = { coreLoop, stills, wolfClip, openingClip, textStills }[name]();
      gen.next(0);
      done = false;
      time = 0;
    },
    tick(dt) {
      if (!gen || done) return { done: true, t: time };
      // Keep IWER in scripted control: its remote-control release timer runs on
      // real time and would otherwise hand the hands back to the DevUI.
      if (dev.controlMode !== 'programmatic') dev.controlMode = 'programmatic';
      time += dt;
      const r = gen.next(dt);
      if (r.done) done = true;
      control(dt);
      const s = S();
      const snapNow = snapLabel;
      snapLabel = null;
      return { done, t: time, scene: s.scene, beat: s.beat, snap: snapNow };
    },
    get time() {
      return time;
    },
    ctl,
    /** Debug: jump straight to a pose (tests and tuning). */
    debugPose(name) {
      setPose(name, 0.01);
      pose.t = 1;
      applyBlend();
    },
    poseNames: () => Object.keys(poses),
  };
})();
