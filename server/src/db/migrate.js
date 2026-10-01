#!/usr/bin/env node
/**
 * Minimal, dependency-free migration runner: applies every .sql file in
 * db/migrations, in filename order, exactly once, tracked in a
 * schema_migrations table. Deliberately simple (no down-migrations, no
 * external framework) so the whole mechanism fits in one readable file —
 * swap in node-pg-migrate / Prisma Migrate later if the team wants rollback
 * support without changing anything else in the app.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const logger = require('../config/logger');
const { requireConnString } = require('../config/connString');

async function main() {
  // Migrations always run as the superuser connection (DATABASE_URL), never
  // the restricted runtime role, since they create roles/extensions and
  // alter table ownership.
  const client = new Client({ connectionString: requireConnString('DATABASE_URL') });
  await client.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename    text PRIMARY KEY,
        applied_at  timestamptz NOT NULL DEFAULT now()
      )
    `);

    const dir = path.join(__dirname, 'migrations');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

    for (const file of files) {
      const { rows } = await client.query(
        'SELECT 1 FROM schema_migrations WHERE filename = $1',
        [file]
      );
      if (rows.length > 0) {
        logger.info({ file }, 'migration already applied, skipping');
        continue;
      }

      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      logger.info({ file }, 'applying migration');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }

    logger.info('all migrations applied');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  // A config problem (missing/‑passwordless connection string) has a clear,
  // actionable message — surface it plainly rather than a raw SASL stack.
  if (/mot de passe|manquant|invalide|password must be a string/i.test(err.message || '')) {
    logger.error(`Migration impossible : ${err.message}`);
  } else {
    logger.error({ err }, 'migration failed');
  }
  process.exit(1);
});
