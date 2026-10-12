const test = require('node:test');
const assert = require('node:assert/strict');
const { CATALOG, templateForActivity, moduleLabel, suggestBindings, positiveFor, indicatorFromItem } = require('../src/modules/monitoring/indicatorTemplates');

const GD = 'Unconditional resource transfers to support access to food';

test('catalogue : 4 activités du MMR, codes uniques, aucune mention d\'organisation', () => {
  assert.deepEqual(CATALOG.activities.map((a) => a.key).sort(), ['GD', 'MAM', 'SMP', 'STUNT']);
  for (const a of CATALOG.activities) {
    const codes = a.items.map((i) => i.code);
    assert.equal(new Set(codes).size, codes.length, a.key);
    for (const i of a.items) {
      assert.ok(['higher_better', 'lower_better'].includes(i.direction), i.code);
      assert.ok(['percent_yes', 'percent_value', 'mean', 'sum', 'count'].includes(i.agg), i.code);
      assert.ok(a.domains.some((d) => d.code === i.domain), `${i.code} → ${i.domain}`);
      // Bornes de l'API et de la base (code ≤ 60, domaine ≤ 80, libellé ≤ 200, valeur positive ≤ 80).
      assert.ok(i.code.length <= 60 && i.label.length <= 200 && moduleLabel(a, i.domain).length <= 80, i.code);
      assert.ok(i.positiveValue == null || String(i.positiveValue).length <= 80, i.code);
    }
  }
  assert.doesNotMatch(JSON.stringify(CATALOG), /\bPAM\b|WFP/);
});

test('modèle de l\'activité retrouvé par la catégorie du MMR (casse et espaces tolérés)', () => {
  assert.equal(templateForActivity(` ${GD.toUpperCase()} `).key, 'GD');
  assert.equal(templateForActivity('Asset creation and livelihood support activities'), null);
  assert.equal(templateForActivity(null), null);
});

const TPL = {
  domains: [{ code: 'D1', label: 'Conformité gestion distribution' }, { code: 'D7', label: 'Sécurité / intégrité' }],
  items: [
    { code: 'LIST', label: 'Liste bénéficiaires disponible', domain: 'D1', agg: 'percent_yes', positiveValue: '1', direction: 'higher_better', variables: ['MODistrList_nut', 'MODistrList'], naValues: [] },
    { code: 'ARMED', label: 'Personnel armé présent', domain: 'D7', agg: 'percent_yes', positiveValue: '1', direction: 'lower_better', variables: ['MOArmedPers'], naValues: ['9999'], scored: true },
    { code: 'DIGN', label: 'Toilettes séparées hommes / femmes', domain: 'D1', agg: 'percent_value', positiveValue: '1', direction: 'higher_better', variables: ['MODistPtsDign/4'], naValues: [] },
    { code: 'HELP', label: 'Un service d\'assistance est-il présent sur le site ?', domain: 'D1', agg: 'percent_yes', positiveValue: '1', direction: 'higher_better', variables: ['HelpDeskX'], naValues: ['9999'] },
    { code: 'NONE', label: 'Question absente du formulaire', domain: 'D1', agg: 'percent_yes', positiveValue: '1', direction: 'higher_better', variables: ['Zzz'], naValues: [] },
  ],
};
const YESNO = [{ value: '0', label: 'Non' }, { value: '1', label: 'Oui' }];

test('variable proposée : nom du modèle, autre nom connu, colonne éclatée SPSS, libellé proche, ou rien', () => {
  const fields = [
    { name: 'MODistrList', label: 'Une liste complète de distribution est-elle utilisée ?', choices: YESNO },
    { name: 'moarmedpers', label: 'Du personnel armé est-il présent ?', choices: YESNO },
    { name: 'MODistPtsDign.4' },
    { name: 'MOHelpDesk', label: 'Un service d\'assistance est-il présent sur le site', choices: YESNO },
  ];
  const s = Object.fromEntries(suggestBindings(TPL, fields).map((x) => [x.code, x]));
  assert.deepEqual([s.LIST.field, s.LIST.confidence], ['MODistrList', 'probable']);
  assert.deepEqual([s.ARMED.field, s.ARMED.confidence], ['moarmedpers', 'sure']);
  assert.deepEqual([s.DIGN.field, s.DIGN.confidence], ['MODistPtsDign.4', 'sure']);
  assert.deepEqual([s.HELP.field, s.HELP.confidence], ['MOHelpDesk', 'a_verifier']);
  assert.deepEqual([s.NONE.field, s.NONE.confidence], [null, null]);
});

test('valeur positive : celle du modèle si la liste la contient, sinon le « Oui » de la liste', () => {
  const item = { agg: 'percent_yes', positiveValue: '1' };
  assert.equal(positiveFor(item, { choices: YESNO }), '1');
  assert.equal(positiveFor(item, { choices: [{ value: 'yes', label: 'Oui' }, { value: 'no', label: 'Non' }] }), 'yes');
  assert.equal(positiveFor({ agg: 'percent_value', positiveValue: '1|2' }, { choices: [{ value: '1' }, { value: '2' }, { value: '3' }] }), '1|2');
  assert.equal(positiveFor(item, null), '1');
});

test('indicateur créé depuis le modèle : domaine lisible, sens, réponses hors base, lien au modèle', () => {
  const ind = indicatorFromItem(TPL, TPL.items[1], { sourceField: 'MOArmedPers', positiveValue: '1' }, 3);
  assert.equal(ind.module, 'D7 · Sécurité / intégrité');
  assert.equal(ind.direction, 'lower_better');
  assert.deepEqual(ind.naValues, ['9999']);
  assert.equal(ind.templateCode, 'ARMED');
  assert.equal(ind.scored, true);
  assert.equal(moduleLabel(TPL, 'X9'), 'X9');
});
