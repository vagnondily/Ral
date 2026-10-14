const { rbmSummary, scopeSites, dueSites } = require('../../tpm/rbmSummary');
const { resolvePlan, summarizePlan } = require('../../tpm/mmrMath');
const { coverageStatus } = require('../../common/coverageStatus');
const { phrases } = require('../phrases');
const { col, ratePct } = require('./facts');

/**
 * Jeux de données « Risk-Based Monitoring et sites » (lot 7a, C4) — déclarations PURES.
 *  - rbmSites : field.repository.rbmSitesTx({ explain: true }) au DERNIER mois de la période
 *    (situation à cette date : visites et collectes jusque-là), synthèse tpm/rbmSummary —
 *    le calcul de « Couverture & performance » (sites suivis, à suivre, par risque) ;
 *  - covFacts (un mois) : registre des sites (total et actifs ce mois) ;
 *  - mmr : paramètres MMR (settings.listMmr) résolus par mmrMath.resolvePlan / summarizePlan.
 */

const ORIGIN_RBM = { page: 'Suivi de processus › Risk-Based Monitoring', route: '#/processus/rbm' };
const ORIGIN_MMR = { page: 'Paramétrage › MMR', route: '#/parametrage/mmr' };
const SITE_OFFICE = ['id', 'unlinked'];

function ds(key, def) {
  return { key, group: 'rbm', filters: ['office', 'activity'], officeKinds: SITE_OFFICE, periodMode: 'asOf', ...def };
}

/** Sites RBM du périmètre du bloc. */
function sitesOf(raw, eff, ctx) {
  const office = eff.office || null;
  return scopeSites(raw || [], {
    officeId: office === 'unlinked' ? 'unlinked' : office && office.startsWith('id:') ? office.slice(3) : null,
    activity: eff.activity || null, parentOf: ctx.officeParents || new Map(),
  });
}
const asOfMeta = (eff, extra) => ({ asOf: eff.period ? eff.period.to : null, ...extra });
const tr = (T, s) => (T.rbm && T.rbm[s]) || s;

const KPI_COLS = [
  col('total', 'Sites suivis (registre)', 'int'), col('due', 'Sites à suivre', 'int'), col('upToDate', 'Sites à jour', 'int'),
  col('upToDatePct', 'Part des sites à jour', 'pct'), col('toPlan', 'À planifier', 'int'), col('urgent', 'Drapeaux urgents', 'int'),
  col('high', 'Risque élevé', 'int'), col('medium', 'Risque moyen', 'int'), col('low', 'Risque faible', 'int'),
  col('neverVisited', 'Jamais visités', 'int'), col('forbidden', 'Zones interdites', 'int'),
];
const rbmKpis = ds('rbm.kpis', {
  label: 'RBM : sites suivis et à suivre (chiffres clés)', origin: ORIGIN_RBM, source: 'rbmSites', views: ['kpi', 'table'], defaultView: 'kpi',
  columns: KPI_COLS,
  shape(raw, eff, ctx) {
    const s = rbmSummary(sitesOf(raw, eff, ctx));
    const row = {
      _key: 'rbm', total: s.total, due: s.due, upToDate: s.upToDate, upToDatePct: s.total ? Math.round((s.upToDate / s.total) * 1000) / 10 : null,
      toPlan: s.toPlan, urgent: s.urgent, high: s.byRisk.elevee, medium: s.byRisk.moyenne, low: s.byRisk.faible,
      neverVisited: s.neverVisited, forbidden: s.forbidden,
    };
    return { columns: KPI_COLS, rows: [row], meta: asOfMeta(eff, { n: s.total, nLabel: 'sites' }) };
  },
});

const RISK_COLS = [col('risk', 'Niveau de risque'), col('sites', 'Sites', 'int'), col('due', 'À suivre', 'int'), col('share', 'Part', 'pct')];
const byRisk = ds('rbm.by_risk', {
  label: 'Répartition des sites par niveau de risque', origin: ORIGIN_RBM, source: 'rbmSites', views: ['donut', 'bar', 'table'], defaultView: 'donut',
  columns: RISK_COLS, measures: ['sites'],
  shape(raw, eff, ctx) {
    const T = phrases(ctx.lang);
    const sites = sitesOf(raw, eff, ctx);
    const total = sites.length;
    const rows = ['elevee', 'moyenne', 'faible'].map((lv) => {
      const list = sites.filter((s) => s.riskLevel === lv);
      return { _key: lv, risk: T.risk[lv], riskLevel: lv, sites: list.length, due: list.filter((s) => s.due).length, share: total ? Math.round((list.length / total) * 1000) / 10 : null };
    });
    return { columns: RISK_COLS, rows, meta: asOfMeta(eff, { n: total, nLabel: 'sites' }) };
  },
});

const DUE_COLS = [
  col('name', 'Site'), col('code', 'Code'), col('district', 'District'), col('commune', 'Commune'), col('activity', 'Activité'),
  col('bureau', 'Bureau'), col('riskLevel', 'Risque saisi', 'status'), col('level', 'Niveau calculé'), col('priority', 'Priorité'),
  col('lastVisitMonth', 'Dernière visite', 'month'), col('reasons', 'Pourquoi'), col('action', 'Que faire'),
];
const dueSitesDs = ds('rbm.due_sites', {
  label: 'Sites à suivre (priorité, dernière visite, raisons)', origin: ORIGIN_RBM, source: 'rbmSites', views: ['table'], defaultView: 'table',
  columns: DUE_COLS,
  shape(raw, eff, ctx) {
    const T = phrases(ctx.lang);
    const list = dueSites(sitesOf(raw, eff, ctx));
    const rows = list.slice(0, 100).map((s) => ({
      _key: s.id, name: s.name, code: s.code, district: s.district, commune: s.commune, activity: s.activity,
      bureau: s.subOfficeName || s.antenneName || null, riskLevel: s.riskLevel, level: T.level[s.finalScore], priority: T.priority[s.priorityLabel] || s.priorityLabel,
      lastVisitMonth: s.lastVisitMonth || null,
      reasons: (s.reasons || []).map((r) => tr(T, r.label)).join(' · ') || null,
      action: (s.actions || [])[0] ? tr(T, s.actions[0].label) : null,
    }));
    return { columns: DUE_COLS, rows, meta: asOfMeta(eff, { n: list.length, nLabel: 'sites' }) };
  },
});

const FLAG_COLS = [col('flag', 'Signal de risque'), col('sites', 'Sites', 'int'), col('urgent', 'Dont urgents', 'int')];
const flags = ds('rbm.flags', {
  label: 'Signaux de risque RBM (sites par critère)', origin: ORIGIN_RBM, source: 'rbmSites', filters: ['office'], views: ['bar', 'table'], defaultView: 'bar',
  columns: FLAG_COLS, measures: ['sites'],
  shape(raw, eff, ctx) {
    const T = phrases(ctx.lang);
    const s = rbmSummary(sitesOf(raw, eff, ctx));
    const rows = s.flags.map((f) => ({ _key: f.code, flag: tr(T, f.label), sites: f.sites, urgent: f.urgent }));
    return { columns: FLAG_COLS, rows, meta: asOfMeta(eff, { n: s.total, nLabel: 'sites' }) };
  },
});

const REG_COLS = [col('label', 'Regroupement'), col('sitesTotal', 'Sites du registre', 'int'), col('sitesActive', 'Sites actifs', 'int'), col('coverage', 'Couverture du mois', 'pct'), col('status', 'Statut', 'status')];
const registry = ds('sites.registry', {
  label: 'Registre des sites par bureau, district et activité', origin: ORIGIN_RBM, source: 'covFacts', views: ['table', 'bar'], defaultView: 'table',
  columns: REG_COLS, measures: ['sitesTotal', 'sitesActive'],
  args: { by: { type: 'enum', label: 'Regrouper par', choices: ['office', 'district', 'activity'], default: 'office' } },
  shape(raw, eff, ctx) {
    const by = (ctx.args && ctx.args.by) || 'office';
    const list = by === 'district' ? raw.byDistrict : by === 'activity' ? raw.byActivity : raw.byOffice;
    const rows = (list || []).map((r) => ({ _key: r.key, label: r.label, sitesTotal: r.sitesTotal, sitesActive: r.sites.active, coverage: ratePct(r.coverage), status: coverageStatus(r.coverage) }));
    return { columns: REG_COLS, rows, meta: asOfMeta(eff, { n: raw.overall ? raw.overall.sitesTotal : 0, nLabel: 'sites' }) };
  },
});

const MMR_COLS = [
  col('category', 'Catégorie d\'activité'), col('sites', 'Sites', 'int'), col('riskLevel', 'Visites par période', 'int'), col('interval', 'Intervalle (mois)', 'dec'),
  col('targetedPerMonth', 'Sites à visiter par mois', 'dec'), col('feasible', 'Capacité par mois', 'dec'), col('coverageRatio', 'Capacité ÷ cible', 'dec'),
];
const mmr = ds('sites.mmr', {
  label: 'Paramètres MMR (visites requises, capacité)', origin: ORIGIN_MMR, source: 'mmr', filters: ['office'], periodMode: 'now', views: ['table'], defaultView: 'table',
  columns: MMR_COLS,
  shape(raw, eff) {
    const officeId = eff.office && eff.office.startsWith('id:') ? eff.office.slice(3) : null;
    const plan = resolvePlan(raw || [], officeId);
    const rows = plan.map((p) => ({
      _key: p.activityCategory, category: p.activityCategory, sites: p.effective.numberOfSites, riskLevel: p.effective.riskLevel,
      interval: p.effective.interval, targetedPerMonth: p.effective.targetedPerMonth, feasible: p.effective.feasible, coverageRatio: p.effective.coverageRatio,
    }));
    const s = summarizePlan(plan);
    return { columns: MMR_COLS, rows, meta: { n: s.sites, nLabel: 'sites' } };
  },
});

module.exports = [rbmKpis, byRisk, dueSitesDs, flags, registry, mmr];
module.exports.sitesOf = sitesOf;
