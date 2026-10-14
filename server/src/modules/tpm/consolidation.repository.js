const { withTenantTransaction } = require('../../config/db');
const { REALISED_STATUS, PENDING_STATUS } = require('./realised');
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

/**
 * @param {{ today?: string, period?: {from,to}|null }} opts  today = mois de référence du cumul
 *   (« AAAA-MM ») ; period (lot 1b) = budget, planifié, réalisé et en attente DE LA PÉRIODE
 *   à côté du cumul (consolidation.buildConsolidation). Le SQL ne change pas : les flux sont
 *   déjà groupés par mois et le cumul du contrat a besoin de tous les mois.
 *   Une facture est comptée au mois de son `period_month` (même règle partout : la liste
 *   des rapports retient une facture pluri-mensuelle qui chevauche, mais le « Réalisé »
 *   d'une période ne somme que les factures dont le mois de début y tombe).
 */
async function consolidation(tenantId, { today, period = null } = {}) {
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

    // Monthly « Réalisé » per contract = funder share of VALIDATED financial
    // reports (single definition, see realised.js). Submitted ones are tracked
    // apart as « en attente de validation » and never added to the Réalisé.
    const { rows: actualRows } = await client.query(
      `SELECT r.contract_id AS "contractId",
              to_char(r.period_month, 'YYYY-MM') AS month,
              COALESCE(SUM(r.reported_amount) FILTER (WHERE r.status = $2), 0) AS actual,
              COALESCE(SUM(r.reported_amount) FILTER (WHERE r.status = $3), 0) AS pending
         FROM tpm_reports r
        WHERE r.tenant_id = $1 AND r.kind = 'financier'
        GROUP BY r.contract_id, r.period_month`,
      [tenantId, REALISED_STATUS, PENDING_STATUS]
    );
    // En centimes entiers (jamais une somme de flottants), comme consolidation.js.
    const pendingCents = new Map();
    for (const r of actualRows) pendingCents.set(r.contractId, (pendingCents.get(r.contractId) || 0) + Math.round(num(r.pending) * 100));

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
    for (const r of actualRows) byKey.set(keyOf(r.contractId, r.month), { contractId: r.contractId, month: r.month, planned: 0, actual: num(r.actual), pending: num(r.pending) });
    for (const r of plannedRows) {
      const k = keyOf(r.contractId, r.month);
      const cur = byKey.get(k) || { contractId: r.contractId, month: r.month, planned: 0, actual: 0, pending: 0 };
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

    const out = buildConsolidation(shaped, monthly, { today, period });
    // Factures soumises non encore validées : montrées à côté du Réalisé, jamais dedans.
    out.rows = out.rows.map((r) => ({ ...r, pendingValidation: (pendingCents.get(r.contractId) || 0) / 100 }));
    const totalPendingCents = out.rows.reduce((a, r) => a + (pendingCents.get(r.contractId) || 0), 0);
    out.totals = { ...out.totals, pendingValidation: totalPendingCents / 100 };
    return out;
  });
}

module.exports = { consolidation };
