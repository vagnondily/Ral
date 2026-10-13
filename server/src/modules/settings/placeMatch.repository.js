const { withTenantTransaction } = require('../../config/db');
const { chunkRows } = require('../../db/batch');
const { AppError, badRequest, conflict, notFound } = require('../../middleware/errors');
const { buildPlaceIndex, resolvePath, groupUnmatched, normPlace, parentKeyOf, looksLikePcode, buildOfficeIndex, resolveOffice } = require('../common/placeMatch');
const { detectMapping } = require('../monitoring/memsMapping');
const { buildSiteIndex, resolveSite, queueKeyOf, isAutomaticSite } = require('../common/siteMatch');
const { buildPartnerIndex, resolvePartner, buildAgentIndex, resolveAgent } = require('../common/partyMatch');

/**
 * Rapprochement des lieux — SEUL fichier de ce chantier qui écrit du SQL. La
 * résolution elle-même est pure (common/placeMatch.js). Toutes les fonctions
 * `*Tx` travaillent dans la transaction de l'appelant (tout ou rien avec
 * l'écriture qui les déclenche) ; le volume reste borné par le nombre de
 * graphies DISTINCTES, pas par le nombre de lignes.
 */

/** Découpage du tenant + alias de zones appris → index de résolution. */
async function loadPlaceIndexTx(client, tenantId) {
  const [{ rows: areas }, { rows: aliases }] = [
    await client.query(
      `SELECT id, depth, name, pcode, parent_id AS "parentId", path FROM admin_areas WHERE tenant_id = $1`, [tenantId]),
    await client.query(
      `SELECT depth, parent_key AS "parentKey", alias_key AS "aliasKey", target_pcode AS "targetPcode", target_id AS "targetId",
              target_path AS "targetPath"
         FROM location_aliases WHERE tenant_id = $1 AND kind = 'zone'`, [tenantId]),
  ];
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
async function syncQueueTx(client, tenantId, source, allGroups, kind = 'zone') {
  // Défense : une clé vide ou trop longue ferait échouer toute la transaction (CHECK raw_key 1..200).
  const groups = allGroups.filter((g) => g.rawKey && g.rawKey.length <= 200);
  for (const slice of chunkRows(groups, 8)) {
    const params = [tenantId, source, kind];
    const tuples = slice.map((g) => {
      params.push(g.depth, g.parentKey, g.parentLabel, g.rawKey, g.rawLabel.slice(0, 200), g.count, JSON.stringify(g.candidates), g.status);
      const b = params.length - 8;
      return `($${b + 1}::int, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}::int, $${b + 7}::jsonb, $${b + 8})`;
    });
    await client.query(
      `INSERT INTO location_match_queue (tenant_id, kind, depth, parent_key, parent_label, raw_key, raw_label, occurrences, candidates, status)
       SELECT $1, $3, v.depth, v.parent_key, v.parent_label, v.raw_key, v.raw_label, jsonb_build_object($2::text, v.n), v.candidates, v.status
         FROM (VALUES ${tuples.join(',')}) AS v(depth, parent_key, parent_label, raw_key, raw_label, n, candidates, status)
       ON CONFLICT (tenant_id, kind, COALESCE(depth, 0), parent_key, raw_key) DO UPDATE SET
         occurrences = location_match_queue.occurrences || EXCLUDED.occurrences,
         candidates = EXCLUDED.candidates, parent_label = EXCLUDED.parent_label, raw_label = EXCLUDED.raw_label, last_seen_at = now(),
         status = CASE WHEN location_match_queue.status IN ('ignore', 'resolu') THEN location_match_queue.status ELSE EXCLUDED.status END`,
      params);
  }
  // Graphies de cette source qui ne sont plus présentes : leur compteur disparaît.
  const keep = groups.map((g) => `${g.depth || 0}|${g.parentKey}|${g.rawKey}`);
  await client.query(
    `UPDATE location_match_queue SET occurrences = occurrences - $2::text
      WHERE tenant_id = $1 AND kind = $4 AND occurrences ? $2::text
        AND NOT (COALESCE(depth, 0)::text || '|' || parent_key || '|' || raw_key = ANY($3::text[]))`,
    [tenantId, source, keep, kind]);
  await client.query(
    `DELETE FROM location_match_queue
      WHERE tenant_id = $1 AND kind = $2 AND occurrences = '{}'::jsonb AND status IN ('a_valider', 'ambigu', 'introuvable')`,
    [tenantId, kind]);
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
 * Une seule réapplication des rattachements de formulaires reçus à la fois par
 * tenant. Sans ce verrou, deux transactions qui chargent les corrections (ou le
 * référentiel) chacune de leur côté se réécrivent mutuellement : la seconde
 * repose des liens calculés sans la correction que la première vient d'enregistrer.
 * Pris au DÉBUT de la transaction de l'appelant (avant toute ligne verrouillée,
 * pour ne jamais s'interbloquer), puis à nouveau — sans effet, il est réentrant —
 * par chaque fonction de réapplication.
 */
const linksKey = (tenantId) => `mems:submissions-apply:${tenantId}`;
const LINKS_LOCKED = Symbol('mems.submissionLinksLocked');

async function lockSubmissionLinksTx(client, tenantId) {
  if (client[LINKS_LOCKED]) return; // déjà pris par withSubmissionLinks (même transaction)
  // Chemins sans enveloppe (réparations au démarrage) : attente bornée à 20 s, puis 503 « réessayez ».
  await client.query("SET LOCAL lock_timeout = '20s'");
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [linksKey(tenantId)]);
  await client.query('SET LOCAL lock_timeout = DEFAULT');
}

const BUSY = Symbol('busy');
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * Transaction d'écriture qui sera suivie d'une réapplication des rattachements : le verrou du
 * tenant est pris EN PREMIER (avant toute ligne verrouillée), par un essai non bloquant. S'il est
 * occupé (un gros import en cours), la transaction est annulée et la CONNEXION RENDUE au pool,
 * puis on réessaie (attente croissante 100 ms → 500 ms, tirée au hasard autour de cette valeur
 * pour que les écritures en attente ne réessaient pas toutes au même instant) : des écritures en
 * attente n'immobilisent jamais le pool, les lectures des autres utilisateurs continuent.
 * Au-delà de `waitMs` : 503.
 */
async function withSubmissionLinks(tenantId, fn, { waitMs = 20000 } = {}) {
  const deadline = Date.now() + waitMs;
  let delay = 100;
  for (;;) {
    try {
      return await withTenantTransaction(tenantId, async (client) => {
        const { rows: [{ ok }] } = await client.query('SELECT pg_try_advisory_xact_lock(hashtext($1)) AS ok', [linksKey(tenantId)]);
        if (!ok) throw BUSY;
        client[LINKS_LOCKED] = true;
        try { return await fn(client); } finally { delete client[LINKS_LOCKED]; }
      });
    } catch (err) {
      if (err !== BUSY) throw err;
      if (Date.now() >= deadline) throw new AppError(503, 'Une autre mise à jour des mêmes données est en cours : réessayez dans un instant.');
      await sleep(Math.round(delay * (0.5 + Math.random())));
      delay = Math.min(delay * 2, 500);
    }
  }
}

/**
 * À appeler en fin de TOUTE écriture de sites (import, ajout, modification,
 * suppression de bureau) : rattachement au découpage puis au bureau, dans la
 * transaction de l'appelant.
 */
async function afterSitesChangedTx(client, tenantId) {
  await lockSubmissionLinksTx(client, tenantId);
  const geo = await applySitesGeoTx(client, tenantId);
  const attached = await attachUnassignedSitesTx(client, tenantId);
  // Un site ajouté, renommé ou relocalisé peut être celui d'un formulaire déjà reçu.
  const submissionSites = await applySubmissionSitesTx(client, tenantId);
  return { ...geo, attached, submissionSites };
}

// ---- Formulaires reçus (soumissions) -----------------------------------------------
/** Bureaux actifs + communes (pcode) de leur périmètre → index de résolution des bureaux. */
async function loadOfficeIndexTx(client, tenantId) {
  const { rows } = await client.query(
    `SELECT o.id, o.code, o.name, o.active,
            COALESCE(array_agg(c.adm3_pcode) FILTER (WHERE c.adm3_pcode IS NOT NULL), '{}') AS communes
       FROM field_offices o LEFT JOIN field_office_communes c ON c.office_id = o.id AND c.tenant_id = o.tenant_id
      WHERE o.tenant_id = $1 GROUP BY o.id`, [tenantId]);
  return buildOfficeIndex(rows);
}

/**
 * Libellés des valeurs codées d'une dimension (« 7 » → « Ambovombe » pour le
 * bureau, « 609010034 » → « Maheny » pour l'école) : liste de choix de la
 * colonne qui alimente la dimension — celle choisie à la main dans « Mapping
 * MEMS », sinon celle que reconnaît la table d'alias —, fiche par fiche.
 * @param {'field_office'|'site'} dimension
 * @returns {Map<formId, Map<value, label>>}
 */
/**
 * Catalogue des champs et colonnes réellement présentes (soumission la plus récente de chaque
 * fiche), lus UNE fois et partagés par les dimensions (bureau, partenaire, agent).
 */
async function choiceContextTx(client, tenantId) {
  const { rows: fields } = await client.query(
    'SELECT form_id AS "formId", name, list_name AS "listName" FROM monitoring_form_fields WHERE tenant_id = $1', [tenantId]);
  // Colonnes réellement présentes dans les données : le XLSForm peut décrire « EnuPartner » alors
  // que l'export porte « CPList ». Une seule soumission par fiche est ouverte (LATERAL … LIMIT 1),
  // jamais les clés JSON de toutes les soumissions.
  const { rows: samples } = await client.query(
    `SELECT f.id AS "formId", ARRAY(SELECT jsonb_object_keys(s.data)) AS keys
       FROM monitoring_forms f
       CROSS JOIN LATERAL (SELECT data FROM monitoring_submissions ms
                            WHERE ms.tenant_id = $1 AND ms.form_id = f.id ORDER BY ms.created_at DESC LIMIT 1) s
      WHERE f.tenant_id = $1`, [tenantId]);
  const dataKeys = new Map(samples.map((r) => [r.formId, new Set((r.keys || []).map((k) => k.toLowerCase()))]));
  return { fields, dataKeys };
}

async function choiceLabelsTx(client, tenantId, dimension, ctx) {
  const { fields, dataKeys } = ctx || await choiceContextTx(client, tenantId);
  const { rows: overrides } = await client.query(
    'SELECT form_id AS "formId", column_name AS "columnName" FROM monitoring_field_map WHERE tenant_id = $1 AND dimension = $2',
    [tenantId, dimension]);
  const forced = new Map(overrides.map((o) => [o.formId, (o.columnName || '').trim()]));
  const byForm = new Map();
  for (const f of fields) { if (!byForm.has(f.formId)) byForm.set(f.formId, []); byForm.get(f.formId).push(f); }
  const lists = [];
  for (const [formId, list] of byForm) {
    const inData = dataKeys.get(formId);
    const present = inData ? list.filter((f) => inData.has(f.name.toLowerCase())) : [];
    const detect = (names) => (detectMapping(names).find((d) => d.key === dimension) || {}).column;
    const col = forced.has(formId) ? forced.get(formId) : (detect(present.map((f) => f.name)) || detect(list.map((f) => f.name)));
    const field = col && list.find((f) => f.name.toLowerCase() === col.toLowerCase());
    if (field && field.listName) lists.push([formId, field.listName]);
  }
  const out = new Map();
  if (!lists.length) return out;
  const { rows } = await client.query(
    `SELECT c.form_id AS "formId", c.value, c.label FROM monitoring_choices c
       JOIN unnest($2::uuid[], $3::text[]) AS l(form_id, list_name) ON l.form_id = c.form_id AND l.list_name = c.list_name
      WHERE c.tenant_id = $1`, [tenantId, lists.map((l) => l[0]), lists.map((l) => l[1])]);
  for (const r of rows) {
    if (!out.has(r.formId)) out.set(r.formId, new Map());
    out.get(r.formId).set(String(r.value), r.label);
  }
  return out;
}
const officeChoiceLabelsTx = (client, tenantId) => choiceLabelsTx(client, tenantId, 'field_office');

/**
 * Rattache les formulaires reçus : commune (pcode) et bureau, par combinaison
 * DISTINCTE de valeurs (le volume dépend du nombre de graphies, pas de lignes),
 * mise à jour ensembliste par combinaison, file « À rapprocher » de la source
 * « soumissions » (les codes absents du découpage n'y vont pas : ce ne sont
 * pas des noms à rapprocher). Les valeurs brutes ne sont jamais modifiées.
 */
async function applySubmissionsGeoTx(client, tenantId) {
  await lockSubmissionLinksTx(client, tenantId); // corrections lues APRÈS celles des autres transactions
  const [index, offices, labels, links] = [
    await loadPlaceIndexTx(client, tenantId), await loadOfficeIndexTx(client, tenantId), await officeChoiceLabelsTx(client, tenantId),
    await loadValueLinksTx(client, tenantId)];
  const { rows: combos } = await client.query(
    `SELECT form_id AS "formId", COALESCE(admin1, '') AS a1, COALESCE(admin2, '') AS a2, COALESCE(admin3, '') AS a3,
            COALESCE(admin4, '') AS a4, COALESCE(field_office, '') AS fo, count(*)::int AS n
       FROM monitoring_submissions WHERE tenant_id = $1 GROUP BY 1, 2, 3, 4, 5, 6`, [tenantId]);
  const updates = []; const unmatched = []; let resolved = 0; let withOffice = 0;
  for (const c of combos) {
    const path = resolvePath(index, { adm1: c.a1 || null, adm2: c.a2 || null, adm3: c.a3 || null, adm4: c.a4 || null });
    const finest = path.finest;
    const communePcode = (finest && finest.depth >= 3 && path.pcodes.adm3)
      || (looksLikePcode(c.a3) ? c.a3.trim().toUpperCase() : null);
    if (path.status === 'resolu') resolved += c.n;
    for (const l of path.levels) {
      if (['vide', 'hors_niveau', 'resolu'].includes(l.status) || l.area || looksLikePcode(l.label)) continue;
      const parentLevel = path.levels.find((x) => x.depth === l.depth - 1);
      unmatched.push({ depth: l.depth, parent: parentLevel && parentLevel.area, label: l.label, status: l.status, candidates: l.candidates, count: c.n });
    }
    // Correspondance choisie à la main pour ce code dans cette fiche (écran « Correspondances ») : elle l'emporte.
    const manual = links.get(linkKey(c.formId, 'field_office', c.fo));
    const officeLabel = (labels.get(c.formId) && labels.get(c.formId).get(c.fo)) || c.fo || null;
    const officeId = manual ? manual.officeId : (resolveOffice(offices, { label: officeLabel, commune: communePcode }).office || {}).id || null;
    if (officeId) withOffice += c.n;
    updates.push({ ...c, pcode: communePcode, office: officeId, status: path.status === 'resolu' ? 'exact' : path.status });
  }
  for (const slice of chunkRows(updates, 9)) {
    const params = [tenantId];
    const tuples = slice.map((u) => {
      params.push(u.formId, u.a1, u.a2, u.a3, u.a4, u.fo, u.pcode, u.office, u.status);
      const b = params.length - 9;
      return `($${b + 1}::uuid, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}::uuid, $${b + 9})`;
    });
    await client.query(
      `UPDATE monitoring_submissions ms SET adm3_pcode = v.pcode, field_office_id = v.office, geo_status = v.status
         FROM (VALUES ${tuples.join(',')}) AS v(form_id, a1, a2, a3, a4, fo, pcode, office, status)
        WHERE ms.tenant_id = $1 AND ms.form_id = v.form_id
          AND COALESCE(ms.admin1, '') = v.a1 AND COALESCE(ms.admin2, '') = v.a2 AND COALESCE(ms.admin3, '') = v.a3
          AND COALESCE(ms.admin4, '') = v.a4 AND COALESCE(ms.field_office, '') = v.fo
          AND (ms.adm3_pcode IS DISTINCT FROM v.pcode OR ms.field_office_id IS DISTINCT FROM v.office OR ms.geo_status IS DISTINCT FROM v.status)`,
      params);
  }
  await syncQueueTx(client, tenantId, 'soumissions', groupUnmatched(unmatched));
  const total = combos.reduce((a, c) => a + c.n, 0);
  // La commune vient d'être reconnue : le site se cherche dedans (même transaction).
  const sites = await applySubmissionSitesTx(client, tenantId);
  const parties = await applySubmissionPartiesTx(client, tenantId, links);
  return { submissions: total, combinations: combos.length, resolved, withOffice, sites, parties };
}

// ---- Correspondances des valeurs codées (retour n° 3) ---------------------------------
const linkKey = (formId, dimension, raw) => `${formId}|${dimension}|${raw}`;

/** Corrections manuelles de toutes les fiches : (fiche, dimension, valeur) → cible (null = ne pas relier). */
async function loadValueLinksTx(client, tenantId) {
  const { rows } = await client.query(
    `SELECT form_id AS "formId", dimension, raw_value AS raw, office_id AS "officeId", partner_id AS "partnerId", agent_id AS "agentId"
       FROM monitoring_value_links WHERE tenant_id = $1`, [tenantId]);
  return new Map(rows.map((r) => [linkKey(r.formId, r.dimension, r.raw), r]));
}

/** Partenaires et agents MEMS → index de rapprochement (common/partyMatch). */
async function loadPartiesTx(client, tenantId) {
  const { rows: partners } = await client.query(
    'SELECT id, name, short_name AS "shortName", active FROM partners WHERE tenant_id = $1 ORDER BY name', [tenantId]);
  const { rows: agents } = await client.query(
    'SELECT id, tpm_provider_id AS "partnerId", name, code, active FROM tpm_agents WHERE tenant_id = $1 ORDER BY name', [tenantId]);
  return { partners, agents, partnerIndex: buildPartnerIndex(partners), agentIndex: buildAgentIndex(agents) };
}

/**
 * Partenaire et agent MEMS de chaque formulaire reçu, par combinaison DISTINCTE
 * (fiche, partenaire, agent) : correction manuelle d'abord, sinon correspondance
 * exacte (libellé du choix ou texte saisi). Valeurs brutes jamais modifiées.
 */
/**
 * Après l'ajout, le renommage ou la suppression d'un partenaire ou d'un agent :
 * les formulaires reçus sont reliés à nouveau (sinon l'écran « Correspondances »
 * annonce « trouvé » alors que les soumissions ne sont pas reliées). Le verrou
 * est déjà pris en début de transaction par l'appelant.
 */
async function relinkPartiesTx(client, tenantId) {
  return applySubmissionPartiesTx(client, tenantId);
}

async function applySubmissionPartiesTx(client, tenantId, links) {
  await lockSubmissionLinksTx(client, tenantId);
  const linksMap = links || await loadValueLinksTx(client, tenantId);
  const { partnerIndex, agentIndex } = await loadPartiesTx(client, tenantId);
  const ctx = await choiceContextTx(client, tenantId);
  const pLabels = await choiceLabelsTx(client, tenantId, 'partner', ctx);
  const aLabels = await choiceLabelsTx(client, tenantId, 'agent', ctx);
  const { rows: combos } = await client.query(
    `SELECT form_id AS "formId", COALESCE(partner, '') AS p, COALESCE(agent, '') AS a, count(*)::int AS n
       FROM monitoring_submissions WHERE tenant_id = $1 GROUP BY 1, 2, 3`, [tenantId]);
  const updates = []; let withPartner = 0; let withAgent = 0;
  for (const c of combos) {
    const pm = linksMap.get(linkKey(c.formId, 'partner', c.p));
    const pLabel = pLabels.get(c.formId) && pLabels.get(c.formId).get(c.p);
    const partnerId = pm ? pm.partnerId : (c.p ? (resolvePartner(partnerIndex, { raw: c.p, label: pLabel }).partner || {}).id || null : null);
    const am = linksMap.get(linkKey(c.formId, 'agent', c.a));
    const aLabel = aLabels.get(c.formId) && aLabels.get(c.formId).get(c.a);
    const agentId = am ? am.agentId : (c.a ? (resolveAgent(agentIndex, { raw: c.a, label: aLabel, partnerId }).agent || {}).id || null : null);
    if (partnerId) withPartner += c.n;
    if (agentId) withAgent += c.n;
    updates.push({ ...c, partnerId, agentId });
  }
  for (const slice of chunkRows(updates, 5)) {
    const params = [tenantId];
    const tuples = slice.map((u) => {
      params.push(u.formId, u.p, u.a, u.partnerId, u.agentId);
      const b = params.length - 5;
      return `($${b + 1}::uuid, $${b + 2}, $${b + 3}, $${b + 4}::uuid, $${b + 5}::uuid)`;
    });
    await client.query(
      `UPDATE monitoring_submissions ms SET partner_id = v.pid, agent_id = v.aid
         FROM (VALUES ${tuples.join(',')}) AS v(form_id, p, a, pid, aid)
        WHERE ms.tenant_id = $1 AND ms.form_id = v.form_id AND COALESCE(ms.partner, '') = v.p AND COALESCE(ms.agent, '') = v.a
          AND (ms.partner_id IS DISTINCT FROM v.pid OR ms.agent_id IS DISTINCT FROM v.aid)`,
      params);
  }
  return { withPartner, withAgent };
}

// ---- Sites des formulaires reçus ------------------------------------------------------
/** Référentiel des sites + graphies de sites apprises → index de résolution (common/siteMatch). */
async function loadSiteIndexTx(client, tenantId) {
  const { rows: sites } = await client.query(
    `SELECT id, name, code, location_id AS "locationId", activity,
            adm2_pcode AS "adm2Pcode", adm3_pcode AS "adm3Pcode", adm4_pcode AS "adm4Pcode"
       FROM sites WHERE tenant_id = $1`, [tenantId]);
  const { rows: aliases } = await client.query(
    `SELECT parent_key AS "parentKey", alias_key AS "aliasKey", target_id AS "targetId"
       FROM location_aliases WHERE tenant_id = $1 AND kind = 'site'`, [tenantId]);
  return buildSiteIndex(sites, { aliases });
}

/** Unités du découpage désignées par des pcodes (et leurs préfixes : MIARO suffixe le fokontany d'un n°). */
async function areaLookupTx(client, tenantId, values) {
  const prefixes = new Set();
  for (const v of values) {
    const u = String(v == null ? '' : v).trim().toUpperCase();
    if (!looksLikePcode(u)) continue;
    for (let n = u.length; n >= 4; n -= 1) prefixes.add(u.slice(0, n));
  }
  if (!prefixes.size) return () => null;
  const { rows } = await client.query(
    `SELECT upper(a.pcode) AS pcode, a.name, a.depth, upper(p.pcode) AS "parentPcode"
       FROM admin_areas a LEFT JOIN admin_areas p ON p.id = a.parent_id
      WHERE a.tenant_id = $1 AND upper(a.pcode) = ANY($2::text[])`, [tenantId, [...prefixes]]);
  const m = new Map(rows.map((r) => [r.pcode, r]));
  return (pcode) => m.get(String(pcode).toUpperCase()) || null;
}

/**
 * Rattache chaque formulaire reçu à son SITE du référentiel (retour n° 14) :
 * une résolution par combinaison distincte (fiche, site déclaré, district,
 * commune), dans le périmètre de l'activité de la fiche. Seuls les statuts sûrs
 * posent `site_id` ; le reste va dans la file « À rapprocher » (type « site »,
 * source « soumissions ») avec ses candidats. La valeur brute ne change jamais.
 * @returns {{ submissions, withSite, linked, pending }}
 */
async function applySubmissionSitesTx(client, tenantId) {
  await lockSubmissionLinksTx(client, tenantId);
  const index = await loadSiteIndexTx(client, tenantId);
  const labels = await choiceLabelsTx(client, tenantId, 'site');
  const { rows: combos } = await client.query(
    `SELECT s.form_id AS "formId", COALESCE(s.site, '') AS site, COALESCE(s.admin2, '') AS a2,
            COALESCE(s.adm3_pcode, '') AS p3, f.activity_category AS activity, count(*)::int AS n
       FROM monitoring_submissions s JOIN monitoring_forms f ON f.id = s.form_id AND f.tenant_id = s.tenant_id
      WHERE s.tenant_id = $1 GROUP BY 1, 2, 3, 4, 5`, [tenantId]);
  // Pcodes du site déclaré (fokontany) et de la commune (pour en déduire le district).
  const areaOf = await areaLookupTx(client, tenantId, [...combos.map((c) => c.site), ...combos.map((c) => c.p3)]);
  const updates = []; const pending = new Map();
  let withSite = 0; let linked = 0;
  for (const c of combos) {
    const label = (c.site && labels.get(c.formId) && labels.get(c.formId).get(c.site)) || null;
    // District : le pcode reçu, sinon le parent de la commune reconnue (un nom de district ne sert pas de zone).
    const adm2 = looksLikePcode(c.a2) ? c.a2 : ((c.p3 && areaOf(c.p3) && areaOf(c.p3).parentPcode) || null);
    const q = { value: c.site, label, adm2, adm3: c.p3 || null, activity: c.activity, areaOf };
    const r = resolveSite(index, q);
    const auto = isAutomaticSite(r.status);
    if (c.site) withSite += c.n;
    if (auto) linked += c.n;
    updates.push({ ...c, siteId: auto ? r.site.id : null, status: r.status });
    if (auto || r.status === 'vide') continue;
    const k = queueKeyOf(q);
    if (!k.rawKey) continue; // rien de reconnaissable : pas de ligne dans la file
    const gk = `${k.parentKey}|${k.rawKey}`;
    if (!pending.has(gk)) {
      // Code de fokontany reconnu : on l'affiche avec son nom, dans sa commune (lisible pour décider).
      const rawLabel = r.area && !label ? `${r.area.name} (${c.site})` : k.rawLabel;
      pending.set(gk, {
        depth: null, parentKey: k.parentKey, parentLabel: null, zone: k.parentKey || (r.area && r.area.parentPcode) || null,
        rawKey: k.rawKey, rawLabel: rawLabel.slice(0, 200), count: 0, status: r.status,
        candidates: r.candidates.slice(0, 5).map((x) => ({ id: x.site.id, name: x.site.name, score: Math.round(x.score * 100) / 100, activity: x.site.activity || null })),
      });
    }
    pending.get(gk).count += c.n;
  }
  for (const slice of chunkRows(updates, 6)) {
    const params = [tenantId];
    const tuples = slice.map((u) => {
      params.push(u.formId, u.site, u.a2, u.p3, u.siteId, u.status);
      const b = params.length - 6;
      return `($${b + 1}::uuid, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}::uuid, $${b + 6})`;
    });
    await client.query(
      `UPDATE monitoring_submissions ms SET site_id = v.site_id, site_status = v.status
         FROM (VALUES ${tuples.join(',')}) AS v(form_id, site, a2, p3, site_id, status)
        WHERE ms.tenant_id = $1 AND ms.form_id = v.form_id AND COALESCE(ms.site, '') = v.site
          AND COALESCE(ms.admin2, '') = v.a2 AND COALESCE(ms.adm3_pcode, '') = v.p3
          AND (ms.site_id IS DISTINCT FROM v.site_id OR ms.site_status IS DISTINCT FROM v.status)`,
      params);
  }
  // Nom de la zone (commune ou district) de chaque graphie, pour la file.
  const zones = [...new Set([...pending.values()].map((g) => g.zone).filter(Boolean))];
  if (zones.length) {
    const { rows } = await client.query(
      'SELECT upper(pcode) AS pcode, name FROM admin_areas WHERE tenant_id = $1 AND upper(pcode) = ANY($2::text[])', [tenantId, zones]);
    const names = new Map(rows.map((r) => [r.pcode, r.name]));
    for (const g of pending.values()) g.parentLabel = g.zone ? names.get(g.zone) || g.zone : null;
  }
  await syncQueueTx(client, tenantId, 'soumissions', [...pending.values()], 'site');
  const total = combos.reduce((a, c) => a + c.n, 0);
  return { submissions: total, withSite, linked, pending: pending.size };
}

// ---- File « À rapprocher » et alias (API) ------------------------------------------
async function listQueue(tenantId, { status } = {}) {
  return withTenantTransaction(tenantId, async (client) => {
    const params = [tenantId]; const where = ['q.tenant_id = $1'];
    if (status) { params.push(status); where.push(`q.status = $${params.length}`); } else where.push(`q.status IN ('a_valider', 'ambigu', 'introuvable')`);
    // 500 graphies au plus PAR TYPE (lieux, sites) : un type ne masque jamais l'autre.
    const { rows } = await client.query(
      `SELECT * FROM (
         SELECT q.id, q.kind, q.depth, l.label AS "levelLabel", q.parent_key AS "parentKey", q.parent_label AS "parentLabel",
                q.raw_label AS "rawLabel", q.occurrences, q.candidates, q.status, q.last_seen_at AS "lastSeenAt",
                (SELECT COALESCE(sum(value::int), 0) FROM jsonb_each_text(q.occurrences))::int AS total
           FROM location_match_queue q
           LEFT JOIN admin_levels l ON l.tenant_id = q.tenant_id AND l.depth = q.depth
          WHERE ${where.join(' AND ')}) x
        ORDER BY x.total DESC, x.depth, x."rawLabel"`, params);
    const perKind = new Map();
    const kept = rows.filter((r) => { const n = (perKind.get(r.kind) || 0) + 1; perKind.set(r.kind, n); return n <= 500; });
    rows.length = 0; rows.push(...kept);
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
              a.target_path AS "targetPath", COALESCE(ar.path, st.name) AS "currentPath", a.source, a.created_at AS "createdAt"
         FROM location_aliases a
         LEFT JOIN admin_areas ar ON ar.tenant_id = a.tenant_id AND ar.id = a.target_id AND a.kind = 'zone'
         LEFT JOIN sites st ON st.tenant_id = a.tenant_id AND st.id = a.target_id AND a.kind = 'site'
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
async function decideQueue(tenantId, queueId, { action, areaId, siteId }, actorId) {
  return withSubmissionLinks(tenantId, async (client) => {
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
    if (q.kind === 'site') return linkSiteTx(client, tenantId, q, siteId, actorId);
    if (!areaId) throw badRequest('Choisissez une unité du découpage.');
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
    const applied = { sites: await afterSitesChangedTx(client, tenantId), submissions: await applySubmissionsGeoTx(client, tenantId) };
    return { status: 'resolu', aliasId: alias[0].id, applied };
  });
}

/**
 * Graphie de SITE reliée à la main : alias (même clé que la file : un code vaut
 * pour tout le pays, un nom dans sa commune), graphie résolue, puis rattachement
 * des formulaires rejoué — dans la transaction de la décision.
 */
async function linkSiteTx(client, tenantId, q, siteId, actorId) {
  if (!siteId) throw badRequest('Choisissez un site du référentiel.');
  const { rows: sites } = await client.query('SELECT id, name FROM sites WHERE tenant_id = $1 AND id = $2', [tenantId, siteId]);
  if (!sites.length) throw badRequest('Site inconnu du référentiel.');
  const { rows: alias } = await client.query(
    `INSERT INTO location_aliases (tenant_id, kind, depth, parent_key, alias_key, alias_label, target_id, source, created_by)
     VALUES ($1, 'site', NULL, $2, $3, $4, $5, 'valide', $6)
     ON CONFLICT (tenant_id, kind, COALESCE(depth, 0), parent_key, alias_key) DO UPDATE SET
       target_id = EXCLUDED.target_id, alias_label = EXCLUDED.alias_label, source = 'valide'
     RETURNING id`,
    [tenantId, q.parentKey, q.rawKey, q.rawLabel, siteId, actorId]);
  await client.query(
    `UPDATE location_match_queue SET status = 'resolu', alias_id = $3, decided_by = $4, decided_at = now() WHERE tenant_id = $1 AND id = $2`,
    [tenantId, q.id, alias[0].id, actorId]);
  const applied = { submissionSites: await applySubmissionSitesTx(client, tenantId) };
  return { status: 'resolu', aliasId: alias[0].id, site: sites[0], applied };
}

async function deleteAlias(tenantId, id) {
  return withSubmissionLinks(tenantId, async (client) => {
    // « Oublier » une graphie la remet à valider dans la file (sinon elle resterait « résolue », sans lien).
    await client.query(
      `UPDATE location_match_queue SET status = 'a_valider', alias_id = NULL, decided_by = NULL, decided_at = NULL
        WHERE tenant_id = $1 AND alias_id = $2`, [tenantId, id]);
    const { rowCount } = await client.query('DELETE FROM location_aliases WHERE tenant_id = $1 AND id = $2', [tenantId, id]);
    if (!rowCount) return false;
    await resolvePerimeterTx(client, tenantId);
    await afterSitesChangedTx(client, tenantId);
    await applySubmissionsGeoTx(client, tenantId);
    return true;
  });
}

/** « Rapprocher maintenant » : rejoue le rattachement de toutes les sources. */
async function applyAll(tenantId) {
  return withSubmissionLinks(tenantId, async (client) => {
    await resolvePerimeterTx(client, tenantId);
    return { sites: await afterSitesChangedTx(client, tenantId), submissions: await applySubmissionsGeoTx(client, tenantId) };
  });
}

module.exports = {
  loadPlaceIndexTx, applySitesGeoTx, syncQueueTx, resolvePerimeterTx, attachUnassignedSitesTx, afterSitesChangedTx, applySubmissionsGeoTx,
  officeChoiceLabelsTx, choiceLabelsTx, applySubmissionSitesTx, loadSiteIndexTx,
  loadValueLinksTx, loadPartiesTx, applySubmissionPartiesTx, lockSubmissionLinksTx, withSubmissionLinks, relinkPartiesTx,
  listQueue, listAliases, decideQueue, deleteAlias, applyAll,
};
