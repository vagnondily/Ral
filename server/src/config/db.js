const { Pool, types } = require('pg');
const logger = require('./logger');

// Postgres DATE (OID 1082) has no time zone. By default node-pg turns it
// into a JS Date at local midnight, which JSON-serializes in UTC — in
// Antananarivo (UTC+3) 2026-09-01 became "2026-08-31T21:00:00Z", shifting
// every mission day and plan month back by one day. Keep DATE as its exact
// 'YYYY-MM-DD' string end to end.
types.setTypeParser(1082, (value) => value);

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
});

pool.on('error', (err) => {
  // A backend connection was terminated unexpectedly (network blip, DB
  // restart, ...). Log and let the pool recover the next checkout — do not
  // crash the process over a single dead connection.
  logger.error({ err }, 'Unexpected error on idle PostgreSQL client');
});

/**
 * Run `fn` inside a single client checked out from the pool, wrapped in a
 * transaction (BEGIN / COMMIT / ROLLBACK). Use this for any write that spans
 * more than one statement so partial failures cannot leave the row set
 * inconsistent (e.g. plan status change + assignment upsert).
 */
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
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

module.exports = { pool, withTransaction, withTenantTransaction };
