const test = require('node:test');
const assert = require('node:assert/strict');
const { SECTIONS, LINE_LABELS, MONITORING_LINE, isValidLine } = require('../src/modules/contracts/budgetCatalog');

/**
 * Fidelity of the FLA budget catalogue to the real workbook
 * "Contrat-budget-WFP-MDG-2025-AIN-MULTI-003-AM02-V1.xlsx", feuille
 * « Budget de l'accord ». Locks the section/line structure so it cannot
 * silently drift from the official template.
 */

const byCode = Object.fromEntries(SECTIONS.map((s) => [s.code, s]));

test('the five FLA sections are present in order', () => {
  assert.deepEqual(SECTIONS.map((s) => s.code), ['I', 'II', 'III', 'IV', 'V']);
});

test('each section has exactly the lines of the FLA workbook', () => {
  assert.equal(byCode.I.lines.length, 9);   // incl. the two "transformation" lines
  assert.equal(byCode.II.lines.length, 3);
  assert.equal(byCode.III.lines.length, 7);
  assert.equal(byCode.IV.lines.length, 5);
  assert.equal(byCode.V.lines.length, 5);
});

test('Section I carries both transformation lines (basés / non basés sur la MT)', () => {
  assert.ok(isValidLine('I.transformation_mt'));
  assert.ok(isValidLine('I.transformation_non_mt'));
  assert.match(LINE_LABELS['I.transformation_mt'], /basés sur la MT/);
  assert.match(LINE_LABELS['I.transformation_non_mt'], /non basés sur la MT/);
});

test('Section V matches the FLA: salaires, dépenses, locaux, véhicules, matériel', () => {
  const labels = byCode.V.lines.map(([, l]) => l);
  assert.deepEqual(labels, [
    'Salaires du personnel',
    'Dépenses de personnel',
    'Coûts de location des locaux et autres frais de fonctionnement',
    'Coûts relatifs aux véhicules et autres frais de fonctionnement',
    'Matériel et fournitures',
  ]);
});

test('the monitoring line is IV.suivi', () => {
  assert.equal(MONITORING_LINE, 'IV.suivi');
  assert.ok(isValidLine('IV.suivi'));
});
