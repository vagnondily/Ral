const { withTenantTransaction } = require('../../config/db');
const { siteMonthFactsCtes, activityKeySql, DISTRICT_LABEL_SQL } = require('../common/siteActivitySql');
const { periodBounds } = require('../common/period');
const { currentMonth } = require('../tpm/rbmMath');
const { rbmSitesTx } = require('../tpm/field.repository');

/**
 * Faits de couverture d'une période (retour 110) — lecture seule, UNE transaction
 * (withTenantTransaction : tenant_id = $1 sur chaque table, RLS active), requêtes l'une après
 * l'autre sur le même client.
 *
 * 1. État RBM au mois de référence (dernier mois de la période) : les MÊMES lignes que
 *    /rbm/sites et /rbm/counts (field.repository.rbmSitesTx) ; seuls les identifiants des sites
 *    « à suivre » sont gardés.
 * 2. UNE requête sur le service unique des faits site × mois (siteMonthFactsCtes, mode
 *    « données ») : univers, suivis (visite déclarée OU données rattachées), sites et visites
 *    prévus, visites à venir, sites actifs au mois de référence (et parmi eux les « à suivre »),
 *    communes de l'univers avec et sans données ; regroupée en GROUPING SETS (total, activité,
 *    bureau, district). Aucune règle « actif / prévu / réalisé » n'est réécrite ici.
 * La mise en forme et la concordance sont dans coverageDefinitions (pur, testé).
 */

/** Une sonde par appel ; `SET LOCAL jit = off` comme la carte (requête analytique courte). */
const JIT_OFF = 'SET LOCAL jit = off';

/**
 * Bureau d'une soumission de commune (cdat) : les MÊMES trois cas que le périmètre des sites
 * (siteMonthFactsCtes) — 'unlinked' = soumission sans bureau, un uuid = le bureau et ses antennes
 * (office_tree, défini par siteMonthFactsCtes pour un uuid seulement), rien = tous les bureaux.
 */
function submissionOfficeFilter(officeId) {
  if (officeId === 'unlinked') return `
            AND ms.field_office_id IS NULL`;
  if (officeId) return `
            AND ms.field_office_id IN (SELECT id FROM office_tree)`;
  return '';
}

/**
 * @param {string} tenantId
 * @param {{ period: {from:string,to:string}, officeId?: string|null, activity?: string|null, rbm?: boolean }} opts
 *   activity : ne garder que les sites de ce groupe d'activité (même clé que le découpage par
 *   activité, activityKeySql) — le concepteur de rapport (covDash) ; la réponse est alors celle de
 *   la ligne de cette activité, découpée par bureau et par district. La route des tableaux de bord
 *   ne le passe pas.
 *   rbm : false = l'état RBM n'est pas lu (aucun site « à suivre » transmis) — pour un appelant
 *   qui ne lit pas `rbm` (la cloche du Centre d'alertes ne lit que l'exécution du plan : le score
 *   RBM de chaque site du registre, en JavaScript, serait calculé puis jeté à chaque sondage).
 *   La mise en forme (coverageDefinitions.shapeCoverage({ rbm: false })) rend alors `rbm: null`.
 * @returns {Promise<{ rows: object[], refMonth: string, rbm: boolean }>}
 */
async function coverageFacts(tenantId, { period, officeId = null, activity = null, rbm = true }) {
  return withTenantTransaction(tenantId, async (client) => {
    await client.query(JIT_OFF);
    const refMonth = period.to;
    // « À suivre » au mois de référence : la règle RBM (scoreSite + échéance), jamais recalculée ici.
    const dueIds = rbm
      ? (await rbmSitesTx(client, tenantId, { month: refMonth, asOf: refMonth })).filter((r) => r.due).map((r) => r.id)
      : [];

    const params = [tenantId];
    const ctes = siteMonthFactsCtes({ period, todayMonth: currentMonth(), withData: true, officeId, activityGroup: activity || null }, params);
    const push = (v) => { params.push(v); return `$${params.length}`; };
    const { lo, hiExcl } = periodBounds(period);
    const pLo = push(lo); const pHiExcl = push(hiExcl);
    const pRef = push(`${refMonth}-01`);
    const pDue = push(dueIds);
    const { rows } = await client.query(
      `${ctes},
       -- Sites actifs au mois de référence : même règle que « actif » (zone interdite, « Oui » de la
       -- grille, ou tout le registre l'année sans grille), lue sur les CTE du service unique.
       ref AS MATERIALIZED (
         SELECT r.site_id FROM reg r
          WHERE NOT r.forbidden
            AND (COALESCE((SELECT NOT known FROM months WHERE m = ${pRef}::date), false)
                 OR r.site_id IN (SELECT site_id FROM st WHERE m = ${pRef}::date))),
       due AS MATERIALIZED (SELECT unnest(${pDue}::uuid[]) AS site_id),
       -- Communes ayant reçu des données NON rattachées à un site (même règle que la carte : fiche
       -- compatible avec l'activité du site — sans catégorie = compatible avec tout ; bureau de la
       -- soumission dans le périmètre choisi).
       cdat AS MATERIALIZED (
         SELECT DISTINCT lower(btrim(ms.adm3_pcode)) AS cp, lower(NULLIF(btrim(mf.activity_category), '')) AS cat
           FROM monitoring_submissions ms
           JOIN monitoring_forms mf ON mf.id = ms.form_id AND mf.tenant_id = ms.tenant_id
          WHERE ms.tenant_id = $1 AND NOT ms.excluded AND ms.site_id IS NULL AND NULLIF(btrim(ms.adm3_pcode), '') IS NOT NULL
            AND ms.period_month >= ${pLo}::date AND ms.period_month < ${pHiExcl}::date${submissionOfficeFilter(officeId)}),
       -- Sites dont la commune porte un P-code : sinon la commune n'est connue que par son nom, et deux
       -- communes de même nom dans deux districts restent deux communes (clé district | nom).
       pcs AS MATERIALIZED (
         SELECT s.id FROM sites s WHERE s.tenant_id = $1 AND NULLIF(btrim(s.adm3_pcode), '') IS NOT NULL),
       -- Appartenances en sous-requêtes IN hachées (une construction), jamais une jointure corrélée.
       ps AS (
         SELECT p.*, ${activityKeySql('p.activity')} AS akey,
                p.active AND p.site_id IN (SELECT site_id FROM ref) AS active_ref,
                p.site_id IN (SELECT site_id FROM due) AS rbm_due,
                COALESCE(p.ckey IN (SELECT cp FROM cdat WHERE cat IS NULL)
                  OR (p.act IS NULL AND p.ckey IN (SELECT cp FROM cdat))
                  OR (p.ckey, p.act) IN (SELECT cp, cat FROM cdat), false) AS commune_data,
                CASE WHEN p.ckey = '—' THEN NULL WHEN p.site_id IN (SELECT id FROM pcs) THEN p.ckey
                     ELSE p.dkey || '|' || p.ckey END AS cmk
           FROM per_site p)
       SELECT CASE WHEN GROUPING(akey) = 0 THEN 'activity' WHEN GROUPING(office) = 0 THEN 'office'
                   WHEN GROUPING(dkey) = 0 THEN 'district' ELSE 'overall' END AS dim,
              COALESCE(akey, office, dkey) AS key,
              -- Libellé affiché : la graphie la plus fréquente, à égalité l'ordre binaire (jamais la collation).
              mode() WITHIN GROUP (ORDER BY activity COLLATE "C") AS "activityLabel", ${DISTRICT_LABEL_SQL} AS "districtLabel",
              count(*)::int AS registry,
              count(*) FILTER (WHERE forbidden)::int AS forbidden,
              count(*) FILTER (WHERE active)::int AS sites,
              count(*) FILTER (WHERE active AND realised_any)::int AS covered,
              count(*) FILTER (WHERE active AND realised_data)::int AS "coveredData",
              count(*) FILTER (WHERE active AND realised)::int AS "coveredVisit",
              count(*) FILTER (WHERE active AND planned_due)::int AS "plannedSites",
              count(*) FILTER (WHERE active AND planned_due AND realised_any)::int AS "plannedCovered",
              count(*) FILTER (WHERE active AND planned_due AND realised_data)::int AS "plannedData",
              count(*) FILTER (WHERE active AND planned_due AND realised)::int AS "plannedVisit",
              COALESCE(sum(v_planned) FILTER (WHERE active), 0)::int AS "visitsPlanned",
              COALESCE(sum(v_planned_realised) FILTER (WHERE active), 0)::int AS "visitsCovered",
              COALESCE(sum(v_planned_data) FILTER (WHERE active), 0)::int AS "visitsData",
              COALESCE(sum(v_planned_visit) FILTER (WHERE active), 0)::int AS "visitsVisit",
              COALESCE(sum(v_upcoming) FILTER (WHERE active), 0)::int AS "visitsUpcoming",
              COALESCE(sum(v_upcoming_unset), 0)::int AS "visitsUpcomingUnset",
              COALESCE(sum(v_cancelled) FILTER (WHERE active), 0)::int AS "visitsCancelled",
              count(*) FILTER (WHERE covered_inactive)::int AS "coveredInactive",
              count(*) FILTER (WHERE covered_inactive AND forbidden)::int AS "coveredInactiveForbidden",
              count(*) FILTER (WHERE active_ref)::int AS "refSites",
              count(*) FILTER (WHERE active_ref AND rbm_due)::int AS "refDue",
              count(*) FILTER (WHERE active_ref AND risk = 'elevee')::int AS "refHigh",
              count(*) FILTER (WHERE active_ref AND risk = 'moyenne')::int AS "refMid",
              count(*) FILTER (WHERE active_ref AND risk = 'faible')::int AS "refLow",
              count(DISTINCT cmk) FILTER (WHERE active)::int AS communes,
              count(DISTINCT cmk) FILTER (WHERE active AND (realised_data OR commune_data))::int AS "communesData",
              (SELECT bool_and(known) FROM months) AS "knownAll", (SELECT bool_or(known) FROM months) AS "knownAny"
         FROM ps
        GROUP BY GROUPING SETS ((), (akey), (office), (dkey))`,
      params
    );
    return { rows, refMonth, rbm: Boolean(rbm) };
  });
}

module.exports = { coverageFacts, submissionOfficeFilter };
