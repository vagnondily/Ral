const { withTenantTransaction } = require('../../config/db');
const { toPeriod } = require('../common/period');
const { spanOverlaps } = require('../common/periodSql');
const { assertActiveTpmTx } = require('./activeProvider.repository');
const {
  decisionError, submitError, editError, notApplicableError, DECIDABLE, SUBMITTABLE,
} = require('./reportWorkflow');
const { normalizeItems, summarize } = require('./reportMath');
const { assertItemActivities } = require('./activityRefs');
const { LINE_LABELS, SECTION_OF } = require('../contracts/budgetCatalog');
const { isValidatedStatus, decideDocumentDeletion, linkedSummary } = require('../common/deletionPolicy');
const { recordDeletion } = require('../deletions/deletions.repository');

/**
 * Rapports & dépenses (sub-module of Partenaires & TPM). Monthly financial /
 * technical reports produced by a TPM partner against a contract's
 * monitoring budget (section IV « Suivi »).
 *
 * A financial report can hold a faithful « état des dépenses » (facture):
 * line items (contract_report_items) reproducing the real invoice, each a
 * quantité × coût unitaire = montant flagged bailleur / ONG. When items are
 * present the reported amount is derived from them (funder share), never typed.
 */

const num = (v) => (v == null ? v : Number(v));

const REPORT_COLUMNS = `
  r.id, r.partner_id AS "partnerId", pa.name AS "partnerName",
  r.contract_id AS "contractId", c.numero AS "contractNumero", c.numero_fla AS "contractFla", c.partner_name AS "contractPartner",
  r.period_month AS "periodMonth", r.period_end AS "periodEnd", r.invoice_no AS "invoiceNo",
  r.advance_deducted AS "advanceDeducted", r.kind, r.planned_amount AS "plannedAmount",
  r.reported_amount AS "reportedAmount", r.reference, r.document_name AS "documentName",
  r.status, r.comment, r.created_by AS "createdBy", u.email AS "createdByEmail", r.created_at AS "createdAt",
  r.submitted_at AS "submittedAt", r.submitted_by AS "submittedBy", sb.email AS "submittedByEmail",
  r.edited_by AS "editedBy", ed.email AS "editedByEmail", r.edited_at AS "editedAt",
  r.decided_by AS "decidedBy", d.email AS "decidedByEmail", r.decided_at AS "decidedAt"`;

const FROM = `
  FROM tpm_reports r
  JOIN partners pa ON pa.id = r.partner_id
  JOIN contracts c ON c.id = r.contract_id
  JOIN users u ON u.id = r.created_by
  LEFT JOIN users sb ON sb.id = r.submitted_by
  LEFT JOIN users ed ON ed.id = r.edited_by
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
    `SELECT i.id, i.line_code AS "lineCode", i.designation, i.unit, i.unit_count AS "unitCount",
            i.unit_cost AS "unitCost", i.pay_by AS "payBy", i.bailleur_pct AS "bailleurPct",
            i.activity_id AS "activityId", a.label AS "activityLabel",
            i.activity2_id AS "activity2Id", a2.label AS "activity2Label", i.activity1_pct AS "activity1Pct",
            i.site, i.observation, i.sort_order AS "sortOrder"
       FROM contract_report_items i
       LEFT JOIN activities a ON a.id = i.activity_id
       LEFT JOIN activities a2 ON a2.id = i.activity2_id
      WHERE i.tenant_id = $1 AND i.report_id = $2
      ORDER BY i.sort_order, i.id`,
    [tenantId, reportId]
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

const ITEM_COLS = 15; // tenant_id, report_id, line_code, designation, unit, unit_count, unit_cost, pay_by, bailleur_pct, activity_id, activity2_id, activity1_pct, site, observation, sort_order

/**
 * Insert the given items for a report in a single multi-row INSERT (assumes
 * the report row is locked). One round-trip whatever the number of postes —
 * a 500-line facture must not become 500 queries under load.
 */
async function insertItems(client, tenantId, reportId, items) {
  const clean = normalizeItems(items);
  if (clean.length === 0) return clean;
  await assertItemActivities(client, tenantId, clean); // activities must be the tenant's

  const params = [];
  const tuples = clean.map((it, i) => {
    const b = i * ITEM_COLS;
    params.push(tenantId, reportId, it.lineCode, it.designation, it.unit,
      it.unitCount, it.unitCost, it.payBy, it.bailleurPct, it.activityId, it.activity2Id, it.activity1Pct,
      it.site, it.observation, it.sortOrder);
    const p = Array.from({ length: ITEM_COLS }, (_, k) => `$${b + k + 1}`).join(',');
    return `(${p})`;
  });
  await client.query(
    `INSERT INTO contract_report_items
       (tenant_id, report_id, line_code, designation, unit, unit_count, unit_cost, pay_by, bailleur_pct, activity_id, activity2_id, activity1_pct, site, observation, sort_order)
     VALUES ${tuples.join(',')}`,
    params
  );
  return clean;
}

/**
 * Rapports du tenant, filtrés par prestataire, contrat et période (lot 1b).
 * `period` ({ from, to } | null ; l'ancien { month } reste lu) : un rapport est
 * retenu si [period_month, COALESCE(period_end, period_month)] CHEVAUCHE la
 * période — une facture pluri-mensuelle apparaît dans chaque période qu'elle
 * touche. Son montant reste compté au mois de period_month (consolidation,
 * « Réalisé validé ») : la liste montre, la somme ne double jamais.
 */
async function listReports(tenantId, { period, month, partnerId, contractId } = {}) {
  return withTenantTransaction(tenantId, async (client) => {
    const params = [tenantId];
    const where = ['r.tenant_id = $1'];
    const p = period !== undefined ? period : toPeriod({ month });
    if (p) where.push(spanOverlaps('r.period_month', 'r.period_end', p, params));
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

/**
 * All the data the formal invoice (INVOICE Mx) needs: the report + its items,
 * the contract identity/fee, the FLA budget per line (contribution bailleur),
 * and the cumulative funder spend per line up to and including this month —
 * so the .xlsx can show Budget · Dépenses du mois · Cumulé · Restant like the
 * real template. Everything derived from primary data, never trusted.
 */
async function invoiceData(tenantId, id) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT ${REPORT_COLUMNS}, c.numero_fla AS "numeroFla", c.numero_po AS "numeroPo",
              c.numero_vendor AS "numeroVendor", c.date_debut AS "dateDebut", c.date_fin AS "dateFin",
              c.management_fee_pct AS "managementFeePct"
         ${FROM} WHERE r.tenant_id = $1 AND r.id = $2`,
      [tenantId, id]
    );
    if (!rows[0]) return null;
    const report = cast(rows[0]);
    report.numeroFla = rows[0].numeroFla || null;
    report.numeroPo = rows[0].numeroPo || null;
    report.numeroVendor = rows[0].numeroVendor || null;
    report.dateDebut = rows[0].dateDebut || null;
    report.dateFin = rows[0].dateFin || null;
    report.managementFeePct = rows[0].managementFeePct == null ? 0.07 : num(rows[0].managementFeePct);
    const items = await loadItems(client, tenantId, id);

    const { rows: bud } = await client.query(
      `SELECT line_code AS "lineCode", SUM(unit_count * unit_cost) AS amount
         FROM contract_budget_items WHERE tenant_id = $1 AND contract_id = $2 GROUP BY line_code`,
      [tenantId, report.contractId]
    );
    // Cumulative funder spend per line across this contract+partner's financial
    // reports (soumis/valide) up to and including this report's month. This is
    // the cumul PRINTED ON the invoice: it always includes the invoice itself,
    // even while it is still a draft (attendu / rejeté) being exported. The
    // budget « Réalisé » indicator counts validated reports only (realised.js).
    // Part bailleur arrondie au centime PAR POSTE, comme reportMath.funderCentsOf
    // (« Dépenses du mois ») : cumulé et dépenses du mois restent cohérents.
    const { rows: cum } = await client.query(
      `SELECT i.line_code AS "lineCode",
              SUM(round(round(i.unit_count * i.unit_cost * 100) * i.bailleur_pct)) / 100 AS amount
         FROM contract_report_items i
         JOIN tpm_reports r ON r.id = i.report_id
        WHERE i.tenant_id = $1 AND r.tenant_id = $1 AND r.contract_id = $2 AND r.partner_id = $3
          AND r.kind = 'financier' AND (r.status IN ('soumis', 'valide') OR r.id = $4)
          AND r.period_month <= (SELECT period_month FROM tpm_reports WHERE tenant_id = $1 AND id = $4)
        GROUP BY i.line_code`,
      [tenantId, report.contractId, report.partnerId, id]
    );
    const budgetByLine = Object.fromEntries(bud.map((r) => [r.lineCode, num(r.amount)]));
    const cumulByLine = Object.fromEntries(cum.map((r) => [r.lineCode, num(r.amount)]));
    return { report: { ...report, items, summary: summarize(items) }, budgetByLine, cumulByLine };
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
      `SELECT c.id, c.numero, c.numero_fla AS "numeroFla", c.partner_name AS "partnerName", c.date_debut AS "dateDebut", c.date_fin AS "dateFin",
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
    // Configurable activities (Paramétrage › Activités) for the poste dropdown.
    const { rows: activities } = await client.query(
      'SELECT id, code, label FROM activities WHERE tenant_id = $1 AND active = true ORDER BY sort_order, label',
      [tenantId]
    );
    return {
      partners,
      activities,
      contracts: contracts.map((c) => {
        const fee = Number(c.managementFeePct) || 0;
        const grand = Math.round((num(c.directTotal) || 0) * (1 + fee) * 100) / 100;
        const months = c.periodMonths || 1;
        return {
          id: c.id, numero: c.numero, numeroFla: c.numeroFla || null, partnerName: c.partnerName, dateDebut: c.dateDebut, dateFin: c.dateFin,
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
    await assertActiveTpmTx(client, tenantId, r.partnerId); // une facture / un rapport = un TPM actif (D1)
    const existing = await findExisting(client, tenantId, r);
    if (existing) { const e = new Error('duplicate'); e.code = 'DUP'; throw e; }

    // A financial report with an état des dépenses derives its reported
    // amount from the items (the funder (bailleur) share) — never the typed figure.
    const hasItems = r.kind === 'financier' && Array.isArray(r.items) && r.items.length > 0;
    const cleanItems = hasItems ? normalizeItems(r.items) : null;
    const reportedAmount = hasItems ? summarize(cleanItems).funder : (r.reportedAmount ?? null);

    // Créé puis soumis dans la même transaction par son auteur, qui en est donc
    // le soumetteur : brouillon d'abord (les postes ne s'écrivent que sur un
    // brouillon, règle imposée en base), puis transition attendu → soumis.
    const { rows } = await client.query(
      `INSERT INTO tpm_reports (tenant_id, partner_id, contract_id, period_month, period_end, invoice_no,
                                advance_deducted, kind, planned_amount, reported_amount, reference,
                                document_name, status, created_by, edited_by, edited_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'attendu',$13,$13,now()) RETURNING id`,
      [tenantId, r.partnerId, r.contractId, r.periodMonth, r.periodEnd || null, r.invoiceNo || null,
        r.advanceDeducted ?? 0, r.kind, r.plannedAmount ?? null, reportedAmount,
        r.reference || null, r.documentName || null, r.createdBy]
    );
    const id = rows[0].id;
    if (hasItems) await insertItems(client, tenantId, id, cleanItems);
    await client.query(
      `UPDATE tpm_reports SET status = 'soumis', submitted_by = $3, submitted_at = now(), updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id, r.createdBy]
    );
    return id;
  });
}

/**
 * Replace the état des dépenses of a report and recompute its amount.
 * Rule `editError` (reportWorkflow), checked under the row lock: only a draft
 * (« attendu » / « rejeté »), and only by its author — an unfilled monthly
 * stub is taken over by whoever fills it first, who becomes its author
 * (edited_by). A submitted report is frozen while it awaits the decision.
 * Saving NEVER changes the status: « Soumettre » does (submitReport).
 * Returns the report id, or null if not found; throws code KIND / LOCKED /
 * AUTHOR (with the rule's message) otherwise.
 */
async function replaceReportItems(tenantId, id, items, { invoiceNo, periodEnd, advanceDeducted, userId } = {}) {
  return withTenantTransaction(tenantId, async (client) => {
    const report = await getReportRow(client, tenantId, id);
    if (!report) return null;
    if (report.kind !== 'financier') { const e = new Error('kind'); e.code = 'KIND'; throw e; }
    const denied = editError(report, userId);
    if (denied) { const e = new Error(denied.message); e.code = denied.code === 'author' ? 'AUTHOR' : 'LOCKED'; throw e; }

    await client.query('DELETE FROM contract_report_items WHERE tenant_id = $1 AND report_id = $2', [tenantId, id]);
    const clean = await insertItems(client, tenantId, id, items);
    const reported = summarize(clean).funder;

    await client.query(
      `UPDATE tpm_reports
          SET reported_amount = $3,
              invoice_no = COALESCE($4, invoice_no),
              period_end = COALESCE($5, period_end),
              advance_deducted = COALESCE($6, advance_deducted),
              edited_by = $7, edited_at = now(),
              updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id, reported, invoiceNo || null, periodEnd || null, advanceDeducted ?? null, userId]
    );
    return id;
  });
}

/**
 * Suppression d'un rapport (politique commune, retour 56, deletionPolicy) :
 *   - rapport NON validé (attendu/soumis/rejeté/non applicable) → supprimable
 *     après confirmation, sans justificatif ; ses postes disparaissent par
 *     cascade (FK ON DELETE CASCADE) ;
 *   - rapport VALIDÉ → réservé à l'administrateur, avec justificatif, et
 *     seulement sans donnée reliée : ni poste ni montant (le montant d'une
 *     facture validée est compté dans la consolidation). Règle prudente.
 * Chaque suppression est journalisée.
 * Retour : 'ok' si supprimé, null si absent, sinon { reason, linked }.
 */
async function deleteReport(tenantId, id, { actorId, isAdmin = false, justification } = {}) {
  return withTenantTransaction(tenantId, async (client) => {
    const report = await getReportRow(client, tenantId, id);
    if (!report) return null;

    const validated = isValidatedStatus('tpm_report', report.status);
    let linked = [];
    if (validated) {
      const { rows } = await client.query(
        'SELECT count(*)::int AS n FROM contract_report_items WHERE tenant_id = $1 AND report_id = $2',
        [tenantId, id]
      );
      linked = linkedSummary({ items: rows[0].n, booked: Number(report.reportedAmount) !== 0 ? 1 : 0 });
    }

    const decision = decideDocumentDeletion({ validated, hasLinkedData: linked.length > 0, isAdmin, justification });
    if (!decision.allowed) return { reason: decision.reason, linked };

    const month = String(report.periodMonth).slice(0, 7);
    await recordDeletion(client, tenantId, {
      docType: 'tpm_report',
      docId: id,
      docRef: `${report.kind === 'financier' ? 'Facture' : 'Rapport technique'} ${month} · ${report.partnerName || ''}`.trim(),
      summary: JSON.stringify({
        kind: report.kind, month, partner: report.partnerName,
        contract: report.contractNumero, reportedAmount: report.reportedAmount,
        invoiceNo: report.invoiceNo || null,
      }).slice(0, 4096),
      statusAtDeletion: report.status,
      validated,
      justification: decision.justification,
      deletedBy: actorId,
    });
    await client.query('DELETE FROM tpm_reports WHERE tenant_id = $1 AND id = $2', [tenantId, id]);
    return 'ok';
  });
}

/**
 * Génère les gabarits de rapports financiers mensuels d'un contrat × TPM :
 * un rapport « attendu » (montant 0, à remplir ou à marquer non applicable)
 * par mois de la période du contrat. Idempotent (ON CONFLICT DO NOTHING).
 */
async function generateMonthlyStubs(tenantId, { contractId, partnerId, createdBy }) {
  return withTenantTransaction(tenantId, async (client) => {
    await assertActiveTpmTx(client, tenantId, partnerId);
    const { rows: c } = await client.query(
      'SELECT date_debut AS "dateDebut", date_fin AS "dateFin" FROM contracts WHERE tenant_id = $1 AND id = $2',
      [tenantId, contractId]
    );
    if (!c[0]) { const e = new Error('contract'); e.code = 'NOCONTRACT'; throw e; }
    const toIdx = (d) => { const [y, m] = String(d).slice(0, 7).split('-').map(Number); return y * 12 + (m - 1); };
    const start = toIdx(c[0].dateDebut);
    const end = toIdx(c[0].dateFin);
    let created = 0;
    for (let i = start; i <= end && i - start < 60; i += 1) {
      const month = `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}-01`;
      const { rowCount } = await client.query(
        `INSERT INTO tpm_reports (tenant_id, partner_id, contract_id, period_month, kind, reported_amount, status, created_by)
         VALUES ($1,$2,$3,$4,'financier',0,'attendu',$5)
         ON CONFLICT (partner_id, contract_id, period_month, kind) DO NOTHING`,
        [tenantId, partnerId, contractId, month, createdBy]
      );
      created += rowCount;
    }
    return { created };
  });
}

/**
 * Décision (valide / rejete) sous verrou de ligne : le statut, le soumetteur et
 * l'auteur du contenu sont relus dans la transaction, la règle `decisionError`
 * s'applique (ni le soumetteur ni l'auteur ne décident), puis la mise à jour
 * exige encore le statut « soumis » (aucune double décision possible).
 * @returns {Promise<{ ok: true } | { error: 'not_found' } | { error: 'status' | 'self', message: string }>}
 */
async function setStatus(tenantId, id, status, userId, comment) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT status, created_by AS "createdBy", submitted_by AS "submittedBy", edited_by AS "editedBy"
         FROM tpm_reports WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [tenantId, id]);
    if (!rows.length) return { error: 'not_found' };
    const err = decisionError(rows[0], userId);
    if (err) return { error: err.code, message: err.message };
    await client.query(
      `UPDATE tpm_reports SET status = $3, decided_by = $4, decided_at = now(), comment = COALESCE($5, comment), updated_at = now()
        WHERE tenant_id = $1 AND id = $2 AND status = '${DECIDABLE}'`,
      [tenantId, id, status, userId, comment || null]
    );
    return { ok: true };
  });
}

/**
 * Soumettre un rapport « attendu » ou « rejeté » (machine d'états
 * reportWorkflow) : statut relu sous verrou de ligne, règle `submitError`
 * (par son auteur seulement ; une facture doit porter un état des dépenses ou
 * un montant), puis mise à jour qui exige encore un statut soumettable (aucune
 * double soumission). Le soumetteur est enregistré : il ne pourra ni valider
 * ni rejeter.
 * @returns {Promise<{ ok: true } | { error: 'not_found' } | { error: 'status' | 'author' | 'empty', message: string }>}
 */
async function submitReport(tenantId, id, userId) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT status, kind, reported_amount AS "reportedAmount", edited_by AS "editedBy"
         FROM tpm_reports WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [tenantId, id]);
    if (!rows.length) return { error: 'not_found' };
    const { rows: cnt } = await client.query(
      'SELECT count(*)::int AS n FROM contract_report_items WHERE tenant_id = $1 AND report_id = $2', [tenantId, id]);
    const err = submitError({ ...rows[0], reportedAmount: num(rows[0].reportedAmount), itemCount: cnt[0].n }, userId);
    if (err) return { error: err.code, message: err.message };
    // Auteur inconnu (contenu antérieur à la migration 058) : la personne qui
    // soumet s'en porte garante et en devient l'auteur.
    await client.query(
      `UPDATE tpm_reports SET status = 'soumis', submitted_by = $3, submitted_at = now(), updated_at = now(),
              edited_by = COALESCE(edited_by, $3), edited_at = COALESCE(edited_at, now())
        WHERE tenant_id = $1 AND id = $2 AND status = ANY($4::text[])`,
      [tenantId, id, userId, SUBMITTABLE]
    );
    return { ok: true };
  });
}

/** « Non applicable » (aucun suivi ce mois) : vérifié et écrit sous le même verrou ; jamais sur un rapport validé. */
async function markNotApplicable(tenantId, id, userId, comment) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query('SELECT status FROM tpm_reports WHERE tenant_id = $1 AND id = $2 FOR UPDATE', [tenantId, id]);
    if (!rows.length) return { error: 'not_found' };
    if (notApplicableError(rows[0])) return { error: 'locked' };
    await client.query(
      `UPDATE tpm_reports SET status = 'non_applicable', decided_by = $3, decided_at = now(), comment = COALESCE($4, comment), updated_at = now()
        WHERE tenant_id = $1 AND id = $2`, [tenantId, id, userId, comment || null]);
    return { ok: true };
  });
}

module.exports = {
  listReports, getReport, invoiceData, reportContext, insertReport, submitReport, setStatus, markNotApplicable,
  replaceReportItems, deleteReport, generateMonthlyStubs,
};
