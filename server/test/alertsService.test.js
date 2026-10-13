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
const { REPORT_WRITE_ROLES } = require('../src/modules/tpm/reportWorkflow');
const { alerts } = require('../src/modules/dashboards/alerts.service');

const SUBMITTED = {
  id: 'r1', status: 'soumis', kind: 'technique', createdBy: 'u1', submittedBy: 'u1', editedBy: 'u1',
  partnerName: 'Prestataire A', contractNumero: 'FLA-2025-001', periodMonth: '2026-09-01',
};
let fieldFails = false;
consolidationRepo.consolidation = async () => ({ rows: [] });
contractsService.listContracts = async () => [];
reportsRepo.listReports = async () => [SUBMITTED];
fieldRepo.summary = async () => { if (fieldFails) throw new Error('base indisponible'); return { overall: { active: 0, rate: null }, byProvider: [] }; };

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
