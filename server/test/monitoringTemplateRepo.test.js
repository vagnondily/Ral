/**
 * Modèle d'indicateurs d'une fiche, côté dépôt et SANS base (retours 66 et 85) :
 * un faux client joue les tables. On vérifie le SQL réellement envoyé :
 *   - la carte passe par indicatorProposals : précoche = règle sûre (jamais une
 *     sous-table, jamais un type incompatible), le modèle proposé est montré pour
 *     une fiche sans activité (jamais une carte vide) ;
 *   - un indicateur créé avant une correction du modèle est signalé « à mettre à
 *     jour » (drift), sans aucune écriture ;
 *   - « Créer les N indicateurs proposés » crée les éléments précochés seulement,
 *     écrit la cible du modèle et ne réécrit aucun indicateur existant ;
 *   - une liaison de type incompatible est refusée (400 qui nomme l'élément) ;
 *   - un modèle autre que celui de l'activité est refusé (400).
 * Aucune écriture de l'activité de la fiche dans ces chemins.
 */
process.env.LOG_LEVEL = 'silent';
const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/config/db');
const FIXTURE = require('./helpers/xlsformTemplateVars.json');

const T = '11111111-1111-1111-1111-111111111111';
const FORM = '22222222-2222-2222-2222-222222222222';
const SMP_ID = 'MDG_SMP_2025_2026';
const MIARO_ID = 'MDG_Process_Monitoring_MIARO_PROD_Janv2026';

/** Définition XLSForm reconstituée depuis la fixture (sans libellés réels). */
function definition(formId) {
  const f = FIXTURE.forms[formId];
  const choices = {};
  for (const [list, l] of Object.entries(f.lists)) {
    choices[list] = l.codes.map((v) => ({ value: v, label: l.yes.includes(v) ? 'Oui' : l.other.includes(v) ? 'Autre' : l.na.includes(v) ? 'Sans objet' : `choix ${v}` }));
  }
  const fields = f.fields.map(([name, type, listName]) => ({ name, type, label: name, listName }));
  return { fields, choices };
}

let state;
function reset(over = {}) {
  state = {
    calls: [], inserted: [],
    form: { id: FORM, code: SMP_ID, label: 'Suivi SMP', activityCategory: null, submissions: 1159 },
    def: definition(SMP_ID),
    dataKeys: [],
    calc: [], // champs calculés MEMS de la fiche : { name, label }
    indicators: [], // lignes de monitoring_indicators
    ...over,
  };
}
reset();

db.withTenantTransaction = async (tenantId, fn) => fn({
  query: async (sql, params = []) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    state.calls.push({ sql: s, params });
    if (/^SELECT f.id, f.code, f.label, f.activity_category AS "activityCategory"/.test(s)) return { rows: [state.form] };
    if (/^SELECT id, code, label, activity_category AS "activityCategory" FROM monitoring_forms .* FOR UPDATE$/.test(s)) return { rows: [state.form] };
    if (/^SELECT name, label, type, group_path AS "group", list_name AS "listName", relevant FROM monitoring_form_fields/.test(s)) {
      return { rows: state.def.fields.map((f) => ({ name: f.name, label: f.label, type: f.type, group: null, listName: f.listName, relevant: null })) };
    }
    if (/^SELECT list_name AS "listName", value, label FROM monitoring_choices/.test(s)) {
      return { rows: Object.entries(state.def.choices).filter(([l]) => params[2].includes(l)).flatMap(([listName, cs]) => cs.map((c) => ({ listName, ...c }))) };
    }
    if (/^SELECT DISTINCT jsonb_object_keys\(data\)/.test(s)) return { rows: state.dataKeys.map((name) => ({ name })) };
    if (/^SELECT name, label FROM monitoring_calc_fields WHERE tenant_id = \$1 AND form_id = \$2 ORDER BY name$/.test(s)) return { rows: state.calc };
    if (/^SELECT id, code, label, template_code AS "templateCode", source_field AS "sourceField", agg,/.test(s)) {
      return { rows: state.indicators.map((i, k) => ({ id: `ind-${k}`, naValues: [], target: null, direction: 'higher_better', ...i })) };
    }
    if (/^SELECT code, template_code AS "templateCode" FROM monitoring_indicators .* FOR UPDATE$/.test(s)) {
      return { rows: state.indicators.map((i) => ({ code: i.code, templateCode: i.templateCode || null })) };
    }
    if (/^INSERT INTO monitoring_indicators \(tenant_id, form_id, code, label, module, source_field, agg, positive_value, direction, na_values, target, scored, template_code, sort_order\)/.test(s)) {
      const per = 14;
      const n = params.length / per;
      state.inserted.push(...Array.from({ length: n }, (_, i) => params.slice(i * per, (i + 1) * per)));
      return { rowCount: n, rows: [] };
    }
    if (/^UPDATE monitoring_forms SET updated_at/.test(s)) return { rowCount: 1, rows: [] };
    throw new Error(`requête inattendue : ${s.slice(0, 140)}`);
  },
});
const repo = require('../src/modules/monitoring/monitoring.repository'); // après le remplacement

const noActivityWrite = () => assert.equal(state.calls.filter((c) => /activity_category =/.test(c.sql)).length, 0);

test('carte : fiche sans activité → modèle proposé ; précoche sûre (sous-tables et types incompatibles exclus)', async () => {
  reset();
  const out = await repo.formTemplate(T, FORM);
  assert.equal(out.source, 'proposal');
  assert.equal(out.template.key, 'SMP');
  assert.equal(out.proposal.best.key, 'SMP');
  assert.ok(out.summary.proposed >= 70, JSON.stringify(out.summary));
  const groups = out.template.items.filter((i) => i.warnings.includes('groupe'));
  assert.equal(out.summary.subtable, groups.length);
  for (const it of groups) assert.equal(it.suggestion.preselect, false, it.code);
  for (const it of out.template.items.filter((i) => i.suggestion.preselect)) assert.deepEqual(it.suggestion.issues, [], it.code);
  assert.equal(out.template.items.some((i) => 'formerly' in i), false); // la définition d'avant reste côté serveur
  noActivityWrite();
});

test('carte (GD, définition sans données) : GD_WH_PALLETS jamais lié au parent du choix multiple', async () => {
  reset({ def: definition('MDG_Process_Monitoring_GD_PREVMA_v2'), form: { id: FORM, code: 'MDG_Process_Monitoring_GD_PREVMA_v2', label: 'GD', activityCategory: 'Unconditional resource transfers to support access to food', submissions: 0 } });
  const out = await repo.formTemplate(T, FORM);
  assert.equal(out.source, 'activity');
  const pallets = out.template.items.find((i) => i.code === 'GD_WH_PALLETS');
  assert.equal(pallets.suggestion.field, null);
  assert.equal(pallets.suggestion.pendingData, true); // l'option arrivera avec les données (« MOWhStackPall/1 »)
  assert.equal(pallets.suggestion.preselect, false);
});

test('carte : indicateur créé avant la correction du modèle → « à mettre à jour », rien n\'est écrit', async () => {
  reset({
    def: definition(MIARO_ID),
    form: { id: FORM, code: MIARO_ID, label: 'MIARO', activityCategory: 'Malnutrition prevention activities', submissions: 0 },
    indicators: [
      { code: 'MIARO_NO_DELAY', label: 'Absence de retard', templateCode: 'MIARO_NO_DELAY', sourceField: 'risk_delay', agg: 'percent_value', positiveValue: '0' },
      { code: 'MIARO_SBCC_MSG', label: 'SBCC : messages retenus', templateCode: 'MIARO_SBCC_MSG', sourceField: 'r_sbcc_msg2', agg: 'percent_yes', positiveValue: '1' },
    ],
  });
  const out = await repo.formTemplate(T, FORM);
  const delay = out.template.items.find((i) => i.code === 'MIARO_NO_DELAY');
  assert.equal(delay.existing.drift.kind, 'definition');
  assert.equal(delay.existing.drift.former, true);
  assert.deepEqual(delay.existing.drift.patch, { sourceField: 'r_no_delay', agg: 'percent_yes', positiveValue: '1', label: delay.label });
  assert.equal(out.template.items.find((i) => i.code === 'MIARO_SBCC_MSG').existing.drift, null);
  assert.equal(out.summary.toUpdate, 1);
  assert.equal(state.calls.filter((c) => /^(INSERT|UPDATE|DELETE)/.test(c.sql)).length, 0);
});

test('un clic : éléments proposés seulement, cible du modèle écrite, rien de réécrit, activité inchangée', async () => {
  reset({ indicators: [{ code: 'SMP_MENU_DISPLAYED', templateCode: 'SMP_MENU_DISPLAYED' }, { code: 'SMP_KITCHEN_VENT', templateCode: null }] });
  const out = await repo.applyTemplate(T, FORM, { proposed: true });
  assert.equal(out.template, 'SMP');
  const codes = state.inserted.map((p) => p[2]);
  assert.equal(out.applied, codes.length);
  assert.ok(codes.length >= 70, `${codes.length}`);
  assert.ok(!codes.includes('SMP_MENU_DISPLAYED'));  // déjà créé : jamais réécrit
  assert.ok(!codes.includes('SMP_KITCHEN_VENT'));    // code pris par un indicateur manuel
  assert.ok(!codes.includes('SMP_TEACHER_SATISF'));  // sous-table : pas précoché
  const insert = state.calls.find((c) => /^INSERT INTO monitoring_indicators/.test(c.sql));
  assert.match(insert.sql, /ON CONFLICT \(form_id, code\) DO NOTHING$/);
  // Cible du modèle (« sur les 20 derniers jours d'école ») écrite : l'indicateur est classé, jamais « Non évalué » faute de cible.
  const days = state.inserted.find((p) => p[2] === 'SMP_DAYS_SERVED');
  assert.equal(days[10], 20);
  assert.equal(state.inserted.find((p) => p[2] === 'SMP_MENU_DISPLAYED'), undefined);
  noActivityWrite();
});

test('cibles du modèle écrites aussi pour les éléments cochés (MIARO : élevage, stocks)', async () => {
  reset({ def: definition(MIARO_ID), form: { id: FORM, code: MIARO_ID, label: 'MIARO', activityCategory: 'Malnutrition prevention activities', submissions: 0 } });
  await repo.applyTemplate(T, FORM, { items: ['MIARO_LV_NO_DECR', 'MIARO_LV_VACC', 'MIARO_LV_ENCL', 'MIARO_STOCK_EQ'].map((code, i) => ({
    code, sourceField: ['r_lv_no_decr_pct', 'r_lv_vacc_pct', 'r_lv_encl_pct', 'r_stock_eq0_pct'][i], positiveValue: null,
  })) });
  assert.deepEqual(state.inserted.map((p) => [p[2], p[10]]),
    [['MIARO_LV_NO_DECR', 80], ['MIARO_LV_VACC', 80], ['MIARO_LV_ENCL', 80], ['MIARO_STOCK_EQ', 80]]);
});

test('liaison de type incompatible refusée : 400 qui nomme l\'élément, rien d\'écrit', async () => {
  reset({ def: definition('MDG_Process_Monitoring_GD_PREVMA_v2'), form: { id: FORM, code: 'GD', label: 'GD', activityCategory: 'Unconditional resource transfers to support access to food', submissions: 0 } });
  await assert.rejects(repo.applyTemplate(T, FORM, { items: [{ code: 'GD_WH_PALLETS', sourceField: 'MOWhStackPall', positiveValue: '1' }] }), (err) => {
    assert.equal(err.statusCode, 400);
    assert.equal(err.details.code, 'type_mismatch');
    assert.equal(err.details.item, 'GD_WH_PALLETS');
    assert.equal(err.details.type, 'select_multiple');
    assert.match(err.message, /Vivres sur palettes/);
    return true;
  });
  assert.equal(state.inserted.length, 0);
});

test('modèle refusé : autre que celui de l\'activité, inconnu, ou aucun modèle pour la fiche', async () => {
  reset({ form: { id: FORM, code: SMP_ID, label: 'x', activityCategory: 'School meal activities', submissions: 0 } });
  await assert.rejects(repo.formTemplate(T, FORM, { template: 'GD' }), (err) => err.statusCode === 400 && err.details.code === 'activity_template');
  await assert.rejects(repo.applyTemplate(T, FORM, { proposed: true, template: 'ZZZ' }), (err) => err.statusCode === 400 && err.details.code === 'unknown_template');
  reset({ def: { fields: [{ name: 'q1', type: 'select_one', label: 'q1', listName: null }], choices: {} } });
  await assert.rejects(repo.applyTemplate(T, FORM, { proposed: true }), (err) => err.statusCode === 400 && err.details.code === 'no_template');
  const out = await repo.formTemplate(T, FORM);
  assert.deepEqual([out.template, out.source, out.proposal.best], [null, null, null]);
});

const GD_ID = 'MDG_Process_Monitoring_GD_PREVMA_v2';
const gdForm = () => ({ id: FORM, code: GD_ID, label: 'GD', activityCategory: 'Unconditional resource transfers to support access to food', submissions: 0 });

test('création (C13) : « % = valeur » sans valeur comptée → 400 qui nomme l\'élément, rien d\'écrit', async () => {
  reset({ def: definition(MIARO_ID), form: { id: FORM, code: MIARO_ID, label: 'MIARO', activityCategory: 'Malnutrition prevention activities', submissions: 0 } });
  await assert.rejects(repo.applyTemplate(T, FORM, { items: [{ code: 'MIARO_ISSUES_OPEN', sourceField: 'reso_status', positiveValue: null }] }), (err) => {
    assert.equal(err.statusCode, 400);
    assert.deepEqual([err.details.code, err.details.item, err.details.field], ['positive_required', 'MIARO_ISSUES_OPEN', 'reso_status']);
    assert.match(err.message, /MIARO_ISSUES_OPEN/);
    return true;
  });
  assert.equal(state.inserted.length, 0);
});

test('création (C13) : valeur comptée aussi hors base, ou absente de la liste → 400 qui nomme l\'élément, rien d\'écrit (lot entier)', async () => {
  reset({ def: definition(GD_ID), form: gdForm() });
  const ok = { code: 'GD_NOT_PAID', sourceField: 'HHAsstPayEnt', positiveValue: '0' };
  await assert.rejects(repo.applyTemplate(T, FORM, { items: [ok, { code: 'GD_DPMC_TRAINED', sourceField: 'MODPMCMemb', positiveValue: '1|888' }] }), (err) => {
    assert.deepEqual([err.statusCode, err.details.code, err.details.item, err.details.value], [400, 'positive_is_na', 'GD_DPMC_TRAINED', '888']);
    return true;
  });
  await assert.rejects(repo.applyTemplate(T, FORM, { items: [ok, { code: 'GD_DPMC_TRAINED', sourceField: 'MODPMCMemb', positiveValue: '7' }] }), (err) => {
    assert.deepEqual([err.statusCode, err.details.code, err.details.item, err.details.value, err.details.field], [400, 'positive_not_in_list', 'GD_DPMC_TRAINED', '7', 'MODPMCMemb']);
    return true;
  });
  assert.equal(state.inserted.length, 0); // le lot est refusé entier : GD_NOT_PAID non plus
  // La même ligne, corrigée, passe.
  const out = await repo.applyTemplate(T, FORM, { items: [ok, { code: 'GD_DPMC_TRAINED', sourceField: 'MODPMCMemb', positiveValue: '1' }] });
  assert.equal(out.applied, 2);
});

test('carte et création (C15) : un champ calculé MEMS de la fiche est une variable comme une autre', async () => {
  const def = definition(MIARO_ID);
  def.fields = def.fields.filter((f) => f.name !== 'r_no_delay'); // la fiche n'a pas le calcul XLSForm…
  reset({ def, calc: [{ name: 'r_no_delay', label: 'Pas de retard (calcul MEMS)' }], form: { id: FORM, code: MIARO_ID, label: 'MIARO', activityCategory: 'Malnutrition prevention activities', submissions: 0 } });
  const out = await repo.formTemplate(T, FORM);
  const delay = out.template.items.find((i) => i.code === 'MIARO_NO_DELAY');
  assert.deepEqual([delay.suggestion.field, delay.suggestion.confidence], ['r_no_delay', 'sure']); // … mais son champ calculé MEMS
  assert.ok(out.fields.some((f) => f.name === 'r_no_delay'));
  const made = await repo.applyTemplate(T, FORM, { items: [{ code: 'MIARO_NO_DELAY', sourceField: 'r_no_delay', positiveValue: '1' }] });
  assert.equal(made.applied, 1);
  assert.equal(state.inserted[0][5], 'r_no_delay');
});

test('carte (C14) : une modification de l\'utilisateur est une différence, jamais comptée « à mettre à jour »', async () => {
  reset({
    def: definition(GD_ID), form: gdForm(),
    indicators: [{ code: 'GD_DPMC_TRAINED', templateCode: 'GD_DPMC_TRAINED', label: 'Membres du comité présents lors de la visite', sourceField: 'MODPMCMemb', agg: 'percent_yes', positiveValue: '1', naValues: ['888'], direction: 'lower_better' }],
  });
  const out = await repo.formTemplate(T, FORM);
  const dpmc = out.template.items.find((i) => i.code === 'GD_DPMC_TRAINED');
  assert.equal(dpmc.existing.drift.kind, 'difference');
  assert.deepEqual(dpmc.existing.drift.patch, {});
  assert.deepEqual(dpmc.existing.drift.fullPatch, { direction: 'higher_better' });
  assert.deepEqual([out.summary.toUpdate, out.summary.labelsToUpdate, out.summary.differences], [0, 0, 1]);
  assert.equal(state.calls.filter((c) => /^(INSERT|UPDATE|DELETE)/.test(c.sql)).length, 0);
});
