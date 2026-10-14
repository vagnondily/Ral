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
 *   officeId        : ne garder que les sites de ce bureau MEMS ET de ses antennes (lot 7a) ;
 *                     'unlinked' = sites sans bureau.
 *   activity        : ne garder que les sites de cette catégorie d'activité (casse ignorée, lot 7a).
 * @param {any[]} params paramètres de la requête, $1 = tenant déjà présent ; complétés ici.
 */
function siteMonthFactsCtes({ period, todayMonth, office = 'site', unattached = '(non rattaché)', district, officeId, activity } = {}, params) {
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
  let scopeFilter = '';
  if (officeId === 'unlinked') scopeFilter += ' AND s.field_office_id IS NULL';
  else if (officeId) { const o = push(officeId); scopeFilter += ` AND (s.field_office_id = ${o}::uuid OR fo.parent_id = ${o}::uuid)`; }
  if (activity) scopeFilter += ` AND lower(btrim(s.activity)) = lower(btrim(${push(activity)}::text))`;
  // Années où le tenant a une grille : une sonde d'index par année (année en entier, comparée par
  // un opérateur « leakproof » : sous RLS, une expression comme extract() ne peut pas servir de
  // condition d'index et la sonde relisait toute la grille du tenant).
  return `WITH grid_years AS MATERIALIZED (
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
              COALESCE(s.security_situation, 0) >= 99 AS forbidden
         FROM sites s
         LEFT JOIN admin_areas ad ON ad.tenant_id = s.tenant_id AND ad.pcode = s.adm2_pcode
         LEFT JOIN field_offices fo ON fo.id = s.field_office_id AND fo.tenant_id = s.tenant_id
         ${parJoin}
        WHERE s.tenant_id = $1${districtFilter}${scopeFilter}),
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
              count(*) FILTER (WHERE v.status = 'annule')::int AS ra
         FROM site_visits v
        WHERE v.tenant_id = $1 AND v.period_month >= ${pLo}::date AND v.period_month < ${pHiExcl}::date
        GROUP BY 1, 2),
     fact AS MATERIALIZED (
       SELECT a.*, v.st, COALESCE(v.rp, 0) AS rp, COALESCE(v.rr, 0) AS rr, COALESCE(v.ra, 0) AS ra,
              a.m <= ${pToday}::date AS due
         FROM act a LEFT JOIN vis v ON v.site_id = a.site_id AND v.m = a.m),
     per_site AS (
       SELECT r.site_id, r.office, r.dkey, r.dname, r.official, r.ckey, r.cname, r.activity, r.risk,
              a.active, a.planned, a.realised, a.realised_inactive, a.sm_planifie, a.sm_realise, a.sm_annule,
              a.due_planifie, a.due_realise, a.upcoming, a.realise_active, a.rp, a.rr, a.ra
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
                      sum(rp)::int AS rp, sum(rr)::int AS rr, sum(ra)::int AS ra
                 FROM fact GROUP BY site_id) a
         JOIN reg r ON r.site_id = a.site_id)`;
}

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

module.exports = { siteMonthFactsCtes, districtNameSql, SITE_FACT_COLUMNS, MONTH_FACT_COLUMNS };
