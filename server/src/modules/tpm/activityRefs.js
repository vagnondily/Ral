/**
 * Shared helpers to resolve and validate the « Activité » of a poste against
 * the tenant's configurable activities (Paramétrage › Activités). Multitenant:
 * an activity id from another tenant is rejected here, not trusted from the
 * client or the FK alone.
 */

/** Map of active activities for the tenant: id -> { code, label }. */
async function loadActivityMap(client, tenantId) {
  const { rows } = await client.query(
    'SELECT id, code, label FROM activities WHERE tenant_id = $1 ORDER BY sort_order, label',
    [tenantId]
  );
  return new Map(rows.map((a) => [a.id, { code: a.code, label: a.label }]));
}

/**
 * Ensure every non-null activity id in `items` belongs to the tenant.
 * Throws a client-facing Error otherwise. Returns the activity map for reuse.
 */
async function assertItemActivities(client, tenantId, items) {
  const ids = [...new Set(items.flatMap((it) => [it.activityId, it.activity2Id]).filter(Boolean))];
  const map = await loadActivityMap(client, tenantId);
  for (const id of ids) {
    if (!map.has(id)) throw new Error('Activité inconnue (ou hors de ce compte).');
  }
  return map;
}

/** Resolve a free-text activity cell (label or code) to an activity id, or null. */
function resolveActivity(text, activityList) {
  const s = String(text == null ? '' : text).trim();
  if (!s) return null;
  const n = s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  for (const a of activityList) {
    const label = String(a.label).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    if (n === label || n === String(a.code).toLowerCase()) return a.id;
  }
  return null;
}

module.exports = { loadActivityMap, assertItemActivities, resolveActivity };
