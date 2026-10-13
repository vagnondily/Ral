const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAlerts, countAlerts, budgetAlerts, reportAlerts, contractAlerts, fieldAlerts, daysBetween } = require('../src/modules/dashboards/alertsMath');

const TODAY = '2026-10-13';

test('budget : dépassé = critique ; sinon dépassement si validation ; sinon projection', () => {
  const rows = [
    { contractId: 'c1', numero: 'FLA-1', partnerName: 'P1', overspent: true, actual: 110, budget: 100, pendingValidation: 0, projectedOverrun: 0 },
    { contractId: 'c2', numero: 'FLA-2', partnerName: 'P2', overspent: false, actual: 60, budget: 100, pendingValidation: 50, projectedOverrun: 0 },
    { contractId: 'c3', numero: 'FLA-3', partnerName: 'P3', overspent: false, actual: 60, budget: 100, pendingValidation: 0, projectedOverrun: 5, projectedTotal: 105 },
    { contractId: 'c4', numero: 'FLA-4', partnerName: 'P4', overspent: false, actual: 60, budget: 100, pendingValidation: 40, projectedOverrun: 0 },
  ];
  const out = budgetAlerts(rows);
  assert.deepEqual(out.map((a) => [a.kind, a.sev]), [
    ['budget_overspent', 'critical'], ['budget_pending_overrun', 'warning'], ['budget_projected_overrun', 'warning'],
  ]);
  assert.deepEqual(out[0].go, { module: 'contrats', sub: 'liste', extra: 'c1' });
  assert.deepEqual(out[0].params.actual, { money: 110 }); // mis en forme (Ariary) par l'interface
});

test('budget : comparaison en centimes entiers (0,1 + 0,2 n\'excède pas 0,3)', () => {
  const out = budgetAlerts([{ contractId: 'c', numero: 'F', overspent: false, actual: 0.1, pendingValidation: 0.2, budget: 0.3, projectedOverrun: 0 }]);
  assert.equal(out.length, 0);
});

test('rapports : seuls les rapports soumis que l\'utilisateur peut décider (séparation des tâches)', () => {
  const reports = [
    { status: 'soumis', kind: 'financier', actions: { decide: true }, partnerName: 'P', contractNumero: 'FLA-1', periodMonth: '2026-09-01' },
    { status: 'soumis', kind: 'technique', actions: { decide: false }, partnerName: 'P', contractNumero: 'FLA-1', periodMonth: '2026-09-01' },
    { status: 'brouillon', kind: 'financier', actions: { decide: true } },
  ];
  const out = reportAlerts(reports);
  assert.equal(out.length, 1);
  assert.equal(out[0].title, 'Rapport financier à valider');
  assert.deepEqual(out[0].params.month, { month: '2026-09' });
});

test('contrats : avenant / contrat en validation, expiré, échéance ≤ 90 j (et pas au-delà)', () => {
  const out = contractAlerts([
    { id: 'a', numero: 'A', partnerName: 'PA', status: 'actif', amendmentPending: true, dateFin: '2027-06-30' },
    { id: 'b', numero: 'B', partnerName: 'PB', status: 'en_validation' },
    { id: 'c', numero: 'C', partnerName: 'PC', status: 'actif', dateFin: '2026-09-30' },
    { id: 'd', numero: 'D', partnerName: 'PD', status: 'actif', dateFin: '2026-11-30' },
    { id: 'e', numero: 'E', partnerName: 'PE', status: 'actif', dateFin: '2027-01-11' }, // 90 j pile
    { id: 'f', numero: 'F', partnerName: 'PF', status: 'actif', dateFin: '2027-01-12' }, // 91 j
  ], TODAY);
  assert.deepEqual(out.map((a) => [a.kind, a.go.extra]), [
    ['amendment_pending', 'a'], ['contract_pending', 'b'], ['contract_expired', 'c'], ['contract_ending', 'd'], ['contract_ending', 'e'],
  ]);
  assert.equal(out[3].params.d, 48);
  assert.deepEqual(out[2].params.date, { date: '2026-09-30' });
});

test('jours entre deux dates en UTC (aucun décalage horaire)', () => {
  assert.equal(daysBetween('2026-10-13', '2026-10-13'), 0);
  assert.equal(daysBetween('2026-10-13', '2026-10-12'), -1);
  assert.equal(daysBetween('2026-03-28', '2026-03-30'), 2);
});

test('terrain : « aucun plan » n\'est jamais une couverture faible', () => {
  assert.deepEqual(fieldAlerts({ overall: { active: 0, realise: 0, rate: 0 }, byProvider: [] }), []);
  assert.deepEqual(fieldAlerts(null), []);
});

test('terrain : couverture < 50 % (à surveiller), prestataire < 40 % sur ≥ 3 visites, visites non affectées', () => {
  const field = {
    overall: { active: 10, realise: 4, rate: 0.4 },
    byProvider: [
      { key: 'p1', label: 'ONG A', active: 5, realise: 1, rate: 0.2 },
      { key: 'p2', label: 'ONG B', active: 2, realise: 0, rate: 0 }, // trop peu de visites
      { key: 'non_affecte', label: 'Non affecté', active: 3, realise: 3, rate: 1, total: 3 },
    ],
  };
  const out = fieldAlerts(field);
  assert.deepEqual(out.map((a) => [a.kind, a.sev]), [['field_low_coverage', 'warning'], ['provider_late', 'info'], ['visits_unassigned', 'info']]);
  assert.deepEqual(out[0].params, { done: 4, active: 10, p: 40 });
  assert.equal(out[0].go.module, 'processus');
});

test('liste triée par gravité, ordre des catégories conservé ; décompte pour la cloche', () => {
  const alerts = buildAlerts({
    consolidationRows: [{ contractId: 'c1', numero: 'X', overspent: false, actual: 1, budget: 10, pendingValidation: 0, projectedOverrun: 1, projectedTotal: 11 }],
    reports: [{ status: 'soumis', kind: 'financier', actions: { decide: true }, periodMonth: '2026-09-01' }],
    contracts: [{ id: 'k', numero: 'K', status: 'actif', dateFin: '2026-01-01' }],
    field: { overall: { active: 4, realise: 0, rate: 0 }, byProvider: [] },
    today: TODAY,
  });
  assert.deepEqual(alerts.map((a) => a.kind), ['budget_projected_overrun', 'contract_expired', 'field_low_coverage', 'report_to_validate']);
  assert.deepEqual(countAlerts(alerts), { critical: 0, warning: 3, info: 1, attention: 3, total: 4 });
  assert.deepEqual(countAlerts([]), { critical: 0, warning: 0, info: 0, attention: 0, total: 0 });
});

test('sources absentes : aucune alerte, aucune erreur', () => {
  assert.deepEqual(buildAlerts({ today: TODAY }), []);
});
