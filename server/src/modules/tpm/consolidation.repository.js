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

    // Monthly planned / actual per contract, from the financial reports.
    // « Réalisé » counts amounts that are at least submitted (soumis) or
    // validated (valide); rejected drafts do not consume the budget.
    const { rows: monthly } = await client.query(
      `SELECT r.contract_id AS "contractId",
              to_char(r.period_month, 'YYYY-MM') AS month,
              COALESCE(SUM(r.planned_amount), 0) AS planned,
              COALESCE(SUM(r.reported_amount)
                       FILTER (WHERE r.kind = 'financier'
                               AND r.status IN ('soumis', 'valide')), 0) AS actual
         FROM tpm_reports r
        WHERE r.tenant_id = $1
        GROUP BY r.contract_id, r.period_month
        ORDER BY r.period_month`,
      [tenantId]
    );

    const shaped = contracts.map((c) => ({
      id: c.id,
      numero: c.numero,
      partnerId: null,
      partnerName: c.partnerName,
      dateDebut: c.dateDebut ? new Date(c.dateDebut).toISOString().slice(0, 10) : null,
      dateFin: c.dateFin ? new Date(c.dateFin).toISOString().slice(0, 10) : null,
      periodMonths: c.periodMonths,
      monitoringBudget: num(c.monitoringBudget),
    }));

    const shapedMonthly = monthly.map((m) => ({
      contractId: m.contractId,
      month: m.month,
      planned: num(m.planned),
      actual: num(m.actual),
    }));

    return buildConsolidation(shaped, shapedMonthly, { today });
  });
}

module.exports = { consolidation };
