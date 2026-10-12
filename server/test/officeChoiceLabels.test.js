const test = require('node:test');
const assert = require('node:assert/strict');
const { officeChoiceLabelsTx } = require('../src/modules/settings/placeMatch.repository');

// Client factice : 1re requête = catalogue des champs, 2e = choix des listes demandées.
function fakeClient(fields, choices) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push(params);
      if (/FROM monitoring_form_fields/.test(sql)) return { rows: fields };
      const [, forms, lists] = params;
      return { rows: choices.filter((c) => forms.some((f, i) => f === c.formId && lists[i] === c.listName)) };
    },
  };
}

test('bureau codé : « 6 » se lit par le libellé de la liste de la colonne bureau (XLSForm ou étiquettes du .sav)', async () => {
  const client = fakeClient(
    [{ formId: 'f1', name: 'EnuName', listName: 'sav:EnuName' }, { formId: 'f1', name: 'field_office', listName: 'sav:Field_office' }],
    [{ formId: 'f1', listName: 'sav:Field_office', value: '6', label: 'Ambovombe' },
      { formId: 'f1', listName: 'sav:EnuName', value: '6', label: 'agent six' }],
  );
  const labels = await officeChoiceLabelsTx(client, 't1');
  assert.equal(labels.get('f1').get('6'), 'Ambovombe');
  assert.deepEqual(client.calls[1].slice(1), [['f1'], ['sav:Field_office']]);
});

test('colonne bureau sans liste : aucune requête de choix, aucune traduction inventée', async () => {
  const client = fakeClient([{ formId: 'f1', name: 'field_office', listName: null }], []);
  const labels = await officeChoiceLabelsTx(client, 't1');
  assert.equal(labels.size, 0);
  assert.equal(client.calls.length, 1);
});
