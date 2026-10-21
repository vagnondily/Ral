#!/usr/bin/env node
/**
 * Seed MINIMAL (« base vierge ») pour MEMS 2.0.
 *
 * Contrairement à `seed.js` (base de DÉMONSTRATION complète : référentiels,
 * prestataires, sites, contrats, avenants, rapports, visites…) et à
 * `seed-test.js` (qui ajoute encore plus de données variées), ce seed ne pose
 * QUE de quoi ouvrir l'application :
 *
 *   - le tenant (l'organisation) ;
 *   - les comptes de connexion admin + valideur (circuit soumetteur ≠ valideur).
 *
 * AUCUN référentiel, partenaire, site, contrat, rapport, visite… L'app s'ouvre
 * entièrement vide. Tout le reste (types de partenaires, activités, découpage
 * Région→District, bureaux, MMR, partenaires…) se crée ensuite DEPUIS MEMS, en
 * tant qu'administrateur (Paramétrage).
 *
 * Idempotent : réutilise le tenant / les comptes existants.
 * À lancer sur une base fraîchement migrée :
 *     npm run migrate && npm run seed:blank
 */
require('dotenv').config();
const { Client } = require('pg');
const bcrypt = require('bcryptjs');
const logger = require('../config/logger');
const { requireConnString, explainConnError } = require('../config/connString');

async function main() {
  const client = new Client({ connectionString: requireConnString('DATABASE_URL') });
  await client.connect();
  try {
    // Idempotent : réutiliser le tenant existant s'il y en a un (tenants.name
    // n'a pas de contrainte UNIQUE — un ON CONFLICT créerait un doublon).
    const existingTenant = await client.query(
      'SELECT id FROM tenants WHERE name = $1 ORDER BY created_at LIMIT 1', ['Bureau de Toliara']);
    const tenantId = existingTenant.rows[0]
      ? existingTenant.rows[0].id
      : (await client.query('INSERT INTO tenants (name) VALUES ($1) RETURNING id', ['Bureau de Toliara'])).rows[0].id;

    const passwordHash = await bcrypt.hash('changeme123', 10);
    for (const [email, role] of [['admin@mems.mg', 'admin'], ['validateur@mems.mg', 'validator']]) {
      await client.query(
        `INSERT INTO users (tenant_id, email, password_hash, role) VALUES ($1,$2,$3,$4)
         ON CONFLICT (tenant_id, email) DO NOTHING`, [tenantId, email, passwordHash, role]);
    }

    logger.info(
      { tenantId, admin: 'admin@mems.mg / changeme123', validator: 'validateur@mems.mg / changeme123' },
      'seed vierge terminé : tenant + comptes en place, aucune donnée (à configurer depuis MEMS)');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  const explained = explainConnError(err, 'DATABASE_URL');
  if (explained) logger.error(`Seed impossible : ${explained}`);
  else if (/manquant|invalide/i.test(err.message || '')) logger.error(`Seed impossible : ${err.message}`);
  else logger.error({ err }, 'seed vierge échoué');
  process.exit(1);
});
