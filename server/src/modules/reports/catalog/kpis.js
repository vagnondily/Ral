const { computeKpis } = require('../reportData');
const { legacyFilters } = require('./legacy');
const { phrases } = require('../phrases');

/**
 * Chiffres clés (bloc « kpis », variables des textes) — C3 : les 15 chiffres v1 sous leurs
 * clés v2, calculés comme avant (reportData.computeKpis) ; remplacés en C4 par une
 * déclaration par chiffre sur les sources partagées.
 */
const k = (key, label, unit, legacyKey, needs) => ({
  key, label, unit, group: needs.includes('budget') ? 'budget' : needs.includes('pdd') ? 'pdd' : needs.includes('monitoring') ? 'monitoring' : 'coverage',
  source: 'legacy', needs, filters: ['office', 'form'],
  pick(raw, eff, ctx) {
    const f = legacyFilters(eff, ctx);
    if (f.unsupported) return { value: null, note: phrases(ctx.lang).notByUnlinkedOffice };
    return { value: computeKpis(raw, f)[legacyKey] ?? null };
  },
});

module.exports = [
  k('sites_active', 'Sites actifs', 'int', 'sites_active', ['monitoring', 'field']),
  k('sites_realised', 'Sites visités', 'int', 'sites_visited', ['monitoring', 'field']),
  k('sites_with_data', 'Sites avec données (toutes fiches)', 'int', 'sites_visited_all', ['monitoring']),
  k('coverage', 'Couverture des sites', 'pct', 'coverage', ['monitoring', 'field']),
  k('visits_realised', 'Visites réalisées', 'int', 'visits_done', ['field']),
  k('visits_planned', 'Visites planifiées', 'int', 'visits_planned', ['field']),
  k('execution_rate', 'Taux de réalisation', 'pct', 'execution_rate', ['field']),
  k('submissions', 'Données versées', 'int', 'submissions', ['monitoring']),
  k('conformity', 'Indice de conformité', 'pct', 'conformity', ['monitoring']),
  k('budget_total', 'Budget de suivi', 'money', 'budget_total', ['budget']),
  k('budget_actual', 'Réalisé', 'money', 'budget_actual', ['budget']),
  k('consumption', 'Taux de consommation', 'pct', 'consumption', ['budget']),
  k('pdd_beneficiaries', 'Bénéficiaires (PDD)', 'int', 'pdd_beneficiaries', ['pdd']),
  k('pdd_food', 'Vivres distribués (t)', 'dec', 'pdd_food', ['pdd']),
  k('pdd_cash', 'Cash distribué (USD)', 'money', 'pdd_cash', ['pdd']),
];
