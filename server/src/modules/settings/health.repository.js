const { withTenantTransaction } = require('../../config/db');
const { MONITORING_LINE } = require('../contracts/budgetCatalog');
const { evaluateHealth, summarizeHealth } = require('./healthRules');

/**
 * Comptages de l'état de la configuration (GET /api/settings/health) : quelques
 * requêtes d'agrégation dans UNE transaction, toutes filtrées par tenant_id —
 * aucune boucle sur les lignes. L'interprétation est dans healthRules.js (pur).
 */
async function healthCounts(client, tenantId) {
  const [{ rows: [g] }, { rows: [sub] }, { rows: [tpm] }, { rows: [misc] }] = [
    await client.query(
      `SELECT
         (SELECT count(*) FROM admin_areas WHERE tenant_id = $1)::int AS areas_total,
         (SELECT count(*) FROM admin_areas WHERE tenant_id = $1 AND depth = 3)::int AS communes,
         (SELECT count(*) FROM admin_areas WHERE tenant_id = $1 AND depth = 3 AND pcode IS NOT NULL)::int AS communes_pcode,
         (SELECT count(*) FROM contract_areas ca JOIN contracts c ON c.id = ca.contract_id AND c.tenant_id = ca.tenant_id
           WHERE ca.tenant_id = $1 AND ca.admin_area_id IS NULL AND c.status IN ('brouillon', 'en_validation', 'actif'))::int AS detached,
         s.total AS sites_total, s.no_pcode AS sites_no_pcode, s.no_office AS sites_no_office,
         (SELECT count(*) FROM field_offices o WHERE o.tenant_id = $1 AND o.active AND NOT o.national
             AND NOT EXISTS (SELECT 1 FROM field_office_communes c WHERE c.office_id = o.id))::int AS offices_no_perimeter,
         (SELECT count(*) FROM (SELECT DISTINCT field_office_id, lower(btrim(activity)) AS a FROM sites
                                 WHERE tenant_id = $1 AND NULLIF(btrim(activity), '') IS NOT NULL) x
           WHERE NOT EXISTS (SELECT 1 FROM mmr_parameters m WHERE m.tenant_id = $1 AND lower(btrim(m.activity_category)) = x.a
                               AND (m.field_office_id = x.field_office_id OR m.field_office_id IS NULL)))::int AS activity_no_mmr,
         (SELECT count(*) FILTER (WHERE activity_category IS NULL) FROM monitoring_forms WHERE tenant_id = $1 AND active)::int AS forms_no_activity,
         (SELECT count(*) FROM monitoring_forms WHERE tenant_id = $1 AND active)::int AS forms_active
       FROM (SELECT count(*)::int AS total, count(*) FILTER (WHERE adm3_pcode IS NULL)::int AS no_pcode,
                    count(*) FILTER (WHERE field_office_id IS NULL)::int AS no_office
               FROM sites WHERE tenant_id = $1) s`, [tenantId]),
    await client.query(
      `WITH last AS (SELECT max(period_month) AS m FROM monitoring_submissions WHERE tenant_id = $1)
       SELECT count(*)::int AS total,
              count(*) FILTER (WHERE field_office_id IS NULL)::int AS no_office,
              count(*) FILTER (WHERE period_month = (SELECT m FROM last))::int AS month_total,
              count(*) FILTER (WHERE period_month = (SELECT m FROM last) AND adm3_pcode IS NULL)::int AS month_no_commune,
              to_char((SELECT m FROM last), 'YYYY-MM') AS month,
              (SELECT count(*) FROM location_match_queue q WHERE q.tenant_id = $1 AND q.status IN ('a_valider', 'ambigu', 'introuvable'))::int AS queue_entries,
              (SELECT COALESCE(sum((q.occurrences->>'sites')::int), 0) FROM location_match_queue q
                WHERE q.tenant_id = $1 AND q.status IN ('a_valider', 'ambigu', 'introuvable'))::int AS queue_sites,
              (SELECT COALESCE(sum((q.occurrences->>'soumissions')::int), 0) FROM location_match_queue q
                WHERE q.tenant_id = $1 AND q.status IN ('a_valider', 'ambigu', 'introuvable'))::int AS queue_submissions
         FROM monitoring_submissions WHERE tenant_id = $1`, [tenantId]),
    await client.query(
      `WITH tpm AS (SELECT p.id FROM partners p JOIN partner_types t ON t.id = p.partner_type_id AND t.tenant_id = p.tenant_id
                     WHERE p.tenant_id = $1 AND p.active AND t.code = 'tpm'),
            active_contracts AS (SELECT c.id, c.partner_id FROM contracts c WHERE c.tenant_id = $1 AND c.status = 'actif')
       SELECT (SELECT count(*) FROM tpm)::int AS active,
              (SELECT count(*) FROM tpm WHERE NOT EXISTS (SELECT 1 FROM tpm_agents a WHERE a.tenant_id = $1 AND a.tpm_provider_id = tpm.id))::int AS no_agent,
              (SELECT count(*) FROM tpm WHERE NOT EXISTS (SELECT 1 FROM active_contracts c WHERE c.partner_id = tpm.id))::int AS no_contract,
              (SELECT count(*) FROM active_contracts c JOIN tpm ON tpm.id = c.partner_id
                WHERE NOT EXISTS (SELECT 1 FROM contract_budget_items b WHERE b.tenant_id = $1 AND b.contract_id = c.id AND b.line_code = $2))::int AS no_line`,
      [tenantId, MONITORING_LINE]),
    await client.query(
      `WITH months AS (
         SELECT DISTINCT period_month AS m FROM tpm_collection_plans WHERE tenant_id = $1
         UNION SELECT DISTINCT period_month FROM tpm_reports WHERE tenant_id = $1 AND kind = 'financier')
       SELECT (SELECT count(*) FROM tpm_collection_plans WHERE tenant_id = $1 AND status = 'brouillon'
                 AND period_month < date_trunc('month', current_date))::int AS draft_past,
              (SELECT count(*) FROM months WHERE NOT EXISTS (SELECT 1 FROM exchange_rates r
                 WHERE r.tenant_id = $1 AND r.effective_month <= months.m AND r.usd_rate > 0))::int AS months_no_rate,
              (SELECT currency FROM country_profiles WHERE tenant_id = $1) AS currency,
              (SELECT center_lat IS NOT NULL AND center_lng IS NOT NULL FROM country_profiles WHERE tenant_id = $1) AS center,
              (SELECT count(*) FROM users WHERE tenant_id = $1 AND active AND role IN ('admin', 'manager'))::int AS validators`,
      [tenantId]),
  ];
  return {
    areas: { total: g.areas_total, communes: g.communes, communesWithPcode: g.communes_pcode },
    detachedZones: g.detached,
    sites: { total: g.sites_total, withoutPcode: g.sites_no_pcode, withoutOffice: g.sites_no_office },
    officesWithoutPerimeter: g.offices_no_perimeter,
    activityWithoutMmr: g.activity_no_mmr,
    formsWithoutActivity: g.forms_no_activity, formsActive: g.forms_active,
    queue: { entries: sub.queue_entries, sitesOcc: sub.queue_sites, submissionsOcc: sub.queue_submissions },
    submissions: { total: sub.total, withoutOffice: sub.no_office, monthTotal: sub.month_total, monthWithoutCommune: sub.month_no_commune, month: sub.month },
    tpm: { active: tpm.active, withoutAgent: tpm.no_agent, withoutContract: tpm.no_contract, contractsWithoutLine: tpm.no_line },
    draftPlansPast: misc.draft_past, monthsWithoutRate: misc.months_no_rate,
    profile: { currency: misc.currency, center: Boolean(misc.center) },
    validators: misc.validators,
  };
}

/** État de la configuration du tenant : règles + résumé. */
async function configHealth(tenantId) {
  return withTenantTransaction(tenantId, async (client) => {
    const rules = evaluateHealth(await healthCounts(client, tenantId));
    return { rules, summary: summarizeHealth(rules) };
  });
}

/** Comptages bruts de l'état des liaisons (concepteur de rapport, lot 7a) : mêmes requêtes que configHealth. */
async function linkingCounts(tenantId) {
  return withTenantTransaction(tenantId, (client) => healthCounts(client, tenantId));
}

module.exports = { configHealth, healthCounts, linkingCounts };
