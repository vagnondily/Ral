const { withTenantTransaction } = require('../../config/db');
const { computeAll } = require('./monitoringMath');

/**
 * Suivi de processus — data access. Forms + configurable indicators (the
 * mapping) + real submissions. Everything tenant-scoped and inside a tenant
 * transaction so RLS applies.
 */

const num = (v) => (v == null ? v : Number(v));

// ---- Forms ---------------------------------------------------------------
async function listForms(tenantId) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT f.id, f.code, f.label, f.active,
              COALESCE((SELECT count(*) FROM monitoring_indicators i WHERE i.form_id = f.id), 0)::int AS "indicatorCount",
              COALESCE((SELECT count(*) FROM monitoring_submissions s WHERE s.form_id = f.id), 0)::int AS "submissionCount"
         FROM monitoring_forms f WHERE f.tenant_id = $1 ORDER BY f.label`,
      [tenantId]
    );
    return rows;
  });
}

async function createForm(tenantId, { code, label }) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO monitoring_forms (tenant_id, code, label) VALUES ($1,$2,$3) RETURNING id`,
      [tenantId, code, label]
    );
    return rows[0].id;
  });
}

async function updateForm(tenantId, id, { label, active }) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rowCount } = await client.query(
      `UPDATE monitoring_forms SET label = COALESCE($3, label), active = COALESCE($4, active)
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id, label ?? null, active ?? null]
    );
    return rowCount === 1;
  });
}

// ---- Indicators (the configurable mapping) -------------------------------
function castIndicator(r) {
  return { ...r, target: num(r.target) };
}

async function listIndicators(tenantId, formId) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT id, form_id AS "formId", code, label, module, source_field AS "sourceField",
              agg, positive_value AS "positiveValue", target, direction, sort_order AS "sortOrder", active
         FROM monitoring_indicators WHERE tenant_id = $1 AND form_id = $2
        ORDER BY sort_order, label`,
      [tenantId, formId]
    );
    return rows.map(castIndicator);
  });
}

async function createIndicator(tenantId, formId, ind) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO monitoring_indicators
         (tenant_id, form_id, code, label, module, source_field, agg, positive_value, target, direction, sort_order, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,COALESCE($12,true)) RETURNING id`,
      [tenantId, formId, ind.code, ind.label, ind.module || null, ind.sourceField, ind.agg || 'percent_yes',
        ind.positiveValue || null, ind.target ?? null, ind.direction || 'higher_better', ind.sortOrder ?? 0, ind.active]
    );
    return rows[0].id;
  });
}

async function updateIndicator(tenantId, id, ind) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rowCount } = await client.query(
      `UPDATE monitoring_indicators SET
         label = COALESCE($3,label), module = $4, source_field = COALESCE($5,source_field),
         agg = COALESCE($6,agg), positive_value = $7, target = $8,
         direction = COALESCE($9,direction), sort_order = COALESCE($10,sort_order), active = COALESCE($11,active)
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id, ind.label ?? null, ind.module ?? null, ind.sourceField ?? null, ind.agg ?? null,
        ind.positiveValue ?? null, ind.target ?? null, ind.direction ?? null, ind.sortOrder ?? null, ind.active ?? null]
    );
    return rowCount === 1;
  });
}

async function deleteIndicator(tenantId, id) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rowCount } = await client.query('DELETE FROM monitoring_indicators WHERE tenant_id = $1 AND id = $2', [tenantId, id]);
    return rowCount === 1;
  });
}

// ---- Submissions ---------------------------------------------------------
/** Distinct answer fields seen in recent submissions — feeds the mapping UI. */
async function formFields(tenantId, formId) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT DISTINCT k AS field
         FROM (SELECT jsonb_object_keys(data) AS k
                 FROM monitoring_submissions
                WHERE tenant_id = $1 AND form_id = $2
                ORDER BY created_at DESC LIMIT 500) t
        ORDER BY field`,
      [tenantId, formId]
    );
    return rows.map((r) => r.field);
  });
}

async function importSubmissions(tenantId, formId, submissions) {
  return withTenantTransaction(tenantId, async (client) => {
    // Confirm the form belongs to the tenant.
    const { rows: f } = await client.query('SELECT id FROM monitoring_forms WHERE tenant_id = $1 AND id = $2', [tenantId, formId]);
    if (!f[0]) return null;

    let inserted = 0;
    // Insert row by row so ON CONFLICT dedup (per _uuid) is simple and safe.
    for (const s of submissions) {
      const res = await client.query(
        `INSERT INTO monitoring_submissions
           (tenant_id, form_id, external_id, period_month, submitted_at, field_office,
            admin1, admin2, admin3, admin4, site, partner, agent, source, data)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         ON CONFLICT (form_id, external_id) DO UPDATE SET
           period_month = EXCLUDED.period_month, submitted_at = EXCLUDED.submitted_at,
           field_office = EXCLUDED.field_office, admin1 = EXCLUDED.admin1, admin2 = EXCLUDED.admin2,
           admin3 = EXCLUDED.admin3, admin4 = EXCLUDED.admin4, site = EXCLUDED.site,
           partner = EXCLUDED.partner, agent = EXCLUDED.agent, source = EXCLUDED.source, data = EXCLUDED.data`,
        [tenantId, formId, s.externalId, s.periodMonth, s.submittedAt, s.fieldOffice,
          s.admin1, s.admin2, s.admin3, s.admin4, s.site, s.partner, s.agent, s.source, JSON.stringify(s.data || {})]
      );
      inserted += res.rowCount;
    }
    return { received: submissions.length, inserted };
  });
}

/** Compute the form's indicator values over submissions (optional month filter). */
async function computeValues(tenantId, formId, { month } = {}) {
  return withTenantTransaction(tenantId, async (client) => {
    const params = [tenantId, formId];
    let where = 's.tenant_id = $1 AND s.form_id = $2';
    if (month) { params.push(`${month.slice(0, 7)}-01`); where += ` AND s.period_month = $${params.length}`; }
    const { rows: subs } = await client.query(`SELECT data FROM monitoring_submissions s WHERE ${where}`, params);
    const { rows: inds } = await client.query(
      `SELECT id, code, label, module, source_field AS "sourceField", agg,
              positive_value AS "positiveValue", target, direction, sort_order
         FROM monitoring_indicators WHERE tenant_id = $1 AND form_id = $2 AND active = true
        ORDER BY sort_order, label`,
      [tenantId, formId]
    );
    return { count: subs.length, indicators: computeAll(inds, subs) };
  });
}

module.exports = {
  listForms, createForm, updateForm,
  listIndicators, createIndicator, updateIndicator, deleteIndicator,
  formFields, importSubmissions, computeValues,
};
