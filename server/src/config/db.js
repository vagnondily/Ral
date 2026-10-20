const { AsyncLocalStorage } = require('node:async_hooks');
const { Pool, types } = require('pg');
const logger = require('./logger');
const { createSemaphore, backgroundSlots } = require('../modules/common/semaphore');

// Postgres DATE (OID 1082) has no time zone. By default node-pg turns it
// into a JS Date at local midnight, which JSON-serializes in UTC — in
// Antananarivo (UTC+3) 2026-09-01 became "2026-08-31T21:00:00Z", shifting
// every mission day and plan month back by one day. Keep DATE as its exact
// 'YYYY-MM-DD' string end to end.
types.setTypeParser(1082, (value) => value);

/**
 * Options de session des connexions du pool (paramètre `options` du protocole,
 * comme PGOPTIONS). Défaut : `-c jit=off` (lot 1b). Sous RLS, le planificateur
 * surestime le coût des requêtes d'analyse (soumissions d'une plage de mois) et
 * déclenche la compilation JIT, qui coûte des centaines de millisecondes par
 * requête sans rien faire gagner sur ces volumes (mesure avant / après au journal,
 * banc `npm run perf:period -- --jit on|off`). PG_OPTIONS remplace ce défaut
 * (ex. « -c jit=on ») ; une valeur vide garde les réglages du serveur.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string|undefined}
 */
function sessionOptions(env = process.env) {
  const v = env.PG_OPTIONS !== undefined ? env.PG_OPTIONS : '-c jit=off';
  return v.trim() ? v.trim() : undefined;
}

// Single shared connection pool. Reused across the process — never create a
// new Pool per request, that is the classic way to exhaust Postgres
// connections under load.
// APP_DATABASE_URL (the restricted mems2_app role, see migration 002) is
// used at runtime so Row-Level Security is actually enforced. DATABASE_URL
// (the superuser) is reserved for migrate.js / seed.js and falls back to it
// only for a quick local run before APP_DATABASE_URL has been configured.
const pool = new Pool({
  connectionString: process.env.APP_DATABASE_URL || process.env.DATABASE_URL,
  max: Number(process.env.PG_POOL_MAX || 20),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  options: sessionOptions(),
});

pool.on('error', (err) => {
  // A backend connection was terminated unexpectedly (network blip, DB
  // restart, ...). Log and let the pool recover the next checkout — do not
  // crash the process over a single dead connection.
  logger.error({ err }, 'Unexpected error on idle PostgreSQL client');
});

/**
 * Contexte de requête des transactions (lot 7a) : un calcul de rapport s'exécute dans
 * `withQueryTimeout('15s', fn)` ; toute transaction ouverte pendant ce calcul — par
 * N'IMPORTE QUEL dépôt, sans changer sa signature — reçoit `SET LOCAL statement_timeout`.
 * Un dépassement (57014) devient l'erreur du bloc, jamais une connexion bloquée.
 */
const queryContext = new AsyncLocalStorage();
const TIMEOUT_RE = /^\d{1,6}(ms|s)$/;

/** Exécute `fn` avec un délai maximal par requête pour les transactions qu'il ouvre. */
function withQueryTimeout(timeout, fn) {
  if (!TIMEOUT_RE.test(String(timeout))) throw new Error(`Délai invalide : ${timeout}`);
  return queryContext.run({ statementTimeout: String(timeout) }, fn);
}

/**
 * Tâches de fond (modules/jobs) : leurs transactions passent par un sémaphore de
 * `backgroundSlots()` jetons (le tiers de PG_POOL_MAX) — une tâche lourde ne prend jamais
 * plus du tiers des connexions ; les requêtes interactives en trouvent toujours une libre.
 * Le contexte est porté par AsyncLocalStorage : aucun dépôt ne change de signature.
 * Une transaction ouverte DANS une autre de la même tâche ne reprend pas de jeton (pas
 * d'interblocage quand il ne reste qu'un jeton).
 */
const backgroundContext = new AsyncLocalStorage();
const backgroundSemaphore = createSemaphore(backgroundSlots());

/** Exécute `fn` comme travail de fond (connexions bornées par le sémaphore). */
function runInBackground(fn) {
  return backgroundContext.run({ held: 0 }, fn);
}

async function acquireBackgroundSlot() {
  const bg = backgroundContext.getStore();
  if (!bg) return null;
  if (bg.held > 0) { bg.held += 1; return () => { bg.held -= 1; }; }
  const release = await backgroundSemaphore.acquire();
  bg.held += 1;
  return () => { bg.held -= 1; release(); };
}

/**
 * Run `fn` inside a single client checked out from the pool, wrapped in a
 * transaction (BEGIN / COMMIT / ROLLBACK). Use this for any write that spans
 * more than one statement so partial failures cannot leave the row set
 * inconsistent (e.g. plan status change + assignment upsert).
 */
async function withTransaction(fn) {
  const releaseSlot = await acquireBackgroundSlot();
  let client;
  try {
    client = await pool.connect();
  } catch (err) {
    if (releaseSlot) releaseSlot();
    throw err;
  }
  try {
    await client.query('BEGIN');
    const ctx = queryContext.getStore();
    // Valeur contrôlée (TIMEOUT_RE) : SET n'accepte pas de paramètre lié.
    if (ctx && ctx.statementTimeout) await client.query(`SET LOCAL statement_timeout = '${ctx.statementTimeout}'`);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
    if (releaseSlot) releaseSlot();
  }
}

/**
 * Set the tenant for the lifetime of a transaction via a Postgres session
 * variable, consumed by row-level security policies (see migration 001).
 * This is defense-in-depth: even if an application-level WHERE tenant_id=$1
 * is forgotten in some query, RLS still blocks cross-tenant access.
 */
async function withTenantTransaction(tenantId, fn) {
  return withTransaction(async (client) => {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    return fn(client);
  });
}

module.exports = {
  pool, withTransaction, withTenantTransaction, withQueryTimeout, sessionOptions,
  runInBackground, backgroundStats: () => backgroundSemaphore.stats(),
};
