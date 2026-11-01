/**
 * Référentiel des activités de programme — règles pures (activityRef.js, migration 105) :
 * résolution par alias (jamais « À classer »), propositions pour un texte inconnu, message de
 * refus, « Utilisé par », renommage et fusion.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  usageSummary, usageText, isUsed, buildResolver, suggestActivities, unknownActivityMessage, unknownActivityDetails,
  subActivityMismatchMessage, checkKeyFree, checkMerge, mergeInfo, mergeRefusalMessage,
} = require('../src/modules/programmes/activityRef');

const URT = { id: 'u', code: 'URT', label: 'Unconditional resource transfers to support access to food', shortLabel: 'Transferts inconditionnels', active: true };
const SMP = { id: 's', code: 'SMP', label: 'School meal activities', shortLabel: 'Repas scolaires', active: true };
const NUT = { id: 'n', code: 'NUT', label: 'Nutrition treatment activities', shortLabel: null, active: false };
const BUCKET = { id: 'b', code: 'A-CLASSER', label: 'À classer', bucket: true, active: true };
const ACTIVITIES = [URT, SMP, NUT, BUCKET];
const ALIASES = [
  { aliasKey: 'unconditionalresourcetransferstosupportaccesstofood', programmeActivityId: 'u' },
  { aliasKey: 'urt', programmeActivityId: 'u' },
  { aliasKey: 'gd', programmeActivityId: 'u' },             // ancienne activité « GD » fusionnée
  { aliasKey: 'schoolmealactivities', programmeActivityId: 's' },
  { aliasKey: 'smp', programmeActivityId: 's' },
  { aliasKey: 'nutritiontreatmentactivities', programmeActivityId: 'n' },
  { aliasKey: 'aclasser', programmeActivityId: 'b' },       // jamais suivi : « À classer » n'est pas une activité
];
const SUBS = [
  { code: 'PECMAM', label: 'Prise en charge de la MAM', programmeActivityId: 'n' },
  { code: 'PREVMA', label: 'Prévention', programmeActivityId: 'u' },
  { code: 'XYZ', label: 'Inconnue', programmeActivityId: 'b' },
];
const r = buildResolver({ activities: ACTIVITIES, aliases: ALIASES, subActivities: SUBS });

test('résolution : libellé, code, ancien libellé ; casse, accents et ponctuation ignorés', () => {
  assert.equal(r.resolve('School meal activities'), SMP);
  assert.equal(r.resolve('  SCHOOL-MEAL activities '), SMP);
  assert.equal(r.resolve('smp'), SMP);
  assert.equal(r.resolve('GD'), URT, 'ancien libellé (fusion) toujours reconnu');
  assert.equal(r.resolve('Nutrition treatment activities'), NUT, 'une activité désactivée reste reconnue (données existantes)');
  assert.equal(r.resolve('Cantine'), null);
  assert.equal(r.resolve(''), null);
  assert.equal(r.resolve(null), null);
  assert.equal(r.resolve('À classer'), null, '« À classer » n\'est jamais désigné');
});

test('libellé officiel (canonical) : le libellé de l\'activité, sinon le texte nettoyé', () => {
  assert.equal(r.canonical('gd'), URT.label);
  assert.equal(r.canonical('  Activité   inconnue '), 'Activité inconnue');
  assert.equal(r.canonical('   '), null);
});

test('sous-activité par code (casse et ponctuation ignorées)', () => {
  assert.equal(r.resolveSub('pecmam').code, 'PECMAM');
  assert.equal(r.resolveSub('PREV-MA').code, 'PREVMA');
  assert.equal(r.resolveSub('ZZZ'), null);
});

test('propositions : proches du libellé, du libellé court ou du code ; code de sous-activité → son activité', () => {
  assert.deepEqual(suggestActivities('School meals', r).slice(0, 1), [SMP.label]);
  assert.deepEqual(suggestActivities('Repas scolaire', r).slice(0, 1), [SMP.label], 'libellé court');
  assert.deepEqual(suggestActivities('PECMAM', r), [NUT.label], 'PECMAM est une sous-activité du traitement nutritionnel');
  assert.deepEqual(suggestActivities('zzzz qqqq', r), []);
  assert.deepEqual(suggestActivities('', r), []);
  assert.ok(suggestActivities('Unconditional transfers', r).includes(URT.label));
});

test('message de refus : « Activité inconnue … vouliez-vous dire … ? Créez-la dans Paramétrage › Activités »', () => {
  assert.equal(unknownActivityMessage('School meals', [SMP.label]),
    'Activité inconnue « School meals » — vouliez-vous dire « School meal activities » ? Créez-la dans Paramétrage › Activités.');
  assert.equal(unknownActivityMessage('  Xyz  ', []), 'Activité inconnue « Xyz ». Créez-la dans Paramétrage › Activités.');
  assert.match(unknownActivityMessage('A', ['B', 'C']), /« B » ou « C »/);
  assert.deepEqual(unknownActivityDetails(' Xyz ', ['B']), { code: 'unknown_activity', value: 'Xyz', suggestions: ['B'] });
  assert.match(subActivityMismatchMessage('PECMAM', SMP.label, NUT.label), /appartient à « Nutrition treatment activities », pas à « School meal activities »/);
});

test('« Utilisé par » : comptes non nuls, dans l\'ordre, au singulier ou au pluriel', () => {
  const list = usageSummary({ visits: 1, sites: 12, mmr: 0, pdd: 3, inconnu: 9 });
  assert.deepEqual(list.map((l) => l.key), ['sites', 'visits', 'pdd']);
  assert.equal(usageText(list), '12 sites, 1 visite de terrain, 3 lignes du PDD');
  assert.equal(isUsed({ sites: 0, forms: 0 }), false);
  assert.equal(isUsed({ subActivities: 1 }), true);
  assert.equal(usageText(usageSummary({ contracts: 1, budgetLines: 2 })), '1 contrat, 2 lignes de budget FLA');
});

test('nouveau libellé ou code : clé libre, ou déjà à cette activité ; jamais celle d\'une autre', () => {
  assert.deepEqual(checkKeyFree('School meals', null, 's'), { ok: true, key: 'schoolmeals' });
  assert.deepEqual(checkKeyFree('SMP', 's', 's'), { ok: true, key: 'smp' }, 'retour à son propre ancien libellé');
  assert.deepEqual(checkKeyFree('GD', 'u', 's'), { ok: false, reason: 'taken', ownerId: 'u' });
  assert.deepEqual(checkKeyFree('—', null, 's'), { ok: false, reason: 'empty' });
});

test('fusion : refusée vers soi, avec « À classer », vers une activité désactivée, ou si les deux ont une exigence MMR de même portée', () => {
  assert.deepEqual(checkMerge({ source: URT, target: SMP }), { ok: true });
  assert.equal(checkMerge({ source: URT, target: null }).reason, 'missing');
  assert.equal(checkMerge({ source: URT, target: URT }).reason, 'same');
  assert.equal(checkMerge({ source: BUCKET, target: SMP }).reason, 'bucket');
  assert.equal(checkMerge({ source: SMP, target: NUT }).reason, 'inactive_target');
  const mmr = [
    { programmeActivityId: 'u', fieldOfficeId: null }, { programmeActivityId: 's', fieldOfficeId: null },
    { programmeActivityId: 'u', fieldOfficeId: 'fd' }, { programmeActivityId: 's', fieldOfficeId: 'tl' },
  ];
  const clash = checkMerge({ source: URT, target: SMP, mmr });
  assert.deepEqual(clash, { ok: false, reason: 'mmr_conflict', scopes: [null] });
  assert.deepEqual(checkMerge({ source: URT, target: SMP, mmr: mmr.slice(2) }), { ok: true }, 'bureaux différents : pas de conflit');
  assert.match(mergeRefusalMessage(clash, { sourceLabel: 'GD', targetLabel: 'URT' }), /chacune une exigence MMR \(plan général\)/);
  assert.match(mergeRefusalMessage({ ok: false, reason: 'mmr_conflict', scopes: ['fd'] }, { officeName: () => 'Bureau Fort Dauphin' }), /exigence MMR \(Bureau Fort Dauphin\)/);
});

test('fusion : la cible garde ses informations, complétées par celles de la source', () => {
  assert.deepEqual(mergeInfo({ shortLabel: 'Repas', description: '' }, { shortLabel: 'X', description: 'Desc' }), { shortLabel: 'Repas', description: 'Desc' });
  assert.deepEqual(mergeInfo({ shortLabel: null, description: null }, {}), { shortLabel: null, description: null });
});
