/**
 * Carte du modèle d'indicateurs, côté interface (web/src/lib/templateProposal.js,
 * fonctions pures ; le front n'a pas de suite de tests propre, elles sont testées ici),
 * et quelques contrôles de SOURCE des composants qui les utilisent. Ce qui est verrouillé :
 *  - cases de départ = SEULEMENT la précoche du serveur (indicatorProposals.bindTemplate),
 *    vérifié sur les 5 formulaires réels : jamais une sous-table, jamais un type incompatible ;
 *  - « Créer » envoie exactement les lignes cochées à l'écran (même règle que la case), contrôlées
 *    sur la variable ACTUELLE de la ligne (type, valeur comptée dans sa liste — jumeaux du serveur) ;
 *  - un rechargement garde les cases et variables saisies ; les filtres se décident sur l'état chargé ;
 *  - les badges se somment au total ; un filtre vide revient à « Tous » ;
 *  - aucun code nu à l'écran, refus du serveur dans la langue de l'écran ;
 *  - indicateur créé depuis le modèle : corrections (en lot) ≠ différences (ligne seule) ; bloqué
 *    quand la variable du modèle manque, est incompatible ou seulement ressemblante, avec la raison ;
 *  - états vides : « Partez du modèle » seulement s'il y en a un ; un chargement échoué n'est jamais
 *    « aucun modèle ne correspond ».
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const P = require('../src/modules/monitoring/indicatorProposals');
const { templateByKey, CATALOG } = require('../src/modules/monitoring/indicatorTemplates');
const FIXTURE = require('./helpers/xlsformTemplateVars.json');

const WEB = path.join(__dirname, '../../web/src');
const file = path.join(WEB, 'lib/templateProposal.js');
const load = async (t) => {
  if (!fs.existsSync(file)) { t.skip('web/ absent'); return null; }
  return import(pathToFileURL(file).href);
};
const fill = (s, p) => (p ? s.replace(/\{(\w+)\}/g, (_, k) => String(p[k])) : s);
const tr = (s, p) => fill(s, p);
const webSource = (rel) => fs.readFileSync(path.join(WEB, rel), 'utf8');

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
/** Éléments au format de monitoring.repository.formTemplate (élément + suggestion bindItem). */
function cardItems(formId) {
  const tpl = templateByKey(FORMS[formId]);
  const fields = fixtureFields(formId);
  const bindings = P.bindTemplate(tpl, fields);
  return { fields, items: tpl.items.map((it, i) => ({ ...it, suggestion: bindings[i], existing: null, taken: null })), bindings };
}
const byName = (fields) => new Map(fields.map((f) => [f.name, f]));

test('cases de départ : la précoche du serveur seulement, sur les 5 formulaires réels', async (t) => {
  const v = await load(t); if (!v) return;
  for (const formId of Object.keys(FORMS)) {
    const { fields, items, bindings } = cardItems(formId);
    const rows = v.initialRows(items);
    const payload = v.checkedPayload(items, rows, byName(fields));
    // « Créer » sans rien toucher = « Créer les N indicateurs proposés » (proposed: true) : mêmes éléments.
    assert.deepEqual(payload.map((p) => p.code), P.proposedSelection(bindings).map((p) => p.code), formId);
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
  assert.deepEqual(rows.A, { on: false, field: 'old_q', positive: '2', locked: true });
  assert.deepEqual([rows.B.on, rows.B.locked], [false, true]);
  assert.deepEqual(rows.C, { on: false, field: 'q1', positive: '1' });
  assert.deepEqual(rows.D, { on: false, field: '', positive: '' });
});

const YN = [{ value: '0', label: 'Non' }, { value: '1', label: 'Oui' }];
const OUINON = [{ value: 'oui', label: 'Oui' }, { value: 'non', label: 'Non' }];

test('« Créer » envoie exactement les lignes cochées à l\'écran, contrôlées sur la variable ACTUELLE (C19)', async (t) => {
  const v = await load(t); if (!v) return;
  const fields = byName([
    { name: 'q1', type: 'select_one', choices: YN }, { name: 'q2', type: 'select_one', choices: YN }, { name: 'q3', type: 'integer', choices: [] },
    { name: 'qb', type: 'select_one', choices: OUINON }, { name: 'qm', type: 'select_multiple', choices: YN },
  ]);
  const items = [
    { code: 'A', agg: 'percent_yes' },
    { code: 'B', agg: 'percent_value' },        // « % = valeur » sans valeur : non cochable
    { code: 'C', agg: 'mean' },
    { code: 'D', agg: 'percent_yes' },          // variable inconnue de la fiche
    { code: 'E', agg: 'percent_yes', existing: { id: 'e' } }, // déjà créé : verrouillé
    { code: 'F', agg: 'percent_yes' },          // non coché
    { code: 'G', agg: 'percent_yes' },          // valeur « 1 » de l'ancienne variable sur une liste oui/non
    { code: 'H', agg: 'percent_yes' },          // parent d'un choix multiple : type incompatible
  ];
  const rows = {
    A: { on: true, field: 'q1', positive: ' 1 ' },
    B: { on: true, field: 'q2', positive: '' },
    C: { on: true, field: 'q3', positive: '' },
    D: { on: true, field: 'zz', positive: '1' },
    E: { on: true, field: 'q1', positive: '1' },
    F: { on: false, field: 'q1', positive: '1' },
    G: { on: true, field: 'qb', positive: '1' },
    H: { on: true, field: 'qm', positive: '1' },
  };
  assert.deepEqual(v.checkedPayload(items, rows, fields), [
    { code: 'A', sourceField: 'q1', positiveValue: '1' },
    { code: 'C', sourceField: 'q3', positiveValue: null },
  ]);
  assert.deepEqual(items.map((it) => v.rowSelectable(it, rows[it.code], fields).reason),
    [null, 'positive_required', null, 'unknown_field', 'locked', null, 'positive_not_in_list', 'type']);
  assert.deepEqual(items.map((it) => v.isChecked(it, rows[it.code], fields)), [true, false, true, false, false, false, false, false]);
  assert.equal(v.rowSelectable({ code: 'Z', agg: 'mean' }, { on: true, field: '' }, fields).reason, 'no_field');
  // « % de oui » sans valeur comptée : accepté comme dans l'éditeur (R8) — les « oui » usuels sont comptés.
  assert.equal(v.rowSelectable({ code: 'Y', agg: 'percent_yes' }, { on: true, field: 'q1', positive: '' }, fields).reason, null);
  assert.equal(v.noDefaultYes(fields.get('q1')), false);
  assert.equal(v.noDefaultYes({ choices: [{ value: '50' }, { value: '100' }] }), true); // avertissement seulement
  // Valeur comptée aussi hors base (R1, R7) : jamais cochable (le serveur refuserait tout le lot).
  const dk = { name: 'qd', type: 'select_one', choices: [...YN, { value: '888', label: 'Ne sait pas' }, { value: '999', label: 'Autre' }] };
  const fm = new Map([...fields, ['qd', dk], ['qt', { name: 'qt', type: 'string', choices: [] }]]);
  const nItem = { code: 'N', agg: 'percent_yes', naValues: ['888', '999'] };
  assert.deepEqual(v.keptNaValues(nItem, dk), ['888']); // « Autre » est une réponse : jamais hors base
  assert.equal(v.rowSelectable(nItem, { on: true, field: 'qd', positive: '888' }, fm).reason, 'positive_is_na');
  assert.equal(v.rowSelectable(nItem, { on: true, field: 'qd', positive: '1|888' }, fm).reason, 'positive_is_na');
  assert.equal(v.rowSelectable(nItem, { on: true, field: 'qd', positive: '999' }, fm).reason, null);
  assert.equal(v.rowSelectable({ ...nItem, agg: 'percent_value' }, { on: true, field: 'qt', positive: '888' }, fm).reason, 'positive_is_na'); // sans liste : ceux du modèle
  // Sans liste connue (nombre entier) : rien à choisir, la ligne reste cochable.
  assert.equal(v.rowSelectable({ code: 'Y', agg: 'percent_yes' }, { on: true, field: 'q3', positive: '' }, fields).reason, null);
  // Défauts affichés pour la variable ACTUELLE (jamais ceux de la variable proposée au chargement).
  assert.deepEqual(v.fieldIssues(items[6], fields.get('qb'), '1'), ['positive']);
  assert.deepEqual(v.fieldIssues(items[7], fields.get('qm'), '1'), ['type']);
  assert.deepEqual(v.fieldIssues(items[0], fields.get('q1'), '1'), []);
  // La valeur choisie part telle qu'affichée : « 1|0 » reste « 1|0 ».
  assert.equal(v.checkedPayload([{ code: 'B', agg: 'percent_value' }], { B: { on: true, field: 'q2', positive: '1|0' } }, fields)[0].positiveValue, '1|0');
});

test('changement de variable (C19) : la valeur comptée suit la NOUVELLE liste, jamais celle de l\'ancienne', async (t) => {
  const v = await load(t); if (!v) return;
  const yes = { agg: 'percent_yes', positiveValue: '1' };
  assert.equal(v.positiveForField(yes, { choices: OUINON }, '1'), 'oui');          // « Oui » de la nouvelle liste
  assert.equal(v.positiveForField(yes, { choices: YN }, '0'), '0');                // valeur choisie, présente : gardée
  assert.equal(v.positiveForField(yes, { choices: [{ value: 'a', label: 'A' }] }, '1'), ''); // rien d'applicable : à choisir
  assert.equal(v.positiveForField(yes, undefined, '1'), '1');                      // variable inconnue (saisie en cours) : inchangée
  const val = { agg: 'percent_value', positiveValue: '0' };
  assert.equal(v.positiveForField(val, { choices: OUINON }, '0'), '');             // « % = valeur » : jamais le « Oui »
  assert.equal(v.positiveForField(val, { choices: YN }, 'oui'), '0');              // la valeur du modèle si la liste la porte
  assert.equal(v.positiveForField({ agg: 'mean', positiveValue: null }, { choices: YN }, ''), '');
});

test('jumeaux du serveur (C19) : type et valeur comptée contrôlés comme bindItem, sur les 5 formulaires réels', async (t) => {
  const v = await load(t); if (!v) return;
  for (const agg of ['percent_yes', 'percent_value', 'mean', 'sum', 'count']) {
    for (const type of ['select_one', 'select_multiple', 'option', 'calculate', 'integer', 'decimal', 'text', 'range', 'date', '', 'numeric', 'string', null]) {
      assert.equal(v.typeIssue(agg, type), P.typeIssue(agg, type), `${agg} ${type}`);
    }
  }
  let compared = 0;
  for (const formId of Object.keys(FORMS)) {
    const { fields, items } = cardItems(formId);
    const fm = byName(fields);
    for (const it of items) {
      if (!it.suggestion.field) continue;
      assert.deepEqual(v.fieldIssues(it, fm.get(it.suggestion.field), it.suggestion.positiveValue), it.suggestion.issues, `${formId} ${it.code}`);
      compared += 1;
    }
  }
  assert.ok(compared > 300, `${compared}`);
});

test('rechargement hors « Créer » (C18) : cases et variables saisies gardées ; seuls les éléments devenus créés repartent', async (t) => {
  const v = await load(t); if (!v) return;
  const sug = { field: 'q1', positiveValue: '1', preselect: true, issues: [] };
  const items = [{ code: 'A', suggestion: sug }, { code: 'B', suggestion: sug }, { code: 'C', suggestion: sug }];
  const prev = { A: { on: false, field: 'q1', positive: '1' }, B: { on: true, field: 'q9', positive: '0' }, C: { on: false, field: 'q1', positive: '1' } };
  const after = [{ code: 'A', suggestion: sug }, { code: 'B', suggestion: sug }, { code: 'C', suggestion: sug, existing: { id: 'c', sourceField: 'q1', positiveValue: '1' } }, { code: 'D', suggestion: sug }];
  const rows = v.mergeRows(prev, after);
  assert.deepEqual(rows.A, prev.A);     // décoché par l'utilisateur : reste décoché
  assert.deepEqual(rows.B, prev.B);     // variable saisie : gardée
  assert.deepEqual(rows.C, { on: false, field: 'q1', positive: '1', locked: true }); // devenu créé : verrouillé
  assert.deepEqual(rows.D, { on: true, field: 'q1', positive: '1' });  // nouvel élément : précoche
  assert.deepEqual(v.mergeRows(null, items), v.initialRows(items));
  // R5 : indicateur SUPPRIMÉ (ou code libéré) — sa ligne portait l'ancienne définition : retour à la précoche.
  const delay = { code: 'X', suggestion: { field: 'r_no_delay', positiveValue: '1', preselect: true, issues: [] } };
  const withOld = v.initialRows([{ ...delay, existing: { id: 'x', sourceField: 'risk_delay', positiveValue: '0' } }]);
  assert.deepEqual(v.mergeRows(withOld, [delay]).X, { on: true, field: 'r_no_delay', positive: '1' });
  const taken = v.initialRows([{ ...delay, taken: { id: 'm', code: 'X', label: 'Manuel' } }]);
  assert.deepEqual(v.mergeRows(taken, [delay]).X, { on: true, field: 'r_no_delay', positive: '1' });
});

test('badges (C22) : une catégorie par élément, la somme fait le total ; « Sans variable » = le filtre du même nom', async (t) => {
  const v = await load(t); if (!v) return;
  for (const formId of Object.keys(FORMS)) {
    const { items } = cardItems(formId);
    const c = v.cardCounts(items);
    assert.equal(c.sure + c.probable + c.a_verifier + c.subtable + c.pending + c.none, items.length, formId);
    assert.equal(v.filterMembers(items, 'missing').size, c.none, formId);
    assert.equal(v.filterMembers(items, 'pending').size, c.pending, formId);
    for (const it of items) if (it.suggestion.subtable) assert.equal(v.rowCategory(it), 'subtable', `${formId} ${it.code}`);
  }
  const gd = v.cardCounts(cardItems('MDG_Process_Monitoring_GD_PREVMA_v2').items);
  assert.ok(gd.pending > 0); // options attendues avec les données : « En attente », plus dans « Sans variable »
});

test('filtres (C17, C24) : décidés sur l\'état chargé — une ligne ne disparaît pas pendant la saisie ; filtre vide → « Tous »', async (t) => {
  const v = await load(t); if (!v) return;
  const items = [
    { code: 'A', suggestion: { field: null, confidence: null, issues: [] } },
    { code: 'B', suggestion: { field: 'q', confidence: 'a_verifier', issues: [] } },
    { code: 'C', suggestion: { field: 'q', confidence: 'sure', issues: [] } },
  ];
  // filterMembers ne reçoit pas les lignes saisies : taper une variable dans A ne la sort pas de « Sans variable ».
  assert.equal(v.filterMembers.length, 2);
  assert.deepEqual([...v.filterMembers(items, 'missing')], ['A']);
  assert.deepEqual([...v.filterMembers(items, 'check')], ['B']);
  // Ligne signalée par un refus : reste dans « À vérifier » (jusqu'au prochain envoi), même corrigée.
  assert.deepEqual([...v.filterMembers(items, 'check', { rowErrors: { C: true } })], ['B', 'C']);
  const none = { pending: 0, corrections: 0, differences: 0 };
  assert.deepEqual(v.availableFilters(none), ['all', 'check', 'missing']);
  assert.deepEqual(v.availableFilters({ pending: 2, corrections: 1, differences: 1 }), ['all', 'check', 'missing', 'pending', 'update', 'diff']);
  assert.equal(v.effectiveFilter('update', v.availableFilters(none)), 'all'); // tout mis à jour : plus de bouton → « Tous »
  assert.equal(v.effectiveFilter('check', v.availableFilters(none)), 'check');
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

const MIARO_OLD = { label: 'Absence de retard', sourceField: 'risk_delay', agg: 'percent_value', positiveValue: '0', naValues: [], target: null, direction: 'higher_better' };

test('à mettre à jour : corrections d\'un clic (et en lot), différences à la ligne seulement (C14)', async (t) => {
  const v = await load(t); if (!v) return;
  const item = templateByKey('STUNT').items.find((i) => i.code === 'MIARO_NO_DELAY');
  const fields = [{ name: 'risk_delay', type: 'select_one', choices: YN }, { name: 'r_no_delay', type: 'select_one', choices: YN }];
  const binding = P.bindTemplate({ items: [item] }, fields)[0];
  const drift = P.templateDrift(item, binding, MIARO_OLD, { fields });
  const ok = v.driftState({ ...item, suggestion: binding, existing: { id: 'i2', drift } });
  assert.equal(ok.blocked, null);
  assert.equal(ok.updatable, true);
  assert.deepEqual(ok.patch, drift.patch);
  assert.equal(ok.patch.sourceField, 'r_no_delay');
  // Modification de l'utilisateur (sens) : information, jamais dans « Tout mettre à jour ».
  const gd = templateByKey('GD').items.find((i) => i.code === 'GD_DPMC_TRAINED');
  const gf = [{ name: 'MODPMCMemb', type: 'select_one', choices: [...YN, { value: '888', label: 'Ne sait pas' }] }];
  const gb = P.bindTemplate({ items: [gd] }, gf)[0];
  const diff = P.templateDrift(gd, gb, { label: gd.label, sourceField: 'MODPMCMemb', agg: 'percent_yes', positiveValue: '1', naValues: ['888'], target: null, direction: 'lower_better' }, { fields: gf });
  const ds = v.driftState({ ...gd, suggestion: gb, existing: { id: 'i3', drift: diff } });
  assert.deepEqual([ds.kind, ds.updatable, ds.applicable], ['difference', false, true]);
  assert.deepEqual(ds.fullPatch, { direction: 'higher_better' });
  const counts = v.cardCounts([{ ...gd, suggestion: gb, existing: { id: 'i3', drift: diff } }, { ...item, suggestion: binding, existing: { id: 'i2', drift } }]);
  assert.deepEqual([counts.corrections, counts.differences, counts.updatable], [1, 1, 1]);
  assert.equal(v.driftState({ existing: { id: 'i4', drift: null } }), null);
  assert.equal(v.driftState({ existing: null }), null);
});

test('mise à jour bloquée (C16, C21) : jamais sur une variable seulement ressemblante ; la raison dite, sans « pas encore » si elle est là', async (t) => {
  const v = await load(t); if (!v) return;
  const item = templateByKey('STUNT').items.find((i) => i.code === 'MIARO_NO_DELAY');
  // Serveur : libellé proche seulement → bloqué « unverified ».
  const lf = [{ name: 'risk_delay', type: 'select_one', choices: YN }, { name: 'q_retard', label: 'Pas de retard au démarrage de la distribution', type: 'select_one', choices: YN }];
  const lb = P.bindTemplate({ items: [item] }, lf)[0];
  const unv = v.driftState({ ...item, suggestion: lb, existing: { id: 'a', drift: P.templateDrift(item, lb, MIARO_OLD, { fields: lf }) } });
  assert.deepEqual([unv.blocked.reason, unv.updatable, unv.applicable], ['unverified', false, false]);
  assert.match(v.blockedText(unv.blocked, tr), /ressemble/);
  // Par prudence, même une modification de variable envoyée par le serveur vers une variable « à vérifier » est bloquée.
  const forged = { kind: 'definition', changes: [{ key: 'sourceField', from: 'risk_delay', to: 'q_retard', origin: 'correction' }], patch: { sourceField: 'q_retard' }, fullPatch: { sourceField: 'q_retard' }, blocked: null };
  const def = v.driftState({ ...item, suggestion: { ...lb, confidence: 'a_verifier' }, existing: { id: 'b', drift: forged } });
  assert.deepEqual([def.blocked.reason, def.updatable, def.patch], ['unverified', false, {}]);
  // Présente mais de type incompatible : dit le défaut, jamais « après l'import des données ».
  const tf = [{ name: 'risk_delay', type: 'select_one', choices: YN }, { name: 'r_no_delay', type: 'select_multiple', choices: YN }];
  const tb = P.bindTemplate({ items: [item] }, tf)[0];
  const inc = v.driftState({ ...item, suggestion: tb, existing: { id: 'c', drift: P.templateDrift(item, tb, MIARO_OLD, { fields: tf }) } });
  assert.equal(inc.blocked.reason, 'incompatible');
  const incText = v.blockedText(inc.blocked, tr);
  assert.match(incText, /ne convient pas \(Type de la variable incompatible avec la méthode\)/);
  assert.doesNotMatch(incText, /pas encore/);
  assert.equal(v.blockedTargetText(inc.blocked, tr), 'r_no_delay (incompatible)');
  // Absente : « pas encore dans les données » seulement si l'option arrive avec elles.
  assert.match(v.blockedText({ reason: 'missing', field: 'X/1', pendingData: true }, tr), /pas encore dans les données/);
  assert.match(v.blockedText({ reason: 'missing', field: 'X', pendingData: false }, tr), /n'existe pas dans cette fiche/);
});

test('refus du serveur dans la langue de l\'écran (C20) : modèle, création, mise à jour', async (t) => {
  const v = await load(t); if (!v) return;
  const enFile = path.join(WEB, 'locales/en.js');
  const en = (await import(pathToFileURL(enFile).href)).default;
  const trEn = (s, p) => fill(en[s] ?? `<<${s}>>`, p);
  const cases = [
    { status: 400, message: 'fr', details: { code: 'type_mismatch', item: 'X', field: 'q', type: 'select_multiple', agg: 'percent_yes' } },
    { status: 400, message: 'fr', details: { code: 'positive_not_in_list', item: 'X', field: 'q', value: '7' } },
    { status: 400, message: 'fr', details: { code: 'positive_required', item: 'X' } },
    { status: 400, message: 'Indicateur « X » absent du modèle', details: { code: 'unknown_item', value: 'X', template: 'GD' } },
    { status: 400, message: 'Un même indicateur est envoyé deux fois.', details: { code: 'duplicate_item', value: 'X' } },
    { status: 409, message: 'fr', details: { code: 'drift_changed' } },
    { status: 404, message: 'Indicateur introuvable', details: { code: 'indicator_not_found' } },
    { status: 400, message: 'fr', details: { code: 'positive_is_na', item: 'X', value: '888' } },
    { status: 400, message: 'Variable « x » introuvable dans cette fiche', details: { code: 'unknown_variable', name: 'x', suggestion: 'y' } },
    { status: 400, message: 'fr', details: { code: 'activity_template', activity: 'School meal activities', template: 'SMP' } },
    { status: 400, message: 'fr', details: { code: 'unknown_template' } },
    { status: 400, message: 'fr', details: { code: 'no_template' } },
    { status: 409, message: 'Un indicateur avec ce code existe déjà', details: { code: 'duplicate_code', value: 'C1' } },
  ];
  for (const e of cases) {
    const text = v.templateErrorText(e, trEn, { template: 'ZZZ' });
    assert.ok(text && !/<<|introuvable|existe déjà|absent du modèle|deux fois|^fr$/.test(text), `${e.details.code} → ${text}`);
  }
  assert.equal(v.templateErrorText({ message: 'Serveur injoignable.' }, trEn), 'Serveur injoignable.'); // sans code : le message reçu
  const ie = v.itemError(cases[1]);
  assert.deepEqual([ie.item, ie.code, ie.value], ['X', 'positive_not_in_list', '7']);
  assert.equal(v.itemError({ status: 400, details: { code: 'no_template' } }), null);
  // Carte périmée : l'écran propose de recharger (modèle changé, indicateur changé ou supprimé ailleurs).
  for (const code of ['unknown_item', 'duplicate_item', 'drift_changed', 'indicator_not_found']) assert.equal(v.needsReload({ details: { code } }), true, code);
  assert.equal(v.needsReload({ details: { code: 'type_mismatch' } }), false);
  assert.equal(v.itemError(null), null);
});

test('états vides (C25, C26) : « Partez du modèle » seulement s\'il y en a un ; un échec de chargement n\'est jamais « aucun modèle »', async (t) => {
  const v = await load(t); if (!v) return;
  assert.equal(v.configEmptyKey({ templateShown: false, above: true }), null);
  assert.match(v.configEmptyKey({ templateShown: true, above: true }), /ci-dessus/);
  assert.match(v.configEmptyKey({ templateShown: true, above: false }), /ci-dessous/);
  assert.equal(v.proposalCtaState(undefined), 'loading');
  assert.equal(v.proposalCtaState({ failed: 'Erreur 500' }), 'failed');
  assert.equal(v.proposalCtaState(null), 'failed');
  assert.equal(v.proposalCtaState({ template: null, summary: null }), 'none');
  assert.equal(v.proposalCtaState({ template: { key: 'SMP' }, summary: { proposed: 0 } }), 'none');
  assert.equal(v.proposalCtaState({ template: { key: 'SMP' }, summary: { proposed: 3 }, source: 'proposal', proposal: { ambiguous: true } }), 'ambiguous');
  assert.equal(v.proposalCtaState({ template: { key: 'SMP' }, summary: { proposed: 3 }, source: 'activity' }), 'ready');
});

test('composants : ils passent par ces règles (source) — filtres, rechargement, refus traduits, états vides, retour à la ligne', (t) => {
  if (!fs.existsSync(file)) { t.skip('web/ absent'); return; }
  const card = webSource('pages/monitoring/TemplateBindingCard.jsx');
  assert.match(card, /filterMembers\(items, activeFilter/);                 // C17 : état chargé
  assert.doesNotMatch(card, /filter === 'missing'\) return !r\.field/);
  assert.match(card, /mergeRows\(prev, r\.template\?\.items\)/);            // C18
  assert.match(card, /load\(undefined, \{ reset: true \}\)/);               // reset après « Créer » seulement
  assert.match(card, /positiveForField\(it, fieldsByName\.get\(v\), r\.positive\)/); // C19
  assert.match(card, /fieldIssues\(it, field, r\.positive\)/);
  assert.doesNotMatch(card, /errors\[it\.code\] = e\.message/);              // C20
  // R6 / T3 : UNE requête pour le lot (jamais une par indicateur), les modifications montrées comme `expected`.
  assert.match(card, /api\.monTemplateUpdates\(form\.id, \{/);
  assert.match(card, /items: sent\.map\(\(\{ it, patch \}\) => \(\{ id: it\.existing\.id, expected: patch \}\)\)/);
  assert.doesNotMatch(card, /monUpdateIndicator|monTemplateUpdate\(/);
  const updateFn = card.slice(card.indexOf('async function update(list'), card.indexOf('// « Tout mettre à jour »'));
  assert.doesNotMatch(updateFn, /for \([^)]*\) \{\s*[^}]*await api\./, 'aucun appel réseau dans une boucle');
  // T2 / T5 : le motif d'un refus est rendu HORS du bloc d'écart (la ligne peut ne plus en avoir après le rechargement).
  const rowFn = card.slice(card.indexOf('function TemplateRow('));
  const errAt = rowFn.indexOf('tpl-update-error');
  const driftAt = rowFn.indexOf('{ds && (');
  assert.ok(errAt > 0 && driftAt > 0 && errAt < driftAt, 'refus de mise à jour affiché avant / hors du bloc {ds && …}');
  assert.equal((rowFn.match(/driftError &&/g) || []).length, 1);
  assert.match(card, /keptNaValues\(it, field\)/);                        // R1 / R7 : hors base non choisissables
  assert.match(card, /effectiveFilter\(filter, filters\)/);                 // C24
  assert.match(card, /cardCounts\(items\)/);                                // C22
  assert.match(card, /blockedText\(ds\.blocked, tr\)/);                     // C21
  const cta = webSource('pages/monitoring/TemplateProposal.jsx');
  assert.match(cta, /proposalCtaState\(data\)/);                            // C26
  assert.doesNotMatch(cta, /catch\(\(\) => \{ if \(alive\) setData\(null\)/);
  assert.match(cta, /templateErrorText\(e, tr/);
  const page = webSource('pages/monitoring/ProcessMonitoringPage.jsx');
  assert.match(page, /configEmptyKey\(\{ templateShown, above: templateAbove \}\)/); // C25
  assert.match(page, /onLoaded=\{\(info\) => setTemplateShown\(Boolean\(info\.template\)\)\}/);
  // C23 : styles.css met les méta des tables en nowrap ; la carte du modèle laisse ses drapeaux passer à la ligne.
  assert.match(webSource('styles.css'), /\.table td \.site-meta \{ white-space: nowrap;/);
  const css = webSource('pages/monitoring/templates.css');
  assert.match(css, /table\.tpl-table td \.site-meta:not\(\.tpl-field-label\) \{ white-space: normal; \}/);
  // … et le libellé tronqué de la variable ne dépasse pas la largeur du champ (sinon la colonne s'élargit à 300 px).
  assert.match(css, /table\.tpl-table \.tpl-field-label \{ max-width: 230px; \}/);
});

test('couverture affichée en pourcentage entier', async (t) => {
  const v = await load(t); if (!v) return;
  assert.equal(v.coveragePct(0.6667), '67');
  assert.equal(v.coveragePct(null), '0');
});

test('jumeaux (R1, R7, R8) : une ligne est cochable côté carte SI ET SEULEMENT SI le serveur l\'accepte, sur les 5 formulaires réels', async (t) => {
  const v = await load(t); if (!v) return;
  const { indicatorFromItem } = require('../src/modules/monitoring/indicatorTemplates');
  let compared = 0;
  for (const formId of Object.keys(FORMS)) {
    const tpl = templateByKey(FORMS[formId]);
    const { fields, items } = cardItems(formId);
    const fm = byName(fields);
    items.forEach((it, i) => {
      const field = fm.get(it.suggestion.field);
      if (!field || !['percent_yes', 'percent_value'].includes(it.agg)) return;
      for (const positive of ['', ...(field.choices || []).map((c) => String(c.value))]) {
        const client = v.rowSelectable(it, { on: true, field: field.name, positive }, fm).ok;
        // Ce que applyTemplate fait de la ligne : bindItem (hors base de la liste), indicatorFromItem, templateRowIssue.
        const kept = P.bindItem(it, { positiveValue: positive || null, confidence: null }, field).naValues;
        const row = indicatorFromItem(tpl, it, { sourceField: field.name, positiveValue: positive || null, naValues: kept }, i);
        const server = P.templateRowIssue(it, field, row) === null;
        assert.equal(client, server, `${formId} ${it.code} « ${positive} »`);
        compared += 1;
      }
    });
  }
  assert.ok(compared > 500, `${compared}`);
});

test('« oui » par défaut (R8) : même ensemble que le calcul (monitoringMath.isYes sans valeur comptée)', async (t) => {
  const v = await load(t); if (!v) return;
  const { isYes } = require('../src/modules/monitoring/monitoringMath');
  for (const s of ['1', 'oui', 'Oui', 'yes', 'YES', 'true', 'vrai', 'y', 'o', '0', 'non', 'no', '2', '888', 'sélectionné', '']) {
    assert.equal(v.DEFAULT_YES.has(s.trim().toLowerCase()), s !== '' && isYes(s, null, null) === 1, s);
  }
});
