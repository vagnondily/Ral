/**
 * Thèmes, taux et signaux de la carte du suivi (lot 6a) — UNE définition, PURE,
 * testée (test/mapThemes.test.js). Le serveur l'applique à chaque zone (district,
 * contour partagé, région, bureau, commune, activité, total) ; l'écran ne recalcule
 * rien, il colore.
 *
 * Définitions communes (docs/PLAN_RETOURS_15_37.md) :
 *  - couverture   = sites actifs réalisés ÷ sites actifs (0 % est une vraie valeur) ;
 *  - planification = sites actifs prévus ÷ actifs — « — aucun plan » si aucun prévu ;
 *  - exécution    = visites (site × mois) prévues et réalisées ÷ visites prévues, des mois
 *                   ÉCHUS (≤ mois courant, comme le lot 1b) — « — aucun plan » si aucune ;
 *  - réalisé = données rattachées AU SITE ou visite déclarée réalisée, pendant un mois
 *    actif ; une donnée rattachée à la seule commune n'est jamais une visite.
 * Limite connue (lot 4) : une visite déclarée réalisée compte comme prévue (le motif
 * « hors plan » des visites déclarées n'existe pas encore) ; seules les DONNÉES sans
 * visite prévue sont « hors plan ».
 */

/** Comptes d'une zone, tous additifs (une zone partagée = somme de ses districts). */
const COUNT_KEYS = Object.freeze([
  'sites', 'active', 'realised', 'realisedData', 'planned', 'visitsPlanned', 'visitsPlannedRealised',
  'visitsOffPlan', 'visitsUnassigned', 'riskHigh', 'riskMid', 'riskLow', 'highUntouched',
  'communeDataOnly', 'neverVisited', 'gps', 'submissions', 'submissionsSite',
]);

/** Seuils des signaux — exécution < 50 % comme alertsMath (champ plan_exec) ; part critique des sites à risque élevé non suivis. */
const THRESHOLDS = Object.freeze({ execLow: 0.5, highRiskCritical: 0.5 });

/**
 * Les thèmes, dans l'ordre d'affichage. kind : 'count' (rampe par quantiles), 'pct'
 * (classes fixes), 'sev' (gravité 0..2 + icône). ramp : 'blue' | 'orange' | 'alert'.
 */
const THEMES = Object.freeze([
  { id: 'active', group: 'registre', label: 'Sites actifs', kind: 'count', ramp: 'blue' },
  { id: 'riskHigh', group: 'registre', label: 'Risque élevé', kind: 'pct', ramp: 'orange' },
  { id: 'realised', group: 'suivi', label: 'Sites visités', kind: 'count', ramp: 'blue' },
  { id: 'coverage', group: 'suivi', label: 'Couverture', kind: 'pct', ramp: 'blue' },
  { id: 'planning', group: 'suivi', label: 'Planification', kind: 'pct', ramp: 'blue' },
  { id: 'execution', group: 'suivi', label: 'Exécution du plan', kind: 'pct', ramp: 'blue' },
  { id: 'submissions', group: 'donnees', label: 'Données versées', kind: 'count', ramp: 'blue' },
  { id: 'alerts', group: 'alertes', label: 'Signaux de la carte', kind: 'sev', ramp: 'alert' },
]);

const n0 = (v) => Math.max(0, Math.round(Number(v) || 0));

/** Comptes normalisés (entiers ≥ 0, toutes les clés présentes). */
function countsOf(src = {}) {
  const out = {};
  for (const k of COUNT_KEYS) out[k] = n0(src[k]);
  return out;
}

/** Somme de comptes. */
function addCounts(a, b) {
  const out = countsOf(a);
  for (const k of COUNT_KEYS) out[k] += n0(b && b[k]);
  return out;
}

/**
 * Un taux : { value | null, num, den, reason }. reason : null, 'aucun_site_actif'
 * (pas de site actif : gris, jamais 0 %) ou 'aucun_plan' (pas de plan : « — aucun plan »).
 */
function rate(num, den, { active = den, plan = null } = {}) {
  if (!(active > 0)) return { value: null, num, den, reason: 'aucun_site_actif' };
  if (plan !== null && !(plan > 0)) return { value: null, num, den, reason: 'aucun_plan' };
  if (!(den > 0)) return { value: null, num, den, reason: 'aucun_site_actif' };
  return { value: num / den, num, den, reason: null };
}

/** Les taux d'une zone, recalculés depuis ses comptes (jamais une moyenne de taux). */
function ratesOf(c) {
  const k = countsOf(c);
  return {
    coverage: rate(k.realised, k.active),
    planning: rate(k.planned, k.active, { plan: k.planned }),
    execution: rate(k.visitsPlannedRealised, k.visitsPlanned, { active: k.active, plan: k.visitsPlanned }),
    riskHigh: rate(k.riskHigh, k.active),
  };
}

const SEV_RANK = { critical: 2, warning: 1, info: 0 };
/** Écran où l'on agit (même cible que les alertes terrain de alertsMath). */
const FIELD_GO = Object.freeze({ module: 'processus', sub: 'sites' });

/**
 * Signaux d'une zone (même forme que alertsMath : sev, kind, title, params, go) ;
 * `title` est la phrase française à traduire avec ses {paramètres}.
 */
function signalsOf(c) {
  const k = countsOf(c);
  const out = [];
  if (k.highUntouched >= 1) {
    const share = k.riskHigh > 0 ? k.highUntouched / k.riskHigh : 1;
    out.push({ sev: share >= THRESHOLDS.highRiskCritical ? 'critical' : 'warning', kind: 'high_risk_untouched',
      title: '{n} site(s) à risque élevé ni prévus ni visités', params: { n: k.highUntouched }, go: { module: 'processus', sub: 'rbm' } });
  }
  if (k.visitsPlanned > 0 && k.visitsPlannedRealised / k.visitsPlanned < THRESHOLDS.execLow) {
    out.push({ sev: 'warning', kind: 'plan_exec_low', title: 'Exécution du plan {p} (< 50 %)',
      params: { p: k.visitsPlannedRealised / k.visitsPlanned, num: k.visitsPlannedRealised, den: k.visitsPlanned }, go: FIELD_GO });
  }
  if (k.active > 0 && k.planned === 0) {
    out.push({ sev: 'info', kind: 'no_plan', title: 'Aucun site prévu sur la période', params: {}, go: FIELD_GO });
  }
  if (k.visitsUnassigned >= 1) {
    out.push({ sev: 'info', kind: 'visits_unassigned', title: '{n} visite(s) sans TPM', params: { n: k.visitsUnassigned }, go: FIELD_GO });
  }
  if (k.submissions - k.submissionsSite >= 1) {
    out.push({ sev: 'info', kind: 'data_unlinked', title: '{n} soumission(s) non rattachée(s) à un site',
      params: { n: k.submissions - k.submissionsSite }, go: { module: 'parametrage', sub: 'localites' } });
  }
  if (k.visitsOffPlan >= 1) {
    out.push({ sev: 'info', kind: 'off_plan', title: '{n} visite(s) hors plan (données sans visite prévue)', params: { n: k.visitsOffPlan }, go: FIELD_GO });
  }
  return out.sort((a, b) => SEV_RANK[b.sev] - SEV_RANK[a.sev]);
}

/** Gravité maximale (0 à traiter · 1 à surveiller · 2 critique), null sans signal. */
const alertLevel = (signals) => (signals && signals.length ? Math.max(...signals.map((s) => SEV_RANK[s.sev])) : null);

/** Zone complète : comptes, taux, signaux. */
function zoneOf(counts) {
  const c = countsOf(counts);
  const signals = signalsOf(c);
  return { counts: c, rates: ratesOf(c), signals, alertLevel: alertLevel(signals) };
}

/**
 * Contours de la carte : somme des comptes des districts d'un même contour, puis
 * taux et signaux RECALCULÉS (jamais une moyenne de taux).
 * @param {{pcode:string,name:string,region?:string|null,counts:object}[]} districts lignes par district
 * @param {{ byPcode: Record<string,{shapeKey:string|null,how:string}> }} match résultat de geoMatch.matchDistricts
 * @param {Map<string,string>|object} [shapeNames] clé → nom du contour
 * @returns {{ key, name, region, districts:{pcode,name,how}[], counts, rates, signals, alertLevel }[]}
 */
function aggregateShapes(districts, match, shapeNames = {}) {
  const nameOf = (k) => (shapeNames instanceof Map ? shapeNames.get(k) : shapeNames[k]) || k;
  const by = new Map();
  for (const d of districts) {
    const m = match.byPcode[d.pcode];
    if (!m || !m.shapeKey) continue;
    if (!by.has(m.shapeKey)) by.set(m.shapeKey, { key: m.shapeKey, name: nameOf(m.shapeKey), regions: new Set(), districts: [], counts: countsOf({}) });
    const s = by.get(m.shapeKey);
    s.districts.push({ pcode: d.pcode, name: d.name, how: m.how });
    if (d.region) s.regions.add(d.region);
    s.counts = addCounts(s.counts, d.counts);
  }
  return [...by.values()].map((s) => {
    // Le district « hôte » (contour exact) en tête, puis les districts qui le partagent.
    s.districts.sort((a, b) => (a.how === 'parent') - (b.how === 'parent') || a.name.localeCompare(b.name));
    return { key: s.key, name: s.name, region: [...s.regions].sort().join(' · ') || null, districts: s.districts, ...zoneOf(s.counts) };
  });
}

/** Chiffre clé : totaux du périmètre (y compris sites rattachés à la région seulement). */
const totalsOf = (counts) => zoneOf(counts);

module.exports = { COUNT_KEYS, THRESHOLDS, THEMES, countsOf, addCounts, rate, ratesOf, signalsOf, alertLevel, zoneOf, aggregateShapes, totalsOf };
