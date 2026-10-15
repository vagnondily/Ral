const { withTenantTransaction } = require('../../config/db');
const { badRequest, conflict, notFound } = require('../../middleware/errors');
const { chunkRows } = require('../../db/batch');
const { planBreakdown, matchBreakdown, relinkByPath, siteColumnFor } = require('./localities.domain');
const { normPlace, parentKeyOf } = require('../common/placeMatch');
const { applySitesGeoTx, withSubmissionLinks } = require('./placeMatch.repository');
const tpmAttribution = require('../tpm/tpmAttribution.repository');

/**
 * Référentiel géographique du tenant (pays) : profil pays, vocabulaire des
 * niveaux, unités administratives (P-code, GPS, lignée). Seul ce module écrit
 * le SQL des localités ; tout passe par withTenantTransaction (RLS) et filtre
 * tenant_id = $1.
 */

// ---- Niveaux & unités (lecture, sélecteurs en cascade) --------------------
async function listAdminLevels(tenantId) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT depth, label, COALESCE(label_plural, label) AS "labelPlural", code
         FROM admin_levels WHERE tenant_id = $1 ORDER BY depth`, [tenantId]);
    return rows;
  });
}

/** Unités d'un niveau, éventuellement filtrées par parent (listes en cascade). */
async function listAdminAreas(tenantId, { depth, parentId } = {}) {
  return withTenantTransaction(tenantId, async (client) => {
    const params = [tenantId]; const where = ['tenant_id = $1'];
    if (depth != null) { params.push(depth); where.push(`depth = $${params.length}`); }
    if (parentId) { params.push(parentId); where.push(`parent_id = $${params.length}`); }
    const { rows } = await client.query(
      `SELECT id, name, depth, parent_id AS "parentId", path, pcode FROM admin_areas
        WHERE ${where.join(' AND ')} ORDER BY name`, params);
    return rows;
  });
}

// ---- Profil pays + vocabulaire --------------------------------------------
async function getCountry(tenantId) {
  return withTenantTransaction(tenantId, async (client) => {
    const [{ rows: prof }, { rows: levels }, { rows: tenant }] = [
      await client.query(
        `SELECT name, iso3, currency, center_lat::float8 AS "centerLat", center_lng::float8 AS "centerLng", note,
                show_adm_codes AS "showAdmCodes",
                breakdown_source AS "breakdownSource", breakdown_imported_at AS "breakdownImportedAt", updated_at AS "updatedAt"
           FROM country_profiles WHERE tenant_id = $1`, [tenantId]),
      await client.query(
        `SELECT l.depth, l.label, COALESCE(l.label_plural, l.label) AS "labelPlural", l.code,
                count(a.id)::int AS units, count(a.pcode)::int AS "withPcode", count(a.lat)::int AS "withGps",
                count(*) FILTER (WHERE a.name ~ '^[A-Z]{2,3}[0-9]{2,}$' AND a.pcode IS NULL)::int AS "codeLikeNames"
           FROM admin_levels l LEFT JOIN admin_areas a ON a.tenant_id = l.tenant_id AND a.depth = l.depth
          WHERE l.tenant_id = $1 GROUP BY l.depth, l.label, l.label_plural, l.code ORDER BY l.depth`, [tenantId]),
      await client.query('SELECT name FROM tenants WHERE id = $1', [tenantId]),
    ];
    return { profile: prof[0] || { name: null, iso3: null, currency: null, centerLat: null, centerLng: null, note: null, showAdmCodes: false }, levels, tenantName: tenant[0]?.name || null };
  });
}

/** Profil + libellés des niveaux, tout ou rien. */
async function saveCountry(tenantId, { name, iso3, currency, centerLat, centerLng, note, showAdmCodes, levels = [] }) {
  return withTenantTransaction(tenantId, async (client) => {
    // showAdmCodes absent : valeur enregistrée inchangée.
    await client.query(
      `INSERT INTO country_profiles (tenant_id, name, iso3, currency, center_lat, center_lng, note, show_adm_codes)
       VALUES ($1,$2,$3,$4,$5,$6,$7, COALESCE($8::boolean, false))
       ON CONFLICT (tenant_id) DO UPDATE SET name = EXCLUDED.name, iso3 = EXCLUDED.iso3, currency = EXCLUDED.currency,
         center_lat = EXCLUDED.center_lat, center_lng = EXCLUDED.center_lng, note = EXCLUDED.note,
         show_adm_codes = COALESCE($8::boolean, country_profiles.show_adm_codes), updated_at = now()`,
      [tenantId, name, iso3 || null, currency || null, centerLat ?? null, centerLng ?? null, note || null,
        typeof showAdmCodes === 'boolean' ? showAdmCodes : null]);
    if (levels.length) {
      const params = [tenantId]; const tuples = levels.map((l) => {
        params.push(l.depth, l.label, l.labelPlural);
        const b = params.length - 2;
        return `($${b}::int, $${b + 1}::text, $${b + 2}::text)`;
      });
      const { rowCount } = await client.query(
        `UPDATE admin_levels l SET label = v.label, label_plural = v.plural
           FROM (VALUES ${tuples.join(',')}) AS v(depth, label, plural)
          WHERE l.tenant_id = $1 AND l.depth = v.depth`, params);
      if (rowCount !== levels.length) throw badRequest('Niveau administratif inconnu.');
    }
    return { ok: true };
  });
}

// ---- Import (met à jour le découpage du pays, SANS CASSE) -----------------
/** UPDATE … FROM (VALUES …) par lots ; `cols` = [nom, type SQL] dans l'ordre des valeurs. */
async function updateFromValues(client, tenantId, { table, cols, set, rows, values }) {
  for (const slice of chunkRows(rows, cols.length)) {
    const params = [tenantId];
    const tuples = slice.map((r) => {
      const v = values(r);
      const b = params.length;
      params.push(...v);
      return `(${v.map((_, k) => `$${b + k + 1}::${cols[k][1]}`).join(',')})`;
    });
    await client.query(
      `UPDATE ${table} t SET ${set} FROM (VALUES ${tuples.join(',')}) AS v(${cols.map((c) => c[0]).join(', ')})
        WHERE t.tenant_id = $1 AND t.id = v.id`, params);
  }
}

/**
 * Importe un découpage en METTANT À JOUR l'existant : chaque unité retrouvée
 * (P-code, sinon chemin normalisé — matchBreakdown) garde son identifiant, donc
 * les zones de contrat et les avenants qui pointent dessus restent valides ;
 * les nouvelles sont insérées, seules les disparues sont supprimées. Si des
 * zones de contrat en dépendent, l'import s'arrête (409) tant que `confirm`
 * n'est pas donné, avec les compteurs pour la confirmation. Tout ou rien.
 */
async function replaceBreakdown(tenantId, parsed, { confirm = false } = {}) {
  const plan = planBreakdown(parsed);
  return withSubmissionLinks(tenantId, async (client) => { // écrit des sites : verrou de réapplication d'abord
    // Un seul import de découpage à la fois par pays.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`admin-breakdown:${tenantId}`]);
    const { rows: existing } = await client.query('SELECT id, depth, pcode, path FROM admin_areas WHERE tenant_id = $1', [tenantId]);
    const { idByKey, removed, stats } = matchBreakdown(existing, plan);
    let impact = { zones: 0, contracts: 0 };
    if (removed.length) {
      ({ rows: [impact] } = await client.query(
        `SELECT count(*)::int AS zones, count(DISTINCT contract_id)::int AS contracts
           FROM contract_areas WHERE tenant_id = $1 AND admin_area_id = ANY($2::uuid[])`, [tenantId, removed]));
      if (impact.zones > 0 && !confirm) {
        throw conflict(
          `${stats.removed} unité(s) absente(s) du nouveau fichier seront supprimées ; ${impact.zones} zone(s) de ${impact.contracts} contrat(s) en dépendent et seront à resélectionner. Confirmez l'import.`,
          { code: 'CONFIRM_REMOVALS', ...stats, contractZones: impact.zones, contracts: impact.contracts });
      }
    }

    // Niveaux : les libellés saisis par l'utilisateur sont conservés si le code du niveau ne change pas.
    {
      const params = [tenantId]; const tuples = plan.levels.map((l, i) => {
        params.push(i + 1, l.code, l.label, l.labelPlural);
        const b = params.length - 3;
        return `($1, $${b}::int, $${b + 1}, $${b + 2}, $${b + 3})`;
      });
      await client.query(
        `INSERT INTO admin_levels (tenant_id, depth, code, label, label_plural) VALUES ${tuples.join(',')}
         ON CONFLICT (tenant_id, depth) DO UPDATE SET
           label = CASE WHEN admin_levels.code IS NOT DISTINCT FROM EXCLUDED.code THEN admin_levels.label ELSE EXCLUDED.label END,
           label_plural = CASE WHEN admin_levels.code IS NOT DISTINCT FROM EXCLUDED.code THEN admin_levels.label_plural ELSE EXCLUDED.label_plural END,
           code = EXCLUDED.code`, params);
      await client.query('DELETE FROM admin_levels WHERE tenant_id = $1 AND depth > $2', [tenantId, plan.levels.length]);
    }

    // Libérer les P-codes qui changent de titulaire (index unique par pays) avant de les réattribuer.
    const pcodeOf = new Map(existing.map((a) => [a.id, a.pcode]));
    const freed = [...removed.filter((id) => pcodeOf.get(id))];
    for (const n of plan.byDepth.flat()) {
      const id = idByKey.get(n.key);
      if (id && pcodeOf.get(id) && pcodeOf.get(id) !== n.pcode) freed.push(id);
    }
    if (freed.length) await client.query('UPDATE admin_areas SET pcode = NULL WHERE tenant_id = $1 AND id = ANY($2::uuid[])', [tenantId, freed]);

    // Niveau par niveau : mise à jour des unités retrouvées, insertion des nouvelles.
    const lineageByKey = new Map();
    for (const depthNodes of plan.byDepth) {
      const row = (n) => {
        const parentId = n.parentKey ? idByKey.get(n.parentKey) : null;
        const lineage = n.parentKey ? [...lineageByKey.get(n.parentKey), parentId] : [];
        lineageByKey.set(n.key, lineage);
        return { n, parentId, lineage: `{${lineage.join(',')}}` };
      };
      const rows = depthNodes.map(row);
      const kept = rows.filter((r) => idByKey.has(r.n.key));
      await updateFromValues(client, tenantId, {
        table: 'admin_areas',
        cols: [['id', 'uuid'], ['name', 'text'], ['parent_id', 'uuid'], ['path', 'text'], ['pcode', 'text'], ['lineage', 'uuid[]']],
        set: 'name = v.name, parent_id = v.parent_id, path = v.path, pcode = v.pcode, lineage = v.lineage, updated_at = now()',
        rows: kept, values: (r) => [idByKey.get(r.n.key), r.n.name, r.parentId, r.n.path, r.n.pcode, r.lineage],
      });
      const fresh = rows.filter((r) => !idByKey.has(r.n.key));
      for (const slice of chunkRows(fresh, 7)) {
        const params = []; const tuples = slice.map((r, j) => {
          params.push(tenantId, r.n.depth, r.n.name, r.parentId, r.n.path, r.n.pcode, r.lineage);
          const b = j * 7;
          return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7}::uuid[])`;
        });
        const { rows: ins } = await client.query(
          `INSERT INTO admin_areas (tenant_id, depth, name, parent_id, path, pcode, lineage)
           VALUES ${tuples.join(',')} RETURNING id`, params);
        ins.forEach((r, j) => idByKey.set(slice[j].n.key, r.id));
      }
    }
    // Les disparues seulement (leurs enfants retrouvés ont déjà un nouveau parent) ;
    // leurs zones de contrat passent à « détachée » (ON DELETE SET NULL, chemin conservé).
    if (removed.length) await client.query('DELETE FROM admin_areas WHERE tenant_id = $1 AND id = ANY($2::uuid[])', [tenantId, removed]);

    // Coordonnées des unités les plus fines (celles du fichier priment ; sinon on garde l'existant).
    const pts = plan.points.filter((p) => idByKey.has(p.key));
    await updateFromValues(client, tenantId, {
      table: 'admin_areas', cols: [['id', 'uuid'], ['lat', 'numeric'], ['lng', 'numeric']],
      set: 'lat = v.lat, lng = v.lng', rows: pts, values: (p) => [idByKey.get(p.key), p.lat, p.lng],
    });
    // (0, 0) = cellules GPS vides d'un import antérieur au correctif : ce ne sont pas des coordonnées.
    await client.query('UPDATE admin_areas SET lat = NULL, lng = NULL WHERE tenant_id = $1 AND lat = 0 AND lng = 0', [tenantId]);
    // Niveaux supérieurs sans coordonnées : moyenne des enfants, du bas vers le haut.
    for (let d = plan.levels.length - 1; d >= 1; d -= 1) {
      await client.query(
        `UPDATE admin_areas p SET lat = c.lat, lng = c.lng
           FROM (SELECT parent_id, avg(lat) AS lat, avg(lng) AS lng FROM admin_areas
                  WHERE tenant_id = $1 AND depth = $2 AND lat IS NOT NULL GROUP BY parent_id) c
          WHERE p.tenant_id = $1 AND p.id = c.parent_id AND p.lat IS NULL`, [tenantId, d + 1]);
    }

    // Zones de contrat : chemin courant, puis rattachement des zones détachées (même ancien import) par chemin.
    await client.query(
      `UPDATE contract_areas c SET path = a.path, depth = a.depth FROM admin_areas a
        WHERE c.tenant_id = $1 AND a.tenant_id = $1 AND a.id = c.admin_area_id
          AND (c.path IS DISTINCT FROM a.path OR c.depth IS DISTINCT FROM a.depth)`, [tenantId]);
    const { rows: detached } = await client.query(
      'SELECT id AS ref, path FROM contract_areas WHERE tenant_id = $1 AND admin_area_id IS NULL', [tenantId]);
    const relinked = relinkByPath(detached, plan.byDepth.flat().map((n) => ({ id: idByKey.get(n.key), path: n.path })));
    await updateFromValues(client, tenantId, {
      table: 'contract_areas', cols: [['id', 'uuid'], ['area', 'uuid']],
      set: 'admin_area_id = v.area, path = (SELECT path FROM admin_areas WHERE id = v.area), depth = (SELECT depth FROM admin_areas WHERE id = v.area)',
      rows: [...relinked], values: ([ref, area]) => [ref, area],
    });
    // Retour 58 : modifications du TPM par zone — verrou d'attribution AVANT d'y toucher (même ordre
    // que les écritures de l'onglet : jamais d'interblocage), chemins à jour, puis rattachement des
    // modifications détachées par chemin (une collision zone × mois garde la modification vivante).
    await tpmAttribution.lockAttributionTx(client, tenantId);
    const detachedOverrides = await tpmAttribution.refreshOverridePathsTx(client, tenantId);
    const overrideTargets = relinkByPath(detachedOverrides, plan.byDepth.flat().filter((n) => n.depth === 2 || n.depth === 3)
      .map((n) => ({ id: idByKey.get(n.key), path: n.path })));
    const seen = new Set();
    const overridePairs = detachedOverrides.filter((o) => overrideTargets.has(o.ref))
      .map((o) => [o.ref, overrideTargets.get(o.ref), o.month])
      .filter(([, area, m]) => { const k = `${area}|${m}`; if (seen.has(k)) return false; seen.add(k); return true; });
    const tpmOverridesRelinked = await tpmAttribution.relinkOverridesTx(client, tenantId, overridePairs);

    await client.query(
      `INSERT INTO country_profiles (tenant_id, name, breakdown_source, breakdown_imported_at)
       VALUES ($1, COALESCE((SELECT name FROM tenants WHERE id = $1), 'Pays'), $2, now())
       ON CONFLICT (tenant_id) DO UPDATE SET breakdown_source = EXCLUDED.breakdown_source, breakdown_imported_at = now(), updated_at = now()`,
      [tenantId, parsed.source || null]);
    // Les sites suivent le découpage mis à jour (unité reconnue, codes officiels, file « À rapprocher »).
    const sitesGeo = await applySitesGeoTx(client, tenantId);
    return {
      levels: plan.levels.length, areas: idByKey.size, withPcode: plan.withPcode, withGps: pts.length,
      kept: stats.kept, added: stats.added, removed: stats.removed, sitesGeo,
      contractZonesDetached: impact.zones, contractZonesRelinked: relinked.size, contractZonesStillDetached: detached.length - relinked.size,
      tpmOverridesRelinked, tpmOverridesStillDetached: detachedOverrides.length - tpmOverridesRelinked,
      warnings: [...(parsed.warnings || []), ...plan.warnings],
    };
  });
}

// ---- Répertoire (paginé côté serveur) --------------------------------------
const SORTS = { path: 'a.path', name: 'lower(a.name)', pcode: 'a.pcode NULLS LAST' };

function directoryWhere(tenantId, { depth, ancestorId, q }) {
  const params = [tenantId, depth]; const where = ['a.tenant_id = $1', 'a.depth = $2'];
  if (ancestorId) { params.push(ancestorId); where.push(`a.lineage @> ARRAY[$${params.length}]::uuid[]`); }
  if (q) { params.push(`%${q.toLowerCase()}%`); where.push(`(lower(a.name) LIKE $${params.length} OR lower(a.pcode) LIKE $${params.length})`); }
  return { params, where: where.join(' AND ') };
}

/**
 * Une page du répertoire d'un niveau, avec ancêtres, P-code, GPS, nombre
 * d'enfants et nombre de sites rattachés (calculés pour la page seulement).
 */
async function directory(tenantId, { depth, ancestorId, q, page = 1, pageSize = 50, sort = 'path' }) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows: lv } = await client.query('SELECT depth, code FROM admin_levels WHERE tenant_id = $1 ORDER BY depth', [tenantId]);
    const level = lv.find((l) => l.depth === depth);
    if (!level) return { rows: [], total: 0, page, pageSize };
    const parentLevel = lv.find((l) => l.depth === depth - 1);
    const siteCol = siteColumnFor(level.code); const parentCol = parentLevel ? siteColumnFor(parentLevel.code) : null;
    const { params, where } = directoryWhere(tenantId, { depth, ancestorId, q });
    params.push(pageSize, (page - 1) * pageSize);
    const lim = params.length - 1;
    const siteMatch = siteCol
      ? `(SELECT count(*)::int FROM sites s WHERE s.tenant_id = a.tenant_id AND (
            ${level.code === 'adm3' ? '(a.pcode IS NOT NULL AND s.adm3_pcode = a.pcode) OR' : ''}
            (lower(btrim(${siteCol})) = lower(a.name)${parentCol ? ` AND (p.name IS NULL OR lower(btrim(${parentCol})) = lower(p.name))` : ''})))`
      : 'NULL::int';
    const { rows } = await client.query(
      `SELECT a.id, a.name, a.pcode, a.lat::float8 AS lat, a.lng::float8 AS lng, a.depth, a.parent_id AS "parentId", a.path,
              a.updated_at AS "updatedAt", count(*) OVER()::int AS total,
              (SELECT count(*)::int FROM admin_areas c WHERE c.parent_id = a.id) AS "childCount",
              ${siteMatch} AS "siteCount"
         FROM admin_areas a LEFT JOIN admin_areas p ON p.id = a.parent_id
        WHERE ${where}
        ORDER BY ${SORTS[sort] || SORTS.path}, a.id
        LIMIT $${lim} OFFSET $${lim + 1}`, params);
    const total = rows[0]?.total ?? (page > 1 ? (await client.query(`SELECT count(*)::int AS n FROM admin_areas a WHERE ${where}`, params.slice(0, -2))).rows[0].n : 0);
    return { rows: rows.map(({ total: _t, ...r }) => ({ ...r, ancestors: r.path.split(' > ').slice(0, -1) })), total, page, pageSize };
  });
}

/** Toutes les lignes filtrées (export) — bornées par le découpage du pays. */
async function directoryAll(tenantId, filters) {
  return withTenantTransaction(tenantId, async (client) => {
    const { params, where } = directoryWhere(tenantId, filters);
    const { rows } = await client.query(
      `SELECT a.name, a.pcode, a.lat::float8 AS lat, a.lng::float8 AS lng, a.path FROM admin_areas a WHERE ${where} ORDER BY a.path`, params);
    return rows.map((r) => ({ ...r, ancestors: r.path.split(' > ').slice(0, -1) }));
  });
}

// ---- CRUD ---------------------------------------------------------------------
async function assertUniqueName(client, tenantId, parentId, name, exceptId) {
  const { rows } = await client.query(
    `SELECT 1 FROM admin_areas WHERE tenant_id = $1 AND parent_id IS NOT DISTINCT FROM $2 AND lower(name) = lower($3) AND id IS DISTINCT FROM $4 LIMIT 1`,
    [tenantId, parentId, name, exceptId || null]);
  if (rows.length) throw conflict(`« ${name} » existe déjà à cet endroit du découpage.`);
}

async function assertUniquePcode(client, tenantId, pcode, exceptId) {
  if (!pcode) return;
  const { rows } = await client.query(
    'SELECT name FROM admin_areas WHERE tenant_id = $1 AND pcode = $2 AND id IS DISTINCT FROM $3 LIMIT 1', [tenantId, pcode, exceptId || null]);
  if (rows.length) throw conflict(`Le P-code ${pcode} est déjà attribué à « ${rows[0].name} ».`);
}

async function lockParent(client, tenantId, parentId, depth) {
  if (depth === 1) { if (parentId) throw badRequest('Une unité du premier niveau n\'a pas de parent.'); return null; }
  if (!parentId) throw badRequest('Choisissez l\'unité parente.');
  const { rows } = await client.query(
    'SELECT id, depth, path, lineage FROM admin_areas WHERE tenant_id = $1 AND id = $2 FOR UPDATE', [tenantId, parentId]);
  if (!rows.length) throw badRequest('Unité parente introuvable.');
  if (rows[0].depth !== depth - 1) throw badRequest('L\'unité parente doit être du niveau immédiatement supérieur.');
  return rows[0];
}

async function createArea(tenantId, { depth, parentId, name, pcode, lat, lng }) {
  return withSubmissionLinks(tenantId, async (client) => { // écrit des sites : verrou de réapplication d'abord
    const { rows: lv } = await client.query('SELECT 1 FROM admin_levels WHERE tenant_id = $1 AND depth = $2', [tenantId, depth]);
    if (!lv.length) throw badRequest('Niveau administratif inconnu.');
    const parent = await lockParent(client, tenantId, parentId || null, depth);
    await assertUniqueName(client, tenantId, parent?.id || null, name);
    await assertUniquePcode(client, tenantId, pcode);
    const { rows } = await client.query(
      `INSERT INTO admin_areas (tenant_id, depth, name, parent_id, path, pcode, lat, lng, lineage)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::uuid[]) RETURNING id`,
      [tenantId, depth, name, parent?.id || null, parent ? `${parent.path} > ${name}` : name, pcode || null, lat ?? null, lng ?? null,
        parent ? [...parent.lineage, parent.id] : []]);
    await applySitesGeoTx(client, tenantId); // une localité créée peut rattacher des sites « introuvables »
    return { id: rows[0].id };
  });
}

/**
 * Modifie une unité. Renommer ou changer de parent recalcule le chemin et la
 * lignée de TOUTE la descendance en une requête (sous-arbre via la lignée).
 */
async function updateArea(tenantId, id, patch) {
  return withSubmissionLinks(tenantId, async (client) => { // écrit des sites : verrou de réapplication d'abord
    const { rows } = await client.query(
      'SELECT id, depth, name, parent_id, path, lineage FROM admin_areas WHERE tenant_id = $1 AND id = $2 FOR UPDATE', [tenantId, id]);
    if (!rows.length) throw notFound('Localité introuvable');
    const cur = rows[0];
    const name = patch.name ?? cur.name;
    const parentId = patch.parentId === undefined ? cur.parent_id : patch.parentId;
    const moved = parentId !== cur.parent_id; const renamed = name !== cur.name;
    let parent = null;
    if (moved) parent = await lockParent(client, tenantId, parentId, cur.depth);
    else if (cur.parent_id) parent = (await client.query('SELECT id, path, lineage FROM admin_areas WHERE id = $1', [cur.parent_id])).rows[0];
    if (moved || renamed) await assertUniqueName(client, tenantId, parentId, name, id);
    if (patch.pcode) await assertUniquePcode(client, tenantId, patch.pcode, id);
    const newPath = parent ? `${parent.path} > ${name}` : name;
    const newLineage = parent ? [...parent.lineage, parent.id] : [];
    await client.query(
      `UPDATE admin_areas SET name = $3, parent_id = $4, path = $5, lineage = $6::uuid[],
              pcode = CASE WHEN $7::boolean THEN $8 ELSE pcode END,
              lat = CASE WHEN $9::boolean THEN $10::numeric ELSE lat END,
              lng = CASE WHEN $9::boolean THEN $11::numeric ELSE lng END, updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id, name, parentId, newPath, newLineage, patch.pcode !== undefined, patch.pcode || null,
        patch.lat !== undefined || patch.lng !== undefined, patch.lat ?? null, patch.lng ?? null]);
    // Renommer : l'ancien nom devient un alias (« renommage ») — les données qui portent
    // l'ancienne graphie restent rattachées sans être réécrites.
    if (renamed) {
      // Clé du parent d'ORIGINE (là où l'ancienne graphie apparaît dans les données).
      const oldParent = cur.parent_id
        ? (await client.query('SELECT pcode, name FROM admin_areas WHERE tenant_id = $1 AND id = $2', [tenantId, cur.parent_id])).rows[0]
        : null;
      const parentKey = oldParent ? parentKeyOf({ pcode: oldParent.pcode, norm: normPlace(oldParent.name) }) : '';
      const oldKey = normPlace(cur.name).key;
      if (oldKey && oldKey !== normPlace(name).key) {
        await client.query(
          `INSERT INTO location_aliases (tenant_id, kind, depth, parent_key, alias_key, alias_label, target_id, target_path, source)
           VALUES ($1, 'zone', $2, $3, $4, $5, $6, $7, 'renommage')
           ON CONFLICT (tenant_id, kind, COALESCE(depth, 0), parent_key, alias_key) DO NOTHING`,
          [tenantId, cur.depth, parentKey, oldKey, cur.name.slice(0, 200), id, newPath]);
      }
    }
    let descendants = 0;
    if (moved || renamed) {
      ({ rowCount: descendants } = await client.query(
        `UPDATE admin_areas d SET path = $3 || substr(d.path, length($4) + 1),
                lineage = $5::uuid[] || d.lineage[cardinality($6::uuid[]) + 1 : cardinality(d.lineage)], updated_at = now()
          WHERE d.tenant_id = $1 AND d.lineage @> ARRAY[$2]::uuid[]`,
        [tenantId, id, newPath, cur.path, newLineage, cur.lineage]));
    }
    if (moved || renamed || patch.pcode !== undefined) await applySitesGeoTx(client, tenantId);
    return { id, descendants };
  });
}

/** Supprime une unité ; refuse si elle a des sous-unités sauf `cascade`. */
async function deleteArea(tenantId, id, { cascade = false } = {}) {
  return withSubmissionLinks(tenantId, async (client) => { // écrit des sites : verrou de réapplication d'abord
    const { rows } = await client.query(
      `SELECT a.id, (SELECT count(*)::int FROM admin_areas d WHERE d.tenant_id = a.tenant_id AND d.lineage @> ARRAY[a.id]) AS descendants,
              (SELECT count(*)::int FROM contract_areas c WHERE c.tenant_id = a.tenant_id AND c.admin_area_id = a.id) AS contracts
         FROM admin_areas a WHERE a.tenant_id = $1 AND a.id = $2 FOR UPDATE`, [tenantId, id]);
    if (!rows.length) throw notFound('Localité introuvable');
    const { descendants, contracts } = rows[0];
    if (descendants > 0 && !cascade) throw conflict(`Cette localité contient ${descendants} sous-unité(s) : confirmez la suppression en cascade.`);
    await client.query('DELETE FROM admin_areas WHERE tenant_id = $1 AND id = $2', [tenantId, id]);
    await applySitesGeoTx(client, tenantId);
    return { deleted: 1 + descendants, contractsDetached: contracts };
  });
}

module.exports = {
  listAdminLevels, listAdminAreas, getCountry, saveCountry, replaceBreakdown,
  directory, directoryAll, createArea, updateArea, deleteArea,
};
