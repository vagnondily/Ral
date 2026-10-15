/**
 * Planification automatique (lot 5, §§ 6–7) — SEUL endroit où s'écrit le SQL du générateur :
 * paramètres (plan_settings), chargeur des entrées, verrous des mois, visites générées et
 * trace des plans appliqués (plan_runs). Toutes les requêtes filtrent tenant_id = $1 et
 * tournent dans la transaction de l'appelant (withTenantTransaction : la RLS est le filet).
 * Requêtes bornées, SÉQUENTIELLES sur le même client (jamais Promise.all).
 */
const { COLUMNS, KEYS } = require('./planSettings');
const { chunkRows } = require('../../db/batch');
const { lockVisitMonthsTx } = require('./visitLocks');
const { activeMonthSql } = require('../common/siteActivity');

// Données rattachées AU SITE (jamais à la seule commune), hors soumissions écartées et hors
// fiches d'une autre activité — même filtre que la collecte réelle du RBM (SUBMISSION_COUNTS_FOR_SITE).
const SITE_DATA_FILTER = `ms.site_id IS NOT NULL AND NOT ms.excluded
   AND (mf.activity_category IS NULL OR s.activity IS NULL OR lower(btrim(mf.activity_category)) = lower(btrim(s.activity)))`;

/** Paramètres du compte (ligne brute) ou null. */
async function getSettingsTx(client, tenantId) {
  const { rows } = await client.query(
    `SELECT ps.*, u.full_name AS updated_by_name
       FROM plan_settings ps LEFT JOIN users u ON u.id = ps.updated_by AND u.tenant_id = ps.tenant_id
      WHERE ps.tenant_id = $1`, [tenantId]);
  return rows[0] || null;
}

/** Verrou de la ligne des paramètres (lecture pour une mise à jour). */
async function lockSettingsTx(client, tenantId) {
  const { rows } = await client.query('SELECT revision FROM plan_settings WHERE tenant_id = $1 FOR UPDATE', [tenantId]);
  return rows[0] ? rows[0].revision : 0;
}

/** Écrit les paramètres (création à la révision 1, sinon révision + 1). @returns nouvelle révision */
async function saveSettingsTx(client, tenantId, userId, settings) {
  const cols = KEYS.map((k) => COLUMNS[k]);
  const vals = KEYS.map((k) => settings[k]);
  const params = [tenantId, userId || null, ...vals];
  const { rows } = await client.query(
    `INSERT INTO plan_settings (tenant_id, updated_by, ${cols.join(', ')}, revision, updated_at)
     VALUES ($1, $2, ${cols.map((_, i) => `$${i + 3}`).join(', ')}, 1, now())
     ON CONFLICT (tenant_id) DO UPDATE SET ${cols.map((c) => `${c} = EXCLUDED.${c}`).join(', ')},
       updated_by = EXCLUDED.updated_by, updated_at = now(), revision = plan_settings.revision + 1
     RETURNING revision`, params);
  return rows[0].revision;
}

/**
 * Verrous des mois (visitLocks : même clé que « Générer depuis le RBM » et le Plan de suivi),
 * pris dans l'ordre croissant AVANT de recharger les entrées : aucun interblocage, et rien ne
 * s'écrit sur ces mois entre la vérification de l'empreinte et l'insertion.
 */
const lockMonthsTx = lockVisitMonthsTx;

/**
 * Chargeur des entrées d'un exercice (lignes brutes, assemblées par planInputs.assemble).
 * Sept requêtes bornées, l'une après l'autre sur le même client.
 */
async function loadPlanInputsTx(client, tenantId, { year }) {
  const y0 = `${year}-01-01`; const y1 = `${year}-12-01`;
  const { rows: offices } = await client.query(
    'SELECT id, parent_id AS "parentId", name, code FROM field_offices WHERE tenant_id = $1', [tenantId]);
  const { rows: sites } = await client.query(
    `SELECT s.id, s.code, s.public_id AS "publicId", s.name, s.location_id AS "locationId", s.activity, s.field_office_id AS "fieldOfficeId",
            s.adm1, s.adm2, s.district, s.adm3, s.commune, ad.name AS "pcodeName", r.name AS "pcodeRegion",
            s.risk_level AS "riskLevel", s.security_situation AS security, s.programme_synergies AS synergies,
            s.beneficiary_over_200 AS "beneficiaryOver200", s.beneficiary_number AS "beneficiaryNumber",
            s.new_partner AS "newPartner", s.experienced_partner AS "experiencedPartner",
            s.issues_process AS "issuesProcess", s.issues_partner_report AS "issuesPartnerReport",
            s.issues_cfm AS "issuesCFM", s.fraud_suspected AS fraud,
            to_char(s.last_visit_date, 'YYYY-MM-DD') AS "lastVisitDate"
       FROM sites s
       LEFT JOIN admin_areas ad ON ad.tenant_id = s.tenant_id AND ad.pcode = s.adm2_pcode
       LEFT JOIN admin_areas r ON r.tenant_id = s.tenant_id AND r.id = ad.lineage[1]
      WHERE s.tenant_id = $1`, [tenantId]);
  const { rows: grid } = await client.query(
    'SELECT site_id AS "siteId", month, active FROM site_month_status WHERE tenant_id = $1 AND year = $2', [tenantId, year]);
  const { rows: visits } = await client.query(
    `SELECT site_id AS "siteId", extract(month FROM period_month)::int AS month, status
       FROM site_visits WHERE tenant_id = $1 AND period_month BETWEEN $2::date AND $3::date`, [tenantId, y0, y1]);
  const { rows: lastBefore } = await client.query(
    `SELECT site_id AS "siteId", to_char(max(period_month), 'YYYY-MM') AS month
       FROM site_visits WHERE tenant_id = $1 AND status = 'realise' AND period_month < $2::date GROUP BY site_id`, [tenantId, y0]);
  const { rows: data } = await client.query(
    `SELECT ms.site_id AS "siteId",
            to_char(max(ms.period_month) FILTER (WHERE ms.period_month < $2::date), 'YYYY-MM') AS before,
            array_agg(DISTINCT to_char(ms.period_month, 'YYYY-MM')) FILTER (WHERE ms.period_month BETWEEN $2::date AND $3::date) AS months
       FROM monitoring_submissions ms
       JOIN monitoring_forms mf ON mf.id = ms.form_id AND mf.tenant_id = ms.tenant_id
       JOIN sites s ON s.id = ms.site_id AND s.tenant_id = ms.tenant_id
      WHERE ms.tenant_id = $1 AND ${SITE_DATA_FILTER} AND ms.period_month <= $3::date
      GROUP BY ms.site_id`, [tenantId, y0, y1]);
  const { rows: mmr } = await client.query(
    `SELECT id, field_office_id AS "fieldOfficeId", activity_category AS "activityCategory", operation_duration AS "operationDuration",
            number_of_sites AS "numberOfSites", risk_level AS "riskLevel", feasible, persons_to_deploy AS "personsToDeploy",
            visits_per_day::float8 AS "visitsPerDay", working_days AS "workingDays"
       FROM mmr_parameters WHERE tenant_id = $1`, [tenantId]);
  return { offices, sites, grid, gridKnown: grid.length > 0, visits, lastBefore, data: data.map((d) => ({ ...d, months: d.months || [] })), mmr };
}

/** Trace d'un plan appliqué. @returns id */
async function insertRunTx(client, tenantId, userId, run) {
  const { rows } = await client.query(
    `INSERT INTO plan_runs (tenant_id, year, from_month, to_month, objective, scope, params, pools, summary, fingerprint,
                            proposed, kept, manual_changes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
    [tenantId, run.year, run.fromMonth, run.toMonth, run.objective, run.scope, run.params, run.pools, run.summary, run.fingerprint,
      run.proposed, run.kept, run.manualChanges, userId || null]);
  return rows[0].id;
}

async function setRunCreatedTx(client, tenantId, runId, created) {
  await client.query('UPDATE plan_runs SET created_visits = $3 WHERE tenant_id = $1 AND id = $2', [tenantId, runId, created]);
}

/**
 * Visites générées, par lots multi-lignes (unnest). Re-vérifié EN BASE, sous les verrous des
 * mois : jamais sur un site × mois qui a déjà une visite (annulée comprise : une annulation est
 * une décision), jamais un mois inactif (règle commune siteActivity.isActiveMonth : année avec
 * grille → « Oui » explicite seulement), jamais en zone interdite. Le prestataire n'est pas choisi
 * ici (retour 58 : la base l'estampille d'après le contrat de la zone).
 * @returns nombre de visites créées
 */
async function insertGeneratedTx(client, tenantId, userId, { year, runId, visits }) {
  let created = 0;
  for (const slice of chunkRows(visits, 8)) {
    const { rowCount } = await client.query(
      `INSERT INTO site_visits (tenant_id, site_id, period_month, activity, status, created_by, plan_run_id, plan_why, plan_detail, plan_tour, plan_day)
       SELECT $1, t.site_id, make_date($3, t.m, 1), s.activity, 'planifie', $2, $4, t.why, t.detail, t.tour, t.day
         FROM unnest($5::uuid[], $6::int[], $7::text[], $8::jsonb[], $9::smallint[], $10::smallint[]) AS t(site_id, m, why, detail, tour, day)
         JOIN sites s ON s.id = t.site_id AND s.tenant_id = $1
        WHERE s.security_situation < 99
          AND NOT EXISTS (SELECT 1 FROM site_visits v
                           WHERE v.tenant_id = $1 AND v.site_id = t.site_id AND v.period_month = make_date($3, t.m, 1))
          AND ${activeMonthSql({ site: 't.site_id', year: '$3', month: 't.m' })}
       ON CONFLICT DO NOTHING`,
      [tenantId, userId || null, year, runId, slice.map((v) => v.siteId), slice.map((v) => v.month), slice.map((v) => v.why),
        slice.map((v) => JSON.stringify(v.detail || {})), slice.map((v) => v.tour || null), slice.map((v) => v.day || null)]);
    created += rowCount;
  }
  return created;
}

module.exports = { getSettingsTx, lockSettingsTx, saveSettingsTx, lockMonthsTx, loadPlanInputsTx, insertRunTx, setRunCreatedTx, insertGeneratedTx };
