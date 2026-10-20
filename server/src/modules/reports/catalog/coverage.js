const { coverageStatus } = require('../../common/coverageStatus');
const { monthsOf } = require('../../common/period');
const { boardKpis, rankSites } = require('../../tpm/planBoard');
const { phrases } = require('../phrases');
const { col, ratePct, pctOf } = require('./facts');

/**
 * Jeux de données « Couverture et plan » (lot 7a, C4) — déclarations PURES. Source
 * principale : covFacts = le SERVICE UNIQUE des faits site × mois du lot 1b
 * (field.repository.coverageFacts → siteMonthFactsCtes, ratesOf) : sites actifs, prévus,
 * réalisés, couverture = sites actifs réalisés ÷ sites actifs (jamais des clés de
 * soumissions ÷ sites : fin du « 435,9 % »), « — aucun plan » (null) jamais 0 %.
 * Statut d'une couverture : common/coverageStatus (Bon / Moyen / Faible / Critique).
 */

const ORIGIN_COV = { page: 'Dashboard › Couverture & performance', route: '#/dashboard/couverture' };
const ORIGIN_FIELD = { page: 'Suivi de processus › Affectation & visites', route: '#/processus/sites' };
const ORIGIN_PLAN = { page: 'Suivi de processus › Plan de suivi', route: '#/processus/plan' };
// Bureau des faits site × mois : bureau MEMS (id) ou « sans bureau » — un libellé de fiche n'y a pas de sens.
const SITE_OFFICE = ['id', 'unlinked'];

function ds(key, def) {
  return { key, group: 'coverage', filters: ['office', 'activity'], officeKinds: SITE_OFFICE, periodMode: 'range', ...def };
}

/** Colonnes de faits d'un groupe de sites. */
const FACT_COLS = [
  col('sitesActive', 'Sites actifs', 'int'), col('sitesPlanned', 'Sites prévus', 'int'), col('sitesRealised', 'Sites réalisés', 'int'),
  col('coverage', 'Couverture', 'pct'), col('status', 'Statut', 'status'), col('planned', 'Visites prévues', 'int'),
  col('done', 'Visites réalisées', 'int'), col('execution', 'Exécution du plan', 'pct'),
];
const factRow = (r) => ({
  sitesActive: r.sites.active, sitesPlanned: r.sites.planned, sitesRealised: r.sites.realised,
  coverage: ratePct(r.coverage), status: coverageStatus(r.coverage), planned: r.visits.planned, done: r.visits.realised,
  execution: ratePct(r.execution), planning: ratePct(r.planning), realisedInactive: r.sites.realisedInactive, upcoming: r.visits.upcoming,
});
const meta = (raw, ctx, extra = {}) => ({
  n: raw.overall ? raw.overall.sites.active : 0, nLabel: 'sites actifs', definition: phrases(ctx.lang).definitions.coverage,
  warnings: raw.activationKnown === false ? ['activation_unknown'] : [], ...extra,
});

const KPI_COLS = [
  col('sitesActive', 'Sites actifs', 'int'), col('sitesPlanned', 'Sites prévus', 'int'), col('sitesRealised', 'Sites réalisés', 'int'),
  col('coverage', 'Couverture', 'pct'), col('planning', 'Planification', 'pct'), col('execution', 'Exécution du plan', 'pct'),
  col('planned', 'Visites prévues', 'int'), col('done', 'Visites réalisées', 'int'), col('upcoming', 'Visites à venir', 'int'),
  col('realisedInactive', 'Réalisées hors mois actif', 'int'),
];
const covKpis = ds('cov.kpis', {
  label: 'Couverture terrain (chiffres clés)', origin: ORIGIN_COV, source: 'covFacts', views: ['kpi', 'table'], defaultView: 'kpi',
  columns: KPI_COLS,
  shape(raw, eff, ctx) { return { columns: KPI_COLS, rows: [{ _key: 'overall', ...factRow(raw.overall) }], meta: meta(raw, ctx) }; },
});

const groupDs = (key, label, list, first, extra = {}) => ds(key, {
  label, origin: ORIGIN_COV, source: 'covFacts', views: ['table', 'bar'], defaultView: 'table',
  columns: [first, ...FACT_COLS], measures: ['coverage'],
  shape(raw, eff, ctx) {
    const thr = ctx.args && ctx.args.threshold != null ? Number(ctx.args.threshold) : null;
    const rows = (raw[list] || []).map((r) => ({ _key: r.key, [first.key]: r.label, ...factRow(r) }))
      .filter((r) => thr == null || (r.coverage != null && r.coverage < thr));
    return { columns: [first, ...FACT_COLS], rows, meta: meta(raw, ctx) };
  },
  ...extra,
});
const byActivity = groupDs('cov.by_activity', 'Couverture par activité (avec statut)', 'byActivity', col('activity', 'Activité'), { annotate: { label: 'Constat' } });
const byOffice = groupDs('cov.by_office', 'Couverture par bureau', 'byOffice', col('bureau', 'Bureau'));
const byDistrict = groupDs('cov.by_district', 'Couverture par district', 'byDistrict', col('district', 'District'), {
  args: { threshold: { type: 'number', label: 'Zones à surveiller : couverture < … %', default: null } },
});

const MONTHLY_COLS = [
  col('month', 'Mois', 'month'), col('planned', 'Visites prévues', 'int'), col('done', 'Visites réalisées', 'int'),
  col('sitesActive', 'Sites actifs', 'int'), col('sitesPlanned', 'Sites prévus', 'int'), col('sitesRealised', 'Sites réalisés', 'int'),
  col('coverage', 'Couverture', 'pct'), col('execution', 'Exécution du plan', 'pct'),
];
const monthly = ds('cov.monthly', {
  label: 'Plan et réalisé par mois', origin: ORIGIN_COV, source: 'covFacts', views: ['column', 'line', 'table', 'bar'], defaultView: 'column',
  columns: MONTHLY_COLS, measures: ['planned', 'done'],
  shape(raw, eff, ctx) {
    const rows = (raw.monthly || []).map((m) => { const f = factRow(m); return { _key: m.month, month: m.month, ...f }; });
    return { columns: MONTHLY_COLS, rows, meta: meta(raw, ctx) };
  },
});

const completeness = ds('cov.completeness_monthly', {
  label: 'Complétude mensuelle par activité', origin: ORIGIN_COV, source: 'covFacts', views: ['heat', 'line', 'table'], defaultView: 'heat',
  columns: [col('activity', 'Activité'), col('target', 'Sites actifs (période)', 'int')], dynamicColumns: 'months',
  shape(raw, eff, ctx) {
    const months = eff.period ? monthsOf(eff.period) : [...new Set((raw.monthly || []).map((m) => m.month))].sort();
    const per = new Map();
    for (const m of raw.monthlyByActivity || []) {
      if (!per.has(m.activity)) per.set(m.activity, new Map());
      per.get(m.activity).set(m.month, m);
    }
    const target = new Map((raw.byActivity || []).map((a) => [a.key, a.sites.active]));
    const rows = [...per].filter(([a]) => (target.get(a) || 0) > 0).map(([a, byM]) => ({
      _key: a, activity: a, target: target.get(a) || 0,
      ...Object.fromEntries(months.map((m) => { const x = byM.get(m); return [`m:${m}`, x ? ratePct(x.coverage) : null]; })),
    })).sort((x, y) => y.target - x.target || x.activity.localeCompare(y.activity, 'fr'));
    return { columns: [col('activity', 'Activité'), col('target', 'Sites actifs (période)', 'int'), ...months.map((m) => col(`m:${m}`, m, 'pct'))], rows, meta: meta(raw, ctx) };
  },
});

// ---- Visites, matrice, récapitulatif MMR, jours de collecte, mois ---------------------------
const PROV_COLS = [
  col('provider', 'TPM'), col('planifie', 'Planifiées', 'int'), col('realise', 'Réalisées', 'int'), col('annule', 'Annulées', 'int'),
  col('rate', 'Taux de réalisation', 'pct'), col('sitesPlanned', 'Sites prévus', 'int'), col('sitesRealised', 'Sites réalisés', 'int'),
];
const visitsByProvider = ds('cov.visits_by_provider', {
  label: 'Visites par TPM', origin: ORIGIN_FIELD, source: 'covFacts', filters: ['office', 'activity', 'partner'],
  views: ['bar', 'table'], defaultView: 'table', columns: PROV_COLS, measures: ['planifie', 'realise'],
  shape(raw, eff, ctx) {
    const T = phrases(ctx.lang);
    const rows = (raw.byProvider || []).filter((p) => !eff.partnerId || p.key === eff.partnerId).map((p) => ({
      _key: p.key, provider: p.key === 'non_affecte' ? T.unassigned : p.label, planifie: p.planifie, realise: p.realise, annule: p.annule,
      rate: pctOf(p.realise, p.planifie + p.realise), sitesPlanned: p.sites.planned, sitesRealised: p.sites.realised,
    }));
    return { columns: PROV_COLS, rows, meta: { n: rows.reduce((a, r) => a + r.planifie + r.realise + r.annule, 0), nLabel: 'visites' } };
  },
});

const matrix = ds('cov.matrix', {
  label: 'Matrice mensuelle par programme ou TPM', origin: ORIGIN_FIELD, source: 'covMatrix', filters: ['partner'], officeKinds: [],
  views: ['heat', 'table'], defaultView: 'heat', dynamicColumns: 'months',
  columns: [col('label', 'Programme ou TPM'), col('planifie', 'Planifiées', 'int'), col('realise', 'Réalisées', 'int'), col('rate', 'Taux', 'pct')],
  args: { by: { type: 'enum', label: 'Lignes', choices: ['activity', 'provider'], default: 'activity' } },
  shape(raw, eff, ctx) {
    const T = phrases(ctx.lang);
    const byProv = ctx.args && ctx.args.by === 'provider';
    const m = byProv ? raw.byProvider : raw.byActivity;
    const groups = (m.groups || []).filter((g) => !eff.partnerId || !byProv || g.key === eff.partnerId);
    const rows = groups.map((g) => ({
      _key: g.key, label: g.key === 'non_affecte' ? T.unassigned : g.label, planifie: g.total.planifie, realise: g.total.realise, rate: ratePct(g.total.rate),
      ...Object.fromEntries(g.cells.map((c) => [`m:${c.month}`, ratePct(c.rate)])),
    }));
    const cols = [col('label', 'Programme ou TPM'), ...m.months.map((mm) => col(`m:${mm}`, mm, 'pct')), col('planifie', 'Planifiées', 'int'), col('realise', 'Réalisées', 'int'), col('rate', 'Taux', 'pct')];
    return { columns: cols, rows, meta: { n: rows.reduce((a, r) => a + r.planifie + r.realise, 0), nLabel: 'visites' } };
  },
});

const RECAP_COLS = [
  col('risk', 'Niveau de risque'), col('required', 'Visites requises (MMR)', 'int'), col('active', 'Sites actifs', 'int'),
  col('once', '1 visite', 'int'), col('twice', '2 visites', 'int'), col('thrice', '3 visites', 'int'), col('fourPlus', '4 visites et plus', 'int'),
  col('notVisited', 'Non visités', 'int'), col('coverage', 'Couverture', 'pct'), col('compliance', 'Conformité MMR', 'pct'),
];
const recapRisk = ds('cov.recap_risk', {
  label: 'Récapitulatif par niveau de risque (MMR)', origin: ORIGIN_FIELD, source: 'covRecap', filters: [], officeKinds: [],
  views: ['table', 'bar'], defaultView: 'table', columns: RECAP_COLS, measures: ['coverage'],
  args: { district: { type: 'text', label: 'District' } },
  shape(raw, eff, ctx) {
    const T = phrases(ctx.lang);
    const row = (g, key) => ({ _key: key, risk: key === 'total' ? T.total : T.risk[g.riskLevel] || g.riskLevel, required: key === 'total' ? null : g.required, active: g.active, once: g.once, twice: g.twice, thrice: g.thrice, fourPlus: g.fourPlus, notVisited: g.notVisited, coverage: ratePct(g.coverageRate), compliance: ratePct(g.compliance) });
    const rows = [...(raw.groups || []).map((g) => row(g, g.riskLevel)), row(raw.total || {}, 'total')];
    return { columns: RECAP_COLS, rows, meta: { n: (raw.total || {}).active || 0, nLabel: 'sites actifs' } };
  },
});

const DAYS_COLS = [col('provider', 'TPM'), col('visitDays', 'Jours de visite', 'int'), col('travelDays', 'Jours de déplacement', 'int'), col('totalDays', 'Total à budgéter', 'int')];
const collectionDays = ds('cov.collection_days', {
  label: 'Jours de collecte par TPM', origin: ORIGIN_FIELD, source: 'collectionDays', filters: ['partner'], officeKinds: [], periodMode: 'asOf',
  views: ['table', 'bar'], defaultView: 'table', columns: DAYS_COLS, measures: ['totalDays'],
  shape(raw, eff) {
    const rows = (raw || []).filter((p) => !eff.partnerId || p.providerId === eff.partnerId)
      .map((p) => ({ _key: p.providerId, provider: p.label, visitDays: p.visitDays, travelDays: p.travelDays, totalDays: p.totalDays }));
    return { columns: DAYS_COLS, rows, meta: { n: rows.reduce((a, r) => a + r.totalDays, 0), nLabel: 'jours', asOf: eff.period ? eff.period.to : null } };
  },
});

const MONTHS_COLS = [
  col('month', 'Mois', 'month'), col('status', 'Statut du plan', 'status'), col('total', 'Visites', 'int'), col('planifie', 'Planifiées', 'int'),
  col('realise', 'Réalisées', 'int'), col('annule', 'Annulées', 'int'), col('sites', 'Sites', 'int'), col('providers', 'TPM', 'int'), col('coverage', 'Taux de réalisation', 'pct'),
];
const monthsTable = ds('cov.months', {
  label: 'Tableau des mois (plan de visites)', origin: ORIGIN_FIELD, source: 'monthsOverview', filters: [], officeKinds: [], periodMode: 'year',
  views: ['table'], defaultView: 'table', columns: MONTHS_COLS,
  shape(raw) {
    const rows = (raw.months || []).map((m) => ({ _key: m.month, ...m, coverage: m.planifie + m.realise > 0 ? ratePct(m.coverage) : null }));
    return { columns: MONTHS_COLS, rows, meta: { n: rows.reduce((a, r) => a + r.total, 0), nLabel: 'visites', asOf: String(raw.year) } };
  },
});

// ---- Plan de suivi (exercice) ---------------------------------------------------------------
/** Sites du plan dans le périmètre (bureau MEMS et ses antennes, activité). */
function planScope(sites, eff, ctx) {
  const office = eff.office ? eff.office : null;
  const officeId = office && office.startsWith('id:') ? office.slice(3) : null;
  const parentOf = ctx.officeParents || new Map();
  const act = eff.activity ? String(eff.activity).trim().toLowerCase() : null;
  return (sites || []).filter((s) => {
    if (office === 'unlinked' && s.fieldOfficeId) return false;
    if (officeId && s.fieldOfficeId !== officeId && parentOf.get(s.fieldOfficeId) !== officeId) return false;
    if (act && String(s.activity || '').trim().toLowerCase() !== act) return false;
    return true;
  });
}
const PLAN_KPI_COLS = [
  col('total', 'Sites du plan', 'int'), col('active', 'Sites actifs', 'int'), col('requiredVisits', 'Visites exigées', 'int'),
  col('doneVisits', 'Visites faites', 'int'), col('planned', 'Sites avec visite prévue', 'int'), col('remainingVisits', 'Visites restantes', 'int'),
  col('notYetPlanned', 'Restant à planifier', 'int'), col('neverVisited', 'Jamais visités', 'int'), col('mmrRate', 'Avancement MMR', 'pct'),
];
const planKpis = ds('plan.kpis', {
  label: 'Plan de suivi (chiffres clés de l\'exercice)', origin: ORIGIN_PLAN, source: 'planBoard', periodMode: 'year',
  views: ['kpi', 'table'], defaultView: 'kpi', columns: PLAN_KPI_COLS,
  shape(raw, eff, ctx) {
    const k = boardKpis(planScope(raw.sites, eff, ctx));
    return { columns: PLAN_KPI_COLS, rows: [{ _key: 'kpis', ...k }], meta: { n: k.total, nLabel: 'sites', asOf: String(raw.year) } };
  },
});
const PRIO_COLS = [
  col('name', 'Site'), col('code', 'Code'), col('district', 'District'), col('commune', 'Commune'), col('activity', 'Activité'), col('bureau', 'Bureau'),
  col('riskLevel', 'Risque', 'status'), col('priority', 'Priorité'), col('lastVisitMonth', 'Dernière visite', 'month'),
  col('required', 'Exigées', 'int'), col('done', 'Faites', 'int'), col('planned', 'Prévues', 'int'), col('remaining', 'Reste', 'int'),
];
const planPriorities = ds('plan.priorities', {
  label: 'Sites à planifier par priorité', origin: ORIGIN_PLAN, source: 'planBoard', periodMode: 'year',
  views: ['table'], defaultView: 'table', columns: PRIO_COLS,
  shape(raw, eff, ctx) {
    const T = phrases(ctx.lang);
    const list = rankSites(planScope(raw.sites, eff, ctx)).filter((s) => s.remaining > 0 && !s.forbidden && !s.inactive);
    const rows = list.slice(0, 100).map((s) => ({
      _key: s.id, name: s.name, code: s.code, district: s.district, commune: s.commune, activity: s.activity, bureau: s.bureau,
      riskLevel: s.riskLevel, priority: T.priority[s.priority] || s.priority, lastVisitMonth: s.lastVisitMonth, required: s.required, done: s.done, planned: s.planned, remaining: s.remaining,
    }));
    return { columns: PRIO_COLS, rows, meta: { n: list.length, nLabel: 'sites', asOf: String(raw.year) } };
  },
});

module.exports = [
  covKpis, byActivity, byOffice, byDistrict, monthly, completeness, matrix, recapRisk, visitsByProvider, collectionDays, monthsTable,
  planKpis, planPriorities,
];
module.exports.planScope = planScope;
module.exports.SITE_OFFICE = SITE_OFFICE;
