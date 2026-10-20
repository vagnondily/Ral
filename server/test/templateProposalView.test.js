/**
 * Carte du modèle d'indicateurs, côté interface (web/src/lib/templateProposal.js,
 * fonctions pures ; le front n'a pas de suite de tests propre, elles sont testées ici).
 * Ce qui est verrouillé :
 *  - cases de départ = SEULEMENT la précoche du serveur (indicatorProposals.bindTemplate),
 *    vérifié sur les 5 formulaires réels : jamais une sous-table, jamais un type incompatible ;
 *  - « Créer » envoie exactement les lignes cochées à l'écran (même règle que la case) ;
 *  - aucun code nu à l'écran (avertissements, défauts, types) ;
 *  - indicateur à mettre à jour : bloqué quand la variable du modèle manque (jamais appliqué
 *    à l'ancienne variable), sinon la modification proposée part telle quelle ;
 *  - refus de « Créer » qui nomme l'élément : retrouvé pour l'afficher sur sa ligne.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const P = require('../src/modules/monitoring/indicatorProposals');
const { templateByKey } = require('../src/modules/monitoring/indicatorTemplates');
const FIXTURE = require('./helpers/xlsformTemplateVars.json');

const file = path.join(__dirname, '../../web/src/lib/templateProposal.js');
const load = async (t) => {
  if (!fs.existsSync(file)) { t.skip('web/ absent'); return null; }
  return import(pathToFileURL(file).href);
};
const tr = (s, p) => (p ? s.replace(/\{(\w+)\}/g, (_, k) => String(p[k])) : s);

/** Variables d'un formulaire de la fixture (comme indicatorProposals.test.js). */
function fixtureFields(formId) {
  const f = FIXTURE.forms[formId];
  return f.fields.map(([name, type, list, repeat]) => ({
    name, type, repeat,
    choices: list ? f.lists[list].codes.map((v) => ({ value: v, label: f.lists[list].yes.includes(v) ? 'Oui' : `choix ${v}` })) : [],
  }));
}
const FORMS = {
  MDG_Process_Monitoring_GD_PREVMA_v2: 'GD',
  MDG_SMP_2025_2026: 'SMP',
  MDG_Process_Monitoring_NutritionAIM: 'MAM',
  MDG_Process_Monitoring_MIARO_PROD_Janv2026: 'STUNT',
  MDG_PROCESS_MONITORING_RESILIENCE_SAMS_V2_1: 'RES',
};

test('cases de départ : la précoche du serveur seulement, sur les 5 formulaires réels', async (t) => {
  const v = await load(t); if (!v) return;
  for (const [formId, key] of Object.entries(FORMS)) {
    const tpl = templateByKey(key);
    const fields = fixtureFields(formId);
    const bindings = P.bindTemplate(tpl, fields);
    // Même forme que monitoring.repository.formTemplate : élément + suggestion (bindItem).
    const items = tpl.items.map((it, i) => ({ ...it, suggestion: bindings[i], existing: null, taken: null }));
    const rows = v.initialRows(items);
    const names = new Set(fields.map((f) => f.name));
    const payload = v.checkedPayload(items, rows, names);
    const proposed = P.proposedSelection(bindings);
    // « Créer » sans rien toucher = « Créer les N indicateurs proposés » (proposed: true) : mêmes éléments.
    assert.deepEqual(payload.map((p) => p.code), proposed.map((p) => p.code), formId);
    for (const it of items) {
      const on = rows[it.code].on;
      assert.equal(on, it.suggestion.preselect, `${formId} ${it.code}`);
      if (it.suggestion.subtable) assert.equal(on, false, `${formId} ${it.code} : sous-table jamais précochée`);
      if (it.suggestion.issues.includes('type')) assert.equal(on, false, `${formId} ${it.code} : type incompatible jamais précoché`);
    }
    assert.ok(payload.length > 0, formId);
  }
});

test('cases de départ : jamais un élément déjà créé ni un code pris ; la variable affichée est celle de l\'indicateur créé', async (t) => {
  const v = await load(t); if (!v) return;
  const sug = { field: 'q1', positiveValue: '1', preselect: true, issues: [] };
  const rows = v.initialRows([
    { code: 'A', agg: 'percent_yes', suggestion: sug, existing: { id: 'x', sourceField: 'old_q', positiveValue: '2' } },
    { code: 'B', agg: 'percent_yes', suggestion: sug, taken: { id: 'y', code: 'B', label: 'Manuel' } },
    { code: 'C', agg: 'percent_yes', suggestion: { ...sug, preselect: false } },
    { code: 'D', agg: 'mean', suggestion: { field: null, positiveValue: null, preselect: false } },
  ]);
  assert.deepEqual(rows.A, { on: false, field: 'old_q', positive: '2' });
  assert.equal(rows.B.on, false);
  assert.deepEqual(rows.C, { on: false, field: 'q1', positive: '1' });
  assert.deepEqual(rows.D, { on: false, field: '', positive: '' });
});

test('« Créer » envoie exactement les lignes cochées à l\'écran (même règle que la case)', async (t) => {
  const v = await load(t); if (!v) return;
  const names = new Set(['q1', 'q2', 'q3']);
  const items = [
    { code: 'A', agg: 'percent_yes' },
    { code: 'B', agg: 'percent_value' },        // « % = valeur » sans valeur : non cochable
    { code: 'C', agg: 'mean' },
    { code: 'D', agg: 'percent_yes' },          // variable inconnue de la fiche
    { code: 'E', agg: 'percent_yes', existing: { id: 'e' } }, // déjà créé : verrouillé
    { code: 'F', agg: 'percent_yes' },          // non coché
  ];
  const rows = {
    A: { on: true, field: 'q1', positive: ' 1 ' },
    B: { on: true, field: 'q2', positive: '' },
    C: { on: true, field: 'q3', positive: '' },
    D: { on: true, field: 'zz', positive: '1' },
    E: { on: true, field: 'q1', positive: '1' },
    F: { on: false, field: 'q1', positive: '1' },
  };
  assert.deepEqual(v.checkedPayload(items, rows, names), [
    { code: 'A', sourceField: 'q1', positiveValue: '1' },
    { code: 'C', sourceField: 'q3', positiveValue: null },
  ]);
  assert.deepEqual(items.map((it) => v.rowSelectable(it, rows[it.code], names).reason), [null, 'positive_required', null, 'unknown_field', 'locked', null]);
  assert.deepEqual(items.map((it) => v.isChecked(it, rows[it.code], names)), [true, false, true, false, false, false]);
  assert.equal(v.rowSelectable({ code: 'G', agg: 'mean' }, { on: true, field: '' }, names).reason, 'no_field');
  // La valeur choisie part telle qu'affichée : « 1|2 » reste « 1|2 ».
  assert.equal(v.checkedPayload([{ code: 'B', agg: 'percent_value' }], { B: { on: true, field: 'q2', positive: '1|2' } }, names)[0].positiveValue, '1|2');
});

test('aucun code nu à l\'écran : avertissements, défauts et types ont des mots, un code inconnu un libellé générique', async (t) => {
  const v = await load(t); if (!v) return;
  assert.equal(v.warningLabel('base'), 'Base : toutes les visites (question obligatoire)');
  assert.equal(v.warningLabel('groupe'), 'Question d\'un sous-tableau : pas encore importée');
  assert.match(v.warningLabel('sens'), /^Sens à confirmer/);
  assert.equal(v.warningLabel('nouveau_code'), 'Avertissement du modèle : à vérifier');
  assert.match(v.issueLabel('type'), /incompatible/);
  assert.match(v.issueLabel('positive'), /absente de la liste/);
  assert.equal(v.issueLabel('autre'), 'Variable à vérifier');
  // Chaque avertissement du catalogue et chaque défaut que bindItem peut rendre a son libellé.
  const { CATALOG } = require('../src/modules/monitoring/indicatorTemplates');
  const warnings = new Set(CATALOG.activities.flatMap((a) => a.items.flatMap((i) => i.warnings || [])));
  for (const w of warnings) assert.ok(v.WARNING_LABEL[w], `avertissement sans libellé : ${w}`);
  for (const x of ['type', 'positive']) assert.ok(v.ISSUE_LABEL[x], x);
  assert.equal(v.typeText('select_multiple', tr), 'choix multiples');
  assert.equal(v.typeText('select_one Yesno', tr), 'choix unique');
  assert.equal(v.typeText('geoshape', tr), 'geoshape');
  assert.equal(v.typeText(null, tr), 'type inconnu');
  assert.equal(v.driftKeyLabel('agg'), 'méthode');
  assert.equal(v.driftKeyLabel('autre'), 'définition');
  assert.equal(v.driftValue('agg', 'percent_value', tr), '% = valeur');
  assert.equal(v.driftValue('direction', 'lower_better', tr), 'plus bas = mieux');
  assert.equal(v.driftValue('naValues', ['888', '9999'], tr), '888, 9999');
  assert.equal(v.driftValue('positiveValue', null, tr), '—');
});

test('à mettre à jour : bloqué quand la variable du modèle manque, sinon la modification proposée part telle quelle', async (t) => {
  const v = await load(t); if (!v) return;
  const gd = templateByKey('GD');
  // GD_WH_PALLETS : la variable du modèle (l'option « 1 » de l'empilage) n'est pas encore dans les données.
  const pallets = gd.items.find((i) => i.code === 'GD_WH_PALLETS');
  const drift = P.templateDrift(pallets, { field: null, naValues: [] }, {
    label: 'Produits sur palettes', sourceField: 'MOWhStackProp', agg: 'percent_yes', positiveValue: '1', naValues: [], target: null, direction: 'higher_better',
  });
  const blocked = v.driftState({ existing: { id: 'i1', drift } });
  assert.equal(blocked.blocked, true);
  assert.equal(blocked.updatable, false); // jamais méthode / valeur du modèle sur l'ANCIENNE variable
  // MIARO_NO_DELAY : la variable du modèle existe → mise à jour d'un clic, patch du serveur inchangé.
  const stunt = templateByKey('STUNT');
  const item = stunt.items.find((i) => i.code === 'MIARO_NO_DELAY');
  const binding = P.bindTemplate({ items: [item] }, [{ name: 'r_no_delay', type: 'select_one', choices: [{ value: '0', label: 'Non' }, { value: '1', label: 'Oui' }] }])[0];
  const d2 = P.templateDrift(item, binding, { label: item.formerly[0].label, sourceField: 'risk_delay', agg: item.formerly[0].agg, positiveValue: item.formerly[0].positiveValue == null ? null : String(item.formerly[0].positiveValue), naValues: [], target: null, direction: item.direction });
  const ok = v.driftState({ existing: { id: 'i2', drift: d2 } });
  assert.equal(ok.blocked, false);
  assert.equal(ok.updatable, true);
  assert.equal(ok.patch, d2.patch);
  assert.equal(ok.patch.sourceField, 'r_no_delay');
  assert.equal(v.driftState({ existing: { id: 'i3', drift: null } }), null);
  assert.equal(v.driftState({ existing: null }), null);
});

test('refus de « Créer » qui nomme l\'élément : retrouvé pour sa ligne ; un autre refus ne l\'est pas', async (t) => {
  const v = await load(t); if (!v) return;
  const err = { status: 400, message: '…', details: { code: 'type_mismatch', item: 'GD_WH_PALLETS', field: 'MOWhStackPall', type: 'select_multiple', agg: 'percent_yes' } };
  assert.deepEqual(v.itemError(err), { code: 'type_mismatch', item: 'GD_WH_PALLETS', field: 'MOWhStackPall', type: 'select_multiple', agg: 'percent_yes' });
  assert.equal(v.itemError({ status: 400, message: 'Variable introuvable' }), null);
  assert.equal(v.itemError({ status: 400, details: { code: 'no_template' } }), null);
  assert.equal(v.itemError(null), null);
});

test('couverture affichée en pourcentage entier', async (t) => {
  const v = await load(t); if (!v) return;
  assert.equal(v.coveragePct(0.6667), '67');
  assert.equal(v.coveragePct(null), '0');
});
