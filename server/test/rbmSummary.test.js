const test = require('node:test');
const assert = require('node:assert/strict');
const { rbmSummary, scopeSites, dueSites } = require('../src/modules/tpm/rbmSummary');
const { coverageStatus } = require('../src/modules/common/coverageStatus');

const S = (o) => ({ id: o.id, name: o.id, riskLevel: 'moyenne', due: false, toPlan: false, neverVisited: false, urgentFlags: false, forbidden: false, finalScore: 1, priority: 1, reasons: [], ...o });
const SITES = [
  S({ id: 'a', riskLevel: 'elevee', due: true, toPlan: true, urgentFlags: true, finalScore: 2, priority: 2, fieldOfficeId: 'ant1', activity: 'Cantine', reasons: [{ code: 'fraud', label: 'Fraude et corruption', urgent: true }, { code: 'synergies', label: 'Synergies de programme', urgent: false }] }),
  S({ id: 'b', riskLevel: 'faible', due: true, neverVisited: true, finalScore: 0, priority: 1, fieldOfficeId: 'bur1', activity: 'cantine ', lastVisitMonth: null, reasons: [{ code: 'synergies', label: 'Synergies de programme', urgent: false }] }),
  S({ id: 'c', riskLevel: 'moyenne', fieldOfficeId: null, activity: 'Nutrition' }),
  S({ id: 'd', riskLevel: 'elevee', due: true, forbidden: true, fieldOfficeId: 'bur2', activity: 'Cantine', lastVisitMonth: '2025-01' }),
];

test('synthèse RBM : comme le tableau de bord (total, à suivre, par risque) + niveaux, drapeaux', () => {
  const s = rbmSummary(SITES);
  assert.equal(s.total, 4); assert.equal(s.due, 3); assert.equal(s.upToDate, 1); assert.equal(s.toPlan, 1);
  assert.deepEqual(s.byRisk, { elevee: 2, moyenne: 1, faible: 1 });
  assert.equal(s.urgent, 1); assert.equal(s.forbidden, 1); assert.equal(s.neverVisited, 1);
  assert.deepEqual(s.flags.map((f) => [f.code, f.sites, f.urgent]), [['fraud', 1, 1], ['synergies', 2, 0]]);
  assert.deepEqual(rbmSummary([]).byRisk, { elevee: 0, moyenne: 0, faible: 0 });
});

test('périmètre : un bureau couvre ses antennes ; « sans bureau » ; activité sans casse', () => {
  const parentOf = new Map([['ant1', 'bur1'], ['bur1', null], ['bur2', null]]);
  assert.deepEqual(scopeSites(SITES, { officeId: 'bur1', parentOf }).map((s) => s.id), ['a', 'b']);
  assert.deepEqual(scopeSites(SITES, { officeId: 'unlinked', parentOf }).map((s) => s.id), ['c']);
  assert.deepEqual(scopeSites(SITES, { activity: 'CANTINE' }).map((s) => s.id), ['a', 'b', 'd']);
});

test('sites à suivre : urgents d\'abord, puis priorité ; zone interdite exclue (suivi à distance)', () => {
  assert.deepEqual(dueSites(SITES).map((s) => s.id), ['a', 'b']);
});

test('statut d\'une couverture : seuils 80 / 60 / 30, sans taux → null (« — aucun plan »)', () => {
  assert.equal(coverageStatus(0.82), 'bon'); assert.equal(coverageStatus(0.8), 'bon');
  assert.equal(coverageStatus(0.65), 'moyen'); assert.equal(coverageStatus(0.38), 'faible');
  assert.equal(coverageStatus(0.25), 'critique'); assert.equal(coverageStatus(0), 'critique');
  assert.equal(coverageStatus(null), null); assert.equal(coverageStatus(undefined), null); assert.equal(coverageStatus('x'), null);
});
