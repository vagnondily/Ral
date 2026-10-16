/**
 * Planification automatique sur une période (retour n° 82) — accès base. SQL ici, sur le
 * client de l'appelant (planAuto.service ouvre UNE transaction : verrous, lecture, calcul,
 * écriture) ; le calcul est pur (`planAuto.generatePlan`).
 *
 * Lecture : `field.planBoardWithTpmTx(year)` — la MÊME source que l'écran Plan de suivi — qui
 * donne, par site, les visites EXIGÉES par le MMR (deriveMmr), la priorité RBM, l'état mensuel
 * d'activation (et `yearHasGrid`, la règle commune), les mois des visites annulées et le TPM de
 * zone. Aucune règle dupliquée.
 * Écriture : une visite « planifie » par affectation, idempotente (jamais deux visites le même
 * site + mois, annulée comprise ; jamais un mois inactif selon la règle commune ; jamais une zone
 * interdite) ; puis restampVisitsTx (retour 58 : TPM de la zone, sous le verrou d'attribution).
 */
const field = require('./field.repository');
const { mmrKeyOf } = require('./planBoard');
const { deriveMmr } = require('./mmrMath');
const { activeMonthSql } = require('../common/siteActivity');
// Retour 58 : toute écriture de visites finit par restampVisitsTx.
const { restampVisitsTx, AUTO_RESTAMPABLE_SQL } = require('./tpmAttribution.repository');

/** Clé des écrivains de la planification automatique (prise AVANT les verrous des mois). */
const PLAN_AUTO_KEY = (tenantId) => `plan-auto:${tenantId}`;

async function lockPlanAutoTx(client, tenantId) {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [PLAN_AUTO_KEY(tenantId)]);
}

/** Lignes MMR du compte (pour l'intervalle et la capacité par activité). */
async function mmrRowsTx(client, tenantId) {
  const { rows } = await client.query(
    `SELECT m.field_office_id AS "fieldOfficeId", o.name AS "fieldOfficeName",
            m.activity_category AS "activityCategory",
            m.operation_duration AS "operationDuration", m.number_of_sites AS "numberOfSites",
            m.risk_level AS "riskLevel", m.feasible, m.persons_to_deploy AS "personsToDeploy",
            m.visits_per_day::float8 AS "visitsPerDay", m.working_days AS "workingDays"
       FROM mmr_parameters m
       LEFT JOIN field_offices o ON o.tenant_id = m.tenant_id AND o.id = m.field_office_id
      WHERE m.tenant_id = $1
      ORDER BY m.activity_category, m.field_office_id NULLS FIRST`, [tenantId]);
  return rows;
}

/**
 * Entrées du moteur pour l'exercice `year` (via le Plan de suivi), sur le client de l'appelant.
 * `scope.risk` restreint les sites À PLANIFIER (inScope) ; tous les sites restent lus, car leurs
 * visites consomment les mêmes capacités.
 * @returns {{ sites: object[], mmrByKey: object, yearHasGrid: boolean }}
 */
async function loadInputsTx(client, tenantId, { year, adjusted = false, scope = {} } = {}) {
  const board = await field.planBoardWithTpmTx(client, tenantId, { year, adjusted });
  // Intervalle + capacité mensuelle par ligne MMR (même clé que les sites du board).
  const mmrByKey = {};
  for (const r of await mmrRowsTx(client, tenantId)) {
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
      // Capacité/mois = faisable du MMR (jamais remplacée par une saisie de l'assistant).
      feasible: cap.feasible != null ? cap.feasible : d.feasible,
      // Dimensionnement des agents : quota journalier × jours ouvrés = visites/agent/mois.
      visitsPerDay: d.visitsPerDay,                   // quota journalier par agent (MMR)
      workingDays: d.workingDays,                     // jours ouvrés par mois (MMR)
      personsToDeploy: d.personsToDeploy,             // nb d'agents déclaré au MMR (référence)
    };
  }
  const risk = scope.risk || null;
  const sites = (board.sites || []).map((s) => ({
    id: s.id,
    name: s.name,
    district: s.district,
    commune: s.commune,
    activity: s.activity,
    riskLevel: s.riskLevel,
    inScope: !risk || s.riskLevel === risk,
    forbidden: Boolean(s.forbidden),
    inactive: Boolean(s.inactive),
    mmrKey: s.mmrKey || null,
    parametered: Boolean(s.parametered),
    required: Number(s.required) || 0,       // visites exigées par le MMR sur l'exercice
    // Dernière visite EFFECTIVE (visite réalisée, collecte de données ou registre), exercice
    // précédent compris : ancrage de l'intervalle.
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
    // Mois d'une visite ANNULÉE : jamais repris par le plan (une annulation est une décision).
    cancelledMonths: (s.cancelledMonths || []).map(Number).filter((m) => m >= 1 && m <= 12),
  }));
  return { sites, mmrByKey, yearHasGrid: Boolean(board.yearHasGrid) };
}

/**
 * Écrit les visites planifiées (affectations du moteur) sur le client de l'appelant, SOUS les
 * verrous des mois. Gardes en base, les mêmes que le moteur : jamais une 2ᵉ visite du même site ×
 * mois (annulée comprise) ; jamais un mois inactif (règle commune activeMonthSql) ; jamais une
 * zone interdite. Puis TPM de zone (restampVisitsTx, retour 58). Renvoie les visites créées et,
 * pour chaque affectation non écrite, la raison relue en base.
 * @param {{siteId, month, activity}[]} assignments  month = 'YYYY-MM'
 */
async function insertVisitsTx(client, tenantId, userId, assignments = []) {
  const clean = (assignments || []).filter((a) => a && a.siteId && /^\d{4}-(0[1-9]|1[0-2])$/.test(String(a.month)));
  if (!clean.length) return { created: 0, skipped: { existing: 0, inactive: 0, forbidden: 0 } };
  const { rows: inserted } = await client.query(
    `INSERT INTO site_visits (tenant_id, site_id, period_month, activity, status, created_by)
     SELECT $1, t.site_id, t.pm, t.activity, 'planifie', $2
       FROM unnest($3::uuid[], $4::date[], $5::text[]) AS t(site_id, pm, activity)
      WHERE NOT EXISTS (SELECT 1 FROM site_visits v
                         WHERE v.tenant_id = $1 AND v.site_id = t.site_id AND v.period_month = t.pm)
        AND EXISTS (SELECT 1 FROM sites s WHERE s.tenant_id = $1 AND s.id = t.site_id
                      AND COALESCE(s.security_situation, 0) < 99)
        AND ${activeMonthSql({ site: 't.site_id', year: 'extract(year FROM t.pm)::int', month: 'extract(month FROM t.pm)::int' })}
     ON CONFLICT (tenant_id, site_id, period_month, activity) DO NOTHING
     RETURNING site_id, to_char(period_month, 'YYYY-MM') AS month`,
    [tenantId, userId || null, clean.map((a) => a.siteId), clean.map((a) => `${a.month}-01`), clean.map((a) => a.activity || null)]
  );
  const done = new Set(inserted.map((r) => `${r.site_id}|${r.month}`));
  const missed = clean.filter((a) => !done.has(`${a.siteId}|${a.month}`));
  const skipped = { existing: 0, inactive: 0, forbidden: 0 };
  if (missed.length) {
    // Raison relue en base pour chaque affectation non écrite (compte rendu, jamais silencieux).
    const { rows } = await client.query(
      `SELECT t.site_id, to_char(t.pm, 'YYYY-MM') AS month,
              EXISTS (SELECT 1 FROM site_visits v WHERE v.tenant_id = $1 AND v.site_id = t.site_id AND v.period_month = t.pm) AS existing,
              NOT EXISTS (SELECT 1 FROM sites s WHERE s.tenant_id = $1 AND s.id = t.site_id AND COALESCE(s.security_situation, 0) < 99) AS forbidden
         FROM unnest($2::uuid[], $3::date[]) AS t(site_id, pm)`,
      [tenantId, missed.map((a) => a.siteId), missed.map((a) => `${a.month}-01`)]);
    for (const r of rows) {
      if (r.existing) skipped.existing += 1;
      else if (r.forbidden) skipped.forbidden += 1;
      else skipped.inactive += 1;
    }
  }
  // Les visites « zone » créées prennent le TPM de leur zone (sous le verrou d'attribution, pris
  // APRÈS les verrous des mois — même ordre que tous les écrivains de plan).
  await restampVisitsTx(client, tenantId);
  return { created: inserted.length, skipped };
}

/**
 * Visite PRÉVUE « libre », la seule qu'« Effacer les planifications » supprime : TPM de sa zone
 * (jamais un TPM choisi avec une raison ni repris d'une saisie d'avant la règle, retour 58), ni
 * figée (« antérieur »), ni facturée (AUTO_RESTAMPABLE_SQL), sans date de visite ni agent (le travail
 * d'affectation d'une personne), et d'un mois en cours ou à venir : un mois échu garde ses visites
 * prévues, qui comptent dans l'exécution du plan. Alias de visite : v.
 */
const CLEARABLE_SQL = `v.provider_source = 'zone' AND ${AUTO_RESTAMPABLE_SQL}
  AND v.visit_date IS NULL AND v.agent IS NULL AND v.period_month >= date_trunc('month', now())::date`;

/**
 * Efface les visites prévues LIBRES de la période (CLEARABLE_SQL), sur le client de l'appelant
 * (qui a pris les verrous des mois) : jamais une visite réalisée, annulée, figée, facturée,
 * motivée, datée, affectée à un agent, ni d'un mois échu. Renvoie le nombre supprimé et le nombre
 * de prévues conservées.
 * @param {number} year  exercice ; from/to = numéros de mois (1..12).
 */
async function clearPlannedTx(client, tenantId, { year, from, to, risk } = {}) {
  const fromD = `${year}-${String(from).padStart(2, '0')}-01`;
  const toD = `${year}-${String(to).padStart(2, '0')}-01`;
  const params = [tenantId, fromD, toD];
  let riskFilter = '';
  if (risk) {
    params.push(risk);
    riskFilter = ` AND v.site_id IN (SELECT id FROM sites WHERE tenant_id = $1 AND risk_level = $${params.length})`;
  }
  const scope = `v.tenant_id = $1 AND v.status = 'planifie'
        AND v.period_month >= $2::date AND v.period_month <= $3::date${riskFilter}`;
  const { rowCount } = await client.query(`DELETE FROM site_visits v WHERE ${scope} AND ${CLEARABLE_SQL}`, params);
  const { rows: [{ n }] } = await client.query(`SELECT count(*)::int AS n FROM site_visits v WHERE ${scope}`, params);
  return { deleted: rowCount, kept: n };
}

module.exports = { lockPlanAutoTx, mmrRowsTx, loadInputsTx, insertVisitsTx, clearPlannedTx, CLEARABLE_SQL, PLAN_AUTO_KEY };
