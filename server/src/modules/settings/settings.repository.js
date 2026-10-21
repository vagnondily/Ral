const { withTenantTransaction } = require('../../config/db');
const places = require('./placeMatch.repository');
const { badRequest } = require('../../middleware/errors');
const { roleForUpdateTx, restampIfRoleChangedTx, nameChanges, roleAfter } = require('../partners/partnerRole');

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
  return places.withSubmissionLinks(tenantId, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO partners (tenant_id, partner_type_id, name, daily_rate, contract_ref)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [tenantId, partnerTypeId, name, dailyRate ?? null, contractRef || null]
    );
    await places.relinkPartiesTx(client, tenantId); // les formulaires reçus qui le nomment s'y relient
    return rows[0].id;
  });
}

/**
 * Mise à jour PARTIELLE (écart B4) : un champ absent reste inchangé ; null efface le taux ou la référence.
 * Type ou fiche active changés = rôle changé : le TPM des visites prévues est recalculé dans la même
 * transaction (partners/partnerRole.restampIfRoleChangedTx).
 */
async function updatePartner(tenantId, id, { name, partnerTypeId, dailyRate, contractRef, active }, { actorId = null } = {}) {
  return (name ? places.withSubmissionLinks : withTenantTransaction)(tenantId, async (client) => {
    // Type ou fiche active VRAIMENT changés : verrou d'attribution d'abord, puis la ligne (partnerRole).
    const before = await roleForUpdateTx(client, tenantId, id, { partnerTypeId, active });
    if (!before) return false;
    // Liste SET construite : `name` seulement s'il change vraiment (l'écran envoie toujours le nom ;
    // listé inchangé, il verrouillerait la ligne FOR UPDATE — voir partnerRole.roleForUpdateTx).
    const sets = []; const values = [tenantId, id];
    const set = (col, v, cast = '') => { values.push(v); sets.push(`${col} = $${values.length}${cast}`); };
    if (nameChanges(before, name)) set('name', name);
    if (dailyRate !== undefined) set('daily_rate', dailyRate ?? null, '::numeric');
    if (contractRef !== undefined) set('contract_ref', contractRef || null);
    if (active !== undefined && active !== null) set('active', active);
    if (partnerTypeId) set('partner_type_id', partnerTypeId, '::uuid');
    if (!sets.length) return true; // rien ne change
    const { rowCount } = await client.query(`UPDATE partners SET ${sets.join(', ')} WHERE tenant_id = $1 AND id = $2`, values);
    if (rowCount === 1 && name) await places.relinkPartiesTx(client, tenantId);
    if (rowCount === 1) {
      await restampIfRoleChangedTx(client, tenantId, before, roleAfter(before, { partnerTypeId, active }), { partnerId: id, actorId });
    }
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
  return places.withSubmissionLinks(tenantId, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO tpm_agents (tenant_id, tpm_provider_id, name, fonction) VALUES ($1,$2,$3,$4) RETURNING id, name, fonction`,
      [tenantId, partnerId, name, fonction || null]
    );
    await places.relinkPartiesTx(client, tenantId);
    return rows[0];
  });
}

// Même règle que la fiche partenaire : un agent qui porte des données (formations, évaluations,
// missions, formulaires reçus, correspondances) est refusé (409 « désactivez-le »), jamais effacé.
const deleteAgent = (tenantId, partnerId, agentId) => require('../partners/partners.repository').deleteAgent(tenantId, partnerId, agentId);

// ---- Évaluation : formations suivies par un agent
async function agentBelongs(client, tenantId, partnerId, agentId) {
  const { rows } = await client.query(
    'SELECT 1 FROM tpm_agents WHERE tenant_id = $1 AND tpm_provider_id = $2 AND id = $3',
    [tenantId, partnerId, agentId]);
  return rows.length === 1;
}

// Les formations « par agent » (tpm_agent_formations) sont devenues des SESSIONS (lot 8, retour 28.2,
// migration 087 qui les a reprises) : on les saisit dans /api/trainings ; la table d'origine est
// conservée en lecture (historique), plus aucune écriture n'y est faite.

// ---- Évaluation d'un agent (période, note /20, appréciation, commentaire)
async function createEvaluation(tenantId, partnerId, agentId, { periode, note, appreciation, commentaire }, userId) {
  return withTenantTransaction(tenantId, async (client) => {
    if (!(await agentBelongs(client, tenantId, partnerId, agentId))) return null;
    const { rows } = await client.query(
      `INSERT INTO tpm_agent_evaluations (tenant_id, agent_id, periode, period_to, status, legacy, note, appreciation, commentaire, evaluated_by)
       VALUES ($1,$2,$3,$3,'validee',true,$4,$5,$6,$7) RETURNING id, periode, note, appreciation, commentaire`,
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
    // Région + district + commune pour la cascade du périmètre de bureau : TOUT le
    // découpage du pays (Paramétrage › Localités : niveaux 1 à 3) plus les communes
    // du registre de sites absentes du découpage, sans doublon (casse et espaces
    // ignorés ; le libellé du découpage l'emporte). Une région ou un district sans
    // commune connue figure avec commune = null (visible, rien à cocher).
    // Le périmètre stocké reste (district, commune).
    const { rows } = await client.query(
      `WITH admin AS (
         SELECT r.name AS region, d.name AS district, c.name AS commune, 0 AS src
           FROM admin_areas r
           LEFT JOIN admin_areas d ON d.parent_id = r.id AND d.depth = 2
           LEFT JOIN admin_areas c ON c.parent_id = d.id AND c.depth = 3
          WHERE r.tenant_id = $1 AND r.depth = 1),
       site AS (
         SELECT COALESCE(ad.region, NULLIF(s.adm1, '')) AS region, NULLIF(s.district, '') AS district, s.commune, 1 AS src
           FROM (SELECT DISTINCT adm1, district, commune FROM sites WHERE tenant_id = $1 AND commune IS NOT NULL AND btrim(commune) <> '') s
           LEFT JOIN LATERAL (SELECT a.region FROM admin a WHERE lower(btrim(a.district)) = lower(btrim(s.district)) LIMIT 1) ad ON true),
       allrows AS (SELECT * FROM admin UNION ALL SELECT * FROM site)
       SELECT region, district, commune FROM (
         SELECT DISTINCT ON (lower(btrim(COALESCE(district, ''))), lower(btrim(COALESCE(commune, ''))), CASE WHEN commune IS NULL THEN lower(COALESCE(region, '')) END)
                COALESCE(region, '') AS region, COALESCE(district, '') AS district, commune
           FROM allrows
          ORDER BY lower(btrim(COALESCE(district, ''))), lower(btrim(COALESCE(commune, ''))), CASE WHEN commune IS NULL THEN lower(COALESCE(region, '')) END, src) x
        ORDER BY region, district, commune NULLS FIRST`,
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
              -- Sites RATTACHÉS au bureau (même définition que les autres écrans), et ceux de
              -- son périmètre restés sans bureau (à rattacher).
              CASE WHEN o.national
                   THEN (SELECT count(*)::int FROM sites s WHERE s.tenant_id = o.tenant_id)
                   ELSE (SELECT count(*)::int FROM sites s WHERE s.tenant_id = o.tenant_id AND s.field_office_id = o.id)
              END AS "siteCount",
              CASE WHEN o.national THEN 0
                   ELSE (SELECT count(*)::int FROM sites s
                          WHERE s.tenant_id = o.tenant_id AND s.field_office_id IS NULL
                            AND EXISTS (SELECT 1 FROM field_office_communes c
                                         WHERE c.office_id = o.id
                                           AND lower(btrim(COALESCE(NULLIF(s.adm3, ''), s.commune))) = lower(btrim(c.commune))))
              END AS "unattachedInPerimeter"
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
    const { rows } = await client.query('SELECT id, code, name, active FROM field_offices WHERE tenant_id = $1 ORDER BY code', [tenantId]);
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
  return places.withSubmissionLinks(tenantId, async (client) => { // rattache des sites : verrou de réapplication d'abord
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
  return places.withSubmissionLinks(tenantId, async (client) => { // rattache des sites : verrou de réapplication d'abord
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
  if (clean.length) {
    const values = [];
    const params = [];
    clean.forEach((c, i) => {
      params.push(tenantId, officeId, c.district || null, c.commune);
      values.push(`($${i * 4 + 1}, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4})`);
    });
    // Même commune (casse/espaces) dans le même district : une seule ligne ; deux homonymes
    // de districts différents sont tous deux conservés (migration 051).
    await client.query(
      `INSERT INTO field_office_communes (tenant_id, office_id, district, commune) VALUES ${values.join(',')}
       ON CONFLICT (office_id, lower(btrim(COALESCE(district, ''))), lower(btrim(commune))) DO NOTHING`,
      params
    );
  }
  await places.resolvePerimeterTx(client, tenantId, officeId);
  // Le périmètre fait autorité : (ré)attribue les sites de ce périmètre à leur bureau,
  // même ceux qui portaient déjà un bureau repris d'un fichier importé.
  await places.attachUnassignedSitesTx(client, tenantId, { override: true });
}

/**
 * Supprimer un bureau a des effets en cascade (sites détachés, dérogations MMR
 * supprimées, antennes orphelines) : refusé (409 avec les compteurs) tant que
 * `confirm` n'est pas donné ; « Désactiver » est l'alternative sans perte. Les
 * sites détachés sont aussitôt rattachés à un autre bureau actif qui couvre leur
 * commune.
 */
async function deleteOffice(tenantId, id, { confirm = false } = {}) {
  return places.withSubmissionLinks(tenantId, async (client) => { // rattache des sites : verrou de réapplication d'abord
    const { rows } = await client.query(
      `SELECT o.id,
              (SELECT count(*)::int FROM sites s WHERE s.tenant_id = o.tenant_id AND s.field_office_id = o.id) AS sites,
              (SELECT count(*)::int FROM mmr_parameters m WHERE m.tenant_id = o.tenant_id AND m.field_office_id = o.id) AS mmr,
              (SELECT count(*)::int FROM field_offices a WHERE a.tenant_id = o.tenant_id AND a.parent_id = o.id) AS antennes
         FROM field_offices o WHERE o.tenant_id = $1 AND o.id = $2 FOR UPDATE`, [tenantId, id]);
    if (!rows.length) return null;
    const impact = rows[0];
    if (!confirm && (impact.sites || impact.mmr || impact.antennes)) {
      const e = new Error('CONFIRM'); e.code = 'CONFIRM_DELETE'; e.impact = { sites: impact.sites, mmr: impact.mmr, antennes: impact.antennes }; throw e;
    }
    await client.query('DELETE FROM field_offices WHERE tenant_id = $1 AND id = $2', [tenantId, id]);
    const reattached = await places.attachUnassignedSitesTx(client, tenantId);
    return { deleted: true, ...impact, reattached };
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
  createEvaluation, deleteEvaluation,
  listExchangeRates, upsertExchangeRate, deleteExchangeRate,
  listCommunes, officesWithCounts, officePerimeter, createOffice, updateOffice, deleteOffice,
  listMmr, upsertMmr, deleteMmr, mmrRegistry, bulkSaveMmr, officeRefs,
};
