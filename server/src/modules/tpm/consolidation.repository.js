const { withTenantTransaction } = require('../../config/db');
const { MONITORING_LINE } = require('../contracts/budgetCatalog');
const { buildConsolidation } = require('./consolidation');

/**
 * Data access for the Suivi budgétaire consolidé (Dashboard décisionnel).
 *
 * Reads live from the three source modules and lets the pure
 * `buildConsolidation` shape the result:
 *   • Budget   ← contract_budget_items, ligne « IV.suivi »   (Contrats)
 *   • Planifié ← tpm_reports.planned_amount                  (Rapports)
 *   • Réalisé  ← tpm_reports.reported_amount (financier)     (Rapports)
 *
 * Nothing is stored here — the consolidation is always recomputed from the
 * current state of the contracts and reports, so it can never drift.
 */

const num = (v) => (v == null ? 0 : Number(v));

async function consolidation(tenantId, { today } = {}) {
  return withTenantTransaction(tenantId, async (client) => {
    // Active monitoring contracts with a non-zero « Suivi » budget.
    const { rows: contracts } = await client.query(
      `SELECT c.id,
              c.numero,
              c.partner_name       AS "partnerName",
              c.date_debut         AS "dateDebut",
              c.date_fin           AS "dateFin",
              c.period_months      AS "periodMonths",
              COALESCE(s.total, 0) AS "monitoringBudget"
         FROM contracts c
         JOIN LATERAL (
                SELECT SUM(unit_count * unit_cost) AS total
                  FROM contract_budget_items
                 WHERE contract_id = c.id AND line_code = $2
              ) s ON true
        WHERE c.tenant_id = $1
          AND c.status = 'actif'
          AND COALESCE(s.total, 0) > 0
        ORDER BY c.partner_name, c.numero`,
      [tenantId, MONITORING_LINE]
    );

    // Monthly « Réalisé » per contract, from the financial reports (factures):
    // amounts at least submitted (soumis) or validated (valide) — rejected
    // drafts do not consume the budget. The funder (bailleur) share is what
    // draws down the monitoring budget.
    const { rows: actualRows } = await client.query(
      `SELECT r.contract_id AS "contractId",
              to_char(r.period_month, 'YYYY-MM') AS month,
              COALESCE(SUM(r.reported_amount)
                       FILTER (WHERE r.kind = 'financier'
                               AND r.status IN ('soumis', 'valide')), 0) AS actual
         FROM tpm_reports r
        WHERE r.tenant_id = $1
        GROUP BY r.contract_id, r.period_month`,
      [tenantId]
    );

    // Monthly « Planifié » per contract, from the collection plans
    // (Planification & budget) — the funder share of the planned postes.
    const { rows: plannedRows } = await client.query(
      `SELECT p.contract_id AS "contractId",
              to_char(p.period_month, 'YYYY-MM') AS month,
              COALESCE(SUM(i.unit_count * i.unit_cost * i.bailleur_pct), 0) AS planned
         FROM tpm_collection_plans p
         JOIN tpm_collection_plan_items i ON i.plan_id = p.id
        WHERE p.tenant_id = $1
        GROUP BY p.contract_id, p.period_month`,
      [tenantId]
    );

    // Merge planned + actual by (contract, month).
    const byKey = new Map();
    const keyOf = (cId, m) => `${cId}|${m}`;
    for (const r of actualRows) byKey.set(keyOf(r.contractId, r.month), { contractId: r.contractId, month: r.month, planned: 0, actual: num(r.actual) });
    for (const r of plannedRows) {
      const k = keyOf(r.contractId, r.month);
      const cur = byKey.get(k) || { contractId: r.contractId, month: r.month, planned: 0, actual: 0 };
      cur.planned = num(r.planned);
      byKey.set(k, cur);
    }
    const monthly = [...byKey.values()];

    // DATE columns come back as exact 'YYYY-MM-DD' strings (see the OID-1082
    // type parser in config/db.js) — pass them through, never round-trip
    // through a JS Date, which would reintroduce a timezone shift.
    const shaped = contracts.map((c) => ({
      id: c.id,
      numero: c.numero,
      partnerId: null,
      partnerName: c.partnerName,
      dateDebut: c.dateDebut || null,
      dateFin: c.dateFin || null,
      periodMonths: c.periodMonths,
      monitoringBudget: num(c.monitoringBudget),
    }));

    return buildConsolidation(shaped, monthly, { today });
  });
}

module.exports = { consolidation };
