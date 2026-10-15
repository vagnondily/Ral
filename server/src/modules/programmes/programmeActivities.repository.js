/**
 * Activités de programme (suivi de processus) › sous-activités — accès aux données (migration
 * 105). SEUL fichier du module qui écrit du SQL ; chaque requête filtre tenant_id = $1 et
 * s'exécute dans la transaction de l'appelant (RLS en filet de sécurité). Les règles sont dans
 * activityRef.js (pur) et programmeActivities.service.js.
 */

const ACT_COLS = `p.id, p.code, p.label, p.short_label AS "shortLabel", p.description, p.sort_order AS "sortOrder",
                  p.active, p.bucket, p.origin, p.created_at AS "createdAt", p.updated_at AS "updatedAt"`;

// Textes d'activité de programme des cinq tables, regroupés par graphie (peu de valeurs distinctes) :
// la clé normalisée n'est calculée qu'ensuite, une fois par graphie.
const RAW_USAGE = `raw AS (
       SELECT 'sites' AS m, activity AS x, count(*)::int AS n FROM sites WHERE tenant_id = $1 AND activity IS NOT NULL GROUP BY activity
       UNION ALL SELECT 'mmr', activity_category, count(*)::int FROM mmr_parameters WHERE tenant_id = $1 GROUP BY activity_category
       UNION ALL SELECT 'forms', activity_category, count(*)::int FROM monitoring_forms WHERE tenant_id = $1 AND activity_category IS NOT NULL GROUP BY activity_category
       UNION ALL SELECT 'visits', activity, count(*)::int FROM site_visits WHERE tenant_id = $1 AND activity IS NOT NULL GROUP BY activity
       UNION ALL SELECT 'pdd', activity, count(*)::int FROM pdd_distributions WHERE tenant_id = $1 GROUP BY activity)`;

// ---- Lecture ---------------------------------------------------------------------------
/** Activités, alias et sous-activités du compte : de quoi construire un résolveur (bornés). */
async function loadResolverTx(client, tenantId) {
  const { rows: activities } = await client.query(
    `SELECT ${ACT_COLS} FROM programme_activities p WHERE p.tenant_id = $1 ORDER BY p.sort_order, p.label`, [tenantId]);
  const { rows: aliases } = await client.query(
    `SELECT alias_key AS "aliasKey", programme_activity_id AS "programmeActivityId", source, label
       FROM programme_activity_aliases WHERE tenant_id = $1`, [tenantId]);
  const { rows: subActivities } = await client.query(
    `SELECT id, programme_activity_id AS "programmeActivityId", code, label, info, active, sort_order AS "sortOrder"
       FROM sub_activities WHERE tenant_id = $1 ORDER BY sort_order, code`, [tenantId]);
  return { activities, aliases, subActivities };
}

/**
 * Activités pour les listes de saisie : actives, hors « À classer », avec leurs sous-activités
 * actives ; `includeIds` garde en plus des activités désactivées (valeur courante d'un formulaire).
 */
async function listForSelectTx(client, tenantId) {
  const { rows } = await client.query(
    `SELECT ${ACT_COLS},
            COALESCE((SELECT json_agg(json_build_object('id', s.id, 'code', s.code, 'label', s.label, 'active', s.active)
                                      ORDER BY s.sort_order, s.code)
                        FROM sub_activities s WHERE s.tenant_id = p.tenant_id AND s.programme_activity_id = p.id), '[]') AS "subActivities"
       FROM programme_activities p
      WHERE p.tenant_id = $1 AND NOT p.bucket
      ORDER BY p.sort_order, p.label`, [tenantId]);
  return rows;
}

/**
 * Comptes « Utilisé par » de chaque activité (sites, exigences MMR, fiches, visites, lignes du
 * PDD) et libellés non reconnus. Regroupement par texte d'abord (peu de valeurs distinctes),
 * clé calculée ensuite : une seule requête, bornée par le nombre de graphies.
 * @returns {{ usage: Array<{id, module, n}>, unresolved: Array<{key, label, module, n}> }}
 */
async function usageTx(client, tenantId) {
  const { rows } = await client.query(
    `WITH ${RAW_USAGE},
     keyed AS (SELECT m, x, n, left(mems_activity_key(x), 160) AS k FROM raw)
     SELECT k.m AS module, k.n, k.k AS key, btrim(regexp_replace(k.x, '\\s+', ' ', 'g')) AS label, a.programme_activity_id AS id
       FROM keyed k LEFT JOIN programme_activity_aliases a ON a.tenant_id = $1 AND a.alias_key = k.k
      WHERE k.k <> ''`, [tenantId]);
  return {
    usage: rows.filter((r) => r.id).map((r) => ({ id: r.id, module: r.module, n: r.n })),
    unresolved: rows.filter((r) => !r.id).map((r) => ({ key: r.key, label: r.label, module: r.module, n: r.n })),
  };
}

/** Nombre de sites portant chaque code de sous-activité (clé normalisée → n). */
async function tagUsageTx(client, tenantId) {
  const { rows } = await client.query(
    `SELECT mems_activity_key(t.tag_code) AS k, sum(t.n)::int AS n
       FROM (SELECT tag_code, count(*)::int AS n FROM sites WHERE tenant_id = $1 AND tag_code IS NOT NULL GROUP BY tag_code) t
      WHERE mems_activity_key(t.tag_code) <> '' GROUP BY 1`, [tenantId]);
  return new Map(rows.map((r) => [r.k, r.n]));
}

/** Activités verrouillées (FOR UPDATE, ordre stable pour ne jamais s'interbloquer). */
async function lockActivitiesTx(client, tenantId, ids) {
  const { rows } = await client.query(
    `SELECT ${ACT_COLS} FROM programme_activities p WHERE p.tenant_id = $1 AND p.id = ANY($2::uuid[]) ORDER BY p.id FOR UPDATE`,
    [tenantId, ids]);
  return new Map(rows.map((r) => [r.id, r]));
}

/** Une activité (lecture simple, sans verrou), ou null. */
async function activityByIdTx(client, tenantId, id) {
  const { rows } = await client.query(`SELECT ${ACT_COLS} FROM programme_activities p WHERE p.tenant_id = $1 AND p.id = $2`, [tenantId, id]);
  return rows[0] || null;
}

/** Activité à laquelle une clé d'alias est rattachée, ou null. */
async function aliasOwnerTx(client, tenantId, key) {
  const { rows } = await client.query(
    'SELECT programme_activity_id AS id FROM programme_activity_aliases WHERE tenant_id = $1 AND alias_key = $2', [tenantId, key]);
  return rows.length ? rows[0].id : null;
}

/** Codes déjà pris (pour proposer un code libre). */
async function activityCodesTx(client, tenantId) {
  const { rows } = await client.query('SELECT code FROM programme_activities WHERE tenant_id = $1', [tenantId]);
  return rows.map((r) => r.code);
}

/** Exigences MMR des activités données (résolues par alias) : portée de chacune. */
async function mmrScopesTx(client, tenantId, activityIds) {
  const { rows } = await client.query(
    `SELECT a.programme_activity_id AS "programmeActivityId", m.field_office_id AS "fieldOfficeId"
       FROM mmr_parameters m
       JOIN programme_activity_aliases a ON a.tenant_id = m.tenant_id AND a.alias_key = left(mems_activity_key(m.activity_category), 160)
      WHERE m.tenant_id = $1 AND a.programme_activity_id = ANY($2::uuid[])`, [tenantId, activityIds]);
  return rows;
}

/** Noms des bureaux (message d'un refus de fusion). */
async function officeNamesTx(client, tenantId, ids) {
  if (!ids.length) return new Map();
  const { rows } = await client.query('SELECT id, name FROM field_offices WHERE tenant_id = $1 AND id = ANY($2::uuid[])', [tenantId, ids]);
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** Comptes « Utilisé par » d'UNE activité (suppression) : par module + sous-activités. */
async function activityUsageTx(client, tenantId, id) {
  const { usage } = await usageTx(client, tenantId);
  const counts = {};
  for (const u of usage) if (u.id === id) counts[u.module] = (counts[u.module] || 0) + u.n;
  const { rows: [s] } = await client.query(
    'SELECT count(*)::int AS n FROM sub_activities WHERE tenant_id = $1 AND programme_activity_id = $2', [tenantId, id]);
  counts.subActivities = s.n;
  return counts;
}

// ---- Écriture ----------------------------------------------------------------------------
async function insertActivityTx(client, tenantId, a, userId) {
  const { rows } = await client.query(
    `INSERT INTO programme_activities (tenant_id, code, label, short_label, description, sort_order, origin, created_by)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6, 0), 'saisie', $7) RETURNING id`,
    [tenantId, a.code, a.label, a.shortLabel || null, a.description || null, a.sortOrder ?? null, userId || null]);
  return rows[0].id;
}

/** Alias (clé → activité) ; une clé déjà prise reste à son propriétaire (aucune erreur). */
async function addAliasTx(client, tenantId, { key, activityId, source, label }, userId) {
  const { rowCount } = await client.query(
    `INSERT INTO programme_activity_aliases (tenant_id, alias_key, programme_activity_id, source, label, created_by)
     VALUES ($1, $2, $3, $4, left($5, 160), $6) ON CONFLICT (tenant_id, alias_key) DO NOTHING`,
    [tenantId, key, activityId, source, label, userId || null]);
  return rowCount;
}

/** Mise à jour partielle (colonnes connues seulement ; absent = inchangé). */
async function updateActivityTx(client, tenantId, id, patch) {
  const MAP = { code: 'code', label: 'label', shortLabel: 'short_label', description: 'description', sortOrder: 'sort_order', active: 'active' };
  const sets = []; const vals = [];
  for (const [k, col] of Object.entries(MAP)) {
    if (patch[k] === undefined) continue;
    vals.push(patch[k] === '' ? null : patch[k]);
    sets.push(`${col} = $${vals.length + 2}`);
  }
  if (!sets.length) return 0;
  const { rowCount } = await client.query(
    `UPDATE programme_activities SET ${sets.join(', ')}, updated_at = now() WHERE tenant_id = $1 AND id = $2`, [tenantId, id, ...vals]);
  return rowCount;
}

async function deleteActivityTx(client, tenantId, id) {
  const { rowCount } = await client.query('DELETE FROM programme_activities WHERE tenant_id = $1 AND id = $2', [tenantId, id]);
  return rowCount;
}

/**
 * Fusion : alias et sous-activités de la source passent à la cible, informations manquantes de la
 * cible complétées, source supprimée. Aucun texte métier n'est réécrit.
 */
async function mergeActivitiesTx(client, tenantId, sourceId, targetId, info) {
  const { rowCount: aliases } = await client.query(
    'UPDATE programme_activity_aliases SET programme_activity_id = $3 WHERE tenant_id = $1 AND programme_activity_id = $2',
    [tenantId, sourceId, targetId]);
  const { rowCount: subActivities } = await client.query(
    'UPDATE sub_activities SET programme_activity_id = $3, updated_at = now() WHERE tenant_id = $1 AND programme_activity_id = $2',
    [tenantId, sourceId, targetId]);
  await client.query(
    `UPDATE programme_activities SET short_label = $3, description = $4, updated_at = now() WHERE tenant_id = $1 AND id = $2`,
    [tenantId, targetId, info.shortLabel, info.description]);
  await deleteActivityTx(client, tenantId, sourceId);
  return { aliases, subActivities };
}

/** Sous-activité d'un code (même clé), ou null. */
async function subActivityByCodeTx(client, tenantId, code) {
  const { rows } = await client.query(
    `SELECT id, code, label, programme_activity_id AS "programmeActivityId" FROM sub_activities
      WHERE tenant_id = $1 AND mems_activity_key(code) = mems_activity_key($2) AND mems_activity_key($2) <> '' FOR UPDATE`,
    [tenantId, code]);
  return rows[0] || null;
}

async function insertSubActivityTx(client, tenantId, { programmeActivityId, code, label, info }) {
  const { rows } = await client.query(
    `INSERT INTO sub_activities (tenant_id, programme_activity_id, code, label, info) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [tenantId, programmeActivityId, code, label, info || null]);
  return rows[0].id;
}

async function moveSubActivityTx(client, tenantId, id, programmeActivityId) {
  await client.query(
    'UPDATE sub_activities SET programme_activity_id = $3, updated_at = now() WHERE tenant_id = $1 AND id = $2', [tenantId, id, programmeActivityId]);
}

/** Alias d'une activité (clé, source, graphie). */
async function aliasRowTx(client, tenantId, activityId, key) {
  const { rows } = await client.query(
    `SELECT alias_key AS key, source, label FROM programme_activity_aliases
      WHERE tenant_id = $1 AND programme_activity_id = $2 AND alias_key = $3`, [tenantId, activityId, key]);
  return rows[0] || null;
}

async function deleteAliasTx(client, tenantId, key) {
  const { rowCount } = await client.query('DELETE FROM programme_activity_aliases WHERE tenant_id = $1 AND alias_key = $2', [tenantId, key]);
  return rowCount;
}

/** Données dont le texte a cette clé, par module (avant de retirer un alias). */
async function keyUsageTx(client, tenantId, key) {
  const { rows } = await client.query(
    `WITH ${RAW_USAGE}
     SELECT m, sum(n)::int AS n FROM raw WHERE left(mems_activity_key(x), 160) = $2 GROUP BY m`, [tenantId, key]);
  return Object.fromEntries(rows.map((r) => [r.m, r.n]));
}

/** Reprise des libellés inconnus (fonction SQL de la migration 105). */
async function repriseTx(client, tenantId) {
  const { rows: [{ r }] } = await client.query('SELECT mems_programme_activity_reprise($1) AS r', [tenantId]);
  return r;
}

module.exports = {
  loadResolverTx, listForSelectTx, usageTx, tagUsageTx, lockActivitiesTx, activityByIdTx, aliasOwnerTx, activityCodesTx, mmrScopesTx,
  officeNamesTx, activityUsageTx, insertActivityTx, addAliasTx, updateActivityTx, deleteActivityTx, mergeActivitiesTx,
  subActivityByCodeTx, insertSubActivityTx, moveSubActivityTx, aliasRowTx, deleteAliasTx, keyUsageTx, repriseTx,
};
