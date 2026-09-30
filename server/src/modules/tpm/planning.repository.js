const { withTenantTransaction } = require('../../config/db');
const { normalizeItems, summarize } = require('./reportMath');
const { assertItemActivities } = require('./activityRefs');
const { LINE_LABELS, SECTION_OF } = require('../contracts/budgetCatalog');

/**
 * Planification & budget — budget prévisionnel d'une vague de collecte.
 * Reproduces the planning workbook's « Budget » sheet: planned postes of the
 * same shape as the facture (état des dépenses), so a facture can be
 * pre-filled from a plan in one step. Feeds the « Planifié » of the
 * consolidation.
 *
 * Same reliability rules as the reports module: cent-safe totals derived by
 * reportMath, one multi-row INSERT for items, all inside a tenant transaction.
 */

const num = (v) => (v == null ? v : Number(v));

const ITEM_COLS = 15; // tenant_id, plan_id, line_code, designation, unit, unit_count, unit_cost, pay_by, bailleur_pct, activity_id, activity2_id, activity1_pct, site, observation, sort_order

async function loadItems(client, tenantId, planId) {
  const { rows } = await client.query(
    `SELECT i.id, i.line_code AS "lineCode", i.designation, i.unit, i.unit_count AS "unitCount",
            i.unit_cost AS "unitCost", i.pay_by AS "payBy", i.bailleur_pct AS "bailleurPct",
            i.activity_id AS "activityId", a.label AS "activityLabel",
            i.activity2_id AS "activity2Id", a2.label AS "activity2Label", i.activity1_pct AS "activity1Pct",
            i.site, i.observation, i.sort_order AS "sortOrder"
       FROM tpm_collection_plan_items i
       LEFT JOIN activities a ON a.id = i.activity_id
       LEFT JOIN activities a2 ON a2.id = i.activity2_id
      WHERE i.tenant_id = $1 AND i.plan_id = $2
      ORDER BY i.sort_order, i.id`,
    [tenantId, planId]
  );
  return rows.map((it) => ({
    ...it,
    unitCount: num(it.unitCount),
    unitCost: num(it.unitCost),
    bailleurPct: it.bailleurPct == null ? 1 : num(it.bailleurPct),
    activity1Pct: it.activity1Pct == null ? null : num(it.activity1Pct),
    amount: Math.round(Number(it.unitCount || 0) * Number(it.unitCost || 0) * 100) / 100,
    lineLabel: LINE_LABELS[it.lineCode] || it.lineCode,
    section: SECTION_OF[it.lineCode] || String(it.lineCode || '').split('.')[0],
  }));
}

/** Insert plan items in a single multi-row INSERT (report row assumed locked). */
async function insertItems(client, tenantId, planId, items) {
  const clean = normalizeItems(items);
  if (clean.length === 0) return clean;
  await assertItemActivities(client, tenantId, clean); // activities must be the tenant's
  const params = [];
  const tuples = clean.map((it, i) => {
    const b = i * ITEM_COLS;
    params.push(tenantId, planId, it.lineCode, it.designation, it.unit,
      it.unitCount, it.unitCost, it.payBy, it.bailleurPct, it.activityId, it.activity2Id, it.activity1Pct,
      it.site, it.observation, it.sortOrder);
    const p = Array.from({ length: ITEM_COLS }, (_, k) => `$${b + k + 1}`).join(',');
    return `(${p})`;
  });
  await client.query(
    `INSERT INTO tpm_collection_plan_items
       (tenant_id, plan_id, line_code, designation, unit, unit_count, unit_cost, pay_by, bailleur_pct, activity_id, activity2_id, activity1_pct, site, observation, sort_order)
     VALUES ${tuples.join(',')}`,
    params
  );
  return clean;
}

const HEAD = `
  p.id, p.partner_id AS "partnerId", pa.name AS "partnerName",
  p.contract_id AS "contractId", c.numero AS "contractNumero", c.partner_name AS "contractPartner",
  p.period_month AS "periodMonth", p.title, p.status,
  p.created_by AS "createdBy", p.created_at AS "createdAt", p.updated_at AS "updatedAt"`;
const FROM = `
  FROM tpm_collection_plans p
  JOIN partners pa ON pa.id = p.partner_id
  JOIN contracts c ON c.id = p.contract_id`;

async function listPlans(tenantId, { month, contractId } = {}) {
  return withTenantTransaction(tenantId, async (client) => {
    const params = [tenantId];
    const where = ['p.tenant_id = $1'];
    if (month) { params.push(`${month.slice(0, 7)}-01`); where.push(`p.period_month = $${params.length}`); }
    if (contractId) { params.push(contractId); where.push(`p.contract_id = $${params.length}`); }
    const { rows } = await client.query(
      `SELECT ${HEAD},
              COALESCE((SELECT SUM(unit_count * unit_cost) FROM tpm_collection_plan_items i
                         WHERE i.plan_id = p.id), 0) AS "plannedTotal",
              COALESCE((SELECT SUM(unit_count * unit_cost * bailleur_pct) FROM tpm_collection_plan_items i
                         WHERE i.plan_id = p.id), 0) AS "plannedFunder"
         ${FROM} WHERE ${where.join(' AND ')}
        ORDER BY p.period_month DESC, pa.name`,
      params
    );
    return rows.map((r) => ({ ...r, plannedTotal: num(r.plannedTotal), plannedFunder: num(r.plannedFunder) }));
  });
}

async function getPlan(tenantId, id) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query(`SELECT ${HEAD} ${FROM} WHERE p.tenant_id = $1 AND p.id = $2`, [tenantId, id]);
    if (!rows[0]) return null;
    const items = await loadItems(client, tenantId, id);
    return { ...rows[0], items, summary: summarize(items) };
  });
}

/** Items of the plan matching a contract + month — for facture pre-fill. */
async function planItemsFor(tenantId, { contractId, periodMonth }) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT id FROM tpm_collection_plans
        WHERE tenant_id = $1 AND contract_id = $2 AND period_month = $3`,
      [tenantId, contractId, `${periodMonth.slice(0, 7)}-01`]
    );
    if (!rows[0]) return { planId: null, items: [] };
    const items = await loadItems(client, tenantId, rows[0].id);
    return { planId: rows[0].id, items };
  });
}

async function createPlan(tenantId, input) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows: exists } = await client.query(
      `SELECT id FROM tpm_collection_plans WHERE tenant_id = $1 AND partner_id = $2 AND contract_id = $3 AND period_month = $4`,
      [tenantId, input.partnerId, input.contractId, input.periodMonth]
    );
    if (exists[0]) { const e = new Error('duplicate'); e.code = 'DUP'; throw e; }
    const { rows } = await client.query(
      `INSERT INTO tpm_collection_plans (tenant_id, partner_id, contract_id, period_month, title, status, created_by)
       VALUES ($1,$2,$3,$4,$5,'brouillon',$6) RETURNING id`,
      [tenantId, input.partnerId, input.contractId, input.periodMonth, input.title || null, input.createdBy]
    );
    const id = rows[0].id;
    if (Array.isArray(input.items) && input.items.length) await insertItems(client, tenantId, id, input.items);
    return id;
  });
}

/** Replace a plan's items (and optional title/status). Returns id or null. */
async function updatePlan(tenantId, id, { items, title, status }) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query(
      'SELECT id FROM tpm_collection_plans WHERE tenant_id = $1 AND id = $2 FOR UPDATE',
      [tenantId, id]
    );
    if (!rows[0]) return null;
    if (Array.isArray(items)) {
      await client.query('DELETE FROM tpm_collection_plan_items WHERE tenant_id = $1 AND plan_id = $2', [tenantId, id]);
      await insertItems(client, tenantId, id, items);
    }
    await client.query(
      `UPDATE tpm_collection_plans
          SET title = COALESCE($3, title),
              status = COALESCE($4, status),
              updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id, title ?? null, status ?? null]
    );
    return id;
  });
}

async function deletePlan(tenantId, id) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rowCount } = await client.query('DELETE FROM tpm_collection_plans WHERE tenant_id = $1 AND id = $2', [tenantId, id]);
    return rowCount === 1;
  });
}

module.exports = { listPlans, getPlan, planItemsFor, createPlan, updatePlan, deletePlan };
