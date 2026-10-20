/**
 * Centre d'alertes (GET /api/alerts) SANS base : chaque source est remplacée
 * par un espion. On vérifie que « à valider » suit la liste de rôles partagée
 * avec les routes des rapports (reportWorkflow.REPORT_WRITE_ROLES), et qu'une
 * source illisible est signalée dans `unavailable` sans empêcher les autres.
 */
process.env.NODE_ENV = 'production'; // logger sans transport « pretty » (pas de thread)
process.env.LOG_LEVEL = 'silent';
const test = require('node:test');
const assert = require('node:assert/strict');
const consolidationRepo = require('../src/modules/tpm/consolidation.repository');
const contractsService = require('../src/modules/contracts/contracts.service');
const reportsRepo = require('../src/modules/tpm/reports.repository');
const fieldRepo = require('../src/modules/tpm/field.repository');
const db = require('../src/config/db');
// État RBM (score de chaque site du registre, en JavaScript) : compté AVANT le chargement du dépôt
// de couverture, qui lit rbmSitesTx et withTenantTransaction à l'import.
let rbmCalls = 0;
const coverageSql = [];
fieldRepo.rbmSitesTx = async () => { rbmCalls += 1; return []; };
db.withTenantTransaction = async (tenantId, fn) => fn({ query: async (sql, params) => { coverageSql.push({ sql: String(sql), params }); return { rows: [] }; } });
const coverageService = require('../src/modules/dashboards/coverage.service');
const realCoverage = coverageService.coverage;
const { REPORT_WRITE_ROLES } = require('../src/modules/tpm/reportWorkflow');
const { alerts } = require('../src/modules/dashboards/alerts.service');

const SUBMITTED = {
  id: 'r1', status: 'soumis', kind: 'technique', createdBy: 'u1', submittedBy: 'u1', editedBy: 'u1',
  partnerName: 'Prestataire A', contractNumero: 'FLA-2025-001', periodMonth: '2026-09-01',
};
let fieldFails = false;
consolidationRepo.consolidation = async () => ({ rows: [] });
contractsService.listContracts = async () => [];
const seen = { reports: [], field: [], coverage: [], expected: [] };
reportsRepo.listReports = async (tenantId, opts) => { seen.reports.push(opts); return [SUBMITTED]; };
// Rapports attendus (retour 114) : réponse de reports.repository.expectedReports.
let expectedRows = [];
reportsRepo.expectedReports = async (tenantId, opts) => { seen.expected.push({ tenantId, ...opts }); return { rows: expectedRows }; };
fieldRepo.summary = async (tenantId, opts) => { seen.field.push(opts); if (fieldFails) throw new Error('base indisponible'); return { overall: { active: 0, rate: null }, byProvider: [] }; };
// Exécution du plan : mesures communes (retour 110), compte tiré de la session.
let execution = { planned: 0, covered: 0, rate: null };
coverageService.coverage = async (auth, opts) => { seen.coverage.push({ tenantId: auth.tenantId, ...opts }); if (fieldFails) throw new Error('base indisponible'); return { overall: { execution } }; };

const TODAY = { today: '2026-10-13' };
const reportAlerts = (out) => out.items.filter((a) => a.cat === 'Rapports');

test('« à valider » : seulement pour un rôle qui écrit les rapports (liste partagée avec les routes)', async () => {
  for (const role of REPORT_WRITE_ROLES) {
    const out = await alerts({ tenantId: 't', userId: 'u2', role }, TODAY);
    assert.equal(reportAlerts(out).length, 1, role);
  }
  const viewer = await alerts({ tenantId: 't', userId: 'u2', role: 'viewer' }, TODAY);
  assert.equal(reportAlerts(viewer).length, 0);
  // Séparation des tâches : jamais son propre rapport.
  const self = await alerts({ tenantId: 't', userId: 'u1', role: 'manager' }, TODAY);
  assert.equal(reportAlerts(self).length, 0);
});

test('source illisible : signalée dans `unavailable`, les autres alertes restent', async () => {
  fieldFails = true;
  try {
    const out = await alerts({ tenantId: 't', userId: 'u2', role: 'admin' }, TODAY);
    assert.deepEqual(out.unavailable, ['terrain']);
    assert.equal(reportAlerts(out).length, 1);
  } finally { fieldFails = false; }
});

test('sans période (la cloche) : terrain du mois courant, tous les rapports ; avec une période : les deux filtrés', async () => {
  seen.reports.length = 0; seen.field.length = 0; seen.coverage.length = 0;
  const bell = await alerts({ tenantId: 't', userId: 'u2', role: 'admin' }, TODAY);
  assert.deepEqual(seen.field[0], { period: { from: '2026-10', to: '2026-10' } });
  assert.deepEqual(seen.coverage[0], { tenantId: 't', period: { from: '2026-10', to: '2026-10' }, rbm: false });
  assert.deepEqual(seen.reports[0], {});
  assert.deepEqual(bell.period, { from: '2026-10', to: '2026-10', months: 1 });
  assert.equal(bell.month, '2026-10');
  const page = await alerts({ tenantId: 't', userId: 'u2', role: 'admin' }, { ...TODAY, period: { from: '2026-01', to: '2026-06' } });
  assert.deepEqual(seen.field[1], { period: { from: '2026-01', to: '2026-06' } });
  assert.deepEqual(seen.reports[1], { period: { from: '2026-01', to: '2026-06' } });
  assert.deepEqual(page.period, { from: '2026-01', to: '2026-06', months: 6 });
  assert.equal(page.items.find((a) => a.cat === 'Rapports').scope, 'periode');
});

test('libellé du terrain : « ce mois » pour la cloche seulement ; un mois passé choisi est nommé ; une plage « sur la période »', async () => {
  const saved = execution;
  execution = { planned: 22, covered: 4, rate: 4 / 22 };
  try {
    const low = (out) => out.items.find((a) => a.kind === 'field_low_coverage');
    const bell = low(await alerts({ tenantId: 't', userId: 'u2', role: 'admin' }, TODAY));
    assert.equal(bell.title, 'Exécution du plan faible ce mois');
    const sept = low(await alerts({ tenantId: 't', userId: 'u2', role: 'admin' }, { ...TODAY, period: { from: '2026-09', to: '2026-09' } }));
    assert.equal(sept.title, 'Exécution du plan faible ({m})');
    assert.deepEqual(sept.params.m, { month: '2026-09' });
    const h1 = low(await alerts({ tenantId: 't', userId: 'u2', role: 'admin' }, { ...TODAY, period: { from: '2026-01', to: '2026-06' } }));
    assert.equal(h1.title, 'Exécution du plan faible sur la période');
  } finally { execution = saved; }
});

test('cloche : la couverture est lue SANS l\'état RBM (aucun score de site calculé puis jeté à chaque sondage)', async () => {
  const stub = coverageService.coverage;
  coverageService.coverage = realCoverage; // service et dépôt réels, faux client
  rbmCalls = 0; coverageSql.length = 0;
  try {
    const out = await alerts({ tenantId: 't', userId: 'u2', role: 'admin' }, TODAY);
    assert.deepEqual(out.unavailable, []);
    assert.equal(rbmCalls, 0, 'rbmSitesTx jamais appelé par les alertes');
    const main = coverageSql.find((q) => /GROUPING SETS/.test(q.sql));
    assert.ok(main, 'exécution du plan lue sur la requête des tableaux de bord');
    assert.ok(main.params.some((p) => Array.isArray(p) && p.length === 0), 'aucun site « à suivre » transmis');
    // Le tableau de bord, lui, lit toujours l'état RBM.
    const cov = await realCoverage({ tenantId: 't' }, { period: { from: '2026-10', to: '2026-10' } });
    assert.equal(rbmCalls, 1);
    assert.ok(cov.overall.rbm, 'tableau de bord : état RBM présent');
    const bell = await realCoverage({ tenantId: 't' }, { period: { from: '2026-10', to: '2026-10' }, rbm: false });
    assert.equal(bell.overall.rbm, null, 'sans état RBM : null, jamais « 0 à suivre »');
    assert.equal(rbmCalls, 1);
  } finally { coverageService.coverage = stub; }
});

test('rapports en retard (retour 114) : seulement les factures attendues d un TPM qui avait des visites ; jamais non applicable ni interne', async () => {
  seen.expected.length = 0;
  const row = (over) => ({ month: '2026-07', unit: { kind: 'tpm', providerId: 'p1', name: 'RANO Control', offices: [] }, visits: { planned: 2, realised: 3 },
    status: 'en_retard', expected: true, auto: false, due: '2026-08', reports: [], ...over });
  expectedRows = [
    row(),
    row({ unit: { kind: 'tpm', providerId: 'p2', name: 'YPA', offices: [] }, visits: { planned: 0, realised: 0 }, status: 'non_applicable', expected: false, auto: true }),
    row({ unit: { kind: 'interne', providerId: null, name: null, offices: ['Toliara'] }, status: 'attendu' }),
    row({ unit: { kind: 'tpm', providerId: 'p3', name: 'SAHY Monitoring', offices: [] }, status: 'attendu', month: '2026-10', due: '2026-11' }),
  ];
  try {
    const bell = await alerts({ tenantId: 't', userId: 'u2', role: 'admin' }, TODAY);
    assert.deepEqual(seen.expected[0], { tenantId: 't', period: { from: '2025-11', to: '2026-10' }, today: '2026-10' }, 'la cloche : les 12 derniers mois, mois courant compris');
    assert.deepEqual(bell.lateReportsWindow, { from: '2025-11', to: '2026-10' }, 'fenêtre rendue : la page la dit');
    const late = bell.items.filter((a) => a.kind === 'report_late');
    assert.equal(late.length, 1);
    assert.deepEqual([late[0].sev, late[0].params.provider, late[0].params.n, late[0].params.month, late[0].params.due, late[0].scope],
      ['warning', 'RANO Control', 5, { month: '2026-07' }, { month: '2026-08' }, 'a_date']);
    await alerts({ tenantId: 't', userId: 'u2', role: 'admin' }, { ...TODAY, period: { from: '2026-01', to: '2026-06' } });
    assert.deepEqual(seen.expected[1].period, { from: '2026-01', to: '2026-06' }, 'période choisie au Centre d alertes');
  } finally { expectedRows = []; }
});
