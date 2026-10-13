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
  {
    // R3 : MOIS DE COLLECTE des formulaires déjà reçus (retour n° 35, migration 060). Le mois
    // était celui de la réception par le serveur (_submission_time) ; il devient celui de la date
    // d'enquête quand elle est plausible (collectionDate.collectionMonth), et le mois de réception
    // est gardé à part (upload_month). Recalculé depuis les réponses brutes, lignes changées
    // seulement, par lots ; rejoué, ne trouve plus rien à changer (idempotent).
    key: 'r3_mois_de_collecte',
    run: repairCollectionMonths,
  },
];

/**
 * R3 — pour chaque fiche du client, mois de collecte recalculé (monitoring.repository
 * .rederiveCollectionDatesTx). Le verrou des rattachements est pris D'ABORD, comme tout
 * écrivain de soumissions (CLAUDE.md : lockSubmissionLinksTx), puis les fiches une par une
 * sur le même client, l'une après l'autre.
 * @param {{ monitoring?: object, places?: object }} [deps]  injection pour les tests
 */
async function repairCollectionMonths(client, tenantId, deps = {}) {
  const monitoring = deps.monitoring || require('../modules/monitoring/monitoring.repository');
  const places = deps.places || require('../modules/settings/placeMatch.repository');
  await places.lockSubmissionLinksTx(client, tenantId);
  const { rows: forms } = await client.query('SELECT id FROM monitoring_forms WHERE tenant_id = $1 ORDER BY id', [tenantId]);
  const out = { forms: forms.length, submissions: 0, updated: 0, monthChanged: 0, unreadable: 0, undated: 0 };
  for (const f of forms) {
    const r = await monitoring.rederiveCollectionDatesTx(client, tenantId, f.id);
    out.submissions += r.total;
    out.updated += r.updates;
    out.monthChanged += r.monthChanged;
    out.unreadable += r.unreadable;
    out.undated += r.undated;
  }
  return out;
}

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

module.exports = { runDataRepairs, REPAIRS, repairCollectionMonths };
