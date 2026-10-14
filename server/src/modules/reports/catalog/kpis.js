const { overallIndex } = require('../../monitoring/monitoringMath');
const { classDistribution } = require('../../monitoring/coverageDashboard');
const { rbmSummary } = require('../../tpm/rbmSummary');
const { ratePct, pctOf, visitsOf } = require('./facts');
const { allResults } = require('./monitoring');
const { sitesOf } = require('./rbm');
const { SITE_OFFICE } = require('./coverage');
const { totalsOf } = require('../../tpm/consolidation');
const { contractAlerts } = require('../../dashboards/alertsMath');

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

const ANY = { filters: [], officeKinds: [] };
const bud = (key, label, unit, pick) => ({ key, label, unit, group: 'budget', source: 'consolidation', filters: ['partner'], officeKinds: [], periodMode: 'asOf', pick });
const ctr = (key, label, pick) => ({ key, label, unit: 'int', group: 'budget', source: 'contracts', filters: ['partner'], officeKinds: [], periodMode: 'now', pick });
const tpm = (key, label, source, pick, periodMode = 'range') => ({ key, label, unit: 'int', group: 'tpm', source, filters: ['partner'], officeKinds: [], periodMode, pick });
const pdd = (key, label, unit, field) => ({ key, label, unit, group: 'pdd', source: 'pddTotals', ...ANY, periodMode: 'range', pick: (r) => ({ value: r ? r[field] : null }) });
const alert = (key, label, field) => ({ key, label, unit: 'int', group: 'alerts', source: 'alerts', ...ANY, periodMode: 'now', pick: (r) => ({ value: r && r.counts ? r.counts[field] : null }) });
const partnerRows = (raw, eff) => ((raw && raw.rows) || []).filter((r) => !eff.partnerId || r.partnerId === eff.partnerId);
const inRange = (eff, month) => !eff.period || (String(month).slice(0, 7) >= eff.period.from && String(month).slice(0, 7) <= eff.period.to);

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
  // Budget (Suivi budgétaire consolidé, situation au dernier mois de la période, centimes)
  bud('budget_total', 'Budget de suivi', 'money', (raw, eff) => ({ value: totalsOf(partnerRows(raw, eff)).budget })),
  bud('budget_planned', 'Planifié', 'money', (raw, eff) => ({ value: totalsOf(partnerRows(raw, eff)).planned })),
  bud('budget_actual', 'Réalisé', 'money', (raw, eff) => ({ value: totalsOf(partnerRows(raw, eff)).actual })),
  bud('consumption', 'Taux de consommation', 'pct', (raw, eff) => { const t = totalsOf(partnerRows(raw, eff)); return { value: t.budget ? ratePct(t.actualRate) : null }; }),
  bud('budget_remaining', 'Budget restant', 'money', (raw, eff) => ({ value: totalsOf(partnerRows(raw, eff)).remaining })),
  ctr('contracts_active', 'Contrats actifs', (raw, eff) => ({ value: (raw || []).filter((c) => c.status === 'actif' && (!eff.partnerId || c.partnerId === eff.partnerId)).length })),
  ctr('contracts_expiring', 'Contrats à échéance (≤ 90 j)', (raw, eff, ctx) => ({
    value: contractAlerts((raw || []).filter((c) => !eff.partnerId || c.partnerId === eff.partnerId), ctx.today || new Date().toISOString().slice(0, 10))
      .filter((a) => a.kind === 'contract_ending').length,
  })),
  // Partenaires et TPM
  tpm('reports_to_validate', 'Rapports à valider', 'tpmReports', (raw, eff) => ({ value: (raw || []).filter((r) => r.status === 'soumis' && inRange(eff, r.periodMonth)).length })),
  tpm('reports_validated', 'Rapports validés', 'tpmReports', (raw, eff) => ({ value: (raw || []).filter((r) => r.status === 'valide' && inRange(eff, r.periodMonth)).length })),
  tpm('agents_active', 'Agents TPM actifs', 'tpmProviders', (raw, eff) => ({ value: (raw || []).filter((p) => !eff.partnerId || p.id === eff.partnerId).reduce((a, p) => a + p.agents.filter((x) => x.active).length, 0) }), 'now'),
  tpm('trainings', 'Formations', 'formations', (raw) => ({ value: (raw || []).length })),
  // Distribution d'urgence (sommes SQL de la période)
  pdd('pdd_beneficiaries', 'Bénéficiaires (PDD)', 'int', 'beneficiaries'),
  pdd('pdd_households', 'Ménages (PDD)', 'int', 'households'),
  pdd('pdd_food', 'Vivres distribués (t)', 'dec', 'food'),
  pdd('pdd_cash', 'Cash distribué (USD)', 'money', 'cash'),
  // Alertes (mêmes niveaux que le Centre d'alertes)
  alert('alerts_critical', 'Alertes critiques', 'critical'),
  alert('alerts_watch', 'Alertes à surveiller', 'warning'),
];
