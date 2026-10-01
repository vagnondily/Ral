const test = require('node:test');
const assert = require('node:assert/strict');
const { parseXlsformRows } = require('../src/modules/monitoring/xlsformImport');

const survey = [
  ['type', 'name', 'label::English (en)', 'label::French (fr)'],
  ['begin_group', 'Technical', 'Technical', 'Technique'],
  ['text', 'EnuName', 'Interviewer', "Nom de l'énumérateur"],
  ['select_one Yesno', 'q_present', 'Present?', 'Présent ?'],
  ['note', 'intro', 'Hello', 'Bonjour'],
  ['integer', 'nb_benef', 'Beneficiaries', 'Bénéficiaires'],
  ['end_group', 'Technical', '', ''],
  ['select_multiple Reasons', 'why', 'Why', 'Pourquoi'],
];
const choices = [
  ['list_name', 'name', 'label::English (en)', 'label::French (fr)'],
  ['Yesno', '1', 'Yes', 'Oui'],
  ['Yesno', '0', 'No', 'Non'],
  ['Reasons', 'a', 'Rupture', 'Rupture'],
];
const settings = [['form_title', 'form_id'], ['Suivi GD', 'mdg_gd_pm']];

test('parses settings title/id', () => {
  const r = parseXlsformRows(survey, choices, settings);
  assert.equal(r.title, 'Suivi GD');
  assert.equal(r.formId, 'mdg_gd_pm');
});

test('keeps only real data fields, skips groups/notes, French labels and group path', () => {
  const { fields } = parseXlsformRows(survey, choices, settings);
  const names = fields.map((f) => f.name);
  assert.deepEqual(names, ['EnuName', 'q_present', 'nb_benef', 'why']);
  const enu = fields.find((f) => f.name === 'EnuName');
  assert.equal(enu.label, "Nom de l'énumérateur");
  assert.equal(enu.group, 'Technique');
  assert.equal(fields.find((f) => f.name === 'nb_benef').type, 'integer');
});

test('captures select list names', () => {
  const { fields } = parseXlsformRows(survey, choices, settings);
  assert.equal(fields.find((f) => f.name === 'q_present').listName, 'Yesno');
  assert.equal(fields.find((f) => f.name === 'why').listName, 'Reasons');
});

test('builds choices map with French labels', () => {
  const { choices: ch } = parseXlsformRows(survey, choices, settings);
  assert.equal(ch.Yesno.length, 2);
  assert.deepEqual(ch.Yesno[0], { value: '1', label: 'Oui' });
});

test('empty survey is safe', () => {
  const r = parseXlsformRows([], [], []);
  assert.deepEqual(r.fields, []);
});
