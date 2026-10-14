const test = require('node:test');
const assert = require('node:assert/strict');
const { parseReport, safeParseReport, periodLabel, VARIABLES } = require('../src/modules/reports/reportModel');
const { SYSTEM_TEMPLATES, templateDocument } = require('../src/modules/reports/reportTemplates');
const { catalogIssues } = require('../src/modules/reports/reports.service');

const PERIOD = { from: '2026-01', to: '2026-05' };

test('chaque modèle système est un rapport v2 valide, dont chaque bloc est connu du catalogue', () => {
  assert.ok(SYSTEM_TEMPLATES.length >= 5);
  for (const tpl of SYSTEM_TEMPLATES) {
    const r = safeParseReport(templateDocument(tpl, PERIOD));
    assert.ok(r.success, `${tpl.key}: ${JSON.stringify(r.error && r.error.issues.slice(0, 2))}`);
    assert.deepEqual(catalogIssues(r.data), [], tpl.key);
    assert.equal(r.data.schemaVersion, 2);
  }
});

test('un document v1 est mis à niveau puis validé (rétrocompatibilité des anciens onglets)', () => {
  const v1 = { title: 'X', period: PERIOD, page: { header: 'H' }, blocks: [{ id: 't', type: 'table', params: { dataset: 'activity_coverage' } }] };
  const d = parseReport(v1);
  assert.equal(d.schemaVersion, 2);
  assert.equal(d.blocks[0].type, 'data');
  assert.equal(d.blocks[0].params.dataset, 'cov.by_activity');
});

test('intégrité : période ordonnée et bornée (60 mois), titre requis', () => {
  const base = { schemaVersion: 2, title: 'X', blocks: [] };
  assert.equal(safeParseReport({ ...base, period: { from: '2026-05', to: '2026-01' } }).success, false);
  assert.equal(safeParseReport({ ...base, period: { from: '2021-01', to: '2025-12' } }).success, true);
  const long = safeParseReport({ ...base, period: { from: '2021-01', to: '2026-01' } });
  assert.equal(long.success, false);
  assert.match(long.error.issues[0].message, /60 mois au plus \(demandé : 61\)/);
  assert.equal(safeParseReport({ ...base, period: { from: '1999-01', to: '2000-01' } }).success, false);
  assert.equal(safeParseReport({ ...base, title: ' ', period: PERIOD }).success, false);
});

test('libellé de période (réexporté depuis common/period)', () => {
  assert.equal(periodLabel({ from: '2026-01', to: '2026-05' }), 'Janvier à mai 2026');
  assert.equal(periodLabel({ from: '2026-08', to: '2026-08' }), 'Août 2026');
  assert.equal(periodLabel({ from: '2026-01', to: '2026-12' }), 'Année 2026');
  assert.equal(periodLabel({ from: '2025-10', to: '2026-03' }, 'en'), 'October 2025 to March 2026');
  assert.equal(periodLabel, require('../src/modules/common/period').periodLabel);
});

test('variables simples : titre, période, élément répété, validation, pagination', () => {
  for (const k of ['titre', 'periode', 'date_edition', 'bureau', 'activite', 'partenaire', 'statut', 'version', 'valide_par', 'valide_le', 'section', 'page', 'pages']) {
    assert.ok(VARIABLES[k], k);
  }
});
