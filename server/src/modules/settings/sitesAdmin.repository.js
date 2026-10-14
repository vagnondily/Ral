/**
 * Registre des sites — page de gestion dédiée (Paramétrage › Sites).
 * Colonnes : Identifiant, Localité, Code POI, Field_office(+code), Region,
 * Adm1Code, District, Adm2Code, Commune, Adm3Code, Fokontany, Adm4Code,
 * Activity_tag, Tag_code, Lat, Long.
 *
 * ⚠️ Toute écriture dans `sites` qui change la géographie doit passer par
 * `withSubmissionLinks` + `afterSitesChangedTx` (invariant de concurrence du
 * projet) : le rapprochement des lieux et des soumissions est ré-appliqué. On
 * RÉUTILISE donc ces fonctions (placeMatch.repository) plutôt que de dupliquer
 * la logique, sans toucher aux fichiers de l'autre chantier.
 *
 * Attribution GPS : on ne fournit que les NOMS adm1–4 (tirés d'admin_areas via
 * geoAttribution) ; `applySitesGeoTx` (dans afterSitesChangedTx) en déduit les
 * pcodes et l'admin_area_id — pas de conflit avec le pipeline par nom.
 */
const { withTenantTransaction } = require('../../config/db');
const { withSubmissionLinks, afterSitesChangedTx } = require('./placeMatch.repository');
const { attributeByGps } = require('../common/geoAttribution');
const { summarizeSiteDeletion } = require('./siteDeletion');
const { normalizePublicId } = require('../common/publicId');

const LIST_COLS = `
  s.id,
  s.public_id       AS "identifiant",
  s.code            AS "ancienCode",
  s.name            AS "localite",
  s.location_id     AS "codePoi",
  s.field_office_id AS "fieldOfficeId",
  fo.name           AS "fieldOffice",
  fo.code           AS "fieldOfficeCode",
  COALESCE(s.adm1, '')            AS "region",
  s.adm1_pcode      AS "adm1Code",
  COALESCE(s.adm2, s.district)    AS "district",
  s.adm2_pcode      AS "adm2Code",
  COALESCE(s.adm3, s.commune)     AS "commune",
  s.adm3_pcode      AS "adm3Code",
  COALESCE(s.adm4, s.fokontany)   AS "fokontany",
  s.adm4_pcode      AS "adm4Code",
  s.activity        AS "activityTag",
  s.tag_code        AS "tagCode",
  s.gps_lat         AS "lat",
  s.gps_lng         AS "lng",
  s.geo_status      AS "geoStatus",
  s.admin_area_id   AS "adminAreaId"`;

/**
 * Liste complète (recherche libre sur identifiant / localité / commune / district / code POI),
 * avec le lien aux DONNÉES RÉELLES (retour 63) : dernière collecte rattachée au site, nombre de
 * soumissions et de visites — agrégés en SQL une fois par requête (index idx_mon_sub_site).
 * `ids` : seulement ces sites (export d'une sélection).
 */
async function listSites(tenantId, { q, limit = 1000, offset = 0, ids = null } = {}) {
  const cap = Math.min(Math.max(1, Number(limit) || 1000), 5000);
  const skip = Math.max(0, Number(offset) || 0);
  return withTenantTransaction(tenantId, async (client) => {
    const params = [tenantId];
    let where = 's.tenant_id = $1';
    if (Array.isArray(ids)) { params.push(ids); where += ` AND s.id = ANY($${params.length}::uuid[])`; }
    if (q) {
      params.push(`%${q}%`);
      const p = `$${params.length}`;
      // Identifiant « S-XXXX-XXXX » saisi librement (casse, tirets, O/0, I/L/1) : égalité exacte.
      const pid = normalizePublicId(q);
      let exact = '';
      if (pid) { params.push(pid); exact = ` OR s.public_id = $${params.length}`; }
      where += ` AND (s.name ILIKE ${p} OR s.code ILIKE ${p} OR s.public_id ILIKE ${p} OR s.commune ILIKE ${p}
                   OR s.district ILIKE ${p} OR s.location_id ILIKE ${p} OR s.adm3 ILIKE ${p}${exact})`;
    }
    params.push(cap, skip);
    const { rows } = await client.query(
      `WITH sub AS (
         SELECT site_id, max(period_month) AS last_m, count(*)::int AS n
           FROM monitoring_submissions
          WHERE tenant_id = $1 AND site_id IS NOT NULL AND NOT excluded
          GROUP BY site_id),
       vis AS (
         SELECT site_id, count(*)::int AS n FROM site_visits WHERE tenant_id = $1 GROUP BY site_id)
       SELECT ${LIST_COLS},
              to_char(sub.last_m, 'YYYY-MM') AS "lastDataMonth",
              COALESCE(sub.n, 0) AS "submissionCount",
              COALESCE(vis.n, 0) AS "visitCount"
         FROM sites s
         LEFT JOIN field_offices fo ON fo.id = s.field_office_id AND fo.tenant_id = s.tenant_id
         LEFT JOIN sub ON sub.site_id = s.id
         LEFT JOIN vis ON vis.site_id = s.id
        WHERE ${where}
        ORDER BY COALESCE(s.adm2, s.district), COALESCE(s.adm3, s.commune), s.name
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return rows;
  });
}

// Colonnes directement écrites par la page (hors géographie dérivée des noms).
// Le Code POI (location_id) est AUTO-généré et stable (L###) par le déclencheur
// de la migration 046 : il n'est jamais saisi ici (clé stable, affichage seul).
const DIRECT = {
  name: 'name', activity: 'activity', tagCode: 'tag_code',
  fieldOfficeId: 'field_office_id', lat: 'gps_lat', lng: 'gps_lng',
};
// Colonnes de géographie par NOM (le pipeline en déduit pcodes + admin_area_id).
const GEO = { region: 'adm1', district: 'adm2', commune: 'adm3', fokontany: 'adm4' };

/** Construit SET/valeurs pour un patch, à partir de `firstParam`. */
function buildSets(patch, firstParam) {
  const sets = []; const values = [];
  const put = (col, v) => { values.push(v); sets.push(`${col} = $${firstParam + values.length - 1}`); };
  for (const [key, col] of Object.entries(DIRECT)) {
    if (key in patch && patch[key] !== undefined) put(col, patch[key] === '' ? null : patch[key]);
  }
  for (const [key, col] of Object.entries(GEO)) {
    if (key in patch && patch[key] !== undefined) {
      const v = patch[key] === '' ? null : patch[key];
      put(col, v);
      // Garder district/commune (colonnes brutes) alignées sur adm2/adm3.
      if (col === 'adm2') put('district', v);
      if (col === 'adm3') put('commune', v);
    }
  }
  return { sets, values };
}

/** Slug déterministe pour le code (dédup sur district+commune+nom), comme l'import existant. */
function siteCode({ district, commune, name }) {
  const slug = (x) => String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  return `${slug(district)}--${slug(commune)}--${slug(name)}`.slice(0, 120) || `site-${Date.now()}`;
}

/** Crée un site. Renvoie { id } ou lève un conflit (409) si le code existe déjà. */
async function createSite(tenantId, data) {
  // L'identifiant d'un nouveau site est toujours celui de MEMS (retour 70), jamais un code saisi.
  const code = siteCode({ district: data.district, commune: data.commune, name: data.localite });
  return withSubmissionLinks(tenantId, async (client) => {
    const { rows: dup } = await client.query('SELECT id FROM sites WHERE tenant_id = $1 AND code = $2', [tenantId, code]);
    if (dup.length) { const e = new Error('duplicate'); e.code = 'DUP'; e.siteId = dup[0].id; throw e; }
    const patch = {
      name: data.localite, activity: data.activityTag, tagCode: data.tagCode,
      fieldOfficeId: data.fieldOfficeId || null, lat: data.lat ?? null, lng: data.lng ?? null,
      region: data.region, district: data.district, commune: data.commune, fokontany: data.fokontany,
    };
    // Paramètres : $1 tenant_id, $2 code, puis les valeurs à partir de $3.
    const { sets, values } = buildSets(patch, 3);
    const cols = sets.map((s) => s.split(' = ')[0]);
    const ph = values.map((_, i) => `$${3 + i}`);
    const { rows } = await client.query(
      `INSERT INTO sites (tenant_id, code${cols.length ? ', ' : ''}${cols.join(', ')})
       VALUES ($1, $2${ph.length ? ', ' : ''}${ph.join(', ')}) RETURNING id`,
      [tenantId, code, ...values]
    );
    await afterSitesChangedTx(client, tenantId);
    return { id: rows[0].id };
  });
}

/** Met à jour un site (patch partiel). Renvoie true si trouvé. */
async function updateSite(tenantId, id, patch) {
  const { sets, values } = buildSets(patch, 3);
  return withSubmissionLinks(tenantId, async (client) => {
    if (!sets.length) {
      const { rowCount } = await client.query('SELECT 1 FROM sites WHERE tenant_id = $1 AND id = $2', [tenantId, id]);
      return rowCount > 0;
    }
    const { rowCount } = await client.query(
      `UPDATE sites SET ${sets.join(', ')} WHERE tenant_id = $1 AND id = $2`, [tenantId, id, ...values]);
    await afterSitesChangedTx(client, tenantId);
    return rowCount > 0;
  });
}

/** Nœuds admin_areas (centroïdes) pour l'attribution GPS. */
async function loadAdminAreas(client, tenantId) {
  const { rows } = await client.query(
    `SELECT id, depth, name, pcode, lat, lng, parent_id AS "parentId"
       FROM admin_areas WHERE tenant_id = $1`, [tenantId]);
  return rows;
}

/**
 * Attribution GPS : pour chaque site ciblé ayant des coordonnées, déduit
 * région / district / commune (/ fokontany) depuis admin_areas (centroïde le
 * plus proche) et écrit les NOMS ; le pipeline en déduit les pcodes.
 * @returns { attributed, skipped, total }
 */
async function autoAttribute(tenantId, { ids = null, onlyEmpty = false } = {}) {
  return withSubmissionLinks(tenantId, async (client) => {
    const areas = await loadAdminAreas(client, tenantId);
    const params = [tenantId];
    let where = 's.tenant_id = $1 AND s.gps_lat IS NOT NULL AND s.gps_lng IS NOT NULL';
    if (Array.isArray(ids) && ids.length) { params.push(ids); where += ` AND s.id = ANY($${params.length}::uuid[])`; }
    if (onlyEmpty) where += " AND (s.adm3 IS NULL OR s.adm3 = '')";
    const { rows: sites } = await client.query(
      `SELECT id, gps_lat AS lat, gps_lng AS lng FROM sites s WHERE ${where}`, params);
    let attributed = 0; let skipped = 0;
    for (const s of sites) {
      const r = attributeByGps({ lat: Number(s.lat), lng: Number(s.lng) }, areas);
      if (!r || !r.adm3) { skipped += 1; continue; }
      // Clé de liaison STABLE = admin_area_id (UUID). Les noms sont posés pour la
      // lisibilité et pour que le pipeline par nom reste cohérent ; les pcodes,
      // eux, restent de simples attributs dérivés (jamais la clé de jointure).
      await client.query(
        `UPDATE sites SET admin_area_id = COALESCE($3, admin_area_id),
                          adm1 = COALESCE($4, adm1),
                          adm2 = COALESCE($5, adm2), district = COALESCE($5, district),
                          adm3 = $6, commune = $6, adm4 = COALESCE($7, adm4)
          WHERE tenant_id = $1 AND id = $2`,
        [tenantId, s.id, r.adminAreaId, r.adm1, r.adm2, r.adm3, r.adm4]);
      attributed += 1;
    }
    if (attributed) await afterSitesChangedTx(client, tenantId);
    return { attributed, skipped, total: sites.length };
  });
}

/**
 * Import en masse depuis un classeur parsé (sitesXlsx.parseSitesWorkbook).
 * Upsert par identifiant (code) : met à jour s'il existe, crée sinon. Les
 * colonnes dérivées (Code POI, pcodes) ne sont jamais écrites. Un seul
 * re-rattachement des lieux en fin de lot (afterSitesChangedTx).
 * @returns { created, updated, skipped, total }
 */
async function importSites(tenantId, rows) {
  return withSubmissionLinks(tenantId, async (client) => {
    // Résolution des bureaux par code (Field_office_code).
    const { rows: offs } = await client.query('SELECT id, code FROM field_offices WHERE tenant_id = $1', [tenantId]);
    const officeByCode = new Map(offs.map((o) => [String(o.code || '').trim().toLowerCase(), o.id]));

    // Identifiant fourni (retours 70 et 64) : seul un identifiant DÉJÀ ATTRIBUÉ par MEMS (classeur
    // exporté puis repris hors ligne) désigne un site à mettre à jour — l'identifiant « S-XXXX-XXXX »
    // (saisie tolérante) ou, pour les anciens classeurs, l'ancien code (PLAN-0001). Un code saisi dans
    // le modèle et inconnu de MEMS n'est jamais adopté : le site est créé avec son propre identifiant.
    const given = [...new Set((rows || []).map((r) => String(r.identifiant || '').trim()).filter(Boolean))];
    const givenPids = [...new Set(given.map(normalizePublicId).filter(Boolean))];
    const { rows: known } = given.length
      ? await client.query(
        'SELECT id, code, public_id FROM sites WHERE tenant_id = $1 AND (public_id = ANY($2::text[]) OR code = ANY($3::text[]))',
        [tenantId, givenPids, given])
      : { rows: [] };
    const knownId = new Map();
    for (const k of known) { knownId.set(k.public_id, k.id); knownId.set(k.code, k.id); }
    let created = 0; let updated = 0; let ignoredCodes = 0; const skipped = [];
    for (const r of rows || []) {
      if (!r.localite || !String(r.localite).trim()) { skipped.push({ row: r._row, reason: 'Localité manquante.' }); continue; }
      const givenCode = String(r.identifiant || '').trim();
      const knownSite = givenCode ? (knownId.get(normalizePublicId(givenCode)) || knownId.get(givenCode) || null) : null;
      if (givenCode && !knownSite) ignoredCodes += 1;
      const code = siteCode({ district: r.district, commune: r.commune, name: r.localite });
      const fieldOfficeId = r.fieldOfficeCode
        ? (officeByCode.get(String(r.fieldOfficeCode).trim().toLowerCase()) || null)
        : undefined;
      const patch = {
        name: r.localite, activity: r.activityTag, tagCode: r.tagCode,
        region: r.region, district: r.district, commune: r.commune, fokontany: r.fokontany,
        lat: r.lat ?? null, lng: r.lng ?? null,
        ...(fieldOfficeId !== undefined ? { fieldOfficeId } : {}),
      };
      const { rows: ex } = knownSite
        ? { rows: [{ id: knownSite }] }
        : await client.query('SELECT id FROM sites WHERE tenant_id = $1 AND code = $2', [tenantId, code]);
      if (ex.length) {
        const { sets, values } = buildSets(patch, 3);
        if (sets.length) {
          await client.query(`UPDATE sites SET ${sets.join(', ')} WHERE tenant_id = $1 AND id = $2`, [tenantId, ex[0].id, ...values]);
        }
        updated += 1;
      } else {
        const { sets, values } = buildSets(patch, 3);
        const cols = sets.map((s) => s.split(' = ')[0]);
        const ph = values.map((_, i) => `$${3 + i}`);
        await client.query(
          `INSERT INTO sites (tenant_id, code${cols.length ? ', ' : ''}${cols.join(', ')})
           VALUES ($1, $2${ph.length ? ', ' : ''}${ph.join(', ')})`,
          [tenantId, code, ...values]
        );
        created += 1;
      }
    }
    await afterSitesChangedTx(client, tenantId);
    return { created, updated, ignoredCodes, skipped, total: (rows || []).length };
  });
}

/**
 * Données reliées à des sites (règle « un site qui porte des données ne se supprime pas »,
 * retour 33) : visites, soumissions rattachées, grille des sites actifs, ancienne affectation.
 * Une requête, comptes par site ; seuls les sites qui ont au moins une donnée sont rendus.
 * @returns {Promise<Map<string, {visits:number, submissions:number, activation:number, assignments:number}>>}
 */
async function linkedDataTx(client, tenantId, ids) {
  const { rows } = await client.query(
    `SELECT x.site_id,
            count(*) FILTER (WHERE x.k = 'v')::int AS visits,
            count(*) FILTER (WHERE x.k = 's')::int AS submissions,
            count(*) FILTER (WHERE x.k = 'a')::int AS activation,
            count(*) FILTER (WHERE x.k = 't')::int AS assignments
       FROM (SELECT site_id, 'v' AS k FROM site_visits WHERE tenant_id = $1 AND site_id = ANY($2::uuid[])
             UNION ALL
             SELECT site_id, 's' FROM monitoring_submissions WHERE tenant_id = $1 AND site_id = ANY($2::uuid[])
             UNION ALL
             SELECT site_id, 'a' FROM site_month_status WHERE tenant_id = $1 AND site_id = ANY($2::uuid[])
             UNION ALL
             SELECT site_id, 't' FROM tpm_assignments WHERE tenant_id = $1 AND site_id = ANY($2::uuid[])) x
      GROUP BY x.site_id`,
    [tenantId, ids]
  );
  return new Map(rows.map((r) => [r.site_id, { visits: r.visits, submissions: r.submissions, activation: r.activation, assignments: r.assignments }]));
}

/** Supprime un site sans donnée reliée (sinon 'linked' + les comptes — référentiel). */
async function deleteSite(tenantId, id) {
  return withSubmissionLinks(tenantId, async (client) => {
    const { rows } = await client.query('SELECT 1 FROM sites WHERE tenant_id = $1 AND id = $2 FOR UPDATE', [tenantId, id]);
    if (!rows.length) return { outcome: 'not_found' };
    const linked = (await linkedDataTx(client, tenantId, [id])).get(id);
    if (linked) return { outcome: 'linked', linked };
    await client.query('DELETE FROM sites WHERE tenant_id = $1 AND id = $2', [tenantId, id]);
    await afterSitesChangedTx(client, tenantId);
    return { outcome: 'ok' };
  });
}

/**
 * Actions groupées sur une sélection de sites (retour 62), tout-ou-rien dans UNE transaction
 * (verrou des rattachements, lignes verrouillées) :
 *  - 'delete' : supprime les sites SANS donnée reliée ; les autres sont rendus dans `refused`
 *    avec leurs comptes (ils restent, comme pour la suppression d'un site seul) ;
 *  - 'set'    : change l'activité et / ou le bureau de tous les sites sélectionnés.
 * Le rattachement des lieux et des soumissions est ré-appliqué une fois.
 */
async function bulkSites(tenantId, { ids, action, patch = {} }) {
  return withSubmissionLinks(tenantId, async (client) => {
    const { rows: found } = await client.query(
      'SELECT id, name FROM sites WHERE tenant_id = $1 AND id = ANY($2::uuid[]) ORDER BY id FOR UPDATE', [tenantId, ids]);
    const missing = ids.length - found.length;
    if (action === 'delete') {
      const linked = await linkedDataTx(client, tenantId, found.map((r) => r.id));
      const sum = summarizeSiteDeletion(found, linked);
      if (sum.deletable.length) {
        await client.query('DELETE FROM sites WHERE tenant_id = $1 AND id = ANY($2::uuid[])', [tenantId, sum.deletable]);
        await afterSitesChangedTx(client, tenantId);
      }
      return { deleted: sum.deletable.length, keptCount: sum.kept.length, keptIds: sum.kept, byReason: sum.byReason, sample: sum.sample, missing };
    }
    // 'set' : un seul UPDATE (colonnes absentes du patch inchangées).
    const sets = []; const params = [tenantId, found.map((r) => r.id)];
    if (patch.activityTag !== undefined) { params.push(patch.activityTag || null); sets.push(`activity = $${params.length}`); }
    if (patch.fieldOfficeId !== undefined) {
      if (patch.fieldOfficeId) {
        const { rows: fo } = await client.query('SELECT 1 FROM field_offices WHERE tenant_id = $1 AND id = $2', [tenantId, patch.fieldOfficeId]);
        if (!fo.length) { const e = new Error('Bureau inconnu.'); e.code = 'BAD_OFFICE'; throw e; }
      }
      params.push(patch.fieldOfficeId || null); sets.push(`field_office_id = $${params.length}`);
    }
    if (!sets.length || !found.length) return { updated: 0, missing };
    const { rowCount } = await client.query(
      `UPDATE sites SET ${sets.join(', ')} WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, params);
    await afterSitesChangedTx(client, tenantId);
    return { updated: rowCount, missing };
  });
}

/**
 * Aperçu d'une suppression groupée (retour 89), en LECTURE seule : combien de
 * sites seraient supprimés, combien gardés (ils portent des données) et pourquoi.
 * Même règle que bulkSites('delete').
 */
async function previewBulkDelete(tenantId, ids) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows: found } = await client.query(
      'SELECT id, name FROM sites WHERE tenant_id = $1 AND id = ANY($2::uuid[]) ORDER BY name, id', [tenantId, ids]);
    const linked = await linkedDataTx(client, tenantId, found.map((r) => r.id));
    const sum = summarizeSiteDeletion(found, linked);
    return {
      total: sum.total, deletable: sum.deletable.length, keptCount: sum.kept.length,
      byReason: sum.byReason, sample: sum.sample, missing: ids.length - found.length,
    };
  });
}

module.exports = { listSites, createSite, updateSite, autoAttribute, deleteSite, bulkSites, previewBulkDelete, linkedDataTx, importSites };
