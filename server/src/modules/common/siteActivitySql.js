const { periodBounds } = require('./period');

/**
 * Nom du district d'un site : le nom OFFICIEL du découpage (zone de pcode adm2_pcode),
 * sinon adm2, sinon district, sinon « — ». Le regroupement se fait sur lower(…) : les
 * doublons de casse (« AMBOASARY SUD » / « Amboasary Sud », retour 15) n'en font qu'un.
 * `s` = alias de sites, `ad` = alias de la zone jointe par adm2_pcode.
 */
const districtNameSql = (s = 's', ad = 'ad') =>
  `COALESCE(NULLIF(btrim(${ad}.name), ''), NULLIF(btrim(${s}.adm2), ''), NULLIF(btrim(${s}.district), ''), '—')`;

/**
 * SERVICE UNIQUE des faits site × mois (lot 1b, retour n° 47) — constructeur SQL
 * réutilisé par le résumé terrain (field.summary), le récapitulatif de couverture,
 * les données terrain du concepteur (reportFieldData, lot 7a) et la carte (lot 6a).
 * Aucun calcul en double : un écran qui compte des sites actifs / prévus / réalisés
 * sur une période part de ces CTE. Règle pure jumelle : common/siteActivity.js
 * (parité vérifiée par le banc sur le jeu synthétique).
 *
 * Rend le texte « WITH … » (sans SELECT final) qui définit :
 *   reg      une ligne par site du tenant : site_id, office, dkey/dname/official (district :
 *            clé en minuscules, nom affiché, nom officiel du découpage via adm2_pcode),
 *            ckey/cname (commune), activity, risk, forbidden ;
 *   fact     une ligne par site × mois de la période (colonnes étroites, sans les dimensions) :
 *            site_id, m (1er du mois), known (le tenant a
 *            une grille d'activation cette année-là), active, st (statut UNIQUE du site × mois :
 *            realise > planifie > annule, null sans visite), rp/rr/ra (lignes de visites, sens hérité) ;
 *   per_site une ligne par site : active / planned / realised / realised_inactive (sur la période),
 *            sm_* (site × mois par statut), due_* (mois échus ≤ mois courant), upcoming,
 *            realise_active (site × mois réalisés pendant un mois actif), rp/rr/ra.
 *
 * Site actif un mois M : jamais en zone interdite (security_situation ≥ 99, valeur actuelle) ;
 * si le tenant a une grille cette année-là, seul un « Oui » explicite à M ; sinon tout le registre.
 *
 * Garde-fous de plan (estimations faussées par la RLS) : reg matérialisé ; les cases « Oui »
 * de la grille lues UNE fois, en ensemble (st), jointes par égalité ; la série des mois
 * (≤ 60 lignes) est la seule boucle ; les visites sont agrégées avant la jointure.
 * Chaque CTE filtre tenant_id = $1.
 *
 * @param {{ period: {from:string,to:string}, todayMonth: string, office?: 'site'|'bureau',
 *           unattached?: string, district?: string }} opts
 *   office 'site'   : antenne ou bureau propre du site (fo.name, « — » sans bureau) ;
 *          'bureau' : bureau parent (antenne comptée avec son bureau), libellé `unattached` sans bureau.
 *   district        : ne garder que les sites de ce district (même clé que dkey, casse ignorée).
 *
 * Options de la carte (lot 6a) — absentes, le SQL est inchangé :
 *   withData : « réalisé » compte aussi les DONNÉES rattachées au site (définition commune :
 *              au moins une soumission non écartée de CE site ce mois-là, d'une fiche
 *              compatible avec l'activité du site — formSiteCompatibleSql) ; jamais par la
 *              seule commune. Ajoute le CTE dat et, dans fact, wd (données ce mois) et ua
 *              (visite non annulée sans prestataire) ; per_site gagne realised_any (déclaré
 *              OU données, pendant un mois actif), realised_data, et les visites (site × mois)
 *              v_planned, v_planned_realised, v_off_plan (données sans visite prévue),
 *              v_unassigned. Le lot 4 basculera ce mode par défaut partout.
 *   geo      : colonnes de rattachement dans reg et per_site : did / dpcode (district du
 *              découpage, par adm2_pcode), rid (région : parent du district, sinon la zone
 *              du site), cpcode (commune), office_id, has_gps, act (activité normalisée).
 *   officeId : sites du bureau ET de ses antennes (sous-arbre récursif de field_offices).
 *   activity : sites de cette activité (casse et espaces ignorés).
 * @param {any[]} params paramètres de la requête, $1 = tenant déjà présent ; complétés ici.
 */
function siteMonthFactsCtes({
  period, todayMonth, office = 'site', unattached = '(non rattaché)', district,
  withData = false, geo = false, officeId = null, activity = null,
} = {}, params) {
  const { lo, hi, hiExcl } = periodBounds(period);
  const push = (v) => { params.push(v); return `$${params.length}`; };
  const pLo = push(lo); const pHi = push(hi); const pHiExcl = push(hiExcl); const pToday = push(`${todayMonth}-01`);
  const pYlo = push(Number(period.from.slice(0, 4))); const pYhi = push(Number(period.to.slice(0, 4)));
  const officeExpr = office === 'bureau'
    ? `COALESCE(par.name, fo.name, ${push(unattached)}::text)`
    : "COALESCE(fo.name, '—')";
  const parJoin = office === 'bureau' ? 'LEFT JOIN field_offices par ON par.id = fo.parent_id AND par.tenant_id = s.tenant_id' : '';
  const dName = districtNameSql('s', 'ad');
  const districtFilter = district ? ` AND lower(${dName}) = lower(btrim(${push(district)}::text))` : '';
  const ext = withData || geo;
  const officeTree = officeId ? officeTreeSql(push(officeId)) : '';
  const officeFilter = officeId ? ' AND s.field_office_id IN (SELECT id FROM office_tree)' : '';
  const activityFilter = activity ? ` AND lower(btrim(s.activity)) = lower(btrim(${push(activity)}::text))` : '';
  const regExt = ext ? `,
              lower(NULLIF(btrim(s.activity), '')) AS act` : '';
  const regGeo = geo ? `,
              ad.id AS did, ad.pcode AS dpcode,
              COALESCE(ad.parent_id, CASE WHEN aa.depth = 1 THEN aa.id WHEN aa.depth > 1 THEN aa.lineage[1] END) AS rid,
              NULLIF(btrim(s.adm3_pcode), '') AS cpcode, s.field_office_id AS office_id,
              (s.gps_lat IS NOT NULL AND s.gps_lng IS NOT NULL) AS has_gps` : '';
  const geoJoin = geo ? '\n         LEFT JOIN admin_areas aa ON aa.id = s.admin_area_id AND aa.tenant_id = s.tenant_id' : '';
  const datCte = withData ? `
     dat AS (
       SELECT ms.site_id, date_trunc('month', ms.period_month)::date AS m
         FROM monitoring_submissions ms
         JOIN monitoring_forms mf ON mf.id = ms.form_id AND mf.tenant_id = ms.tenant_id
         JOIN reg r ON r.site_id = ms.site_id
        WHERE ms.tenant_id = $1 AND NOT ms.excluded AND ms.site_id IS NOT NULL
          AND ms.period_month >= ${pLo}::date AND ms.period_month < ${pHiExcl}::date
          AND ${formSiteCompatibleSql('mf.activity_category', 'r.act')}
        GROUP BY 1, 2),` : '';
  const visExt = ext ? `,
              bool_or(v.status <> 'annule' AND v.provider_id IS NULL) AS ua` : '';
  const factExt = ext ? `, COALESCE(v.ua, false) AS ua, ${withData ? 'd.site_id IS NOT NULL' : 'false'} AS wd` : '';
  const datJoin = withData ? ' LEFT JOIN dat d ON d.site_id = a.site_id AND d.m = a.m' : '';
  const psExt = ext ? `,
              a.realised_any, a.realised_data, a.v_planned, a.v_planned_realised, a.v_off_plan, a.v_unassigned, r.act` : '';
  const psGeo = geo ? ', r.did, r.dpcode, r.rid, r.cpcode, r.office_id, r.has_gps' : '';
  const aggExt = ext ? `,
                      COALESCE(bool_or(active AND (st = 'realise' OR wd)), false) AS realised_any,
                      COALESCE(bool_or(active AND wd), false) AS realised_data,
                      count(*) FILTER (WHERE active AND st IN ('planifie', 'realise'))::int AS v_planned,
                      count(*) FILTER (WHERE active AND st IN ('planifie', 'realise') AND (st = 'realise' OR wd))::int AS v_planned_realised,
                      count(*) FILTER (WHERE active AND (st IS NULL OR st = 'annule') AND wd)::int AS v_off_plan,
                      count(*) FILTER (WHERE active AND st IN ('planifie', 'realise') AND ua)::int AS v_unassigned` : '';
  // Années où le tenant a une grille : une sonde d'index par année (année en entier, comparée par
  // un opérateur « leakproof » : sous RLS, une expression comme extract() ne peut pas servir de
  // condition d'index et la sonde relisait toute la grille du tenant).
  return `WITH ${officeId ? 'RECURSIVE ' : ''}${officeTree}grid_years AS MATERIALIZED (
       SELECT y, EXISTS (SELECT 1 FROM site_month_status g WHERE g.tenant_id = $1 AND g.year = y) AS known
         FROM generate_series(${pYlo}::int, ${pYhi}::int) AS y),
     months AS (
       SELECT m::date AS m, gy.known
         FROM generate_series(${pLo}::date, ${pHi}::date, interval '1 month') AS m
         JOIN grid_years gy ON gy.y = extract(year FROM m)::int),
     reg AS MATERIALIZED (
       SELECT s.id AS site_id, ${officeExpr} AS office,
              lower(${dName}) AS dkey, ${dName} AS dname, NULLIF(btrim(ad.name), '') AS official,
              lower(COALESCE(NULLIF(btrim(s.adm3_pcode), ''), NULLIF(btrim(s.adm3), ''), NULLIF(btrim(s.commune), ''), '—')) AS ckey,
              COALESCE(NULLIF(btrim(s.adm3), ''), NULLIF(btrim(s.commune), ''), '—') AS cname,
              COALESCE(NULLIF(btrim(s.activity), ''), '—') AS activity, s.risk_level AS risk,
              COALESCE(s.security_situation, 0) >= 99 AS forbidden${regExt}${regGeo}
         FROM sites s
         LEFT JOIN admin_areas ad ON ad.tenant_id = s.tenant_id AND ad.pcode = s.adm2_pcode
         LEFT JOIN field_offices fo ON fo.id = s.field_office_id AND fo.tenant_id = s.tenant_id
         ${parJoin}${geoJoin}
        WHERE s.tenant_id = $1${districtFilter}${officeFilter}${activityFilter}),
     st AS MATERIALIZED (
       SELECT x.site_id, make_date(x.year, x.month, 1) AS m
         FROM site_month_status x
        WHERE x.tenant_id = $1 AND x.active AND x.year BETWEEN ${pYlo} AND ${pYhi}
          AND make_date(x.year, x.month, 1) BETWEEN ${pLo}::date AND ${pHi}::date),
     act AS (
       SELECT r.site_id, mm.m, mm.known, NOT r.forbidden AND (NOT mm.known OR st.site_id IS NOT NULL) AS active
         FROM reg r CROSS JOIN months mm
         LEFT JOIN st ON st.site_id = r.site_id AND st.m = mm.m),
     vis AS (
       SELECT v.site_id, date_trunc('month', v.period_month)::date AS m,
              CASE WHEN bool_or(v.status = 'realise') THEN 'realise'
                   WHEN bool_or(v.status = 'planifie') THEN 'planifie' ELSE 'annule' END AS st,
              count(*) FILTER (WHERE v.status = 'planifie')::int AS rp,
              count(*) FILTER (WHERE v.status = 'realise')::int AS rr,
              count(*) FILTER (WHERE v.status = 'annule')::int AS ra${visExt}
         FROM site_visits v
        WHERE v.tenant_id = $1 AND v.period_month >= ${pLo}::date AND v.period_month < ${pHiExcl}::date
        GROUP BY 1, 2),${datCte}
     fact AS MATERIALIZED (
       SELECT a.*, v.st, COALESCE(v.rp, 0) AS rp, COALESCE(v.rr, 0) AS rr, COALESCE(v.ra, 0) AS ra,
              a.m <= ${pToday}::date AS due${factExt}
         FROM act a LEFT JOIN vis v ON v.site_id = a.site_id AND v.m = a.m${datJoin}),
     per_site AS (
       SELECT r.site_id, r.office, r.dkey, r.dname, r.official, r.ckey, r.cname, r.activity, r.risk,
              a.active, a.planned, a.realised, a.realised_inactive, a.sm_planifie, a.sm_realise, a.sm_annule,
              a.due_planifie, a.due_realise, a.upcoming, a.realise_active, a.rp, a.rr, a.ra${psExt}${psGeo}
         FROM (SELECT site_id,
                      bool_or(active) AS active,
                      COALESCE(bool_or(active AND st IN ('planifie', 'realise')), false) AS planned,
                      COALESCE(bool_or(active AND st = 'realise'), false) AS realised,
                      COALESCE(bool_or(NOT active AND st = 'realise'), false) AS realised_inactive,
                      count(*) FILTER (WHERE st = 'planifie')::int AS sm_planifie,
                      count(*) FILTER (WHERE st = 'realise')::int AS sm_realise,
                      count(*) FILTER (WHERE st = 'annule')::int AS sm_annule,
                      count(*) FILTER (WHERE st = 'planifie' AND due)::int AS due_planifie,
                      count(*) FILTER (WHERE st = 'realise' AND due)::int AS due_realise,
                      count(*) FILTER (WHERE st = 'planifie' AND NOT due)::int AS upcoming,
                      count(*) FILTER (WHERE active AND st = 'realise')::int AS realise_active,
                      sum(rp)::int AS rp, sum(rr)::int AS rr, sum(ra)::int AS ra${aggExt}
                 FROM fact GROUP BY site_id) a
         JOIN reg r ON r.site_id = a.site_id)`;
}

/**
 * Sous-arbre d'un bureau (le bureau et ses antennes, récursif sur field_offices.parent_id),
 * comme CTE « office_tree » (la requête doit commencer par WITH RECURSIVE). UNION (et non
 * UNION ALL) : un cycle de parenté ne boucle jamais.
 */
const officeTreeSql = (pOffice) => `office_tree AS (
       SELECT id FROM field_offices WHERE tenant_id = $1 AND id = ${pOffice}::uuid
       UNION
       SELECT f.id FROM field_offices f JOIN office_tree o ON f.parent_id = o.id WHERE f.tenant_id = $1),
     `;

/**
 * Fiche compatible avec l'activité d'un site — UNE règle (dat, soumissions par zone,
 * « communes avec données ») : catégorie de fiche vide = compatible avec tout, site sans
 * activité = compatible avec tout, sinon égalité casse et espaces ignorés.
 * @param {string} catExpr expression SQL de la catégorie de fiche (texte brut)
 * @param {string} actExpr expression SQL de l'activité du site, DÉJÀ en minuscules et sans espaces de bord
 */
const formSiteCompatibleSql = (catExpr, actExpr) =>
  `(NULLIF(btrim(${catExpr}), '') IS NULL OR ${actExpr} IS NULL OR lower(btrim(${catExpr})) = ${actExpr})`;

/** Colonnes d'agrégat des faits d'un groupe de sites (per_site) — mêmes noms partout. */
const SITE_FACT_COLUMNS = `count(*) FILTER (WHERE active)::int AS "sitesActive",
       count(*) FILTER (WHERE planned)::int AS "sitesPlanned",
       count(*) FILTER (WHERE realised)::int AS "sitesRealised",
       count(*) FILTER (WHERE realised_inactive)::int AS "sitesRealisedInactive",
       COALESCE(sum(sm_planifie), 0)::int AS "smPlanifie", COALESCE(sum(sm_realise), 0)::int AS "smRealise",
       COALESCE(sum(sm_annule), 0)::int AS "smAnnule",
       COALESCE(sum(due_planifie), 0)::int AS "duePlanifie", COALESCE(sum(due_realise), 0)::int AS "dueRealise",
       COALESCE(sum(upcoming), 0)::int AS upcoming,
       COALESCE(sum(rp), 0)::int AS planifie, COALESCE(sum(rr), 0)::int AS realise, COALESCE(sum(ra), 0)::int AS annule`;

/** Mêmes colonnes pour UN mois (lignes de fact d'un mois : une par site). */
const MONTH_FACT_COLUMNS = `count(*) FILTER (WHERE active)::int AS "sitesActive",
       count(*) FILTER (WHERE active AND st IN ('planifie', 'realise'))::int AS "sitesPlanned",
       count(*) FILTER (WHERE active AND st = 'realise')::int AS "sitesRealised",
       count(*) FILTER (WHERE NOT active AND st = 'realise')::int AS "sitesRealisedInactive",
       count(*) FILTER (WHERE st = 'planifie')::int AS "smPlanifie", count(*) FILTER (WHERE st = 'realise')::int AS "smRealise",
       count(*) FILTER (WHERE st = 'annule')::int AS "smAnnule",
       count(*) FILTER (WHERE st = 'planifie' AND due)::int AS "duePlanifie", count(*) FILTER (WHERE st = 'realise' AND due)::int AS "dueRealise",
       count(*) FILTER (WHERE st = 'planifie' AND NOT due)::int AS upcoming,
       COALESCE(sum(rp), 0)::int AS planifie, COALESCE(sum(rr), 0)::int AS realise, COALESCE(sum(ra), 0)::int AS annule`;

module.exports = { siteMonthFactsCtes, districtNameSql, officeTreeSql, formSiteCompatibleSql, SITE_FACT_COLUMNS, MONTH_FACT_COLUMNS };
