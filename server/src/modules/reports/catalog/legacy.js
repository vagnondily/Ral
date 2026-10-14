const { DATASETS: V1 } = require('../reportModel');

/**
 * Pont provisoire (lot 7a) : les deux jeux v1 encore servis par la source « legacy »
 * (budget : consolidation ; PDD : reportPddByMonth), sous leurs clés v2, le temps que le C5
 * les remplace par les sources partagées (consolidation avec `until`, PDD en centimes).
 * Les jeux suivi de processus, couverture et RBM sont déclarés dans monitoring.js,
 * coverage.js et rbm.js (C4). Aucun total national n'est présenté comme celui d'un bureau :
 * ces deux jeux ne déclarent pas le filtre bureau (note « Non disponible par bureau »).
 */
const cols = (v1) => V1[v1].columns.map(([key, label, type]) => ({ key, label, type }));
const cents = (v) => Math.round((Number(v) || 0) * 100);

const budgetByContract = {
  key: 'bud.by_contract', label: 'Situation budgétaire par contrat', group: 'budget', source: 'legacy', needs: ['budget'],
  periodMode: 'range', filters: [], views: ['table', 'bar'], defaultView: 'table', columns: cols('budget_contracts'),
  shape(raw) {
    const rows = ((raw.budget && raw.budget.rows) || []).map((r) => ({
      _key: r.contractId || r.numero, contract: r.numero, partner: r.partnerName, budget: r.budget, planned: r.planned, actual: r.actual,
      rate: r.actualRate == null ? null : Math.round(r.actualRate * 1000) / 10,
      remaining: r.budget != null && r.actual != null ? (cents(r.budget) - cents(r.actual)) / 100 : null,
    }));
    return { columns: cols('budget_contracts'), rows, meta: { n: rows.length, nLabel: 'contrats' } };
  },
};

const pddByMonth = {
  key: 'pdd.by_month', label: 'Distributions d\'urgence par mois', group: 'pdd', source: 'legacy', needs: ['pdd'],
  periodMode: 'range', filters: [], views: ['column', 'bar', 'table', 'line'], defaultView: 'column', columns: cols('pdd_by_month'), measures: ['beneficiaries'],
  shape(raw) {
    const rows = (raw.pdd || []).map((m) => ({ _key: m.month, month: m.month, beneficiaries: m.beneficiaries, households: m.households, food: Math.round((m.food || 0) * 1000) / 1000, cash: m.cash }));
    return { columns: cols('pdd_by_month'), rows, meta: { n: rows.length, nLabel: 'mois' } };
  },
};

module.exports = [budgetByContract, pddByMonth];
