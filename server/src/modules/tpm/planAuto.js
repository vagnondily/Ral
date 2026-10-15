/**
 * Planification automatique du suivi SUR UNE PÉRIODE (retour n° 82) — logique
 * PURE, testée, sans I/O. Plan RÉALISTE, fidèle au MMR et au RBM.
 *
 * Objectif : un plan FAISABLE, pas des pics impossibles. Par activité (ligne MMR) :
 *   - chaque site est visité `fréquence` fois (MMR), espacées de l'INTERVALLE MMR
 *     (durée/risque, ou l'intervalle « ajusté » CO adjusted) ; sites sans MMR =
 *     fréquence RBM par risque (configurable) ;
 *   - les sites sont REGROUPÉS PAR COMMUNE (tournées) : une commune est suivie le
 *     même mois ; les communes sont réparties en « phases » sur l'intervalle pour
 *     ÉTALER la charge (≈ ciblé/mois), au lieu de tout mettre le même mois ;
 *   - le nombre de visites par mois et par activité est borné par la CAPACITÉ
 *     mensuelle du MMR (faisable = personnes × suivis/jour × jours ouvrés), avec
 *     un DÉBORDEMENT autorisé configurable (%) ; le surplus glisse au mois voisin.
 *
 * Entrée `sites` (sortie de planBoard, enrichie) :
 *   { id, commune, activity, riskLevel, forbidden, mmrKey, parametered, required,
 *     visits:[{month,status}], monthStatus:{m:bool} }
 * `mmrByKey` : { mmrKey: { interval, adjustedInterval, targetedPerMonth, feasible } }
 * `months` : mois de la période (numéros 1..12 de `year`), croissants.
 */
const { frequencyFor, DEFAULT_FREQUENCY } = require('./rbmMath');

const RISK_RANK = { elevee: 3, moyenne: 2, faible: 1 };

function normalizeSettings(s = {}) {
  const f = s.frequency || {};
  const n = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : d);
  const cap = s.capacityPerMonth;
  const ov = Number(s.overflowPct);
  return {
    frequency: {
      elevee: n(f.elevee, DEFAULT_FREQUENCY.elevee),
      moyenne: n(f.moyenne, DEFAULT_FREQUENCY.moyenne),
      faible: n(f.faible, DEFAULT_FREQUENCY.faible),
    },
    capacityPerMonth: cap == null || cap === '' || !(Number(cap) > 0) ? null : Math.floor(Number(cap)),
    overflowPct: Number.isFinite(ov) && ov >= 0 ? Math.min(100, ov) : 0,
    excludeMonths: [...new Set((s.excludeMonths || []).map((m) => Number(String(m).slice(5, 7)) || Number(m)).filter((m) => m >= 1 && m <= 12))],
    useMmrCapacity: s.useMmrCapacity !== false,
    adjusted: Boolean(s.adjusted),
    groupByCommune: s.groupByCommune !== false,
    targetCoverage: Number.isFinite(Number(s.targetCoverage)) ? Math.min(1, Math.max(0, Number(s.targetCoverage))) : 0.8,
  };
}

const ym = (year, m) => `${year}-${String(m).padStart(2, '0')}`;

/** Reste à planifier d'un site sur la période (MMR : exigées − réalisées − prévues DANS la période). */
function siteRemaining(s, periodStart) {
  const realise = (s.visits || []).filter((v) => v.status === 'realise').map((v) => Number(v.month));
  const planned = (s.visits || []).filter((v) => v.status === 'planifie').map((v) => Number(v.month));
  const plannedInPeriod = planned.filter((m) => m >= periodStart).length;
  const latePlanned = planned.filter((m) => m < periodStart).length;
  const remaining = Math.max(0, (Number(s.required) || 0) - realise.length - plannedInPeriod);
  return { remaining, realise, latePlanned };
}

/** Plan réaliste. @param {number} year année de l'exercice. */
function generatePlan(sites = [], mmrByKey = {}, settings = {}, months = [], year = new Date().getUTCFullYear()) {
  const cfg = normalizeSettings(settings);
  const period = [...new Set((months || []).filter((m) => m >= 1 && m <= 12))].sort((a, b) => a - b);
  const excluded = new Set(cfg.excludeMonths);
  const periodOpen = period.filter((m) => !excluded.has(m));
  const periodStart = period[0] || 1;

  const perMonth = new Map(period.map((m) => [m, 0]));
  const perKeyMonth = new Map();
  const kM = (k, m) => `${k || '∅'}|${m}`;
  const bump = (k, m) => { perMonth.set(m, (perMonth.get(m) || 0) + 1); perKeyMonth.set(kM(k, m), (perKeyMonth.get(kM(k, m)) || 0) + 1); };

  const considered = (sites || []).filter((s) => s && s.id);
  const forbidden = considered.filter((s) => s.forbidden);
  const plannable = considered.filter((s) => !s.forbidden);

  const globalCap = cfg.capacityPerMonth;
  const monthlyKeyCap = (key) => {
    if (!cfg.useMmrCapacity || !key) return Infinity;
    const c = mmrByKey[key];
    const lim = c && (c.feasible != null ? c.feasible : c.targetedPerMonth);
    if (lim == null) return Infinity;
    return Math.max(1, Math.round(lim * (1 + cfg.overflowPct / 100)));
  };
  const hasRoom = (key, m) => (perMonth.get(m) || 0) < (globalCap == null ? Infinity : globalCap)
    && (perKeyMonth.get(kM(key, m)) || 0) < monthlyKeyCap(key);

  // Groupe d'activité = ligne MMR (ou, sans MMR, par niveau de risque).
  const groups = new Map();
  for (const s of plannable) {
    const key = s.parametered && s.mmrKey ? s.mmrKey : `∅rbm:${s.riskLevel || 'moyenne'}`;
    if (!groups.has(key)) groups.set(key, { parametered: Boolean(s.parametered && s.mmrKey), mmrKey: s.parametered ? s.mmrKey : null, riskLevel: s.riskLevel, sites: [] });
    groups.get(key).sites.push(s);
  }

  const assignments = [];
  const covered = new Set();
  const byActivity = [];
  let unplaced = 0; let mmrDriven = 0; let rbmFallback = 0; let latePlannedTotal = 0;

  for (const [, g] of groups) {
    const c = g.parametered ? (mmrByKey[g.mmrKey] || {}) : {};
    let interval;
    if (g.parametered) {
      interval = cfg.adjusted && c.adjustedInterval ? c.adjustedInterval : (c.interval || frequencyFor(g.riskLevel, cfg.frequency));
    } else interval = frequencyFor(g.riskLevel, cfg.frequency);
    const step = Math.max(1, Math.ceil(interval)); // arrondi au supérieur : l'intervalle minimal n'est jamais réduit (4,5 → 5)
    let gPlanned = 0; const gCovered = new Set();  // compteurs de l'activité (ligne MMR)

    // Regroupement par commune (tournées) ; communes réparties en phases sur l'intervalle.
    const byCommune = new Map();
    for (const s of g.sites) {
      const c = cfg.groupByCommune ? (s.commune || '∅') : s.id;
      if (!byCommune.has(c)) byCommune.set(c, []);
      byCommune.get(c).push(s);
    }
    const communes = [...byCommune.keys()].sort((a, b) => String(a).localeCompare(String(b), 'fr'));

    communes.forEach((commune, ci) => {
      const phaseOffset = step > 1 && periodOpen.length ? (ci % Math.min(step, periodOpen.length)) : 0;
      const startMonth = periodOpen.length ? periodOpen[Math.min(phaseOffset, periodOpen.length - 1)] : periodStart;
      for (const s of byCommune.get(commune)) {
        const { remaining, realise, latePlanned } = siteRemaining(s, periodStart);
        latePlannedTotal += latePlanned;
        const busy = new Set((s.visits || []).map((v) => Number(v.month)));
        const inactive = new Set(Object.entries(s.monthStatus || {}).filter(([, a]) => a === false).map(([m]) => Number(m)));
        const allowed = periodOpen.filter((m) => !busy.has(m) && !inactive.has(m));
        if (!allowed.length) continue;
        let maxCount;
        if (g.parametered) { maxCount = remaining; if (remaining > 0) mmrDriven += 1; }
        else { maxCount = allowed.length; if (allowed.length > 0) rbmFallback += 1; }
        if (!maxCount) continue;

        const lastRealise = realise.length ? Math.max(...realise) : null;
        let cursor = lastRealise != null ? Math.max(startMonth, lastRealise + step) : startMonth;

        // Placement : chaque visite au moins `step` (= intervalle MMR) mois après la
        // précédente. Si le mois voulu est plein (capacité), on GLISSE VERS L'AVANT
        // seulement (jamais sur un mois antérieur : l'intervalle ne doit jamais être
        // violé). S'il ne reste plus de mois respectant l'intervalle, on n'ajoute rien.
        const placedForSite = [];
        let minMonth = cursor;        // plus tôt autorisé pour la PROCHAINE visite
        let placed = 0;
        for (let guard = 0; guard <= 12 && placed < maxCount; guard += 1) {
          const m = allowed.find((x) => x >= minMonth && !placedForSite.includes(x) && hasRoom(s.mmrKey, x));
          if (m == null) { unplaced += (maxCount - placed); break; }
          placedForSite.push(m);
          bump(s.mmrKey, m);
          assignments.push({ siteId: s.id, month: ym(year, m), monthNum: m, activity: s.activity || null, riskLevel: s.riskLevel || null, source: g.parametered ? 'mmr' : 'rbm' });
          covered.add(s.id);
          gCovered.add(s.id);
          gPlanned += 1;
          placed += 1;
          minMonth = m + step;        // la prochaine visite ≥ intervalle après celle-ci
        }
      }
    });

    // Aperçu par activité (ligne MMR) : paramètres de base + résultat du groupe.
    const activities = [...new Set(g.sites.map((s) => s.activity).filter(Boolean))];
    byActivity.push({
      activity: c.activity || (activities.length === 1 ? activities[0] : (activities[0] || null)),
      fieldOffice: g.parametered ? (c.fieldOffice || null) : null,  // null = plan général (tous bureaux)
      mixedActivities: activities.length > 1,
      parametered: g.parametered,
      riskLevel: g.riskLevel || null,
      mmr: g.parametered ? {
        operationDuration: c.operationDuration ?? null,
        numberOfSites: c.numberOfSites ?? null,
        frequency: c.frequency ?? null,
        interval: c.interval ?? null,
        adjustedInterval: c.adjustedInterval ?? null,
        targetedPerMonth: c.targetedPerMonth ?? null,
        feasible: c.feasible ?? null,
        feasibleOverridden: Boolean(c.feasibleOverridden),
      } : null,
      intervalUsed: Math.round(interval * 100) / 100,
      stepUsed: step,
      sites: g.sites.length,
      planned: gPlanned,
      covered: gCovered.size,
    });
  }

  byActivity.sort((a, b) => Number(b.parametered) - Number(a.parametered)
    || String(a.activity || '').localeCompare(String(b.activity || ''), 'fr')
    || String(a.fieldOffice || '').localeCompare(String(b.fieldOffice || ''), 'fr')
    || (b.planned - a.planned));

  assignments.sort((a, b) => a.monthNum - b.monthNum
    || (RISK_RANK[b.riskLevel] || 0) - (RISK_RANK[a.riskLevel] || 0)
    || String(a.siteId).localeCompare(String(b.siteId)));

  return {
    settings: cfg,
    year,
    months: period,
    assignments: assignments.map(({ monthNum: _m, ...a }) => a),
    byActivity,
    perMonth: period.map((m) => ({ month: ym(year, m), count: perMonth.get(m) || 0 })),
    summary: {
      sitesConsidered: considered.length,
      forbidden: forbidden.length,
      planned: assignments.length,
      sitesCovered: covered.size,
      sitesActivePlannable: plannable.length,
      mmrDriven,
      rbmFallback,
      latePlanned: latePlannedTotal,
      unplaced,
      targetCoverage: cfg.targetCoverage,
      coverageRate: plannable.length ? Math.round((covered.size / plannable.length) * 1000) / 10 : null,
    },
  };
}

module.exports = { generatePlan, normalizeSettings, siteRemaining, DEFAULT_SETTINGS: normalizeSettings() };
