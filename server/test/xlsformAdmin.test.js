const test = require('node:test');
const assert = require('node:assert/strict');
const { breakdownFromChoices } = require('../src/modules/settings/xlsformAdmin');

// Extrait synthétique au format MIARO (listes ADMnCODE, colonnes parentes du même nom).
const MIARO = [
  { list_name: 'ADM1CODE', name: 'MG51', 'label::French (fr)': 'Atsimo Andrefana', 'label::English (en)': 'Atsimo Andrefana' },
  { list_name: 'ADM1CODE', name: 'MG52', 'label::French (fr)': 'Androy' },
  { list_name: 'ADM2CODE', name: 'MG51507', 'label::French (fr)': 'Ampanihy Ouest', ADM1CODE: 'MG51' },
  { list_name: 'ADM2CODE', name: 'MG52516a', 'label::French (fr)': 'Antanimora Sud', ADM1CODE: 'MG52' },
  { list_name: 'ADM3CODE', name: 'MG51507090', 'label::French (fr)': 'Ampanihy', ADM1CODE: 'MG51', ADM2CODE: 'MG51507' },
  { list_name: 'ADM3CODE', name: 'MG52516130', 'label::French (fr)': 'Antanimora', ADM1CODE: 'MG52', ADM2CODE: 'MG52516A' },
  { list_name: 'ADM3CODE', name: 'MG99999999', 'label::French (fr)': 'Orpheline', ADM1CODE: 'MG52', ADM2CODE: 'MG52999' },
  { list_name: 'ADM4CODE', name: 'MG51507090001', 'label::French (fr)': 'Fokontany A', ADM1CODE: 'MG51', ADM2CODE: 'MG51507', ADM3CODE: 'MG51507090' },
  { list_name: 'POI_code', name: 'MG51507090001001', 'label::French (fr)': 'Site 1', ADM1CODE: 'MG51', ADM2CODE: 'MG51507', ADM3CODE: 'MG51507090', ADM4CODE: 'MG51507090001' },
  { list_name: 'yesno', name: '1', 'label::French (fr)': 'Oui' },
  { list_name: 'yesno', name: '0', 'label::French (fr)': 'Non' },
];

test('XLSForm MIARO : 4 niveaux reconnus par les colonnes parentes, libellé français, sites ignorés', () => {
  const r = breakdownFromChoices(MIARO);
  assert.deepEqual(r.lists.map((l) => l.list), ['ADM1CODE', 'ADM2CODE', 'ADM3CODE', 'ADM4CODE']);
  assert.deepEqual(r.levels.map((l) => l.label), ['Région', 'District', 'Commune', 'Fokontany']);
  const fkt = r.rows.find((x) => x.pcodes[3] === 'MG51507090001');
  assert.deepEqual(fkt.names, ['Atsimo Andrefana', 'Ampanihy Ouest', 'Ampanihy', 'Fokontany A']);
  assert.deepEqual(fkt.pcodes, ['MG51', 'MG51507', 'MG51507090', 'MG51507090001']);
  // Code maison à suffixe, parent écrit en majuscules : rattaché quand même.
  assert.deepEqual(r.rows.find((x) => x.pcodes[2] === 'MG52516130').names, ['Androy', 'Antanimora Sud', 'Antanimora']);
  assert.ok(r.warnings.some((w) => /parent est absent/.test(w)));
  assert.ok(r.warnings.some((w) => /POI_code/.test(w)));
});

test('XLSForm GD : listes …_admin_area_list, colonnes …_c, doublon de code signalé', () => {
  const GD = [
    { list_name: 'first_level_admin_area_list', name: 'MG53', 'label::French (fr)': 'Anosy' },
    { list_name: 'first_level_admin_area_list', name: 'MG52', 'label::French (fr)': 'Androy' },
    { list_name: 'second_level_admin_area_list', name: 'MG53519', 'label::French (fr)': 'Amboasary-Atsimo', first_level_admin_area_c: 'MG53' },
    { list_name: 'second_level_admin_area_list', name: 'MG52516', 'label::French (fr)': 'Ambovombe-Androy', first_level_admin_area_c: 'MG52' },
    { list_name: 'third_level_admin_area_list', name: 'MG53519010', 'label::French (fr)': 'Amboasary Atsimo', first_level_admin_area_c: 'MG53', second_level_admin_area_c: 'MG53519' },
    { list_name: 'third_level_admin_area_list', name: 'MG53519030', 'label::French (fr)': 'Behara', first_level_admin_area_c: 'MG53', second_level_admin_area_c: 'MG53519' },
    { list_name: 'third_level_admin_area_list', name: 'MG53519030', 'label::French (fr)': 'Behara bis', first_level_admin_area_c: 'MG53', second_level_admin_area_c: 'MG53519' },
  ];
  const r = breakdownFromChoices(GD);
  assert.equal(r.levels.length, 3);
  assert.equal(r.rows.filter((x) => x.names.length === 3).length, 2);
  assert.ok(r.warnings.some((w) => /deux noms/.test(w)));
});

test('aucune liste de codes reliés → null (le fichier n\'est pas un référentiel)', () => {
  assert.equal(breakdownFromChoices([{ list_name: 'yesno', name: '1', label: 'Oui' }, { list_name: 'yesno', name: '0', label: 'Non' }]), null);
  assert.equal(breakdownFromChoices([{ list_name: 'ADM1CODE', name: 'MG51', label: 'A' }, { list_name: 'ADM1CODE', name: 'MG52', label: 'B' }]), null);
});
