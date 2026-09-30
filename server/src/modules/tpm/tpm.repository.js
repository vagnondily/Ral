const { withTenantTransaction } = require('../../config/db');
const { computeExpenseAmount } = require('./expenseMath');

/**
 * All data access for the Partenaires & TPM module lives here, and only
 * here — services never write raw SQL. Every function takes tenantId as
 * its first argument and runs inside withTenantTransaction, which both
 * scopes application-level WHERE clauses AND sets the app.tenant_id
 * session variable RLS policies check (belt and suspenders).
 */

// TPM providers are now partners of type « tpm » in the unified registry
// (created from Paramètres). This module only reads them.
async function listProviders(tenantId) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows: providers } = await client.query(
      `SELECT p.id, p.name, p.contract_ref AS "contractRef", p.daily_rate AS "dailyRate"
       FROM partners p JOIN partner_types pt ON pt.id = p.partner_type_id
       WHERE p.tenant_id = $1 AND pt.code = 'tpm' AND p.active = true
       ORDER BY p.name`,
      [tenantId]
    );
    const { rows: agents } = await client.query(
      `SELECT id, tpm_provider_id AS "tpmProviderId", name, fonction
       FROM tpm_agents WHERE tenant_id = $1 ORDER BY name`,
      [tenantId]
    );
    const { rows: formations } = await client.query(
      `SELECT id, agent_id AS "agentId", thematique, date_formation AS "date", jours
       FROM tpm_agent_formations WHERE tenant_id = $1 ORDER BY date_formation DESC NULLS LAST, created_at`,
      [tenantId]
    );
    return providers.map((p) => ({
      ...p,
      dailyRate: p.dailyRate == null ? 0 : Number(p.dailyRate),
      agents: agents.filter((a) => a.tpmProviderId === p.id).map((a) => ({
        id: a.id, name: a.name, fonction: a.fonction || null,
        formations: formations.filter((f) => f.agentId === a.id).map((f) => ({ id: f.id, thematique: f.thematique, date: f.date, jours: Number(f.jours) })),
      })),
    }));
  });
}

/**
 * Agents avec leur activité de TERRAIN (missions = sites affectés, jours de
 * mission réalisés) et leurs évaluations. L'évaluation s'appuie sur ce que
 * l'agent a fait sur le terrain.
 */
async function listAgentsEvaluation(tenantId) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows: agents } = await client.query(
      `SELECT a.id, a.name, a.fonction, a.tpm_provider_id AS "providerId", p.name AS "providerName",
              COALESCE(fa.missions, 0)::int AS missions,
              COALESCE(fa.mission_days, 0)::int AS "missionDays"
         FROM tpm_agents a
         JOIN partners p ON p.id = a.tpm_provider_id
         LEFT JOIN LATERAL (
           SELECT count(DISTINCT asg.site_id) AS missions, count(md.id) AS mission_days
             FROM tpm_assignments asg
             LEFT JOIN tpm_mission_days md ON md.assignment_id = asg.id
            WHERE asg.tpm_agent_id = a.id
         ) fa ON true
        WHERE a.tenant_id = $1 ORDER BY p.name, a.name`,
      [tenantId]
    );
    const { rows: evals } = await client.query(
      `SELECT e.id, e.agent_id AS "agentId", e.periode, e.note, e.appreciation, e.commentaire,
              u.email AS "evaluatedByEmail", e.created_at AS "createdAt"
         FROM tpm_agent_evaluations e LEFT JOIN users u ON u.id = e.evaluated_by
        WHERE e.tenant_id = $1 ORDER BY e.periode DESC, e.created_at DESC`,
      [tenantId]
    );
    return agents.map((a) => ({
      ...a,
      evaluations: evals.filter((e) => e.agentId === a.id)
        .map((e) => ({ id: e.id, periode: e.periode, note: e.note == null ? null : Number(e.note), appreciation: e.appreciation, commentaire: e.commentaire, evaluatedByEmail: e.evaluatedByEmail })),
    }));
  });
}

async function listSites(tenantId) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT id, code, name, district, commune, activity, risk_level AS "riskLevel"
       FROM sites WHERE tenant_id = $1 ORDER BY name`,
      [tenantId]
    );
    return rows;
  });
}

/** Returns the existing plan for that month, creating a draft one if none exists yet. */
async function getOrCreatePlan(tenantId, periodMonth) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO tpm_plans (tenant_id, period_month, status)
       VALUES ($1, $2, 'draft')
       ON CONFLICT (tenant_id, period_month) DO UPDATE SET tenant_id = EXCLUDED.tenant_id
       RETURNING id, period_month AS "periodMonth", status, submitted_at AS "submittedAt", validated_at AS "validatedAt"`,
      [tenantId, periodMonth]
    );
    return rows[0];
  });
}

async function getPlan(tenantId, planId) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT id, period_month AS "periodMonth", status, submitted_at AS "submittedAt", validated_at AS "validatedAt"
       FROM tpm_plans WHERE tenant_id = $1 AND id = $2`,
      [tenantId, planId]
    );
    return rows[0] || null;
  });
}

async function updatePlanStatus(tenantId, planId, status, timestampColumn) {
  return withTenantTransaction(tenantId, async (client) => {
    const setTimestamp = timestampColumn ? `, ${timestampColumn} = now()` : '';
    const { rows } = await client.query(
      `UPDATE tpm_plans SET status = $3 ${setTimestamp}
       WHERE tenant_id = $1 AND id = $2
       RETURNING id, period_month AS "periodMonth", status, submitted_at AS "submittedAt", validated_at AS "validatedAt"`,
      [tenantId, planId, status]
    );
    return rows[0] || null;
  });
}

async function listAssignments(tenantId, planId) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT a.id, a.site_id AS "siteId", s.name AS "siteName", s.commune, s.activity,
              s.risk_level AS "riskLevel", a.tpm_provider_id AS "tpmProviderId",
              p.name AS "tpmProviderName", a.tpm_agent_id AS "tpmAgentId", ag.name AS "tpmAgentName"
       FROM tpm_assignments a
       JOIN sites s ON s.id = a.site_id
       LEFT JOIN partners p ON p.id = a.tpm_provider_id
       LEFT JOIN tpm_agents ag ON ag.id = a.tpm_agent_id
       WHERE a.tenant_id = $1 AND a.plan_id = $2
       ORDER BY s.name`,
      [tenantId, planId]
    );
    return rows;
  });
}

/** Ensures every site in the tenant has an assignment row (unassigned by default) for this plan. */
async function ensureAssignmentsForAllSites(tenantId, planId) {
  return withTenantTransaction(tenantId, async (client) => {
    await client.query(
      `INSERT INTO tpm_assignments (tenant_id, plan_id, site_id)
       SELECT $1, $2, s.id FROM sites s
       WHERE s.tenant_id = $1
       ON CONFLICT (plan_id, site_id) DO NOTHING`,
      [tenantId, planId]
    );
  });
}

async function upsertAssignment(tenantId, planId, { siteId, tpmProviderId, tpmAgentId }) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO tpm_assignments (tenant_id, plan_id, site_id, tpm_provider_id, tpm_agent_id)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (plan_id, site_id) DO UPDATE
         SET tpm_provider_id = EXCLUDED.tpm_provider_id,
             tpm_agent_id = EXCLUDED.tpm_agent_id,
             updated_at = now()
       RETURNING id, site_id AS "siteId", tpm_provider_id AS "tpmProviderId", tpm_agent_id AS "tpmAgentId"`,
      [tenantId, planId, siteId, tpmProviderId || null, tpmAgentId || null]
    );
    return rows[0];
  });
}

async function getAssignment(tenantId, assignmentId) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT id, plan_id AS "planId", site_id AS "siteId", tpm_provider_id AS "tpmProviderId"
       FROM tpm_assignments WHERE tenant_id = $1 AND id = $2`,
      [tenantId, assignmentId]
    );
    return rows[0] || null;
  });
}

async function toggleMissionDay(tenantId, assignmentId, date) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows: existing } = await client.query(
      `SELECT id FROM tpm_mission_days WHERE tenant_id = $1 AND assignment_id = $2 AND mission_date = $3`,
      [tenantId, assignmentId, date]
    );
    if (existing.length > 0) {
      await client.query('DELETE FROM tpm_mission_days WHERE id = $1', [existing[0].id]);
      return { date, active: false };
    }
    await client.query(
      `INSERT INTO tpm_mission_days (tenant_id, assignment_id, mission_date) VALUES ($1,$2,$3)`,
      [tenantId, assignmentId, date]
    );
    return { date, active: true };
  });
}

async function listMissionDaysForPlan(tenantId, planId) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT a.id AS "assignmentId", a.site_id AS "siteId", s.name AS "siteName",
              a.tpm_provider_id AS "tpmProviderId", p.name AS "tpmProviderName",
              md.mission_date AS "missionDate"
       FROM tpm_assignments a
       JOIN sites s ON s.id = a.site_id
       LEFT JOIN partners p ON p.id = a.tpm_provider_id
       JOIN tpm_mission_days md ON md.assignment_id = a.id
       WHERE a.tenant_id = $1 AND a.plan_id = $2
       ORDER BY s.name, md.mission_date`,
      [tenantId, planId]
    );
    return rows;
  });
}

/** Used by the worker: recomputes tpm_expenses for a plan from its mission days, atomically. */
async function recomputeExpenses(tenantId, planId) {
  return withTenantTransaction(tenantId, async (client) => {
    // Serialize recomputations of the same plan across all worker replicas.
    // Without this, two jobs could interleave and an older snapshot could
    // overwrite a newer one. The lock is released at COMMIT/ROLLBACK.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`tpm-expenses:${planId}`]);

    // Derived data: rebuild it entirely, so a provider whose days were all
    // removed (or who was unassigned) doesn't leave a stale row behind.
    await client.query('DELETE FROM tpm_expenses WHERE tenant_id = $1 AND plan_id = $2', [tenantId, planId]);

    const { rows: counts } = await client.query(
      `SELECT a.tpm_provider_id AS "tpmProviderId", pr.daily_rate AS "dailyRate", COUNT(md.id)::int AS "missionDaysCount"
       FROM tpm_assignments a
       JOIN partners pr ON pr.id = a.tpm_provider_id
       JOIN tpm_mission_days md ON md.assignment_id = a.id
       WHERE a.tenant_id = $1 AND a.plan_id = $2 AND a.tpm_provider_id IS NOT NULL
       GROUP BY a.tpm_provider_id, pr.daily_rate`,
      [tenantId, planId]
    );

    for (const row of counts) {
      const amount = computeExpenseAmount(row.dailyRate, row.missionDaysCount);
      await client.query(
        `INSERT INTO tpm_expenses (tenant_id, plan_id, tpm_provider_id, mission_days_count, amount, computed_at)
         VALUES ($1,$2,$3,$4,$5, now())
         ON CONFLICT (plan_id, tpm_provider_id) DO UPDATE
           SET mission_days_count = EXCLUDED.mission_days_count,
               amount = EXCLUDED.amount,
               computed_at = now()`,
        [tenantId, planId, row.tpmProviderId, row.missionDaysCount, amount]
      );
    }
    return counts.length;
  });
}

async function listExpenses(tenantId, planId) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT e.tpm_provider_id AS "tpmProviderId", p.name AS "tpmProviderName",
              e.mission_days_count AS "missionDaysCount", e.amount, e.computed_at AS "computedAt"
       FROM tpm_expenses e
       JOIN partners p ON p.id = e.tpm_provider_id
       WHERE e.tenant_id = $1 AND e.plan_id = $2
       ORDER BY p.name`,
      [tenantId, planId]
    );
    return rows;
  });
}

module.exports = {
  listProviders,
  listAgentsEvaluation,
  listSites,
  getOrCreatePlan,
  getPlan,
  updatePlanStatus,
  listAssignments,
  ensureAssignmentsForAllSites,
  upsertAssignment,
  getAssignment,
  toggleMissionDay,
  listMissionDaysForPlan,
  recomputeExpenses,
  listExpenses,
};
