/**
 * Sémaphore à jetons (pur, sans E/S) : au plus `size` détenteurs à la fois, les autres
 * attendent dans l'ordre d'arrivée. Sert à borner les connexions PostgreSQL des tâches
 * de fond (config/db.withTransaction) : les requêtes interactives trouvent toujours une
 * connexion libre. Testé (test/semaphore.test.js).
 */
function createSemaphore(size) {
  if (!Number.isInteger(size) || size < 1) throw new Error(`Sémaphore : taille invalide (${size}).`);
  let held = 0;
  const waiting = [];
  const releaser = () => {
    let done = false;
    return () => {
      if (done) return; // libérer deux fois ne rend jamais deux jetons
      done = true;
      const next = waiting.shift();
      if (next) next(releaser()); else held -= 1;
    };
  };
  return {
    /** Attend un jeton ; rend la fonction qui le libère. */
    acquire() {
      if (held < size) { held += 1; return Promise.resolve(releaser()); }
      return new Promise((resolve) => waiting.push(resolve));
    },
    stats: () => ({ size, held, waiting: waiting.length }),
  };
}

/**
 * Jetons de connexion réservés aux tâches de fond : JOBS_DB_SLOTS, sinon le tiers du pool
 * (PG_POOL_MAX, 20 par défaut), au moins 1.
 */
function backgroundSlots(env = process.env) {
  const asked = Number(env.JOBS_DB_SLOTS);
  if (Number.isInteger(asked) && asked >= 1) return asked;
  const max = Number(env.PG_POOL_MAX || 20);
  return Math.max(1, Math.floor((Number.isFinite(max) && max > 0 ? max : 20) / 3));
}

module.exports = { createSemaphore, backgroundSlots };
