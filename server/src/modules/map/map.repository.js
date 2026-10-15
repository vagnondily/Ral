const { withTenantTransaction } = require('../../config/db');
const { siteMonthFactsCtes, officeTreeSql, formSiteCompatibleSql } = require('../common/siteActivitySql');
const { periodBounds } = require('../common/period');
const { currentMonth } = require('../tpm/rbmMath');

/**
 * Carte du suivi (lot 6a) — lectures SQL. Chaque fonction : withTenantTransaction,
 * premier ordre SET LOCAL jit = off (×15 mesuré sur 10 000 sites ; le pool le fait
 * déjà, l'ordre local le garantit même si PG_OPTIONS le réactive), tenant_id = $1
 * sur chaque table, requêtes d'un même client l'une après l'autre (jamais Promise.all).
 *
 * Les faits site × mois viennent du SERVICE UNIQUE common/siteActivitySql
 * (siteMonthFactsCtes, mode withData + geo) : aucun calcul de « actif / prévu /
 * réalisé » en double. La carte ajoute seulement ses regroupements (district, région,
 * bureau, activité, commune) et ses compléments (jamais visités, communes avec
 * données, soumissions par zone).
 */

/** Jeu de contours embarqué (un seul pour l'instant ; lot 6 : contours importés par compte). */
const SHAPE_SET = 'mdg-adm2.v1';

const JIT_OFF = 'SET LOCAL jit = off';

/** Comptes d'un groupe de per_site (mêmes noms que mapThemes.COUNT_KEYS). */
const MAP_COUNT_COLUMNS = `count(*)::int AS sites,
       count(*) FILTER (WHERE active)::int AS active,
       count(*) FILTER (WHERE realised_any)::int AS realised,
       count(*) FILTER (WHERE realised_data)::int AS "realisedData",
       count(*) FILTER (WHERE planned)::int AS planned,
       COALESCE(sum(v_planned), 0)::int AS "visitsPlanned",
       COALESCE(sum(v_planned_realised), 0)::int AS "visitsPlannedRealised",
       COALESCE(sum(v_off_plan), 0)::int AS "visitsOffPlan",
       COALESCE(sum(v_unassigned), 0)::int AS "visitsUnassigned",
       count(*) FILTER (WHERE active AND risk = 'elevee')::int AS "riskHigh",
       count(*) FILTER (WHERE active AND risk = 'moyenne')::int AS "riskMid",
       count(*) FILTER (WHERE active AND risk = 'faible')::int AS "riskLow",
       count(*) FILTER (WHERE active AND risk = 'elevee' AND NOT planned AND NOT realised_any)::int AS "highUntouched",
       count(*) FILTER (WHERE active AND NOT realised_any AND commune_data)::int AS "communeDataOnly",
       count(*) FILTER (WHERE active AND never)::int AS "neverVisited",
       count(*) FILTER (WHERE has_gps)::int AS gps`;

/** Dimension d'une ligne GROUPING SETS ((did, rid), (rid), (office_id), (activity), (cpcode), ()). */
const DIM_SQL = `CASE WHEN GROUPING(did) = 0 THEN 'district' WHEN GROUPING(rid) = 0 THEN 'region'
                   WHEN GROUPING(office_id) = 0 THEN 'office' WHEN GROUPING(activity) = 0 THEN 'activity'
                   WHEN GROUPING(cpcode) = 0 THEN 'commune' ELSE 'total' END AS dim,
              did::text AS did, rid::text AS rid, office_id::text AS office, activity, cpcode`;
const GROUPS = 'GROUPING SETS ((did, rid), (rid), (office_id), (activity), (cpcode), ())';

/**
 * Faits par zone sur la période : une requête (CTE du service unique + regroupements).
 * @returns {Promise<object[]>} lignes { dim, did, rid, office, activity, cpcode, …comptes }
 */
async function factsByZoneTx(client, tenantId, { period, officeId, activity }) {
  const params = [tenantId];
  const ctes = siteMonthFactsCtes({ period, todayMonth: currentMonth(), withData: true, geo: true, officeId, activity }, params);
  const { lo, hiExcl } = periodBounds(period);
  params.push(lo); const pLo = `$${params.length}`;
  params.push(hiExcl); const pHiExcl = `$${params.length}`;
  // Communes avec des données NON rattachées à un site sur la période (indication seulement :
  // une donnée de commune n'est jamais une visite), filtrées comme les sites (bureau).
  const officeOfSub = officeId ? ' AND ms.field_office_id IN (SELECT id FROM office_tree)' : '';
  const { rows } = await client.query(
    `${ctes},
     ever AS MATERIALIZED (
       SELECT v.site_id FROM site_visits v
        WHERE v.tenant_id = $1 AND v.status = 'realise' AND v.period_month < ${pHiExcl}::date
       UNION
       -- Même règle que « réalisée » (dat) : une donnée ne vaut visite que d'une fiche compatible
       -- avec l'activité du site (une fiche « transferts » sur un site cantine ne le visite pas).
       SELECT ms.site_id FROM monitoring_submissions ms
         JOIN monitoring_forms mf ON mf.id = ms.form_id AND mf.tenant_id = ms.tenant_id
         JOIN sites s ON s.id = ms.site_id AND s.tenant_id = ms.tenant_id
        WHERE ms.tenant_id = $1 AND ms.site_id IS NOT NULL AND NOT ms.excluded AND ms.period_month < ${pHiExcl}::date
          AND ${formSiteCompatibleSql('mf.activity_category', "lower(NULLIF(btrim(s.activity), ''))")}),
     cdat AS MATERIALIZED (
       SELECT DISTINCT ms.adm3_pcode AS cp, lower(NULLIF(btrim(mf.activity_category), '')) AS cat
         FROM monitoring_submissions ms
         JOIN monitoring_forms mf ON mf.id = ms.form_id AND mf.tenant_id = ms.tenant_id
        WHERE ms.tenant_id = $1 AND NOT ms.excluded AND ms.site_id IS NULL AND ms.adm3_pcode IS NOT NULL
          AND ms.period_month >= ${pLo}::date AND ms.period_month < ${pHiExcl}::date${officeOfSub}),
     -- Appartenances en sous-requêtes IN hachées (une construction), jamais une jointure ou un
     -- EXISTS corrélé sur une CTE (boucle sur 10 000 sites quand la RLS fausse les estimations).
     ps AS (
       SELECT p.*, NOT (p.site_id IN (SELECT site_id FROM ever)) AS never,
              COALESCE(p.cpcode IN (SELECT cp FROM cdat WHERE cat IS NULL)
                OR (p.act IS NULL AND p.cpcode IN (SELECT cp FROM cdat))
                OR (p.cpcode, p.act) IN (SELECT cp, cat FROM cdat), false) AS commune_data
         FROM per_site p)
     SELECT ${DIM_SQL}, ${MAP_COUNT_COLUMNS},
            (SELECT bool_and(known) FROM months) AS "knownAll", (SELECT bool_or(known) FROM months) AS "knownAny"
       FROM ps
      GROUP BY ${GROUPS}`,
    params
  );
  return rows;
}

/**
 * Soumissions par zone sur la période : agrégées d'abord par clés distinctes (site,
 * commune, bureau, catégorie de fiche), résolues ensuite (une sonde d'index par clé —
 * même parade aux estimations de la RLS que monitoring.regionRowsSql).
 * District d'une soumission : celui du site rattaché, sinon celui de sa commune.
 * Filtre d'activité : soumission rattachée → site de cette activité et fiche compatible ;
 * non rattachée → fiche de cette activité ou sans catégorie (compatible avec tout).
 */
async function submissionsByZoneTx(client, tenantId, { period, officeId, activity }) {
  const params = [tenantId];
  const push = (v) => { params.push(v); return `$${params.length}`; };
  const { lo, hiExcl } = periodBounds(period);
  const pLo = push(lo); const pHiExcl = push(hiExcl);
  const tree = officeId ? officeTreeSql(push(officeId)) : '';
  const conds = [];
  if (officeId) conds.push('COALESCE(sk.fo, g.fo) IN (SELECT id FROM office_tree)');
  if (activity) {
    const a = push(activity);
    conds.push(`CASE WHEN g.site_id IS NOT NULL THEN sk.act = lower(btrim(${a}::text)) AND (g.cat IS NULL OR g.cat = sk.act)
                     ELSE (g.cat IS NULL OR g.cat = lower(btrim(${a}::text))) END`);
  }
  const { rows } = await client.query(
    `WITH ${officeId ? 'RECURSIVE ' : ''}${tree}g AS MATERIALIZED (
       SELECT ms.site_id, ms.adm3_pcode AS pc, ms.field_office_id AS fo,
              lower(NULLIF(btrim(mf.activity_category), '')) AS cat,
              min(NULLIF(btrim(mf.activity_category), '')) AS rawcat, count(*)::int AS n
         FROM monitoring_submissions ms
         JOIN monitoring_forms mf ON mf.id = ms.form_id AND mf.tenant_id = ms.tenant_id
        WHERE ms.tenant_id = $1 AND NOT ms.excluded
          AND ms.period_month >= ${pLo}::date AND ms.period_month < ${pHiExcl}::date
        GROUP BY 1, 2, 3, 4),
     ck AS MATERIALIZED (
       SELECT k.pc, x.did, x.rid
         FROM (SELECT DISTINCT pc FROM g WHERE pc IS NOT NULL) k
         LEFT JOIN LATERAL (
           SELECT CASE WHEN a.depth = 2 THEN a.id WHEN a.depth > 2 THEN a.lineage[2] END AS did,
                  CASE WHEN a.depth = 1 THEN a.id WHEN a.depth > 1 THEN a.lineage[1] END AS rid
             FROM admin_areas a WHERE a.tenant_id = $1 AND a.pcode = k.pc LIMIT 1) x ON true),
     sk AS MATERIALIZED (
       SELECT s.id, ad.id AS did,
              COALESCE(ad.parent_id, CASE WHEN aa.depth = 1 THEN aa.id WHEN aa.depth > 1 THEN aa.lineage[1] END) AS rid,
              s.field_office_id AS fo, NULLIF(btrim(s.adm3_pcode), '') AS cpc,
              lower(NULLIF(btrim(s.activity), '')) AS act, COALESCE(NULLIF(btrim(s.activity), ''), '—') AS activity
         FROM sites s
         LEFT JOIN admin_areas ad ON ad.tenant_id = s.tenant_id AND ad.pcode = s.adm2_pcode
         LEFT JOIN admin_areas aa ON aa.id = s.admin_area_id AND aa.tenant_id = s.tenant_id
        WHERE s.tenant_id = $1 AND s.id IN (SELECT site_id FROM g WHERE site_id IS NOT NULL)),
     sub AS (
       SELECT g.n, g.site_id IS NOT NULL AS at_site,
              COALESCE(sk.did, ck.did) AS did, COALESCE(sk.rid, ck.rid) AS rid,
              COALESCE(sk.fo, g.fo) AS office_id, COALESCE(sk.cpc, g.pc) AS cpcode,
              COALESCE(sk.activity, g.rawcat, '—') AS activity
         FROM g LEFT JOIN sk ON sk.id = g.site_id LEFT JOIN ck ON ck.pc = g.pc
        ${conds.length ? `WHERE ${conds.join(' AND ')}` : ''})
     SELECT ${DIM_SQL}, COALESCE(sum(n), 0)::int AS submissions, COALESCE(sum(n) FILTER (WHERE at_site), 0)::int AS "submissionsSite"
       FROM sub
      GROUP BY ${GROUPS}`,
    params
  );
  return rows;
}

/** Districts (profondeur 2) et régions du découpage du compte : noms, P-codes, région. */
async function areaIndexTx(client, tenantId) {
  const { rows: districts } = await client.query(
    `SELECT d.id, d.pcode, d.name, r.id AS "regionId", r.pcode AS "regionPcode", r.name AS region
       FROM admin_areas d
       LEFT JOIN admin_areas r ON r.id = d.parent_id AND r.tenant_id = $1
      WHERE d.tenant_id = $1 AND d.depth = 2
      ORDER BY d.name`,
    [tenantId]
  );
  const { rows: regions } = await client.query(
    'SELECT id, pcode, name FROM admin_areas WHERE tenant_id = $1 AND depth = 1 ORDER BY name',
    [tenantId]
  );
  return { districts, regions };
}

/** Noms des communes (P-codes donnés) avec district et région. */
async function communeNamesTx(client, tenantId, pcodes) {
  if (!pcodes.length) return [];
  const { rows } = await client.query(
    `SELECT c.pcode, c.name, d.name AS district, r.name AS region
       FROM admin_areas c
       LEFT JOIN admin_areas d ON d.id = c.lineage[2] AND d.tenant_id = $1
       LEFT JOIN admin_areas r ON r.id = c.lineage[1] AND r.tenant_id = $1
      WHERE c.tenant_id = $1 AND c.pcode = ANY($2::text[])`,
    [tenantId, pcodes]
  );
  return rows;
}

/** Corrections manuelles district → contour du compte (map_shape_links). */
async function shapeLinksTx(client, tenantId, shapeSet = SHAPE_SET) {
  const { rows } = await client.query(
    `SELECT area_pcode AS pcode, shape_key AS "shapeKey", updated_at AS "updatedAt"
       FROM map_shape_links WHERE tenant_id = $1 AND shape_set = $2`,
    [tenantId, shapeSet]
  );
  return rows;
}

/** Filtres proposés : bureaux (avec leur bureau parent ; ordre de l'arbre : mapResponse.officeTree) et activités du registre (effectifs). */
async function filtersAvailableTx(client, tenantId) {
  const { rows: offices } = await client.query(
    `SELECT f.id, f.name, f.code, f.parent_id AS "parentId", p.name AS "parentName"
       FROM field_offices f LEFT JOIN field_offices p ON p.id = f.parent_id AND p.tenant_id = $1
      WHERE f.tenant_id = $1
      ORDER BY COALESCE(p.name, f.name), f.parent_id IS NOT NULL, f.name`,
    [tenantId]
  );
  const { rows: activities } = await client.query(
    `SELECT btrim(activity) AS value, count(*)::int AS sites
       FROM sites WHERE tenant_id = $1 AND NULLIF(btrim(activity), '') IS NOT NULL
      GROUP BY 1 ORDER BY 2 DESC, 1`,
    [tenantId]
  );
  return { offices, activities };
}

/**
 * Toutes les lectures de GET /api/map/districts, dans UNE transaction, l'une après l'autre.
 * @param {string} tenantId
 * @param {{ period:{from:string,to:string}, officeId?:string|null, activity?:string|null }} opts
 */
async function districtData(tenantId, { period, officeId = null, activity = null }) {
  return withTenantTransaction(tenantId, async (client) => {
    await client.query(JIT_OFF);
    const facts = await factsByZoneTx(client, tenantId, { period, officeId, activity });
    const subs = await submissionsByZoneTx(client, tenantId, { period, officeId, activity });
    const areas = await areaIndexTx(client, tenantId);
    const cps = [...new Set([...facts, ...subs].filter((r) => r.dim === 'commune' && r.cpcode).map((r) => r.cpcode))];
    const communes = await communeNamesTx(client, tenantId, cps);
    const links = await shapeLinksTx(client, tenantId);
    const filters = await filtersAvailableTx(client, tenantId);
    return { facts, subs, areas, communes, links, filters };
  });
}

/** Plafond de la couche « sites » dessinés un par un (au-delà : liste tronquée, signalée à l'écran). */
const SITES_CAP = 3000;

/**
 * Statut de période des sites DESSINABLES du périmètre (mêmes faits que la carte) : sites
 * avec position GPS du registre, et sites candidats à une position déduite de leurs collectes
 * (`candidateIds`, en premier). Les faits ne sont calculés QUE pour ces sites (option
 * `drawable` du service unique), jamais pour tout le registre. Statut sur UN mois : réalisé >
 * hors plan > prévu > non prévu > inactif ; sur plusieurs mois l'écran lit aussi l'exécution.
 */
async function siteStatusesTx(client, tenantId, { period, officeId, activity, candidateIds = [] }) {
  const params = [tenantId];
  const ctes = siteMonthFactsCtes({ period, todayMonth: currentMonth(), withData: true, geo: true, officeId, activity, drawable: candidateIds }, params);
  params.push(SITES_CAP + 1);
  const cap = `$${params.length}`;
  const { rows } = await client.query(
    `${ctes}
     SELECT p.site_id AS id, s.name, s.code, s.location_id AS "locationId", p.risk, p.dpcode AS "districtPcode", p.cpcode,
            NULLIF(btrim(s.activity), '') AS activity,
            s.gps_lat::float8 AS lat, s.gps_lng::float8 AS lng, p.has_gps AS "hasGps",
            CASE WHEN NOT p.active THEN 'inactif' WHEN p.realised_any AND p.planned THEN 'realise'
                 WHEN p.realised_any THEN 'hors_plan' WHEN p.planned THEN 'prevu' ELSE 'non_prevu' END AS status,
            p.v_planned AS "visitsPlanned", p.v_planned_realised AS "visitsPlannedRealised", p.realised_data AS "byData"
       FROM per_site p JOIN sites s ON s.id = p.site_id AND s.tenant_id = $1
      ORDER BY p.has_gps, s.name, p.site_id
      LIMIT ${cap}`,
    params
  );
  return rows;
}

/** Filtres de périmètre d'une requête sur `sites s` (bureau et ses antennes, activité) — mêmes règles que les faits. */
function perimeterSql(params, { officeId, activity }) {
  const push = (v) => { params.push(v); return `$${params.length}`; };
  const tree = officeId ? officeTreeSql(push(officeId)) : '';
  const where = `${officeId ? ' AND s.field_office_id IN (SELECT id FROM office_tree)' : ''}${activity ? ` AND lower(btrim(s.activity)) = lower(btrim(${push(activity)}::text))` : ''}`;
  return { head: officeId ? `WITH RECURSIVE ${tree}` : 'WITH ', where };
}

/**
 * Périmètre COMPLET de la couche de points (registre seul, sans faits) : nombre de sites,
 * dont avec GPS, et, par commune ayant un centre de collectes possible (`communeKeys`),
 * les sites SANS position (ni GPS du registre, ni candidats à une position déduite —
 * `candidateIds`, rendus un par un) : effectif et les 10 premiers noms. Aucune troncature :
 * les comptes de la carte valent pour tout le périmètre, même au-delà de SITES_CAP.
 */
async function perimeterCountsTx(client, tenantId, { officeId, activity, candidateIds = [], communeKeys = [] }) {
  const params = [tenantId];
  const { head, where } = perimeterSql(params, { officeId, activity });
  const { rows: [totals] } = await client.query(
    `${head}x AS (SELECT 1)
     SELECT count(*)::int AS perimeter, count(*) FILTER (WHERE s.gps_lat IS NOT NULL AND s.gps_lng IS NOT NULL)::int AS gps
       FROM sites s WHERE s.tenant_id = $1${where}`,
    params
  );
  const tot = totals || { perimeter: 0, gps: 0 };
  if (!communeKeys.length) return { totals: tot, communes: [] };
  const cp = [tenantId];
  const p2 = perimeterSql(cp, { officeId, activity });
  cp.push(communeKeys); const pKeys = `$${cp.length}`;
  cp.push(candidateIds); const pCand = `$${cp.length}`;
  const { rows: communes } = await client.query(
    `${p2.head}x AS (SELECT 1)
     SELECT NULLIF(btrim(s.adm3_pcode), '') AS cpcode, count(*)::int AS n,
            to_json((array_agg(json_build_object('id', s.id, 'name', s.name) ORDER BY s.name, s.id))[1:10]) AS sites
       FROM sites s
      WHERE s.tenant_id = $1${p2.where}
        AND NULLIF(btrim(s.adm3_pcode), '') = ANY(${pKeys}::text[])
        AND NOT (s.gps_lat IS NOT NULL AND s.gps_lng IS NOT NULL)
        AND NOT (s.id = ANY(${pCand}::uuid[]))
      GROUP BY 1`,
    cp
  );
  return { totals: tot, communes };
}

/**
 * Médianes des positions GPS des soumissions (tout l'historique : une position est
 * une propriété du lieu, pas de la période), par site rattaché ou par commune, avec la
 * dispersion médiane et p90 (km, formule équirectangulaire de geoStats.distanceKm).
 * Seuls les points de précision connue ≤ maxAccuracyM (ou inconnue) comptent.
 * @param {'site'|'commune'} by
 */
async function gpsMediansTx(client, tenantId, by, { maxAccuracyM }) {
  const key = by === 'site' ? 'ms.site_id' : 'ms.adm3_pcode';
  const { rows } = await client.query(
    `WITH pts AS MATERIALIZED (
       SELECT ${key} AS k, ms.gps_lat::float8 AS lat, ms.gps_lng::float8 AS lng
         FROM monitoring_submissions ms
        WHERE ms.tenant_id = $1 AND NOT ms.excluded AND ms.gps_lat IS NOT NULL AND ${key} IS NOT NULL
          AND COALESCE(ms.gps_accuracy_m, 0) <= $2),
     med AS (
       SELECT k, count(*)::int AS n,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY lat) AS lat,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY lng) AS lng
         FROM pts GROUP BY k),
     disp AS (
       SELECT p.k,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY d.km) AS spread,
              percentile_cont(0.9) WITHIN GROUP (ORDER BY d.km) AS p90
         FROM pts p JOIN med m ON m.k = p.k
         CROSS JOIN LATERAL (SELECT 6371 * sqrt(power(radians(p.lat - m.lat), 2)
                + power(radians(p.lng - m.lng) * cos(radians((p.lat + m.lat) / 2)), 2)) AS km) d
        GROUP BY p.k)
     SELECT m.k::text AS key, m.n, m.lat, m.lng, d.spread AS "spreadKm", d.p90 AS "p90Km"
       FROM med m JOIN disp d ON d.k = m.k`,
    [tenantId, maxAccuracyM]
  );
  return rows;
}

/**
 * Points de collecte de la PÉRIODE (positions de ménages) : au plus `limit` points
 * précis (les plus récents), sinon — ou si `precise` est faux — un carroyage de 2 km
 * avec effectifs. Filtre bureau : bureau du site rattaché, sinon de la soumission.
 */
async function collectPointsTx(client, tenantId, { period, officeId, maxAccuracyM, limit, precise }) {
  const params = [tenantId];
  const push = (v) => { params.push(v); return `$${params.length}`; };
  const { lo, hiExcl } = periodBounds(period);
  const pLo = push(lo); const pHiExcl = push(hiExcl); const pAcc = push(maxAccuracyM);
  const tree = officeId ? officeTreeSql(push(officeId)) : '';
  const officeCond = officeId ? ' AND COALESCE(s.field_office_id, ms.field_office_id) IN (SELECT id FROM office_tree)' : '';
  const base = `FROM monitoring_submissions ms
         LEFT JOIN sites s ON s.id = ms.site_id AND s.tenant_id = ms.tenant_id
        WHERE ms.tenant_id = $1 AND NOT ms.excluded AND ms.gps_lat IS NOT NULL${officeCond}`;
  const inPeriod = ` AND ms.period_month >= ${pLo}::date AND ms.period_month < ${pHiExcl}::date AND COALESCE(ms.gps_accuracy_m, 0) <= ${pAcc}`;
  const head = `WITH ${officeId ? 'RECURSIVE ' : ''}${tree}`;
  const { rows: statRows } = await client.query(
    `${head}x AS (SELECT 1) SELECT
       (SELECT count(*)::int ${base}${inPeriod}) AS total,
       (SELECT count(*)::int ${base} AND ms.gps_accuracy_m > ${pAcc} AND ms.period_month >= ${pLo}::date AND ms.period_month < ${pHiExcl}::date) AS rejected,
       (SELECT to_char(max(ms.period_month), 'YYYY-MM') ${base} AND COALESCE(ms.gps_accuracy_m, 0) <= ${pAcc}) AS "lastMonth"`,
    params
  );
  const stats = statRows[0] || { total: 0, rejected: 0, lastMonth: null };
  if (precise && stats.total <= limit) {
    const pl = push(limit);
    const { rows } = await client.query(
      `${head}x AS (SELECT 1)
       SELECT ms.gps_lat::float8 AS lat, ms.gps_lng::float8 AS lng, to_char(ms.period_month, 'YYYY-MM') AS month,
              mf.label AS form, ms.site_id AS "siteId"
         ${base.replace('FROM monitoring_submissions ms', 'FROM monitoring_submissions ms JOIN monitoring_forms mf ON mf.id = ms.form_id AND mf.tenant_id = ms.tenant_id')}${inPeriod}
        ORDER BY ms.period_month DESC, ms.id
        LIMIT ${pl}`,
      params
    );
    return { mode: 'points', points: rows, total: stats.total, rejected: stats.rejected, lastMonth: stats.lastMonth };
  }
  const { rows } = await client.query(
    `${head}x AS (SELECT 1)
     SELECT round(round(ms.gps_lat / 0.02) * 0.02, 2)::float8 AS lat, round(round(ms.gps_lng / 0.02) * 0.02, 2)::float8 AS lng, count(*)::int AS n
       ${base}${inPeriod}
      GROUP BY 1, 2 ORDER BY 3 DESC`,
    params
  );
  return { mode: 'bins', bins: rows, total: stats.total, rejected: stats.rejected, lastMonth: stats.lastMonth };
}

/**
 * Toutes les lectures de GET /api/map/points (une transaction, requêtes l'une après l'autre) :
 * médianes par site et par commune (tout l'historique), statuts des seuls sites dessinables
 * (GPS du registre + candidats à une position déduite), comptes du périmètre COMPLET
 * (sites sans position par commune), points de collecte de la période.
 */
async function pointsData(tenantId, { period, officeId = null, activity = null, layers, limit, precise, maxAccuracyM }) {
  return withTenantTransaction(tenantId, async (client) => {
    await client.query(JIT_OFF);
    const bySite = layers.includes('derived') ? await gpsMediansTx(client, tenantId, 'site', { maxAccuracyM }) : [];
    const byCommune = layers.includes('communes') ? await gpsMediansTx(client, tenantId, 'commune', { maxAccuracyM }) : [];
    const candidateIds = bySite.map((m) => m.key);
    const sites = await siteStatusesTx(client, tenantId, { period, officeId, activity, candidateIds });
    const perimeter = await perimeterCountsTx(client, tenantId, { officeId, activity, candidateIds, communeKeys: byCommune.map((c) => c.key) });
    const communes = await communeNamesTx(client, tenantId, byCommune.map((c) => c.key));
    const collect = layers.includes('collect') ? await collectPointsTx(client, tenantId, { period, officeId, maxAccuracyM, limit, precise }) : null;
    return { sites, sitesCap: SITES_CAP, perimeter: perimeter.totals, communeSites: perimeter.communes, bySite, byCommune, communes, collect };
  });
}

/** Échappe les métacaractères de LIKE (\, %, _) — ESCAPE '\'. */
const likeEscape = (s) => String(s).replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Recherche : districts et communes par début de nom (une requête par profondeur, pour
 * l'index (tenant_id, depth, lower(name) text_pattern_ops)) ou par P-code ; sites par
 * nom, code ou identifiant de lieu. 20 résultats au plus.
 */
async function search(tenantId, q) {
  return withTenantTransaction(tenantId, async (client) => {
    await client.query(JIT_OFF);
    const prefix = `${likeEscape(q.toLowerCase())}%`;
    const out = [];
    for (const depth of [2, 3]) {
      const { rows } = await client.query(
        `SELECT a.pcode, a.name, a.depth, d.pcode AS "districtPcode", d.name AS district, r.name AS region
           FROM admin_areas a
           LEFT JOIN admin_areas d ON d.id = a.lineage[2] AND d.tenant_id = $1
           LEFT JOIN admin_areas r ON r.id = a.lineage[1] AND r.tenant_id = $1
          WHERE a.tenant_id = $1 AND a.depth = $2 AND (lower(a.name) LIKE $3 ESCAPE '\\' OR lower(a.pcode) = lower($4))
          ORDER BY a.name LIMIT 10`,
        [tenantId, depth, prefix, q]
      );
      for (const r of rows) {
        out.push({ kind: depth === 2 ? 'district' : 'commune', pcode: r.pcode, name: r.name,
          districtPcode: depth === 2 ? r.pcode : r.districtPcode, district: depth === 2 ? null : r.district, region: r.region });
      }
    }
    const { rows: sites } = await client.query(
      `SELECT s.id, s.name, s.code, s.location_id AS "locationId", s.adm2_pcode AS "districtPcode",
              COALESCE(NULLIF(btrim(s.adm3), ''), s.commune) AS commune,
              s.gps_lat::float8 AS lat, s.gps_lng::float8 AS lng
         FROM sites s
        WHERE s.tenant_id = $1
          AND (lower(s.name) LIKE '%' || $2 ESCAPE '\\' OR upper(s.code) = upper($3) OR upper(s.location_id) = upper($3))
        ORDER BY (lower(s.name) LIKE $4 ESCAPE '\\') DESC, s.name LIMIT 10`,
      [tenantId, prefix, q, prefix]
    );
    for (const s of sites) out.push({ kind: 'site', ...s });
    return out.slice(0, 20);
  });
}

// ---- Corrections district → contour (Paramétrage › Localités › Contours de la carte) ----

/** Districts du découpage du compte, avec leur nombre de sites, et les corrections enregistrées. */
async function shapeLinkData(tenantId) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows: districts } = await client.query(
      `SELECT d.pcode, d.name, r.name AS region, COALESCE(sc.n, 0)::int AS sites,
              (d.lat IS NOT NULL AND d.lng IS NOT NULL) AS "hasCentre"
         FROM admin_areas d
         LEFT JOIN admin_areas r ON r.id = d.parent_id AND r.tenant_id = $1
         LEFT JOIN (SELECT adm2_pcode, count(*)::int AS n FROM sites WHERE tenant_id = $1 AND adm2_pcode IS NOT NULL GROUP BY 1) sc
                ON sc.adm2_pcode = d.pcode
        WHERE d.tenant_id = $1 AND d.depth = 2 AND d.pcode IS NOT NULL
        ORDER BY r.name NULLS LAST, d.name`,
      [tenantId]
    );
    const links = await shapeLinksTx(client, tenantId);
    return { districts, links };
  });
}

/** District (profondeur 2) du compte portant ce P-code ? */
async function districtExistsTx(client, tenantId, pcode) {
  const { rowCount } = await client.query(
    'SELECT 1 FROM admin_areas WHERE tenant_id = $1 AND depth = 2 AND pcode = $2', [tenantId, pcode]);
  return rowCount > 0;
}

/**
 * Correction manuelle (upsert) : shapeKey = clé d'un contour, ou null = « ne pas dessiner ».
 * @returns {Promise<boolean>} false si le P-code n'est pas un district du compte
 */
async function upsertShapeLink(tenantId, userId, pcode, shapeKey, shapeSet = SHAPE_SET) {
  return withTenantTransaction(tenantId, async (client) => {
    if (!(await districtExistsTx(client, tenantId, pcode))) return false;
    await client.query(
      `INSERT INTO map_shape_links (tenant_id, shape_set, area_pcode, shape_key, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (tenant_id, shape_set, area_pcode)
       DO UPDATE SET shape_key = EXCLUDED.shape_key, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [tenantId, shapeSet, pcode, shapeKey, userId || null]
    );
    return true;
  });
}

/** Retour au rapprochement automatique. @returns {Promise<boolean>} false si le P-code n'est pas un district du compte */
async function deleteShapeLink(tenantId, pcode, shapeSet = SHAPE_SET) {
  return withTenantTransaction(tenantId, async (client) => {
    if (!(await districtExistsTx(client, tenantId, pcode))) return false;
    await client.query('DELETE FROM map_shape_links WHERE tenant_id = $1 AND shape_set = $2 AND area_pcode = $3', [tenantId, shapeSet, pcode]);
    return true;
  });
}

/**
 * Centres des districts (admin_areas.lat / lng, vides aujourd'hui) remplis depuis le point
 * d'étiquette de leur contour — UNE requête multi-lignes ; seules les valeurs vides sont
 * écrites (jamais une saisie existante). Le plan de suivi place alors les sites rattachés
 * à un district (repli « centre du district »).
 * @param {{pcode:string, lat:number, lng:number}[]} centres
 * @returns {Promise<number>} lignes mises à jour
 */
async function fillDistrictCentres(tenantId, centres) {
  if (!centres.length) return 0;
  return withTenantTransaction(tenantId, async (client) => {
    const { rowCount } = await client.query(
      `UPDATE admin_areas a SET lat = v.lat, lng = v.lng
         FROM unnest($2::text[], $3::numeric[], $4::numeric[]) AS v(pcode, lat, lng)
        WHERE a.tenant_id = $1 AND a.depth = 2 AND a.pcode = v.pcode AND a.lat IS NULL AND a.lng IS NULL`,
      [tenantId, centres.map((c) => c.pcode), centres.map((c) => c.lat), centres.map((c) => c.lng)]
    );
    return rowCount;
  });
}

module.exports = {
  SHAPE_SET, MAP_COUNT_COLUMNS, SITES_CAP,
  shapeLinkData, upsertShapeLink, deleteShapeLink, fillDistrictCentres,
  districtData, factsByZoneTx, submissionsByZoneTx, areaIndexTx, communeNamesTx, shapeLinksTx, filtersAvailableTx,
  pointsData, siteStatusesTx, perimeterCountsTx, gpsMediansTx, collectPointsTx, search, likeEscape,
};
