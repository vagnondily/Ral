const { withTenantTransaction } = require('../../config/db');
const { summarize, pipeline } = require('./pddMath');

/** Seul le repository écrit du SQL. Toute requête filtre tenant_id (RLS). */

const monthStart = (m) => (m ? `${String(m).slice(0, 7)}-01` : null);

async function listCommodities(tenantId) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query(
      'SELECT code, label, unit, kind, sort_order AS "sortOrder" FROM pdd_commodities WHERE tenant_id = $1 ORDER BY sort_order, label',
      [tenantId]
    );
    return rows;
  });
}

function distFilter(params, { month, hazard, region, district }) {
  const where = ['d.tenant_id = $1'];
  if (month) { params.push(monthStart(month)); where.push(`d.period_month = $${params.length}`); }
  if (hazard) { params.push(hazard); where.push(`d.hazard = $${params.length}`); }
  if (region) { params.push(region); where.push(`d.region = $${params.length}`); }
  if (district) { params.push(district); where.push(`d.district = $${params.length}`); }
  return where.join(' AND ');
}

/** Lignes de distribution (pour la liste), avec leurs tonnages agrégés. */
async function listDistributions(tenantId, filters = {}) {
  return withTenantTransaction(tenantId, async (client) => {
    const params = [tenantId];
    const where = distFilter(params, filters);
    const { rows } = await client.query(
      `SELECT d.id, to_char(d.period_month, 'YYYY-MM') AS "periodMonth", d.activity, d.hazard,
              d.antenne, d.sous_bureau AS "sousBureau", d.partner, d.region, d.district, d.commune,
              d.modality, d.beneficiaries, d.households, d.cash_usd::float8 AS "cashUsd",
              d.total_food::float8 AS "totalFood",
              COALESCE(jsonb_object_agg(i.commodity, i.qty_mt) FILTER (WHERE i.commodity IS NOT NULL), '{}'::jsonb) AS items
         FROM pdd_distributions d
         LEFT JOIN pdd_distribution_items i ON i.distribution_id = d.id AND i.tenant_id = d.tenant_id
        WHERE ${where}
        GROUP BY d.id
        ORDER BY d.period_month DESC, d.region, d.district, d.commune`,
      params
    );
    return rows;
  });
}

/** Synthèse (totaux, par aléa, par mois, arbre zone) — logique pure. */
async function summaryData(tenantId, filters = {}) {
  const dists = await listDistributions(tenantId, filters);
  const summary = summarize(dists.map((d) => ({ ...d, items: d.items || {} })));
  // Mois & aléas disponibles pour les filtres.
  return withTenantTransaction(tenantId, async (client) => {
    const { rows: months } = await client.query(
      "SELECT DISTINCT to_char(period_month,'YYYY-MM') AS m FROM pdd_distributions WHERE tenant_id=$1 ORDER BY m DESC",
      [tenantId]
    );
    return { ...summary, months: months.map((x) => x.m) };
  });
}

/** Pipeline : besoin (tonnages planifiés) vs stock disponible, par denrée. */
async function pipelineData(tenantId, { month } = {}) {
  return withTenantTransaction(tenantId, async (client) => {
    const nParams = [tenantId]; const nWhere = ['i.tenant_id = $1'];
    if (month) { nParams.push(monthStart(month)); nWhere.push(`d.period_month = $${nParams.length}`); }
    const { rows: need } = await client.query(
      `SELECT i.commodity, sum(i.qty_mt)::float8 AS qty
         FROM pdd_distribution_items i JOIN pdd_distributions d ON d.id = i.distribution_id
        WHERE ${nWhere.join(' AND ')} GROUP BY i.commodity`,
      nParams
    );
    const sParams = [tenantId]; const sWhere = ['tenant_id = $1'];
    if (month) { sParams.push(monthStart(month)); sWhere.push(`period_month = $${sParams.length}`); }
    const { rows: stock } = await client.query(
      `SELECT commodity, available_mt::float8 AS qty, donor FROM pdd_stock WHERE ${sWhere.join(' AND ')}`,
      sParams
    );
    const needMap = Object.fromEntries(need.map((r) => [r.commodity, r.qty]));
    const stockMap = Object.fromEntries(stock.map((r) => [r.commodity, r.qty]));
    const donorMap = Object.fromEntries(stock.map((r) => [r.commodity, r.donor]));
    return pipeline(needMap, stockMap).map((r) => ({ ...r, donor: donorMap[r.commodity] || null }));
  });
}

async function setStock(tenantId, { month, commodity, availableMt, donor, note }, userId) {
  return withTenantTransaction(tenantId, async (client) => {
    await client.query(
      `INSERT INTO pdd_stock (tenant_id, period_month, commodity, available_mt, donor, note, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (tenant_id, period_month, commodity)
       DO UPDATE SET available_mt = EXCLUDED.available_mt, donor = EXCLUDED.donor, note = EXCLUDED.note, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [tenantId, monthStart(month), commodity, Math.max(0, Number(availableMt) || 0), donor || null, note || null, userId]
    );
    return true;
  });
}

/** Insertion en lot des lignes de distribution (+ tonnages). `replaceMonths`
 * vide d'abord les mois concernés (ré-import idempotent d'un fichier). */
async function insertDistributions(tenantId, userId, rows, { source = 'xlsx', replaceMonths = true } = {}) {
  return withTenantTransaction(tenantId, async (client) => {
    if (replaceMonths) {
      const months = [...new Set(rows.map((r) => r.periodMonth).filter(Boolean))];
      if (months.length) await client.query('DELETE FROM pdd_distributions WHERE tenant_id = $1 AND period_month = ANY($2::date[])', [tenantId, months]);
    }
    let inserted = 0; let items = 0;
    const CH = 100;
    for (let i = 0; i < rows.length; i += CH) {
      const slice = rows.slice(i, i + CH);
      // Insert distributions (multi-row) and get ids back in order.
      const dParams = [tenantId, userId || null, source]; const dVals = [];
      for (const r of slice) {
        dParams.push(r.periodMonth, r.activity, r.hazard || 'autre', r.wbs || null, r.antenne || null, r.sousBureau || null,
          r.partner || null, r.corridor || null, r.region || null, r.district || null, r.commune || null, r.modality || null,
          Math.max(0, Math.round(r.beneficiaries || 0)), Math.max(0, Math.round(r.households || 0)), Math.max(0, Number(r.cashUsd) || 0), Math.max(0, Number(r.totalFood) || 0));
        const b = dParams.length;
        dVals.push(`($1,${Array.from({ length: 16 }, (_, k) => `$${b - 16 + 1 + k}`).join(',')},$2,$3)`);
      }
      const { rows: ids } = await client.query(
        `INSERT INTO pdd_distributions (tenant_id, period_month, activity, hazard, wbs, antenne, sous_bureau, partner, corridor, region, district, commune, modality, beneficiaries, households, cash_usd, total_food, created_by, source)
         VALUES ${dVals.join(',')} RETURNING id`,
        dParams
      );
      inserted += ids.length;
      // Insert items.
      const iParams = [tenantId]; const iVals = [];
      slice.forEach((r, j) => {
        for (const [commodity, qty] of Object.entries(r.items || {})) {
          if (!(Number(qty) > 0)) continue;
          iParams.push(ids[j].id, commodity, Number(qty)); const b = iParams.length;
          iVals.push(`($1,$${b - 2},$${b - 1},$${b})`);
        }
      });
      if (iVals.length) { await client.query(`INSERT INTO pdd_distribution_items (tenant_id, distribution_id, commodity, qty_mt) VALUES ${iVals.join(',')}`, iParams); items += iVals.length; }
    }
    return { inserted, items };
  });
}

module.exports = { listCommodities, listDistributions, summaryData, pipelineData, setStock, insertDistributions };
