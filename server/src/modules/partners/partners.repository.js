const { withTenantTransaction } = require('../../config/db');
const { badRequest, conflict, notFound } = require('../../middleware/errors');
const { MONITORING_LINE } = require('../contracts/budgetCatalog');
const { contractReferenceSql } = require('../contracts/contractNoSql');
const { REALISED_STATUS, PENDING_STATUS } = require('../tpm/realised');
const { shapeTimeline, holderInternalGroups, internalCounts, internalByMonth } = require('./partnerSheet');
const places = require('../settings/placeMatch.repository');
const { providerLinksTx, contractTpmViewsTx } = require('../tpm/activeProvider.repository');
const { monthWithin } = require('../common/periodSql');
const { followedSql, timelineTrainingSql, heldSql } = require('../trainings/trainingSql');
const { roleForUpdateTx, restampIfRoleChangedTx, nameChanges, roleAfter } = require('./partnerRole');
const { stubNotApplicableSql, stubNotTpmSql, stubLateSql } = require('../tpm/reportExpectationSql');
const { contractCoversMonthSql } = require('../tpm/activeProviderSql');
const { localDay } = require('../common/localDay');
const { addMonths } = require('../common/period');

/**
 * Jour et 1ᵉʳ du mois LOCAUX de l'application (common/localDay, APP_TIMEZONE) — jamais la date de la base, qui
 * suit le fuseau de la session (UTC) : liste, fiche et onglet Contrats lisent la même horloge (relecture
 * croisée, point 14). Passés en paramètres liés.
 */
function localClock() {
  const today = localDay();
  return { today, month0: `${today.slice(0, 7)}-01` };
}

/**
 * Fiche partenaire 360° et équipe — seul fichier du module qui écrit du SQL.
 * Chaque sous-requête filtre tenant_id = $1 (en plus de la RLS) ; l'assemblage
 * est pur (partnerSheet.js).
 */

const PARTNER_COLS = `p.id, p.name, p.short_name AS "shortName", p.partner_type_id AS "partnerTypeId", t.code AS "typeCode",
  t.label AS "typeLabel", p.active, p.daily_rate AS "dailyRate", p.legal_id AS "legalId", p.address,
  p.contact_name AS "contactName", p.contact_phone AS "contactPhone", p.contact_email AS "contactEmail",
  p.started_on AS "startedOn", p.notes, p.created_at AS "createdAt"`;

// Ce qui touche un partenaire, quel que soit son rôle (retour 113) : ce qu'il fait comme TPM (il est
// le prestataire de la visite, du plan, du rapport) OU ce qui porte sur un contrat dont il est le
// TITULAIRE (partenaire de mise en œuvre : plans et factures de son TPM, visites de ses zones).
// Le partenaire est toujours $2, le compte $1.
const HELD_SQL = 'SELECT hc.id FROM contracts hc WHERE hc.tenant_id = $1 AND hc.partner_id = $2';
const visitOf = (a) => `(${a}.provider_id = $2 OR ${a}.contract_id IN (${HELD_SQL}))`;
const docOf = (a) => `(${a}.partner_id = $2 OR ${a}.contract_id IN (${HELD_SQL}))`;

async function getPartnerTx(client, tenantId, id) {
  const { rows } = await client.query(
    `SELECT ${PARTNER_COLS} FROM partners p JOIN partner_types t ON t.id = p.partner_type_id AND t.tenant_id = p.tenant_id
      WHERE p.tenant_id = $1 AND p.id = $2`, [tenantId, id]);
  return rows[0] || null;
}

/**
 * Fiche 360° (lot 8, retour 28.1) — lectures brutes d'UNE transaction ; l'assemblage est pur
 * (partnerSheet.buildSheet, appelé par le service). Les contrats du prestataire sont ceux de
 * la règle commune « prestataire actif » (titulaire, ou rattaché par ses plans, rapports ou
 * visites : tpm/activeProvider) — un TPM qui facture sur le contrat d'un autre partenaire
 * retrouve donc son contrat.
 */
async function sheet(tenantId, id) {
  return withTenantTransaction(tenantId, async (client) => {
    const partner = await getPartnerTx(client, tenantId, id);
    if (!partner) return null;
    const links = await providerLinksTx(client, tenantId, { partnerId: id });
    const contracts = await contractFiguresTx(client, tenantId, id, links.map((l) => l.contractId));
    // Mois et jour LOCAUX de l'application (common/localDay), jamais la date de la session (UTC) : le même
    // mois courant que les rapports attendus et les alertes (relecture croisée, point 14).
    const { today, month0 } = localClock();
    const month = today.slice(0, 7);
    // Suivi interne des zones de ses contrats (retour 114) sur les 12 derniers mois : mois courant à part,
    // réalisées et sites réalisés ajoutés aux chiffres sur 12 mois (relecture croisée, point 8).
    const internal = internalCounts(await holderInternalGroupsTx(client, tenantId, id, { from: addMonths(month, -11), to: month }), month);
    const { rows: [counts] } = await client.query(
      `SELECT to_char($3::date, 'YYYY-MM') AS month, to_char($4::date, 'YYYY-MM-DD') AS today,
              (SELECT count(*) FROM site_visits v WHERE v.tenant_id = $1 AND ${visitOf('v')}
                 AND v.period_month = $3::date AND v.status <> 'annule')::int AS "visitsAssigned",
              (SELECT count(*) FROM site_visits v WHERE v.tenant_id = $1 AND ${visitOf('v')}
                 AND v.period_month = $3::date AND v.status = 'realise')::int AS "visitsRealised",
              (SELECT count(*) FROM site_visits v WHERE v.tenant_id = $1 AND ${visitOf('v')} AND v.status = 'realise'
                 AND v.period_month >= $3::date - interval '11 months')::int AS "visitsRealised12",
              (SELECT count(*) FROM (SELECT v.site_id FROM site_visits v WHERE v.tenant_id = $1 AND ${visitOf('v')}
                   AND v.status = 'realise' AND v.period_month >= $3::date - interval '11 months'
                 UNION SELECT unnest($5::uuid[])) fs)::int AS "sitesFollowed",
              (SELECT count(*) FROM monitoring_submissions s WHERE s.tenant_id = $1 AND s.partner_id = $2 AND NOT s.excluded
                 AND s.period_month >= $3::date - interval '11 months')::int AS "submissions12",
              (SELECT count(*) FROM monitoring_submissions s WHERE s.tenant_id = $1 AND s.partner_id = $2 AND s.excluded
                 AND s.period_month >= $3::date - interval '11 months')::int AS "submissionsExcluded12",
              (SELECT count(*) FROM tpm_agents a WHERE a.tenant_id = $1 AND a.tpm_provider_id = $2 AND a.active)::int AS "agentsActive",
              (SELECT count(*) FROM tpm_agents a WHERE a.tenant_id = $1 AND a.tpm_provider_id = $2)::int AS "agentsTotal",
              (SELECT count(*) FROM tpm_collection_plans pl WHERE pl.tenant_id = $1 AND ${docOf('pl')})::int AS plans,
              (${TRAININGS_COUNT_SQL})::int AS trainings,
              (SELECT count(*) FROM tpm_provider_evaluations e WHERE e.tenant_id = $1 AND e.partner_id = $2)::int AS evaluations`,
      [tenantId, id, month0, today, internal.internalSites12]);
    const { internalSites12: _sites, ...internalFacts } = internal;
    Object.assign(counts, internalFacts);
    // Un gabarit « attendu » sans visite planifiée : « non applicable » d'office ; échéance passée : « en retard »
    // (retour 114, même règle que la carte « Rapports attendus » : tpm/reportExpectationSql).
    const { rows: reports } = await client.query(
      `SELECT r.kind, CASE WHEN ${stubNotApplicableSql('r')} THEN 'non_applicable'
                           WHEN ${stubLateSql('r', today.slice(0, 7))} THEN 'en_retard' ELSE r.status END AS status, count(*)::int AS n
         FROM tpm_reports r
        WHERE r.tenant_id = $1 AND ${docOf('r')} GROUP BY 1, 2`, [tenantId, id]);
    const { rows: [lastEval] } = await client.query(
      `SELECT e.id, to_char(e.period_from, 'YYYY-MM') AS "from", to_char(e.period_to, 'YYYY-MM') AS "to",
              e.final_score AS score, e.band, e.status
         FROM tpm_provider_evaluations e WHERE e.tenant_id = $1 AND e.partner_id = $2 AND e.status = 'validee'
        ORDER BY e.period_to DESC, e.validated_at DESC LIMIT 1`, [tenantId, id]);
    const ids = links.map((l) => l.contractId);
    const { rows: zones } = await client.query(
      `SELECT DISTINCT COALESCE(ar.path, ca.path) AS path FROM contract_areas ca
         LEFT JOIN admin_areas ar ON ar.id = ca.admin_area_id AND ar.tenant_id = ca.tenant_id
        WHERE ca.tenant_id = $1 AND ca.contract_id = ANY($2::uuid[])`, [tenantId, ids]);
    const { rows: districts } = await client.query(
      `SELECT DISTINCT NULLIF(s.adm1, '') AS region, COALESCE(NULLIF(s.adm2, ''), s.district) AS district
         FROM site_visits v JOIN sites s ON s.id = v.site_id AND s.tenant_id = v.tenant_id
        WHERE v.tenant_id = $1 AND ${visitOf('v')} AND v.status <> 'annule'
          AND v.period_month >= $3::date - interval '11 months'`, [tenantId, id, month0]);
    // TPM de chaque contrat (retour 113, règle commune) : le titulaire voit son TPM, le TPM le titulaire.
    const { views, partners } = await contractTpmViewsTx(client, tenantId, contracts.map((c) => ({ id: c.id, partnerId: c.holderId })));
    return {
      partner, links, contracts, counts, reports, lastEval: lastEval || null, zones: zones.map((z) => z.path), districts,
      tpmViews: views, partnerTypes: new Map(partners.map((p) => [p.id, p.typeCode])),
    };
  });
}

/**
 * Visites SUIVIES EN INTERNE des zones des contrats que le partenaire TIENT, de `from` à `to` (« AAAA-MM »),
 * en groupes mois × statut × origine × zone (comptes en SQL) : contrats tenus (actifs ou résiliés) pour
 * pré-filtrer par zone, puis la règle d'attribution (tableForSitesTx + cellForSite, comme l'estampille)
 * au mois de chaque groupe ; partnerSheet.holderInternalGroups décide (prévues : cellule d'aujourd'hui ;
 * réalisées : estampille figée). Lecture seule.
 * @returns {Promise<{ month, status, n, sites: string[], reason }[]>}
 */
async function holderInternalGroupsTx(client, tenantId, partnerId, { from, to }) {
  const ym = /^\d{4}-\d{2}$/;
  if (!ym.test(String(from || '')) || !ym.test(String(to || ''))) return [];
  const { rows: held } = await client.query(
    "SELECT id FROM contracts WHERE tenant_id = $1 AND partner_id = $2 AND status IN ('actif', 'resilie')", [tenantId, partnerId]);
  if (!held.length) return [];
  const { rows: groups } = await client.query(
    `SELECT to_char(v.period_month, 'YYYY-MM') AS month, v.status, v.provider_source AS source, v.provider_zone_state AS "zoneState",
            s.zone_district_id AS "districtId", s.zone_commune_id AS "communeId", count(*)::int AS n,
            COALESCE(array_agg(DISTINCT v.site_id) FILTER (WHERE v.status = 'realise'), '{}'::uuid[]) AS sites
       FROM site_visits v JOIN sites s ON s.tenant_id = v.tenant_id AND s.id = v.site_id
       LEFT JOIN admin_areas da ON da.tenant_id = s.tenant_id AND da.id = s.zone_district_id
       LEFT JOIN admin_areas ca ON ca.tenant_id = s.tenant_id AND ca.id = s.zone_commune_id
      WHERE v.tenant_id = $1 AND v.period_month BETWEEN $3::date AND $4::date AND v.monitored_by = 'interne'
        AND v.provider_source IN ('zone', 'visite') AND v.status <> 'annule'
        AND EXISTS (SELECT 1 FROM contract_areas z
                     WHERE z.tenant_id = $1 AND z.contract_id = ANY ($2::uuid[])
                       AND (z.admin_area_id IN (s.zone_district_id, s.zone_commune_id)
                            OR z.admin_area_id = ANY (COALESCE(da.lineage, '{}')) OR z.admin_area_id = ANY (COALESCE(ca.lineage, '{}'))))
      GROUP BY 1, 2, 3, 4, 5, 6`,
    [tenantId, held.map((h) => h.id), `${from}-01`, `${to}-01`]);
  if (!groups.length) return [];
  const attribution = require('../tpm/tpmAttribution.repository');
  const { cellForSite } = require('../tpm/tpmAttribution');
  const { table } = await attribution.tableForSitesTx(client, tenantId, { zones: groups, months: groups.map((g) => g.month) });
  return holderInternalGroups(groups.map((g) => ({ ...g, cell: cellForSite(g, g.month, table) })), held.map((h) => h.id));
}

/**
 * Liste des partenaires (Prestataires TPM, lot 8) : compteurs agrégés en SQL par partenaire
 * (agents actifs, visites réalisées et formulaires reçus sur 12 mois, rapports à valider,
 * dernière note validée) et liens de contrats pour le statut « actif selon contrat ».
 */
async function providersList(tenantId) {
  return withTenantTransaction(tenantId, async (client) => {
    const { today, month0 } = localClock();
    const { rows } = await client.query(
      `SELECT p.id, p.name, p.short_name AS "shortName", t.code AS "typeCode", t.label AS "typeLabel", p.active,
              p.contract_ref AS "contractRef", $4::text AS today,
              (SELECT count(*) FROM tpm_agents a WHERE a.tenant_id = $1 AND a.tpm_provider_id = p.id AND a.active)::int AS "agentsActive",
              (SELECT count(*) FROM site_visits v WHERE v.tenant_id = $1 AND v.provider_id = p.id AND v.status = 'realise'
                 AND v.period_month >= $3::date - interval '11 months')::int AS "visitsRealised12",
              (SELECT count(*) FROM monitoring_submissions s WHERE s.tenant_id = $1 AND s.partner_id = p.id AND NOT s.excluded
                 AND s.period_month >= $3::date - interval '11 months')::int AS "submissions12",
              (SELECT count(*) FROM tpm_reports r WHERE r.tenant_id = $1 AND r.partner_id = p.id AND r.status = $2)::int AS "reportsToValidate",
              ev.final_score::float8 AS "lastScore", ev.band AS "lastBand", to_char(ev.period_to, 'YYYY-MM') AS "lastScoreTo",
              (SELECT count(DISTINCT COALESCE(z.admin_area_id::text, z.path)) FROM contract_areas z
                 JOIN contracts zc ON zc.id = z.contract_id AND zc.tenant_id = z.tenant_id
                WHERE z.tenant_id = $1 AND zc.partner_id = p.id AND ${contractCoversMonthSql('zc', '$3::date')})::int AS "zonesActive"
         FROM partners p
         JOIN partner_types t ON t.id = p.partner_type_id AND t.tenant_id = p.tenant_id
         LEFT JOIN LATERAL (SELECT e.final_score, e.band, e.period_to FROM tpm_provider_evaluations e
                             WHERE e.tenant_id = $1 AND e.partner_id = p.id AND e.status = 'validee'
                             ORDER BY e.period_to DESC, e.validated_at DESC LIMIT 1) ev ON true
        WHERE p.tenant_id = $1
        ORDER BY p.name`, [tenantId, PENDING_STATUS, month0, today]);
    const links = await providerLinksTx(client, tenantId);
    // Contrats ACTIFS et leur TPM (retour 113) : contrats tenus, contrats suivis, TPM d'un titulaire. « Actif » =
    // la règle commune des dates (activeProvider.contractCoversMonth, jumelle SQL) — comme le statut de la ligne :
    // un contrat échu mais encore « actif » n'y figure plus.
    const { rows: contracts } = await client.query(
      `SELECT c.id, c.numero, c.numero_fla AS "numeroFla", c.partner_id AS "partnerId",
              COALESCE(p.name, c.partner_name) AS "partnerName", c.status
         FROM contracts c LEFT JOIN partners p ON p.id = c.partner_id AND p.tenant_id = c.tenant_id
        WHERE c.tenant_id = $1 AND ${contractCoversMonthSql('c', '$2::date')} ORDER BY c.numero_fla NULLS LAST, c.numero`, [tenantId, month0]);
    const { views } = await contractTpmViewsTx(client, tenantId, contracts);
    return { rows, links, contracts, views };
  });
}

// Sessions de formation suivies par les agents du prestataire (formations en sessions, retour 28.2) :
// prestataire de l'agent AU MOMENT de la session (training_participants.provider_id) ; « suivie » =
// définition commune trainingSql.followedSql (session tenue, ni annulée, ni participant absent).
const TRAININGS_COUNT_SQL = `SELECT count(DISTINCT p.session_id) FROM training_participants p
   JOIN training_sessions ts ON ts.id = p.session_id AND ts.tenant_id = p.tenant_id
   WHERE p.tenant_id = $1 AND p.provider_id = $2 AND ${followedSql('ts', 'p')}`;

/**
 * Chiffres de chaque contrat du prestataire, en CENTIMES entiers (sommes SQL, jamais en JS) :
 * total direct, ligne de suivi (IV.suivi), Réalisé du prestataire (factures validées, définition
 * unique tpm/realised), en attente, Réalisé de tout le contrat, et Planifié du prestataire (part
 * bailleur de ses plans de collecte, comme la Consolidation).
 */
async function contractFiguresTx(client, tenantId, partnerId, contractIds) {
  if (!contractIds.length) return [];
  const { rows } = await client.query(
    `SELECT c.id, c.numero, c.numero_fla AS "numeroFla", ${contractReferenceSql('c')} AS reference,
            c.status, c.partner_id AS "holderId", c.partner_name AS "holderName",
            c.date_debut AS "dateDebut", c.date_fin AS "dateFin", c.termination_date AS "terminationDate",
            c.management_fee_pct AS "feePct", c.period_months AS "periodMonths",
            COALESCE((SELECT sum(round(b.unit_count * b.unit_cost * 100)) FROM contract_budget_items b
                       WHERE b.tenant_id = $1 AND b.contract_id = c.id), 0)::bigint AS "directCents",
            COALESCE((SELECT sum(round(b.unit_count * b.unit_cost * 100)) FROM contract_budget_items b
                       WHERE b.tenant_id = $1 AND b.contract_id = c.id AND b.line_code = $4), 0)::bigint AS "monitoringCents",
            COALESCE((SELECT sum(round(r.reported_amount * 100)) FROM tpm_reports r WHERE r.tenant_id = $1 AND r.contract_id = c.id
                       AND r.partner_id = $2 AND r.kind = 'financier' AND r.status = $5), 0)::bigint AS "providerActualCents",
            COALESCE((SELECT sum(round(r.reported_amount * 100)) FROM tpm_reports r WHERE r.tenant_id = $1 AND r.contract_id = c.id
                       AND r.partner_id = $2 AND r.kind = 'financier' AND r.status = $6), 0)::bigint AS "providerPendingCents",
            COALESCE((SELECT sum(round(r.reported_amount * 100)) FROM tpm_reports r WHERE r.tenant_id = $1 AND r.contract_id = c.id
                       AND r.kind = 'financier' AND r.status = $5), 0)::bigint AS "contractActualCents",
            COALESCE((SELECT round(sum(i.unit_count * i.unit_cost * i.bailleur_pct) * 100) FROM tpm_collection_plans pl
                       JOIN tpm_collection_plan_items i ON i.plan_id = pl.id AND i.tenant_id = pl.tenant_id
                      WHERE pl.tenant_id = $1 AND pl.contract_id = c.id AND pl.partner_id = $2), 0)::bigint AS "providerPlannedCents"
       FROM contracts c WHERE c.tenant_id = $1 AND c.id = ANY($3::uuid[])
      ORDER BY c.date_debut DESC, c.numero`,
    [tenantId, partnerId, contractIds, MONITORING_LINE, REALISED_STATUS, PENDING_STATUS]);
  return rows;
}

/** Contrats du prestataire (onglet Contrats) : liens + chiffres, en une transaction. */
async function contractsOf(tenantId, id) {
  return withTenantTransaction(tenantId, async (client) => {
    if (!(await getPartnerTx(client, tenantId, id))) return null;
    const links = await providerLinksTx(client, tenantId, { partnerId: id });
    const contracts = await contractFiguresTx(client, tenantId, id, links.map((l) => l.contractId));
    const { today } = localClock(); // même horloge que la fiche et la liste (jamais la date de la session)
    const { views, partners } = await contractTpmViewsTx(client, tenantId, contracts.map((c) => ({ id: c.id, partnerId: c.holderId })));
    return { links, contracts, today, tpmViews: views, partnerTypes: new Map(partners.map((p) => [p.id, p.typeCode])) };
  });
}

/** Rapports et factures du prestataire (onglet Rapports & factures), du plus récent au plus ancien. */
async function reportsOf(tenantId, id) {
  return withTenantTransaction(tenantId, async (client) => {
    if (!(await getPartnerTx(client, tenantId, id))) return null;
    const { rows } = await client.query(
      `SELECT r.id, r.kind, r.status, to_char(r.period_month, 'YYYY-MM') AS month, r.invoice_no AS "invoiceNo",
              r.reported_amount::float8 AS "reportedAmount", r.planned_amount::float8 AS "plannedAmount",
              r.contract_id AS "contractId", c.numero AS "contractNumero", c.numero_fla AS "contractFla",
              c.partner_name AS "holderName", r.partner_id AS "tpmId", pa.name AS "tpmName", r.submitted_at AS "submittedAt",
              r.decided_at AS "decidedAt", r.updated_at AS "updatedAt", ${stubNotApplicableSql('r')} AS "autoNotApplicable",
              ${stubNotTpmSql('r')} AS "partnerNotTpm", ${stubLateSql('r', localDay().slice(0, 7))} AS late
         FROM tpm_reports r JOIN contracts c ON c.id = r.contract_id AND c.tenant_id = r.tenant_id
         LEFT JOIN partners pa ON pa.id = r.partner_id AND pa.tenant_id = r.tenant_id
        WHERE r.tenant_id = $1 AND ${docOf('r')}
        ORDER BY r.period_month DESC, r.kind, c.numero LIMIT 500`, [tenantId, id]);
    return rows;
  });
}

/**
 * Plans de collecte du partenaire (onglet Plans, factures et rapports, retour 113) : ses plans comme
 * TPM et ceux des contrats dont il est titulaire. Planifié = part bailleur des postes (comme la
 * Consolidation), sommé en SQL.
 */
async function plansOf(tenantId, id) {
  return withTenantTransaction(tenantId, async (client) => {
    if (!(await getPartnerTx(client, tenantId, id))) return null;
    const { rows } = await client.query(
      `SELECT pl.id, to_char(pl.period_month, 'YYYY-MM') AS month, pl.title, pl.status,
              pl.contract_id AS "contractId", c.numero AS "contractNumero", c.numero_fla AS "contractFla", c.partner_name AS "holderName",
              pl.partner_id AS "tpmId", pa.name AS "tpmName",
              COALESCE((SELECT sum(i.unit_count * i.unit_cost * i.bailleur_pct) FROM tpm_collection_plan_items i
                         WHERE i.tenant_id = pl.tenant_id AND i.plan_id = pl.id), 0)::float8 AS "plannedFunder"
         FROM tpm_collection_plans pl
         JOIN contracts c ON c.id = pl.contract_id AND c.tenant_id = pl.tenant_id
         LEFT JOIN partners pa ON pa.id = pl.partner_id AND pa.tenant_id = pl.tenant_id
        WHERE pl.tenant_id = $1 AND ${docOf('pl')}
        ORDER BY pl.period_month DESC, c.numero LIMIT 500`, [tenantId, id]);
    return rows;
  });
}

/**
 * Suivis effectués sur une période (onglet Suivis effectués) : visites par mois (prévues,
 * réalisées, annulées, sites distincts réalisés) et formulaires reçus reliés au prestataire
 * (monitoring_submissions.partner_id) par mois et par fiche. Agrégés en SQL.
 */
async function followups(tenantId, id, period) {
  return withTenantTransaction(tenantId, async (client) => {
    if (!(await getPartnerTx(client, tenantId, id))) return null;
    const vp = [tenantId, id];
    const { rows: visits } = await client.query(
      `SELECT to_char(v.period_month, 'YYYY-MM') AS month,
              count(*) FILTER (WHERE v.status = 'planifie')::int AS planned,
              count(*) FILTER (WHERE v.status = 'realise')::int AS realised,
              count(*) FILTER (WHERE v.status = 'annule')::int AS cancelled,
              count(DISTINCT v.site_id) FILTER (WHERE v.status = 'realise')::int AS sites
         FROM site_visits v WHERE v.tenant_id = $1 AND ${visitOf('v')} AND ${monthWithin('v.period_month', period, vp)}
        GROUP BY v.period_month ORDER BY v.period_month`, vp);
    const sp = [tenantId, id];
    const { rows: subsByMonth } = await client.query(
      `SELECT to_char(s.period_month, 'YYYY-MM') AS month,
              count(*) FILTER (WHERE NOT s.excluded)::int AS valid, count(*) FILTER (WHERE s.excluded)::int AS excluded
         FROM monitoring_submissions s WHERE s.tenant_id = $1 AND s.partner_id = $2 AND ${monthWithin('s.period_month', period, sp)}
        GROUP BY s.period_month ORDER BY s.period_month`, sp);
    const fp = [tenantId, id];
    const { rows: forms } = await client.query(
      `SELECT f.id AS "formId", f.code, f.label,
              count(*) FILTER (WHERE NOT s.excluded)::int AS valid, count(*) FILTER (WHERE s.excluded)::int AS excluded,
              count(DISTINCT s.agent_id)::int AS agents, count(DISTINCT s.site_id)::int AS sites,
              to_char(min(s.period_month), 'YYYY-MM') AS "firstMonth", to_char(max(s.period_month), 'YYYY-MM') AS "lastMonth"
         FROM monitoring_submissions s JOIN monitoring_forms f ON f.id = s.form_id AND f.tenant_id = s.tenant_id
        WHERE s.tenant_id = $1 AND s.partner_id = $2 AND ${monthWithin('s.period_month', period, fp)}
        GROUP BY f.id ORDER BY f.label`, fp);
    // Visites suivies en interne des zones de ses contrats (retour 114), par mois, à part (point 8) :
    // la même règle que la fiche (holderInternalGroupsTx).
    const internal = internalByMonth(await holderInternalGroupsTx(client, tenantId, id, period));
    return { visits, internal, submissions: subsByMonth, forms };
  });
}

/**
 * Frise du parcours, assemblée en SQL (UNION ALL triée et bornée à 24 mois),
 * paginée par date (`before`) et par 50.
 */
async function timeline(tenantId, id, { before = null, limit = 50 } = {}) {
  return withTenantTransaction(tenantId, async (client) => {
    if (!(await getPartnerTx(client, tenantId, id))) return null;
    const { rows } = await client.query(
      `SELECT * FROM (
         SELECT h.created_at AS at, 'contrat' AS kind, h.action AS code, c.numero AS label, c.id::text AS ref, NULL::text AS extra
           FROM contract_history h JOIN contracts c ON c.id = h.contract_id AND c.tenant_id = h.tenant_id
          WHERE h.tenant_id = $1 AND c.partner_id = $2
         UNION ALL
         SELECT COALESCE(r.submitted_at, r.created_at), 'facture', 'soumis', NULL, r.id::text, to_char(r.period_month, 'MM/YYYY')
           FROM tpm_reports r WHERE r.tenant_id = $1 AND ${docOf('r')} AND r.kind = 'financier' AND r.status IN ('soumis', 'valide', 'rejete')
         UNION ALL
         SELECT r.decided_at, 'facture', r.status, NULL, r.id::text, to_char(r.period_month, 'MM/YYYY')
           FROM tpm_reports r WHERE r.tenant_id = $1 AND ${docOf('r')} AND r.kind = 'financier' AND r.status IN ('valide', 'rejete') AND r.decided_at IS NOT NULL
         UNION ALL
         SELECT min(v.period_month)::timestamptz, 'terrain', 'debut', COALESCE(NULLIF(s.adm2, ''), s.district), NULL, count(*)::text
           FROM site_visits v JOIN sites s ON s.id = v.site_id AND s.tenant_id = v.tenant_id
          WHERE v.tenant_id = $1 AND ${visitOf('v')} AND v.status <> 'annule'
          GROUP BY COALESCE(NULLIF(s.adm2, ''), s.district)
         UNION ALL
         SELECT max(v.period_month)::timestamptz, 'terrain', 'dernier', COALESCE(NULLIF(s.adm2, ''), s.district), NULL, count(*)::text
           FROM site_visits v JOIN sites s ON s.id = v.site_id AND s.tenant_id = v.tenant_id
          WHERE v.tenant_id = $1 AND ${visitOf('v')} AND v.status <> 'annule'
          GROUP BY COALESCE(NULLIF(s.adm2, ''), s.district) HAVING max(v.period_month) > min(v.period_month)
         UNION ALL
         SELECT s.start_date::timestamptz, 'formation', CASE WHEN ${heldSql('s')} THEN 'formation' ELSE 'prevue' END,
                s.title, s.id::text, string_agg(a.name, ', ' ORDER BY a.name)
           FROM training_participants p
           JOIN training_sessions s ON s.id = p.session_id AND s.tenant_id = p.tenant_id
           JOIN tpm_agents a ON a.id = p.agent_id AND a.tenant_id = p.tenant_id
          WHERE p.tenant_id = $1 AND p.provider_id = $2 AND ${timelineTrainingSql('s', 'p')}
          GROUP BY s.id
         UNION ALL
         SELECT e.created_at, 'evaluation', 'evaluation', to_char(e.periode, 'MM/YYYY'), a.id::text, a.name
           FROM tpm_agent_evaluations e JOIN tpm_agents a ON a.id = e.agent_id AND a.tenant_id = e.tenant_id
          WHERE e.tenant_id = $1 AND a.tpm_provider_id = $2
       ) t
       WHERE t.at >= now() - interval '24 months' AND ($3::timestamptz IS NULL OR t.at < $3)
       ORDER BY t.at DESC LIMIT $4`,
      [tenantId, id, before, Math.min(Math.max(Number(limit) || 50, 1), 200)]);
    return shapeTimeline(rows, { limit });
  });
}

// ---- Équipe (seul endroit où l'on crée ou désactive un agent) -----------------------
/**
 * L'agent porte-t-il un historique (formations — même annulées ou absent —, évaluations, missions,
 * formulaires reçus, correspondances) ? UNE expression pour la suppression (refus) ET pour l'écran
 * (`hasHistory` : bouton « Supprimer » montré seulement quand la suppression passera).
 */
const agentHistorySql = (a) => `(EXISTS (SELECT 1 FROM tpm_agent_formations f WHERE f.tenant_id = ${a}.tenant_id AND f.agent_id = ${a}.id)
   OR EXISTS (SELECT 1 FROM training_participants tp WHERE tp.tenant_id = ${a}.tenant_id AND tp.agent_id = ${a}.id)
   OR EXISTS (SELECT 1 FROM tpm_agent_evaluations e WHERE e.tenant_id = ${a}.tenant_id AND e.agent_id = ${a}.id)
   OR EXISTS (SELECT 1 FROM tpm_assignments x WHERE x.tenant_id = ${a}.tenant_id AND x.tpm_agent_id = ${a}.id)
   OR EXISTS (SELECT 1 FROM monitoring_submissions ms WHERE ms.tenant_id = ${a}.tenant_id AND ms.agent_id = ${a}.id)
   OR EXISTS (SELECT 1 FROM monitoring_value_links vl WHERE vl.tenant_id = ${a}.tenant_id AND vl.agent_id = ${a}.id))`;

const AGENT_COLS = `a.id, a.name, a.fonction, a.code, a.phone, a.email, a.sex, a.active, a.started_on AS "startedOn",
  a.ended_on AS "endedOn", a.created_at AS "createdAt",
  (SELECT count(*) FROM training_participants f JOIN training_sessions fs ON fs.id = f.session_id AND fs.tenant_id = f.tenant_id
    WHERE f.tenant_id = a.tenant_id AND f.agent_id = a.id AND ${followedSql('fs', 'f')})::int AS trainings,
  ${agentHistorySql('a')} AS "hasHistory",
  (SELECT count(*) FROM monitoring_submissions s WHERE s.tenant_id = a.tenant_id AND s.agent_id = a.id AND NOT s.excluded)::int AS submissions`;

/** Agents d'un prestataire ; téléphone, courriel et sexe seulement pour les rôles en écriture. */
async function listAgents(tenantId, partnerId, { personal = false } = {}) {
  return withTenantTransaction(tenantId, async (client) => {
    if (!(await getPartnerTx(client, tenantId, partnerId))) return null;
    const { rows } = await client.query(
      `SELECT ${AGENT_COLS} FROM tpm_agents a WHERE a.tenant_id = $1 AND a.tpm_provider_id = $2 ORDER BY a.active DESC, a.name`,
      [tenantId, partnerId]);
    return personal ? rows : rows.map(({ phone: _p, email: _e, sex: _s, ...r }) => r);
  });
}

const DUP_CODE = 'Ce code d\'enquêteur est déjà utilisé par un autre agent de ce TPM.';

async function createAgent(tenantId, partnerId, a) {
  return places.withSubmissionLinks(tenantId, async (client) => {
    if (!(await getPartnerTx(client, tenantId, partnerId))) throw notFound('Partenaire introuvable');
    try {
      const { rows } = await client.query(
        `INSERT INTO tpm_agents (tenant_id, tpm_provider_id, name, fonction, code, phone, email, sex, active, started_on, ended_on)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, true), $10, $11) RETURNING id`,
        [tenantId, partnerId, a.name, a.fonction ?? null, a.code ?? null, a.phone ?? null, a.email ?? null, a.sex ?? null,
          a.active ?? null, a.startedOn ?? null, a.endedOn ?? null]);
      await places.relinkPartiesTx(client, tenantId); // ses formulaires déjà reçus s'y relient
      return { id: rows[0].id };
    } catch (err) {
      if (err.code === '23505') throw conflict(DUP_CODE);
      throw err;
    }
  });
}

// Mise à jour PARTIELLE : un champ absent est inchangé, null efface (sauf le nom).
const AGENT_FIELDS = { name: 'name', fonction: 'fonction', code: 'code', phone: 'phone', email: 'email', sex: 'sex',
  active: 'active', startedOn: 'started_on', endedOn: 'ended_on' };

async function updateAgent(tenantId, partnerId, agentId, patch) {
  const sets = []; const values = [];
  for (const [k, col] of Object.entries(AGENT_FIELDS)) {
    if (patch[k] === undefined || (k === 'name' && patch[k] === null) || (k === 'active' && patch[k] === null)) continue;
    values.push(patch[k]); sets.push(`${col} = $${values.length + 3}`);
  }
  const identity = sets.length > 0 && (patch.name != null || patch.code !== undefined);
  return (identity ? places.withSubmissionLinks : withTenantTransaction)(tenantId, async (client) => {
    if (!sets.length) {
      const { rowCount } = await client.query('SELECT 1 FROM tpm_agents WHERE tenant_id = $1 AND tpm_provider_id = $2 AND id = $3', [tenantId, partnerId, agentId]);
      return rowCount > 0;
    }
    try {
      const { rowCount } = await client.query(
        `UPDATE tpm_agents SET ${sets.join(', ')}, updated_at = now() WHERE tenant_id = $1 AND tpm_provider_id = $2 AND id = $3`,
        [tenantId, partnerId, agentId, ...values]);
      if (rowCount > 0 && identity) await places.relinkPartiesTx(client, tenantId);
      return rowCount > 0;
    } catch (err) {
      if (err.code === '23505') throw conflict(DUP_CODE);
      if (err.code === '23514') throw badRequest('Dates incohérentes : la sortie doit suivre l\'entrée.');
      throw err;
    }
  });
}

/** Un agent qui a un historique (formations, évaluations, affectations) se désactive, il ne se supprime pas. */
async function deleteAgent(tenantId, partnerId, agentId) {
  return places.withSubmissionLinks(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT a.id, ${agentHistorySql('a')} AS history
         FROM tpm_agents a WHERE a.tenant_id = $1 AND a.tpm_provider_id = $2 AND a.id = $3 FOR UPDATE`,
      [tenantId, partnerId, agentId]);
    if (!rows.length) return false;
    // Formations, évaluations et correspondances partiraient en cascade, les formulaires reçus perdraient
    // leur agent : un agent qui porte des données ne se supprime jamais, il se désactive.
    if (rows[0].history) throw conflict('Cet agent a un historique (formations, évaluations, missions ou formulaires reçus) : désactivez-le au lieu de le supprimer.');
    await client.query('DELETE FROM tpm_agents WHERE tenant_id = $1 AND id = $2', [tenantId, agentId]);
    await places.relinkPartiesTx(client, tenantId);
    return true;
  });
}

// ---- Identité du partenaire : mise à jour PARTIELLE (écart B4) ----------------------
const PARTNER_FIELDS = { name: 'name', shortName: 'short_name', dailyRate: 'daily_rate', legalId: 'legal_id', address: 'address',
  contactName: 'contact_name', contactPhone: 'contact_phone', contactEmail: 'contact_email', startedOn: 'started_on',
  notes: 'notes', active: 'active' };

async function updatePartner(tenantId, id, patch, { actorId = null } = {}) {
  const fields = Object.entries(PARTNER_FIELDS)
    .filter(([k]) => !(patch[k] === undefined || ((k === 'name' || k === 'active') && patch[k] === null)));
  const identity = fields.length > 0 && (patch.name != null || patch.shortName !== undefined);
  return (identity ? places.withSubmissionLinks : withTenantTransaction)(tenantId, async (client) => {
    if (!fields.length) return Boolean(await getPartnerTx(client, tenantId, id));
    // Fiche active VRAIMENT changée : verrou d'attribution d'abord, puis la ligne (partnerRole.roleForUpdateTx).
    const before = await roleForUpdateTx(client, tenantId, id, { active: patch.active });
    if (!before) return false;
    // `name` listé seulement s'il change vraiment (sinon FOR UPDATE sur la ligne — partnerRole).
    const sets = []; const values = [];
    for (const [k, col] of fields) {
      if (k === 'name' && !nameChanges(before, patch.name)) continue;
      values.push(patch[k]); sets.push(`${col} = $${values.length + 2}`);
    }
    const { rowCount } = await client.query(
      `UPDATE partners SET ${[...sets, 'updated_at = now()'].join(', ')} WHERE tenant_id = $1 AND id = $2`, [tenantId, id, ...values]);
    if (rowCount > 0 && identity) await places.relinkPartiesTx(client, tenantId); // nom ou sigle : formulaires reliés à nouveau
    // Fiche activée / désactivée = rôle de TPM changé : TPM des visites prévues recalculé (même transaction).
    if (rowCount > 0) await restampIfRoleChangedTx(client, tenantId, before, roleAfter(before, { active: patch.active }), { partnerId: id, actorId });
    return rowCount > 0;
  });
}

module.exports = { sheet, providersList, contractsOf, reportsOf, plansOf, followups, timeline, listAgents, createAgent, updateAgent, deleteAgent, updatePartner, AGENT_FIELDS, PARTNER_FIELDS };
