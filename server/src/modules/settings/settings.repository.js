const { withTenantTransaction } = require('../../config/db');
const { badRequest } = require('../../middleware/errors');

/** Configuration registries: partner types, activities, partners (+ TPM
 * agents). All tenant-scoped through withTenantTransaction. */

async function listPartnerTypes(tenantId) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT id, code, label, active, sort_order AS "sortOrder",
              (SELECT count(*)::int FROM partners p WHERE p.partner_type_id = pt.id) AS "partnerCount"
       FROM partner_types pt WHERE tenant_id = $1 ORDER BY sort_order, label`,
      [tenantId]
    );
    return rows;
  });
}

async function createPartnerType(tenantId, { code, label, sortOrder }) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO partner_types (tenant_id, code, label, sort_order)
       VALUES ($1,$2,$3,COALESCE($4,0)) RETURNING id, code, label, active, sort_order AS "sortOrder"`,
      [tenantId, code, label, sortOrder]
    );
    return rows[0];
  });
}

async function listActivities(tenantId, { activeOnly = false } = {}) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT id, code, label, active, sort_order AS "sortOrder"
       FROM activities WHERE tenant_id = $1 ${activeOnly ? 'AND active = true' : ''}
       ORDER BY sort_order, label`,
      [tenantId]
    );
    return rows;
  });
}

async function createActivity(tenantId, { code, label, sortOrder }) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO activities (tenant_id, code, label, sort_order)
       VALUES ($1,$2,$3,COALESCE($4,0)) RETURNING id, code, label, active, sort_order AS "sortOrder"`,
      [tenantId, code, label, sortOrder]
    );
    return rows[0];
  });
}

async function setActivityActive(tenantId, id, active) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rowCount } = await client.query('UPDATE activities SET active = $3 WHERE tenant_id = $1 AND id = $2', [tenantId, id, active]);
    return rowCount === 1;
  });
}

async function listPartners(tenantId, { typeCode } = {}) {
  return withTenantTransaction(tenantId, async (client) => {
    const params = [tenantId];
    let typeFilter = '';
    if (typeCode) {
      params.push(typeCode);
      typeFilter = `AND pt.code = $2`;
    }
    const { rows: partners } = await client.query(
      `SELECT p.id, p.name, p.partner_type_id AS "partnerTypeId", pt.code AS "typeCode", pt.label AS "typeLabel",
              p.daily_rate AS "dailyRate", p.contract_ref AS "contractRef", p.active
       FROM partners p JOIN partner_types pt ON pt.id = p.partner_type_id
       WHERE p.tenant_id = $1 ${typeFilter} ORDER BY pt.sort_order, p.name`,
      params
    );
    const { rows: agents } = await client.query(
      `SELECT id, tpm_provider_id AS "partnerId", name FROM tpm_agents WHERE tenant_id = $1 ORDER BY name`,
      [tenantId]
    );
    return partners.map((p) => ({
      ...p,
      dailyRate: p.dailyRate == null ? null : Number(p.dailyRate),
      agents: agents.filter((a) => a.partnerId === p.id).map((a) => ({ id: a.id, name: a.name })),
    }));
  });
}

async function createPartner(tenantId, { name, partnerTypeId, dailyRate, contractRef }) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO partners (tenant_id, partner_type_id, name, daily_rate, contract_ref)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [tenantId, partnerTypeId, name, dailyRate ?? null, contractRef || null]
    );
    return rows[0].id;
  });
}

async function updatePartner(tenantId, id, { name, dailyRate, contractRef, active }) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rowCount } = await client.query(
      `UPDATE partners SET name = COALESCE($3, name), daily_rate = $4, contract_ref = $5,
              active = COALESCE($6, active)
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id, name || null, dailyRate ?? null, contractRef || null, active ?? null]
    );
    return rowCount === 1;
  });
}

async function partnerTypeById(tenantId, id) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query('SELECT id, code FROM partner_types WHERE tenant_id = $1 AND id = $2', [tenantId, id]);
    return rows[0] || null;
  });
}

async function createAgent(tenantId, partnerId, { name, fonction }) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO tpm_agents (tenant_id, tpm_provider_id, name, fonction) VALUES ($1,$2,$3,$4) RETURNING id, name, fonction`,
      [tenantId, partnerId, name, fonction || null]
    );
    return rows[0];
  });
}

async function deleteAgent(tenantId, partnerId, agentId) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rowCount } = await client.query(
      'DELETE FROM tpm_agents WHERE tenant_id = $1 AND tpm_provider_id = $2 AND id = $3',
      [tenantId, partnerId, agentId]
    );
    return rowCount === 1;
  });
}

// ---- Évaluation : formations suivies par un agent
async function agentBelongs(client, tenantId, partnerId, agentId) {
  const { rows } = await client.query(
    'SELECT 1 FROM tpm_agents WHERE tenant_id = $1 AND tpm_provider_id = $2 AND id = $3',
    [tenantId, partnerId, agentId]);
  return rows.length === 1;
}

async function createFormation(tenantId, partnerId, agentId, { thematique, date, jours }) {
  return withTenantTransaction(tenantId, async (client) => {
    if (!(await agentBelongs(client, tenantId, partnerId, agentId))) return null;
    const { rows } = await client.query(
      `INSERT INTO tpm_agent_formations (tenant_id, agent_id, thematique, date_formation, jours)
       VALUES ($1,$2,$3,$4,$5) RETURNING id, thematique, date_formation AS "date", jours`,
      [tenantId, agentId, thematique, date || null, jours ?? 1]);
    return { ...rows[0], jours: Number(rows[0].jours) };
  });
}

async function deleteFormation(tenantId, partnerId, agentId, formationId) {
  return withTenantTransaction(tenantId, async (client) => {
    if (!(await agentBelongs(client, tenantId, partnerId, agentId))) return false;
    const { rowCount } = await client.query(
      'DELETE FROM tpm_agent_formations WHERE tenant_id = $1 AND agent_id = $2 AND id = $3',
      [tenantId, agentId, formationId]);
    return rowCount === 1;
  });
}

// ---- Évaluation d'un agent (période, note /20, appréciation, commentaire)
async function createEvaluation(tenantId, partnerId, agentId, { periode, note, appreciation, commentaire }, userId) {
  return withTenantTransaction(tenantId, async (client) => {
    if (!(await agentBelongs(client, tenantId, partnerId, agentId))) return null;
    const { rows } = await client.query(
      `INSERT INTO tpm_agent_evaluations (tenant_id, agent_id, periode, note, appreciation, commentaire, evaluated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, periode, note, appreciation, commentaire`,
      [tenantId, agentId, periode, note ?? null, appreciation || null, commentaire || null, userId || null]);
    return { ...rows[0], note: rows[0].note == null ? null : Number(rows[0].note) };
  });
}

async function deleteEvaluation(tenantId, partnerId, agentId, evaluationId) {
  return withTenantTransaction(tenantId, async (client) => {
    if (!(await agentBelongs(client, tenantId, partnerId, agentId))) return false;
    const { rowCount } = await client.query(
      'DELETE FROM tpm_agent_evaluations WHERE tenant_id = $1 AND agent_id = $2 AND id = $3',
      [tenantId, agentId, evaluationId]);
    return rowCount === 1;
  });
}

// ---- Taux de change (ariary pour 1 USD), horodatés ----------------------
async function listExchangeRates(tenantId) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT id, to_char(effective_month, 'YYYY-MM') AS "effectiveMonth",
              usd_rate::float8 AS "usdRate", note,
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM exchange_rates WHERE tenant_id = $1 ORDER BY effective_month DESC`,
      [tenantId]
    );
    return rows;
  });
}

/** Un taux par mois d'application : ré-enregistrer un mois met à jour la valeur. */
async function upsertExchangeRate(tenantId, { effectiveMonth, usdRate, note }, userId) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO exchange_rates (tenant_id, effective_month, usd_rate, note, created_by)
       VALUES ($1, ($2 || '-01')::date, $3, $4, $5)
       ON CONFLICT (tenant_id, effective_month)
       DO UPDATE SET usd_rate = EXCLUDED.usd_rate, note = EXCLUDED.note, updated_at = now()
       RETURNING id, to_char(effective_month, 'YYYY-MM') AS "effectiveMonth",
                 usd_rate::float8 AS "usdRate", note, created_at AS "createdAt", updated_at AS "updatedAt"`,
      [tenantId, effectiveMonth, usdRate, note || null, userId]
    );
    return rows[0];
  });
}

async function deleteExchangeRate(tenantId, id) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rowCount } = await client.query('DELETE FROM exchange_rates WHERE tenant_id = $1 AND id = $2', [tenantId, id]);
    return rowCount === 1;
  });
}

// ---- Bureaux & antennes --------------------------------------------------
/** Communes disponibles (distinctes) du registre de sites, pour le périmètre. */
async function listCommunes(tenantId) {
  return withTenantTransaction(tenantId, async (client) => {
    // region (adm1) + district + commune, pour la sélection cascade du
    // périmètre de bureau. Le périmètre stocké reste (district, commune).
    const { rows } = await client.query(
      `SELECT DISTINCT COALESCE(adm1, '') AS region, COALESCE(district, '') AS district, commune
         FROM sites WHERE tenant_id = $1 AND commune IS NOT NULL AND commune <> ''
        ORDER BY region, district, commune`,
      [tenantId]
    );
    return rows;
  });
}

/**
 * Bureaux avec, pour chacun, le nombre de communes du périmètre et le nombre de
 * sites rattachés automatiquement (périmètre national → tous les sites ; sinon
 * sites dont la commune est dans le périmètre). Fait en SQL (pas de boucle JS).
 */
async function officesWithCounts(tenantId) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT o.id, o.code, o.name, o.nature, o.parent_id AS "parentId",
              po.name AS "parentName", o.responsible, o.national, o.active,
              (SELECT count(*)::int FROM field_office_communes c WHERE c.office_id = o.id) AS "communeCount",
              CASE WHEN o.national
                   THEN (SELECT count(*)::int FROM sites s WHERE s.tenant_id = o.tenant_id)
                   ELSE (SELECT count(*)::int FROM sites s
                          WHERE s.tenant_id = o.tenant_id
                            AND s.commune IN (SELECT commune FROM field_office_communes c WHERE c.office_id = o.id))
              END AS "siteCount"
         FROM field_offices o
         LEFT JOIN field_offices po ON po.id = o.parent_id
        WHERE o.tenant_id = $1
        ORDER BY o.national DESC, o.code`,
      [tenantId]
    );
    return rows;
  });
}

/** Référence légère des bureaux (id, code, nom) — sans les comptages. */
async function officeRefs(tenantId) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query('SELECT id, code, name FROM field_offices WHERE tenant_id = $1 ORDER BY code', [tenantId]);
    return rows;
  });
}

async function officePerimeter(tenantId, officeId) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query(
      'SELECT district, commune FROM field_office_communes WHERE tenant_id = $1 AND office_id = $2 ORDER BY district, commune',
      [tenantId, officeId]
    );
    return rows;
  });
}

async function createOffice(tenantId, { code, name, nature, parentId, responsible, national, communes }) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO field_offices (tenant_id, code, name, nature, parent_id, responsible, national)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [tenantId, code, name, nature || 'terrain', parentId || null, responsible || null, Boolean(national)]
    );
    const id = rows[0].id;
    await writePerimeter(client, tenantId, id, national ? [] : (communes || []));
    return id;
  });
}

async function updateOffice(tenantId, id, { code, name, nature, parentId, responsible, national, active, communes }) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rowCount } = await client.query(
      `UPDATE field_offices SET code = COALESCE($3, code), name = COALESCE($4, name),
              nature = COALESCE($5, nature), parent_id = $6, responsible = $7,
              national = COALESCE($8, national), active = COALESCE($9, active), updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id, code, name, nature, parentId || null, responsible || null,
        national === undefined ? null : national, active === undefined ? null : active]
    );
    if (rowCount !== 1) return false;
    if (communes !== undefined || national) await writePerimeter(client, tenantId, id, national ? [] : (communes || []));
    return true;
  });
}

async function writePerimeter(client, tenantId, officeId, communes) {
  await client.query('DELETE FROM field_office_communes WHERE tenant_id = $1 AND office_id = $2', [tenantId, officeId]);
  const clean = (communes || []).filter((c) => c && c.commune);
  if (clean.length === 0) return;
  const values = [];
  const params = [];
  clean.forEach((c, i) => {
    params.push(tenantId, officeId, c.district || null, c.commune);
    values.push(`($${i * 4 + 1}, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4})`);
  });
  await client.query(
    `INSERT INTO field_office_communes (tenant_id, office_id, district, commune) VALUES ${values.join(',')}
     ON CONFLICT (office_id, commune) DO NOTHING`,
    params
  );
}

async function deleteOffice(tenantId, id) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rowCount } = await client.query('DELETE FROM field_offices WHERE tenant_id = $1 AND id = $2', [tenantId, id]);
    return rowCount === 1;
  });
}

// ---- MMR — Minimum Monitoring Requirements (par bureau × activité) -------
const { deriveMmr } = require('../tpm/mmrMath');

async function listMmr(tenantId) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT m.id, m.field_office_id AS "fieldOfficeId", o.name AS "fieldOfficeName",
              (m.field_office_id IS NULL) AS "isGeneral",
              m.activity_category AS "activityCategory", m.operation_duration AS "operationDuration",
              m.number_of_sites AS "numberOfSites", m.risk_level AS "riskLevel", m.feasible,
              m.persons_to_deploy AS "personsToDeploy", m.visits_per_day::float8 AS "visitsPerDay",
              m.working_days AS "workingDays", m.note
         FROM mmr_parameters m LEFT JOIN field_offices o ON o.id = m.field_office_id
        WHERE m.tenant_id = $1
        ORDER BY (m.field_office_id IS NOT NULL), o.name NULLS FIRST, m.activity_category`,
      [tenantId]
    );
    // Dérive intervalle/fréquence/cible/ratio depuis la logique pure. Le plan
    // général (field_office_id NULL) est marqué isGeneral et classé en premier.
    return rows.map((r) => ({ ...r, ...deriveMmr(r) }));
  });
}

// Upsert manuel : les index uniques partiels (général vs par bureau) ne
// peuvent pas être inférés par ON CONFLICT quand field_office_id est NULL.
async function upsertMmr(tenantId, { fieldOfficeId, activityCategory, operationDuration, numberOfSites, riskLevel, feasible, personsToDeploy, visitsPerDay, workingDays, note }, userId) {
  const officeId = fieldOfficeId || null;
  return withTenantTransaction(tenantId, async (client) => {
    const existing = await client.query(
      `SELECT id FROM mmr_parameters
        WHERE tenant_id = $1 AND activity_category = $2
          AND field_office_id IS NOT DISTINCT FROM $3`,
      [tenantId, activityCategory, officeId]
    );
    const vals = [operationDuration, numberOfSites, riskLevel, feasible ?? null,
      personsToDeploy ?? null, visitsPerDay ?? null, workingDays ?? null, note || null];
    if (existing.rowCount) {
      await client.query(
        `UPDATE mmr_parameters SET
           operation_duration = $3, number_of_sites = $4, risk_level = $5, feasible = $6,
           persons_to_deploy = $7, visits_per_day = $8, working_days = $9, note = $10, updated_at = now()
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, existing.rows[0].id, ...vals]
      );
      return existing.rows[0].id;
    }
    const { rows } = await client.query(
      `INSERT INTO mmr_parameters (tenant_id, field_office_id, activity_category, operation_duration, number_of_sites, risk_level, feasible, persons_to_deploy, visits_per_day, working_days, note, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [tenantId, officeId, activityCategory, ...vals, userId]
    );
    return rows[0].id;
  });
}

async function deleteMmr(tenantId, id) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rowCount } = await client.query('DELETE FROM mmr_parameters WHERE tenant_id = $1 AND id = $2', [tenantId, id]);
    return rowCount === 1;
  });
}

/**
 * Sites du référentiel par catégorie d'activité, agrégés en SQL (bornés) :
 * { activity, officeId, parentId, n } — le front attribue un site d'antenne à
 * son bureau parent (mmrMath.registryCounts).
 */
async function mmrRegistry(tenantId) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT btrim(s.activity) AS activity, s.field_office_id AS "officeId", o.parent_id AS "parentId", count(*)::int AS n
         FROM sites s LEFT JOIN field_offices o ON o.id = s.field_office_id
        WHERE s.tenant_id = $1 AND NULLIF(btrim(s.activity), '') IS NOT NULL
        GROUP BY 1, 2, 3`,
      [tenantId]
    );
    return rows;
  });
}

const MMR_COLS = ['operation_duration', 'number_of_sites', 'risk_level', 'feasible', 'persons_to_deploy', 'visits_per_day', 'working_days', 'note'];
const mmrVals = (r) => [r.operationDuration, r.numberOfSites, r.riskLevel, r.feasible ?? null,
  r.personsToDeploy ?? null, r.visitsPerDay ?? null, r.workingDays ?? null, r.note || null];

/**
 * Enregistrement groupé de la grille MMR, TOUT OU RIEN (une transaction) :
 * suppressions, mises à jour par id (renommage de catégorie compris), puis
 * créations — chaque étape en UNE requête multi-lignes. Les index uniques
 * partiels (plan général / bureau) restent le vrai garde-fou (→ 409).
 * @param {{ upserts: Array<object>, deletes: string[] }} input
 */
async function bulkSaveMmr(tenantId, { upserts = [], deletes = [] }, userId) {
  return withTenantTransaction(tenantId, async (client) => {
    const officeIds = [...new Set(upserts.map((u) => u.fieldOfficeId).filter(Boolean))];
    if (officeIds.length) {
      const { rows } = await client.query('SELECT id FROM field_offices WHERE tenant_id = $1 AND id = ANY($2::uuid[])', [tenantId, officeIds]);
      if (rows.length !== officeIds.length) throw badRequest('Bureau inconnu (ou hors de ce compte).');
    }
    let deleted = 0; let updated = 0; let created = 0;
    if (deletes.length) {
      ({ rowCount: deleted } = await client.query('DELETE FROM mmr_parameters WHERE tenant_id = $1 AND id = ANY($2::uuid[])', [tenantId, deletes]));
    }
    const updates = upserts.filter((u) => u.id);
    if (updates.length) {
      const params = [tenantId]; const tuples = updates.map((u) => {
        const vals = [u.id, u.activityCategory, ...mmrVals(u)];
        const ph = vals.map((v) => { params.push(v); return `$${params.length}`; });
        return `(${ph[0]}::uuid, ${ph[1]}::text, ${ph[2]}::int, ${ph[3]}::int, ${ph[4]}::int, ${ph[5]}::int, ${ph[6]}::int, ${ph[7]}::numeric, ${ph[8]}::int, ${ph[9]}::text)`;
      });
      ({ rowCount: updated } = await client.query(
        `UPDATE mmr_parameters m SET activity_category = v.cat,
                ${MMR_COLS.map((c) => `${c} = v.${c}`).join(', ')}, updated_at = now()
           FROM (VALUES ${tuples.join(',')}) AS v(id, cat, ${MMR_COLS.join(', ')})
          WHERE m.tenant_id = $1 AND m.id = v.id`,
        params
      ));
      if (updated !== updates.length) throw badRequest('Paramètre MMR introuvable (modifié ou supprimé entre-temps) : rechargez la page.');
    }
    // Créations : une requête par portée (index unique partiel différent).
    for (const general of [true, false]) {
      const rows = upserts.filter((u) => !u.id && Boolean(u.fieldOfficeId) !== general);
      if (!rows.length) continue;
      const params = [tenantId, userId]; const tuples = rows.map((u) => {
        const vals = [u.fieldOfficeId || null, u.activityCategory, ...mmrVals(u)];
        const ph = vals.map((v) => { params.push(v); return `$${params.length}`; });
        return `($1, ${ph.join(', ')}, $2)`;
      });
      const conflict = general ? '(tenant_id, activity_category) WHERE field_office_id IS NULL'
        : '(tenant_id, field_office_id, activity_category) WHERE field_office_id IS NOT NULL';
      const { rowCount } = await client.query(
        `INSERT INTO mmr_parameters (tenant_id, field_office_id, activity_category, ${MMR_COLS.join(', ')}, created_by)
         VALUES ${tuples.join(',')}
         ON CONFLICT ${conflict} DO UPDATE SET ${MMR_COLS.map((c) => `${c} = EXCLUDED.${c}`).join(', ')}, updated_at = now()`,
        params
      );
      created += rowCount;
    }
    return { deleted, updated, created };
  });
}

module.exports = {
  listPartnerTypes, createPartnerType,
  listActivities, createActivity, setActivityActive,
  listPartners, createPartner, updatePartner, partnerTypeById, createAgent, deleteAgent,
  createFormation, deleteFormation, createEvaluation, deleteEvaluation,
  listExchangeRates, upsertExchangeRate, deleteExchangeRate,
  listCommunes, officesWithCounts, officePerimeter, createOffice, updateOffice, deleteOffice,
  listMmr, upsertMmr, deleteMmr, mmrRegistry, bulkSaveMmr, officeRefs,
};
