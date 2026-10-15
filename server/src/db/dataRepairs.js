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
  {
    // R3 : MOIS DE COLLECTE des formulaires déjà reçus (retour n° 35, migration 060). Le mois
    // était celui de la réception par le serveur (_submission_time) ; il devient celui de la date
    // d'enquête quand elle est plausible (collectionDate.collectionMonth), et le mois de réception
    // est gardé à part (upload_month). Recalculé depuis les réponses brutes, lignes changées
    // seulement, par lots ; rejoué, ne trouve plus rien à changer (idempotent).
    key: 'r3_mois_de_collecte',
    run: repairCollectionMonths,
  },
  {
    // R4 : MOIS DE COLLECTE, règle des 2 ans (MAX_SURVEY_LAG_DAYS). R3 a déjà tourné avec
    // l'ancienne fenêtre de 92 jours, qui rangeait au mois de l'ENVOI des collectes réelles
    // envoyées tard (SMP : collectes de septembre à décembre 2025 reçues en avril 2026) ; et
    // une date d'enquête illisible masquait une suivante lisible (start, end). Même calcul que
    // R3, depuis les réponses brutes, lignes changées seulement, par lots ; idempotent.
    key: 'r4_mois_de_collecte_2ans',
    run: repairCollectionMonths,
  },
  {
    // R58 : affectation des TPM par zone (retour 58, migration 070). Zone (district / commune) de
    // chaque site — règle du lot 1b, que le SQL d'une migration ne sait pas calculer — puis TPM des
    // contrats appliqué aux visites PRÉVUES dont le TPM n'a pas été choisi avec une raison (saisi à
    // la main avant la règle, ou absent) ; chaque changement est inscrit au journal (avant → après).
    // Jamais touchées (comptées dans `kept`) : un TPM choisi avec une raison (visite, ou modification
    // de zone, qui reste la décision), une visite réalisée ou annulée, une visite déjà facturée.
    // Une transaction par compte, sous verrous ; rejouée, ne change plus rien (test/tpmRepairDb.test.js).
    key: 'r58_tpm_zones',
    run: repairTpmZones,
  },
];

/**
 * R58 — zones des sites puis TPM des contrats sur les visites prévues (voir REPAIRS). Ordre des
 * verrous de l'API : rattachements (lockSubmissionLinksTx) → attribution (applyContractsTx).
 * @param {{ places?: object, tpm?: object }} [deps]  injection pour les tests
 */
async function repairTpmZones(client, tenantId, deps = {}) {
  const places = deps.places || require('../modules/settings/placeMatch.repository');
  const tpm = deps.tpm || require('../modules/tpm/tpmAttribution.repository');
  await places.lockSubmissionLinksTx(client, tenantId); // même ordre que les écritures de sites
  const zones = await tpm.refreshSiteZonesTx(client, tenantId);
  const visits = await tpm.applyContractsTx(client, tenantId, null, { label: 'Reprise : TPM des contrats appliqué aux visites existantes (retour 58)' });
  return {
    zones: zones.changed, visits: visits.visits, converted: visits.converted, changed: visits.changed,
    byState: visits.byState, kept: visits.kept,
  };
}

/**
 * R3, R4 — pour chaque fiche du client, mois de collecte recalculé (monitoring.repository
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
  const out = {
    forms: forms.length, submissions: 0, updated: 0, monthChanged: 0, unreadable: 0, undated: 0,
    tooOld: 0, lateUpload: 0, withoutUpload: 0,
  };
  for (const f of forms) {
    const r = await monitoring.rederiveCollectionDatesTx(client, tenantId, f.id);
    out.submissions += r.total;
    out.updated += r.updates;
    for (const k of ['monthChanged', 'unreadable', 'undated', 'tooOld', 'lateUpload', 'withoutUpload']) out[k] += r[k] || 0;
  }
  return out;
}

/**
 * Joue les réparations dues : pour chaque compte, chaque réparation dans SA transaction
 * (withTenantTransaction : tout ou rien, RLS active), sous verrou consultatif propre à la
 * réparation et au compte — deux instances de l'API lancées ensemble ne la jouent qu'une fois :
 * la seconde attend le verrou puis trouve la marque (data_repairs). Marquée seulement en cas de
 * succès. Ne rejette JAMAIS : un échec (compte illisible, réparation en erreur) est journalisé,
 * les autres comptes et réparations continuent, l'API reste démarrée ; retenté au prochain démarrage.
 * @param {{ repairs?: object[], deps?: { pool?: object, withTenantTransaction?: Function, logger?: object } }} [opts]
 * @returns {Promise<{ tenant: string, key: string, status: 'done'|'skipped'|'failed', result?: object }[]>}
 */
async function runDataRepairs({ repairs = REPAIRS, deps = {} } = {}) {
  const db = { pool: deps.pool || pool, withTenantTransaction: deps.withTenantTransaction || withTenantTransaction };
  const log = deps.logger || logger;
  let tenants;
  try {
    ({ rows: tenants } = await db.pool.query('SELECT id FROM tenants ORDER BY id'));
  } catch (err) {
    log.error({ err }, 'réparations de données impossibles : comptes illisibles (retentées au prochain démarrage)');
    return [];
  }
  const report = [];
  for (const t of tenants) {
    for (const r of repairs) {
      try {
        const result = await db.withTenantTransaction(t.id, async (client) => {
          await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`data_repair:${r.key}:${t.id}`]);
          const { rows } = await client.query('SELECT 1 FROM data_repairs WHERE tenant_id = $1 AND key = $2', [t.id, r.key]);
          if (rows.length) return null;
          const out = await r.run(client, t.id);
          await client.query('INSERT INTO data_repairs (tenant_id, key, result) VALUES ($1, $2, $3)', [t.id, r.key, JSON.stringify(out || {})]);
          return out || {};
        });
        report.push({ tenant: t.id, key: r.key, status: result ? 'done' : 'skipped', ...(result ? { result } : {}) });
        if (result) log.info({ tenant: t.id, repair: r.key, result }, 'réparation de données effectuée');
      } catch (err) {
        report.push({ tenant: t.id, key: r.key, status: 'failed' });
        log.error({ err, tenant: t.id, repair: r.key }, 'réparation de données en échec (retentée au prochain démarrage)');
      }
    }
  }
  return report;
}

module.exports = { runDataRepairs, REPAIRS, repairCollectionMonths, repairTpmZones };
