/**
 * Relecture croisée, point 14 — UN mois courant : à 22 h 30 UTC le dernier jour d'un mois (1 h 30 le 1ᵉʳ
 * à Antananarivo), la cloche / le Centre d'alertes et la carte « Rapports attendus » (GET /reports/expected,
 * rbmMath.currentMonth) jugent « en retard » sur le MÊME mois local. Sans base : horloge figée (Date
 * seulement), sources remplacées par des espions ; les rapports attendus sont calculés par la règle pure.
 */
process.env.NODE_ENV = 'production';
process.env.LOG_LEVEL = 'silent';
process.env.APP_TIMEZONE = 'Indian/Antananarivo';
const test = require('node:test');
const assert = require('node:assert/strict');
const consolidationRepo = require('../src/modules/tpm/consolidation.repository');
const contractsService = require('../src/modules/contracts/contracts.service');
const reportsRepo = require('../src/modules/tpm/reports.repository');
const fieldRepo = require('../src/modules/tpm/field.repository');
const coverageService = require('../src/modules/dashboards/coverage.service');
const { expectedReports: expectedRule } = require('../src/modules/tpm/reportExpectation');
const { currentMonth } = require('../src/modules/tpm/rbmMath');
const { alerts } = require('../src/modules/dashboards/alerts.service');

// Une visite réalisée de septembre, sans facture : en retard dès novembre (échéance : octobre).
const activity = [{ key: 'ypa', contractId: 'k1', month: '2026-09', planned: 0, realised: 2 }];
const names = new Map([['ypa', 'YPA']]);
const monthsOf = ({ from, to }) => {
  const out = [];
  for (let m = from; m <= to; m = m.endsWith('-12') ? `${Number(m.slice(0, 4)) + 1}-01` : `${m.slice(0, 5)}${String(Number(m.slice(5)) + 1).padStart(2, '0')}`) out.push(m);
  return out;
};
const rule = ({ period, today }) => expectedRule({ months: monthsOf(period), today, activity, names, contractLabels: new Map([['k1', 'FLA-1']]) });
const seen = [];
consolidationRepo.consolidation = async () => ({ rows: [] });
contractsService.listContracts = async () => [];
reportsRepo.listReports = async () => [];
reportsRepo.expectedReports = async (tenantId, opts) => { seen.push(opts); return rule(opts); };
fieldRepo.summary = async () => ({ overall: { active: 0, rate: null }, byProvider: [] });
coverageService.coverage = async () => ({ overall: { execution: { planned: 0, covered: 0, rate: null } } });

test('22 h 30 UTC le 31 octobre (1 h 30 le 1ᵉʳ novembre à Antananarivo) : alertes et carte sur le même mois', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-31T22:30:00Z') });
  return (async () => {
    assert.equal(currentMonth(), '2026-11', 'mois courant local (carte : GET /reports/expected)');
    const card = rule({ period: { from: '2026-09', to: '2026-09' }, today: currentMonth() }).rows.filter((r) => r.status === 'en_retard');
    assert.deepEqual(card.map((r) => [r.month, r.unit.providerId]), [['2026-09', 'ypa']]);
    const out = await alerts({ tenantId: 't', userId: 'u', role: 'admin' });
    assert.equal(out.today, '2026-11-01', 'jour LOCAL, jamais le jour UTC');
    assert.equal(seen.at(-1).today, '2026-11');
    assert.equal(out.lateReportsWindow.to, '2026-11');
    const late = out.items.filter((a) => a.kind === 'report_late');
    assert.deepEqual(late.map((a) => [a.params.month.month, a.params.provider]), card.map((r) => [r.month, 'YPA']), 'mêmes rapports en retard');
    // Période choisie (Centre d'alertes) : même verdict.
    const chosen = await alerts({ tenantId: 't', userId: 'u', role: 'admin' }, { period: { from: '2026-09', to: '2026-09' } });
    assert.equal(chosen.items.filter((a) => a.kind === 'report_late').length, 1);
  })();
});

test('20 h 30 UTC le même jour (23 h 30 à Antananarivo) : encore octobre partout, rien en retard', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-31T20:30:00Z') });
  return (async () => {
    assert.equal(currentMonth(), '2026-10');
    const out = await alerts({ tenantId: 't', userId: 'u', role: 'admin' });
    assert.equal(out.today, '2026-10-31');
    assert.equal(out.items.filter((a) => a.kind === 'report_late').length, 0);
  })();
});
