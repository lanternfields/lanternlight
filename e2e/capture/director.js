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
  // One finger up (the finale's branch): a fist, the index finger straight.
  composite('pointUp', 'fist', [
    ['open', ['index-finger-metacarpal', 'index-finger-phalanx-proximal', 'index-finger-phalanx-intermediate', 'index-finger-phalanx-distal', 'index-finger-tip']],
  ]);
  // The bridge: a flat hand with the fingers a little apart, so its shadow keeps them.
  composite('bridgeHand', 'flat', [['open', ['index-finger-phalanx-proximal', 'index-finger-phalanx-intermediate', 'index-finger-phalanx-distal', 'index-finger-tip', 'pinky-finger-phalanx-proximal', 'pinky-finger-phalanx-intermediate', 'pinky-finger-phalanx-distal', 'pinky-finger-tip'], 0.45]]);
  // The bridge, read as a hand: fingers curling a little more toward the pinky
  // (their tips fan out at the leading edge), and optionally the thumb raised.
  const finger = (f) => [`${f}-finger-phalanx-proximal`, `${f}-finger-phalanx-intermediate`, `${f}-finger-phalanx-distal`, `${f}-finger-tip`];
  composite('bridgeFan', 'flat', [
    ['fist', finger('middle'), 0.14],
    ['fist', finger('ring'), 0.28],
    ['fist', finger('pinky'), 0.42],
  ]);
  composite('bridgeRail', 'flat', [
    ['thumbs-up', THUMB],
    ['fist', finger('middle'), 0.14],
    ['fist', finger('ring'), 0.28],
    ['fist', finger('pinky'), 0.42],
  ]);
  /** The bridge hand's roll toward the light (fingers show in its shadow). */
  const BRIDGE_ROLL = 0;
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
    if (name === 'tip') return [a.tipS, a.tipT];
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
    still: false,
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
    const tr = ctl.still ? 0.0004 : 0.0011;
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

  // ---- camera shots for recordings (read by e2e/capture.mjs each frame)
  // wide: 1 = the establishing shot (lantern, hand and wall), 0 = close on the stage
  // inset: 1 = a picture-in-picture side view of the hand
  const ease3 = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const shotCh = {
    wide: { from: 1, to: 1, t0: 0, dur: 1 },
    inset: { from: 0, to: 0, t0: 0, dur: 0.35 },
  };
  const setShot = (key, to, dur) => {
    const c = shotCh[key];
    c.from = shotValue(key);
    c.to = to;
    c.t0 = time;
    c.dur = dur;
  };
  const shotValue = (key) => {
    const c = shotCh[key];
    return c.from + (c.to - c.from) * ease3((time - c.t0) / c.dur);
  };
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
    // the hub's line reads in full before a tale is chosen
    yield* until(() => !!S().view.text.line, 2);
    yield* until(() => !S().view.text.line, 7);
    yield* wait(0.2);
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
    // the establishing shot has shown hand, lantern and wall: move in to the stage
    setShot('wide', 0, 2.8);
    setPose('peace', 0.5);
    yield* until(() => S().stats.rabbitBirths > 0, 20);
    yield* wait(2.2);
    setPose('relaxed', 0.6);
    rest();
    // ---- The Hungry Crocodile
    yield* chooseTale('croc');
    mark('croc');
    yield* crocBeat();
    let t0 = time;
    ctl.size = 1;
    if (shotCh.inset.to === 1) setShot('inset', 0, 0.35);
    mark('croc-fed');
    // the payoff (the night-light drifting off, I5) plays clear of the hand
    ctl.tau = 0.7;
    rest();
    setPose('relaxed', 0.9);
    yield* until(() => S().scene !== 'croc', 15);
    rest();
    // ---- Rabbit's Bridge
    yield* chooseTale('bridge');
    mark('bridge');
    rest();
    // the rabbit waits at the edge while the storyteller sets the scene; the hand comes with the second line
    {
      const l0 = S().view.text.lineId;
      yield* until(() => !S().view.title.id, 5);
      yield* until(() => S().view.text.lineId >= l0 + 2, 10);
      // ...and has been read: Pip steps onto the hand as "on tiptoe" comes up
      yield* until(() => !S().view.text.line, 6);
    }
    setPose('bridgeFan', 0.6);
    orient(-22, 90, BRIDGE_ROLL);
    ctl.tau = 0.3;
    setShot('inset', 1, 0.35); // the hand laid flat, from the side
    t0 = time;
    let insetOff = false;
    while (S().scene === 'bridge' && S().stats.crossings < 1 && time - t0 < 30) {
      // its top flush with the tops of the banks
      shadowTo(0.0, -0.358, { feature: 'handTop', size: 1.0 });
      if (!insetOff && time - t0 > 4.5) {
        insetOff = true;
        setShot('inset', 0, 0.35);
      }
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
    yield* finaleBeat();
    mark('end');
  }

  /**
   * The Last Light: the bird flits about while F1 reads; one finger comes up
   * between Pip and the wolf and holds very still; the bird lands on it. The
   * spark crossing the room plays in the wide shot; back in close the bird
   * carries the light away; then the wide shot again as the room comes back.
   */
  function* finaleBeat() {
    rest();
    setPose('relaxed', 0.5);
    yield* until(() => S().scene === 'finale', 25);
    mark('finale');
    yield* until(() => !S().view.title.id, 5);
    yield* wait(2.8);
    setPose('pointUp', 0.6);
    orient(60, 0, 0);
    ctl.tau = 0.42;
    shadowTo(-0.06, -0.14, { feature: 'tip', size: 1 });
    yield* wait(0.9);
    ctl.still = true;
    yield* until(() => S().beat === 'perched', 14);
    mark('finale-perch');
    yield* until(() => S().beat === 'spark', 10);
    // the finger lowers slowly; the spark leaves the lantern (wide: the room, the lantern, the wall)
    ctl.still = false;
    setShot('wide', 1, 1.1);
    ctl.tau = 0.7;
    yield* wait(0.3);
    rest();
    setPose('relaxed', 0.9);
    yield* until(() => S().beat === 'away', 4);
    setShot('wide', 0, 1.0);
    yield* until(() => S().beat === 'lightsUp', 8);
    // the pool fades and the room returns
    setShot('wide', 1, 2.2);
    yield* until(() => S().beat === 'goodnight', 12);
    yield* wait(3.5);
    ctl.tau = 0.16;
  }

  /** Just the finale (its own clip). */
  function* finaleClip() {
    rest();
    setPose('relaxed', 0.1);
    yield* wait(0.3);
    goto('finale');
    yield* finaleBeat();
    mark('end');
  }

  /** The Hungry River: the hand becomes a crocodile and chases fireflies (shared by clips). */
  function* crocBeat() {
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
    const t0 = time;
    while (S().scene === 'croc' && S().stats.eaten < 7 && time - t0 < 45) {
      // the rightmost bright firefly; the mouth never goes far left (the
      // crocodile's body trails left of its mouth and must stay in the light)
      let ff = null;
      for (const f of S().view.fireflies) if (f.alive && f.glow > 0.5 && (!ff || f.x > ff.x)) ff = f;
      if (!ff) {
        yield;
        continue;
      }
      // ...and low enough that the crocodile stays under the storyteller's band
      shadowTo(Math.max(-0.1, ff.x), Math.min(0.0, ff.y), { feature: 'mouth' });
      setPose('crocOpen', 0.35);
      let tt = 0;
      while (tt < 3) {
        tt += yield;
        const m = feature('mouth');
        // the firefly is drawn to an open mouth: bite when it is close
        if (m && Math.hypot(m[0] - ff.x, m[1] - ff.y) < 0.06 && tt > 0.6) break;
      }
      // bite! (fast, then a held beat, then the jaw opens again)
      if (S().stats.chomps === 0) setShot('inset', 1, 0.35); // show the hand making the snap
      setPose('crocBite', 0.11);
      yield* wait(0.38);
      setPose('crocOpen', 0.32);
      yield* wait(0.4);
      if (S().stats.chomps >= 2 && shotCh.inset.to === 1) setShot('inset', 0, 0.35);
    }
  }

  /** Just the crocodile tale (eye-motion check and its own clip). */
  function* crocTale() {
    setPose('relaxed', 0.1);
    rest();
    yield* wait(0.3);
    goto('croc');
    mark('croc');
    yield* crocBeat();
    ctl.size = 1;
    mark('croc-fed');
    yield* until(() => S().scene !== 'croc', 15);
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
    // the opening lines read first (III1 in two beats, then III2 as the wolf
    // comes in); then the hand comes up, so the giant never grows under the ribbon
    yield* until(() => !!S().view.text.line, 2);
    yield* until(() => S().wolf.state !== 'away' && S().wolf.x < 0.6 && !S().view.text.line && S().lineQueue.length === 0, 16);
    // the scare has landed (or the tale has moved on): the wolf rears, flees,
    // is gone, or is back to sing (a scare can land in under a frame of polling)
    const scared = () => S().scene !== 'wolf' || ['rear', 'flee', 'away', 'return', 'howl', 'rest'].includes(S().wolf.state);
    setPose('open', 0.6);
    orient(60, 0, 0);
    ctl.tau = 0.4;
    ctl.size = 1;
    // above and right of where the wolf will stop, so the wolf stays in clear light
    shadowTo(0.34, 0.16, { size: 1 });
    // the lines read first, so by now the wolf may already sit by Pip: don't
    // wait for it to be prowling, only for the hand to settle in the light
    yield* wait(0.8);
    if (!scared()) {
      // grow: a slow, continuous swell (the wolf hesitates as it builds) - the
      // inset shows why: the hand comes back toward you
      setShot('inset', 1, 0.35);
      ctl.tau = 0.5;
      shadowTo(0.34, 0.16, { size: 1.5 });
      yield* until(scared, 8);
    }
    mark('wolf-scared');
    yield* wait(0.6);
    setShot('inset', 0, 0.4);
    // the hand eases out of the light (never a one-frame vanish)
    ctl.tau = 0.75;
    rest();
    setPose('relaxed', 0.9);
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
    yield* until(() => S().scene === 'menu' && S().view.text.line === 'Three stories tonight, then bed.' && S().view.text.lineAlpha > 0.99, 15);
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
    // the close: full at last (skip ahead), the crocodile drifts off glowing
    S().eaten = 6;
    S().view.croc.full = 6 / 7;
    yield* wait(0.2);
    S().eaten = 7;
    S().view.croc.gulps++;
    S().view.croc.full = 1;
    yield* wait(1.6);
    yield* shoot('croc-nightlight');
    yield* wait(2.4);
    yield* shoot('croc-drift');
    // Rabbit's Bridge
    setPose('relaxed', 0.5);
    rest();
    goto('bridge');
    yield* tale3('bridge', 'bridge');
    setPose('bridgeFan', 0.6);
    orient(-22, 90, BRIDGE_ROLL);
    ctl.tau = 0.3;
    shadowTo(0.0, -0.358, { feature: 'handTop', size: 1.0 });
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
    shadowTo(0.34, 0.16, { size: 1 });
    yield* until(() => S().wolf.state === 'prowl' && S().wolf.x < 0.46, 12);
    ctl.tau = 0.5;
    shadowTo(0.34, 0.16, { size: 1.5 });
    yield* until(() => S().wolf.hesitate > 0.5, 6);
    yield* shoot('wolf-hesitate');
    yield* until(() => S().wolf.state === 'rear', 8);
    yield* wait(0.12);
    yield* shoot('wolf-rear');
    ctl.tau = 0.75;
    rest();
    setPose('relaxed', 0.9);
    yield* until(() => S().wolf.state === 'howl', 12);
    yield* wait(1.2);
    yield* shoot('wolf-howl');
    ctl.size = 1;
    ctl.tau = 0.16;
    goto('finale');
    yield* until(() => !S().view.title.id, 5);
    yield* wait(1.5);
    yield* shoot('finale-flit');
    setPose('pointUp', 0.6);
    orient(60, 0, 0);
    ctl.tau = 0.42;
    shadowTo(-0.06, -0.14, { feature: 'tip', size: 1 });
    yield* wait(0.9);
    ctl.still = true;
    yield* until(() => S().beat === 'perched', 14);
    yield* wait(0.8);
    yield* shoot('finale-perch');
    yield* until(() => S().beat === 'away', 10);
    ctl.still = false;
    rest();
    yield* wait(0.8);
    yield* shoot('finale-away');
    yield* until(() => S().beat === 'goodnight', 12);
    yield* wait(1.0);
    yield* shoot('finale-goodnight');
  }

  /** Tuning: the bridge hand in several poses (the story frozen once the set is up). */
  function* bridgeTune() {
    setPose('relaxed', 0.1);
    rest();
    goto('bridge');
    yield* until(() => !S().view.title.id, 5);
    yield* wait(0.3);
    app().freezeStory = true;
    const variants = [
      ['bridgeFan', -22, 90, 0],
      ['bridgeFan', -22, 90, 180],
      ['bridgeRail', -22, 90, 0],
      ['bridgeRail', -22, 90, 180],
    ];
    for (const [p, pitch, yaw, roll] of variants) {
      setPose(p, 0.3);
      orient(pitch, yaw, roll);
      ctl.tau = 0.2;
      shadowTo(0.0, -0.358, { feature: 'handTop', size: 1.0 });
      yield* wait(3.6);
      yield* shoot(`bridge-${p}-${pitch}-${roll}`);
    }
    app().freezeStory = false;
  }

  applyBlend();
  let gen = null;
  let done = false;
  window.__director = {
    marks,
    start(name = 'coreLoop') {
      if (name !== 'coreLoop') shotCh.wide.from = shotCh.wide.to = 0;
      gen = { coreLoop, stills, wolfClip, openingClip, textStills, crocTale, finaleClip, bridgeTune }[name]();
      gen.next(0);
      done = false;
      time = 0;
    },
    tick(dt) {
      if (!gen || done) return { done: true, t: time, shot: { wide: shotValue('wide'), inset: shotValue('inset') } };
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
      return { done, t: time, scene: s.scene, beat: s.beat, snap: snapNow, shot: { wide: shotValue('wide'), inset: shotValue('inset') } };
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
