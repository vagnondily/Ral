/**
 * Proposition du modèle d'indicateurs d'une fiche (retours 66 et 85) : logique pure.
 * Les 5 formulaires réels sont lus dans la fixture (noms, types, codes ; aucun libellé).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/modules/monitoring/indicatorProposals');
const { CATALOG, templateByKey } = require('../src/modules/monitoring/indicatorTemplates');
const FIXTURE = require('./helpers/xlsformTemplateVars.json');

/** Variables d'un formulaire de la fixture au format du catalogue de liaison (libellés « Oui » / « Autre » reconstitués). */
function fixtureFields(formId) {
  const f = FIXTURE.forms[formId];
  return f.fields.map(([name, type, list, repeat]) => ({
    name, type, repeat,
    choices: list ? f.lists[list].codes.map((v) => ({
      value: v,
      label: f.lists[list].yes.includes(v) ? 'Oui' : f.lists[list].other.includes(v) ? 'Autre' : f.lists[list].na.includes(v) ? 'Sans objet' : `choix ${v}`,
    })) : [],
  }));
}
/** Colonnes éclatées « X/k » de chaque question à choix multiples, comme dans un export Kobo .xlsx. */
function withOptionColumns(fields) {
  const out = [...fields];
  for (const f of fields) {
    if (f.type !== 'select_multiple') continue;
    for (const c of f.choices) out.push({ name: `${f.name}/${c.value}`, type: 'option', choices: [{ value: '1', label: 'sélectionné' }, { value: '0', label: 'non sélectionné' }], repeat: f.repeat });
  }
  return out;
}

const EXPECTED = {
  MDG_Process_Monitoring_GD_PREVMA_v2: 'GD',
  MDG_SMP_2025_2026: 'SMP',
  MDG_Process_Monitoring_NutritionAIM: 'MAM',
  MDG_Process_Monitoring_MIARO_PROD_Janv2026: 'STUNT',
  MDG_PROCESS_MONITORING_RESILIENCE_SAMS_V2_1: 'RES',
};

test('chacun des 5 formulaires reçoit SON modèle, reconnu sans ambiguïté', () => {
  for (const [formId, key] of Object.entries(EXPECTED)) {
    const p = P.proposeTemplate({ fields: fixtureFields(formId), form: { code: formId, label: FIXTURE.forms[formId].title } });
    assert.equal(p.best.key, key, formId);
    assert.equal(p.ambiguous, false, formId);
    assert.equal(p.strong, true, formId);
    assert.ok(p.best.coverage >= 0.95, `${formId} : ${p.best.coverage}`);
    // Le deuxième est loin derrière (MIARO couvre une bonne part du modèle GD : distribution et ménages communs).
    assert.ok(p.best.coverage - p.ranking[1].coverage > P.TIE_MARGIN, `${formId} : ${p.ranking[1].key}`);
  }
});

test('le nom de la fiche ne choisit pas seul : sans variables, aucun modèle (même « Suivi SMP »)', () => {
  const p = P.proposeTemplate({ fields: [{ name: 'q1', type: 'select_one' }], form: { code: 'SMP', label: 'Suivi SMP' } });
  assert.equal(p.best, null);
  assert.equal(p.strong, false);
});

test('départage par formHints quand deux modèles sont à moins de 5 points ; sinon ambigu', () => {
  const catalog = {
    activities: [
      { key: 'AAA', label: 'A', mmrCategory: 'Cat A', formHints: ['ALPHA'], domains: [{ code: 'D1', label: 'x' }], items: [{ code: 'A1', agg: 'percent_yes', variables: ['q1'] }, { code: 'A2', agg: 'percent_yes', variables: ['q2'] }] },
      { key: 'BBB', label: 'B', mmrCategory: 'Cat B', formHints: ['BETA', 'B_PREV'], domains: [{ code: 'D1', label: 'x' }], items: [{ code: 'B1', agg: 'percent_yes', variables: ['q1'] }, { code: 'B2', agg: 'percent_yes', variables: ['q2'] }] },
    ],
  };
  const fields = [{ name: 'q1', type: 'select_one' }, { name: 'q2', type: 'select_one' }];
  const byHint = P.proposeTemplate({ fields, form: { code: 'MDG_B_PREV_v2', label: 'Suivi' }, catalog });
  assert.equal(byHint.best.key, 'BBB'); // « B_PREV » = mots B et PREV présents dans le code
  assert.equal(byHint.ambiguous, false);
  const none = P.proposeTemplate({ fields, form: { code: 'X', label: 'Sans indice' }, catalog });
  assert.equal(none.ambiguous, true);
  assert.equal(none.strong, false);
  assert.equal(P.hintScore(catalog.activities[1], P.formTokens({ label: 'Bêta — suivi' })), 1); // accents et casse ignorés
});

test('couverture : une option de choix multiple compte dès la définition ; un type incompatible ne compte pas', () => {
  const tpl = { items: [
    { code: 'O', agg: 'percent_yes', variables: ['Q/2'] },
    { code: 'M', agg: 'mean', variables: ['score'] },
    { code: 'T', agg: 'percent_yes', variables: ['texte'] },
    { code: 'S', agg: 'percent_yes', variables: ['multi'] },
  ] };
  const fields = [
    { name: 'Q', type: 'select_multiple', choices: [{ value: '1' }, { value: '2' }] },
    { name: 'score', type: 'calculate' },
    { name: 'texte', type: 'text' },
    { name: 'multi', type: 'select_multiple', choices: [] },
  ];
  const c = P.templateCoverage(tpl, P.presenceIndex(fields));
  assert.deepEqual([c.found, c.total], [2, 4]);
  assert.equal(P.typeIssue('mean', 'select_one'), 'type');
  assert.equal(P.typeIssue('percent_yes', 'select_multiple'), 'type');
  assert.equal(P.typeIssue('percent_yes', null), null);      // colonne des seules données : non contrôlée
  assert.equal(P.typeIssue('mean', 'numeric'), null);        // variable SPSS
  assert.equal(P.typeIssue('count', 'text'), null);
});

test('liaison : même nom mais autre question (MOWHBadCommod choix multiple ici) → à vérifier, jamais précoché', () => {
  const item = { code: 'MAM_WH_DAMAGED', agg: 'percent_yes', positiveValue: '1', naValues: [], variables: ['MOWHBadCommod'], warnings: [] };
  const b = P.bindTemplate({ items: [item] }, [{ name: 'MOWHBadCommod', type: 'select_multiple', choices: [{ value: '1', label: 'gâtés' }] }])[0];
  assert.deepEqual(b.issues, ['type']);
  assert.equal(b.preselect, false);
  const ok = P.bindTemplate({ items: [item] }, [{ name: 'MOWHBadCommod', type: 'select_one', choices: [{ value: '0', label: 'Non' }, { value: '1', label: 'Oui' }] }])[0];
  assert.deepEqual([ok.issues, ok.preselect, ok.confidence], [[], true, 'sure']);
});

test('liste : valeur comptée absente → à vérifier ; hors base absent de la liste ou « Autre » → retiré (« Autre » est une réponse)', () => {
  const item = { code: 'X', agg: 'percent_value', positiveValue: '3', naValues: ['9999', '888'], variables: ['q'], warnings: [] };
  const list = [{ value: '0', label: 'Non' }, { value: '1', label: 'Oui' }, { value: '9999', label: 'Autre (préciser)' }];
  const b = P.bindTemplate({ items: [item] }, [{ name: 'q', type: 'select_one', choices: list }])[0];
  assert.deepEqual(b.issues, ['positive']);
  assert.deepEqual(b.naValues, []);
  assert.deepEqual(b.naDropped, ['9999', '888']);
  assert.equal(b.preselect, false);
  const yesna = [{ value: '0', label: 'Non' }, { value: '1', label: 'Oui' }, { value: '9999', label: 'Sans objet' }];
  const ok = P.bindTemplate({ items: [{ ...item, agg: 'percent_yes', positiveValue: '1' }] }, [{ name: 'q', type: 'select_one', choices: yesna }])[0];
  assert.deepEqual([ok.naValues, ok.naDropped, ok.preselect], [['9999'], ['888'], true]);
});

test('sous-table (groupe répété) : jamais précochée ; option sans colonne de données : « disponible après l\'import des données »', () => {
  const sub = P.bindTemplate({ items: [{ code: 'R', agg: 'percent_yes', positiveValue: '1', naValues: [], variables: ['inRepeat'], warnings: ['groupe'] }] },
    [{ name: 'inRepeat', type: 'select_one', choices: [{ value: '1', label: 'Oui' }] }])[0];
  assert.deepEqual([sub.subtable, sub.preselect], [true, false]);
  // Le catalogue sait (plus tard) qu'une variable est dans une répétition : même effet sans avertissement du modèle.
  const known = P.bindTemplate({ items: [{ code: 'R2', agg: 'percent_yes', positiveValue: '1', naValues: [], variables: ['x'], warnings: [] }] },
    [{ name: 'x', type: 'select_one', repeat: 'teacher_survey', choices: [{ value: '1', label: 'Oui' }] }])[0];
  assert.deepEqual([known.subtable, known.preselect], [true, false]);
  const opt = P.bindTemplate({ items: [{ code: 'O', agg: 'percent_yes', positiveValue: '1', naValues: [], variables: ['Q/2'], warnings: [] }] },
    [{ name: 'Q', type: 'select_multiple', choices: [{ value: '2', label: 'b' }] }])[0];
  assert.deepEqual([opt.field, opt.pendingData, opt.preselect], [null, true, false]);
  const base = P.bindTemplate({ items: [{ code: 'B', agg: 'percent_yes', positiveValue: '1', naValues: [], variables: ['q'], warnings: ['base'] }] },
    [{ name: 'q', type: 'select_one', choices: [{ value: '1', label: 'Oui' }] }])[0];
  assert.equal(base.preselect, false); // base biaisée (question obligatoire sans condition) : l'utilisateur décide
});

test('formulaires réels : les éléments précochés ne contiennent ni sous-table ni type incompatible', () => {
  for (const [formId, key] of Object.entries(EXPECTED)) {
    const tpl = templateByKey(key);
    const fields = withOptionColumns(fixtureFields(formId));
    const bindings = P.bindTemplate(tpl, fields);
    const sum = P.bindingSummary(bindings);
    for (const b of bindings.filter((x) => x.preselect)) {
      assert.equal(b.subtable, false, b.code);
      assert.deepEqual(b.issues, [], b.code);
      assert.ok(['sure', 'probable'].includes(b.confidence), b.code);
    }
    const subtables = tpl.items.filter((i) => (i.warnings || []).includes('groupe')).length;
    assert.equal(sum.subtable, subtables, key);
    // Données importées (colonnes « X/k ») : presque tout le modèle est proposé d'un clic.
    assert.ok(sum.proposed >= tpl.items.length - subtables - 2, `${key} : ${JSON.stringify(sum)}`);
    const scored = bindings.filter((b) => b.preselect && tpl.items.find((i) => i.code === b.code).scored).length;
    assert.ok(scored >= 25, `${key} : ${scored} indicateurs notés proposés`);
  }
});

test('un clic : seuls les éléments précochés, ni déjà créés ni à code pris ; comptes de la carte', () => {
  const bindings = [
    { code: 'A', field: 'a', positiveValue: '1', preselect: true },
    { code: 'B', field: 'b', positiveValue: '1', preselect: true },
    { code: 'C', field: 'c', positiveValue: null, preselect: true },
    { code: 'D', field: null, preselect: false, subtable: true },
    { code: 'E', field: null, preselect: false, pendingData: true },
    { code: 'F', field: null, preselect: false },
    { code: 'G', field: 'g', preselect: false, issues: ['type'] },
  ];
  const sel = P.proposedSelection(bindings, { done: new Set(['A']), taken: new Set(['B']) });
  assert.deepEqual(sel, [{ code: 'C', sourceField: 'c', positiveValue: null }]);
  assert.deepEqual(P.bindingSummary(bindings, { done: new Set(['A']), taken: new Set(['B']) }),
    { total: 7, proposed: 1, existing: 1, taken: 1, subtable: 1, pendingData: 1, toCheck: 1, missing: 1 });
});

test('modèle montré : demandé, sinon celui de l\'activité, sinon le proposé ; un autre que celui de l\'activité est refusé', () => {
  const proposal = { best: { key: 'RES' } };
  assert.equal(P.effectiveTemplate({ activityCategory: 'School meal activities', proposal }).template.key, 'SMP');
  assert.equal(P.effectiveTemplate({ activityCategory: 'School meal activities', proposal }).source, 'activity');
  // Activité sans modèle (ou aucune) : le modèle proposé est montré — jamais une carte vide.
  assert.deepEqual([P.effectiveTemplate({ activityCategory: 'Autre activité', proposal }).template.key, P.effectiveTemplate({ activityCategory: 'Autre activité', proposal }).source], ['RES', 'proposal']);
  assert.equal(P.effectiveTemplate({ activityCategory: null, requested: 'MAM' }).source, 'chosen');
  assert.equal(P.effectiveTemplate({ activityCategory: 'School meal activities', requested: 'MAM' }).error, 'activity_template');
  assert.equal(P.effectiveTemplate({ requested: 'ZZZ' }).error, 'unknown_template');
  assert.deepEqual(P.effectiveTemplate({}), { template: null, source: null });
});

test('indicateur créé avant une correction du modèle : signalé « à mettre à jour », avec la modification à envoyer', () => {
  const miaro = templateByKey('STUNT');
  const item = miaro.items.find((i) => i.code === 'MIARO_NO_DELAY');
  const binding = P.bindTemplate({ items: [item] }, [{ name: 'r_no_delay', type: 'calculate', choices: [] }])[0];
  // Définition d'avant (risk_delay, % = valeur 0) : biaisée, telle qu'elle a été créée avant le 14/10.
  const old = { label: 'Absence de retard', sourceField: 'risk_delay', agg: 'percent_value', positiveValue: '0', naValues: [], target: null, direction: 'higher_better' };
  const d = P.templateDrift(item, binding, old);
  assert.equal(d.kind, 'definition');
  assert.equal(d.former, true);
  assert.deepEqual(d.patch, { sourceField: 'r_no_delay', agg: 'percent_yes', positiveValue: '1', label: item.label });
  assert.deepEqual(d.changes.map((c) => c.key), ['sourceField', 'agg', 'positiveValue', 'label']);
  // À jour : rien à signaler.
  assert.equal(P.templateDrift(item, binding, { ...old, sourceField: 'r_no_delay', agg: 'percent_yes', positiveValue: '1', label: item.label }), null);
});

test('écart : libellé renommé par l\'utilisateur, autre variable connue du modèle, cible saisie — jamais signalés', () => {
  const gd = templateByKey('GD');
  const item = gd.items.find((i) => i.code === 'GD_DPMC_TRAINED');
  const binding = P.bindTemplate({ items: [item] }, [{ name: 'MODPMCMemb', type: 'select_one', choices: [{ value: '0', label: 'Non' }, { value: '1', label: 'Oui' }, { value: '888', label: 'Ne sait pas' }] }])[0];
  const base = { sourceField: 'MODPMCMemb', agg: 'percent_yes', positiveValue: '1', naValues: ['888'], target: 90, direction: 'higher_better' };
  // Ancien libellé du modèle (« formés ») : la question porte sur les membres PRÉSENTS.
  const stale = P.templateDrift(item, binding, { ...base, label: 'DPMC membres formés' });
  assert.deepEqual([stale.kind, stale.patch], ['label', { label: item.label }]);
  assert.equal(P.templateDrift(item, binding, { ...base, label: 'Mon libellé à moi' }), null);
  // Variable de repli connue du modèle (formulaire plus ancien) : pas un écart.
  const list = gd.items.find((i) => i.code === 'GD_DIST_LIST_NUT');
  assert.equal(P.templateDrift(list, null, { label: list.label, sourceField: 'modistrlist', agg: 'percent_yes', positiveValue: '1', naValues: [], target: null, direction: 'higher_better' }), null);
});

test('écart : variable du modèle pas encore dans les données → signalée sans variable à écrire ; cible du modèle ajoutée', () => {
  const gd = templateByKey('GD');
  const pallets = gd.items.find((i) => i.code === 'GD_WH_PALLETS');
  const d = P.templateDrift(pallets, { field: null, naValues: [] }, { label: 'Produits sur palettes', sourceField: 'MOWhStackProp', agg: 'percent_yes', positiveValue: '1', naValues: [], target: null, direction: 'higher_better' });
  assert.equal(d.kind, 'definition');
  assert.equal(d.former, true);
  assert.deepEqual(d.changes.find((c) => c.key === 'sourceField'), { key: 'sourceField', from: 'MOWhStackProp', to: null });
  assert.equal('sourceField' in d.patch, false);
  const smp = templateByKey('SMP');
  const days = smp.items.find((i) => i.code === 'SMP_DAYS_SERVED');
  const t = P.templateDrift(days, null, { label: days.label, sourceField: 'DIRNBSchMealsProvided', agg: 'mean', positiveValue: null, naValues: ['888'], target: null, direction: 'higher_better' });
  assert.deepEqual(t.patch, { target: 20 });
});

test('catalogue : chaque élément corrigé garde sa définition d\'avant (formerly), les autres non', () => {
  const corrected = CATALOG.activities.flatMap((a) => a.items).filter((i) => i.formerly);
  assert.ok(corrected.length >= 25, `${corrected.length}`);
  for (const i of corrected) {
    const f = i.formerly[0];
    assert.ok(f.label && Array.isArray(f.variables) && f.agg, i.code);
    assert.ok(f.label !== i.label || f.agg !== i.agg || f.variables.join() !== i.variables.join() || String(f.positiveValue) !== String(i.positiveValue)
      || (f.naValues || []).join() !== (i.naValues || []).join(), i.code);
  }
  for (const code of ['MIARO_NO_DELAY', 'MIARO_SBCC_SATISF', 'MIARO_DIGNITY', 'MIARO_SBCC_APPLY', 'GD_LIST_COMPLETE', 'GD_WH_PALLETS',
    'GD_DUPLICATION', 'GD_DPMC_EXISTS', 'GD_DPMC_TRAINED', 'SMP_KITCHEN_CLEAN', 'SMP_DEDICATED_STORAGE']) {
    assert.ok(corrected.some((i) => i.code === code), code);
  }
});
