/*
 * Virtual clock for deterministic, frame-stepped capture (injected before any
 * page script). Once enabled, requestAnimationFrame callbacks only run when
 * the capture driver calls __vclock.step(ms), and performance.now()/Date.now()
 * report virtual time. The app, IWER (the WebXR emulator) and its room
 * renderer therefore advance exactly 1/60 s per captured frame, however slow
 * the machine is.
 */
(() => {
  const realRaf = window.requestAnimationFrame.bind(window);
  const realCaf = window.cancelAnimationFrame.bind(window);
  const realPerfNow = performance.now.bind(performance);
  const realDateNow = Date.now.bind(Date);
  let manual = false;
  let vnow = 0;
  let dateOffset = 0;
  let nextId = 1e6;
  const queue = new Map();
  performance.now = () => (manual ? vnow : realPerfNow());
  Date.now = () => (manual ? Math.round(dateOffset + vnow) : realDateNow());
  window.requestAnimationFrame = (cb) => {
    if (!manual) return realRaf(cb);
    const id = nextId++;
    queue.set(id, cb);
    return id;
  };
  window.cancelAnimationFrame = (id) => {
    if (queue.has(id)) queue.delete(id);
    else realCaf(id);
  };
  window.__vclock = {
    enable() {
      vnow = realPerfNow();
      dateOffset = realDateNow() - vnow;
      manual = true;
    },
    disable() {
      manual = false;
      const cbs = [...queue.values()];
      queue.clear();
      for (const cb of cbs) realRaf(cb);
    },
    /** Advance virtual time and run every pending frame callback once. */
    step(ms) {
      vnow += ms;
      const cbs = [...queue.values()];
      queue.clear();
      for (const cb of cbs) {
        try {
          cb(vnow);
        } catch (e) {
          console.error('[vclock]', e);
        }
      }
      return cbs.length;
    },
    get now() {
      return vnow;
    },
    get manual() {
      return manual;
    },
  };
})();
