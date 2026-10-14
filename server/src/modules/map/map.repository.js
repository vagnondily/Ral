const { withTenantTransaction } = require('../../config/db');
const { siteMonthFactsCtes, officeTreeSql } = require('../common/siteActivitySql');
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
       SELECT ms.site_id FROM monitoring_submissions ms
        WHERE ms.tenant_id = $1 AND ms.site_id IS NOT NULL AND NOT ms.excluded AND ms.period_month < ${pHiExcl}::date),
     cdat AS MATERIALIZED (
       SELECT DISTINCT ms.adm3_pcode AS cp, lower(NULLIF(btrim(mf.activity_category), '')) AS cat
         FROM monitoring_submissions ms
         JOIN monitoring_forms mf ON mf.id = ms.form_id AND mf.tenant_id = ms.tenant_id
        WHERE ms.tenant_id = $1 AND NOT ms.excluded AND ms.site_id IS NULL AND ms.adm3_pcode IS NOT NULL
          AND ms.period_month >= ${pLo}::date AND ms.period_month < ${pHiExcl}::date${officeOfSub}),
     ps AS (
       SELECT p.*, e.site_id IS NULL AS never,
              EXISTS (SELECT 1 FROM cdat c WHERE c.cp = p.cpcode AND (c.cat IS NULL OR p.act IS NULL OR c.cat = p.act)) AS commune_data
         FROM per_site p LEFT JOIN ever e ON e.site_id = p.site_id)
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

/** Filtres proposés : bureaux (avec leur bureau parent) et activités du registre (effectifs). */
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

module.exports = {
  SHAPE_SET, MAP_COUNT_COLUMNS,
  districtData, factsByZoneTx, submissionsByZoneTx, areaIndexTx, communeNamesTx, shapeLinksTx, filtersAvailableTx,
};
