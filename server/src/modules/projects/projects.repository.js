/**
 * Projets (première version — docs/SPEC_PROGRAMMES.md). Référentiel simple, layered repository :
 * seul ce fichier écrit le SQL. Trois tables tenant (RLS) : projects, project_logframe, project_needs.
 * Montant en CENTIMES (entier), jamais de flottant. Tout filtre tenant_id = $1 dans withTenantTransaction.
 */
const { withTenantTransaction } = require('../../config/db');

const PROJECT_COLS = `id, name, code, grant_number AS "grantNumber", award_number AS "awardNumber",
  donor_code AS "donorCode", donor_name AS "donorName", regions, to_char(start_date,'YYYY-MM-DD') AS "startDate",
  to_char(end_date,'YYYY-MM-DD') AS "endDate", status, budget_amount AS "budgetAmount", currency, description,
  created_at AS "createdAt", updated_at AS "updatedAt"`;

async function listProjects(tenantId) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT ${PROJECT_COLS},
              (SELECT count(*)::int FROM project_logframe l WHERE l.tenant_id = $1 AND l.project_id = p.id) AS "logframeCount",
              (SELECT count(*)::int FROM project_needs n WHERE n.tenant_id = $1 AND n.project_id = p.id) AS "needsCount"
         FROM projects p WHERE tenant_id = $1 ORDER BY lower(name)`, [tenantId]);
    return rows;
  });
}

async function getProject(tenantId, id) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows: [project] } = await client.query(`SELECT ${PROJECT_COLS} FROM projects WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
    if (!project) return null;
    const { rows: logframe } = await client.query(
      `SELECT id, parent_id AS "parentId", level, statement, indicator, baseline, target,
              means_of_verification AS "meansOfVerification", assumptions, sort_order AS "sortOrder"
         FROM project_logframe WHERE tenant_id = $1 AND project_id = $2 ORDER BY sort_order, created_at`, [tenantId, id]);
    const { rows: needs } = await client.query(
      `SELECT id, title, description, zone, target_population AS "targetPopulation", priority, sort_order AS "sortOrder"
         FROM project_needs WHERE tenant_id = $1 AND project_id = $2 ORDER BY sort_order, created_at`, [tenantId, id]);
    return { ...project, logframe, needs };
  });
}

const PROJECT_FIELDS = ['name', 'code', 'grantNumber', 'awardNumber', 'donorCode', 'donorName', 'regions', 'startDate', 'endDate', 'status', 'budgetAmount', 'currency', 'description'];
const COL = { grantNumber: 'grant_number', awardNumber: 'award_number', donorCode: 'donor_code', donorName: 'donor_name', startDate: 'start_date', endDate: 'end_date', budgetAmount: 'budget_amount' };
const col = (k) => COL[k] || k;

async function createProject(tenantId, input) {
  return withTenantTransaction(tenantId, async (client) => {
    const keys = PROJECT_FIELDS.filter((k) => input[k] !== undefined);
    const cols = keys.map(col);
    const vals = keys.map((k) => input[k]);
    const { rows } = await client.query(
      `INSERT INTO projects (tenant_id, ${cols.join(', ')}) VALUES ($1, ${keys.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING id`,
      [tenantId, ...vals]);
    return rows[0].id;
  });
}

async function updateProject(tenantId, id, input) {
  const keys = PROJECT_FIELDS.filter((k) => input[k] !== undefined);
  if (!keys.length) return true;
  return withTenantTransaction(tenantId, async (client) => {
    const sets = keys.map((k, i) => `${col(k)} = $${i + 3}`);
    const { rowCount } = await client.query(
      `UPDATE projects SET ${sets.join(', ')}, updated_at = now() WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id, ...keys.map((k) => input[k])]);
    return rowCount === 1;
  });
}

async function deleteProject(tenantId, id) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rowCount } = await client.query('DELETE FROM projects WHERE tenant_id = $1 AND id = $2', [tenantId, id]);
    return rowCount === 1;
  });
}

// ---- Cadre logique -------------------------------------------------------------------
async function addLogframe(tenantId, projectId, r) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows: [p] } = await client.query('SELECT 1 FROM projects WHERE tenant_id = $1 AND id = $2', [tenantId, projectId]);
    if (!p) return null;
    const { rows } = await client.query(
      `INSERT INTO project_logframe (tenant_id, project_id, parent_id, level, statement, indicator, baseline, target, means_of_verification, assumptions, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [tenantId, projectId, r.parentId || null, r.level, r.statement, r.indicator || null, r.baseline || null, r.target || null, r.meansOfVerification || null, r.assumptions || null, r.sortOrder || 0]);
    return rows[0].id;
  });
}
async function updateLogframe(tenantId, id, r) {
  const fields = ['level', 'statement', 'indicator', 'baseline', 'target', 'meansOfVerification', 'assumptions', 'sortOrder', 'parentId'];
  const map = { meansOfVerification: 'means_of_verification', sortOrder: 'sort_order', parentId: 'parent_id' };
  const keys = fields.filter((k) => r[k] !== undefined);
  if (!keys.length) return true;
  return withTenantTransaction(tenantId, async (client) => {
    const sets = keys.map((k, i) => `${map[k] || k} = $${i + 3}`);
    const { rowCount } = await client.query(
      `UPDATE project_logframe SET ${sets.join(', ')}, updated_at = now() WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id, ...keys.map((k) => r[k])]);
    return rowCount === 1;
  });
}
async function deleteLogframe(tenantId, id) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rowCount } = await client.query('DELETE FROM project_logframe WHERE tenant_id = $1 AND id = $2', [tenantId, id]);
    return rowCount === 1;
  });
}

// ---- Besoins -------------------------------------------------------------------------
async function addNeed(tenantId, projectId, r) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows: [p] } = await client.query('SELECT 1 FROM projects WHERE tenant_id = $1 AND id = $2', [tenantId, projectId]);
    if (!p) return null;
    const { rows } = await client.query(
      `INSERT INTO project_needs (tenant_id, project_id, title, description, zone, target_population, priority, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [tenantId, projectId, r.title, r.description || null, r.zone || null, r.targetPopulation ?? null, r.priority || null, r.sortOrder || 0]);
    return rows[0].id;
  });
}
async function updateNeed(tenantId, id, r) {
  const fields = ['title', 'description', 'zone', 'targetPopulation', 'priority', 'sortOrder'];
  const map = { targetPopulation: 'target_population', sortOrder: 'sort_order' };
  const keys = fields.filter((k) => r[k] !== undefined);
  if (!keys.length) return true;
  return withTenantTransaction(tenantId, async (client) => {
    const sets = keys.map((k, i) => `${map[k] || k} = $${i + 3}`);
    const { rowCount } = await client.query(
      `UPDATE project_needs SET ${sets.join(', ')}, updated_at = now() WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id, ...keys.map((k) => r[k])]);
    return rowCount === 1;
  });
}
async function deleteNeed(tenantId, id) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rowCount } = await client.query('DELETE FROM project_needs WHERE tenant_id = $1 AND id = $2', [tenantId, id]);
    return rowCount === 1;
  });
}

module.exports = {
  listProjects, getProject, createProject, updateProject, deleteProject,
  addLogframe, updateLogframe, deleteLogframe, addNeed, updateNeed, deleteNeed,
};
