const test = require('node:test');
const assert = require('node:assert/strict');
const repo = require('../src/modules/trainings/trainings.repository');
const service = require('../src/modules/trainings/trainings.service');

const session = { id: 's1', startDate: '2026-09-08', endDate: '2026-09-10', scoreMax: 20, passMark: 70 };

test('présences et notes : une ligne fautive refuse TOUTE la saisie (400 détaillé), rien n\'est écrit', async (t) => {
  let wrote = false;
  t.mock.method(repo, 'updateParticipants', async (tenantId, id, rows, validate) => {
    validate(session, rows); // le dépôt appelle la validation sous verrou, AVANT l'UPDATE
    wrote = true;
    return { updated: rows.length };
  });
  await assert.rejects(service.updateParticipants('t1', 's1', [
    { agentId: 'a1', attendance: 'present', daysPresent: 3, preScore: 10, postScore: 15 },
    { agentId: 'a2', attendance: 'absent', postScore: 12 },
    { agentId: 'a3', attendance: 'present', daysPresent: 4, preScore: 25 },
  ]), (e) => e.statusCode === 400 && e.details.code === 'participants'
    && e.details.errors.map((x) => x.agentId).join() === 'a2,a3' && /absent/.test(e.message));
  assert.equal(wrote, false);
  assert.deepEqual(await service.updateParticipants('t1', 's1', [{ agentId: 'a1', attendance: 'partiel', daysPresent: 2 }]), { updated: 1 });
});

test('modification : durée raccourcie sous les jours saisis, ou barème sous une note → 400 avant écriture', async (t) => {
  const participants = [{ agentId: 'a1', daysPresent: 3, preScore: 12, postScore: 18 }];
  t.mock.method(repo, 'updateSession', async (tenantId, id, patch, check) => { check(session, { ...session, ...patch }, participants); return id; });
  t.mock.method(repo, 'getSession', async () => ({ ...session, themes: [], participants: [] }));
  await assert.rejects(service.update('t1', 's1', { endDate: '2026-09-09' }), (e) => e.statusCode === 400 && e.details.code === 'days_present');
  await assert.rejects(service.update('t1', 's1', { scoreMax: 15 }), (e) => e.statusCode === 400 && e.details.code === 'score_max');
  await assert.rejects(service.update('t1', 's1', { endDate: '2026-09-01' }), (e) => e.statusCode === 400 && /précède/.test(e.message));
  const ok = await service.update('t1', 's1', { scoreMax: 20, place: 'Ambovombe' });
  assert.equal(ok.summary.participants, 0);
});

test('suppression : une formation avec données ou reprise de l\'historique ne se supprime pas (409)', async (t) => {
  const answers = [{ status: 'linked', recorded: 2, origin: 'saisie' }, { status: 'linked', recorded: 0, origin: 'reprise' }, { status: 'not_found' }, { status: 'deleted' }];
  t.mock.method(repo, 'deleteSession', async () => answers.shift());
  await assert.rejects(service.remove('t1', 's1'), (e) => e.statusCode === 409 && /annulée/.test(e.message));
  await assert.rejects(service.remove('t1', 's1'), (e) => e.statusCode === 409 && /historique/.test(e.message));
  await assert.rejects(service.remove('t1', 's1'), (e) => e.statusCode === 404);
  await service.remove('t1', 's1');
});

test('onglet Formations d\'un prestataire : une entrée par session, résultats calculés par la même règle', async (t) => {
  t.mock.method(repo, 'providerParticipations', async () => [
    { sessionId: 's1', title: 'T', startDate: '2026-09-08', endDate: '2026-09-10', status: 'realisee', place: null, themes: [], scoreMax: 20, passMark: 70,
      agentId: 'a1', agentName: 'A', attendance: 'present', preScore: 8, postScore: 14, satisfaction: 4 },
    { sessionId: 's1', title: 'T', startDate: '2026-09-08', endDate: '2026-09-10', status: 'realisee', place: null, themes: [], scoreMax: 20, passMark: 70,
      agentId: 'a2', agentName: 'B', attendance: 'absent', preScore: null, postScore: null, satisfaction: null },
  ]);
  const r = await service.byProvider('t1', 'p1');
  assert.equal(r.length, 1);
  assert.equal(r[0].days, 3);
  assert.deepEqual(r[0].agents.map((a) => [a.agentName, a.prePct, a.postPct, a.pass]), [['A', 40, 70, true], ['B', null, null, null]]);
});
