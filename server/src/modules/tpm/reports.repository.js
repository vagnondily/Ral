const { withTenantTransaction } = require('../../config/db');
const { normalizeItems, summarize } = require('./reportMath');
const { LINE_LABELS, SECTION_OF } = require('../contracts/budgetCatalog');

/**
 * Rapports & dépenses (sub-module of Partenaires & TPM). Monthly financial /
 * technical reports produced by a TPM partner against a contract's
 * monitoring budget (section IV « Suivi »).
 *
 * A financial report can hold a faithful « état des dépenses » (facture):
 * line items (contract_report_items) reproducing the real invoice, each a
 * quantité × coût unitaire = montant flagged PAM / ONG. When items are
 * present the reported amount is derived from them (PAM share), never typed.
 */

const num = (v) => (v == null ? v : Number(v));

const REPORT_COLUMNS = `
  r.id, r.partner_id AS "partnerId", pa.name AS "partnerName",
  r.contract_id AS "contractId", c.numero AS "contractNumero", c.partner_name AS "contractPartner",
  r.period_month AS "periodMonth", r.period_end AS "periodEnd", r.invoice_no AS "invoiceNo",
  r.advance_deducted AS "advanceDeducted", r.kind, r.planned_amount AS "plannedAmount",
  r.reported_amount AS "reportedAmount", r.reference, r.document_name AS "documentName",
  r.status, r.comment, r.created_by AS "createdBy", u.email AS "createdByEmail", r.created_at AS "createdAt",
  r.submitted_at AS "submittedAt", r.decided_by AS "decidedBy", d.email AS "decidedByEmail", r.decided_at AS "decidedAt"`;

const FROM = `
  FROM tpm_reports r
  JOIN partners pa ON pa.id = r.partner_id
  JOIN contracts c ON c.id = r.contract_id
  JOIN users u ON u.id = r.created_by
  LEFT JOIN users d ON d.id = r.decided_by`;

function cast(r) {
  return {
    ...r,
    plannedAmount: num(r.plannedAmount),
    reportedAmount: num(r.reportedAmount),
    advanceDeducted: num(r.advanceDeducted),
  };
}

/** Load the invoice line items of a report, with computed montant + labels. */
async function loadItems(client, tenantId, reportId) {
  const { rows } = await client.query(
    `SELECT id, line_code AS "lineCode", designation, unit, unit_count AS "unitCount",
            unit_cost AS "unitCost", pay_by AS "payBy", site, observation, sort_order AS "sortOrder"
       FROM contract_report_items
      WHERE tenant_id = $1 AND report_id = $2
      ORDER BY sort_order, id`,
    [tenantId, reportId]
  );
  return rows.map((it) => ({
    ...it,
    unitCount: num(it.unitCount),
    unitCost: num(it.unitCost),
    amount: Math.round(Number(it.unitCount || 0) * Number(it.unitCost || 0) * 100) / 100,
    lineLabel: LINE_LABELS[it.lineCode] || it.lineCode,
    section: SECTION_OF[it.lineCode] || String(it.lineCode || '').split('.')[0],
  }));
}

const ITEM_COLS = 11; // tenant_id, report_id, line_code, designation, unit, unit_count, unit_cost, pay_by, site, observation, sort_order

/**
 * Insert the given items for a report in a single multi-row INSERT (assumes
 * the report row is locked). One round-trip whatever the number of postes —
 * a 500-line facture must not become 500 queries under load.
 */
async function insertItems(client, tenantId, reportId, items) {
  const clean = normalizeItems(items);
  if (clean.length === 0) return clean;

  const params = [];
  const tuples = clean.map((it, i) => {
    const b = i * ITEM_COLS;
    params.push(tenantId, reportId, it.lineCode, it.designation, it.unit,
      it.unitCount, it.unitCost, it.payBy, it.site, it.observation, it.sortOrder);
    return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10},$${b + 11})`;
  });
  await client.query(
    `INSERT INTO contract_report_items
       (tenant_id, report_id, line_code, designation, unit, unit_count, unit_cost, pay_by, site, observation, sort_order)
     VALUES ${tuples.join(',')}`,
    params
  );
  return clean;
}

async function listReports(tenantId, { month, partnerId, contractId } = {}) {
  return withTenantTransaction(tenantId, async (client) => {
    const params = [tenantId];
    const where = ['r.tenant_id = $1'];
    if (month) { params.push(`${month.slice(0, 7)}-01`); where.push(`r.period_month = $${params.length}`); }
    if (partnerId) { params.push(partnerId); where.push(`r.partner_id = $${params.length}`); }
    if (contractId) { params.push(contractId); where.push(`r.contract_id = $${params.length}`); }
    const { rows } = await client.query(
      `SELECT ${REPORT_COLUMNS} ${FROM} WHERE ${where.join(' AND ')}
       ORDER BY r.period_month DESC, pa.name, r.kind`,
      params
    );
    return rows.map(cast);
  });
}

async function getReportRow(client, tenantId, id) {
  const { rows } = await client.query(
    `SELECT ${REPORT_COLUMNS} ${FROM} WHERE r.tenant_id = $1 AND r.id = $2 FOR UPDATE OF r`,
    [tenantId, id]
  );
  return rows[0] ? cast(rows[0]) : null;
}

/** Full facture: report + its état des dépenses (items) + computed summary. */
async function getReport(tenantId, id) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT ${REPORT_COLUMNS} ${FROM} WHERE r.tenant_id = $1 AND r.id = $2`,
      [tenantId, id]
    );
    if (!rows[0]) return null;
    const report = cast(rows[0]);
    const items = await loadItems(client, tenantId, id);
    return { ...report, items, summary: summarize(items) };
  });
}

/** TPM partners + monitoring contracts (active, with a Suivi budget) for the pickers. */
async function reportContext(tenantId) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows: partners } = await client.query(
      `SELECT p.id, p.name FROM partners p JOIN partner_types pt ON pt.id = p.partner_type_id
        WHERE p.tenant_id = $1 AND pt.code = 'tpm' AND p.active = true ORDER BY p.name`,
      [tenantId]
    );
    const { rows: contracts } = await client.query(
      `SELECT c.id, c.numero, c.partner_name AS "partnerName", c.date_debut AS "dateDebut", c.date_fin AS "dateFin",
              c.management_fee_pct AS "managementFeePct", c.period_months AS "periodMonths",
              COALESCE(s.total, 0) AS "monitoringBudget",
              COALESCE(d.total, 0) AS "directTotal"
         FROM contracts c
         JOIN LATERAL (SELECT SUM(unit_count * unit_cost) AS total FROM contract_budget_items
                        WHERE contract_id = c.id AND line_code = 'IV.suivi') s ON true
         LEFT JOIN LATERAL (SELECT SUM(unit_count * unit_cost) AS total FROM contract_budget_items
                        WHERE contract_id = c.id) d ON true
        WHERE c.tenant_id = $1 AND c.status = 'actif' AND COALESCE(s.total, 0) > 0
        ORDER BY c.partner_name`,
      [tenantId]
    );
    return {
      partners,
      contracts: contracts.map((c) => {
        const fee = Number(c.managementFeePct) || 0;
        const grand = Math.round((num(c.directTotal) || 0) * (1 + fee) * 100) / 100;
        const months = c.periodMonths || 1;
        return {
          id: c.id, numero: c.numero, partnerName: c.partnerName, dateDebut: c.dateDebut, dateFin: c.dateFin,
          monitoringBudget: num(c.monitoringBudget),
          grandTotal: grand,
          periodMonths: months,
          monthlyCeiling: months > 0 ? Math.round((grand / months) * 100) / 100 : 0,
        };
      }),
    };
  });
}

/** Existing report for the natural key, if any (to enforce one per kind/month). */
async function findExisting(client, tenantId, { partnerId, contractId, periodMonth, kind }) {
  const { rows } = await client.query(
    `SELECT id FROM tpm_reports WHERE tenant_id = $1 AND partner_id = $2 AND contract_id = $3 AND period_month = $4 AND kind = $5`,
    [tenantId, partnerId, contractId, periodMonth, kind]
  );
  return rows[0] || null;
}

async function insertReport(tenantId, r) {
  return withTenantTransaction(tenantId, async (client) => {
    const existing = await findExisting(client, tenantId, r);
    if (existing) { const e = new Error('duplicate'); e.code = 'DUP'; throw e; }

    // A financial report with an état des dépenses derives its reported
    // amount from the items (the PAM share) — never the typed figure.
    const hasItems = r.kind === 'financier' && Array.isArray(r.items) && r.items.length > 0;
    const cleanItems = hasItems ? normalizeItems(r.items) : null;
    const reportedAmount = hasItems ? summarize(cleanItems).pam : (r.reportedAmount ?? null);

    const { rows } = await client.query(
      `INSERT INTO tpm_reports (tenant_id, partner_id, contract_id, period_month, period_end, invoice_no,
                                advance_deducted, kind, planned_amount, reported_amount, reference,
                                document_name, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'soumis',$13) RETURNING id`,
      [tenantId, r.partnerId, r.contractId, r.periodMonth, r.periodEnd || null, r.invoiceNo || null,
        r.advanceDeducted ?? 0, r.kind, r.plannedAmount ?? null, reportedAmount,
        r.reference || null, r.documentName || null, r.createdBy]
    );
    const id = rows[0].id;
    if (hasItems) await insertItems(client, tenantId, id, cleanItems);
    return id;
  });
}

/**
 * Replace the état des dépenses of a report and recompute its amount.
 * Only editable while the report is not yet validated.
 * Returns the report id, or null if not found / not editable.
 */
async function replaceReportItems(tenantId, id, items, { invoiceNo, periodEnd, advanceDeducted } = {}) {
  return withTenantTransaction(tenantId, async (client) => {
    const report = await getReportRow(client, tenantId, id);
    if (!report) return null;
    if (report.kind !== 'financier') { const e = new Error('kind'); e.code = 'KIND'; throw e; }
    if (report.status === 'valide') { const e = new Error('locked'); e.code = 'LOCKED'; throw e; }

    await client.query('DELETE FROM contract_report_items WHERE tenant_id = $1 AND report_id = $2', [tenantId, id]);
    const clean = await insertItems(client, tenantId, id, items);
    const reported = summarize(clean).pam;

    await client.query(
      `UPDATE tpm_reports
          SET reported_amount = $3,
              invoice_no = COALESCE($4, invoice_no),
              period_end = COALESCE($5, period_end),
              advance_deducted = COALESCE($6, advance_deducted),
              status = CASE WHEN status = 'rejete' THEN 'soumis' ELSE status END,
              updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id, reported, invoiceNo || null, periodEnd || null, advanceDeducted ?? null]
    );
    return id;
  });
}

async function setStatus(tenantId, id, status, userId, comment) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rowCount } = await client.query(
      `UPDATE tpm_reports SET status = $3, decided_by = $4, decided_at = now(), comment = COALESCE($5, comment), updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id, status, userId, comment || null]
    );
    return rowCount === 1;
  });
}

module.exports = { listReports, getReport, reportContext, insertReport, setStatus, replaceReportItems };
