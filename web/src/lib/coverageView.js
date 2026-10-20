/**
 * Tableau de bord « Couverture & performance du suivi » (maquette de l'utilisateur, retours 40,
 * 66, 67 et 85) — fonctions PURES de l'écran : aucun accès au DOM ni à l'API, testées depuis
 * server/test/webCoverageView.test.js.
 *
 * Le serveur (GET /api/dashboards/performance, dashboards/performanceMath) met en forme les
 * indicateurs et les visites ; la COUVERTURE vient de GET /api/dashboards/coverage (retour 110 :
 * univers = sites actifs de la période, « suivi » = visite déclarée OU données reçues rattachées
 * au site — la même réponse que la Synthèse du suivi de processus, calculée par le même service
 * de faits que la carte). Les signaux de sites (risque élevé non suivi, jamais visités) viennent
 * de la réponse de la carte. Ce module ne fait que les RÉUNIR pour l'écran — aucun chiffre n'est
 * recalculé ici.
 */

/** Classes d'un indice, d'un score ou d'un indicateur : la règle unique du serveur (classify). */
export const BANDS = ['exc', 'sat', 'imp', 'urg', 'na'];

/** Seuils lus par l'aide (sans cible : bandes du score orienté ; avec cible : écart relatif). */
export const BAND_RULES = [
  { k: 'exc', range: '≥ 80', decision: 'Documenter' },
  { k: 'sat', range: '65 – 79', decision: 'Consolider' },
  { k: 'imp', range: '50 – 64', decision: 'Plan d\'action' },
  { k: 'urg', range: '< 50', decision: 'Intervention' },
];

/**
 * Verdict d'une activité (bandeau « Décision » de la maquette) — couverture et indice lus
 * ensemble, mêmes seuils que le bulletin :
 *   critique     couverture < 40 % ou indice < 50 ;
 *   vigilance    indice < 65 ou couverture < 65 % ;
 *   satisfaisant sinon ;
 *   na           ni couverture (aucun site actif) ni indice (aucune visite notée).
 * `basis` dit ce qui a été lu : 'both', 'coverage' ou 'index' (l'écran le précise).
 */
export const VERDICT_THRESHOLDS = Object.freeze({ critical: { coverage: 0.4, index: 50 }, watch: { coverage: 0.65, index: 65 } });

export const VERDICTS = {
  critique: { label: 'Critique', action: 'Agir', tone: 'red', icon: 'x', text: 'Intervention prioritaire : couverture et/ou qualité insuffisantes.' },
  vigilance: { label: 'Vigilance', action: 'Surveiller', tone: 'orange', icon: 'warn', text: 'Renforcer le suivi et cibler les sites les plus faibles.' },
  satisfaisant: { label: 'Satisfaisant', action: 'Maintenir', tone: 'green', icon: 'check', text: 'Maintenir le dispositif et documenter les bonnes pratiques.' },
  na: { label: 'Non évalué', action: 'À compléter', tone: undefined, icon: 'na', text: 'Ni couverture ni indice mesurables sur la période.' },
};

export function verdictOf({ coverage = null, index = null } = {}) {
  const c = coverage == null || !Number.isFinite(Number(coverage)) ? null : Number(coverage);
  const i = index == null || !Number.isFinite(Number(index)) ? null : Number(index);
  if (c == null && i == null) return { level: 'na', basis: 'none' };
  const basis = c != null && i != null ? 'both' : c != null ? 'coverage' : 'index';
  const T = VERDICT_THRESHOLDS;
  if ((c != null && c < T.critical.coverage) || (i != null && i < T.critical.index)) return { level: 'critique', basis };
  if ((i != null && i < T.watch.index) || (c != null && c < T.watch.coverage)) return { level: 'vigilance', basis };
  return { level: 'satisfaisant', basis };
}

/** Clé d'une activité (catégorie sans casse ni espaces de bord) — jumelle de performanceMath.activityKeyOf. */
export const activityKeyOf = (v) => String(v == null ? '' : v).trim().toLowerCase();

/** Clé d'une activité du registre côté serveur (coverageDefinitions.activityKey) : casse et espaces ignorés. */
export const coverageKeyOf = (v) => String(v == null ? '' : v).trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Couverture d'un groupe de GET /api/dashboards/coverage (total, activité, bureau) pour l'écran :
 *   active   sites de l'univers du groupe ;   realised  sites suivis (visite déclarée ou données) ;
 *   byData / byVisit / both  « dont … par données reçues · … par visites déclarées » ;
 *   rate     couverture (null sans site actif) ; planned  sites prévus (mois échus) ;
 *   execution  visites prévues suivies dans leur mois ÷ prévues (null sans plan).
 */
export function groupCoverage(g) {
  if (!g || !g.coverage) return null;
  return {
    active: g.sites || 0, realised: g.coverage.covered || 0,
    byData: g.coverage.byData || 0, byVisit: g.coverage.byVisit || 0, both: g.coverage.both || 0,
    rate: g.coverage.rate, planned: g.plannedSites ? g.plannedSites.planned : 0,
    execution: g.execution ? g.execution.rate : null,
    visitsPlanned: g.execution ? g.execution.planned : 0, visitsCovered: g.execution ? g.execution.covered : 0,
  };
}

/** Couverture d'une activité (libellé du registre) dans la réponse de couverture ; null sans site actif. */
export function activityCoverage(cov, category) {
  const k = coverageKeyOf(category);
  if (!cov || !k) return null;
  return groupCoverage((cov.byActivity || []).find((g) => g.key === k));
}

/** Couverture de chaque bureau de la réponse de couverture, par nom (sans casse) ; « — » = sans bureau. */
export function officeCoverageByName(cov) {
  const out = new Map();
  for (const g of (cov && cov.byOffice) || []) out.set(String(g.key).toLowerCase(), { name: g.label, ...groupCoverage(g) });
  return out;
}

/** Faits de sites d'une zone de la carte (signaux : risque élevé non suivi, jamais visités, effectifs). */
export function zoneCoverage(z) {
  if (!z || !z.counts) return null;
  const c = z.counts;
  const r = z.rates || {};
  return {
    active: c.active || 0,
    realised: c.realised || 0,
    planned: c.planned || 0,
    rate: r.coverage ? r.coverage.value : null,
    execution: r.execution ? r.execution.value : null,
    executionReason: r.execution ? r.execution.reason : null,
    riskHigh: c.riskHigh || 0,
    highUntouched: c.highUntouched || 0,
    neverVisited: c.neverVisited || 0,
    submissions: c.submissions || 0,
  };
}

/**
 * Signaux tirés des SITES (réponse de la carte), ajoutés à ceux du serveur (visites et
 * indicateurs) : sites à risque élevé ni prévus ni visités, sites actifs jamais visités.
 */
export function siteSignals(cov) {
  const out = [];
  if (!cov) return out;
  if (cov.highUntouched > 0) out.push({ kind: 'high_untouched', tone: 'urg', n: cov.highUntouched });
  if (cov.neverVisited > 0) out.push({ kind: 'never_visited', tone: 'imp', n: cov.neverVisited });
  return out;
}

/** Ordre des signaux : du plus grave au moins grave, ordre d'arrivée sinon. */
const TONE_RANK = { urg: 0, imp: 1, sat: 2, exc: 3, na: 4 };
export function sortSignals(list) {
  return (list || []).map((s, i) => ({ s, i })).sort((a, b) => (TONE_RANK[a.s.tone] ?? 9) - (TONE_RANK[b.s.tone] ?? 9) || a.i - b.i).map((x) => x.s);
}

/**
 * Activités en onglets (comme la maquette) : celles qui ont une fiche de suivi, un modèle
 * d'indicateurs, ou les fiches sans activité qui ont des données. Les autres activités du
 * registre (sites seulement) vont dans le tableau « autres activités » de la vue d'ensemble.
 */
export const isTabActivity = (a) => !!a && (a.kind === 'suivie' || a.kind === 'modele' || a.kind === 'sans');

/** Évolution d'un indice d'un mois à l'autre : flèche, sens et ton (hausse = mieux). */
export function trendArrow(delta) {
  if (!delta || delta.delta == null) return { arrow: '→', tone: 'na', word: 'stable', delta: null };
  if (delta.delta > 0) return { arrow: '↑', tone: 'up', word: 'en hausse', delta: delta.delta };
  if (delta.delta < 0) return { arrow: '↓', tone: 'down', word: 'en repli', delta: delta.delta };
  return { arrow: '→', tone: 'flat', word: 'stable', delta: 0 };
}

/** Dernier mois avec des données des fiches d'une activité (compteurs de /monitoring/periods). */
export function lastDataMonth(periods, formIds) {
  const ids = new Set(formIds || []);
  const months = ((periods && periods.months) || [])
    .filter((m) => !m.future && Object.entries(m.byForm || {}).some(([id, n]) => ids.has(id) && n > 0))
    .map((m) => m.month)
    .sort();
  return months.length ? months[months.length - 1] : null;
}

/**
 * Statut d'un taux de couverture — jumeau EXACT de server/src/modules/common/coverageStatus.js
 * (parité testée) : ≥ 80 % Bon · ≥ 60 % Moyen · ≥ 30 % Faible · sinon Critique ; sans taux
 * (aucun site actif) : null, jamais « Critique ».
 */
export const COVERAGE_THRESHOLDS = Object.freeze({ bon: 0.8, moyen: 0.6, faible: 0.3 });
export const COVERAGE_STATUS = {
  bon: { label: 'Bon', tone: 'green', icon: 'check' },
  moyen: { label: 'Moyen', tone: 'blue', icon: 'clock' },
  faible: { label: 'Faible', tone: 'orange', icon: 'warn' },
  critique: { label: 'Critique', tone: 'red', icon: 'x' },
};
export function coverageStatusKey(rate) {
  if (rate == null || !Number.isFinite(Number(rate))) return null;
  const r = Number(rate);
  if (r >= COVERAGE_THRESHOLDS.bon) return 'bon';
  if (r >= COVERAGE_THRESHOLDS.moyen) return 'moyen';
  if (r >= COVERAGE_THRESHOLDS.faible) return 'faible';
  return 'critique';
}
export const coverageStatusOf = (rate) => { const k = coverageStatusKey(rate); return k ? { key: k, ...COVERAGE_STATUS[k] } : null; };

/** Pourcentage arrondi d'un taux (0..1), null sans taux. */
export const pctOfRate = (r) => (r == null ? null : Math.round(r * 1000) / 10);

/** Valeur d'un indicateur pour l'affichage : « 73 % » pour un %, sinon le nombre. */
export function indicatorValueText(ind, fmtNumber) {
  if (!ind || ind.value == null) return '—';
  if (ind.percent || ind.agg === 'percent_yes' || ind.agg === 'percent_value') return `${Math.round(ind.value)}%`;
  return fmtNumber ? fmtNumber(ind.value) : String(ind.value);
}
