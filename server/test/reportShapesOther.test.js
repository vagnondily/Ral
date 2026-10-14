/**
 * Concepteur de rapport (lot 7a, C5) — budget, contrats, TPM, PDD, alertes, carte, qualité.
 *  - montants issus des centimes, jamais une re-somme flottante (partenaire, PDD) ;
 *  - budget et PDD « Non disponible par bureau » ;
 *  - alertes = mêmes niveaux et nombres que le Centre d'alertes, lecteur neutre ;
 *  - carte indisponible sans le lot 6a ; argument requis absent → 400.
 */
process.env.LOG_LEVEL = 'silent';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildConsolidation, totalsOf } = require('../src/modules/tpm/consolidation');
const { summarize } = require('../src/modules/pdd/pddMath');
const { buildAlerts, countAlerts } = require('../src/modules/dashboards/alertsMath');
const { datasetDef, kpiDef, catalogForClient } = require('../src/modules/reports/catalog');
const { SOURCES } = require('../src/modules/reports/sources');
const service = require('../src/modules/reports/reports.service');
const reportsRepo = require('../src/modules/reports/reports.repository');
const alertsService = require('../src/modules/dashboards/alerts.service');

const ctx = (lang = 'fr', args = {}) => ({ lang, args, officeParents: new Map(), today: '2026-03-15' });
const P = { period: { from: '2026-01', to: '2026-03' } };

const CONS = buildConsolidation([
  { id: 'c1', numero: 'FLA-1', partnerId: 'p1', partnerName: 'TOHANA', dateDebut: '2026-01-01', dateFin: '2026-12-31', periodMonths: 12, monitoringBudget: 1000.1 },
  { id: 'c2', numero: 'FLA-2', partnerId: 'p2', partnerName: 'ASOS', dateDebut: '2026-01-01', dateFin: '2026-12-31', periodMonths: 12, monitoringBudget: 500.2 },
], [
  { contractId: 'c1', month: '2026-01', planned: 0.1, actual: 0.1 },
  { contractId: 'c1', month: '2026-02', planned: 0.2, actual: 0.2 },
  { contractId: 'c2', month: '2026-02', planned: 10, actual: 7.7 },
], { today: '2026-03' });

test('budget : totaux d\'un partenaire recalculés en centimes (0,1 + 0,2 = 0,3), taux sur ces sommes', () => {
  const k = datasetDef('bud.kpis').shape(CONS, { ...P, partnerId: 'p1' }, ctx());
  assert.equal(k.rows[0].actual, 0.3);
  assert.equal(k.rows[0].budget, 1000.1);
  assert.equal(k.rows[0].contracts, 1);
  assert.equal(kpiDef('budget_actual').pick(CONS, P, ctx()).value, 8);
  assert.deepEqual(totalsOf(CONS.rows), CONS.totals);
  const m = datasetDef('bud.monthly').shape(CONS, P, ctx());
  assert.deepEqual(m.rows.map((r) => [r.month, r.actual, r.ecart]), [['2026-01', 0.1, 0], ['2026-02', 7.9, -2.3]]);
  const bp = datasetDef('bud.by_partner').shape(CONS, P, ctx());
  assert.equal(bp.rows.reduce((a, r) => a + Math.round(r.actual * 100), 0), 800);
});

test('PDD : cash additionné en centimes et tonnages en kilogrammes (jamais 0,30000000000000004)', () => {
  const s = summarize([{ cashUsd: 0.1, totalFood: 0.1, items: { riz: 0.1 } }, { cashUsd: 0.2, totalFood: 0.2, items: { riz: 0.2 } }]);
  assert.equal(s.total.cashUsd, 0.3);
  assert.equal(s.total.totalFood, 0.3);
  assert.equal(s.total.byCommodity.riz, 0.3);
  const d = datasetDef('pdd.by_commodity').shape({ total: s.total }, P, ctx());
  assert.deepEqual(d.rows.map((r) => [r.commodity, r.mt, r.share]), [['riz', 0.3, 100]]);
});

test('budget, contrats et PDD : « Non disponible par bureau », jamais un total national', () => {
  for (const key of ['bud.kpis', 'bud.by_contract', 'ctr.list', 'pdd.kpis', 'pdd.by_month', 'pdd.by_zone']) {
    assert.equal(service.unsupportedNote(datasetDef(key), { office: 'id:o1' }, 'fr'), 'Non disponible par bureau.', key);
  }
  for (const key of ['budget_total', 'consumption', 'pdd_food', 'pdd_cash', 'contracts_active']) {
    assert.equal(service.unsupportedNote(kpiDef(key), { office: 'id:o1' }, 'en'), 'Not available by office.', key);
  }
});

test('alertes : mêmes niveaux et nombres que le Centre d\'alertes ; phrases à paramètres', () => {
  const items = buildAlerts({ consolidationRows: CONS.rows.map((r) => ({ ...r, overspent: r.contractId === 'c2' })), contracts: [
    { id: 'c9', numero: 'FLA-9', partnerName: 'X', status: 'actif', dateFin: '2026-04-01' },
  ], reports: [], field: null, today: '2026-03-15' });
  const raw = { today: '2026-03-15', items, counts: countAlerts(items), unavailable: [] };
  const l = datasetDef('alerts.list').shape(raw, P, ctx());
  assert.deepEqual(l.rows.map((r) => r.level), items.map((a) => a.sev));
  assert.equal(l.rows[0].title.text, 'Budget de suivi dépassé — {numero}');
  const c = datasetDef('alerts.counts').shape(raw, P, ctx());
  assert.deepEqual(c.rows[0], { _key: 'counts', critical: 1, warning: 1, info: 0, total: 2 });
  assert.equal(kpiDef('alerts_critical').pick(raw).value, 1);
});

test('alertes du rapport : lecteur NEUTRE (droits d\'écriture, aucun utilisateur), jamais la vue de celui qui rend', async () => {
  const seen = [];
  const orig = alertsService.alerts;
  alertsService.alerts = async (auth) => { seen.push(auth); return { items: [], counts: countAlerts([]) }; };
  try {
    await SOURCES.alerts.load('t1', SOURCES.alerts.params(datasetDef('alerts.list'), P, {}), { lang: 'fr', actor: { userId: 'u-moi' } });
  } finally { alertsService.alerts = orig; }
  assert.deepEqual(seen, [{ tenantId: 't1', userId: null, role: 'admin' }]);
});

test('carte : indisponible sans le lot 6a, jamais calculée sur une ancienne base', () => {
  const c = catalogForClient();
  for (const k of ['map.districts', 'map.points']) {
    assert.equal(c.datasets[k].available, false);
    assert.equal(c.datasets[k].reason, 'Disponible avec le lot 6a');
  }
});

test('argument requis absent (contrat, facture) → 400 à la validation du document', async () => {
  const orig = reportsRepo.listOffices;
  reportsRepo.listOffices = async () => [];
  try {
    const doc = { schemaVersion: 2, title: 'R', period: P.period, filters: {}, blocks: [{ id: 'f', type: 'data', params: { dataset: 'ctr.forecast', view: 'line', filters: {}, args: {} } }] };
    await assert.rejects(service.normalizeDoc('t1', doc), (e) => e.statusCode === 400 && /Argument requis : Contrat/.test(JSON.stringify(e.details)));
    doc.blocks[0].params.args.contractId = '11111111-1111-4111-8111-111111111111';
    const ok = await service.normalizeDoc('t1', doc);
    assert.equal(ok.doc.blocks[0].params.dataset, 'ctr.forecast');
  } finally { reportsRepo.listOffices = orig; }
});

test('contrats, TPM et qualité : mises en forme (échéances, budget détaillé, statuts, liaisons)', () => {
  const contracts = [
    { id: 'a', numero: 'FLA-A', partnerId: 'p1', partnerName: 'P1', status: 'actif', dateDebut: '2025-06-01', dateFin: '2026-04-30', budgetTotal: 10, monitoringBudget: 5, spentTotal: 1 },
    { id: 'b', numero: 'FLA-B', partnerId: 'p2', partnerName: 'P2', status: 'brouillon', dateDebut: '2026-01-01', dateFin: '2026-12-31' },
  ];
  assert.deepEqual(datasetDef('ctr.list').shape(contracts, P, ctx()).rows.map((r) => r.numero), ['FLA-A']);
  const exp = datasetDef('ctr.expiring').shape(contracts, {}, ctx());
  assert.deepEqual(exp.rows.map((r) => [r.numero, r.days]), [['FLA-A', 46]]);
  assert.equal(exp.rows[0].alert.text, 'Échéance proche — {numero}');
  const reps = [
    { partnerId: 'p1', partnerName: 'P1', kind: 'financier', periodMonth: '2026-01-01', status: 'valide' },
    { partnerId: 'p1', partnerName: 'P1', kind: 'financier', periodMonth: '2026-02-01', status: 'soumis' },
    { partnerId: 'p1', partnerName: 'P1', kind: 'financier', periodMonth: '2025-12-01', status: 'valide' },
  ];
  const rs = datasetDef('tpm.reports_status').shape(reps, P, ctx('en'));
  assert.deepEqual(rs.rows.map((r) => [r.kind, r.expected, r.valide, r.soumis, r.rate]), [['Financial', 2, 1, 1, 50]]);
  const ln = datasetDef('quality.linking').shape({ sites: { total: 10, withoutPcode: 3, withoutOffice: 0 }, submissions: {}, queue: { entries: 2 } }, P, ctx());
  assert.equal(ln.rows[0].share, 30);
  assert.equal(datasetDef('ctr.forecast').shape(null, P, ctx('en')).meta.note, 'Choose a contract.');
});
