const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

// Fonctions pures de l'interface des indicateurs (web/src/lib/indicatorView.js) :
// le front n'a pas de suite de tests propre, elles sont testées ici.
const file = path.join(__dirname, '../../web/src/lib/indicatorView.js');
const load = async (t) => {
  if (!fs.existsSync(file)) { t.skip('web/ absent'); return null; }
  return import(pathToFileURL(file).href);
};

test('Réalisé / Cible : un % face à sa cible, jamais la valeur répétée sous une autre forme', async (t) => {
  const v = await load(t); if (!v) return;
  // Avant : « 21.2 % » à côté de « 21 % » (la valeur et son arrondi) alors que la cible est 90.
  const p = v.progress({ agg: 'percent_yes', value: 21.2, target: 90 });
  assert.equal(p.text, '21.2 %');
  assert.equal(p.targetText, '90 %');
  assert.equal(p.rate, 0.212);
  assert.equal(p.targetRate, 0.9);
  assert.equal(p.pct, undefined);
  const noTarget = v.progress({ agg: 'percent_value', value: 79.5, target: null });
  assert.equal(noTarget.targetText, null);
  assert.equal(noTarget.targetRate, null);
  // Moyenne avec cible : part de la cible atteinte ; sans cible : la valeur seule, sans barre.
  const mean = v.progress({ agg: 'mean', value: 3, target: 4 });
  assert.deepEqual([mean.text, mean.targetText, mean.rate], ['3', '4', 0.75]);
  assert.equal(v.progress({ agg: 'count', value: 12 }).rate, null);
  assert.equal(v.progress({ agg: 'mean', value: null }).has, false);
  // Formatage selon la langue.
  assert.equal(v.progress({ agg: 'percent_yes', value: 21.2, target: 90 }, (n) => String(n).replace('.', ',')).text, '21,2 %');
});

test('brouillon → modification partielle : seules les clés changées sont envoyées', async (t) => {
  const v = await load(t); if (!v) return;
  const ind = { code: 'GD_INFO_SESSION', label: 'Session', module: 'D4', sourceField: 'MOInfoSession', agg: 'percent_yes', positiveValue: '1', naValues: ['9999'], target: null, direction: 'higher_better', scored: true, active: true };
  const orig = v.toDraft(ind);
  assert.deepEqual(v.draftPatch(orig, { ...orig }), {});
  assert.deepEqual(v.draftPatch(orig, { ...orig, target: '90' }), { target: 90 });
  assert.deepEqual(v.draftPatch(orig, { ...orig, code: 'GD_INFO_2', module: '' }), { code: 'GD_INFO_2', module: null });
  assert.deepEqual(v.draftPatch(orig, { ...orig, positive: ['1', '2'] }), { positiveValue: '1|2' });
  // Passer en moyenne sans toucher aux valeurs comptées : elles ne sont pas effacées.
  assert.deepEqual(v.draftPatch(orig, { ...orig, agg: 'mean' }), { agg: 'mean' });
  assert.deepEqual(v.draftPatch(orig, { ...orig, naValues: [] }), { naValues: [] });
  // Création : définition complète, « 80,5 » lu comme 80,5.
  const body = v.draftBody({ ...v.toDraft(null), code: ' A ', label: 'Lib', sourceField: 'q', target: '80,5', positive: ['1'] });
  assert.deepEqual(body, { code: 'A', label: 'Lib', module: null, sourceField: 'q', agg: 'percent_yes', positiveValue: '1', naValues: [], target: 80.5, direction: 'higher_better', scored: true, active: true });
});

test('contrôles de saisie : mêmes règles que le serveur', async (t) => {
  const v = await load(t); if (!v) return;
  const d = v.toDraft(null);
  assert.deepEqual(Object.keys(v.draftErrors(d)).sort(), ['code', 'label', 'sourceField']);
  const ok = { ...d, code: 'A', label: 'A', sourceField: 'q' };
  assert.deepEqual(v.draftErrors(ok), {});
  assert.ok(v.draftErrors({ ...ok, agg: 'percent_value' }).positive);
  assert.ok(v.draftErrors({ ...ok, target: 'abc' }).target);
  assert.ok(v.draftErrors({ ...ok, positive: ['9999'], naValues: ['9999'] }).naValues);
  assert.deepEqual(v.draftErrors({ ...ok, agg: 'mean', positive: ['9999'], naValues: ['9999'] }), {});
});

test('barre « d\'où vient la base » et règle de classement appliquée', async (t) => {
  const v = await load(t); if (!v) return;
  // GD_INFO_SESSION toutes périodes : 331 soumissions, 7 sans la variable, 2 hors base, 317 « Oui » sur 322.
  const x = { agg: 'percent_yes', total: 331, absent: 7, blank: 0, naCount: 2, answered: 322, base: 322, numerator: 317, denominator: 322, ignored: 0 };
  const seg = v.explainSegments(x);
  assert.deepEqual(seg.map((s) => [s.key, s.n]), [['positive', 317], ['negative', 5], ['na', 2], ['absent', 7]]);
  assert.equal(seg.reduce((s, x2) => s + x2.n, 0), 331);
  assert.deepEqual(v.explainSegments({ agg: 'mean', total: 10, absent: 0, blank: 1, naCount: 0, answered: 9, base: 8, ignored: 1 }).map((s) => s.key), ['counted', 'ignored', 'blank']);
  assert.deepEqual(v.explainSegments({ total: 0 }), []);
  assert.deepEqual(v.classificationRule({ rating: 'sat', basis: 'bands', oriented: 70.7, thresholds: { exc: 80, sat: 65, imp: 50 } }, 'lower_better'),
    { key: 'bands', vars: { oriented: 70.7, band: '≥ 65', lower: true } });
  assert.equal(v.classificationRule({ rating: 'urg', basis: 'bands', oriented: 30, thresholds: { exc: 80, sat: 65, imp: 50 } }).vars.band, '< 50');
  assert.deepEqual(v.classificationRule({ rating: 'urg', basis: 'target', target: 90, achieved: false, gapPct: 76.4, thresholds: { sat: 10, imp: 30 } }),
    { key: 'target_gap', vars: { target: 90, gap: 76.4, sat: 10, imp: 30 } });
  assert.equal(v.classificationRule({ rating: 'exc', basis: 'target', target: 90, achieved: true, gapPct: 0, thresholds: { sat: 10, imp: 30 } }).key, 'target_met');
  assert.equal(v.classificationRule({ rating: 'na', basis: 'none', reason: 'no_target' }).key, 'no_target');
  assert.equal(v.classificationRule({ rating: 'na', basis: 'none', reason: 'no_data' }).key, 'no_data');
});

test('indice de conformité : seuls les indicateurs en % y entrent (comme overallIndex)', async (t) => {
  const v = await load(t); if (!v) return;
  const { overallIndex } = require('../src/modules/monitoring/monitoringMath');
  assert.equal(v.indexStatus({ agg: 'percent_yes', scored: true }), 'in');
  assert.equal(v.indexStatus({ agg: 'percent_value' }), 'in'); // scored absent = compte
  assert.equal(v.indexStatus({ agg: 'percent_yes', scored: false }), 'excluded');
  // Une moyenne / somme / un nombre n'y compte jamais, même enregistré « scored ».
  for (const agg of ['mean', 'sum', 'count']) assert.equal(v.indexStatus({ agg, scored: true }), 'not_pct');
  assert.equal(v.indexStatus(null), 'not_pct');
  assert.match(v.INDEX_STATUS_LABEL.not_pct, /hors indice \(seuls les indicateurs en % comptent\)/);
  // Même verdict que le calcul de l'indice : la moyenne « scored » ne change pas l'indice.
  const pct = { agg: 'percent_yes', value: 80, scored: true, module: 'D1' };
  assert.equal(overallIndex([pct, { agg: 'mean', value: 3, scored: true, module: 'D1' }]), overallIndex([pct]));
});

test('éditeur en lecture seule : « Calcul de l\'indicateur », jamais « Modifier »', async (t) => {
  const v = await load(t); if (!v) return;
  assert.equal(v.editorTitle({ editing: true, canEdit: false }), 'Calcul de l\'indicateur');
  assert.equal(v.editorTitle({ editing: true, canEdit: true }), 'Modifier l\'indicateur');
  assert.equal(v.editorTitle({ editing: false, canEdit: true }), 'Nouvel indicateur');
});

test('erreurs de l\'API refaites dans la langue de l\'interface à partir des détails structurés', async (t) => {
  const v = await load(t); if (!v) return;
  const tr = (s, vars) => `EN[${s.replace(/\{(\w+)\}/g, (_, k) => (vars && vars[k] != null ? vars[k] : `{${k}}`))}]`;
  const unknown = { status: 400, message: 'Variable « MOInfoSesion » introuvable…', details: { code: 'unknown_variable', field: 'sourceField', name: 'MOInfoSesion', suggestion: 'MOInfoSession' } };
  assert.equal(v.indicatorErrorText(unknown, tr), 'EN[Variable « MOInfoSesion » introuvable dans cette fiche — vouliez-vous dire « MOInfoSession » ?]');
  assert.match(v.indicatorErrorText({ ...unknown, details: { code: 'unknown_variable', name: 'zz', suggestion: null } }, tr), /^EN\[Variable « zz » introuvable dans cette fiche \(ni/);
  // 409 : code repris des détails, sinon de la saisie.
  assert.equal(v.indicatorErrorText({ status: 409, message: 'Un indicateur avec ce code existe déjà sur cette fiche.', details: { code: 'duplicate_code', value: 'GD_1' } }, tr),
    'EN[Le code « GD_1 » est déjà utilisé par un autre indicateur de cette fiche : choisissez-en un autre.]');
  assert.match(v.indicatorErrorText({ status: 409, message: 'x' }, tr, { code: 'A2' }), /« A2 »/);
  assert.match(v.indicatorErrorText({ status: 400, message: 'm', details: { code: 'positive_required' } }, tr), /^EN\[Méthode « % = valeur »/);
  assert.match(v.indicatorErrorText({ status: 400, message: 'm', details: { code: 'positive_is_na', value: '9999' } }, tr), /« 9999 » est à la fois comptée/);
  assert.equal(v.indicatorErrorText({ status: 400, message: 'm', details: { code: 'target_invalid' } }, tr), 'EN[Cible invalide : saisissez un nombre.]');
  // Sans code reconnu : le message du serveur tel quel.
  assert.equal(v.indicatorErrorText({ status: 404, message: 'Fiche introuvable' }, tr), 'Fiche introuvable');
  assert.equal(v.indicatorErrorText(null, tr), null);
  assert.equal(v.unknownVariableText('q', 'Q1', tr), 'EN[Variable « q » introuvable dans cette fiche — vouliez-vous dire « Q1 » ?]');
});

test('légende de la barre : parts rapportées aux soumissions, et dites comme telles', async (t) => {
  const v = await load(t); if (!v) return;
  // 317 positives sur 331 soumissions = 95,8 % des soumissions, quand l'indicateur vaut 98,4 % (317 ÷ 322 comptées).
  const x = { agg: 'percent_yes', total: 331, absent: 7, blank: 0, naCount: 2, answered: 322, base: 322, numerator: 317, denominator: 322, ignored: 0 };
  const pos = v.explainSegments(x).find((s) => s.key === 'positive');
  assert.equal(pos.pct, 95.8);
  const tr = (s, vars) => s.replace(/\{(\w+)\}/g, (_, k) => vars[k]);
  assert.equal(v.segmentShareText(pos, tr), '95.8 % des soumissions');
  assert.equal(v.segmentShareText(pos, tr, (n) => String(n).replace('.', ',')), '95,8 % des soumissions');
});

test('valeurs comptées « 1|2 » ↔ liste ; libellés d\'option traduits, libellés du formulaire tels quels', async (t) => {
  const v = await load(t); if (!v) return;
  assert.deepEqual(v.splitValues(' 1 | 2 ||'), ['1', '2']);
  assert.equal(v.joinValues(['1', ' 2', '1', '']), '1|2');
  assert.equal(v.joinValues([]), null);
  const tr = (s) => `EN:${s}`;
  assert.equal(v.choiceText('sélectionné', tr), 'EN:sélectionné');
  assert.equal(v.choiceText('Oui', tr), 'Oui');
  assert.equal(v.choiceText(null, tr), null);
});
