/**
 * Proposition du modèle d'indicateurs d'une fiche (retours 66 et 85) : logique pure.
 * Les 5 formulaires réels sont lus dans la fixture (noms, types, codes ; aucun libellé).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/modules/monitoring/indicatorProposals');
const { CATALOG, templateByKey, positiveFor, labelKey } = require('../src/modules/monitoring/indicatorTemplates');
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

test('écart : variable du modèle pas encore dans les données → bloqué, rien d\'un clic ; cible vide = différence, jamais une correction', () => {
  const gd = templateByKey('GD');
  const pallets = gd.items.find((i) => i.code === 'GD_WH_PALLETS');
  const d = P.templateDrift(pallets, { field: null, naValues: [], pendingData: true }, { label: 'Produits sur palettes', sourceField: 'MOWhStackProp', agg: 'percent_yes', positiveValue: '1', naValues: [], target: null, direction: 'higher_better' });
  assert.equal(d.kind, 'definition');
  assert.equal(d.former, true);
  assert.deepEqual(d.changes.find((c) => c.key === 'sourceField'), { key: 'sourceField', from: 'MOWhStackProp', to: null, origin: 'correction' });
  assert.deepEqual(d.blocked, { reason: 'missing', field: 'MOWhStackPall/1', issues: [], pendingData: true });
  assert.deepEqual([d.patch, d.fullPatch], [{}, {}]); // même le libellé : jamais le libellé du modèle sur l'ancienne variable
  const smp = templateByKey('SMP');
  const days = smp.items.find((i) => i.code === 'SMP_DAYS_SERVED');
  // Cible vide : ancienne création ou cible effacée par l'utilisateur, indiscernables → information, action de la ligne seulement.
  const t = P.templateDrift(days, null, { label: days.label, sourceField: 'DIRNBSchMealsProvided', agg: 'mean', positiveValue: null, naValues: ['888'], target: null, direction: 'higher_better' });
  assert.equal(t.kind, 'difference');
  assert.equal(t.former, false);
  assert.deepEqual(t.patch, {});
  assert.deepEqual(t.fullPatch, { target: 20 });
});

const MIARO_OLD = { label: 'Absence de retard', sourceField: 'risk_delay', agg: 'percent_value', positiveValue: '0', naValues: [], target: null, direction: 'higher_better' };
const YES_NO = [{ value: '0', label: 'Non' }, { value: '1', label: 'Oui' }];

test('écart (C10) : variable du modèle absente, une question au libellé proche (« à vérifier ») → bloqué, jamais rattaché d\'un clic', () => {
  const item = templateByKey('STUNT').items.find((i) => i.code === 'MIARO_NO_DELAY');
  const fields = [
    { name: 'risk_delay', type: 'select_one', choices: YES_NO },
    { name: 'q_other', label: 'Pas de retard au démarrage de la distribution ?', type: 'select_one', choices: YES_NO },
  ];
  const binding = P.bindTemplate({ items: [item] }, fields)[0];
  assert.deepEqual([binding.field, binding.confidence, binding.issues], ['q_other', 'a_verifier', []]);
  const d = P.templateDrift(item, binding, MIARO_OLD, { fields });
  assert.deepEqual(d.blocked, { reason: 'unverified', field: 'q_other', issues: [], pendingData: false });
  assert.deepEqual([d.patch, d.fullPatch], [{}, {}]);
  assert.equal(d.changes.find((c) => c.key === 'sourceField').to, null);
});

test('écart (C21) : variable du modèle présente mais de type incompatible → bloqué « incompatible », avec le défaut', () => {
  const item = templateByKey('STUNT').items.find((i) => i.code === 'MIARO_NO_DELAY');
  const fields = [{ name: 'risk_delay', type: 'select_one', choices: YES_NO }, { name: 'r_no_delay', type: 'select_multiple', choices: YES_NO }];
  const binding = P.bindTemplate({ items: [item] }, fields)[0];
  const d = P.templateDrift(item, binding, MIARO_OLD, { fields });
  assert.deepEqual(d.blocked, { reason: 'incompatible', field: 'r_no_delay', issues: ['type'], pendingData: false });
  assert.deepEqual(d.patch, {});
});

test('écart (C11) : variable choisie par l\'utilisateur (ni du modèle ni d\'avant la correction) → jamais signalée', () => {
  const item = templateByKey('GD').items.find((i) => i.code === 'GD_DIST_LIST_NUT');
  const fields = [{ name: 'q_custom', label: 'Liste bénéficiaires disponible', type: 'select_one', choices: YES_NO }];
  const binding = P.bindTemplate({ items: [item] }, fields)[0];
  assert.equal(binding.confidence, 'a_verifier');
  const created = { label: item.label, sourceField: 'q_custom', agg: 'percent_yes', positiveValue: '1', naValues: [], target: null, direction: 'higher_better' };
  assert.equal(P.templateDrift(item, binding, created, { fields }), null);
});

test('écart (C12) : « % = valeur » jamais remplacé par le « Oui » de la liste — ni proposé, ni signalé à l\'envers', () => {
  const item = templateByKey('GD').items.find((i) => i.code === 'GD_NOT_PAID');
  const fields = [{ name: 'HHAsstPayEnt', type: 'select_one', choices: [{ value: 'yes', label: 'Oui' }, { value: 'no', label: 'Non' }] }];
  const binding = P.bindTemplate({ items: [item] }, fields)[0];
  assert.deepEqual([binding.positiveValue, binding.issues, binding.preselect], ['0', ['positive'], false]);
  const ind = { label: item.label, sourceField: 'HHAsstPayEnt', agg: 'percent_value', positiveValue: '0', naValues: [], target: null, direction: 'higher_better' };
  assert.equal(P.templateDrift(item, binding, ind, { fields }), null);
  // Valeur saisie par l'utilisateur sur cette liste : invérifiable face au modèle → non signalée (jamais « yes »).
  assert.equal(P.templateDrift(item, binding, { ...ind, positiveValue: 'no' }, { fields }), null);
});

test('écart (C14) : modifications de l\'utilisateur = différences (information), jamais dans « Tout mettre à jour »', () => {
  const item = templateByKey('GD').items.find((i) => i.code === 'GD_DPMC_TRAINED');
  const fields = [{ name: 'MODPMCMemb', type: 'select_one', choices: [{ value: '0', label: 'Non' }, { value: '1', label: 'Oui' }, { value: '888', label: 'Ne sait pas' }, { value: '999', label: 'Refus' }] }];
  const binding = P.bindTemplate({ items: [item] }, fields)[0];
  const base = { label: item.label, sourceField: 'MODPMCMemb', agg: 'percent_yes', positiveValue: '1', naValues: ['888'], target: null, direction: 'higher_better' };
  assert.equal(P.templateDrift(item, binding, base, { fields }), null);
  for (const edit of [{ direction: 'lower_better' }, { naValues: ['888', '999'] }, { naValues: [] }, { agg: 'mean' }, { positiveValue: '0' }]) {
    const d = P.templateDrift(item, binding, { ...base, ...edit }, { fields });
    assert.equal(d.kind, 'difference', JSON.stringify(edit));
    assert.equal(d.former, false, JSON.stringify(edit));
    assert.deepEqual(d.patch, {}, JSON.stringify(edit));
    assert.ok(Object.keys(d.fullPatch).length > 0, JSON.stringify(edit));
    assert.ok(d.changes.every((c) => c.origin === 'difference'), JSON.stringify(edit));
  }
  // Ancien libellé du modèle + sens changé par l'utilisateur : seule la correction part en lot ; le sens reste à la ligne.
  const mixed = P.templateDrift(item, binding, { ...base, label: 'DPMC membres formés', direction: 'lower_better' }, { fields });
  assert.equal(mixed.kind, 'label');
  assert.deepEqual(mixed.patch, { label: item.label });
  assert.deepEqual(mixed.fullPatch, { label: item.label, direction: 'higher_better' });
});

test('écart : correction de méthode sans liste vérifiée (variable de l\'indicateur absente) → bloquée, jamais « % = valeur » sans liste', () => {
  const item = templateByKey('STUNT').items.find((i) => i.code === 'MIARO_ISSUES_OPEN');
  const old = { label: item.formerly[0].label, sourceField: 'reso_status', agg: 'count', positiveValue: '4', naValues: [], target: null, direction: 'lower_better' };
  const d = P.templateDrift(item, { field: null, issues: [], naValues: [] }, old, { fields: [] });
  assert.equal(d.kind, 'definition');
  assert.equal(d.blocked.reason, 'missing');
  assert.deepEqual(d.patch, {});
  // La variable est là, avec « 4 » dans sa liste : la correction part d'un clic.
  const fields = [{ name: 'reso_status', type: 'select_one', choices: [{ value: '1', label: 'Résolu' }, { value: '4', label: 'En attente' }] }];
  const ok = P.templateDrift(item, P.bindTemplate({ items: [item] }, fields)[0], old, { fields });
  assert.equal(ok.blocked, null);
  assert.deepEqual(ok.patch, { agg: 'percent_value', label: item.label });
});

test('écart (R3) : ancienne méthode ou valeur sur une variable de l\'UTILISATEUR → différence, jamais corrigée en lot', () => {
  const stunt = templateByKey('STUNT');
  const gd = templateByKey('GD');
  const cases = [
    // MIARO_NO_DELAY déplacé sur DelayStart (1 = Oui = retard) en gardant « % = 0 » : la correction l'inverserait.
    { item: stunt.items.find((i) => i.code === 'MIARO_NO_DELAY'), fields: [{ name: 'DelayStart', type: 'select_one', choices: YES_NO }],
      ind: { ...MIARO_OLD, sourceField: 'DelayStart' } },
    // Hotline sur une variable à soi (2 = Non) : « Non » sortirait de la base → 100 % assuré.
    { item: gd.items.find((i) => i.code === 'GD_HOTLINE_DISPLAYED'), fields: [{ name: 'MyHotline', type: 'select_one', choices: [{ value: '1', label: 'Oui' }, { value: '2', label: 'Non' }] }],
      ind: { label: 'CFM affiché sur site', sourceField: 'MyHotline', agg: 'percent_yes', positiveValue: '1', naValues: [], target: null, direction: 'higher_better' } },
    // SBCC sur un champ calculé 0/1 de l'utilisateur : « Moyenne » donnerait 0,6 face à une cible de 80.
    { item: stunt.items.find((i) => i.code === 'MIARO_SBCC_APPLY'), fields: [{ name: 'MyApply', type: 'calculate', choices: [] }],
      ind: { label: 'SBCC : pratiques appliquées', sourceField: 'MyApply', agg: 'percent_yes', positiveValue: '1', naValues: [], target: null, direction: 'higher_better' } },
  ];
  for (const { item, fields, ind } of cases) {
    const binding = P.bindTemplate({ items: [item] }, fields)[0];
    const d = P.templateDrift(item, binding, ind, { fields });
    assert.ok(d, item.code);
    assert.equal(d.kind, 'difference', item.code);
    assert.equal(d.former, false, item.code);
    assert.deepEqual(d.patch, {}, item.code);
    assert.ok(d.changes.every((c) => c.origin === 'difference'), item.code);
    assert.equal(d.blocked, null, `${item.code} : jamais « la variable du modèle » pour la variable de l'utilisateur`);
  }
});

test('écart (R4) : cible vide = correction si l\'indicateur vient de l\'ancien chemin (sans cible), différence si l\'utilisateur l\'a effacée', () => {
  const stunt = templateByKey('STUNT');
  const spi = stunt.items.find((i) => i.code === 'MIARO_SPI');
  const fields = [{ name: 'SitePerformanceIndex', type: 'decimal', choices: [] }];
  const binding = P.bindTemplate({ items: [spi] }, fields)[0];
  // Créé avant le 16/10 (ancien libellé « Score SPI », aucune cible écrite) : la cible est une correction, envoyée en lot.
  const old = { label: 'Score SPI', sourceField: 'SitePerformanceIndex', agg: 'mean', positiveValue: null, naValues: [], target: null, direction: 'higher_better' };
  const d = P.templateDrift(spi, binding, old, { fields });
  assert.deepEqual(d.patch, { target: 75, label: spi.label });
  assert.equal(d.changes.find((c) => c.key === 'target').origin, 'correction');
  // Créé par le chemin actuel (définition actuelle, cible écrite), cible effacée ensuite par l'utilisateur : jamais réécrite en lot.
  const cleared = P.templateDrift(spi, binding, { ...old, label: spi.label }, { fields });
  assert.deepEqual([cleared.kind, cleared.patch, cleared.fullPatch], ['difference', {}, { target: 75 }]);
  // SBCC d'avant (variable, méthode et valeur d'avant) : variable, méthode, valeur ET cible corrigées ensemble.
  const sbcc = stunt.items.find((i) => i.code === 'MIARO_SBCC_APPLY');
  const sf = [{ name: 'HHSbcPracticeApplied', type: 'select_one', choices: YES_NO }, { name: 'r_sbcc_apply_pct', type: 'calculate', choices: [] }];
  const sd = P.templateDrift(sbcc, P.bindTemplate({ items: [sbcc] }, sf)[0],
    { label: 'SBCC : pratiques appliquées', sourceField: 'HHSbcPracticeApplied', agg: 'percent_yes', positiveValue: '1', naValues: [], target: null, direction: 'higher_better' }, { fields: sf });
  assert.deepEqual(sd.patch, { sourceField: 'r_sbcc_apply_pct', agg: 'mean', positiveValue: null, target: 80, label: sbcc.label });
});

const FORMS_T = {
  MDG_Process_Monitoring_GD_PREVMA_v2: 'GD', MDG_SMP_2025_2026: 'SMP', MDG_Process_Monitoring_NutritionAIM: 'MAM',
  MDG_Process_Monitoring_MIARO_PROD_Janv2026: 'STUNT', MDG_PROCESS_MONITORING_RESILIENCE_SAMS_V2_1: 'RES',
};
/** Indicateur tel que le chemin ACTUEL le crée (applyTemplate : variable proposée, valeurs de la liste, cible du modèle). */
const created = (item, b) => ({ label: item.label, sourceField: b.field, agg: item.agg, positiveValue: b.positiveValue, naValues: b.naValues, target: item.target ?? null, direction: item.direction });

test('écart (T1) : sur un indicateur créé aujourd\'hui, une seule valeur ramenée à une valeur d\'avant = choix de l\'utilisateur, jamais corrigée en lot', () => {
  // GD_HOTLINE_DISPLAYED créé aujourd'hui sur HHAsstRecInfoLe (0/1/2) : l'utilisateur retire « 2 » des hors base.
  const gdFields = withOptionColumns(fixtureFields('MDG_Process_Monitoring_GD_PREVMA_v2'));
  const hot = templateByKey('GD').items.find((i) => i.code === 'GD_HOTLINE_DISPLAYED');
  const hb = P.bindTemplate({ items: [hot] }, gdFields)[0];
  assert.equal(P.templateDrift(hot, hb, created(hot, hb), { fields: gdFields }), null);
  const d1 = P.templateDrift(hot, hb, { ...created(hot, hb), naValues: [] }, { fields: gdFields });
  assert.deepEqual([d1.kind, d1.patch, d1.fullPatch], ['difference', {}, { naValues: hb.naValues }]);
  // MIARO_ISSUES_OPEN créé aujourd'hui (« % = valeur » 4) : l'utilisateur choisit « Nombre ».
  const miFields = withOptionColumns(fixtureFields('MDG_Process_Monitoring_MIARO_PROD_Janv2026'));
  const open = templateByKey('STUNT').items.find((i) => i.code === 'MIARO_ISSUES_OPEN');
  const ob = P.bindTemplate({ items: [open] }, miFields)[0];
  const d2 = P.templateDrift(open, ob, { ...created(open, ob), agg: 'count' }, { fields: miFields });
  assert.deepEqual([d2.kind, d2.patch], ['difference', {}]);
  // La même valeur AVEC l'ancien libellé (seule preuve admise de l'ancien chemin) reste une correction.
  const d3 = P.templateDrift(open, ob, { ...created(open, ob), agg: 'count', label: open.formerly[0].label }, { fields: miFields });
  assert.equal(d3.changes.find((c) => c.key === 'agg').origin, 'correction');
  assert.equal(d3.patch.agg, 'percent_value');
});

test('écart (T1) : 5 formulaires réels — aucune modification d\'UNE valeur sur un indicateur du chemin actuel n\'est une correction', () => {
  let cases = 0;
  for (const [formId, key] of Object.entries(FORMS_T)) {
    const fields = withOptionColumns(fixtureFields(formId));
    const tpl = templateByKey(key);
    const bindings = P.bindTemplate(tpl, fields);
    tpl.items.forEach((item, i) => {
      const b = bindings[i];
      if (!b.field || b.issues.length || !['sure', 'probable'].includes(b.confidence)) return;
      const ind = created(item, b);
      assert.equal(P.templateDrift(item, b, ind, { fields }), null, `${formId} ${item.code} : créé aujourd'hui, aucun écart`);
      const edits = [];
      for (const f of item.formerly || []) {
        if (f.agg !== item.agg) edits.push({ agg: f.agg });
        if (String(f.positiveValue ?? '') !== String(item.positiveValue ?? '')) edits.push({ positiveValue: f.positiveValue ?? null });
        if ((f.naValues || []).join('|') !== (item.naValues || []).join('|')) edits.push({ naValues: f.naValues || [] });
        if (f.direction && f.direction !== item.direction) edits.push({ direction: f.direction });
      }
      if (item.target != null) edits.push({ target: null });
      for (const e of edits) {
        const d = P.templateDrift(item, b, { ...ind, ...e }, { fields });
        assert.ok(!d || d.changes.every((c) => c.origin === 'difference'), `${formId} ${item.code} ${JSON.stringify(e)} → ${JSON.stringify(d && d.patch)}`);
        cases += 1;
      }
    });
  }
  assert.ok(cases >= 20, `${cases}`); // 25 modifications d'une valeur vers une valeur d'avant (ou cible effacée) sur les 5 formulaires
});

/** Variable d'avant (absente des variables du modèle) présente dans la fiche, telle que l'utilisateur la choisit aujourd'hui sur la carte. */
function formerOnlyChoices(item, fields) {
  const out = [];
  for (const f of item.formerly || []) {
    for (const v of f.variables || []) {
      if ((item.variables || []).some((x) => x.toLowerCase() === v.toLowerCase())) continue;
      const field = fields.find((x) => x.name.toLowerCase() === v.toLowerCase());
      if (!field || out.some((o) => o.field === field)) continue;
      const checked = P.bindItem(item, { positiveValue: positiveFor(item, field), confidence: null }, field);
      if (P.templateRowIssue(item, field, { sourceField: field.name, agg: item.agg, positiveValue: checked.positiveValue, naValues: checked.naValues })) continue; // refusé à la création
      out.push({ field, ind: { label: item.label, sourceField: field.name, agg: item.agg, positiveValue: checked.positiveValue, naValues: checked.naValues, target: item.target ?? null, direction: item.direction } });
    }
  }
  return out;
}
const USER_LABEL = 'Libellé choisi par l\'utilisateur';

test('écart (V1) : variable d\'avant choisie par l\'utilisateur sur un indicateur du chemin actuel → différence, jamais « Tout mettre à jour »', () => {
  const named = [
    ['MDG_Process_Monitoring_GD_PREVMA_v2', 'GD', 'GD_LIST_COMPLETE', 'MODistrList'],
    ['MDG_Process_Monitoring_GD_PREVMA_v2', 'GD', 'GD_WH_PALLETS', 'MOWhStackProp'],
    ['MDG_Process_Monitoring_MIARO_PROD_Janv2026', 'STUNT', 'MIARO_NO_DELAY', 'HHDTPDelay'],
  ];
  for (const [formId, key, code, v] of named) {
    const fields = withOptionColumns(fixtureFields(formId));
    const item = templateByKey(key).items.find((i) => i.code === code);
    const b = P.bindTemplate({ items: [item] }, fields)[0];
    const choice = formerOnlyChoices(item, fields).find((c) => c.field.name === v);
    assert.ok(choice, `${code} ${v}`);
    const d = P.templateDrift(item, b, choice.ind, { fields });
    assert.deepEqual([d.kind, d.former, d.blocked, d.patch], ['difference', false, null, {}], `${code} ${v}`);
    assert.deepEqual(d.changes.find((c) => c.key === 'sourceField'), { key: 'sourceField', from: v, to: b.field, origin: 'difference' }, code);
    assert.equal(d.fullPatch.sourceField, b.field, `${code} : « Appliquer le modèle » de la ligne ramène la variable du modèle`);
    // Le serveur recalcule la même chose : « Tout mettre à jour » n'a rien à envoyer, « Appliquer le modèle » passe.
    assert.ok(P.samePatch(P.templateDrift(item, b, choice.ind, { fields }).fullPatch, d.fullPatch), code);
    // La même variable avec l'ANCIEN libellé = indicateur de l'ancien chemin : la variable est corrigée.
    const old = P.templateDrift(item, b, { ...choice.ind, label: item.formerly[0].label }, { fields });
    assert.equal(old.changes.find((c) => c.key === 'sourceField').origin, 'correction', code);
    assert.equal(old.patch.sourceField, b.field, code);
  }
  // Variable du modèle pas encore dans les données (option « MOWhStackPall/1 » sans colonne) : la différence est
  // montrée, bloquée (rien d'un clic, même à la ligne) ; avec l'ancien libellé, c'est une correction bloquée.
  const raw = fixtureFields('MDG_Process_Monitoring_GD_PREVMA_v2');
  const pal = templateByKey('GD').items.find((i) => i.code === 'GD_WH_PALLETS');
  const pb = P.bindTemplate({ items: [pal] }, raw)[0];
  assert.deepEqual([pb.field, pb.pendingData], [null, true]);
  const pChoice = formerOnlyChoices(pal, raw).find((c) => c.field.name === 'MOWhStackProp');
  const pd = P.templateDrift(pal, pb, pChoice.ind, { fields: raw });
  assert.deepEqual([pd.kind, pd.former, pd.patch, pd.fullPatch], ['difference', false, {}, {}]);
  assert.deepEqual(pd.changes, [{ key: 'sourceField', from: 'MOWhStackProp', to: null, origin: 'difference' }]);
  assert.deepEqual(pd.blocked, { reason: 'missing', field: 'MOWhStackPall/1', issues: [], pendingData: true });
  const po = P.templateDrift(pal, pb, { ...pChoice.ind, label: 'Produits sur palettes' }, { fields: raw });
  assert.deepEqual([po.kind, po.former, po.patch, po.blocked.reason], ['definition', true, {}, 'missing']);
  // Balayage : toute variable d'avant des 5 formulaires réels, choisie aujourd'hui (libellé actuel ou renommé), seule ou
  // avec des valeurs d'avant → jamais une correction.
  let cases = 0;
  for (const [formId, key] of Object.entries(FORMS_T)) {
    const fields = withOptionColumns(fixtureFields(formId));
    const tpl = templateByKey(key);
    const bindings = P.bindTemplate(tpl, fields);
    tpl.items.forEach((item, i) => {
      for (const { field, ind } of formerOnlyChoices(item, fields)) {
        for (const f of item.formerly || []) {
          for (const e of [{}, { label: USER_LABEL }, { agg: f.agg, positiveValue: f.positiveValue ?? null }, { naValues: f.naValues || [], direction: f.direction || item.direction, target: null }]) {
            const d = P.templateDrift(item, bindings[i], { ...ind, ...e }, { fields });
            assert.ok(!d || (d.changes.every((c) => c.origin === 'difference') && !Object.keys(d.patch).length),
              `${formId} ${item.code} ${field.name} ${JSON.stringify(e)} → ${JSON.stringify(d && d.patch)}`);
            cases += 1;
          }
        }
      }
    });
  }
  assert.ok(cases >= 12, `${cases}`); // 3 variables d'avant présentes dans les fiches réelles × définitions d'avant × 4 modifications
});

/** Toutes les combinaisons (2 clés ou plus) des modifications d'une valeur vers une valeur d'avant. */
function combos(list) {
  const out = [];
  for (let m = 1; m < (1 << list.length); m += 1) {
    const pick = list.filter((_, j) => m & (1 << j));
    if (pick.length >= 2) out.push(Object.assign({}, ...pick));
  }
  return out;
}

test('écart (V2) : plusieurs valeurs d\'avant modifiées ensemble (avec ou sans le sens) → différences, jamais corrigées en lot', () => {
  // MIARO_NO_DELAY créé aujourd'hui (r_no_delay, « % de oui » 1) puis suivi en « taux de retard » par l'utilisateur.
  const miFields = withOptionColumns(fixtureFields('MDG_Process_Monitoring_MIARO_PROD_Janv2026'));
  const nd = templateByKey('STUNT').items.find((i) => i.code === 'MIARO_NO_DELAY');
  const nb = P.bindTemplate({ items: [nd] }, miFields)[0];
  const ind = created(nd, nb);
  assert.equal(P.templateDrift(nd, nb, ind, { fields: miFields }), null);
  for (const e of [
    { label: 'Retard au démarrage de la distribution', agg: 'percent_value', positiveValue: '0', direction: 'lower_better' },
    { agg: 'percent_value', positiveValue: '0', direction: 'lower_better' },
    { agg: 'percent_value', positiveValue: '0' },
  ]) {
    const d = P.templateDrift(nd, nb, { ...ind, ...e }, { fields: miFields });
    assert.deepEqual([d.kind, d.former, d.patch], ['difference', false, {}], JSON.stringify(e));
    assert.ok(d.changes.every((c) => c.origin === 'difference'), JSON.stringify(e));
    assert.equal(d.fullPatch.agg, 'percent_yes'); // seulement par « Appliquer le modèle » de la ligne
  }
  // Balayage des 5 formulaires réels : toute combinaison (agg, valeur comptée, hors base, sens, cible effacée), au libellé actuel
  // ou renommé, sur la variable proposée → jamais une correction (la seule preuve admise est l'ANCIEN libellé).
  let cases = 0;
  for (const [formId, key] of Object.entries(FORMS_T)) {
    const fields = withOptionColumns(fixtureFields(formId));
    const tpl = templateByKey(key);
    const bindings = P.bindTemplate(tpl, fields);
    tpl.items.forEach((item, i) => {
      const b = bindings[i];
      if (!b.field || b.issues.length || !['sure', 'probable'].includes(b.confidence)) return;
      for (const f of item.formerly || []) {
        const singles = [];
        if (f.agg !== item.agg) singles.push({ agg: f.agg });
        if (String(f.positiveValue ?? '') !== String(item.positiveValue ?? '')) singles.push({ positiveValue: f.positiveValue ?? null });
        if ((f.naValues || []).join('|') !== (item.naValues || []).join('|')) singles.push({ naValues: f.naValues || [] });
        singles.push({ direction: item.direction === 'lower_better' ? 'higher_better' : 'lower_better' });
        if (item.target != null) singles.push({ target: null });
        for (const e of combos(singles)) {
          for (const label of [item.label, USER_LABEL]) {
            const d = P.templateDrift(item, b, { ...created(item, b), ...e, label }, { fields });
            assert.ok(!d || (d.changes.every((c) => c.origin === 'difference') && !Object.keys(d.patch).length),
              `${formId} ${item.code} ${JSON.stringify(e)} ${label} → ${JSON.stringify(d && d.patch)}`);
            cases += 1;
          }
        }
      }
    });
  }
  assert.ok(cases >= 40, `${cases}`); // 20 combinaisons × 2 libellés
});

test('écart : chaque indicateur réel de l\'ancien chemin (ancien libellé) reste corrigé ; renommé ensuite, il devient une différence', () => {
  let cases = 0;
  for (const [formId, key] of Object.entries(FORMS_T)) {
    const fields = withOptionColumns(fixtureFields(formId));
    const tpl = templateByKey(key);
    const bindings = P.bindTemplate(tpl, fields);
    tpl.items.forEach((item, i) => {
      const b = bindings[i];
      for (const f of item.formerly || []) {
        assert.notEqual(labelKey(f.label), labelKey(item.label), `${item.code} : l'ancien libellé diffère de l'actuel`);
        // L'ancien chemin a créé l'indicateur sur une variable de sa définition, ou sur la variable actuelle (T4).
        const vars = [...(f.variables || []), b.field].filter(Boolean)
          .map((v) => fields.find((x) => x.name.toLowerCase() === v.toLowerCase())).filter(Boolean);
        for (const field of new Set(vars)) {
          const old = { label: f.label, sourceField: field.name, agg: f.agg, positiveValue: f.positiveValue ?? null, naValues: f.naValues || [], target: null, direction: f.direction || item.direction };
          const d = P.templateDrift(item, b, old, { fields });
          assert.ok(d && d.former, `${formId} ${item.code} ${field.name}`);
          assert.ok(d.changes.every((c) => c.origin === 'correction'), `${formId} ${item.code} ${field.name} ${JSON.stringify(d.changes)}`);
          if (!d.blocked) assert.equal(d.patch.label, item.label, `${item.code} ${field.name}`);
          // Avec la casse ou la ponctuation changées, l'ancien libellé est reconnu (même normalisation que la liaison).
          const d2 = P.templateDrift(item, b, { ...old, label: `  ${f.label.toUpperCase()} ?` }, { fields });
          assert.ok(d2 && d2.former, `${item.code} : ancien libellé normalisé`);
          // Renommé par l'utilisateur : plus aucune preuve → différence (choix sûr), rien dans « Tout mettre à jour ».
          const r = P.templateDrift(item, b, { ...old, label: USER_LABEL }, { fields });
          assert.ok(!r || (r.changes.every((c) => c.origin === 'difference') && !Object.keys(r.patch).length), `${item.code} ${field.name} renommé`);
          cases += 1;
        }
      }
    });
  }
  assert.ok(cases >= 37, `${cases}`); // 31 définitions d'avant, sur chacune de leurs variables présentes et sur la variable actuelle
});

test('écart (T4) : indicateur de l\'ancien chemin sur la variable ACTUELLE du modèle → corrections (cible comprise), jamais « choix de l\'utilisateur »', () => {
  // Formulaire MIARO réel : seule la variable actuelle r_sbcc_apply_pct existe (ni r_sbcc_apply ni HHSbcPracticeApplied).
  const miFields = withOptionColumns(fixtureFields('MDG_Process_Monitoring_MIARO_PROD_Janv2026'));
  const sbcc = templateByKey('STUNT').items.find((i) => i.code === 'MIARO_SBCC_APPLY');
  const sb = P.bindTemplate({ items: [sbcc] }, miFields)[0];
  assert.equal(sb.field, 'r_sbcc_apply_pct');
  const old = { label: 'SBCC : pratiques appliquées', sourceField: 'r_sbcc_apply_pct', agg: 'percent_yes', positiveValue: '1', naValues: [], target: null, direction: 'higher_better' };
  const d = P.templateDrift(sbcc, sb, old, { fields: miFields });
  assert.equal(d.kind, 'definition');
  assert.deepEqual(d.patch, { agg: 'mean', positiveValue: null, target: 80, label: sbcc.label });
  // GD_WH_PALLETS sur l'option actuelle avec l'ancien libellé : la correction du libellé n'est pas perdue.
  const gdFields = withOptionColumns(fixtureFields('MDG_Process_Monitoring_GD_PREVMA_v2'));
  const pal = templateByKey('GD').items.find((i) => i.code === 'GD_WH_PALLETS');
  const pb = P.bindTemplate({ items: [pal] }, gdFields)[0];
  const pd = P.templateDrift(pal, pb, { label: 'Produits sur palettes', sourceField: 'MOWhStackPall/1', agg: 'percent_yes', positiveValue: pb.positiveValue, naValues: pb.naValues, target: null, direction: 'higher_better' }, { fields: gdFields });
  assert.deepEqual([pd.kind, pd.patch], ['label', { label: pal.label }]);
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
