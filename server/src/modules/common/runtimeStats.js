const { monitorEventLoopDelay } = require('node:perf_hooks');

/**
 * Santé du processus API (performance, retour 61 / 84 / 95) : retard de la boucle
 * d'événements (perf_hooks.monitorEventLoopDelay) et état du pool PostgreSQL.
 * Un retard de boucle élevé = un calcul synchrone (lecture d'un fichier, boucle JS)
 * fait attendre TOUTES les requêtes ; des connexions en attente = le pool est saturé.
 * Lu par GET /api/system/runtime (administrateur) et par le banc de réactivité.
 */
let histogram = null;
let since = Date.now();

/** Démarre la mesure (une fois par processus ; résolution 10 ms). */
function startLoopMonitor() {
  if (histogram) return;
  histogram = monitorEventLoopDelay({ resolution: 10 });
  histogram.enable();
  since = Date.now();
}

const ms = (ns) => Math.round((Number(ns) / 1e6) * 10) / 10;

/**
 * Instantané : retard de boucle (ms : p50, p95, p99, max, moyenne) depuis le dernier
 * `reset`, et pool (connexions ouvertes, libres, demandes en attente).
 * @param {{ reset?: boolean, pool?: import('pg').Pool, extra?: object }} [opts]
 */
function runtimeSnapshot({ reset = false, pool = null, extra = {} } = {}) {
  const h = histogram;
  const loop = h && h.count > 0 ? {
    p50: ms(h.percentile(50)), p95: ms(h.percentile(95)), p99: ms(h.percentile(99)),
    max: ms(h.max), mean: ms(h.mean), samples: h.count,
  } : null;
  const out = {
    sinceMs: Date.now() - since,
    loopDelayMs: loop,
    pool: pool ? { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount, max: pool.options && pool.options.max } : null,
    memoryMb: Math.round(process.memoryUsage().rss / 1048576),
    ...extra,
  };
  if (reset && h) { h.reset(); since = Date.now(); }
  return out;
}

module.exports = { startLoopMonitor, runtimeSnapshot };
