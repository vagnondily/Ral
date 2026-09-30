const { withTenantTransaction } = require('../../config/db');

/**
 * Rapports & dépenses (sub-module of Partenaires & TPM). Monthly financial /
 * technical reports produced by a TPM partner against a contract's
 * monitoring budget (section IV « Suivi »). Metadata only for now — the
 * document itself is not stored yet.
 */

const num = (v) => (v == null ? v : Number(v));

const REPORT_COLUMNS = `
  r.id, r.partner_id AS "partnerId", pa.name AS "partnerName",
  r.contract_id AS "contractId", c.numero AS "contractNumero", c.partner_name AS "contractPartner",
  r.period_month AS "periodMonth", r.kind, r.planned_amount AS "plannedAmount",
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
  return { ...r, plannedAmount: num(r.plannedAmount), reportedAmount: num(r.reportedAmount) };
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

async function getReport(client, tenantId, id) {
  const { rows } = await client.query(
    `SELECT ${REPORT_COLUMNS} ${FROM} WHERE r.tenant_id = $1 AND r.id = $2 FOR UPDATE OF r`,
    [tenantId, id]
  );
  return rows[0] ? cast(rows[0]) : null;
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
    const { rows } = await client.query(
      `INSERT INTO tpm_reports (tenant_id, partner_id, contract_id, period_month, kind, planned_amount,
                                reported_amount, reference, document_name, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'soumis',$10) RETURNING id`,
      [tenantId, r.partnerId, r.contractId, r.periodMonth, r.kind, r.plannedAmount ?? null,
        r.reportedAmount ?? null, r.reference || null, r.documentName || null, r.createdBy]
    );
    return rows[0].id;
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

module.exports = { listReports, getReport, reportContext, insertReport, setStatus };
