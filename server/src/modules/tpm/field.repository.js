const { withTenantTransaction } = require('../../config/db');
const { summarizeVisits } = require('./fieldMath');

/**
 * Suivi terrain — sites (établissements) + planification/réalisation des
 * visites, affectées aux prestataires TPM. Only this repository writes SQL;
 * every query filters tenant_id and runs inside withTenantTransaction (RLS).
 */

const SITE_COLS = 'id, district, commune, fokontany, name, activity, active';

async function listSites(tenantId, { q } = {}) {
  return withTenantTransaction(tenantId, async (client) => {
    const params = [tenantId];
    const where = ['tenant_id = $1'];
    if (q) { params.push(`%${q}%`); where.push(`(name ILIKE $${params.length} OR commune ILIKE $${params.length} OR district ILIKE $${params.length})`); }
    const { rows } = await client.query(
      `SELECT ${SITE_COLS} FROM mon_sites WHERE ${where.join(' AND ')} ORDER BY district, commune, name`,
      params
    );
    return rows;
  });
}

async function createSite(tenantId, s) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO mon_sites (tenant_id, district, commune, fokontany, name, activity)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [tenantId, s.district, s.commune, s.fokontany || null, s.name, s.activity || null]
    );
    return rows[0].id;
  });
}

async function updateSite(tenantId, id, s) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rowCount } = await client.query(
      `UPDATE mon_sites SET district = COALESCE($3, district), commune = COALESCE($4, commune),
         fokontany = $5, name = COALESCE($6, name), activity = $7, active = COALESCE($8, active)
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id, s.district ?? null, s.commune ?? null, s.fokontany ?? null, s.name ?? null, s.activity ?? null, s.active ?? null]
    );
    return rowCount > 0;
  });
}

/** Bulk upsert sites from an import; returns the number inserted/kept, and a
 * name→id map for linking visits. */
async function upsertSites(client, tenantId, sites) {
  const map = new Map();
  let inserted = 0;
  for (const s of sites) {
    const { rows } = await client.query(
      `INSERT INTO mon_sites (tenant_id, district, commune, fokontany, name, activity)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (tenant_id, district, commune, name)
       DO UPDATE SET fokontany = EXCLUDED.fokontany, activity = COALESCE(EXCLUDED.activity, mon_sites.activity)
       RETURNING id, (xmax = 0) AS inserted`,
      [tenantId, s.district, s.commune, s.fokontany || null, s.name, s.activity || null]
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
         JOIN mon_sites s ON s.id = v.site_id
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
         FROM site_visits v JOIN mon_sites s ON s.id = v.site_id
         LEFT JOIN partners p ON p.id = v.provider_id
        WHERE ${where.join(' AND ')}`,
      params
    );
    const providerLabel = {};
    for (const r of rows) if (r.providerId) providerLabel[r.providerId] = r.providerName;
    return summarizeVisits(rows, providerLabel);
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
 * Import a planning: create/keep the sites and plan their visits for a month.
 * `rows`: [{ district, commune, fokontany, name, activity, agent }]. One visit
 * per (site, activity) for the month; existing ones are skipped (idempotent).
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
};
