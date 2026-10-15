/**
 * Sous-activités (retour n° 92, migration 101 ; rattachées aux ACTIVITÉS DE PROGRAMME par la
 * migration 105) — CRUD du référentiel « activité de programme › sous-activité (Activity_tag) ›
 * information ». SQL uniquement ici.
 *
 * Règle référentiel (inchangée) : une sous-activité dont le `code` est porté par des sites
 * (`sites.tag_code`) a un code FIGÉ et ne se supprime pas — elle se désactive. Le code se compare
 * par sa clé normalisée (mems_activity_key : casse et ponctuation ignorées, « GD » = « gd »),
 * comme la résolution des Tag_code et l'index unique de la migration 105.
 */
const { withTenantTransaction } = require('../../config/db');

const COLS = `sa.id, sa.programme_activity_id AS "programmeActivityId", sa.code, sa.label, sa.info,
              sa.sort_order AS "sortOrder", sa.active, sa.created_at AS "createdAt"`;

/** Sous-activités (optionnellement d'une activité de programme, / seulement actives), avec le nombre de sites qui portent leur code. */
async function listSubActivities(tenantId, { programmeActivityId = null, activeOnly = false } = {}) {
  return withTenantTransaction(tenantId, async (client) => {
    const params = [tenantId];
    let where = 'sa.tenant_id = $1';
    if (programmeActivityId) { params.push(programmeActivityId); where += ` AND sa.programme_activity_id = $${params.length}`; }
    if (activeOnly) where += ' AND sa.active = true';
    const { rows } = await client.query(
      `WITH tags AS (
         SELECT mems_activity_key(tag_code) AS k, count(*)::int AS n FROM sites
          WHERE tenant_id = $1 AND tag_code IS NOT NULL GROUP BY 1)
       SELECT ${COLS}, COALESCE(tags.n, 0) AS "siteCount"
         FROM sub_activities sa LEFT JOIN tags ON tags.k = mems_activity_key(sa.code) AND tags.k <> ''
        WHERE ${where} ORDER BY sa.sort_order, sa.label`, params);
    return rows;
  });
}

/** Nombre de sites qui portent ce code (sites.tag_code, même clé). */
async function sitesWithCode(client, tenantId, code) {
  const { rows } = await client.query(
    `SELECT count(*)::int AS n FROM sites
      WHERE tenant_id = $1 AND mems_activity_key(tag_code) = mems_activity_key($2) AND mems_activity_key($2) <> ''`,
    [tenantId, code]);
  return rows[0].n;
}

/** Activité de programme du compte, utilisable comme parent ('ok'), « À classer » ('bucket') ou absente (null). */
async function parentState(client, tenantId, programmeActivityId) {
  const { rows } = await client.query(
    'SELECT bucket FROM programme_activities WHERE tenant_id = $1 AND id = $2', [tenantId, programmeActivityId]);
  if (!rows.length) return null;
  return rows[0].bucket ? 'bucket' : 'ok';
}

/** Une autre sous-activité porte-t-elle déjà ce code (même clé) ? */
async function codeTaken(client, tenantId, code, exceptId = null) {
  const { rows } = await client.query(
    `SELECT 1 FROM sub_activities WHERE tenant_id = $1 AND mems_activity_key(code) = mems_activity_key($2)
        AND ($3::uuid IS NULL OR id <> $3)`, [tenantId, code, exceptId]);
  return rows.length > 0;
}

/**
 * Crée une sous-activité. Renvoie { id } ; lève {code:'NOACT'} si l'activité de programme est
 * absente, {code:'BUCKET'} si c'est « À classer », {code:'DUP'} si le code existe déjà.
 */
async function createSubActivity(tenantId, { programmeActivityId, code, label, info = null, sortOrder = 0 }) {
  return withTenantTransaction(tenantId, async (client) => {
    const parent = await parentState(client, tenantId, programmeActivityId);
    if (!parent) { const e = new Error('activity'); e.code = 'NOACT'; throw e; }
    if (parent === 'bucket') { const e = new Error('bucket'); e.code = 'BUCKET'; throw e; }
    if (await codeTaken(client, tenantId, code)) { const e = new Error('dup'); e.code = 'DUP'; throw e; }
    const { rows } = await client.query(
      `INSERT INTO sub_activities (tenant_id, programme_activity_id, code, label, info, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [tenantId, programmeActivityId, code, label, info || null, sortOrder]);
    return { id: rows[0].id };
  });
}

/**
 * Met à jour une sous-activité (patch partiel : label, info, sortOrder, active, activité de
 * programme — « ranger sous… » — et code, ce dernier seulement si aucun site ne le porte).
 * Renvoie 'ok' | 'not_found' | 'code_locked' (code porté par des sites) | 'DUP' | 'NOACT' | 'BUCKET'.
 */
async function updateSubActivity(tenantId, id, patch) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows: cur } = await client.query(
      'SELECT code, programme_activity_id AS "programmeActivityId" FROM sub_activities WHERE tenant_id = $1 AND id = $2 FOR UPDATE',
      [tenantId, id]);
    if (!cur.length) return 'not_found';

    const sets = []; const vals = [];
    const put = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length + 2}`); };

    if (patch.code !== undefined && patch.code !== cur[0].code) {
      if (await sitesWithCode(client, tenantId, cur[0].code)) return 'code_locked';
      if (await codeTaken(client, tenantId, patch.code, id)) return 'DUP';
      put('code', patch.code);
    }
    if (patch.programmeActivityId !== undefined && patch.programmeActivityId !== cur[0].programmeActivityId) {
      const parent = await parentState(client, tenantId, patch.programmeActivityId);
      if (!parent) return 'NOACT';
      if (parent === 'bucket') return 'BUCKET';
      put('programme_activity_id', patch.programmeActivityId);
    }
    if (patch.label !== undefined) put('label', patch.label);
    if ('info' in patch) put('info', patch.info === '' ? null : patch.info);
    if (patch.sortOrder !== undefined) put('sort_order', patch.sortOrder);
    if (patch.active !== undefined) put('active', patch.active);

    if (!sets.length) return 'ok';
    sets.push('updated_at = now()');
    const { rowCount } = await client.query(
      `UPDATE sub_activities SET ${sets.join(', ')} WHERE tenant_id = $1 AND id = $2`, [tenantId, id, ...vals]);
    return rowCount ? 'ok' : 'not_found';
  });
}

/** Supprime une sous-activité, sauf si des sites portent son code → { outcome: 'linked', sites }. */
async function deleteSubActivity(tenantId, id) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query(
      'SELECT code FROM sub_activities WHERE tenant_id = $1 AND id = $2 FOR UPDATE', [tenantId, id]);
    if (!rows.length) return { outcome: 'not_found' };
    const sites = await sitesWithCode(client, tenantId, rows[0].code);
    if (sites) return { outcome: 'linked', sites };
    await client.query('DELETE FROM sub_activities WHERE tenant_id = $1 AND id = $2', [tenantId, id]);
    return { outcome: 'ok' };
  });
}

module.exports = { listSubActivities, createSubActivity, updateSubActivity, deleteSubActivity, sitesWithCode, codeTaken };
