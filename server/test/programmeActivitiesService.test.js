/**
 * Activités de programme — règles du service (migration 105), jouées SANS base : transactions et
 * verrou des rattachements simulés, dépôt remplacé par un faux en mémoire. On vérifie :
 * - une clé déjà portée (libellé, ancien libellé, code) n'est jamais prise par une autre activité ;
 * - renommer ajoute la nouvelle clé SANS retirer l'ancienne ;
 * - supprimer est refusé (409, « Utilisé par ») dès qu'une donnée désigne l'activité ;
 * - fusion, conversion et liaison passent par le verrou des rattachements et relient à nouveau
 *   les formulaires reçus ; un conflit d'exigences MMR refuse la fusion ;
 * - une saisie inconnue est refusée avec des propositions, jamais créée.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../src/config/db');
const places = require('../src/modules/settings/placeMatch.repository');

const T = '11111111-1111-1111-1111-111111111111';
const client = { tag: 'client' };
let inLinks = 0; let relinked = 0;
db.withTenantTransaction = async (tenantId, fn) => { assert.equal(tenantId, T); return fn(client); };
places.withSubmissionLinks = async (tenantId, fn) => { assert.equal(tenantId, T); inLinks += 1; return fn(client); };
places.applySubmissionSitesTx = async (c) => { assert.equal(c, client); relinked += 1; return { linked: 0 }; };

const repo = require('../src/modules/programmes/programmeActivities.repository');
const service = require('../src/modules/programmes/programmeActivities.service');

// ---- Faux dépôt ----------------------------------------------------------------------
let state;
function reset() {
  inLinks = 0; relinked = 0;
  state = {
    activities: new Map([
      ['u', { id: 'u', code: 'URT', label: 'Unconditional resource transfers to support access to food', shortLabel: null, description: 'Desc URT', active: true, bucket: false }],
      ['s', { id: 's', code: 'SMP', label: 'School meal activities', shortLabel: 'Repas scolaires', description: null, active: true, bucket: false }],
      ['g', { id: 'g', code: 'GD', label: 'GD', shortLabel: null, description: null, active: true, bucket: false }],
      ['b', { id: 'b', code: 'A-CLASSER', label: 'À classer', shortLabel: null, description: null, active: true, bucket: true }],
    ]),
    aliases: new Map([
      ['unconditionalresourcetransferstosupportaccesstofood', 'u'], ['urt', 'u'],
      ['schoolmealactivities', 's'], ['smp', 's'], ['gd', 'g'],
    ]),
    usage: { s: { sites: 12, mmr: 1 }, g: { sites: 2, visits: 4 } },
    mmr: [],
    subs: [{ id: 'sub1', code: 'XYZ', label: 'Inconnue', programmeActivityId: 'b' }],
    calls: [],
  };
}
repo.loadResolverTx = async () => ({
  activities: [...state.activities.values()],
  aliases: [...state.aliases].map(([aliasKey, programmeActivityId]) => ({ aliasKey, programmeActivityId })),
  subActivities: state.subs,
});
repo.aliasOwnerTx = async (c, t, key) => state.aliases.get(key) || null;
repo.activityByIdTx = async (c, t, id) => state.activities.get(id) || null;
repo.lockActivitiesTx = async (c, t, ids) => { state.calls.push(['lock', [...ids].sort()]); return new Map(ids.filter((i) => state.activities.has(i)).map((i) => [i, state.activities.get(i)])); };
repo.activityCodesTx = async () => [...state.activities.values()].map((a) => a.code);
repo.insertActivityTx = async (c, t, a) => { state.calls.push(['insert', a.code, a.label]); state.activities.set('new', { ...a, id: 'new', active: true, bucket: false }); return 'new'; };
repo.addAliasTx = async (c, t, al) => {
  state.calls.push(['alias', al.key, al.activityId, al.source]);
  if (state.aliases.has(al.key)) return 0;
  state.aliases.set(al.key, al.activityId); return 1;
};
repo.updateActivityTx = async (c, t, id, patch) => { state.calls.push(['update', id, patch]); Object.assign(state.activities.get(id), patch); return 1; };
repo.activityUsageTx = async (c, t, id) => ({ ...(state.usage[id] || {}), subActivities: state.subs.filter((s) => s.programmeActivityId === id).length });
repo.deleteActivityTx = async (c, t, id) => { state.calls.push(['delete', id]); state.activities.delete(id); return 1; };
repo.mmrScopesTx = async () => state.mmr;
repo.officeNamesTx = async () => new Map([['fd', 'Bureau Fort Dauphin']]);
repo.mergeActivitiesTx = async (c, t, source, target, info) => { state.calls.push(['merge', source, target, info]); return { aliases: 1, subActivities: 0 }; };
repo.subActivityByCodeTx = async (c, t, code) => state.subs.find((s) => s.code.toLowerCase() === String(code).toLowerCase()) || null;
repo.insertSubActivityTx = async (c, t, s) => { state.calls.push(['insertSub', s.code, s.programmeActivityId]); return 'newsub'; };
repo.moveSubActivityTx = async (c, t, id, to) => { state.calls.push(['moveSub', id, to]); };

const rejects = (p, status, re) => assert.rejects(p, (e) => { assert.equal(e.statusCode, status); if (re) assert.match(e.message, re); return true; });

test('création : code proposé depuis le libellé, libellé et code reconnus aussitôt', async () => {
  reset();
  const r = await service.createActivity(T, { label: '  Emergency   preparedness activities ' }, 'user');
  assert.deepEqual(r, { id: 'new', code: 'EMERGENCY-PREPAREDNESS-ACTIVIT', label: 'Emergency preparedness activities' });
  assert.deepEqual(state.calls.filter((c) => c[0] === 'alias').map((c) => [c[1], c[3]]),
    [['emergencypreparednessactivities', 'libelle'], ['emergencypreparednessactivit', 'code']]);
});

test('création : un libellé ou un code déjà porté (même ancien) est refusé en nommant son activité', async () => {
  reset();
  await rejects(service.createActivity(T, { label: 'S.M.P' }), 409, /désigne déjà l'activité « School meal activities »/);
  await rejects(service.createActivity(T, { label: 'Cantines', code: 'URT' }), 409, /Le code « URT »/);
  await rejects(service.createActivity(T, { label: 'Cantines', code: '-bad' }), 400, /Code/);
  assert.ok(!state.calls.some((c) => c[0] === 'insert'), 'rien n\'est créé');
});

test('renommage : la nouvelle clé s\'ajoute, l\'ancienne reste (rien ne se détache) ; clé d\'une autre activité refusée', async () => {
  reset();
  await service.updateActivity(T, 's', { label: 'School feeding', code: 'SF' }, 'user');
  assert.equal(state.aliases.get('schoolmealactivities'), 's', 'ancien libellé toujours reconnu');
  assert.equal(state.aliases.get('smp'), 's', 'ancien code toujours reconnu');
  assert.equal(state.aliases.get('schoolfeeding'), 's');
  assert.equal(state.aliases.get('sf'), 's');
  assert.equal(state.activities.get('s').label, 'School feeding');
  await rejects(service.updateActivity(T, 's', { label: 'GD' }), 409, /« GD »/);
  // Revenir à son propre ancien libellé est permis.
  await service.updateActivity(T, 's', { label: 'School meal activities' });
  assert.equal(state.activities.get('s').label, 'School meal activities');
});

test('« À classer » ne se modifie pas ; activité inconnue → 404', async () => {
  reset();
  await rejects(service.updateActivity(T, 'b', { label: 'Autre' }), 400, /À classer/);
  await rejects(service.updateActivity(T, 'zz', { label: 'Autre' }), 404);
});

test('suppression : refusée avec « Utilisé par » dès qu\'une donnée la désigne ; permise sinon', async () => {
  reset();
  await assert.rejects(service.deleteActivity(T, 's'), (e) => {
    assert.equal(e.statusCode, 409);
    assert.match(e.message, /12 sites, 1 exigence MMR/);
    assert.equal(e.details.reason, 'linked_data');
    assert.deepEqual(e.details.linked.map((l) => [l.key, l.count]), [['sites', 12], ['mmr', 1]]);
    return true;
  });
  await rejects(service.deleteActivity(T, 'b'), 409, /Rangez d'abord ses sous-activités/);
  state.usage.u = {};
  assert.deepEqual(await service.deleteActivity(T, 'u'), { deleted: true });
});

test('fusion : sous le verrou des rattachements, formulaires reliés à nouveau ; conflit MMR → 409', async () => {
  reset();
  const r = await service.mergeActivities(T, 'g', 'u');
  assert.equal(r.merged, true);
  assert.equal(inLinks, 1);
  assert.equal(relinked, 1);
  const merge = state.calls.find((c) => c[0] === 'merge');
  assert.deepEqual(merge.slice(1, 3), ['g', 'u']);
  assert.deepEqual(state.calls.find((c) => c[0] === 'lock')[1], ['g', 'u'], 'les deux lignes verrouillées');
  reset();
  state.mmr = [{ programmeActivityId: 'g', fieldOfficeId: 'fd' }, { programmeActivityId: 'u', fieldOfficeId: 'fd' }];
  await rejects(service.mergeActivities(T, 'g', 'u'), 409, /exigence MMR \(Bureau Fort Dauphin\)/);
  assert.ok(!state.calls.some((c) => c[0] === 'merge'));
  await rejects(service.mergeActivities(T, 'g', 'g'), 400);
  await rejects(service.mergeActivities(T, 'g', 'b'), 400, /À classer/);
});

test('ranger comme sous-activité : fusion + sous-activité du code créée sous la cible, ou reprise depuis « À classer »', async () => {
  reset();
  const r = await service.convertToSubActivity(T, 'g', 'u', { label: 'Distribution générale' });
  assert.deepEqual(r.subActivity, { id: 'newsub', code: 'GD', created: true });
  assert.ok(state.calls.some((c) => c[0] === 'insertSub' && c[1] === 'GD' && c[2] === 'u'));
  assert.ok(state.calls.some((c) => c[0] === 'merge' && c[1] === 'g' && c[2] === 'u'));
  assert.equal(relinked, 1);
  reset();
  state.subs.push({ id: 'subGD', code: 'GD', label: 'GD', programmeActivityId: 'b' });
  const moved = await service.convertToSubActivity(T, 'g', 'u');
  assert.deepEqual(moved.subActivity, { id: 'subGD', code: 'GD', created: false });
  assert.ok(state.calls.some((c) => c[0] === 'moveSub' && c[1] === 'subGD' && c[2] === 'u'));
  reset();
  state.subs.push({ id: 'subGD', code: 'GD', label: 'GD', programmeActivityId: 's' });
  await rejects(service.convertToSubActivity(T, 'g', 'u'), 409, /appartient déjà à « School meal activities »/);
});

test('écriture d\'un autre module : libellé officiel enregistré ; inconnu refusé avec propositions, jamais créé', async () => {
  reset();
  assert.deepEqual(await service.resolveForWrite(client, T, 'smp'), { id: 's', label: 'School meal activities', code: 'SMP' });
  assert.equal(await service.resolveForWrite(client, T, '  '), null);
  await rejects(service.resolveForWrite(client, T, '', { optional: false }), 400, /Activité requise/);
  await assert.rejects(service.resolveForWrite(client, T, 'School meals'), (e) => {
    assert.equal(e.statusCode, 400);
    assert.equal(e.message, 'Activité inconnue « School meals » — vouliez-vous dire « School meal activities » ? Créez-la dans Paramétrage › Activités.');
    assert.deepEqual(e.details, { code: 'unknown_activity', value: 'School meals', suggestions: ['School meal activities'] });
    return true;
  });
  await rejects(service.resolveForWrite(client, T, 'À classer'), 400, /Activité inconnue/);
});

test('sous-activité d\'un site : connue, et de la même activité (une sous-activité « À classer » est acceptée)', async () => {
  reset();
  state.subs.push({ id: 'p', code: 'PREVMA', label: 'Prévention', programmeActivityId: 'u' });
  const r = await service.resolverTx(client, T);
  const urt = { id: 'u', label: state.activities.get('u').label };
  assert.deepEqual(service.resolveSubForWrite(r, 'prevma', urt), { code: 'PREVMA', label: 'Prévention', programmeActivityId: 'u' });
  assert.equal(service.resolveSubForWrite(r, '', urt), null);
  assert.equal(service.resolveSubForWrite(r, 'XYZ', urt).code, 'XYZ', '« À classer » : accepté');
  assert.throws(() => service.resolveSubForWrite(r, 'PREVMA', { id: 's', label: 'School meal activities' }), (e) => e.statusCode === 400 && e.details.code === 'sub_activity_mismatch');
  assert.throws(() => service.resolveSubForWrite(r, 'NOPE', urt), (e) => e.statusCode === 400 && e.details.code === 'unknown_sub_activity');
});
