/**
 * Planification automatique sur une période (retour n° 82) — accès base, en
 * fichier NEUF (ne touche pas field.repository.js, disputé par plusieurs
 * chantiers). SQL uniquement ici. Le calcul est pur (`planAuto.generatePlan`).
 *
 * Lecture : pour chaque site, les éléments dont le moteur a besoin — risque,
 * zone interdite (sécurité ≥ 99), dernière visite EFFECTIVE (mois réalisé le plus
 * récent OU date de dernière visite du registre — jamais une visite seulement
 * planifiée), mois déjà occupés et mois inactifs (grille d'activation) sur la
 * période. Écriture : une visite « planifie » par affectation, idempotente
 * (jamais deux visites le même site + mois), sous verrou consultatif ; la base
 * estampille le TPM de zone au commit (déclencheur retour 58).
 */
const { withTenantTransaction } = require('../../config/db');
// Retour 58 : toute écriture de visites finit par restampVisitsTx — le TPM des
// visites « zone » créées est celui de leur zone, pris sous le verrou d'attribution.
const { restampVisitsTx } = require('./tpmAttribution.repository');

/** Sites + faits nécessaires au moteur, sur la période [from, to] ('YYYY-MM'). */
async function sitesForPlanning(tenantId, { from, to, risk } = {}) {
  return withTenantTransaction(tenantId, async (client) => {
    const fromD = `${from}-01`;
    const toD = `${to}-01`;
    const params = [tenantId, fromD, toD];
    let riskFilter = '';
    if (risk) { params.push(risk); riskFilter = ` AND s.risk_level = $${params.length}`; }
    const { rows } = await client.query(
      `SELECT s.id, s.name, s.district, s.commune, s.activity, s.risk_level AS "riskLevel",
              (COALESCE(s.security_situation, 0) >= 99) AS forbidden,
              to_char(GREATEST(
                (SELECT max(v.period_month) FROM site_visits v
                  WHERE v.tenant_id = s.tenant_id AND v.site_id = s.id AND v.status = 'realise'),
                s.last_visit_date
              ), 'YYYY-MM') AS "lastVisitMonth",
              COALESCE((SELECT array_agg(DISTINCT to_char(v.period_month, 'YYYY-MM'))
                 FROM site_visits v
                WHERE v.tenant_id = s.tenant_id AND v.site_id = s.id
                  AND v.period_month >= $2::date AND v.period_month <= $3::date), '{}') AS "busyMonths",
              COALESCE((SELECT array_agg(to_char(make_date(ms.year, ms.month, 1), 'YYYY-MM'))
                 FROM site_month_status ms
                WHERE ms.tenant_id = s.tenant_id AND ms.site_id = s.id AND NOT ms.active
                  AND make_date(ms.year, ms.month, 1) >= $2::date
                  AND make_date(ms.year, ms.month, 1) <= $3::date), '{}') AS "inactiveMonths"
         FROM sites s
        WHERE s.tenant_id = $1${riskFilter}`,
      params
    );
    return rows;
  });
}

/**
 * Écrit les visites planifiées (affectations du moteur) en une transaction, sous
 * verrou consultatif par compte (deux générations simultanées sérialisées).
 * Idempotent : jamais de 2ᵉ visite pour un même site + mois ; jamais sur un mois
 * « Inactive ». Renvoie le nombre réellement créé.
 * @param {{siteId, month, activity}[]} assignments
 */
async function applyPlan(tenantId, userId, assignments = []) {
  const clean = (assignments || []).filter((a) => a && a.siteId && /^\d{4}-\d{2}$/.test(String(a.month)));
  if (!clean.length) return { created: 0 };
  return withTenantTransaction(tenantId, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`plan-auto:${tenantId}`]);
    const siteIds = clean.map((a) => a.siteId);
    const firstDays = clean.map((a) => `${a.month}-01`);
    const activities = clean.map((a) => a.activity || null);
    const years = clean.map((a) => Number(a.month.slice(0, 4)));
    const monthsN = clean.map((a) => Number(a.month.slice(5, 7)));
    const { rowCount } = await client.query(
      `INSERT INTO site_visits (tenant_id, site_id, period_month, activity, status, created_by)
       SELECT $1, t.site_id, t.pm::date, t.activity, 'planifie', $2
         FROM unnest($3::uuid[], $4::date[], $5::text[], $6::int[], $7::int[])
                AS t(site_id, pm, activity, yr, mo)
        WHERE NOT EXISTS (SELECT 1 FROM site_visits v
                           WHERE v.tenant_id = $1 AND v.site_id = t.site_id AND v.period_month = t.pm::date)
          AND NOT EXISTS (SELECT 1 FROM site_month_status ms
                           WHERE ms.tenant_id = $1 AND ms.site_id = t.site_id
                             AND ms.year = t.yr AND ms.month = t.mo AND NOT ms.active)
       ON CONFLICT (tenant_id, site_id, period_month, activity) DO NOTHING`,
      [tenantId, userId || null, siteIds, firstDays, activities, years, monthsN]
    );
    // Les visites « zone » créées prennent le TPM de leur zone (sous le verrou d'attribution).
    await restampVisitsTx(client, tenantId);
    return { created: rowCount };
  });
}

module.exports = { sitesForPlanning, applyPlan };
