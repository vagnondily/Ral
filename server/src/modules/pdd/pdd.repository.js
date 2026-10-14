const { withTenantTransaction } = require('../../config/db');
const { summarize, pipeline, latestStock, peakMonth, pipelineOverMonths } = require('./pddMath');
const { toPeriod, periodInfo, periodBounds, monthsOf } = require('../common/period');
const { monthWithin } = require('../common/periodSql');

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

/**
 * Filtre des distributions : période (lot 1b, intervalle semi-ouvert — period_month n'a pas
 * de contrainte « jour = 1 »), aléa, région, district. `period` ({ from, to } | null) ;
 * l'ancien { month } reste lu (appels internes).
 */
function distFilter(params, { period, month, hazard, region, district }) {
  const where = ['d.tenant_id = $1'];
  const p = period !== undefined ? period : toPeriod({ month });
  if (p) where.push(monthWithin('d.period_month', p, params));
  if (hazard) { params.push(hazard); where.push(`d.hazard = $${params.length}`); }
  if (region) { params.push(region); where.push(`d.region = $${params.length}`); }
  if (district) { params.push(district); where.push(`d.district = $${params.length}`); }
  return where.join(' AND ');
}

/** Taille de page de la liste des distributions (lecture bornée) : défaut et plafond. */
const LIST_LIMIT = 2000;
const LIST_MAX = 5000;

/**
 * Lignes de distribution (pour la liste), avec leurs tonnages agrégés — lecture BORNÉE :
 * { rows, total, limit, offset } (`total` = lignes de la période et des filtres).
 */
async function listDistributions(tenantId, filters = {}, { limit = LIST_LIMIT, offset = 0 } = {}) {
  const lim = Math.min(LIST_MAX, Math.max(1, Math.floor(Number(limit) || LIST_LIMIT)));
  const off = Math.max(0, Math.floor(Number(offset) || 0));
  return withTenantTransaction(tenantId, async (client) => {
    const params = [tenantId];
    const where = distFilter(params, filters);
    const { rows: [{ total }] } = await client.query(
      `SELECT count(*)::int AS total FROM pdd_distributions d WHERE ${where}`, params);
    const pageParams = [...params, lim, off];
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
        ORDER BY d.period_month DESC, d.region, d.district, d.commune, d.id
        LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}`,
      pageParams
    );
    return { rows, total, limit: lim, offset: off };
  });
}

/**
 * Synthèse (totaux, par aléa, par mois, arbre zone, pic mensuel) — agrégée en SQL (GROUP BY
 * mois × aléa × zone, tonnages par denrée), la logique pure (pddMath.summarize) ne met en
 * forme que ces groupes bornés. Sur une période : cumul (bénéficiaires-distributions) ET
 * pic mensuel (`peak`), libellés comme tels à l'écran.
 */
async function summaryData(tenantId, filters = {}) {
  return withTenantTransaction(tenantId, async (client) => {
    const params = [tenantId];
    const where = distFilter(params, filters);
    const { rows: groups } = await client.query(
      `SELECT to_char(d.period_month, 'YYYY-MM') AS "periodMonth", d.hazard, d.region, d.district, d.commune,
              count(*)::int AS lines, COALESCE(sum(d.beneficiaries), 0)::float8 AS beneficiaries,
              COALESCE(sum(d.households), 0)::float8 AS households, COALESCE(sum(d.cash_usd), 0)::float8 AS "cashUsd",
              COALESCE(sum(d.total_food), 0)::float8 AS "totalFood"
         FROM pdd_distributions d WHERE ${where}
        GROUP BY 1, 2, 3, 4, 5`,
      params
    );
    const { rows: items } = await client.query(
      `SELECT to_char(d.period_month, 'YYYY-MM') AS "periodMonth", d.hazard, d.region, d.district, d.commune,
              i.commodity, sum(i.qty_mt)::float8 AS qty
         FROM pdd_distribution_items i
         JOIN pdd_distributions d ON d.id = i.distribution_id AND d.tenant_id = i.tenant_id
        WHERE i.tenant_id = $1 AND ${where}
        GROUP BY 1, 2, 3, 4, 5, 6`,
      params
    );
    const keyOf = (r) => [r.periodMonth, r.hazard, r.region, r.district, r.commune].join('\u0001');
    const byKey = new Map(groups.map((g) => [keyOf(g), { ...g, items: {} }]));
    for (const it of items) {
      const g = byKey.get(keyOf(it));
      if (g) g.items[it.commodity] = (g.items[it.commodity] || 0) + (Number(it.qty) || 0);
    }
    const summary = summarize([...byKey.values()]);
    // Aléas de chaque mois (tableau des mois de l'écran Distributions).
    const hz = new Map();
    for (const g of groups) {
      if (!hz.has(g.periodMonth)) hz.set(g.periodMonth, new Set());
      hz.get(g.periodMonth).add(g.hazard || 'autre');
    }
    for (const [m, set] of hz) if (summary.byMonth[m]) summary.byMonth[m].hazards = [...set].sort();
    // Mois disponibles (tous, pour les filtres).
    const { rows: months } = await client.query(
      "SELECT DISTINCT to_char(period_month,'YYYY-MM') AS m FROM pdd_distributions WHERE tenant_id=$1 ORDER BY m DESC",
      [tenantId]
    );
    const period = filters.period !== undefined ? filters.period : toPeriod({ month: filters.month });
    return { ...summary, peak: peakMonth(summary.byMonth), period: periodInfo(period), months: months.map((x) => x.m) };
  });
}

/**
 * Pipeline : besoin (tonnages planifiés) vs stock disponible, par denrée.
 *  - sans période : besoin de tous les mois face au dernier stock saisi (« stock au … ») ;
 *  - avec une période : MOIS PAR MOIS (pddMath.pipelineOverMonths) — le besoin de chaque
 *    mois face au stock en vigueur ce mois-là (dernier stock saisi ≤ mois, jamais additionné),
 *    mois en rupture comptés ; sur un seul mois, la règle de toujours.
 */
async function pipelineData(tenantId, { period, month } = {}) {
  const p = period !== undefined ? period : toPeriod({ month });
  return withTenantTransaction(tenantId, async (client) => {
    const nParams = [tenantId];
    const within = p ? monthWithin('d.period_month', p, nParams) : 'TRUE';
    const { rows: need } = await client.query(
      `SELECT i.commodity, to_char(d.period_month, 'YYYY-MM') AS month, sum(i.qty_mt)::float8 AS qty
         FROM pdd_distribution_items i
         JOIN pdd_distributions d ON d.id = i.distribution_id AND d.tenant_id = i.tenant_id
        WHERE i.tenant_id = $1 AND ${within} GROUP BY 1, 2`,
      nParams
    );
    const sParams = [tenantId]; const sWhere = ['tenant_id = $1'];
    if (p) { sParams.push(periodBounds(p).hiExcl); sWhere.push(`period_month < $${sParams.length}::date`); }
    const { rows: stock } = await client.query(
      `SELECT commodity, available_mt::float8 AS qty, donor, to_char(period_month, 'YYYY-MM') AS month
         FROM pdd_stock WHERE ${sWhere.join(' AND ')}`,
      sParams
    );
    if (p) return pipelineOverMonths(need, stock, monthsOf(p));
    // Tous les mois : le stock de référence est celui du dernier mois renseigné (affiché « stock au … »).
    const latest = latestStock(stock);
    const needMap = {};
    for (const r of need) needMap[r.commodity] = (needMap[r.commodity] || 0) + r.qty;
    const stockMap = Object.fromEntries(Object.entries(latest).map(([c, s]) => [c, s.qty]));
    return pipeline(needMap, stockMap).map((r) => ({ ...r, donor: latest[r.commodity]?.donor || null, stockMonth: latest[r.commodity]?.month || null }));
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
 * vide d'abord les mois concernés (ré-import idempotent d'un fichier).
 * Deux imports simultanés du même compte sont mis en file par un verrou
 * consultatif de transaction : sinon chacun vide les mois AVANT que l'autre
 * n'insère, et les deux insertions s'additionnent (mois en double). */
async function insertDistributions(tenantId, userId, rows, { source = 'xlsx', replaceMonths = true } = {}) {
  return withTenantTransaction(tenantId, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1::text || ':pdd-import'))", [tenantId]);
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

/** Distributions d'urgence par mois sur une période [from, to] — agrégé en SQL. */
async function reportPddByMonth(tenantId, { from, to }) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT to_char(d.period_month, 'YYYY-MM') AS month, sum(d.beneficiaries)::float8 AS beneficiaries,
              sum(d.households)::float8 AS households, sum(d.cash_usd)::float8 AS cash,
              COALESCE(sum(it.food), 0)::float8 AS food
         FROM pdd_distributions d
         LEFT JOIN LATERAL (SELECT sum(i.qty_mt) AS food FROM pdd_distribution_items i WHERE i.distribution_id = d.id) it ON true
        WHERE d.tenant_id = $1 AND d.period_month BETWEEN $2 AND $3
        GROUP BY 1 ORDER BY 1`, [tenantId, `${from}-01`, `${to}-01`]);
    return rows;
  });
}

module.exports = { reportPddByMonth, listCommodities, listDistributions, summaryData, pipelineData, setStock, insertDistributions };
