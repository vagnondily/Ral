/**
 * Sémaphore des calculs lourds du concepteur (lot 7a) — PUR (horloge injectable),
 * testé (test/reportsRenderRoute.test.js). Au plus `max` calculs en même temps par
 * processus ; au-delà, attente en file (ordre d'arrivée) ; après `waitMs`, la demande
 * est refusée (`code: 'queue_timeout'`) au lieu d'épuiser le pool PostgreSQL.
 */
function createSemaphore(max, { setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let active = 0;
  const queue = [];
  const next = () => {
    while (active < max && queue.length) {
      const w = queue.shift();
      if (w.done) continue;
      w.done = true;
      clearTimer(w.timer);
      active += 1;
      w.resolve(release());
    }
  };
  function release() {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      active -= 1;
      next();
    };
  }
  /** Attend une place ; renvoie la fonction qui la libère. */
  function acquire(waitMs = 20000) {
    if (active < max && !queue.length) { active += 1; return Promise.resolve(release()); }
    return new Promise((resolve, reject) => {
      const w = { resolve, done: false, timer: null };
      w.timer = setTimer(() => {
        if (w.done) return;
        w.done = true;
        const e = new Error('Calcul en file d\'attente : réessayez dans un instant.');
        e.code = 'queue_timeout';
        reject(e);
      }, waitMs);
      queue.push(w);
    });
  }
  return { acquire, get active() { return active; }, get waiting() { return queue.filter((w) => !w.done).length; } };
}

module.exports = { createSemaphore };
