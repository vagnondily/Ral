const { withTenantTransaction } = require('../../config/db');
const { insertRows } = require('../../db/batch');
const { DEFAULT_CRITERIA } = require('./gridScore');

/**
 * Évaluations (lot 8, retours 28.1 et 28.3) — SEUL fichier du module qui écrit du SQL.
 * Chaque requête filtre tenant_id = $1 (RLS en plus) ; les écritures sur plusieurs
 * instructions passent par withTenantTransaction (tout ou rien) ; les grilles s'écrivent en
 * UNE instruction multi-lignes. Les notes sont calculées par le service (modules purs), jamais
 * prises du client.
 */

// ---- Critères des grilles -------------------------------------------------------------
const CRITERION_COLS = `c.id, c.scope, c.code, c.label, c.help, c.weight::float8 AS weight, c.sort_order AS "sortOrder", c.active`;

/** Critères par défaut d'une portée, tels qu'ils seront enregistrés (même ordre, poids 1). */
const defaultCriteria = (scope) => DEFAULT_CRITERIA[scope].map(([code, label, help], i) => ({
  id: null, scope, code, label, help, weight: 1, sortOrder: (i + 1) * 10, active: true, isDefault: true,
}));

/**
 * Critères d'une portée. Les critères par défaut ne sont ENREGISTRÉS qu'à la première écriture
 * (nouvelle évaluation, nouveau critère) : une simple lecture — même d'un compte en lecture seule —
 * n'écrit rien et rend les critères par défaut non enregistrés (id null, `isDefault`).
 */
async function criteriaTx(client, tenantId, scope, { activeOnly = false, persistDefaults = true } = {}) {
  const read = () => client.query(
    `SELECT ${CRITERION_COLS} FROM evaluation_criteria c WHERE c.tenant_id = $1 AND c.scope = $2
      ${activeOnly ? 'AND c.active' : ''} ORDER BY c.sort_order, c.label`, [tenantId, scope]);
  const { rows } = await read();
  if (rows.length) return rows;
  const { rows: [{ n }] } = await client.query('SELECT count(*)::int AS n FROM evaluation_criteria WHERE tenant_id = $1 AND scope = $2', [tenantId, scope]);
  if (n > 0) return rows; // des critères existent (tous désactivés) : ne rien recréer
  if (!persistDefaults) return defaultCriteria(scope);
  await insertRows(client, {
    table: 'evaluation_criteria', columns: ['tenant_id', 'scope', 'code', 'label', 'help', 'weight', 'sort_order'],
    rows: DEFAULT_CRITERIA[scope].map(([code, label, help], i) => ({ code, label, help, i })),
    values: (r) => [tenantId, scope, r.code, r.label, r.help, 1, (r.i + 1) * 10],
    suffix: 'ON CONFLICT (tenant_id, scope, code) DO NOTHING',
  });
  return (await read()).rows;
}

async function listCriteria(tenantId, scope) {
  return withTenantTransaction(tenantId, (client) => criteriaTx(client, tenantId, scope, { persistDefaults: false }));
}

/** Ajout d'un critère (administrateur). Code unique dans la portée (409). */
async function createCriterion(tenantId, c) {
  return withTenantTransaction(tenantId, async (client) => {
    await criteriaTx(client, tenantId, c.scope); // les critères par défaut d'abord : l'ordre reste lisible
    const { rows } = await client.query(
      `INSERT INTO evaluation_criteria (tenant_id, scope, code, label, help, weight, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, COALESCE((SELECT max(sort_order) + 10 FROM evaluation_criteria WHERE tenant_id = $1 AND scope = $2), 10))
       RETURNING id`, [tenantId, c.scope, c.code, c.label, c.help ?? null, c.weight ?? 1]);
    return rows[0];
  });
}

/** Mise à jour PARTIELLE d'un critère (libellé, aide, poids, actif, ordre). Les grilles déjà remplies gardent leur copie. */
async function updateCriterion(tenantId, id, patch) {
  const cols = { label: 'label', help: 'help', weight: 'weight', active: 'active', sortOrder: 'sort_order' };
  const sets = []; const values = [];
  for (const [k, col] of Object.entries(cols)) {
    if (patch[k] === undefined) continue;
    values.push(patch[k]); sets.push(`${col} = $${values.length + 2}`);
  }
  return withTenantTransaction(tenantId, async (client) => {
    if (!sets.length) {
      const { rowCount } = await client.query('SELECT 1 FROM evaluation_criteria WHERE tenant_id = $1 AND id = $2', [tenantId, id]);
      return rowCount > 0;
    }
    const { rowCount } = await client.query(
      `UPDATE evaluation_criteria SET ${sets.join(', ')}, updated_at = now() WHERE tenant_id = $1 AND id = $2`, [tenantId, id, ...values]);
    return rowCount > 0;
  });
}

// ---- Réglages (pondérations) ----------------------------------------------------------
async function settingsTx(client, tenantId) {
  const { rows } = await client.query(
    `SELECT agent_auto_weight AS "agentAutoWeight", provider_agents_weight AS "providerAgentsWeight", updated_at AS "updatedAt"
       FROM evaluation_settings WHERE tenant_id = $1`, [tenantId]);
  return rows[0] || null;
}
async function getSettings(tenantId) {
  return withTenantTransaction(tenantId, (client) => settingsTx(client, tenantId));
}
async function saveSettings(tenantId, s, userId) {
  return withTenantTransaction(tenantId, async (client) => {
    await client.query(
      `INSERT INTO evaluation_settings (tenant_id, agent_auto_weight, provider_agents_weight, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (tenant_id) DO UPDATE SET agent_auto_weight = EXCLUDED.agent_auto_weight,
         provider_agents_weight = EXCLUDED.provider_agents_weight, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [tenantId, s.agentAutoWeight, s.providerAgentsWeight, userId]);
    return settingsTx(client, tenantId);
  });
}

// ---- Évaluations d'un prestataire (retour 28.1) ----------------------------------------
const PROVIDER_EVAL_COLS = `e.id, e.partner_id AS "partnerId", to_char(e.period_from, 'YYYY-MM') AS "periodFrom",
  to_char(e.period_to, 'YYYY-MM') AS "periodTo", e.evaluated_on AS "evaluatedOn", e.status, e.comment,
  e.grid_score::float8 AS "gridScore", e.agents_score::float8 AS "agentsScore", e.agents_count AS "agentsCount",
  e.agents_weight AS "agentsWeight", e.final_score::float8 AS "finalScore", e.band, e.detail,
  e.evaluated_by AS "evaluatedBy", COALESCE(NULLIF(ue.full_name, ''), ue.email::text) AS "evaluatedByName", e.created_at AS "createdAt", e.updated_at AS "updatedAt",
  e.validated_by AS "validatedBy", COALESCE(NULLIF(uv.full_name, ''), uv.email::text) AS "validatedByName", e.validated_at AS "validatedAt"`;
const PROVIDER_EVAL_FROM = `tpm_provider_evaluations e
  LEFT JOIN users ue ON ue.id = e.evaluated_by AND ue.tenant_id = e.tenant_id
  LEFT JOIN users uv ON uv.id = e.validated_by AND uv.tenant_id = e.tenant_id`;

async function partnerExistsTx(client, tenantId, partnerId) {
  const { rows } = await client.query('SELECT id, name FROM partners WHERE tenant_id = $1 AND id = $2', [tenantId, partnerId]);
  return rows[0] || null;
}

async function listProviderEvaluations(tenantId, partnerId) {
  return withTenantTransaction(tenantId, async (client) => {
    if (!(await partnerExistsTx(client, tenantId, partnerId))) return null;
    const { rows } = await client.query(
      `SELECT ${PROVIDER_EVAL_COLS} FROM ${PROVIDER_EVAL_FROM}
        WHERE e.tenant_id = $1 AND e.partner_id = $2 ORDER BY e.period_to DESC, e.created_at DESC`, [tenantId, partnerId]);
    return rows;
  });
}

async function providerEvaluationTx(client, tenantId, partnerId, id, { lock = false } = {}) {
  const { rows } = await client.query(
    `SELECT ${PROVIDER_EVAL_COLS} FROM ${PROVIDER_EVAL_FROM}
      WHERE e.tenant_id = $1 AND e.partner_id = $2 AND e.id = $3 ${lock ? 'FOR UPDATE OF e' : ''}`, [tenantId, partnerId, id]);
  if (!rows.length) return null;
  const { rows: scores } = await client.query(
    `SELECT criterion_code AS code, criterion_label AS label, weight::float8 AS weight, sort_order AS "sortOrder", rating, comment
       FROM tpm_provider_evaluation_scores WHERE tenant_id = $1 AND evaluation_id = $2 ORDER BY sort_order, criterion_label`,
    [tenantId, id]);
  return { ...rows[0], scores };
}

async function getProviderEvaluation(tenantId, partnerId, id) {
  return withTenantTransaction(tenantId, (client) => providerEvaluationTx(client, tenantId, partnerId, id));
}

/**
 * Évaluations VALIDÉES des agents du prestataire qui chevauchent la période (mois « AAAA-MM »),
 * une ligne par (agent, évaluation) ; un agent actif sans évaluation a une ligne (evaluationId
 * null). La sélection (dernière, lot 8 avant ancienne) : providerEvaluation.agentScoresForPeriod.
 */
async function agentEvaluationsTx(client, tenantId, partnerId, { from, to }) {
  const { rows } = await client.query(
    `SELECT a.id AS "agentId", a.name, e.id AS "evaluationId", e.legacy, e.final_score::float8 AS "finalScore",
            e.note::float8 AS note, to_char(e.period_to, 'YYYY-MM') AS "periodTo", e.validated_at AS "validatedAt", e.created_at AS "createdAt"
       FROM tpm_agents a
       LEFT JOIN tpm_agent_evaluations e ON e.tenant_id = a.tenant_id AND e.agent_id = a.id AND e.status = 'validee'
            AND date_trunc('month', e.periode)::date <= $4::date AND e.period_to >= $3::date
      WHERE a.tenant_id = $1 AND a.tpm_provider_id = $2 AND (a.active OR e.id IS NOT NULL)
      ORDER BY a.name, a.id`, [tenantId, partnerId, `${from}-01`, `${to}-01`]);
  return rows;
}
async function agentEvaluations(tenantId, partnerId, period) {
  return withTenantTransaction(tenantId, (client) => agentEvaluationsTx(client, tenantId, partnerId, period));
}

/**
 * Crée une évaluation en brouillon et sa grille (une ligne par critère actif, avec le libellé et
 * le poids du moment) en une transaction. `build(criteria)` (service) rend la grille et les notes.
 */
async function createProviderEvaluation(tenantId, partnerId, input, userId, build) {
  return withTenantTransaction(tenantId, async (client) => {
    if (!(await partnerExistsTx(client, tenantId, partnerId))) return null;
    const criteria = await criteriaTx(client, tenantId, 'prestataire', { activeOnly: true });
    const { scores, gridScore } = build(criteria);
    const { rows: [{ id }] } = await client.query(
      `INSERT INTO tpm_provider_evaluations (tenant_id, partner_id, period_from, period_to, evaluated_on, comment, grid_score, evaluated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [tenantId, partnerId, `${input.periodFrom}-01`, `${input.periodTo}-01`, input.evaluatedOn, input.comment ?? null, gridScore, userId]);
    await insertScoresTx(client, tenantId, id, scores);
    return providerEvaluationTx(client, tenantId, partnerId, id);
  });
}

async function insertScoresTx(client, tenantId, evaluationId, scores) {
  if (!scores.length) return;
  await insertRows(client, {
    table: 'tpm_provider_evaluation_scores',
    columns: ['tenant_id', 'evaluation_id', 'criterion_code', 'criterion_label', 'weight', 'sort_order', 'rating', 'comment'],
    rows: scores,
    values: (s) => [tenantId, evaluationId, s.code, s.label, s.weight, s.sortOrder, s.rating, s.comment],
  });
}

/**
 * Modifie un brouillon sous verrou (FOR UPDATE) : en-tête et notes de la grille. `apply(current)`
 * (service) contrôle l'état et rend { header, scores, gridScore } ; une évaluation validée est
 * refusée par le service (409) ET par la base (déclencheur).
 */
async function updateProviderEvaluation(tenantId, partnerId, id, apply) {
  return withTenantTransaction(tenantId, async (client) => {
    const current = await providerEvaluationTx(client, tenantId, partnerId, id, { lock: true });
    if (!current) return null;
    const { header, scores, gridScore } = apply(current);
    await client.query(
      `UPDATE tpm_provider_evaluations SET period_from = $4, period_to = $5, evaluated_on = $6, comment = $7,
              grid_score = $8, updated_at = now()
        WHERE tenant_id = $1 AND partner_id = $2 AND id = $3`,
      [tenantId, partnerId, id, `${header.periodFrom}-01`, `${header.periodTo}-01`, header.evaluatedOn, header.comment ?? null, gridScore]);
    if (scores.length) {
      const params = [tenantId, id];
      const tuples = scores.map((s) => {
        params.push(s.code, s.rating, s.comment);
        const b = params.length - 3;
        return `($${b + 1}::text, $${b + 2}::smallint, $${b + 3}::text)`;
      });
      await client.query(
        `UPDATE tpm_provider_evaluation_scores sc SET rating = v.rating, comment = v.comment
           FROM (VALUES ${tuples.join(',')}) AS v(code, rating, comment)
          WHERE sc.tenant_id = $1 AND sc.evaluation_id = $2 AND sc.criterion_code = v.code`, params);
    }
    return providerEvaluationTx(client, tenantId, partnerId, id);
  });
}

/**
 * Valide sous verrou : `decide(current, ctx)` (service) contrôle l'état, la version vue, la
 * séparation des tâches et la grille complète, lit les notes des agents de la période DANS la même
 * transaction (`ctx.client`), recalcule et rend les notes figées.
 */
async function validateProviderEvaluation(tenantId, partnerId, id, decide) {
  return withTenantTransaction(tenantId, async (client) => {
    const current = await providerEvaluationTx(client, tenantId, partnerId, id, { lock: true });
    if (!current) return null;
    const settings = await settingsTx(client, tenantId);
    const frozen = await decide(current, { client, settings });
    await client.query(
      `UPDATE tpm_provider_evaluations SET status = 'validee', grid_score = $4, agents_score = $5, agents_count = $6,
              agents_weight = $7, final_score = $8, band = $9, detail = $10, validated_by = $11, validated_at = now(), updated_at = now()
        WHERE tenant_id = $1 AND partner_id = $2 AND id = $3`,
      [tenantId, partnerId, id, frozen.gridScore, frozen.agentsScore, frozen.agentsCount, frozen.agentsWeight,
        frozen.finalScore, frozen.band, JSON.stringify(frozen.detail), frozen.validatedBy]);
    return providerEvaluationTx(client, tenantId, partnerId, id);
  });
}

/**
 * Supprime un brouillon (la grille part en cascade), sous verrou ; `allow({ evaluatedBy })`
 * (service) dit si l'auteur de la demande en a le droit. Rend 'not_found' | 'validated' |
 * 'forbidden' | 'deleted'.
 */
async function deleteProviderEvaluation(tenantId, partnerId, id, allow = () => true) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT status, evaluated_by AS "evaluatedBy" FROM tpm_provider_evaluations
        WHERE tenant_id = $1 AND partner_id = $2 AND id = $3 FOR UPDATE`, [tenantId, partnerId, id]);
    if (!rows.length) return 'not_found';
    if (rows[0].status === 'validee') return 'validated';
    if (!allow(rows[0])) return 'forbidden';
    await client.query('DELETE FROM tpm_provider_evaluations WHERE tenant_id = $1 AND id = $2', [tenantId, id]);
    return 'deleted';
  });
}

module.exports = {
  criteriaTx, listCriteria, createCriterion, updateCriterion, settingsTx, getSettings, saveSettings,
  listProviderEvaluations, getProviderEvaluation, createProviderEvaluation, updateProviderEvaluation,
  validateProviderEvaluation, deleteProviderEvaluation, agentEvaluationsTx, agentEvaluations,
};
