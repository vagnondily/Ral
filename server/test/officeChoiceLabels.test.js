const test = require('node:test');
const assert = require('node:assert/strict');
const { officeChoiceLabelsTx } = require('../src/modules/settings/placeMatch.repository');

// Client factice : catalogue des champs, colonnes choisies à la main (Mapping MEMS), puis choix des listes demandées.
function fakeClient(fields, choices, overrides = [], samples = []) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push(params);
      if (/FROM monitoring_form_fields/.test(sql)) return { rows: fields };
      if (/FROM monitoring_field_map/.test(sql)) return { rows: overrides.filter((o) => o.dimension === params[1]) };
      if (/CROSS JOIN LATERAL/.test(sql)) return { rows: samples }; // dernière soumission de chaque fiche
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
  assert.deepEqual(client.calls[3].slice(1), [['f1'], ['sav:Field_office']]);
});

test('colonne bureau sans liste : aucune requête de choix, aucune traduction inventée', async () => {
  const client = fakeClient([{ formId: 'f1', name: 'field_office', listName: null }], []);
  const labels = await officeChoiceLabelsTx(client, 't1');
  assert.equal(labels.size, 0);
  assert.equal(client.calls.length, 3);
});

test('colonne choisie à la main dans « Mapping MEMS » : ses libellés l\'emportent sur la détection', async () => {
  const { choiceLabelsTx } = require('../src/modules/settings/placeMatch.repository');
  const client = fakeClient(
    [{ formId: 'f1', name: 'DPName', listName: null }, { formId: 'f1', name: 'Adm4Code_SMP', listName: 'sav:Adm4Code_SMP' }],
    [{ formId: 'f1', listName: 'sav:Adm4Code_SMP', value: '609010034', label: 'Maheny' }],
    [{ formId: 'f1', dimension: 'site', columnName: 'Adm4Code_SMP' }],
  );
  const labels = await choiceLabelsTx(client, 't1', 'site');
  assert.equal(labels.get('f1').get('609010034'), 'Maheny');
});

test('colonne présente dans les données préférée à celle que décrit seulement le XLSForm (EnuPartner ↔ CPList)', async () => {
  const { choiceLabelsTx } = require('../src/modules/settings/placeMatch.repository');
  const client = fakeClient(
    [{ formId: 'f1', name: 'EnuPartner', listName: null }, { formId: 'f1', name: 'CPList', listName: 'sav:CPList' }],
    [{ formId: 'f1', listName: 'sav:CPList', value: '4', label: 'ONG AINA' }],
    [], [{ formId: 'f1', keys: ['CPList', 'SvyDate'] }],
  );
  const labels = await choiceLabelsTx(client, 't1', 'partner');
  assert.equal(labels.get('f1').get('4'), 'ONG AINA');
});
