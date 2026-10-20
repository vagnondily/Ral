const test = require('node:test');
const assert = require('node:assert/strict');
const { sessionDays, pctTenths, participantResult, summarize, listSummary, checkParticipant, mergeParticipant } = require('../src/modules/trainings/trainingMath');

const S = { scoreMax: 20, passMark: 70, startDate: '2026-03-02', endDate: '2026-03-04' };

test('durée : jours calendaires, début et fin compris', () => {
  assert.equal(sessionDays('2026-03-02', '2026-03-04'), 3);
  assert.equal(sessionDays('2026-02-28', '2026-03-01'), 2);
  assert.equal(sessionDays('2026-03-04', '2026-03-02'), null);
});

test('notes en % du barème, progression, gain normalisé, réussite au seuil', () => {
  assert.equal(pctTenths(15, 20), 750);
  assert.equal(pctTenths(null, 20), null);
  const r = participantResult({ preScore: 8, postScore: 14 }, S);
  assert.deepEqual(r, { prePct: 40, postPct: 70, progress: 30, gain: 50, pass: true }, 'seuil atteint pile : réussi');
  assert.equal(participantResult({ preScore: 20, postScore: 20 }, S).gain, null, 'pré-test à 100 % : gain indéfini');
  assert.equal(participantResult({ preScore: 12, postScore: 10 }, S).progress, -10, 'une régression reste négative');
  assert.deepEqual(participantResult({ preScore: 10, postScore: null }, S), { prePct: 50, postPct: null, progress: null, gain: null, pass: null });
  assert.equal(participantResult({ postScore: 13.99 }, S).pass, false, '69,95 % s\'affiche 70,0 % mais n\'atteint pas le seuil');
  assert.equal(participantResult({ postScore: 13.99 }, S).postPct, 70);
  assert.equal(participantResult({ postScore: 14 }, S).pass, true);
});

test('bilan : présence sur les seules présences renseignées, jamais 0 % sans donnée', () => {
  const s = summarize(S, [
    { agentId: 'a', providerId: 'p1', attendance: 'present', preScore: 8, postScore: 14, satisfaction: 4 },
    { agentId: 'b', providerId: 'p1', attendance: 'partiel', preScore: 10, postScore: 12, satisfaction: 5 },
    { agentId: 'c', agentName: 'C', providerId: 'p2', attendance: 'absent' },
    { agentId: 'd', providerId: 'p2', attendance: null, preScore: 6, postScore: 10, satisfaction: 3 },
  ]);
  assert.equal(s.days, 3);
  assert.deepEqual([s.participants, s.providers], [4, 2]);
  assert.deepEqual(s.attendance, { present: 1, partial: 1, absent: 1, notRecorded: 1, rate: 66.7 });
  assert.deepEqual([s.tests.withPre, s.tests.withPost, s.tests.avgPre, s.tests.avgPost, s.tests.avgProgress], [3, 3, 40, 60, 20]);
  assert.equal(s.tests.passRate, 33.3);
  assert.deepEqual(s.toReview.map((x) => [x.agentId, x.postPct]), [['b', 60], ['d', 50]]);
  assert.deepEqual([s.satisfaction.n, s.satisfaction.avg], [3, 4]);
  assert.deepEqual(s.satisfaction.distribution.map((x) => x.n), [0, 0, 1, 1, 1]);
  const empty = summarize(S, [{ agentId: 'x' }]);
  assert.deepEqual([empty.attendance.rate, empty.tests.avgPre, empty.tests.passRate, empty.satisfaction.avg], [null, null, null, null]);
});

test('saisie d\'un participant : présence connue, jours ≤ durée, notes ≤ barème, pas de note pour un absent', () => {
  assert.deepEqual(checkParticipant({ attendance: 'present', daysPresent: 3, preScore: 0, postScore: 20 }, S), []);
  assert.deepEqual(checkParticipant({ attendance: 'malade', daysPresent: 4, preScore: -1, postScore: 21 }, S),
    ['attendance', 'daysPresent', 'preScore', 'postScore']);
  assert.deepEqual(checkParticipant({ attendance: 'absent', postScore: 12 }, S), ['absentWithScore']);
});

test('liste des sessions : les agrégats SQL donnent les mêmes chiffres que le bilan', () => {
  const parts = [
    { attendance: 'present', preScore: 8, postScore: 14, satisfaction: 4 },
    { attendance: 'partiel', preScore: 10, postScore: 13.99, satisfaction: 5 },
    { attendance: 'absent' },
    { attendance: null, preScore: 6.5, postScore: 10, satisfaction: 2 },
  ];
  // Jumeau JS des agrégats SQL : round(note × 1000 / barème) par participant, réussite exacte.
  const t = (x) => Math.round((x * 1000) / S.scoreMax);
  const pre = parts.filter((p) => p.preScore != null); const post = parts.filter((p) => p.postScore != null);
  const agg = {
    recorded: parts.filter((p) => p.attendance).length, attended: parts.filter((p) => p.attendance && p.attendance !== 'absent').length,
    withPre: pre.length, sumPre: pre.reduce((s, p) => s + t(p.preScore), 0), withPost: post.length, sumPost: post.reduce((s, p) => s + t(p.postScore), 0),
    passed: post.filter((p) => p.postScore * 100 >= S.passMark * S.scoreMax).length,
    withSat: parts.filter((p) => p.satisfaction).length, sumSat: parts.reduce((s, p) => s + (p.satisfaction || 0), 0),
  };
  const l = listSummary(agg); const b = summarize(S, parts);
  assert.deepEqual([l.attendanceRate, l.avgPre, l.avgPost, l.passRate, l.satisfactionAvg],
    [b.attendance.rate, b.tests.avgPre, b.tests.avgPost, b.tests.passRate, b.satisfaction.avg]);
  assert.deepEqual(listSummary({ recorded: 0, attended: 0, withPre: 0, sumPre: 0, withPost: 0, sumPost: 0, passed: 0, withSat: 0, sumSat: 0 }),
    { attendanceRate: null, avgPre: null, avgPost: null, passRate: null, satisfactionAvg: null });
});

test('saisie partielle d\'un participant : seuls les champs envoyés changent, null efface', () => {
  const cur = { agentId: 'a1', attendance: 'present', daysPresent: 3, preScore: 8, postScore: 15, satisfaction: 4, feedback: 'Utile' };
  assert.deepEqual(mergeParticipant(cur, { agentId: 'a1', preScore: 9 }),
    { agentId: 'a1', attendance: 'present', daysPresent: 3, preScore: 9, postScore: 15, satisfaction: 4, feedback: 'Utile' });
  assert.deepEqual(mergeParticipant(cur, { agentId: 'a1', feedback: null, postScore: undefined }),
    { agentId: 'a1', attendance: 'present', daysPresent: 3, preScore: 8, postScore: 15, satisfaction: 4, feedback: null });
  // L'état fusionné est celui qu'on contrôle : « absent » sur une ligne qui a un post-test est refusé.
  assert.deepEqual(checkParticipant(mergeParticipant(cur, { agentId: 'a1', attendance: 'absent' }), { ...S, startDate: '2026-03-02', endDate: '2026-03-04' }), ['absentWithScore']);
  assert.deepEqual(mergeParticipant(null, { agentId: 'a2', attendance: 'absent' }),
    { agentId: 'a2', attendance: 'absent', daysPresent: null, preScore: null, postScore: null, satisfaction: null, feedback: null });
});
