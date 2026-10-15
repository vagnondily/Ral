/**
 * Planification automatique du suivi SUR UNE PÉRIODE (retour n° 82) — logique
 * PURE, testée, sans I/O. Fidèle au MMR et au RBM.
 *
 * Pour chaque site sur la période (mois de l'exercice) :
 *   - PARAMÉTRÉ au MMR : on planifie `toPlan` visites (= FRÉQ MMR exigée − faites
 *     − déjà prévues, fourni par planBoard/siteCounters), ESPACÉES de l'INTERVALLE
 *     MMR (durée ÷ risque, ou l'intervalle « ajusté » si demandé) ;
 *   - SANS paramètre MMR : repli sur la FRÉQUENCE RBM par risque (configurable),
 *     cadencée du même pas.
 * Le débit mensuel par activité est borné par la CAPACITÉ mensuelle du MMR
 * (faisable, sinon ciblé/mois) et, en option, par un plafond global. L'ordre de
 * traitement suit la priorité RBM (sites déjà classés par rankSites en amont).
 *
 * Entrée `sites` (sortie de planBoard, enrichie) :
 *   { id, activity, riskLevel, forbidden, mmrKey, parametered, toPlan,
 *     lastVisitMonth:'YYYY-MM'|null, monthStatus:{m:bool}, busyMonths:[int] }
 * `mmrByKey` : { mmrKey: { interval, adjustedInterval, targetedPerMonth, feasible } }
 * `months` : mois de la période (numéros 1..12 de `year`), croissants.
 */
const { frequencyFor, DEFAULT_FREQUENCY } = require('./rbmMath');

const RISK_RANK = { elevee: 3, moyenne: 2, faible: 1 };

function normalizeSettings(s = {}) {
  const f = s.frequency || {};
  const n = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : d);
  const cap = s.capacityPerMonth;
  return {
    frequency: {
      elevee: n(f.elevee, DEFAULT_FREQUENCY.elevee),
      moyenne: n(f.moyenne, DEFAULT_FREQUENCY.moyenne),
      faible: n(f.faible, DEFAULT_FREQUENCY.faible),
    },
    capacityPerMonth: cap == null || cap === '' || !(Number(cap) > 0) ? null : Math.floor(Number(cap)),
    excludeMonths: [...new Set((s.excludeMonths || []).map((m) => Number(String(m).slice(5, 7)) || Number(m)).filter((m) => m >= 1 && m <= 12))],
    useMmrCapacity: s.useMmrCapacity !== false,
    adjusted: Boolean(s.adjusted),
    targetCoverage: Number.isFinite(Number(s.targetCoverage)) ? Math.min(1, Math.max(0, Number(s.targetCoverage))) : 0.8,
  };
}

const ym = (year, m) => `${year}-${String(m).padStart(2, '0')}`;
const monthNum = (m) => { const n = Number(String(m).slice(5, 7)); return n >= 1 && n <= 12 ? n : null; };
const yearOf = (m) => Number(String(m).slice(0, 4));

/**
 * Mois de visite d'un site (numéros), cadence tous les `interval` mois à partir
 * de `start`, dans `allowed`, au plus `maxCount` visites. Pas de doublon.
 */
function cadence(start, interval, allowed, maxCount) {
  if (!allowed.length || maxCount <= 0) return [];
  const step = Math.max(1, Math.round(interval || 1));
  const out = [];
  let cursor = start;
  const last = allowed[allowed.length - 1];
  for (let guard = 0; guard <= 12 && out.length < maxCount && cursor <= last; guard += 1) {
    const m = allowed.find((x) => x >= cursor && !out.includes(x));
    if (m == null) break;
    out.push(m);
    cursor = m + step;
  }
  return out;
}

/** @param {number} year  année de l'exercice */
function generatePlan(sites = [], mmrByKey = {}, settings = {}, months = [], year = new Date().getUTCFullYear()) {
  const cfg = normalizeSettings(settings);
  const period = [...new Set((months || []).filter((m) => m >= 1 && m <= 12))].sort((a, b) => a - b);
  const excluded = new Set(cfg.excludeMonths);
  const periodStart = period[0] || 1;

  const perMonth = new Map(period.map((m) => [m, 0]));
  const perKeyMonth = new Map();
  const kM = (k, m) => `${k || ''}|${m}`;

  const considered = (sites || []).filter((s) => s && s.id);
  const forbidden = considered.filter((s) => s.forbidden);
  const plannable = considered.filter((s) => !s.forbidden);

  const globalCap = cfg.capacityPerMonth;
  const monthlyMmrCap = (key) => {
    if (!cfg.useMmrCapacity || !key) return Infinity;
    const c = mmrByKey[key];
    if (!c) return Infinity;
    const lim = c.feasible != null ? c.feasible : (c.targetedPerMonth != null ? c.targetedPerMonth : null);
    return lim == null ? Infinity : Math.max(1, Math.ceil(lim));
  };
  const room = (key, m) => (perMonth.get(m) || 0) < (globalCap == null ? Infinity : globalCap)
    && (perKeyMonth.get(kM(key, m)) || 0) < monthlyMmrCap(key);
  const take = (key, m) => { perMonth.set(m, (perMonth.get(m) || 0) + 1); perKeyMonth.set(kM(key, m), (perKeyMonth.get(kM(key, m)) || 0) + 1); };

  const assignments = [];
  const covered = new Set();
  let unplaced = 0; let mmrDriven = 0; let rbmFallback = 0; let latePlanned = 0;

  for (const s of plannable) {
    const visits = s.visits || [];
    // Mois déjà occupés (prévus OU réalisés) : on ne crée jamais une 2ᵉ visite ce mois.
    const busy = new Set(visits.map((v) => Number(v.month)));
    const realiseMonths = visits.filter((v) => v.status === 'realise').map((v) => Number(v.month));
    const plannedMonths = visits.filter((v) => v.status === 'planifie').map((v) => Number(v.month));
    const inactive = new Set(Object.entries(s.monthStatus || {}).filter(([, a]) => a === false).map(([m]) => Number(m)));
    const allowed = period.filter((m) => !excluded.has(m) && !busy.has(m) && !inactive.has(m));
    if (!allowed.length) continue;

    // Reste à planifier SUR LA PÉRIODE et intervalle, selon MMR ou repli RBM.
    let interval; let maxCount;
    if (s.parametered) {
      const c = mmrByKey[s.mmrKey] || {};
      interval = cfg.adjusted && c.adjustedInterval ? c.adjustedInterval : (c.interval || frequencyFor(s.riskLevel, cfg.frequency));
      // Reste = exigées MMR − réalisées(exercice) − prévues DANS la période.
      // Les prévues AVANT la période non réalisées ne comptent pas → re-planifiées (catch-up MMR).
      const plannedInPeriod = plannedMonths.filter((m) => m >= periodStart).length;
      const required = Math.max(0, Number(s.required) || 0);
      maxCount = Math.max(0, required - realiseMonths.length - plannedInPeriod);
      latePlanned += plannedMonths.filter((m) => m < periodStart).length; // prévues passées non réalisées
      if (maxCount > 0) mmrDriven += 1;
    } else {
      interval = frequencyFor(s.riskLevel, cfg.frequency);
      maxCount = allowed.length; // repli : autant que la cadence en pose sur la période
      if (maxCount > 0) rbmFallback += 1;
    }
    if (!maxCount) continue;

    // Départ : dernière visite RÉALISÉE (même exercice) + intervalle, sinon début de période.
    let start = periodStart;
    const lastRealise = realiseMonths.length ? Math.max(...realiseMonths) : null;
    if (lastRealise != null) start = Math.max(periodStart, lastRealise + Math.max(1, Math.round(interval)));
    else {
      const lv = s.lastVisitMonth;
      if (lv && yearOf(lv) === year) { const n = monthNum(lv); if (n != null) start = Math.max(periodStart, n + Math.max(1, Math.round(interval))); }
    }

    const wanted = cadence(start, interval, allowed, maxCount);
    const placedForSite = new Set();
    for (const w of wanted) {
      let m = room(s.mmrKey, w) ? w : allowed.find((x) => x >= w && !placedForSite.has(x) && room(s.mmrKey, x))
        || allowed.find((x) => !placedForSite.has(x) && room(s.mmrKey, x));
      if (m == null || placedForSite.has(m)) { unplaced += 1; continue; }
      placedForSite.add(m);
      take(s.mmrKey, m);
      assignments.push({ siteId: s.id, month: ym(year, m), monthNum: m, activity: s.activity || null, riskLevel: s.riskLevel || null, source: s.parametered ? 'mmr' : 'rbm' });
      covered.add(s.id);
    }
  }

  assignments.sort((a, b) => a.monthNum - b.monthNum
    || (RISK_RANK[b.riskLevel] || 0) - (RISK_RANK[a.riskLevel] || 0)
    || String(a.siteId).localeCompare(String(b.siteId)));

  return {
    settings: cfg,
    year,
    months: period,
    assignments: assignments.map(({ monthNum: _m, ...a }) => a),
    perMonth: period.map((m) => ({ month: ym(year, m), count: perMonth.get(m) || 0 })),
    summary: {
      sitesConsidered: considered.length,
      forbidden: forbidden.length,
      planned: assignments.length,
      sitesCovered: covered.size,
      sitesActivePlannable: plannable.length,
      mmrDriven,
      rbmFallback,
      latePlanned,
      unplaced,
      targetCoverage: cfg.targetCoverage,
      coverageRate: plannable.length ? Math.round((covered.size / plannable.length) * 1000) / 10 : null,
    },
  };
}

module.exports = { generatePlan, normalizeSettings, cadence, DEFAULT_SETTINGS: normalizeSettings() };
