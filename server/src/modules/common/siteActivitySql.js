const { periodBounds } = require('./period');

/** Clé normalisée d'un nom (minuscules, lettres et chiffres ASCII) — jumelle de siteDistrict.districtKey. */
const keySql = (expr) => `regexp_replace(lower(COALESCE(${expr}, '')), '[^a-z0-9]+', '', 'g')`;

/**
 * District de chaque site (règle jumelle pure : common/siteDistrict.siteDistricts, parité
 * vérifiée par le banc) — CTE à placer dans un WITH ; rend `sdist(site_id, okey, dkey, dname, official,
 * agrees, rkey, pid)` (okey = clé de la graphie propre du site ; agrees / rkey / pid : accord du P-code,
 * clé de la région du site et zone du P-code, lus par la carte sans rejoindre sd1).
 *  - un site se range dans SA graphie (adm2, sinon district) : jamais dans le district d'une
 *    autre région, même quand son P-code de district (adm2_pcode) y pointe ;
 *  - le P-code n'est cru que s'il est « d'accord » (région de la zone = région du site, graphie
 *    ignorée) ; ces sites apprennent, par graphie et par région, le nom officiel le plus fréquent,
 *    que prennent tous les sites de cette graphie dans cette région (variantes réunies, retour 15) ;
 *  - dkey = nom retenu normalisé (keySql), « — » sans nom ; official = nom du découpage retenu.
 * Chaque CTE filtre tenant_id = $1 (sites, admin_areas).
 */
function siteDistrictCtes() {
  return `sd0 AS MATERIALIZED (
       SELECT s.id AS site_id,
              COALESCE(NULLIF(btrim(s.adm2), ''), NULLIF(btrim(s.district), '')) AS own,
              NULLIF(btrim(ad.name), '') AS pname, ad.id AS pid,
              ${keySql('s.adm1')} AS rkey, ${keySql('r.name')} AS prkey
         FROM sites s
         LEFT JOIN admin_areas ad ON ad.tenant_id = s.tenant_id AND ad.pcode = s.adm2_pcode
         LEFT JOIN admin_areas r ON r.tenant_id = s.tenant_id AND r.id = ad.lineage[1]
        WHERE s.tenant_id = $1),
     sd1 AS MATERIALIZED (
       SELECT site_id, own, pname, pid, rkey, prkey, ${keySql('own')} AS okey,
              (pname IS NOT NULL AND prkey <> '' AND (prkey = rkey OR (rkey = '' AND ${keySql('pname')} = ${keySql('own')}))) AS agrees
         FROM sd0),
     sdvote AS MATERIALIZED (
       SELECT DISTINCT ON (okey, prkey) okey, prkey AS rkey, pname AS official
         FROM (SELECT okey, prkey, pname, count(*) AS n FROM sd1 WHERE agrees AND okey <> '' GROUP BY 1, 2, 3) v
        ORDER BY okey, prkey, n DESC, pname COLLATE "C"),
     sdone AS MATERIALIZED (SELECT okey, min(official) AS official FROM sdvote GROUP BY okey HAVING count(*) = 1),
     sdist AS MATERIALIZED (
       SELECT site_id, okey,
              CASE WHEN ${keySql('name0')} = '' THEN '—' ELSE ${keySql('name0')} END AS dkey,
              CASE WHEN ${keySql('name0')} = '' THEN '—' ELSE name0 END AS dname,
              CASE WHEN ${keySql('name0')} = '' THEN NULL ELSE official END AS official,
              agrees, rkey, pid
         FROM (SELECT d.site_id, d.okey, d.agrees, d.rkey, d.pid,
                      COALESCE(m.official, m1.official, d.own, CASE WHEN d.agrees THEN d.pname END) AS name0,
                      COALESCE(m.official, m1.official, CASE WHEN d.own IS NULL AND d.agrees THEN d.pname END) AS official
                 FROM sd1 d
                 LEFT JOIN sdvote m ON d.rkey <> '' AND d.okey <> '' AND m.okey = d.okey AND m.rkey = d.rkey
                 LEFT JOIN sdone m1 ON d.rkey = '' AND d.okey <> '' AND m1.okey = d.okey) x)`;
}

/** Nom affiché d'un groupe de district (lignes de sdist ou de reg) : officiel, sinon une graphie qui n'est pas toute en capitales. */
const DISTRICT_LABEL_SQL = 'COALESCE(min(official), min(dname) FILTER (WHERE dname <> upper(dname)), min(dname))';

/**
 * Graphie propre d'un site (adm2, sinon district, sinon « — »), sans le découpage — pour un
 * appelant qui ne lit pas sdist ; jamais le nom d'un district d'une autre région.
 */
const districtNameSql = (s = 's') => `COALESCE(NULLIF(btrim(${s}.adm2), ''), NULLIF(btrim(${s}.district), ''), '—')`;

/**
 * SERVICE UNIQUE des faits site × mois (lot 1b, retour n° 47) — constructeur SQL
 * réutilisé par le résumé terrain (field.summary), le récapitulatif de couverture,
 * les données terrain du concepteur (reportFieldData, lot 7a) et la carte (lot 6a).
 * Aucun calcul en double : un écran qui compte des sites actifs / prévus / réalisés
 * sur une période part de ces CTE. Règle pure jumelle : common/siteActivity.js
 * (parité vérifiée par le banc sur le jeu synthétique).
 *
 * Rend le texte « WITH … » (sans SELECT final) qui définit :
 *   reg      une ligne par site du tenant : site_id, office, dkey/dname/official (district,
 *            siteDistrictCtes : clé normalisée, nom retenu, nom officiel quand il est sûr),
 *            ckey/cname (commune), activity, risk, forbidden ;
 *   fact     une ligne par site × mois de la période (colonnes étroites, sans les dimensions) :
 *            site_id, m (1er du mois), known (le tenant a
 *            une grille d'activation cette année-là), active, st (statut UNIQUE du site × mois :
 *            realise > planifie > annule, null sans visite), rp/rr/ra (lignes de visites, sens hérité) ;
 *   per_site une ligne par site : active / planned / realised / realised_inactive (sur la période),
 *            sm_* (site × mois par statut), due_* (mois échus ≤ mois courant), upcoming,
 *            realise_active (site × mois réalisés pendant un mois actif), rp/rr/ra.
 *            Calculé SANS la grille complète site × mois (fact, 120 000 lignes à 10 000 sites
 *            sur 12 mois) : « actif sur la période » se lit par site (zone interdite, année
 *            sans grille, au moins un « Oui » de la période), et les autres colonnes ne
 *            dépendent que des site × mois qui ont une visite (ou des données) — sf, creux.
 *            fact reste défini pour les séries mensuelles ; non référencé, il n'est pas calculé.
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
 *   district        : ne garder que les sites de ce district (nom affiché ou graphie, comparé par la clé dkey).
 *
 * Options de la carte (lot 6a) — absentes, le SQL est inchangé :
 *   withData : « réalisé » compte aussi les DONNÉES rattachées au site (définition commune :
 *              au moins une soumission non écartée de CE site ce mois-là, d'une fiche
 *              compatible avec l'activité du site — formSiteCompatibleSql) ; jamais par la
 *              seule commune. Ajoute le CTE dat et, dans fact, wd (données ce mois) et ua
 *              (visite non annulée sans prestataire) ; per_site gagne realised_any (déclaré
 *              OU données, pendant un mois actif), realised_data, et les visites (site × mois)
 *              v_planned, v_planned_realised (mois ÉCHUS seulement, règle du lot 1b : une
 *              visite prévue d'un mois à venir n'est pas « non exécutée »), v_off_plan
 *              (données sans visite prévue), v_unassigned. Le lot 4 basculera ce mode par
 *              défaut partout. Définitions des tableaux de bord (retour 110,
 *              dashboards/coverageDefinitions) : planned_due (une visite prévue un mois actif
 *              ÉCHU), v_planned_visit / v_planned_data (visites prévues échues suivies par une
 *              visite déclarée / par des données, les deux peuvent se recouvrir), v_upcoming
 *              (visites prévues des mois à venir, jamais « non exécutées ») et forbidden ;
 *              covered_inactive (visite déclarée ou données pendant un mois NON actif — « Non »,
 *              case vide d'une année avec grille ou zone interdite : jamais un suivi, dit à part),
 *              v_cancelled (visites annulées d'un mois actif), v_upcoming_unset (visites prévues
 *              de mois à venir pas encore actifs, ex. grille non renseignée pour la fin d'année).
 *   geo      : colonnes de rattachement dans reg et per_site : did / dpcode (district du
 *              découpage, par adm2_pcode), rid (région : parent du district, sinon la zone
 *              du site), cpcode (commune), office_id, has_gps, act (activité normalisée).
 *   officeId : sites du bureau ET de ses antennes (sous-arbre récursif de field_offices) ;
 *              'unlinked' = sites sans bureau (concepteur, lot 7a).
 *   activity : sites de cette activité (casse et espaces ignorés).
 *   drawable : (tableau d'identifiants) ne garder que les sites DESSINABLES — position GPS du
 *              registre, ou l'un de ces sites (positions déduites de leurs collectes) : la
 *              couche de points de la carte ne calcule pas les faits des 10 000 sites.
 * @param {any[]} params paramètres de la requête, $1 = tenant déjà présent ; complétés ici.
 */
function siteMonthFactsCtes({
  period, todayMonth, office = 'site', unattached = '(non rattaché)', district,
  withData = false, geo = false, officeId = null, activity = null, drawable = null,
} = {}, params) {
  const { lo, hi, hiExcl } = periodBounds(period);
  const push = (v) => { params.push(v); return `$${params.length}`; };
  const pLo = push(lo); const pHi = push(hi); const pHiExcl = push(hiExcl); const pToday = push(`${todayMonth}-01`);
  const pYlo = push(Number(period.from.slice(0, 4))); const pYhi = push(Number(period.to.slice(0, 4)));
  const officeExpr = office === 'bureau'
    ? `COALESCE(par.name, fo.name, ${push(unattached)}::text)`
    : "COALESCE(fo.name, '—')";
  const parJoin = office === 'bureau' ? 'LEFT JOIN field_offices par ON par.id = fo.parent_id AND par.tenant_id = s.tenant_id' : '';
  // District demandé par son nom affiché ou par une graphie du registre (lien ancien) : tout le groupe.
  let districtFilter = '';
  if (district) {
    const k = keySql(`${push(district)}::text`);
    districtFilter = ` AND sd.dkey IN (SELECT x.dkey FROM sdist x WHERE x.dkey = ${k} OR x.okey = ${k})`;
  }
  const ext = withData || geo;
  const unlinked = officeId === 'unlinked';
  const officeTree = officeId && !unlinked ? officeTreeSql(push(officeId)) : '';
  const officeFilter = unlinked ? ' AND s.field_office_id IS NULL'
    : officeId ? ' AND s.field_office_id IN (SELECT id FROM office_tree)' : '';
  const activityFilter = activity ? ` AND lower(btrim(s.activity)) = lower(btrim(${push(activity)}::text))` : '';
  const drawableFilter = Array.isArray(drawable)
    ? ` AND ((s.gps_lat IS NOT NULL AND s.gps_lng IS NOT NULL) OR s.id = ANY(${push(drawable)}::uuid[]))` : '';
  const regExt = ext ? `,
              lower(NULLIF(btrim(s.activity), '')) AS act` : '';
  const regGeo = geo ? `,
              ad.id AS did, ad.pcode AS dpcode,
              COALESCE(ad.parent_id, CASE WHEN aa.depth = 1 THEN aa.id WHEN aa.depth > 1 THEN aa.lineage[1] END) AS rid,
              NULLIF(btrim(s.adm3_pcode), '') AS cpcode, s.field_office_id AS office_id,
              (s.gps_lat IS NOT NULL AND s.gps_lng IS NOT NULL) AS has_gps` : '';
  // Carte : contour du district du SITE, même règle que les tableaux (sdist) — le P-code de
  // district (adm2_pcode) n'est cru que s'il est « d'accord » avec la région du site (ou si le site
  // n'a pas de région) ; sinon, la zone du découpage qui porte le nom retenu (dkey) DANS la région
  // du site. Jamais un site dessiné dans le district d'une autre région.
  const dnaCte = geo ? `
     dna AS MATERIALIZED (
       SELECT DISTINCT ON (k, rk) id, k, rk
         FROM (SELECT a.id, a.pcode, ${keySql('a.name')} AS k, ${keySql('r.name')} AS rk
                 FROM admin_areas a
                 JOIN admin_areas r ON r.tenant_id = a.tenant_id AND r.id = a.lineage[1]
                WHERE a.tenant_id = $1 AND a.depth = 2) x
        ORDER BY k, rk, pcode),` : '';
  // Accord du P-code lu dans sdist (même ligne par site que sd1) : une seconde jointure à sd1,
  // estimée à 13 lignes sous RLS, tournait en boucle imbriquée — 2 560² comparaisons, 0,5 s.
  const geoJoin = geo ? `
         LEFT JOIN dna ON NOT sd.agrees AND sd.rkey <> '' AND dna.k = sd.dkey AND dna.rk = sd.rkey
         LEFT JOIN admin_areas ad ON ad.tenant_id = s.tenant_id
               AND ad.id = CASE WHEN sd.agrees OR sd.rkey = '' THEN sd.pid ELSE dna.id END
         LEFT JOIN admin_areas aa ON aa.id = s.admin_area_id AND aa.tenant_id = s.tenant_id` : '';
  // Données rattachées : d'abord les soumissions de la période (peu nombreuses, index partiel),
  // regroupées par site × fiche × mois et MATÉRIALISÉES, puis seulement le registre — jamais
  // une sonde d'index par site du registre (estimation faussée par la RLS : 80 ms à 10 000 sites).
  const datCte = withData ? `
     datraw AS MATERIALIZED (
       SELECT ms.site_id, ms.form_id, date_trunc('month', ms.period_month)::date AS m
         FROM monitoring_submissions ms
        WHERE ms.tenant_id = $1 AND NOT ms.excluded AND ms.site_id IS NOT NULL
          AND ms.period_month >= ${pLo}::date AND ms.period_month < ${pHiExcl}::date
        GROUP BY 1, 2, 3),
     dat AS (
       SELECT x.site_id, x.m
         FROM datraw x
         JOIN monitoring_forms mf ON mf.id = x.form_id AND mf.tenant_id = $1
         JOIN sites s ON s.id = x.site_id AND s.tenant_id = $1
        WHERE x.site_id IN (SELECT site_id FROM reg)
          AND ${formSiteCompatibleSql('mf.activity_category', "lower(NULLIF(btrim(s.activity), ''))")}
        GROUP BY 1, 2),` : '';
  const visExt = ext ? `,
              bool_or(v.status <> 'annule' AND v.provider_id IS NULL) AS ua` : '';
  const factExt = ext ? `, COALESCE(v.ua, false) AS ua, ${withData ? 'd.site_id IS NOT NULL' : 'false'} AS wd` : '';
  const datJoin = withData ? ' LEFT JOIN dat d ON d.site_id = a.site_id AND d.m = a.m' : '';
  // Site × mois « creux » (visite ou données) : seules lignes qui comptent pour per_site, hors « actif ».
  // Visites et données réunies par FULL JOIN (exécuté par hachage ou fusion, jamais en boucle).
  const evSql = withData
    ? `SELECT COALESCE(v.site_id, d.site_id) AS site_id, COALESCE(v.m, d.m) AS m, v.st, v.rp, v.rr, v.ra,
              COALESCE(v.ua, false) AS ua, d.site_id IS NOT NULL AS wd
         FROM vis v FULL JOIN dat d ON d.site_id = v.site_id AND d.m = v.m`
    : `SELECT v.site_id, v.m, v.st, v.rp, v.rr, v.ra${ext ? ', COALESCE(v.ua, false) AS ua, false AS wd' : ''} FROM vis v`;
  const sfExt = ext ? ', e.ua, e.wd' : '';
  const psExt = ext ? `,
              COALESCE(a.realised_any, false) AS realised_any, COALESCE(a.realised_data, false) AS realised_data,
              COALESCE(a.v_planned, 0) AS v_planned, COALESCE(a.v_planned_realised, 0) AS v_planned_realised,
              COALESCE(a.v_off_plan, 0) AS v_off_plan, COALESCE(a.v_unassigned, 0) AS v_unassigned, r.act,
              COALESCE(a.planned_due, false) AS planned_due, COALESCE(a.v_planned_visit, 0) AS v_planned_visit,
              COALESCE(a.v_planned_data, 0) AS v_planned_data, COALESCE(a.v_upcoming, 0) AS v_upcoming, r.forbidden,
              COALESCE(a.covered_inactive, false) AS covered_inactive, COALESCE(a.v_cancelled, 0) AS v_cancelled,
              COALESCE(a.v_upcoming_unset, 0) AS v_upcoming_unset` : '';
  const psGeo = geo ? ', r.did, r.dpcode, r.rid, r.cpcode, r.office_id, r.has_gps' : '';
  const aggExt = ext ? `,
                      COALESCE(bool_or(active AND (st = 'realise' OR wd)), false) AS realised_any,
                      COALESCE(bool_or(active AND wd), false) AS realised_data,
                      count(*) FILTER (WHERE active AND due AND st IN ('planifie', 'realise'))::int AS v_planned,
                      count(*) FILTER (WHERE active AND due AND st IN ('planifie', 'realise') AND (st = 'realise' OR wd))::int AS v_planned_realised,
                      count(*) FILTER (WHERE active AND (st IS NULL OR st = 'annule') AND wd)::int AS v_off_plan,
                      count(*) FILTER (WHERE active AND st IN ('planifie', 'realise') AND ua)::int AS v_unassigned,
                      COALESCE(bool_or(active AND due AND st IN ('planifie', 'realise')), false) AS planned_due,
                      count(*) FILTER (WHERE active AND due AND st = 'realise')::int AS v_planned_visit,
                      count(*) FILTER (WHERE active AND due AND st IN ('planifie', 'realise') AND wd)::int AS v_planned_data,
                      count(*) FILTER (WHERE active AND NOT due AND st IN ('planifie', 'realise'))::int AS v_upcoming,
                      COALESCE(bool_or(NOT active AND (st = 'realise' OR wd)), false) AS covered_inactive,
                      count(*) FILTER (WHERE active AND st = 'annule')::int AS v_cancelled,
                      count(*) FILTER (WHERE NOT active AND NOT due AND st IN ('planifie', 'realise'))::int AS v_upcoming_unset` : '';
  // Années où le tenant a une grille : une sonde d'index par année (année en entier, comparée par
  // un opérateur « leakproof » : sous RLS, une expression comme extract() ne peut pas servir de
  // condition d'index et la sonde relisait toute la grille du tenant).
  return `WITH ${officeTree ? 'RECURSIVE ' : ''}${officeTree}grid_years AS MATERIALIZED (
       SELECT y, EXISTS (SELECT 1 FROM site_month_status g WHERE g.tenant_id = $1 AND g.year = y) AS known
         FROM generate_series(${pYlo}::int, ${pYhi}::int) AS y),
     months AS (
       SELECT m::date AS m, gy.known
         FROM generate_series(${pLo}::date, ${pHi}::date, interval '1 month') AS m
         JOIN grid_years gy ON gy.y = extract(year FROM m)::int),
     ${siteDistrictCtes()},${dnaCte}
     reg AS MATERIALIZED (
       SELECT s.id AS site_id, ${officeExpr} AS office, sd.dkey, sd.dname, sd.official,
              lower(COALESCE(NULLIF(btrim(s.adm3_pcode), ''), NULLIF(btrim(s.adm3), ''), NULLIF(btrim(s.commune), ''), '—')) AS ckey,
              COALESCE(NULLIF(btrim(s.adm3), ''), NULLIF(btrim(s.commune), ''), '—') AS cname,
              COALESCE(NULLIF(btrim(s.activity), ''), '—') AS activity, s.risk_level AS risk,
              COALESCE(s.security_situation, 0) >= 99 AS forbidden${regExt}${regGeo}
         FROM sites s
         JOIN sdist sd ON sd.site_id = s.id
         LEFT JOIN field_offices fo ON fo.id = s.field_office_id AND fo.tenant_id = s.tenant_id
         ${parJoin}${geoJoin}
        WHERE s.tenant_id = $1${districtFilter}${officeFilter}${activityFilter}${drawableFilter}),
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
     ev AS (
       ${evSql}),
     -- Robustesse du plan : sous RLS, chaque table est estimée à 0,5 % de ses lignes ; une jointure
     -- de deux CTE peut alors tourner en boucle imbriquée (constaté : 10 s avec le filtre activité à
     -- 10 000 sites). Les appartenances (périmètre, site non interdit, « Oui » de la grille, mois sans
     -- grille) sont donc des sous-requêtes IN non corrélées — un ensemble haché, construit une fois
     -- (sf MATÉRIALISÉ : « active » est calculé une fois par ligne, pas recopié dans chaque agrégat).
     sf AS MATERIALIZED (
       SELECT e.site_id,
              e.site_id IN (SELECT site_id FROM reg WHERE NOT forbidden)
                AND (e.m IN (SELECT m FROM months WHERE NOT known) OR (e.site_id, e.m) IN (SELECT site_id, m FROM st)) AS active,
              e.st, COALESCE(e.rp, 0) AS rp, COALESCE(e.rr, 0) AS rr, COALESCE(e.ra, 0) AS ra,
              e.m <= ${pToday}::date AS due${sfExt}
         FROM ev e
        WHERE e.site_id IN (SELECT site_id FROM reg)),
     -- MATÉRIALISÉ : un filtre de l'appelant (« WHERE active », jointure sur site_id) ne peut pas
     -- réduire le FULL JOIN ci-dessous en LEFT JOIN, que les estimations sous RLS exécutaient en
     -- boucle imbriquée (récapitulatif de couverture : 2 560 × 972 lignes comparées, 0,5 s).
     per_site AS MATERIALIZED (
       SELECT r.site_id, r.office, r.dkey, r.dname, r.official, r.ckey, r.cname, r.activity, r.risk,
              NOT r.forbidden AND ((SELECT bool_or(NOT known) FROM months) OR r.site_id IN (SELECT site_id FROM st)) AS active,
              COALESCE(a.planned, false) AS planned, COALESCE(a.realised, false) AS realised,
              COALESCE(a.realised_inactive, false) AS realised_inactive,
              COALESCE(a.sm_planifie, 0) AS sm_planifie, COALESCE(a.sm_realise, 0) AS sm_realise, COALESCE(a.sm_annule, 0) AS sm_annule,
              COALESCE(a.due_planifie, 0) AS due_planifie, COALESCE(a.due_realise, 0) AS due_realise,
              COALESCE(a.upcoming, 0) AS upcoming, COALESCE(a.realise_active, 0) AS realise_active,
              COALESCE(a.rp, 0) AS rp, COALESCE(a.rr, 0) AS rr, COALESCE(a.ra, 0) AS ra${psExt}${psGeo}
         -- FULL JOIN = LEFT JOIN ici (tout site de sf est dans reg) : exécuté par hachage ou fusion,
         -- jamais en boucle imbriquée, quelles que soient les estimations.
         FROM reg r
         FULL JOIN (SELECT site_id,
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
                 FROM sf GROUP BY site_id) a ON a.site_id = r.site_id)`;
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

module.exports = {
  siteMonthFactsCtes, siteDistrictCtes, districtNameSql, keySql, DISTRICT_LABEL_SQL, officeTreeSql, formSiteCompatibleSql,
  SITE_FACT_COLUMNS, MONTH_FACT_COLUMNS,
};
