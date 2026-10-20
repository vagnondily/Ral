const test = require('node:test');
const assert = require('node:assert/strict');
const e = require('../src/modules/tpm/reportExpectation');
const { lateReportAlerts } = require('../src/modules/dashboards/alertsMath');
const { shapeRangeSummary, summarizeVisits, unitKeyOf } = require('../src/modules/tpm/fieldMath');

const months = ['2026-07', '2026-08', '2026-09', '2026-10'];
const names = () => new Map([['rano', 'RANO Control'], ['ypa', 'YPA'], ['sahy', 'SAHY Monitoring']]);

test('échéance : le rapport du mois M se remet au plus tard en M+1 ; en retard à partir de M+2', () => {
  assert.equal(e.DUE_MONTHS_AFTER, 1);
  assert.equal(e.dueMonth('2026-12'), '2027-01');
  const base = { visits: 3, docs: [], month: '2026-08' };
  assert.equal(e.tpmStatus({ ...base, today: '2026-08' }).status, 'attendu');
  assert.equal(e.tpmStatus({ ...base, today: '2026-09' }).status, 'attendu', 'au cours du mois suivant : encore dans les temps');
  assert.deepEqual(e.tpmStatus({ ...base, today: '2026-10' }), { status: 'en_retard', expected: true, auto: false, reason: 'echeance_depassee' });
});

test('pas de planification → pas de rapport : TPM sans visite = « non applicable » d office, jamais en retard', () => {
  const s = e.tpmStatus({ visits: 0, docs: [{ status: 'attendu' }], month: '2026-07', today: '2026-10' });
  assert.deepEqual(s, { status: 'non_applicable', expected: false, auto: true, reason: 'aucune_visite' });
  assert.equal(e.tpmStatus({ visits: 0, docs: [], month: '2026-07', today: '2026-10', off: true }).reason, 'tpm_indisponible');
  // Saisi « non applicable » à la main : non applicable, pas « d'office ».
  assert.deepEqual(e.tpmStatus({ visits: 0, docs: [{ status: 'non_applicable' }], month: '2026-07', today: '2026-10' }).auto, false);
  assert.equal(e.tpmStatus({ visits: 4, docs: [{ status: 'non_applicable' }], month: '2026-07', today: '2026-10' }).reason, 'saisi_non_applicable');
});

test('un document réel l emporte (le plus avancé) ; une facture rejetée reste « rejetée »', () => {
  assert.equal(e.tpmStatus({ visits: 2, docs: [{ status: 'attendu' }, { status: 'soumis' }], month: '2026-07', today: '2026-10' }).status, 'soumis');
  assert.equal(e.tpmStatus({ visits: 2, docs: [{ status: 'rejete' }, { status: 'valide' }], month: '2026-07', today: '2026-10' }).status, 'valide');
  assert.equal(e.tpmStatus({ visits: 0, docs: [{ status: 'valide' }], month: '2026-07', today: '2026-10' }).status, 'valide', 'facturé sans visite : le document reste');
  assert.equal(e.tpmStatus({ visits: 2, docs: [{ status: 'rejete' }], month: '2026-07', today: '2026-12' }).status, 'rejete');
});

test('expectedReports : TPM des contrats, TPM des visites, factures ; suivi interne → rapport interne, avec les bureaux', () => {
  const out = e.expectedReports({
    months, today: '2026-10', names: names(),
    contractTpms: new Map(months.map((m) => [m, new Set(['rano', 'sahy'])])),
    activity: [
      { key: 'rano', month: '2026-07', planned: 0, realised: 4 },
      { key: 'rano', month: '2026-09', planned: 2, realised: 0 },
      { key: 'ypa', name: 'YPA', month: '2026-08', planned: 1, realised: 0 }, // TPM « hors contrat » d'une visite
      { key: 'interne', month: '2026-08', planned: 3, realised: 1, offices: ['Toliara', 'Ambovombe', 'Toliara'] },
      { key: 'interne', month: '2026-09', planned: 0, realised: 0, cancelled: 2 }, // seulement annulées : rien d'attendu
      { key: 'non_affecte', month: '2026-08', planned: 5, realised: 0 }, // antérieures : aucun rapport
    ],
    reports: [{ id: 'r1', partnerId: 'rano', month: '2026-07', status: 'valide', contractLabel: 'FLA-1' }, { id: 'r2', partnerId: 'sahy', month: '2026-08', status: 'attendu' }],
    unavailable: new Set(['sahy|2026-09']),
  });
  const view = (r) => [r.month, r.unit.kind, r.unit.name, r.status, r.auto, r.reason];
  assert.deepEqual(out.rows.map(view), [
    ['2026-07', 'tpm', 'RANO Control', 'valide', false, 'document'],
    ['2026-07', 'tpm', 'SAHY Monitoring', 'non_applicable', true, 'aucune_visite'],
    ['2026-08', 'tpm', 'RANO Control', 'non_applicable', true, 'aucune_visite'],
    ['2026-08', 'tpm', 'SAHY Monitoring', 'non_applicable', true, 'aucune_visite'],
    ['2026-08', 'tpm', 'YPA', 'en_retard', false, 'echeance_depassee'],
    ['2026-08', 'interne', null, 'attendu', false, 'rapport_interne'],
    ['2026-09', 'tpm', 'RANO Control', 'attendu', false, 'a_remettre'],
    ['2026-09', 'tpm', 'SAHY Monitoring', 'non_applicable', true, 'tpm_indisponible'],
    ['2026-10', 'tpm', 'RANO Control', 'non_applicable', true, 'aucune_visite'],
    ['2026-10', 'tpm', 'SAHY Monitoring', 'non_applicable', true, 'aucune_visite'],
  ]);
  const internal = out.rows.find((r) => r.unit.kind === 'interne');
  assert.deepEqual(internal.unit.offices, ['Ambovombe', 'Toliara'], 'qui : l équipe S&E de ces bureaux');
  assert.deepEqual(internal.visits, { planned: 3, realised: 1 });
  assert.deepEqual(out.rows[0].reports, [{ id: 'r1', status: 'valide', contractLabel: 'FLA-1' }]);
  assert.equal(out.counts.autoNonApplicable, 6);
  assert.equal(out.counts.en_retard, 1);
  assert.equal(out.counts.internal, 1);
  assert.equal(out.counts.total, out.rows.length);
});

test('alertes : seul un TPM en retard alerte (jamais non applicable d office, jamais le rapport interne)', () => {
  const out = e.expectedReports({
    months: ['2026-07'], today: '2026-10', names: names(), contractTpms: new Map([['2026-07', new Set(['rano', 'sahy'])]]),
    activity: [{ key: 'rano', month: '2026-07', planned: 2, realised: 1 }, { key: 'interne', month: '2026-07', planned: 2, realised: 0 }],
  });
  const a = lateReportAlerts(out);
  assert.deepEqual(a.map((x) => [x.kind, x.params.provider, x.params.n]), [['report_late', 'RANO Control', 3]]);
  assert.deepEqual(lateReportAlerts(null), []);
});

test('par TPM : les visites suivies en interne forment la ligne « Interne », jamais « Non affecté »', () => {
  assert.equal(unitKeyOf({ providerId: 'p1' }), 'p1');
  assert.equal(unitKeyOf({ providerId: null, monitoredBy: 'interne' }), 'interne');
  assert.equal(unitKeyOf({ providerId: null, monitoredBy: 'non_affecte' }), 'non_affecte');
  const s = summarizeVisits([{ providerId: null, monitoredBy: 'interne', status: 'planifie' }, { providerId: null, status: 'realise' }]);
  assert.deepEqual(s.byProvider.map((r) => [r.key, r.label]).sort(), [['interne', 'Interne'], ['non_affecte', 'Non affecté']]);
  const r = shapeRangeSummary([], [{ key: 'interne', label: null, planifie: 2, realise: 1, annule: 0 }]);
  assert.equal(r.byProvider[0].label, 'Interne');
});
