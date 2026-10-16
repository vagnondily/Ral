/**
 * Définitions UNIQUES des mesures de couverture des tableaux de bord (retour 110) — PUR, testé
 * (test/coverageDefinitions.test.js ; concordance en base : test/coverageDb.test.js).
 *
 * La Synthèse du suivi de processus et « Couverture & performance du suivi » lisent la même
 * réponse (GET /api/dashboards/coverage), calculée par le service unique des faits site × mois
 * (common/siteActivitySql.siteMonthFactsCtes, mode « données ») puis mise en forme ici :
 *
 *  - Univers U = sites actifs au moins un mois de la période (règle unique : jamais en zone
 *    interdite ; « Oui » de la grille des sites actifs, ou tout le registre l'année sans grille).
 *  - « Suivi » d'un site × mois = visite déclarée réalisée OU données reçues rattachées au site
 *    (fiche compatible avec son activité) ; chaque mesure dit « dont … par données reçues · … par
 *    visites déclarées » (un même site × mois peut compter pour les deux : `both`).
 *  - Couverture (sites) = sites de U suivis au moins une fois pendant un de leurs mois actifs ÷ |U|.
 *  - Exécution du plan (visites) = visites prévues (site × mois actif ÉCHU, non annulées) suivies
 *    dans leur mois ÷ visites prévues ; les visites des mois à venir sont rendues à part (`upcoming`).
 *  - Sites prévus = sites de U ayant une visite prévue un mois actif échu → dont suivis.
 *  - Sites à jour (RBM) = parmi les sites de U actifs au mois de référence (dernier mois de la
 *    période), ceux qui ne sont pas « à suivre » — jamais tout le registre.
 *  - Données versées (plan vs réalisé) = communes des sites de U → communes avec des données
 *    (rattachées à un site de U, ou reçues pour la commune d'une fiche compatible) : même unité
 *    des deux côtés.
 *  - Par activité, par bureau, par district : le même U et le même « suivi » ; chaque découpage
 *    est une partition de U, ses lignes se somment aux totaux (checkConsistency).
 * Un taux sans dénominateur vaut null (« — »), jamais 0 %.
 */

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const ratio = (n, d) => (d > 0 ? n / d : null);

/** Colonnes de comptage d'un groupe (mêmes noms que la requête SQL de coverage.repository). */
const COUNT_KEYS = [
  'registry', 'forbidden', 'sites', 'covered', 'coveredData', 'coveredVisit',
  'plannedSites', 'plannedCovered', 'plannedData', 'plannedVisit',
  'visitsPlanned', 'visitsCovered', 'visitsData', 'visitsVisit', 'visitsUpcoming',
  'refSites', 'refDue', 'refHigh', 'refMid', 'refLow',
];

/**
 * Comptes d'UN site (une ligne de per_site, ou le jumeau pur common/siteActivity.siteRangeFacts
 * complété) — la règle écrite une fois, comparée à la requête SQL par le test en base.
 * @param {object} f faits du site : active, forbidden, realisedAny, realisedData, realised,
 *   plannedDue, vPlanned, vPlannedRealised, vPlannedData, vPlannedVisit, vUpcoming,
 *   activeRef (actif au mois de référence), due (RBM « à suivre » au mois de référence), risk
 */
function siteCounts(f) {
  const u = Boolean(f.active);
  const ref = u && Boolean(f.activeRef);
  const pd = u && Boolean(f.plannedDue);
  const any = u && Boolean(f.realisedAny);
  return {
    registry: 1,
    forbidden: f.forbidden ? 1 : 0,
    sites: u ? 1 : 0,
    covered: any ? 1 : 0,
    coveredData: u && f.realisedData ? 1 : 0,
    coveredVisit: u && f.realised ? 1 : 0,
    plannedSites: pd ? 1 : 0,
    plannedCovered: pd && any ? 1 : 0,
    plannedData: pd && f.realisedData ? 1 : 0,
    plannedVisit: pd && f.realised ? 1 : 0,
    visitsPlanned: u ? num(f.vPlanned) : 0,
    visitsCovered: u ? num(f.vPlannedRealised) : 0,
    visitsData: u ? num(f.vPlannedData) : 0,
    visitsVisit: u ? num(f.vPlannedVisit) : 0,
    visitsUpcoming: u ? num(f.vUpcoming) : 0,
    refSites: ref ? 1 : 0,
    refDue: ref && f.due ? 1 : 0,
    refHigh: ref && f.risk === 'elevee' ? 1 : 0,
    refMid: ref && f.risk === 'moyenne' ? 1 : 0,
    refLow: ref && f.risk === 'faible' ? 1 : 0,
  };
}

/**
 * Lignes « GROUPING SETS » calculées en JavaScript à partir des comptes par site (jumeau de la
 * requête : total, par activité, par bureau, par district). `keys` donne la clé de chaque site.
 * @param {{ counts: object, activity: string, office: string, district: string }[]} sites
 */
function groupRows(sites) {
  const rows = new Map();
  const add = (dim, key, c, label) => {
    const k = `${dim}|${key}`;
    if (!rows.has(k)) rows.set(k, { dim, key, label: label == null ? key : label, ...Object.fromEntries(COUNT_KEYS.map((x) => [x, 0])) });
    const r = rows.get(k);
    for (const x of COUNT_KEYS) r[x] += num(c[x]);
  };
  for (const s of sites || []) {
    add('overall', null, s.counts);
    add('activity', activityKey(s.activity), s.counts, s.activity || '—');
    add('office', s.office || '—', s.counts);
    add('district', s.district || '—', s.counts);
  }
  return [...rows.values()];
}

/** Clé d'activité d'un site : libellé du registre, casse et espaces ignorés ; « — » sans activité. */
function activityKey(label) {
  const k = String(label == null ? '' : label).trim().replace(/\s+/g, ' ').toLowerCase();
  return k || '—';
}

/** Mesures d'un groupe à partir de ses comptes (ligne SQL ou groupRows). */
function measuresOf(r) {
  const sites = num(r.sites);
  const covered = num(r.covered); const coveredData = num(r.coveredData); const coveredVisit = num(r.coveredVisit);
  const planned = num(r.plannedSites); const plannedCovered = num(r.plannedCovered);
  const plannedData = num(r.plannedData); const plannedVisit = num(r.plannedVisit);
  const vp = num(r.visitsPlanned); const vc = num(r.visitsCovered); const vd = num(r.visitsData); const vv = num(r.visitsVisit);
  const refSites = num(r.refSites); const refDue = num(r.refDue);
  return {
    sites,
    coverage: { covered, byData: coveredData, byVisit: coveredVisit, both: Math.max(0, coveredData + coveredVisit - covered), rate: ratio(covered, sites) },
    plannedSites: { planned, covered: plannedCovered, byData: plannedData, byVisit: plannedVisit, both: Math.max(0, plannedData + plannedVisit - plannedCovered), rate: ratio(plannedCovered, planned) },
    execution: { planned: vp, covered: vc, byData: vd, byVisit: vv, both: Math.max(0, vd + vv - vc), upcoming: num(r.visitsUpcoming), rate: ratio(vc, vp) },
    rbm: {
      sites: refSites, due: refDue, upToDate: refSites - refDue, rate: ratio(refSites - refDue, refSites),
      byRisk: { elevee: num(r.refHigh), moyenne: num(r.refMid), faible: num(r.refLow) },
    },
  };
}

const NONE = '—';
const bySites = (a, b) => (a.key === NONE) - (b.key === NONE) || b.sites - a.sites
  || String(a.label).localeCompare(String(b.label), 'fr');

/**
 * Réponse de GET /api/dashboards/coverage à partir des lignes groupées (SQL ou groupRows).
 * Un groupe sans site de l'univers n'est pas listé (il ne porte aucune mesure) ; « — » (sans
 * activité, sans bureau, district inconnu) toujours en dernier.
 * @param {object[]} rows lignes { dim: 'overall'|'activity'|'office'|'district', key, label?,
 *   activityLabel?, districtLabel?, knownAll?, knownAny?, communes?, communesData?, …COUNT_KEYS }
 * @param {{ refMonth?: string }} opts mois de référence de l'état RBM (« AAAA-MM »)
 */
function shapeCoverage(rows, { refMonth = null } = {}) {
  const list = rows || [];
  const overallRow = list.find((r) => r.dim === 'overall') || {};
  const groupsOf = (dim, labelOf) => list.filter((r) => r.dim === dim)
    .map((r) => ({ key: r.key == null ? NONE : r.key, label: labelOf(r), ...measuresOf(r) }))
    .filter((g) => g.sites > 0)
    .sort(bySites);
  const overall = measuresOf(overallRow);
  const registry = num(overallRow.registry);
  const forbidden = num(overallRow.forbidden);
  const activation = overallRow.knownAll === true ? 'grid' : overallRow.knownAny === true ? 'partial' : 'none';
  const communes = num(overallRow.communes); const communesData = num(overallRow.communesData);
  return {
    refMonth,
    universe: {
      sites: overall.sites, registry, forbidden,
      // Sites du registre hors de l'univers sans être en zone interdite : aucun « Oui » sur la période.
      inactive: Math.max(0, registry - overall.sites - forbidden),
      activation,
    },
    overall,
    communes: { total: communes, withData: communesData, rate: ratio(communesData, communes) },
    byActivity: groupsOf('activity', (r) => (r.key === NONE || r.key == null ? NONE : (r.activityLabel || r.label || r.key))),
    byOffice: groupsOf('office', (r) => r.label || r.key),
    byDistrict: groupsOf('district', (r) => r.districtLabel || r.label || r.key),
  };
}

const SUM_PATHS = [
  ['sites'], ['coverage', 'covered'], ['coverage', 'byData'], ['coverage', 'byVisit'],
  ['plannedSites', 'planned'], ['plannedSites', 'covered'], ['execution', 'planned'], ['execution', 'covered'],
  ['execution', 'byData'], ['execution', 'byVisit'], ['execution', 'upcoming'], ['rbm', 'sites'], ['rbm', 'due'],
];
const at = (o, p) => p.reduce((x, k) => (x == null ? x : x[k]), o);

/**
 * Concordance d'une réponse : chaque découpage se somme aux totaux, et chaque sous-ensemble
 * reste dans son ensemble (prévus ≤ U, suivis ≤ U, à jour ≤ actifs au mois de référence…).
 * @returns {string[]} écarts (vide = cohérent)
 */
function checkConsistency(shape) {
  const out = [];
  const o = shape.overall;
  for (const dim of ['byActivity', 'byOffice', 'byDistrict']) {
    for (const p of SUM_PATHS) {
      const sum = (shape[dim] || []).reduce((n, g) => n + num(at(g, p)), 0);
      if (sum !== num(at(o, p))) out.push(`${dim} : Σ ${p.join('.')} = ${sum} ≠ total ${at(o, p)}`);
    }
  }
  const le = (a, b, what) => { if (num(a) > num(b)) out.push(`${what} : ${a} > ${b}`); };
  le(o.coverage.covered, o.sites, 'sites suivis ≤ univers');
  le(o.coverage.byData, o.coverage.covered, 'suivis par données ≤ suivis');
  le(o.coverage.byVisit, o.coverage.covered, 'suivis par visites ≤ suivis');
  le(o.coverage.covered, o.coverage.byData + o.coverage.byVisit, 'suivis ≤ par données + par visites');
  le(o.plannedSites.planned, o.sites, 'sites prévus ≤ univers');
  le(o.plannedSites.covered, o.plannedSites.planned, 'sites prévus suivis ≤ sites prévus');
  le(o.plannedSites.covered, o.coverage.covered, 'sites prévus suivis ≤ sites suivis');
  le(o.execution.covered, o.execution.planned, 'visites suivies ≤ visites prévues');
  le(o.rbm.sites, o.sites, 'actifs au mois de référence ≤ univers');
  le(o.rbm.due, o.rbm.sites, 'à suivre ≤ actifs au mois de référence');
  le(shape.communes.withData, shape.communes.total, 'communes avec données ≤ communes de l\'univers');
  le(o.sites, shape.universe.registry - shape.universe.forbidden, 'univers ≤ registre hors zones interdites');
  return out;
}

module.exports = { COUNT_KEYS, siteCounts, groupRows, activityKey, measuresOf, shapeCoverage, checkConsistency, ratio };
