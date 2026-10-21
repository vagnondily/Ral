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

test('n° de contrat des alertes = n° affiché (FLA, référence d\'avenant comprise), comme la liste, la consolidation et « Rapport en retard » — jamais le CTR-… quand un n° FLA existe', () => {
  // Budget (lignes de consolidation : numero + numeroFla).
  const budget = budgetAlerts([
    { contractId: 'c1', numero: 'CTR-2026-0003', numeroFla: 'FLA-2025-MIA-RES-007', partnerName: 'MIARO', overspent: true, actual: 11, budget: 10 },
    { contractId: 'c2', numero: 'CTR-2026-0009', numeroFla: 'FLA-9', overspent: false, actual: 6, budget: 10, pendingValidation: 5 },
    { contractId: 'c3', numero: 'CTR-2026-0010', numeroFla: null, overspent: false, actual: 6, budget: 10, pendingValidation: 0, projectedOverrun: 1, projectedTotal: 11 },
  ]);
  assert.deepEqual(budget.map((a) => a.params.numero), ['FLA-2025-MIA-RES-007', 'FLA-9', 'CTR-2026-0010']);
  // Contrats (lignes de listContracts : reference = n° FLA + code d'avenant).
  const contracts = contractAlerts([
    { id: 'a', numero: 'CTR-2026-0003', numeroFla: 'FLA-2025-MIA-RES-007', reference: 'FLA-2025-MIA-RES-007', status: 'actif', dateFin: '2026-11-30' },
    { id: 'b', numero: 'CTR-2026-0002', numeroFla: 'FLA-2025-TOH-SAMS-004', reference: 'FLA-2025-TOH-SAMS-004-A1', status: 'actif', amendmentPending: true, dateFin: '2027-06-30' },
    { id: 'c', numero: 'CTR-2026-0011', numeroFla: null, reference: null, status: 'en_validation' },
    { id: 'd', numero: 'CTR-2026-0012', numeroFla: 'FLA-12', status: 'actif', dateFin: '2026-09-30' },
  ], TODAY);
  assert.deepEqual(contracts.map((a) => [a.kind, a.params.numero]), [
    ['contract_ending', 'FLA-2025-MIA-RES-007'], ['amendment_pending', 'FLA-2025-TOH-SAMS-004-A1'],
    ['contract_pending', 'CTR-2026-0011'], ['contract_expired', 'FLA-12'],
  ]);
  // Rapports à valider (lignes de rapport : contractFla / contractNumero).
  const [rep] = reportAlerts([{ status: 'soumis', kind: 'financier', actions: { decide: true }, partnerName: 'YPA', contractNumero: 'CTR-2026-0003', contractFla: 'FLA-2025-MIA-RES-007', periodMonth: '2026-09-01' }]);
  assert.equal(rep.params.numero, 'FLA-2025-MIA-RES-007');
  assert.equal(reportAlerts([{ status: 'soumis', kind: 'technique', actions: { decide: true }, contractNumero: 'CTR-2026-0003', contractFla: null }])[0].params.numero, 'CTR-2026-0003');
});

test('contrat AVENANT : UN seul n° dans toute la liste (cloche, Centre d\'alertes) — celui de la liste des contrats (« …-AM02 »), pour le budget, l\'échéance, le rapport à valider et le rapport en retard', () => {
  const { contractNumbers } = require('../src/modules/dashboards/alertsMath');
  const K = 'k-aina';
  // Ligne de listContracts : référence = n° FLA + code d'avenant.
  const contracts = [
    { id: K, numero: 'CTR-2026-0001', numeroFla: 'FLA-2025-AIN-MULTI-003', reference: 'FLA-2025-AIN-MULTI-003-AM02', partnerName: 'ASSOCIATION AINA', status: 'actif', dateFin: '2026-11-30' },
    { id: 'k-sans-fla', numero: 'CTR-2026-0011', numeroFla: null, reference: null, status: 'en_validation' },
  ];
  assert.deepEqual([...contractNumbers(contracts)], [[K, 'FLA-2025-AIN-MULTI-003-AM02'], ['k-sans-fla', 'CTR-2026-0011']]);
  const alerts = buildAlerts({
    today: TODAY, contracts,
    // Les sources ne portent que le n° FLA sans code d'avenant.
    consolidationRows: [{ contractId: K, numero: 'CTR-2026-0001', numeroFla: 'FLA-2025-AIN-MULTI-003', partnerName: 'ASSOCIATION AINA', overspent: true, actual: 11, budget: 10 }],
    reports: [{ status: 'soumis', kind: 'technique', actions: { decide: true }, partnerName: 'RANO Control', contractId: K, contractNumero: 'CTR-2026-0001', contractFla: 'FLA-2025-AIN-MULTI-003', periodMonth: '2026-10-01' }],
    expected: { rows: [{ month: '2026-08', due: '2026-09', status: 'en_retard', unit: { kind: 'tpm', providerId: 'rano', name: 'RANO Control' },
      contract: { id: K, label: 'FLA-2025-AIN-MULTI-003' }, visits: { planned: 0, realised: 1 } }] },
  });
  const numberOf = (a) => a.params.numero || a.params.contract;
  const aina = alerts.filter((a) => ['budget_overspent', 'contract_ending', 'report_to_validate', 'report_late'].includes(a.kind));
  assert.deepEqual(aina.map((a) => a.kind).sort(), ['budget_overspent', 'contract_ending', 'report_late', 'report_to_validate']);
  assert.deepEqual([...new Set(aina.map(numberOf))], ['FLA-2025-AIN-MULTI-003-AM02'], 'un contrat, un nom');
  assert.equal(alerts.find((a) => a.kind === 'contract_pending').params.numero, 'CTR-2026-0011', 'sans n° FLA : n° MEMS');
  // Un contrat absent de la liste (source seule) : le n° de sa source, jamais un blanc.
  const alone = buildAlerts({ today: TODAY, consolidationRows: [{ contractId: 'k-x', numero: 'CTR-9', numeroFla: 'FLA-9', overspent: true, actual: 2, budget: 1 }],
    expected: { rows: [{ month: '2026-08', due: '2026-09', status: 'en_retard', unit: { kind: 'tpm', name: 'YPA' }, contract: { id: 'k-y', label: 'FLA-Y' }, visits: { planned: 1, realised: 0 } }] } });
  assert.deepEqual(alone.map(numberOf).sort(), ['FLA-9', 'FLA-Y']);
});

test('jours entre deux dates en UTC (aucun décalage horaire)', () => {
  assert.equal(daysBetween('2026-10-13', '2026-10-13'), 0);
  assert.equal(daysBetween('2026-10-13', '2026-10-12'), -1);
  assert.equal(daysBetween('2026-03-28', '2026-03-30'), 2);
});

// Exécution du plan des mesures communes (retour 110) : visites prévues suivies ÷ prévues.
const covOf = (planned, covered) => ({ overall: { execution: { planned, covered, rate: planned > 0 ? covered / planned : null } } });

test('terrain : « aucun plan » n\'est jamais une couverture faible', () => {
  assert.deepEqual(fieldAlerts({ overall: { active: 0, realise: 0, rate: 0 }, byProvider: [] }, { coverage: covOf(0, 0) }), []);
  assert.deepEqual(fieldAlerts(null), []);
  // Le résumé des VISITES seul ne déclenche plus l'alerte : une seule définition de l'exécution.
  assert.deepEqual(fieldAlerts({ overall: { active: 10, realise: 1, rate: 0.1 }, byProvider: [] }), []);
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
  const out = fieldAlerts(field, { coverage: covOf(10, 4), period: { from: '2026-09', to: '2026-09' } });
  assert.deepEqual(out.map((a) => [a.kind, a.sev]), [['field_low_coverage', 'warning'], ['provider_late', 'info'], ['visits_unassigned', 'info']]);
  assert.deepEqual(out[0].params, { done: 4, planned: 10, p: { rate: 0.4 } });
  assert.equal(out[0].detail, '{done}/{planned} visites prévues suivies ({p})');
  // Exécution du plan : l'écran qui affiche la MÊME mesure (Synthèse), sur la période de l'alerte.
  assert.deepEqual(out[0].go, { module: 'processus', sub: 'synthese', period: { from: '2026-09', to: '2026-09' } });
  // Prestataires en retard et visites non affectées : l'écran des visites déclarées ; taux typé comme les pages.
  assert.deepEqual(out[1].go, { module: 'processus', sub: 'sites' });
  assert.deepEqual(out[1].params, { provider: 'ONG A', done: 1, active: 5, p: { rate: 0.2 } });
  assert.equal(out[1].detail, '{done}/{active} réalisées ({p})');
  assert.deepEqual(out[2].go, { module: 'processus', sub: 'sites' });
  // Sans période connue : la Synthèse, sur sa période par défaut.
  assert.deepEqual(fieldAlerts(field, { coverage: covOf(10, 4) })[0].go, { module: 'processus', sub: 'synthese' });
});

test('terrain : prestataire à 0,4 % — taux typé (« 0,4 % » à l\'écran), jamais arrondi à « 0 % » ici', () => {
  const field = { byProvider: [{ key: 'p', label: 'ONG', active: 250, realise: 1, rate: 1 / 250 }] };
  const [late] = fieldAlerts(field, {});
  assert.deepEqual(late.params.p, { rate: 1 / 250 });
});

test('liste triée par gravité, ordre des catégories conservé ; décompte pour la cloche', () => {
  const alerts = buildAlerts({
    consolidationRows: [{ contractId: 'c1', numero: 'X', overspent: false, actual: 1, budget: 10, pendingValidation: 0, projectedOverrun: 1, projectedTotal: 11 }],
    reports: [{ status: 'soumis', kind: 'financier', actions: { decide: true }, periodMonth: '2026-09-01' }],
    contracts: [{ id: 'k', numero: 'K', status: 'actif', dateFin: '2026-01-01' }],
    field: { overall: { active: 4, realise: 0, rate: 0 }, byProvider: [] },
    coverage: covOf(4, 0),
    today: TODAY,
  });
  assert.deepEqual(alerts.map((a) => a.kind), ['budget_projected_overrun', 'contract_expired', 'field_low_coverage', 'report_to_validate']);
  assert.deepEqual(countAlerts(alerts), { critical: 0, warning: 3, info: 1, attention: 3, total: 4 });
  assert.deepEqual(countAlerts([]), { critical: 0, warning: 0, info: 0, attention: 0, total: 0 });
});

test('sources absentes : aucune alerte, aucune erreur', () => {
  assert.deepEqual(buildAlerts({ today: TODAY }), []);
});

// ---- Période (lot 1b) --------------------------------------------------------------
test('terrain : libellé « Exécution du plan » (le taux lu est visites réalisées ÷ prévues), « sur la période » au-delà d\'un mois', () => {
  const field = { overall: { active: 10, realise: 4, rate: 0.4 }, byProvider: [{ key: 'non_affecte', label: 'Non affecté', active: 2, realise: 0, rate: 0, total: 2 }] };
  const coverage = covOf(10, 4);
  const month = fieldAlerts(field, { coverage });
  assert.equal(month[0].title, 'Exécution du plan faible ce mois');
  assert.equal(month[1].detail, 'Ni TPM ni suivi interne ce mois');
  const range = fieldAlerts(field, { range: true, coverage });
  assert.equal(range[0].title, 'Exécution du plan faible sur la période');
  assert.equal(range[1].detail, 'Ni TPM ni suivi interne sur la période');
  assert.deepEqual(range.map((a) => a.params), month.map((a) => a.params), 'mêmes chiffres');
  // Un mois PASSÉ choisi (septembre vu en octobre) n'est jamais « ce mois » : il est nommé.
  const sept = fieldAlerts(field, { month: '2026-09', coverage });
  assert.equal(sept[0].title, 'Exécution du plan faible ({m})');
  assert.equal(sept[1].detail, 'Ni TPM ni suivi interne ({m})');
  assert.deepEqual(sept[0].params.m, { month: '2026-09' });
  assert.deepEqual(sept[1].params, { n: 2, m: { month: '2026-09' } });
  assert.equal(fieldAlerts(field, { month: '2026-09', range: true, coverage })[0].title, 'Exécution du plan faible sur la période');
});

test('portée de chaque alerte : budget et contrats à date ; terrain sur la période ; rapports selon le filtre', () => {
  const src = {
    consolidationRows: [{ contractId: 'c1', numero: 'X', overspent: true, actual: 11, budget: 10 }],
    reports: [{ status: 'soumis', kind: 'financier', actions: { decide: true }, periodMonth: '2026-09-01' }],
    contracts: [{ id: 'k', numero: 'K', status: 'actif', dateFin: '2026-01-01' }],
    field: { overall: { active: 4, realise: 0, rate: 0 }, byProvider: [] },
    coverage: covOf(4, 0),
    today: TODAY,
  };
  const scopeOf = (list) => Object.fromEntries(list.map((a) => [a.kind, a.scope]));
  assert.deepEqual(scopeOf(buildAlerts(src)), {
    budget_overspent: 'a_date', report_to_validate: 'a_date', contract_expired: 'a_date', field_low_coverage: 'periode',
  });
  assert.equal(scopeOf(buildAlerts({ ...src, reportsInPeriod: true })).report_to_validate, 'periode');
  assert.equal(buildAlerts({ ...src, range: true }).find((a) => a.kind === 'field_low_coverage').title, 'Exécution du plan faible sur la période');
});

test('exécution du plan faible : le lien garde TOUTE la période — Synthèse jusqu\'à 12 mois, « Couverture & performance » au-delà (jamais écartée)', () => {
  const { executionGo, SYNTHESE_MAX_SPAN } = require('../src/modules/dashboards/alertsMath');
  const { PERIOD_CAPS } = require('../src/modules/common/periodCaps');
  assert.equal(SYNTHESE_MAX_SPAN, 12);
  assert.deepEqual(executionGo({ from: '2026-01', to: '2026-12' }), { module: 'processus', sub: 'synthese', period: { from: '2026-01', to: '2026-12' } });
  assert.deepEqual(executionGo({ from: '2025-01', to: '2026-06' }), { module: 'reporting', sub: 'synthese', period: { from: '2025-01', to: '2026-06' } });
  assert.deepEqual(executionGo({ from: '2025-01', to: '2026-12' }).module, 'reporting', `${PERIOD_CAPS.facts} mois : durée maximale du Centre d'alertes`);
  // Par l'alerte elle-même (18 mois, exécution < 50 %).
  const field = { byProvider: [] };
  const [a] = fieldAlerts(field, { range: true, coverage: { overall: { execution: { planned: 10, covered: 4, rate: 0.4 } } }, period: { from: '2025-01', to: '2026-06' } });
  assert.deepEqual(a.go, { module: 'reporting', sub: 'synthese', period: { from: '2025-01', to: '2026-06' } });
});

test('écrans d\'arrivée : la Synthèse jusqu\'à 12 mois, le Rapport de synthèse jusqu\'à la durée du Centre d\'alertes ; chaque écran ≤ le plafond de ses endpoints ; même mesure', (t) => {
  const fs = require('fs'); const path = require('path');
  const web = (...p) => path.join(__dirname, '../../web/src', ...p);
  if (!fs.existsSync(web('pages'))) { t.skip('web/ absent'); return; }
  const { PERIOD_CAPS } = require('../src/modules/common/periodCaps');
  const syn = fs.readFileSync(web('pages', 'monitoring', 'ProcessDashboardPage.jsx'), 'utf8');
  const rep = fs.readFileSync(web('pages', 'dashboard', 'ReportingPage.jsx'), 'utf8');
  const cov = fs.readFileSync(web('pages', 'dashboard', 'DashboardCoveragePage.jsx'), 'utf8');
  const alerts = fs.readFileSync(web('pages', 'dashboard', 'AlertsPage.jsx'), 'utf8');
  assert.match(syn, /const ANALYSIS_MAX_SPAN = Math\.min\(PERIOD_CAPS\.analysis, PERIOD_CAPS\.facts\);/, 'Synthèse : jumeau de SYNTHESE_MAX_SPAN');
  // Rapport de synthèse : consolidation (document) + couverture (facts) — accepte la durée du Centre d'alertes.
  assert.match(rep, /const REPORT_MAX_SPAN = Math\.min\(PERIOD_CAPS\.document, PERIOD_CAPS\.facts\);/);
  assert.ok(Math.min(PERIOD_CAPS.document, PERIOD_CAPS.facts) >= PERIOD_CAPS.facts);
  assert.match(alerts, /ALERTS_MAX_SPAN = PERIOD_CAPS\.facts/, 'Centre d\'alertes : facts');
  // « Couverture & performance » appelle coverage-dashboard (plafond analysis) : jamais plus long.
  assert.match(cov, /api\.monCoverageDashboard\(period\)/);
  assert.match(cov, /const ANALYSIS_MAX_SPAN = Math\.min\(PERIOD_CAPS\.analysis, PERIOD_CAPS\.facts\);/, 'Couverture & performance : plafond de coverage-dashboard');
  for (const src of [syn, rep, cov]) {
    assert.match(src, /api\.dashCoverage\(period\)/);
    assert.match(src, /tr\('Exécution du plan \(visites\)'\)/);
  }
});
