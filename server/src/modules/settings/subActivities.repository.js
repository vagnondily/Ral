/**
 * Sous-activités (retour n° 92) — CRUD du référentiel « activité › sous-activité
 * (activity_tag) › information ». Fichier NEUF pour ne pas toucher
 * settings.repository.js (modifié par un autre chantier). SQL uniquement ici.
 *
 * Règle référentiel : une sous-activité dont le `code` est utilisé par des sites
 * (`sites.tag_code`) ne se supprime pas — elle se désactive (comme les autres
 * référentiels porteurs de données).
 */
const { withTenantTransaction } = require('../../config/db');

const COLS = `id, activity_id AS "activityId", code, label, info,
              sort_order AS "sortOrder", active, created_at AS "createdAt"`;

/** Sous-activités (optionnellement d'une activité, / seulement actives). */
async function listSubActivities(tenantId, { activityId = null, activeOnly = false } = {}) {
  return withTenantTransaction(tenantId, async (client) => {
    const params = [tenantId];
    let where = 'tenant_id = $1';
    if (activityId) { params.push(activityId); where += ` AND activity_id = $${params.length}`; }
    if (activeOnly) where += ' AND active = true';
    const { rows } = await client.query(
      `SELECT ${COLS} FROM sub_activities WHERE ${where} ORDER BY sort_order, label`, params);
    return rows;
  });
}

/** Le code est-il déjà porté par des sites (sites.tag_code) ? */
async function codeUsedBySites(client, tenantId, code) {
  const { rows } = await client.query(
    'SELECT 1 FROM sites WHERE tenant_id = $1 AND tag_code = $2 LIMIT 1', [tenantId, code]);
  return rows.length > 0;
}

/** Crée une sous-activité. Renvoie { id } ; lève {code:'DUP'} si le code existe, {code:'NOACT'} si l'activité est absente. */
async function createSubActivity(tenantId, { activityId, code, label, info = null, sortOrder = 0 }) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows: act } = await client.query('SELECT 1 FROM activities WHERE tenant_id = $1 AND id = $2', [tenantId, activityId]);
    if (!act.length) { const e = new Error('activity'); e.code = 'NOACT'; throw e; }
    const { rows: dup } = await client.query('SELECT 1 FROM sub_activities WHERE tenant_id = $1 AND code = $2', [tenantId, code]);
    if (dup.length) { const e = new Error('dup'); e.code = 'DUP'; throw e; }
    const { rows } = await client.query(
      `INSERT INTO sub_activities (tenant_id, activity_id, code, label, info, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [tenantId, activityId, code, label, info || null, sortOrder]);
    return { id: rows[0].id };
  });
}

/**
 * Met à jour une sous-activité (patch partiel : label, info, sortOrder, active,
 * et code — ce dernier seulement si aucun site ne l'utilise). Renvoie
 * 'ok' | 'not_found' | 'code_locked' (code utilisé par des sites) | 'DUP'.
 */
async function updateSubActivity(tenantId, id, patch) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows: cur } = await client.query(
      'SELECT code FROM sub_activities WHERE tenant_id = $1 AND id = $2 FOR UPDATE', [tenantId, id]);
    if (!cur.length) return 'not_found';

    const sets = []; const vals = [];
    const put = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length + 2}`); };

    if ('code' in patch && patch.code !== undefined && patch.code !== cur[0].code) {
      if (await codeUsedBySites(client, tenantId, cur[0].code)) return 'code_locked';
      const { rows: dup } = await client.query(
        'SELECT 1 FROM sub_activities WHERE tenant_id = $1 AND code = $2 AND id <> $3', [tenantId, patch.code, id]);
      if (dup.length) return 'DUP';
      put('code', patch.code);
    }
    if ('label' in patch && patch.label !== undefined) put('label', patch.label);
    if ('info' in patch) put('info', patch.info === '' ? null : patch.info);
    if ('sortOrder' in patch && patch.sortOrder !== undefined) put('sort_order', patch.sortOrder);
    if ('active' in patch && patch.active !== undefined) put('active', patch.active);

    if (!sets.length) return 'ok';
    sets.push('updated_at = now()');
    const { rowCount } = await client.query(
      `UPDATE sub_activities SET ${sets.join(', ')} WHERE tenant_id = $1 AND id = $2`, [tenantId, id, ...vals]);
    return rowCount ? 'ok' : 'not_found';
  });
}

/** Supprime une sous-activité, sauf si des sites portent son code → 'linked'. */
async function deleteSubActivity(tenantId, id) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query(
      'SELECT code FROM sub_activities WHERE tenant_id = $1 AND id = $2', [tenantId, id]);
    if (!rows.length) return 'not_found';
    if (await codeUsedBySites(client, tenantId, rows[0].code)) return 'linked';
    await client.query('DELETE FROM sub_activities WHERE tenant_id = $1 AND id = $2', [tenantId, id]);
    return 'ok';
  });
}

module.exports = { listSubActivities, createSubActivity, updateSubActivity, deleteSubActivity };
