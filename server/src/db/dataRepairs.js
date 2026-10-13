/**
 * Réparations de DONNÉES exécutées une fois par client, par l'API au démarrage
 * (après les migrations de schéma, qui ne savent faire que du SQL). Exemple :
 * relire les colonnes typées des formulaires déjà importés quand de nouveaux
 * noms de colonnes Kobo sont reconnus — sans demander de réimport.
 *
 * Fiabilité : chaque réparation tourne dans la transaction du client (tout ou
 * rien, RLS active), sous verrou consultatif (plusieurs instances de l'API ne
 * la jouent pas deux fois), et n'est marquée faite (data_repairs) qu'en cas de
 * succès. Un échec est journalisé et retenté au prochain démarrage.
 */
const logger = require('../config/logger');
const { pool, withTenantTransaction } = require('../config/db');

const REPAIRS = [
  {
    // R1 : colonnes réelles des exports (Adm1Code_gd, DPName, POIName, @_uuid…) et sites des formulaires.
    key: 'r1_colonnes_reelles_et_sites',
    async run(client, tenantId) {
      const monitoring = require('../modules/monitoring/monitoring.repository');
      const places = require('../modules/settings/placeMatch.repository');
      // Verrou des rattachements pris EN PREMIER, avant toute ligne de site verrouillée : même ordre que
      // les écritures de l'API (withSubmissionLinks), donc jamais d'interblocage avec elles.
      await places.lockSubmissionLinksTx(client, tenantId);
      await places.applySitesGeoTx(client, tenantId); // communes des sites à jour avant d'y chercher les sites
      const { rows: forms } = await client.query('SELECT id FROM monitoring_forms WHERE tenant_id = $1', [tenantId]);
      let updated = 0;
      for (const f of forms) updated += (await monitoring.reliftSubmissionsTx(client, tenantId, f.id)).updated;
      const geo = await places.applySubmissionsGeoTx(client, tenantId);
      return { forms: forms.length, updated, offices: geo.withOffice, sites: geo.sites };
    },
  },
  {
    // R2 : partenaire et agent MEMS des formulaires déjà reçus (correspondances, migration 059).
    key: 'r2_partenaires_agents',
    async run(client, tenantId) {
      const places = require('../modules/settings/placeMatch.repository');
      return places.applySubmissionPartiesTx(client, tenantId);
    },
  },
];

async function runDataRepairs({ repairs = REPAIRS } = {}) {
  const { rows: tenants } = await pool.query('SELECT id FROM tenants');
  for (const t of tenants) {
    for (const r of repairs) {
      try {
        const result = await withTenantTransaction(t.id, async (client) => {
          await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`data_repair:${r.key}:${t.id}`]);
          const { rows } = await client.query('SELECT 1 FROM data_repairs WHERE tenant_id = $1 AND key = $2', [t.id, r.key]);
          if (rows.length) return null;
          const out = await r.run(client, t.id);
          await client.query('INSERT INTO data_repairs (tenant_id, key, result) VALUES ($1, $2, $3)', [t.id, r.key, JSON.stringify(out || {})]);
          return out;
        });
        if (result) logger.info({ tenant: t.id, repair: r.key, result }, 'réparation de données effectuée');
      } catch (err) {
        logger.error({ err, tenant: t.id, repair: r.key }, 'réparation de données en échec (retentée au prochain démarrage)');
      }
    }
  }
}

module.exports = { runDataRepairs, REPAIRS };
