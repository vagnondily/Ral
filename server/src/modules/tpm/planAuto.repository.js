/**
 * Planification automatique sur une période (retour n° 82) — accès base, en
 * fichier NEUF (ne touche pas field.repository.js, disputé). SQL/lecture ici ;
 * le calcul est pur (`planAuto.generatePlan`).
 *
 * Lecture : on réutilise `field.repository.planBoard(year)` — la MÊME source que
 * l'écran Plan de suivi — qui donne, par site, les visites EXIGÉES par le MMR
 * (deriveMmr), le reste à planifier (`toPlan`), la priorité RBM, l'état mensuel
 * d'activation et la capacité mensuelle MMR. Aucune règle dupliquée.
 * Écriture : une visite « planifie » par affectation, idempotente (jamais deux
 * visites le même site + mois ; jamais un mois « Inactive »), sous verrou ; la
 * base estampille le TPM de zone au commit (déclencheur retour 58).
 */
const { withTenantTransaction } = require('../../config/db');
const field = require('./field.repository');
const { mmrKeyOf } = require('./planBoard');
const { deriveMmr } = require('./mmrMath');
// Retour 58 : toute écriture de visites finit par restampVisitsTx.
const { restampVisitsTx } = require('./tpmAttribution.repository');

/** Lignes MMR du compte (pour l'intervalle et la capacité par activité). */
async function mmrRows(tenantId) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT m.field_office_id AS "fieldOfficeId", o.name AS "fieldOfficeName",
              m.activity_category AS "activityCategory",
              m.operation_duration AS "operationDuration", m.number_of_sites AS "numberOfSites",
              m.risk_level AS "riskLevel", m.feasible, m.persons_to_deploy AS "personsToDeploy",
              m.visits_per_day::float8 AS "visitsPerDay", m.working_days AS "workingDays"
         FROM mmr_parameters m
         LEFT JOIN field_offices o ON o.tenant_id = m.tenant_id AND o.id = m.field_office_id
        WHERE m.tenant_id = $1`, [tenantId]);
    return rows;
  });
}

/**
 * Sites + faits MMR/RBM pour l'exercice `year` (via planBoard), mis à la forme
 * attendue par le moteur. `risk` filtre un niveau de risque.
 * @returns {{ sites: object[], capacity: object }}
 */
async function sitesForPlanning(tenantId, { year, adjusted = false, risk, capacityOverride } = {}) {
  const board = await field.planBoard(tenantId, { year, adjusted });
  // Intervalle + capacité mensuelle par ligne MMR (même clé que les sites du board).
  const mmrByKey = {};
  for (const r of await mmrRows(tenantId)) {
    const d = deriveMmr(r);
    const key = mmrKeyOf(r);
    const cap = (board.capacity || {})[key] || {};
    mmrByKey[key] = {
      // Paramètres de base du MMR (pour l'aperçu « par activité »).
      activity: r.activityCategory || cap.activity || null,
      fieldOffice: r.fieldOfficeName || null,         // null = plan général (tous bureaux)
      riskLevel: Number(r.riskLevel) || null,         // 1 faible · 2 moyen · 3 élevé
      operationDuration: d.operationDuration,
      numberOfSites: d.numberOfSites,
      frequency: d.frequency,                         // visites exigées / site / exercice
      interval: d.interval,                           // mois entre 2 visites
      adjustedInterval: d.adjustedInterval,
      adjustedFrequency: d.adjustedFrequency,
      targetedPerMonth: cap.targeted != null ? cap.targeted : d.targetedPerMonth,
      // Capacité/mois : surcharge saisie dans l'assistant > faisable du MMR.
      feasible: Number(capacityOverride) > 0 ? Number(capacityOverride) : (cap.feasible != null ? cap.feasible : d.feasible),
      feasibleOverridden: Number(capacityOverride) > 0,
      // Dimensionnement des agents : quota journalier × jours ouvrés = visites/agent/mois.
      visitsPerDay: d.visitsPerDay,                   // quota journalier par agent (MMR)
      workingDays: d.workingDays,                     // jours ouvrés par mois (MMR)
      personsToDeploy: d.personsToDeploy,             // nb d'agents déclaré au MMR (référence)
    };
  }
  const sites = (board.sites || [])
    .filter((s) => !risk || s.riskLevel === risk)
    .map((s) => ({
      id: s.id,
      name: s.name,
      district: s.district,
      commune: s.commune,
      activity: s.activity,
      riskLevel: s.riskLevel,
      forbidden: Boolean(s.forbidden),
      inactive: Boolean(s.inactive),
      mmrKey: s.mmrKey || null,
      parametered: Boolean(s.parametered),
      required: Number(s.required) || 0,       // visites exigées par le MMR sur l'exercice
      lastVisitMonth: s.lastVisitMonth || null,
      monthStatus: s.monthStatus || {},
      // Regroupement « au plus proche » : GPS du site quand il existe (retour 82).
      gpsLat: s.gpsLat != null ? Number(s.gpsLat) : null,
      gpsLng: s.gpsLng != null ? Number(s.gpsLng) : null,
      // TPM de la zone par mois (contrat de suivi, retour 58) : pour équilibrer la charge.
      tpmSegments: (s.tpm && Array.isArray(s.tpm.segments))
        ? s.tpm.segments.map((seg) => ({ from: seg.from, to: seg.to, providerId: seg.providerId || null, providerName: seg.providerName || null }))
        : [],
      // Visites de l'exercice (prévues / réalisées), avec leur mois et statut : le moteur
      // recalcule le reste à planifier SUR LA PÉRIODE (les prévues avant la période non
      // réalisées redeviennent à planifier, pour ne pas sortir du MMR).
      visits: (s.months || [])
        .map((m) => ({ month: Number(m.month), status: m.status }))
        .filter((m) => m.month >= 1 && m.month <= 12),
    }));
  return { sites, mmrByKey };
}

/**
 * Écrit les visites planifiées (affectations du moteur) en une transaction, sous
 * verrou consultatif. Idempotent : jamais de 2ᵉ visite pour un même site + mois ;
 * jamais sur un mois « Inactive ». Renvoie le nombre réellement créé.
 * @param {{siteId, month}[]} assignments  month = 'YYYY-MM'
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

/**
 * Efface les visites PLANIFIÉES (status = 'planifie') de la période, pour
 * repartir d'un plan propre. Ne touche JAMAIS une visite réalisée, annulée,
 * figée (« antérieur »), facturée ou motivée (retour 58) : seules les prévues
 * « libres » sont supprimées. Sous verrou ; renvoie le nombre supprimé.
 * @param {number} year  exercice ; from/to = numéros de mois (1..12).
 */
async function clearPlanned(tenantId, { year, from, to, risk } = {}) {
  return withTenantTransaction(tenantId, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`plan-auto:${tenantId}`]);
    const fromD = `${year}-${String(from).padStart(2, '0')}-01`;
    const toD = `${year}-${String(to).padStart(2, '0')}-01`;
    const params = [tenantId, fromD, toD];
    let riskFilter = '';
    if (risk) {
      params.push(risk);
      riskFilter = ` AND v.site_id IN (SELECT id FROM sites WHERE tenant_id = $1 AND risk_level = $${params.length})`;
    }
    // Colonnes de « figement » tolérées (selon migrations présentes) : on ne supprime
    // que les prévues réellement libres.
    const { rows: cols } = await client.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'site_visits' AND column_name IN ('frozen','billed','locked','provider_source')`);
    const names = new Set(cols.map((c) => c.column_name));
    let guard = '';
    if (names.has('frozen')) guard += ' AND COALESCE(v.frozen, false) = false';
    if (names.has('billed')) guard += ' AND COALESCE(v.billed, false) = false';
    if (names.has('locked')) guard += ' AND COALESCE(v.locked, false) = false';
    const { rowCount } = await client.query(
      `DELETE FROM site_visits v
        WHERE v.tenant_id = $1 AND v.status = 'planifie'
          AND v.period_month >= $2::date AND v.period_month <= $3::date${riskFilter}${guard}`,
      params);
    return { deleted: rowCount };
  });
}

module.exports = { sitesForPlanning, applyPlan, clearPlanned };
