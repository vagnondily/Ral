/**
 * Lecture à l'écran des mesures de couverture (retour 110) — réponse de GET /api/dashboards/coverage
 * (serveur : modules/dashboards/coverageDefinitions.js, UNE définition par mesure). La Synthèse du
 * suivi de processus et « Couverture & performance du suivi » passent par ici : mêmes chiffres,
 * mêmes mots. Module pur, testé par server/test/webCoverageDefs.test.js.
 *
 *  - suivi = visite déclarée réalisée OU données reçues rattachées au site ; chaque mesure dit
 *    « dont … par données reçues · … par visites déclarées » (waysText) ;
 *  - un taux s'écrit avec une décimale sous 10 % (« 0,5 % », jamais « 0 % » pour 0,48 %) et « — »
 *    sans dénominateur (rateText = formatRate de la carte) ;
 *  - l'univers est énoncé une fois par page (universeOf).
 */
import { formatRate } from './mapScale.js';

/** Taux affiché : « 55 % », « 0,5 % », « < 0,1 % », « — » (null). */
export const rateText = (rate, lang = 'fr') => formatRate(rate, lang);

/** Pourcentage arrondi pour une barre (0–100), null sans taux. */
export const barPct = (rate) => (rate == null || !Number.isFinite(rate) ? null : Math.max(0, Math.min(100, rate * 100)));

/**
 * « dont {d} par données reçues · {v} par visites déclarées » (+ « ({b} par les deux) » quand un même
 * site, ou une même visite, compte des deux façons) ; vide sans suivi.
 * @param {(s:string, v?:object)=>string} tr  @param {{covered,byData,byVisit,both}} m  @param {(n:number)=>string} fmt
 */
export function waysText(tr, m, fmt = String) {
  if (!m || !(m.covered > 0)) return '';
  const base = tr('dont {d} par données reçues · {v} par visites déclarées', { d: fmt(m.byData || 0), v: fmt(m.byVisit || 0) });
  return m.both > 0 ? `${base} ${tr('({b} par les deux)', { b: fmt(m.both) })}` : base;
}

/**
 * Visites prévues à venir (jamais « non exécutées ») : « {n} à venir », et celles posées sur des mois
 * pas encore « Oui » (grille non renseignée pour la fin d'année, par exemple) le disent ; vide sans visite.
 */
export function upcomingText(tr, ex, fmt = String) {
  if (!ex) return '';
  const n = (ex.upcoming || 0) + (ex.upcomingUnset || 0);
  if (!n) return '';
  return ex.upcomingUnset > 0
    ? tr('{n} à venir, dont {m} sur des mois sans « Oui »', { n: fmt(n), m: fmt(ex.upcomingUnset) })
    : tr('{n} à venir', { n: fmt(n) });
}

/** « Sites à jour » écrit de la même façon sur les deux pages : « 16 (21 %) » ; « — » sans site actif au mois de référence. */
export function upToDateText(rbm, lang = 'fr', fmt = String) {
  if (!rbm || !(rbm.sites > 0)) return '—';
  return `${fmt(rbm.upToDate)} (${rateText(rbm.rate, lang)})`;
}

/**
 * Univers de la page : `grid` (grille des sites actifs pour toute la période), `none` (aucune grille :
 * tout le registre hors zones interdites), `partial` (une année sans grille : tout le registre).
 * null sans réponse.
 */
export function universeOf(cov) {
  const u = cov && cov.universe;
  if (!u) return null;
  const kind = u.activation === 'grid' ? 'grid' : u.activation === 'partial' ? 'partial' : 'none';
  const o = cov.overall || {};
  return {
    kind, sites: u.sites || 0, inactive: u.inactive || 0, forbidden: u.forbidden || 0, registry: u.registry || 0,
    // Dit sous l'univers, jamais compté : activité pendant un mois sans « Oui », visites annulées.
    outside: o.outside || 0, cancelled: (o.execution && o.execution.cancelled) || 0,
  };
}

/**
 * Lignes « Plan vs Réalisé » : visites prévues → suivies dans leur mois ; sites prévus → suivis ;
 * communes de l'univers → communes avec des données — la même unité des deux côtés.
 */
export function planVsRealRows(cov) {
  if (!cov || !cov.overall) return [];
  const o = cov.overall;
  return [
    { id: 'visits', planned: o.execution.planned, done: o.execution.covered, rate: o.execution.rate, ways: o.execution, upcoming: o.execution.upcoming },
    { id: 'sites', planned: o.plannedSites.planned, done: o.plannedSites.covered, rate: o.plannedSites.rate, ways: o.plannedSites },
    { id: 'communes', planned: cov.communes.total, done: cov.communes.withData, rate: cov.communes.rate, ways: null },
  ];
}

/**
 * Tableau « Couverture par activité » : une ligne par libellé d'activité du registre (aucune
 * correspondance inventée entre deux libellés), puis le total de la page — égal à la somme des
 * lignes (vérifié par le serveur, test/coverageDefinitions.test.js).
 */
export function activityTableRows(cov) {
  if (!cov || !cov.overall) return { rows: [], total: null };
  const row = (g) => ({
    key: g.key, label: g.key === '—' ? null : g.label, sites: g.sites,
    planned: g.plannedSites.planned, plannedCovered: g.plannedSites.covered, covered: g.coverage.covered,
    byData: g.coverage.byData, byVisit: g.coverage.byVisit, both: g.coverage.both,
    coverage: g.coverage.rate, execution: g.plannedSites.rate,
  });
  return { rows: (cov.byActivity || []).map(row), total: row({ ...cov.overall, key: 'total', label: null }) };
}

/**
 * Groupes (bureaux, districts) dont l'exécution du plan (visites) est sous le seuil — les plus
 * faibles d'abord ; un groupe sans visite prévue n'y figure jamais (« — aucun plan », pas 0 %).
 */
export function watchList(groups, { threshold = 0.8, limit = 8 } = {}) {
  return (groups || [])
    .filter((g) => g.execution && g.execution.planned > 0 && g.execution.rate != null && g.execution.rate < threshold)
    .sort((a, b) => a.execution.rate - b.execution.rate || b.execution.planned - a.execution.planned)
    .slice(0, limit);
}
