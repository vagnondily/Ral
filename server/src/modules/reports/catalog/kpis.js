const { overallIndex } = require('../../monitoring/monitoringMath');
const { classDistribution } = require('../../monitoring/coverageDashboard');
const { rbmSummary } = require('../../tpm/rbmSummary');
const { ratePct, pctOf, visitsOf } = require('./facts');
const { allResults } = require('./monitoring');
const { sitesOf } = require('./rbm');
const { SITE_OFFICE } = require('./coverage');

/**
 * Chiffres clés (bloc « kpis », variables des textes, bulletin) — lot 7a, C4. Chaque chiffre
 * est déclaré UNE fois sur une source partagée avec les jeux de données (même calcul que
 * les tableaux de bord) : { key, label, unit, group, source, filters, periodMode, pick }.
 * Une valeur sans base est null, affichée « — » avec sa raison, jamais « 0 % ».
 * L'ancien reportData.computeKpis (couverture = clés de soumissions ÷ sites actifs : 435,9 %)
 * est supprimé.
 */

const MON = ['office', 'activity', 'partner', 'form'];
const cov = (key, label, unit, pick) => ({ key, label, unit, group: 'coverage', source: 'covFacts', filters: ['office', 'activity'], officeKinds: SITE_OFFICE, periodMode: 'range', pick });
const data = (key, label, field) => ({ key, label, unit: 'int', group: 'monitoring', source: 'monData', filters: MON, periodMode: 'range', pick: (raw) => ({ value: (raw.totals || {})[field] ?? null }) });
const conf = (key, label, unit, pick) => ({ key, label, unit, group: 'monitoring', source: 'monForms', filters: MON, periodMode: 'range', pick });
const rbm = (key, label, pick) => ({ key, label, unit: 'int', group: 'rbm', source: 'rbmSites', filters: ['office', 'activity'], officeKinds: SITE_OFFICE, periodMode: 'asOf', pick });

/** Visites (score par visite) de toutes les fiches. */
function allVisits(raw) {
  const t = { n: 0, na: 0, urg: 0 };
  for (const f of raw.forms || []) { const v = visitsOf(f); t.n += v.n; t.na += v.classes.na; t.urg += v.classes.urg; }
  return t;
}

// ---- Pont budget / PDD (source « legacy ») — remplacé par les sources partagées en C5 -----
const cents = (v) => Math.round((Number(v) || 0) * 100);
const sumCents = (rows, k) => (rows || []).reduce((a, r) => a + cents(r[k]), 0);
const legacy = (key, label, unit, part, pick) => ({ key, label, unit, group: part, source: 'legacy', needs: [part], filters: [], officeKinds: [], periodMode: 'range', pick });

module.exports = [
  // Couverture terrain (faits site × mois du lot 1b)
  cov('sites_active', 'Sites actifs', 'int', (r) => ({ value: r.overall.sites.active })),
  cov('sites_planned', 'Sites prévus', 'int', (r) => ({ value: r.overall.sites.planned })),
  cov('sites_realised', 'Sites réalisés', 'int', (r) => ({ value: r.overall.sites.realised })),
  cov('coverage', 'Couverture des sites', 'pct', (r) => ({ value: ratePct(r.overall.coverage) })),
  cov('planning_rate', 'Taux de planification', 'pct', (r) => ({ value: ratePct(r.overall.planning) })),
  cov('execution_rate', 'Exécution du plan', 'pct', (r) => ({ value: ratePct(r.overall.execution) })),
  cov('visits_planned', 'Visites prévues', 'int', (r) => ({ value: r.overall.visits.planned })),
  cov('visits_realised', 'Visites réalisées', 'int', (r) => ({ value: r.overall.visits.realised })),
  { key: 'visits_unplanned', label: 'Visites hors plan', unit: 'int', group: 'coverage', source: 'covFacts', filters: [], periodMode: 'range', available: false, reason: 'Disponible avec le lot 4' },
  // Données versées (comptages SQL)
  data('submissions', 'Données versées', 'submissions'),
  data('sites_with_data', 'Sites avec données', 'dataSites'),
  data('communes_with_data', 'Communes avec données', 'communes'),
  data('agents_with_data', 'Agents ayant collecté', 'agents'),
  data('forms_active', 'Fiches avec données', 'forms'),
  // Conformité (résultats des fiches, même calcul que la Synthèse)
  conf('conformity', 'Indice de conformité', 'pct', (r) => ({ value: overallIndex(allResults(r)) })),
  conf('indicators_scored', 'Indicateurs notés', 'int', (r) => ({ value: classDistribution(allResults(r)).scored })),
  conf('indicators_urgent', 'Indicateurs en action urgente', 'int', (r) => ({ value: classDistribution(allResults(r)).urg })),
  conf('indicators_excellent', 'Indicateurs excellents', 'int', (r) => ({ value: classDistribution(allResults(r)).exc })),
  conf('visits_urgent', 'Visites en action urgente', 'int', (r) => ({ value: allVisits(r).urg })),
  conf('visits_na_pct', 'Visites non évaluées', 'pct', (r) => { const v = allVisits(r); return { value: pctOf(v.na, v.n) }; }),
  // RBM (situation au dernier mois de la période)
  rbm('rbm_sites', 'Sites suivis (RBM)', (raw, eff, ctx) => ({ value: rbmSummary(sitesOf(raw, eff, ctx)).total })),
  rbm('rbm_due', 'Sites à suivre (RBM)', (raw, eff, ctx) => ({ value: rbmSummary(sitesOf(raw, eff, ctx)).due })),
  rbm('rbm_high_risk', 'Sites à risque élevé', (raw, eff, ctx) => ({ value: rbmSummary(sitesOf(raw, eff, ctx)).byRisk.elevee })),
  // Budget et PDD : pont jusqu'au C5 (montants additionnés en centimes)
  legacy('budget_total', 'Budget de suivi', 'money', 'budget', (raw) => ({ value: sumCents(raw.budget && raw.budget.rows, 'budget') / 100 })),
  legacy('budget_actual', 'Réalisé', 'money', 'budget', (raw) => ({ value: sumCents(raw.budget && raw.budget.rows, 'actual') / 100 })),
  legacy('consumption', 'Taux de consommation', 'pct', 'budget', (raw) => ({ value: pctOf(sumCents(raw.budget && raw.budget.rows, 'actual'), sumCents(raw.budget && raw.budget.rows, 'budget')) })),
  legacy('pdd_beneficiaries', 'Bénéficiaires (PDD)', 'int', 'pdd', (raw) => ({ value: (raw.pdd || []).reduce((a, m) => a + (Number(m.beneficiaries) || 0), 0) })),
  legacy('pdd_food', 'Vivres distribués (t)', 'dec', 'pdd', (raw) => ({ value: Math.round((raw.pdd || []).reduce((a, m) => a + Math.round((Number(m.food) || 0) * 1000), 0) / 100) / 10 })),
  legacy('pdd_cash', 'Cash distribué (USD)', 'money', 'pdd', (raw) => ({ value: Math.round(sumCents(raw.pdd, 'cash') / 100) })),
];
