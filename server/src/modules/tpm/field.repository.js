const { withTenantTransaction } = require('../../config/db');
const { summarizeVisits, collectionDays } = require('./fieldMath');
const { isDue, frequencyFor } = require('./rbmMath');
const { scoreSite } = require('./rbmScore');

/**
 * Suivi terrain — planification/réalisation des visites, affectées aux
 * prestataires TPM. Réutilise le registre de sites partagé (`sites`) — un seul
 * référentiel de sites pour tout le suivi (RBM, affectations, visites). Only
 * this repository writes SQL; every query filters tenant_id (RLS).
 */

const SITE_COLS = 'id, district, commune, fokontany, name, activity';

// Deterministic slug used as the site `code` so an import dedups on
// (district, commune, name) via the (tenant_id, code) unique constraint.
function siteCode(s) {
  const slug = (x) => String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  return `${slug(s.district)}--${slug(s.commune)}--${slug(s.name)}`.slice(0, 120) || `site-${Date.now()}`;
}

async function listSites(tenantId, { q } = {}) {
  return withTenantTransaction(tenantId, async (client) => {
    const params = [tenantId];
    const where = ['tenant_id = $1'];
    if (q) { params.push(`%${q}%`); where.push(`(name ILIKE $${params.length} OR commune ILIKE $${params.length} OR district ILIKE $${params.length})`); }
    const { rows } = await client.query(
      `SELECT ${SITE_COLS} FROM sites WHERE ${where.join(' AND ')} ORDER BY district, commune, name`,
      params
    );
    return rows;
  });
}

async function createSite(tenantId, s) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO sites (tenant_id, code, district, commune, fokontany, name, activity)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (tenant_id, code) DO UPDATE SET fokontany = EXCLUDED.fokontany,
         activity = COALESCE(EXCLUDED.activity, sites.activity)
       RETURNING id`,
      [tenantId, siteCode(s), s.district, s.commune, s.fokontany || null, s.name, s.activity || null]
    );
    return rows[0].id;
  });
}

async function updateSite(tenantId, id, s) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rowCount } = await client.query(
      `UPDATE sites SET district = COALESCE($3, district), commune = COALESCE($4, commune),
         fokontany = $5, name = COALESCE($6, name), activity = $7, risk_level = COALESCE($8, risk_level),
         security_situation = COALESCE($9, security_situation),
         programme_synergies = COALESCE($10, programme_synergies),
         beneficiary_over_200 = COALESCE($11, beneficiary_over_200),
         new_partner = COALESCE($12, new_partner),
         issues_process = COALESCE($13, issues_process),
         issues_partner_report = COALESCE($14, issues_partner_report),
         issues_cfm = COALESCE($15, issues_cfm),
         fraud_suspected = COALESCE($16, fraud_suspected)
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id, s.district ?? null, s.commune ?? null, s.fokontany ?? null, s.name ?? null, s.activity ?? null, s.riskLevel ?? null,
        s.security ?? null, s.synergies ?? null, s.beneficiaryOver200 ?? null, s.newPartner ?? null,
        s.issuesProcess ?? null, s.issuesPartnerReport ?? null, s.issuesCFM ?? null, s.fraud ?? null]
    );
    return rowCount > 0;
  });
}

// ---- RBM (Risk-Based Monitoring) ----------------------------------------
const RBM_SELECT = `
  SELECT s.id, s.code, s.name, s.district, s.commune, s.activity, s.risk_level AS "riskLevel",
         s.security_situation AS "security", s.programme_synergies AS "synergies",
         s.beneficiary_over_200 AS "beneficiaryOver200", s.new_partner AS "newPartner",
         s.issues_process AS "issuesProcess", s.issues_partner_report AS "issuesPartnerReport",
         s.issues_cfm AS "issuesCFM", s.fraud_suspected AS "fraud",
         to_char(mv.last, 'YYYY-MM') AS "lastVisitMonth"
    FROM sites s
    LEFT JOIN LATERAL (
      SELECT max(period_month) AS last FROM site_visits v
       WHERE v.tenant_id = s.tenant_id AND v.site_id = s.id AND v.status <> 'annule'
    ) mv ON true
   WHERE s.tenant_id = $1`;

/** Site registry with risk level, last visit and whether it is due for `month`. */
async function rbmSites(tenantId, { month, risk } = {}) {
  return withTenantTransaction(tenantId, async (client) => {
    const params = [tenantId]; let where = '';
    if (risk) { params.push(risk); where = ` AND s.risk_level = $${params.length}`; }
    const { rows } = await client.query(`${RBM_SELECT}${where} ORDER BY s.district, s.commune, s.name`, params);
    const target = month ? String(month).slice(0, 7) : null;
    return rows.map((r) => {
      // Intervalle de référence : fréquence RBM selon le niveau de risque
      // (en l'absence d'un paramètre MMR précis pour ce site).
      const interval = frequencyFor(r.riskLevel);
      const score = scoreSite(r, { targetMonth: target, mmrInterval: interval });
      // « À suivre » = retard (score) OU échéance de fréquence atteinte (isDue),
      // pour rester cohérent avec l'ancienne logique.
      const due = target ? (score.due || isDue(r.riskLevel, r.lastVisitMonth, target)) : false;
      return { ...r, ...score, due };
    });
  });
}

/** Import the Master Data site referential (Region/District/Commune/Site/code). */
async function importMasterData(tenantId, rows) {
  return withTenantTransaction(tenantId, async (client) => {
    const clean = rows.filter((r) => r.district && r.commune && r.name);
    let inserted = 0;
    for (const r of clean) {
      const code = (r.code && String(r.code).trim()) || siteCode(r);
      const { rows: out } = await client.query(
        `INSERT INTO sites (tenant_id, code, district, commune, name, activity, risk_level)
         VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,'moyenne'))
         ON CONFLICT (tenant_id, code) DO UPDATE SET district = EXCLUDED.district,
           commune = EXCLUDED.commune, name = EXCLUDED.name
         RETURNING (xmax = 0) AS inserted`,
        [tenantId, code, r.district, r.commune, r.name, r.activity || null, r.riskLevel || null]
      );
      if (out[0].inserted) inserted += 1;
    }
    return { total: clean.length, inserted };
  });
}

/** Generate the month's planned visits from the RBM: one planifie visit per due
 * site (optionally filtered by risk). Idempotent (skips existing). */
async function generateFromRbm(tenantId, userId, month, { risk } = {}) {
  return withTenantTransaction(tenantId, async (client) => {
    const params = [tenantId]; let where = '';
    if (risk) { params.push(risk); where = ` AND s.risk_level = $${params.length}`; }
    const { rows } = await client.query(`${RBM_SELECT}${where}`, params);
    const target = String(month).slice(0, 7);
    const pm = `${target}-01`;
    let created = 0;
    for (const s of rows) {
      if (!isDue(s.riskLevel, s.lastVisitMonth, target)) continue;
      const res = await client.query(
        `INSERT INTO site_visits (tenant_id, site_id, period_month, activity, status, created_by)
         VALUES ($1,$2,$3,$4,'planifie',$5)
         ON CONFLICT (tenant_id, site_id, period_month, activity) DO NOTHING`,
        [tenantId, s.id, pm, s.activity || null, userId]
      );
      created += res.rowCount;
    }
    return { created, due: rows.filter((s) => isDue(s.riskLevel, s.lastVisitMonth, target)).length };
  });
}

/** Bulk upsert sites (shared registry) from an import; returns a code→id map. */
async function upsertSites(client, tenantId, sites) {
  const map = new Map();
  let inserted = 0;
  for (const s of sites) {
    const code = siteCode(s);
    const { rows } = await client.query(
      `INSERT INTO sites (tenant_id, code, district, commune, fokontany, name, activity)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (tenant_id, code)
       DO UPDATE SET fokontany = EXCLUDED.fokontany, activity = COALESCE(EXCLUDED.activity, sites.activity)
       RETURNING id, (xmax = 0) AS inserted`,
      [tenantId, code, s.district, s.commune, s.fokontany || null, s.name, s.activity || null]
    );
    map.set(`${s.district}|${s.commune}|${s.name}`, rows[0].id);
    if (rows[0].inserted) inserted += 1;
  }
  return { map, inserted };
}

const VISIT_COLS = `
  v.id, v.site_id AS "siteId", s.name AS "siteName", s.district, s.commune, s.fokontany,
  v.activity, to_char(v.period_month, 'YYYY-MM') AS "periodMonth",
  v.contract_id AS "contractId", v.provider_id AS "providerId", p.name AS "providerName",
  v.agent, v.status, v.visit_date AS "visitDate"`;

async function listVisits(tenantId, { month, providerId, status } = {}) {
  return withTenantTransaction(tenantId, async (client) => {
    const params = [tenantId];
    const where = ['v.tenant_id = $1'];
    if (month) { params.push(`${String(month).slice(0, 7)}-01`); where.push(`v.period_month = $${params.length}`); }
    if (providerId) { params.push(providerId); where.push(`v.provider_id = $${params.length}`); }
    if (status) { params.push(status); where.push(`v.status = $${params.length}`); }
    const { rows } = await client.query(
      `SELECT ${VISIT_COLS}
         FROM site_visits v
         JOIN sites s ON s.id = v.site_id
         LEFT JOIN partners p ON p.id = v.provider_id
        WHERE ${where.join(' AND ')}
        ORDER BY s.district, s.commune, s.name`,
      params
    );
    return rows;
  });
}

async function summary(tenantId, { month } = {}) {
  return withTenantTransaction(tenantId, async (client) => {
    const params = [tenantId];
    const where = ['v.tenant_id = $1'];
    if (month) { params.push(`${String(month).slice(0, 7)}-01`); where.push(`v.period_month = $${params.length}`); }
    const { rows } = await client.query(
      `SELECT v.status, v.provider_id AS "providerId", p.name AS "providerName", s.district, v.activity
         FROM site_visits v JOIN sites s ON s.id = v.site_id
         LEFT JOIN partners p ON p.id = v.provider_id
        WHERE ${where.join(' AND ')}`,
      params
    );
    const providerLabel = {};
    for (const r of rows) if (r.providerId) providerLabel[r.providerId] = r.providerName;
    return summarizeVisits(rows, providerLabel);
  });
}

/**
 * Jours de collecte par prestataire pour un mois = visites datées (non
 * annulées) + jours de déplacement manuels (tpm_collection_days).
 */
async function collectionDaysSummary(tenantId, { month } = {}) {
  return withTenantTransaction(tenantId, async (client) => {
    const pm = month ? `${String(month).slice(0, 7)}-01` : null;
    const vParams = [tenantId]; const vWhere = ['v.tenant_id = $1'];
    if (pm) { vParams.push(pm); vWhere.push(`v.period_month = $${vParams.length}`); }
    const { rows: visits } = await client.query(
      `SELECT v.provider_id AS "providerId", p.name AS "providerName", v.status,
              v.visit_date AS "visitDate"
         FROM site_visits v LEFT JOIN partners p ON p.id = v.provider_id
        WHERE ${vWhere.join(' AND ')}`,
      vParams
    );
    const tParams = [tenantId]; const tWhere = ['tenant_id = $1'];
    if (pm) { tParams.push(pm); tWhere.push(`period_month = $${tParams.length}`); }
    const { rows: travel } = await client.query(
      `SELECT provider_id AS "providerId", travel_days AS "travelDays" FROM tpm_collection_days WHERE ${tWhere.join(' AND ')}`,
      tParams
    );
    const travelByProvider = {}; const providerLabel = {};
    for (const t of travel) travelByProvider[t.providerId] = t.travelDays;
    for (const v of visits) if (v.providerId) providerLabel[v.providerId] = v.providerName;
    return collectionDays(visits, travelByProvider, providerLabel);
  });
}

async function setTravelDays(tenantId, { providerId, month, travelDays }) {
  return withTenantTransaction(tenantId, async (client) => {
    await client.query(
      `INSERT INTO tpm_collection_days (tenant_id, provider_id, period_month, travel_days)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (tenant_id, provider_id, period_month)
       DO UPDATE SET travel_days = EXCLUDED.travel_days, updated_at = now()`,
      [tenantId, providerId, `${String(month).slice(0, 7)}-01`, Math.max(0, Math.round(Number(travelDays) || 0))]
    );
    return true;
  });
}

async function createVisit(tenantId, userId, v) {
  return withTenantTransaction(tenantId, async (client) => {
    try {
      const { rows } = await client.query(
        `INSERT INTO site_visits (tenant_id, site_id, period_month, activity, contract_id, provider_id, agent, status, visit_date, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [tenantId, v.siteId, `${String(v.periodMonth).slice(0, 7)}-01`, v.activity || null,
          v.contractId || null, v.providerId || null, v.agent || null, v.status || 'planifie', v.visitDate || null, userId]
      );
      return rows[0].id;
    } catch (err) {
      if (err.code === '23505') { const e = new Error('Une visite existe déjà pour ce site, ce mois et cette activité.'); e.status = 409; throw e; }
      throw err;
    }
  });
}

async function updateVisit(tenantId, id, patch) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rowCount } = await client.query(
      `UPDATE site_visits
          SET provider_id = COALESCE($3, provider_id), agent = COALESCE($4, agent),
              contract_id = COALESCE($5, contract_id), status = COALESCE($6, status),
              visit_date = COALESCE($7, visit_date), updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id, patch.providerId ?? null, patch.agent ?? null, patch.contractId ?? null,
        patch.status ?? null, patch.visitDate ?? null]
    );
    return rowCount > 0;
  });
}

async function deleteVisit(tenantId, id) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rowCount } = await client.query('DELETE FROM site_visits WHERE tenant_id = $1 AND id = $2', [tenantId, id]);
    return rowCount > 0;
  });
}

/**
 * Import a planning: create/keep the sites (shared registry) and plan their
 * visits for a month. `rows`: [{ district, commune, fokontany, name, activity,
 * agent }]. One visit per (site, activity) for the month; existing ones are
 * skipped (idempotent).
 */
async function importPlanning(tenantId, userId, month, rows) {
  return withTenantTransaction(tenantId, async (client) => {
    const clean = rows.filter((r) => r.district && r.commune && r.name);
    const { map, inserted } = await upsertSites(client, tenantId, clean);
    let visits = 0;
    const pm = `${String(month).slice(0, 7)}-01`;
    for (const r of clean) {
      const siteId = map.get(`${r.district}|${r.commune}|${r.name}`);
      if (!siteId) continue;
      const res = await client.query(
        `INSERT INTO site_visits (tenant_id, site_id, period_month, activity, agent, status, created_by)
         VALUES ($1,$2,$3,$4,$5,'planifie',$6)
         ON CONFLICT (tenant_id, site_id, period_month, activity) DO NOTHING`,
        [tenantId, siteId, pm, r.activity || null, r.agent || null, userId]
      );
      visits += res.rowCount;
    }
    return { sitesInserted: inserted, sitesTotal: clean.length, visitsCreated: visits };
  });
}

module.exports = {
  listSites, createSite, updateSite,
  listVisits, summary, createVisit, updateVisit, deleteVisit, importPlanning,
  collectionDaysSummary, setTravelDays,
  rbmSites, importMasterData, generateFromRbm,
};
