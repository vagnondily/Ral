const { withTenantTransaction } = require('../../config/db');
const { badRequest, conflict, notFound } = require('../../middleware/errors');
const { MONITORING_LINE } = require('../contracts/budgetCatalog');
const { REALISED_STATUS, PENDING_STATUS } = require('../tpm/realised');
const { buildFacts, mergeZones, shapeTimeline } = require('./partnerSheet');
const places = require('../settings/placeMatch.repository');

/**
 * Fiche partenaire 360° et équipe — seul fichier du module qui écrit du SQL.
 * Chaque sous-requête filtre tenant_id = $1 (en plus de la RLS) ; l'assemblage
 * est pur (partnerSheet.js).
 */

const PARTNER_COLS = `p.id, p.name, p.short_name AS "shortName", p.partner_type_id AS "partnerTypeId", t.code AS "typeCode",
  t.label AS "typeLabel", p.active, p.daily_rate AS "dailyRate", p.legal_id AS "legalId", p.address,
  p.contact_name AS "contactName", p.contact_phone AS "contactPhone", p.contact_email AS "contactEmail",
  p.started_on AS "startedOn", p.notes, p.created_at AS "createdAt"`;

async function getPartnerTx(client, tenantId, id) {
  const { rows } = await client.query(
    `SELECT ${PARTNER_COLS} FROM partners p JOIN partner_types t ON t.id = p.partner_type_id AND t.tenant_id = p.tenant_id
      WHERE p.tenant_id = $1 AND p.id = $2`, [tenantId, id]);
  return rows[0] || null;
}

/** Fiche : identité, 4 faits, zones calculées, compteurs des onglets. */
async function sheet(tenantId, id) {
  return withTenantTransaction(tenantId, async (client) => {
    const partner = await getPartnerTx(client, tenantId, id);
    if (!partner) return null;
    const [{ rows: [contract] }, { rows: [counts] }, { rows: zones }, { rows: districts }] = [
      // Contrat en cours : budget de la ligne de suivi et Réalisé (factures validées), comme le Suivi budgétaire.
      await client.query(
        `SELECT c.id, c.numero, c.date_fin AS "dateFin",
                COALESCE((SELECT sum(b.unit_count * b.unit_cost) FROM contract_budget_items b
                           WHERE b.tenant_id = $1 AND b.contract_id = c.id AND b.line_code = $3), 0)::float8 AS budget,
                COALESCE((SELECT sum(r.reported_amount) FROM tpm_reports r
                           WHERE r.tenant_id = $1 AND r.contract_id = c.id AND r.kind = 'financier' AND r.status = $4), 0)::float8 AS actual,
                COALESCE((SELECT sum(r.reported_amount) FROM tpm_reports r
                           WHERE r.tenant_id = $1 AND r.contract_id = c.id AND r.kind = 'financier' AND r.status = $5), 0)::float8 AS pending
           FROM contracts c WHERE c.tenant_id = $1 AND c.partner_id = $2 AND c.status = 'actif'
          ORDER BY c.date_fin DESC LIMIT 1`, [tenantId, id, MONITORING_LINE, REALISED_STATUS, PENDING_STATUS]),
      await client.query(
        `SELECT to_char(date_trunc('month', current_date), 'YYYY-MM') AS month,
                (SELECT count(*) FROM site_visits v WHERE v.tenant_id = $1 AND v.provider_id = $2
                   AND v.period_month = date_trunc('month', current_date) AND v.status <> 'annule')::int AS "visitsAssigned",
                (SELECT count(*) FROM site_visits v WHERE v.tenant_id = $1 AND v.provider_id = $2
                   AND v.period_month = date_trunc('month', current_date) AND v.status = 'realise')::int AS "visitsRealised",
                (SELECT count(DISTINCT v.site_id) FROM site_visits v WHERE v.tenant_id = $1 AND v.provider_id = $2
                   AND v.status <> 'annule' AND v.period_month >= date_trunc('month', current_date) - interval '11 months')::int AS "sitesFollowed",
                (SELECT count(*) FROM tpm_agents a WHERE a.tenant_id = $1 AND a.tpm_provider_id = $2 AND a.active)::int AS "agentsActive",
                (SELECT count(*) FROM tpm_agents a WHERE a.tenant_id = $1 AND a.tpm_provider_id = $2)::int AS "agentsTotal",
                (SELECT count(*) FROM tpm_reports r WHERE r.tenant_id = $1 AND r.partner_id = $2 AND r.status = $3)::int AS "invoicesPending",
                (SELECT count(*) FROM contracts c WHERE c.tenant_id = $1 AND c.partner_id = $2)::int AS contracts,
                (SELECT count(*) FROM tpm_reports r WHERE r.tenant_id = $1 AND r.partner_id = $2)::int AS reports,
                (SELECT count(*) FROM tpm_collection_plans pl WHERE pl.tenant_id = $1 AND pl.partner_id = $2)::int AS plans,
                (SELECT count(*) FROM tpm_agent_formations f JOIN tpm_agents a ON a.id = f.agent_id AND a.tenant_id = f.tenant_id
                  WHERE f.tenant_id = $1 AND a.tpm_provider_id = $2)::int AS trainings`, [tenantId, id, PENDING_STATUS]),
      await client.query(
        `SELECT DISTINCT COALESCE(ar.path, ca.path) AS path FROM contract_areas ca
           JOIN contracts c ON c.id = ca.contract_id AND c.tenant_id = ca.tenant_id
           LEFT JOIN admin_areas ar ON ar.id = ca.admin_area_id AND ar.tenant_id = ca.tenant_id
          WHERE ca.tenant_id = $1 AND c.partner_id = $2 AND c.status IN ('actif', 'en_validation', 'brouillon')`, [tenantId, id]),
      await client.query(
        `SELECT DISTINCT NULLIF(s.adm1, '') AS region, COALESCE(NULLIF(s.adm2, ''), s.district) AS district
           FROM site_visits v JOIN sites s ON s.id = v.site_id AND s.tenant_id = v.tenant_id
          WHERE v.tenant_id = $1 AND v.provider_id = $2 AND v.status <> 'annule'
            AND v.period_month >= date_trunc('month', current_date) - interval '11 months'`, [tenantId, id]),
    ];
    const facts = buildFacts({ ...counts, contract: contract || null });
    return {
      partner, facts,
      zones: mergeZones(zones.map((z) => z.path), districts),
      counts: { contracts: counts.contracts, reports: counts.reports, plans: counts.plans, agents: counts.agentsTotal, trainings: counts.trainings },
    };
  });
}

/**
 * Frise du parcours, assemblée en SQL (UNION ALL triée et bornée à 24 mois),
 * paginée par date (`before`) et par 50.
 */
async function timeline(tenantId, id, { before = null, limit = 50 } = {}) {
  return withTenantTransaction(tenantId, async (client) => {
    if (!(await getPartnerTx(client, tenantId, id))) return null;
    const { rows } = await client.query(
      `SELECT * FROM (
         SELECT h.created_at AS at, 'contrat' AS kind, h.action AS code, c.numero AS label, c.id::text AS ref, NULL::text AS extra
           FROM contract_history h JOIN contracts c ON c.id = h.contract_id AND c.tenant_id = h.tenant_id
          WHERE h.tenant_id = $1 AND c.partner_id = $2
         UNION ALL
         SELECT COALESCE(r.submitted_at, r.created_at), 'facture', 'soumis', NULL, r.id::text, to_char(r.period_month, 'MM/YYYY')
           FROM tpm_reports r WHERE r.tenant_id = $1 AND r.partner_id = $2 AND r.kind = 'financier' AND r.status IN ('soumis', 'valide', 'rejete')
         UNION ALL
         SELECT r.decided_at, 'facture', r.status, NULL, r.id::text, to_char(r.period_month, 'MM/YYYY')
           FROM tpm_reports r WHERE r.tenant_id = $1 AND r.partner_id = $2 AND r.kind = 'financier' AND r.status IN ('valide', 'rejete') AND r.decided_at IS NOT NULL
         UNION ALL
         SELECT min(v.period_month)::timestamptz, 'terrain', 'debut', COALESCE(NULLIF(s.adm2, ''), s.district), NULL, count(*)::text
           FROM site_visits v JOIN sites s ON s.id = v.site_id AND s.tenant_id = v.tenant_id
          WHERE v.tenant_id = $1 AND v.provider_id = $2 AND v.status <> 'annule'
          GROUP BY COALESCE(NULLIF(s.adm2, ''), s.district)
         UNION ALL
         SELECT max(v.period_month)::timestamptz, 'terrain', 'dernier', COALESCE(NULLIF(s.adm2, ''), s.district), NULL, count(*)::text
           FROM site_visits v JOIN sites s ON s.id = v.site_id AND s.tenant_id = v.tenant_id
          WHERE v.tenant_id = $1 AND v.provider_id = $2 AND v.status <> 'annule'
          GROUP BY COALESCE(NULLIF(s.adm2, ''), s.district) HAVING max(v.period_month) > min(v.period_month)
         UNION ALL
         SELECT COALESCE(f.date_formation::timestamptz, f.created_at), 'formation', 'formation', f.thematique, a.id::text, a.name
           FROM tpm_agent_formations f JOIN tpm_agents a ON a.id = f.agent_id AND a.tenant_id = f.tenant_id
          WHERE f.tenant_id = $1 AND a.tpm_provider_id = $2
         UNION ALL
         SELECT e.created_at, 'evaluation', 'evaluation', to_char(e.periode, 'MM/YYYY'), a.id::text, a.name
           FROM tpm_agent_evaluations e JOIN tpm_agents a ON a.id = e.agent_id AND a.tenant_id = e.tenant_id
          WHERE e.tenant_id = $1 AND a.tpm_provider_id = $2
       ) t
       WHERE t.at >= now() - interval '24 months' AND ($3::timestamptz IS NULL OR t.at < $3)
       ORDER BY t.at DESC LIMIT $4`,
      [tenantId, id, before, Math.min(Math.max(Number(limit) || 50, 1), 200)]);
    return shapeTimeline(rows, { limit });
  });
}

// ---- Équipe (seul endroit où l'on crée ou désactive un agent) -----------------------
const AGENT_COLS = `a.id, a.name, a.fonction, a.code, a.phone, a.email, a.sex, a.active, a.started_on AS "startedOn",
  a.ended_on AS "endedOn", a.created_at AS "createdAt",
  (SELECT count(*) FROM tpm_agent_formations f WHERE f.tenant_id = a.tenant_id AND f.agent_id = a.id)::int AS trainings`;

/** Agents d'un prestataire ; téléphone, courriel et sexe seulement pour les rôles en écriture. */
async function listAgents(tenantId, partnerId, { personal = false } = {}) {
  return withTenantTransaction(tenantId, async (client) => {
    if (!(await getPartnerTx(client, tenantId, partnerId))) return null;
    const { rows } = await client.query(
      `SELECT ${AGENT_COLS} FROM tpm_agents a WHERE a.tenant_id = $1 AND a.tpm_provider_id = $2 ORDER BY a.active DESC, a.name`,
      [tenantId, partnerId]);
    return personal ? rows : rows.map(({ phone: _p, email: _e, sex: _s, ...r }) => r);
  });
}

const DUP_CODE = 'Ce code d\'enquêteur est déjà utilisé par un autre agent de ce prestataire.';

async function createAgent(tenantId, partnerId, a) {
  return places.withSubmissionLinks(tenantId, async (client) => {
    if (!(await getPartnerTx(client, tenantId, partnerId))) throw notFound('Partenaire introuvable');
    try {
      const { rows } = await client.query(
        `INSERT INTO tpm_agents (tenant_id, tpm_provider_id, name, fonction, code, phone, email, sex, active, started_on, ended_on)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, true), $10, $11) RETURNING id`,
        [tenantId, partnerId, a.name, a.fonction ?? null, a.code ?? null, a.phone ?? null, a.email ?? null, a.sex ?? null,
          a.active ?? null, a.startedOn ?? null, a.endedOn ?? null]);
      await places.relinkPartiesTx(client, tenantId); // ses formulaires déjà reçus s'y relient
      return { id: rows[0].id };
    } catch (err) {
      if (err.code === '23505') throw conflict(DUP_CODE);
      throw err;
    }
  });
}

// Mise à jour PARTIELLE : un champ absent est inchangé, null efface (sauf le nom).
const AGENT_FIELDS = { name: 'name', fonction: 'fonction', code: 'code', phone: 'phone', email: 'email', sex: 'sex',
  active: 'active', startedOn: 'started_on', endedOn: 'ended_on' };

async function updateAgent(tenantId, partnerId, agentId, patch) {
  const sets = []; const values = [];
  for (const [k, col] of Object.entries(AGENT_FIELDS)) {
    if (patch[k] === undefined || (k === 'name' && patch[k] === null) || (k === 'active' && patch[k] === null)) continue;
    values.push(patch[k]); sets.push(`${col} = $${values.length + 3}`);
  }
  const identity = sets.length > 0 && (patch.name != null || patch.code !== undefined);
  return (identity ? places.withSubmissionLinks : withTenantTransaction)(tenantId, async (client) => {
    if (!sets.length) {
      const { rowCount } = await client.query('SELECT 1 FROM tpm_agents WHERE tenant_id = $1 AND tpm_provider_id = $2 AND id = $3', [tenantId, partnerId, agentId]);
      return rowCount > 0;
    }
    try {
      const { rowCount } = await client.query(
        `UPDATE tpm_agents SET ${sets.join(', ')}, updated_at = now() WHERE tenant_id = $1 AND tpm_provider_id = $2 AND id = $3`,
        [tenantId, partnerId, agentId, ...values]);
      if (rowCount > 0 && identity) await places.relinkPartiesTx(client, tenantId);
      return rowCount > 0;
    } catch (err) {
      if (err.code === '23505') throw conflict(DUP_CODE);
      if (err.code === '23514') throw badRequest('Dates incohérentes : la sortie doit suivre l\'entrée.');
      throw err;
    }
  });
}

/** Un agent qui a un historique (formations, évaluations, affectations) se désactive, il ne se supprime pas. */
async function deleteAgent(tenantId, partnerId, agentId) {
  return places.withSubmissionLinks(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT a.id,
              EXISTS (SELECT 1 FROM tpm_agent_formations f WHERE f.tenant_id = $1 AND f.agent_id = a.id)
           OR EXISTS (SELECT 1 FROM tpm_agent_evaluations e WHERE e.tenant_id = $1 AND e.agent_id = a.id)
           OR EXISTS (SELECT 1 FROM tpm_assignments x WHERE x.tenant_id = $1 AND x.tpm_agent_id = a.id) AS history
         FROM tpm_agents a WHERE a.tenant_id = $1 AND a.tpm_provider_id = $2 AND a.id = $3 FOR UPDATE`,
      [tenantId, partnerId, agentId]);
    if (!rows.length) return false;
    if (rows[0].history) throw conflict('Cet agent a un historique (formations, évaluations ou missions) : désactivez-le au lieu de le supprimer.');
    await client.query('DELETE FROM tpm_agents WHERE tenant_id = $1 AND id = $2', [tenantId, agentId]);
    await places.relinkPartiesTx(client, tenantId);
    return true;
  });
}

// ---- Identité du partenaire : mise à jour PARTIELLE (écart B4) ----------------------
const PARTNER_FIELDS = { name: 'name', shortName: 'short_name', dailyRate: 'daily_rate', legalId: 'legal_id', address: 'address',
  contactName: 'contact_name', contactPhone: 'contact_phone', contactEmail: 'contact_email', startedOn: 'started_on',
  notes: 'notes', active: 'active' };

async function updatePartner(tenantId, id, patch) {
  const sets = []; const values = [];
  for (const [k, col] of Object.entries(PARTNER_FIELDS)) {
    if (patch[k] === undefined || ((k === 'name' || k === 'active') && patch[k] === null)) continue;
    values.push(patch[k]); sets.push(`${col} = $${values.length + 2}`);
  }
  const identity = sets.length > 0 && (patch.name != null || patch.shortName !== undefined);
  return (identity ? places.withSubmissionLinks : withTenantTransaction)(tenantId, async (client) => {
    if (!sets.length) return Boolean(await getPartnerTx(client, tenantId, id));
    const { rowCount } = await client.query(
      `UPDATE partners SET ${sets.join(', ')}, updated_at = now() WHERE tenant_id = $1 AND id = $2`, [tenantId, id, ...values]);
    if (rowCount > 0 && identity) await places.relinkPartiesTx(client, tenantId); // nom ou sigle : formulaires reliés à nouveau
    return rowCount > 0;
  });
}

module.exports = { sheet, timeline, listAgents, createAgent, updateAgent, deleteAgent, updatePartner, AGENT_FIELDS, PARTNER_FIELDS };
