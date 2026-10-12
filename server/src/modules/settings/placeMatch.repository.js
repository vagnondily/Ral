const { withTenantTransaction } = require('../../config/db');
const { chunkRows } = require('../../db/batch');
const { badRequest, conflict, notFound } = require('../../middleware/errors');
const { buildPlaceIndex, resolvePath, groupUnmatched, normPlace, parentKeyOf } = require('../common/placeMatch');

/**
 * Rapprochement des lieux — SEUL fichier de ce chantier qui écrit du SQL. La
 * résolution elle-même est pure (common/placeMatch.js). Toutes les fonctions
 * `*Tx` travaillent dans la transaction de l'appelant (tout ou rien avec
 * l'écriture qui les déclenche) ; le volume reste borné par le nombre de
 * graphies DISTINCTES, pas par le nombre de lignes.
 */

/** Découpage du tenant + alias de zones appris → index de résolution. */
async function loadPlaceIndexTx(client, tenantId) {
  const [{ rows: areas }, { rows: aliases }] = await Promise.all([
    client.query(
      `SELECT id, depth, name, pcode, parent_id AS "parentId", path FROM admin_areas WHERE tenant_id = $1`, [tenantId]),
    client.query(
      `SELECT depth, parent_key AS "parentKey", alias_key AS "aliasKey", target_pcode AS "targetPcode", target_id AS "targetId"
         FROM location_aliases WHERE tenant_id = $1 AND kind = 'zone'`, [tenantId]),
  ]);
  return buildPlaceIndex({ areas, aliases });
}

/** UPDATE … FROM (VALUES …) par lots ; `cols` = [[nom, type SQL], …] avec `id` en premier. */
async function updateFromValues(client, tenantId, { table, cols, set, rows, values, where = '' }) {
  let n = 0;
  for (const slice of chunkRows(rows, cols.length)) {
    const params = [tenantId];
    const tuples = slice.map((r) => {
      const v = values(r);
      const b = params.length;
      params.push(...v);
      return `(${v.map((_, k) => `$${b + k + 1}::${cols[k][1]}`).join(',')})`;
    });
    const { rowCount } = await client.query(
      `UPDATE ${table} t SET ${set} FROM (VALUES ${tuples.join(',')}) AS v(${cols.map((c) => c[0]).join(', ')})
        WHERE t.tenant_id = $1 AND t.id = v.id ${where}`, params);
    n += rowCount;
  }
  return n;
}

/**
 * File « À rapprocher » d'une SOURCE (sites, soumissions, pdd) : remplace ses
 * occurrences par le décompte courant (recalcul complet → jamais de compteur
 * qui dérive), conserve les décisions (ignoré / résolu) et retire les graphies
 * qui n'apparaissent plus nulle part sans avoir été décidées.
 */
async function syncQueueTx(client, tenantId, source, groups) {
  for (const slice of chunkRows(groups, 8)) {
    const params = [tenantId, source];
    const tuples = slice.map((g) => {
      params.push(g.depth, g.parentKey, g.parentLabel, g.rawKey, g.rawLabel.slice(0, 200), g.count, JSON.stringify(g.candidates), g.status);
      const b = params.length - 8;
      return `($${b + 1}::int, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}::int, $${b + 7}::jsonb, $${b + 8})`;
    });
    await client.query(
      `INSERT INTO location_match_queue (tenant_id, kind, depth, parent_key, parent_label, raw_key, raw_label, occurrences, candidates, status)
       SELECT $1, 'zone', v.depth, v.parent_key, v.parent_label, v.raw_key, v.raw_label, jsonb_build_object($2::text, v.n), v.candidates, v.status
         FROM (VALUES ${tuples.join(',')}) AS v(depth, parent_key, parent_label, raw_key, raw_label, n, candidates, status)
       ON CONFLICT (tenant_id, kind, COALESCE(depth, 0), parent_key, raw_key) DO UPDATE SET
         occurrences = location_match_queue.occurrences || EXCLUDED.occurrences,
         candidates = EXCLUDED.candidates, parent_label = EXCLUDED.parent_label, last_seen_at = now(),
         status = CASE WHEN location_match_queue.status IN ('ignore', 'resolu') THEN location_match_queue.status ELSE EXCLUDED.status END`,
      params);
  }
  // Graphies de cette source qui ne sont plus présentes : leur compteur disparaît.
  const keep = groups.map((g) => `${g.depth}|${g.parentKey}|${g.rawKey}`);
  await client.query(
    `UPDATE location_match_queue SET occurrences = occurrences - $2::text
      WHERE tenant_id = $1 AND kind = 'zone' AND occurrences ? $2::text
        AND NOT (COALESCE(depth, 0)::text || '|' || parent_key || '|' || raw_key = ANY($3::text[]))`,
    [tenantId, source, keep]);
  await client.query(
    `DELETE FROM location_match_queue
      WHERE tenant_id = $1 AND kind = 'zone' AND occurrences = '{}'::jsonb AND status IN ('a_valider', 'ambigu', 'introuvable')`,
    [tenantId]);
}

// Colonnes de lieu d'un site (adm1..adm4 priment, les anciennes colonnes servent de repli).
const SITE_PLACE = `COALESCE(NULLIF(btrim(s.adm1), ''), NULL) AS adm1,
  COALESCE(NULLIF(btrim(s.adm2), ''), NULLIF(btrim(s.district), '')) AS adm2,
  COALESCE(NULLIF(btrim(s.adm3), ''), NULLIF(btrim(s.commune), '')) AS adm3,
  COALESCE(NULLIF(btrim(s.adm4), ''), NULLIF(btrim(s.fokontany), '')) AS adm4,
  s.adm2_pcode AS p2, s.adm3_pcode AS p3`;

/**
 * Rattache TOUS les sites du tenant au découpage (Paramétrage › Localités) :
 * une résolution par combinaison distincte de lieux, puis mise à jour des
 * seuls sites dont le résultat change (unité la plus fine, pcodes, statut), et
 * file « À rapprocher » de la source « sites ». Les noms saisis ne sont jamais
 * modifiés ; un pcode déjà connu n'est jamais remplacé par une absence de code.
 * @returns {{ sites, combinations, resolved, pending }}
 */
async function applySitesGeoTx(client, tenantId) {
  const index = await loadPlaceIndexTx(client, tenantId);
  const { rows: combos } = await client.query(
    `SELECT adm1, adm2, adm3, adm4, p2, p3, count(*)::int AS n, array_agg(id) AS ids
       FROM (SELECT s.id, ${SITE_PLACE} FROM sites s WHERE s.tenant_id = $1) s
      GROUP BY adm1, adm2, adm3, adm4, p2, p3`, [tenantId]);
  const updates = []; const unmatched = []; let resolved = 0; let pending = 0;
  for (const c of combos) {
    const path = resolvePath(index, { adm1: c.adm1, adm2: c.adm2, adm3: c.adm3, adm4: c.adm4, pcodes: { adm2: c.p2, adm3: c.p3 } });
    if (path.status === 'resolu') resolved += c.n; else if (path.status !== 'vide') pending += c.n;
    for (const l of path.levels) {
      if (l.status === 'vide' || l.status === 'hors_niveau' || l.status === 'resolu') continue;
      const parentLevel = path.levels.find((x) => x.depth === l.depth - 1);
      unmatched.push({ depth: l.depth, parent: parentLevel && parentLevel.area, label: l.label, status: l.status, candidates: l.candidates, count: c.n });
    }
    const pc = path.pcodes;
    for (const id of c.ids) {
      updates.push({ id, area: path.finest ? path.finest.id : null, p1: pc.adm1 || null, p2: pc.adm2 || null, p3: pc.adm3 || null, p4: pc.adm4 || null, status: path.status === 'resolu' ? (path.levels.filter((l) => l.area).pop() || {}).status || 'exact' : path.status });
    }
  }
  await updateFromValues(client, tenantId, {
    table: 'sites',
    cols: [['id', 'uuid'], ['area', 'uuid'], ['p1', 'text'], ['p2', 'text'], ['p3', 'text'], ['p4', 'text'], ['status', 'text']],
    set: `admin_area_id = v.area, adm1_pcode = COALESCE(v.p1, t.adm1_pcode), adm2_pcode = COALESCE(v.p2, t.adm2_pcode),
          adm3_pcode = COALESCE(v.p3, t.adm3_pcode), adm4_pcode = COALESCE(v.p4, t.adm4_pcode), geo_status = v.status`,
    rows: updates, values: (u) => [u.id, u.area, u.p1, u.p2, u.p3, u.p4, u.status],
    where: `AND (t.admin_area_id IS DISTINCT FROM v.area OR t.geo_status IS DISTINCT FROM v.status
             OR (v.p3 IS NOT NULL AND t.adm3_pcode IS DISTINCT FROM v.p3) OR (v.p2 IS NOT NULL AND t.adm2_pcode IS DISTINCT FROM v.p2)
             OR (v.p1 IS NOT NULL AND t.adm1_pcode IS DISTINCT FROM v.p1) OR (v.p4 IS NOT NULL AND t.adm4_pcode IS DISTINCT FROM v.p4))`,
  });
  await syncQueueTx(client, tenantId, 'sites', groupUnmatched(unmatched));
  return { sites: updates.length, combinations: combos.length, resolved, pending };
}

// ---- Bureaux : périmètre et rattachement des sites -----------------------------------
/**
 * Unité reconnue de chaque commune d'un périmètre de bureau (district + commune
 * résolus dans le découpage) : admin_area_id et pcode de commune, pour joindre
 * les sites par identifiant plutôt que par nom. Sans niveau « commune » dans le
 * découpage, rien n'est posé (le rattachement se fait alors par nom + district).
 */
async function resolvePerimeterTx(client, tenantId, officeId = null) {
  const index = await loadPlaceIndexTx(client, tenantId);
  const params = [tenantId]; let where = 'tenant_id = $1';
  if (officeId) { params.push(officeId); where += ' AND office_id = $2'; }
  const { rows } = await client.query(`SELECT id, district, commune FROM field_office_communes WHERE ${where}`, params);
  const updates = rows.map((r) => {
    const p = resolvePath(index, { adm2: r.district, adm3: r.commune });
    const commune = p.levels[2] && p.levels[2].area;
    return { id: r.id, area: commune ? commune.id : null, pcode: commune ? commune.pcode || null : null };
  });
  await updateFromValues(client, tenantId, {
    table: 'field_office_communes', cols: [['id', 'uuid'], ['area', 'uuid'], ['pcode', 'text']],
    set: 'admin_area_id = v.area, adm3_pcode = v.pcode', rows: updates, values: (u) => [u.id, u.area, u.pcode],
    where: 'AND (t.admin_area_id IS DISTINCT FROM v.area OR t.adm3_pcode IS DISTINCT FROM v.pcode)',
  });
}

/**
 * Sites SANS bureau situés dans un périmètre : rattachés au bureau ACTIF le plus
 * spécifique (antenne avant bureau parent, terrain avant pays). Correspondance par
 * unité reconnue d'abord, sinon par commune ET district (les homonymes de
 * districts différents ne se confondent plus). Un site qui a déjà un bureau n'est
 * jamais réaffecté. Une requête ; renvoie le nombre de sites rattachés.
 */
async function attachUnassignedSitesTx(client, tenantId) {
  const { rowCount } = await client.query(
    `UPDATE sites s SET field_office_id = x.office_id
       FROM (SELECT DISTINCT ON (s2.id) s2.id AS site_id, c.office_id
               FROM sites s2
               JOIN field_office_communes c ON c.tenant_id = s2.tenant_id
               JOIN field_offices o ON o.id = c.office_id AND o.tenant_id = c.tenant_id AND o.active
              WHERE s2.tenant_id = $1 AND s2.field_office_id IS NULL
                AND ((c.admin_area_id IS NOT NULL AND s2.admin_area_id = c.admin_area_id)
                  OR (lower(btrim(COALESCE(NULLIF(s2.adm3, ''), s2.commune))) = lower(btrim(c.commune))
                      AND (c.district IS NULL OR btrim(c.district) = ''
                           OR lower(btrim(COALESCE(NULLIF(s2.adm2, ''), s2.district))) = lower(btrim(c.district)))))
              ORDER BY s2.id, (c.admin_area_id IS NOT NULL AND s2.admin_area_id = c.admin_area_id) DESC,
                       (o.parent_id IS NOT NULL) DESC, o.national ASC, o.code) x
      WHERE s.tenant_id = $1 AND s.id = x.site_id`,
    [tenantId]);
  return rowCount;
}

/**
 * À appeler en fin de TOUTE écriture de sites (import, ajout, modification,
 * suppression de bureau) : rattachement au découpage puis au bureau, dans la
 * transaction de l'appelant.
 */
async function afterSitesChangedTx(client, tenantId) {
  const geo = await applySitesGeoTx(client, tenantId);
  const attached = await attachUnassignedSitesTx(client, tenantId);
  return { ...geo, attached };
}

// ---- File « À rapprocher » et alias (API) ------------------------------------------
async function listQueue(tenantId, { status } = {}) {
  return withTenantTransaction(tenantId, async (client) => {
    const params = [tenantId]; const where = ['q.tenant_id = $1'];
    if (status) { params.push(status); where.push(`q.status = $${params.length}`); } else where.push(`q.status IN ('a_valider', 'ambigu', 'introuvable')`);
    const { rows } = await client.query(
      `SELECT q.id, q.kind, q.depth, l.label AS "levelLabel", q.parent_key AS "parentKey", q.parent_label AS "parentLabel",
              q.raw_label AS "rawLabel", q.occurrences, q.candidates, q.status, q.last_seen_at AS "lastSeenAt",
              (SELECT COALESCE(sum(value::int), 0) FROM jsonb_each_text(q.occurrences))::int AS total
         FROM location_match_queue q
         LEFT JOIN admin_levels l ON l.tenant_id = q.tenant_id AND l.depth = q.depth
        WHERE ${where.join(' AND ')}
        ORDER BY total DESC, q.depth, q.raw_label
        LIMIT 500`, params);
    // Unité parente de chaque graphie (pour proposer seulement ses enfants) : clé pcode ou nom normalisé.
    const depths = [...new Set(rows.filter((r) => r.parentKey && r.depth > 1).map((r) => r.depth - 1))];
    if (depths.length) {
      const { rows: parents } = await client.query(
        'SELECT id, depth, name, pcode FROM admin_areas WHERE tenant_id = $1 AND depth = ANY($2::int[])', [tenantId, depths]);
      const byKey = new Map(parents.map((a) => [`${a.depth}|${parentKeyOf({ pcode: a.pcode, norm: normPlace(a.name) })}`, a.id]));
      for (const r of rows) r.parentId = r.parentKey ? byKey.get(`${r.depth - 1}|${r.parentKey}`) || null : null;
    }
    return rows;
  });
}

async function listAliases(tenantId) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT a.id, a.kind, a.depth, a.parent_key AS "parentKey", a.alias_label AS "aliasLabel", a.target_pcode AS "targetPcode",
              a.target_path AS "targetPath", ar.path AS "currentPath", a.source, a.created_at AS "createdAt"
         FROM location_aliases a LEFT JOIN admin_areas ar ON ar.tenant_id = a.tenant_id AND ar.id = a.target_id
        WHERE a.tenant_id = $1 ORDER BY a.created_at DESC LIMIT 1000`, [tenantId]);
    return rows;
  });
}

/**
 * Décision sur une graphie de la file (une seule transaction, ligne verrouillée) :
 * - « lier » : crée l'alias vers l'unité choisie (même niveau, dans le parent si
 *   connu) puis rejoue le rattachement de toutes les sources ;
 * - « ignorer » : la graphie sort de la file (rien n'est rattaché).
 */
async function decideQueue(tenantId, queueId, { action, areaId }, actorId) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT id, kind, depth, parent_key AS "parentKey", raw_key AS "rawKey", raw_label AS "rawLabel", status
         FROM location_match_queue WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [tenantId, queueId]);
    if (!rows.length) throw notFound('Graphie introuvable dans la file.');
    const q = rows[0];
    if (q.status === 'resolu' || q.status === 'ignore') throw conflict('Cette graphie a déjà été traitée.');
    if (action === 'ignorer') {
      await client.query(`UPDATE location_match_queue SET status = 'ignore', decided_by = $3, decided_at = now() WHERE tenant_id = $1 AND id = $2`,
        [tenantId, queueId, actorId]);
      return { status: 'ignore' };
    }
    const { rows: areas } = await client.query(
      `SELECT a.id, a.depth, a.pcode, a.path, a.name, p.pcode AS "parentPcode", p.name AS "parentName"
         FROM admin_areas a LEFT JOIN admin_areas p ON p.id = a.parent_id
        WHERE a.tenant_id = $1 AND a.id = $2`, [tenantId, areaId]);
    if (!areas.length) throw badRequest('Unité administrative inconnue.');
    const area = areas[0];
    if (area.depth !== q.depth) throw badRequest('L\'unité choisie n\'est pas du même niveau que la graphie.');
    if (q.parentKey && q.parentKey !== parentKeyOf({ pcode: area.parentPcode, norm: normPlace(area.parentName || '') })) {
      throw badRequest('L\'unité choisie n\'est pas dans le même parent que la graphie.');
    }
    const { rows: alias } = await client.query(
      `INSERT INTO location_aliases (tenant_id, kind, depth, parent_key, alias_key, alias_label, target_pcode, target_path, target_id, source, created_by)
       VALUES ($1, 'zone', $2, $3, $4, $5, $6, $7, $8, 'valide', $9)
       ON CONFLICT (tenant_id, kind, COALESCE(depth, 0), parent_key, alias_key) DO UPDATE SET
         target_pcode = EXCLUDED.target_pcode, target_path = EXCLUDED.target_path, target_id = EXCLUDED.target_id, source = 'valide'
       RETURNING id`,
      [tenantId, q.depth, q.parentKey, q.rawKey, q.rawLabel, area.pcode, area.path, area.id, actorId]);
    await client.query(
      `UPDATE location_match_queue SET status = 'resolu', alias_id = $3, decided_by = $4, decided_at = now() WHERE tenant_id = $1 AND id = $2`,
      [tenantId, queueId, alias[0].id, actorId]);
    await resolvePerimeterTx(client, tenantId);
    const applied = { sites: await afterSitesChangedTx(client, tenantId) };
    return { status: 'resolu', aliasId: alias[0].id, applied };
  });
}

async function deleteAlias(tenantId, id) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rowCount } = await client.query('DELETE FROM location_aliases WHERE tenant_id = $1 AND id = $2', [tenantId, id]);
    if (!rowCount) return false;
    await resolvePerimeterTx(client, tenantId);
    await afterSitesChangedTx(client, tenantId);
    return true;
  });
}

/** « Rapprocher maintenant » : rejoue le rattachement de toutes les sources. */
async function applyAll(tenantId) {
  return withTenantTransaction(tenantId, async (client) => {
    await resolvePerimeterTx(client, tenantId);
    return { sites: await afterSitesChangedTx(client, tenantId) };
  });
}

module.exports = {
  loadPlaceIndexTx, applySitesGeoTx, syncQueueTx, resolvePerimeterTx, attachUnassignedSitesTx, afterSitesChangedTx,
  listQueue, listAliases, decideQueue, deleteAlias, applyAll,
};
