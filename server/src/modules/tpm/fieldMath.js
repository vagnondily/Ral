/**
 * Suivi terrain — pure, unit-tested math for site-visit coverage.
 * No I/O. A visit has a status ∈ (planifie, realise, annule); coverage is the
 * share of non-cancelled visits actually realised.
 */
const { ratesOf } = require('../common/siteActivity');

const STATUSES = ['planifie', 'realise', 'annule'];

function blank() { return { planifie: 0, realise: 0, annule: 0, total: 0, active: 0, rate: 0 }; }

function add(acc, status) {
  const s = STATUSES.includes(status) ? status : 'planifie';
  acc[s] += 1;
  acc.total += 1;
  acc.active = acc.planifie + acc.realise;       // annulées exclues du dénominateur
  acc.rate = acc.active > 0 ? acc.realise / acc.active : 0;
  return acc;
}

/**
 * Summarize a list of visits into overall coverage + breakdowns by provider,
 * district, office (bureau ou antenne de rattachement du site) and activity.
 * `providerLabel` maps a provider id → name.
 */
function summarizeVisits(visits, providerLabel = {}) {
  const overall = blank();
  const byProvider = new Map();
  const byDistrict = new Map();
  const byOffice = new Map();
  const byActivity = new Map();
  const bump = (map, key) => { if (!map.has(key)) map.set(key, blank()); return map.get(key); };

  for (const v of visits || []) {
    add(overall, v.status);
    add(bump(byProvider, v.providerId || 'non_affecte'), v.status);
    add(bump(byDistrict, v.district || '—'), v.status);
    add(bump(byOffice, v.office || '—'), v.status);
    add(bump(byActivity, v.activity || '—'), v.status);
  }

  const shape = (map, labelFor) => [...map.entries()]
    .map(([key, c]) => ({ key, label: labelFor ? labelFor(key) : key, ...c }))
    .sort((a, b) => b.total - a.total);

  return {
    overall,
    byProvider: shape(byProvider, (id) => (id === 'non_affecte' ? 'Non affecté' : (providerLabel[id] || id))),
    byDistrict: shape(byDistrict),
    byOffice: shape(byOffice, (name) => (name === '—' ? 'Sans bureau' : name)),
    byActivity: shape(byActivity),
  };
}

/**
 * Mise en forme du résumé terrain sur une PLAGE (lot 1b) à partir des faits site × mois
 * agrégés en SQL (common/siteActivitySql) — pure, testée.
 *
 * Chaque ligne garde les champs HÉRITÉS au même sens qu'avant (lignes de visites :
 * planifie / realise / annule / total / active = planifie + realise / rate — lus par
 * alertsMath.fieldAlerts et les cartes de couverture) et ajoute :
 *   sites  { active, planned, realised, realisedInactive } — sites DISTINCTS sur la période ;
 *   visits { planned, realised, cancelled, upcoming } — une visite = site × mois, comptée une fois ;
 *   coverage = sites réalisés ÷ sites actifs, planning = sites prévus ÷ sites actifs,
 *   execution = visites réalisées ÷ prévues sur les mois échus (common/siteActivity.ratesOf :
 *   null, jamais 0 %, sans site actif / sans plan / sans visite).
 * Les tableaux hérités (byOffice, byDistrict, byActivity, byProvider) ne listent que les
 * groupes qui ont des visites (total > 0), comme avant ; le total couvre tous les sites, et
 * `others.byDistrict|byOffice|byActivity` = { groups, sitesActive, list } dit les groupes SANS visite
 * (leurs sites actifs) : un tableau par groupe + « autres (sans visite) » = le total.
 *
 * @param {object[]} groupRows lignes { dim: 'overall'|'office'|'district'|'activity'|'month', key, districtLabel, known, …colonnes }
 * @param {object[]} providerRows lignes { key, label, planifie, realise, annule, sitesPlanned, sitesRealised }
 */
const num = (v) => Number(v) || 0;
/** Champs hérités d'une ligne de faits (lignes de visites). */
function legacyOf(r) {
  const planifie = num(r.planifie); const realise = num(r.realise); const annule = num(r.annule);
  const active = planifie + realise;
  return { planifie, realise, annule, total: planifie + realise + annule, active, rate: active > 0 ? realise / active : 0 };
}
/** Faits d'une ligne (SITE_FACT_COLUMNS / MONTH_FACT_COLUMNS) : sites, visites, trois taux (ratesOf). */
function factsOf(r) {
  const sites = { active: num(r.sitesActive), planned: num(r.sitesPlanned), realised: num(r.sitesRealised), realisedInactive: num(r.sitesRealisedInactive) };
  const visits = { planned: num(r.smPlanifie) + num(r.smRealise), realised: num(r.smRealise), cancelled: num(r.smAnnule), upcoming: num(r.upcoming) };
  const rates = ratesOf({ sitesActive: sites.active, sitesPlanned: sites.planned, sitesRealised: sites.realised, planifie: num(r.duePlanifie), realise: num(r.dueRealise) });
  return { sites, visits, ...rates };
}

function shapeRangeSummary(groupRows, providerRows = []) {
  const n = num;
  const legacy = legacyOf;
  const facts = factsOf;
  const byLabel = (a, b) => b.total - a.total || String(a.label).localeCompare(String(b.label));
  const allOf = (dim, labelOf) => groupRows.filter((r) => r.dim === dim)
    .map((r) => ({ key: r.key, label: labelOf(r), ...legacy(r), ...facts(r) }));
  const rowsOf = (dim, labelOf) => allOf(dim, labelOf).filter((r) => r.total > 0).sort(byLabel);
  // Groupes SANS visite (absents des tableaux par groupe) : leurs sites actifs, pour qu'un tableau
  // « par district / bureau / activité » se rapproche toujours du total (ligne « autres (sans visite) »).
  const othersOf = (dim, labelOf) => {
    const list = allOf(dim, labelOf).filter((r) => r.total === 0 && r.sites.active > 0)
      .map((r) => ({ key: r.key, label: r.label, sitesActive: r.sites.active }))
      .sort((a, b) => b.sitesActive - a.sitesActive || String(a.label).localeCompare(String(b.label)));
    return { groups: list.length, sitesActive: list.reduce((n, r) => n + r.sitesActive, 0), list };
  };
  const officeLabel = (r) => (r.key === '—' ? 'Sans bureau' : r.key);
  const districtLabel = (r) => r.districtLabel || r.key;
  const overallRow = groupRows.find((r) => r.dim === 'overall') || {};
  const monthly = groupRows.filter((r) => r.dim === 'month').map((r) => {
    const f = facts(r);
    return {
      month: r.key, activationKnown: r.known === true,
      sitesActive: f.sites.active, sitesPlanned: f.sites.planned, sitesRealised: f.sites.realised, sitesRealisedInactive: f.sites.realisedInactive,
      ...legacy(r), visits: f.visits, coverage: f.coverage, planning: f.planning, execution: f.execution,
    };
  }).sort((a, b) => a.month.localeCompare(b.month));
  const byProvider = providerRows.map((r) => ({
    key: r.key, label: r.key === 'non_affecte' ? 'Non affecté' : (r.label || r.key), ...legacy(r),
    sites: { planned: n(r.sitesPlanned), realised: n(r.sitesRealised) },
  })).sort(byLabel);
  return {
    activationKnown: monthly.length > 0 && monthly.every((m) => m.activationKnown),
    overall: { ...legacy(overallRow), ...facts(overallRow) },
    byProvider,
    byDistrict: rowsOf('district', districtLabel),
    byOffice: rowsOf('office', officeLabel),
    byActivity: rowsOf('activity', (r) => r.key),
    others: {
      byDistrict: othersOf('district', districtLabel),
      byOffice: othersOf('office', officeLabel),
      byActivity: othersOf('activity', (r) => r.key),
    },
    monthly,
  };
}

/**
 * Faits de COUVERTURE d'une période (concepteur de rapport, lot 7a) — mêmes faits site ×
 * mois et mêmes taux que shapeRangeSummary (factsOf → ratesOf), mais un groupe est gardé
 * dès qu'il a un site actif OU une visite : une activité dont les sites actifs n'ont reçu
 * aucune visite montre 0 % (et non une ligne absente). `month_activity` : faits par mois ×
 * activité (complétude mensuelle).
 * @param {object[]} groupRows lignes { dim: 'overall'|'office'|'district'|'activity'|'month'|'month_activity', key, sub, districtLabel, known, …colonnes }
 */
function shapeCoverageFacts(groupRows) {
  const row = (r, label) => {
    const f = factsOf(r);
    return { key: r.key, label, sitesTotal: num(r.sitesTotal), ...legacyOf(r), ...f };
  };
  const keep = (x) => x.sites.active > 0 || x.total > 0 || x.sites.realisedInactive > 0;
  const bySites = (a, b) => b.sites.active - a.sites.active || b.total - a.total || String(a.label).localeCompare(String(b.label), 'fr');
  const rowsOf = (dim, labelOf) => groupRows.filter((r) => r.dim === dim).map((r) => row(r, labelOf(r))).filter(keep).sort(bySites);
  const overallRow = groupRows.find((r) => r.dim === 'overall') || {};
  const monthOf = (r) => ({ ...row(r, r.key), month: r.key, activationKnown: r.known === true });
  const monthly = groupRows.filter((r) => r.dim === 'month').map(monthOf).sort((a, b) => a.month.localeCompare(b.month));
  const monthlyByActivity = groupRows.filter((r) => r.dim === 'month_activity')
    .map((r) => ({ ...monthOf(r), activity: r.sub }))
    .sort((a, b) => a.month.localeCompare(b.month) || String(a.activity).localeCompare(String(b.activity), 'fr'));
  return {
    activationKnown: monthly.length > 0 && monthly.every((m) => m.activationKnown),
    overall: row(overallRow, null),
    byOffice: rowsOf('office', (r) => r.key),
    byDistrict: rowsOf('district', (r) => r.districtLabel || r.key),
    byActivity: rowsOf('activity', (r) => r.key),
    monthly,
    monthlyByActivity,
  };
}

/**
 * Jours de collecte par prestataire = journées de visite (non annulées) + jours de déplacement
 * (majoration manuelle). `visits` carry providerId, status, visitDate and agent; `travelByProvider`
 * maps providerId → travel days; `providerLabel` maps providerId → name.
 *   journée de visite = une date d'un AGENT : les visites d'un même agent le même jour (une commune
 *     de la tournée, plusieurs sites — plan généré avec « Écrire les dates et les agents ») font UNE
 *     journée ; une visite datée sans agent compte une journée à elle seule (comme avant) ;
 *   DIFFÉRENCE ASSUMÉE avec les journées-agent du plan (planResources) : une visite de plusieurs
 *     jours (moins d'un suivi par jour au MMR) ne porte que sa date de DÉBUT, seule enregistrée ;
 *     elle compte donc UNE journée ici, alors que le plan compte (et réserve) toute sa durée.
 *     Pour un plan où chaque visite tient en un jour (≥ 1 suivi par jour), les deux mesures
 *     coïncident ;
 *   total = journées de visite + jours de déplacement
 */
function collectionDays(visits, travelByProvider = {}, providerLabel = {}) {
  const byProv = new Map();
  const bump = (id) => { if (!byProv.has(id)) byProv.set(id, { visitDays: 0, cells: new Set() }); return byProv.get(id); };
  for (const v of visits || []) {
    if (!v.providerId || v.status === 'annule' || !v.visitDate) continue;
    const p = bump(v.providerId);
    const agent = String(v.agent == null ? '' : v.agent).trim().toLowerCase();
    if (!agent) { p.visitDays += 1; continue; }
    const cell = `${agent}|${String(v.visitDate).slice(0, 10)}`;
    if (!p.cells.has(cell)) { p.cells.add(cell); p.visitDays += 1; }
  }
  // Include providers that only have travel days entered.
  for (const id of Object.keys(travelByProvider)) if (!byProv.has(id)) bump(id);
  return [...byProv.entries()].map(([providerId, c]) => {
    const travelDays = Math.max(0, Math.round(Number(travelByProvider[providerId]) || 0));
    return {
      providerId,
      label: providerLabel[providerId] || providerId,
      visitDays: c.visitDays,
      travelDays,
      totalDays: c.visitDays + travelDays,
    };
  }).sort((a, b) => b.totalDays - a.totalDays);
}

/** Taux de couverture d'une cellule = réalisées / (planifiées + réalisées). */
function coverageRate(planifie, realise) {
  const p = Number(planifie) || 0; const r = Number(realise) || 0; const active = p + r;
  return { planifie: p, realise: r, active, rate: active > 0 ? r / active : null };
}

/**
 * Matrice de couverture mensuelle par groupe (programme/activité ou prestataire)
 * pour une année : 12 mois × groupes, taux par cellule, totaux par groupe, par
 * mois et global. `rows` = [{month:'YYYY-MM', key, label, planifie, realise}].
 * Logique pure, testée.
 */
function buildCoverageMatrix(rows, yearOrMonths) {
  // Une année (12 colonnes, comportement historique) ou la liste des mois d'une période (lot 1b).
  const byMonths = Array.isArray(yearOrMonths);
  const y = byMonths ? null : Number(yearOrMonths);
  const months = byMonths ? [...yearOrMonths] : Array.from({ length: 12 }, (_, i) => `${y}-${String(i + 1).padStart(2, '0')}`);
  const groups = new Map();
  for (const r of rows || []) {
    if (!groups.has(r.key)) groups.set(r.key, { key: r.key, label: r.label, byMonth: new Map() });
    const g = groups.get(r.key);
    const cur = g.byMonth.get(r.month) || { planifie: 0, realise: 0 };
    cur.planifie += Number(r.planifie) || 0; cur.realise += Number(r.realise) || 0;
    g.byMonth.set(r.month, cur);
  }
  const monthTotals = months.map(() => ({ planifie: 0, realise: 0 }));
  const shaped = [...groups.values()].map((g) => {
    const cells = months.map((m, i) => {
      const c = g.byMonth.get(m) || { planifie: 0, realise: 0 };
      monthTotals[i].planifie += c.planifie; monthTotals[i].realise += c.realise;
      return { month: m, ...coverageRate(c.planifie, c.realise) };
    });
    const tp = cells.reduce((a, c) => a + c.planifie, 0);
    const tr = cells.reduce((a, c) => a + c.realise, 0);
    return { key: g.key, label: g.label, cells, total: coverageRate(tp, tr) };
  }).sort((a, b) => b.total.realise - a.total.realise || String(a.label).localeCompare(String(b.label)));
  const monthlyTotals = monthTotals.map((c, i) => ({ month: months[i], ...coverageRate(c.planifie, c.realise) }));
  const gp = monthTotals.reduce((a, c) => a + c.planifie, 0);
  const gr = monthTotals.reduce((a, c) => a + c.realise, 0);
  return { year: y, months, groups: shaped, monthlyTotals, total: coverageRate(gp, gr) };
}

module.exports = { STATUSES, summarizeVisits, shapeRangeSummary, shapeCoverageFacts, factsOf, collectionDays, coverageRate, buildCoverageMatrix };
