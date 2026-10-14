const { withTenantTransaction } = require('../../config/db');
const { siteMonthFactsCtes } = require('../common/siteActivitySql');
const { currentMonth } = require('../tpm/rbmMath');
const { quarterPeriods, shapeQuarterly } = require('./quarterlyMath');

/**
 * Rapport trimestriel par activité (retour 54) : pour chaque trimestre de l'année et pour
 * l'année entière, sites DISTINCTS actifs / prévus / réalisés par activité, plus une ligne de
 * total (sites distincts, jamais une somme). Une requête par période, sur le service unique des
 * faits site × mois en mode « données » (même règle que la carte et la tuile Couverture) ; les
 * cinq requêtes s'enchaînent sur le même client (jamais en parallèle).
 * @param {string} tenantId
 * @param {{ year: number, officeId?: string|null }} opts
 */
async function quarterlyReport(tenantId, { year, officeId = null }) {
  const today = currentMonth();
  return withTenantTransaction(tenantId, async (client) => {
    const byPeriod = {};
    // Une période après l'autre sur le même client (règle du projet : jamais en parallèle).
    for (const p of quarterPeriods(year)) {
      const params = [tenantId];
      const ctes = siteMonthFactsCtes({ period: { from: p.from, to: p.to }, todayMonth: today, withData: true, officeId }, params);
      const { rows } = await client.query(
        `${ctes}
         SELECT CASE WHEN GROUPING(lower(activity)) = 0 THEN min(activity) END AS activity,
                count(*) FILTER (WHERE active)::int AS active,
                count(*) FILTER (WHERE planned)::int AS planned,
                count(*) FILTER (WHERE realised_any)::int AS realised
           FROM per_site
          GROUP BY GROUPING SETS ((lower(activity)), ())`,
        params
      );
      byPeriod[p.key] = rows;
    }
    return shapeQuarterly({ year, byPeriod, currentMonth: today });
  });
}

module.exports = { quarterlyReport };
