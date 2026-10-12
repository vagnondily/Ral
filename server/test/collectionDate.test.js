const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCollectionDate } = require('../src/modules/monitoring/collectionDate');

const ok = (v) => { const r = parseCollectionDate(v); assert.equal(r.ok, true, `attendu lisible : ${v}`); return r; };
const bad = (v) => assert.equal(parseCollectionDate(v).ok, false, `attendu refusé : ${v}`);

test('vide → pas de date, sans erreur', () => {
  for (const v of [null, undefined, '', '   ']) assert.deepEqual(parseCollectionDate(v), { ok: true, date: null, month: null });
});

test('ISO des exports Kobo/ODK : date, date-heure, fuseau, millisecondes', () => {
  assert.equal(ok('2026-05-03').month, '2026-05-01');
  assert.equal(ok('2026-05-03').date.toISOString(), '2026-05-03T00:00:00.000Z');
  assert.equal(ok('2026-05').month, '2026-05-01');
  assert.equal(ok('2026-07-13T09:43:43.897+03:00').date.toISOString(), '2026-07-13T06:43:43.897Z');
  assert.equal(ok('2026-07-13T09:43:43Z').date.toISOString(), '2026-07-13T09:43:43.000Z');
  assert.equal(ok('2026-07-13T09:43:43.000-0230').date.toISOString(), '2026-07-13T12:13:43.000Z');
  assert.equal(ok('2026-07-13 09:43').month, '2026-07-01');
  // Le mois reste celui écrit (heure locale du collecteur), même si l'UTC bascule.
  assert.equal(ok('2026-05-31T23:30:00-05:00').month, '2026-05-01');
  // Sans fuseau : heure locale, comme new Date('…T…').
  assert.equal(ok('2026-05-03T08:00:00').date.getTime(), new Date('2026-05-03T08:00:00').getTime());
});

test('dates ambiguës ou impossibles refusées (plus de 3 mai pour « 05/03/2026 »)', () => {
  for (const v of ['30/01/2026', '05/03/2026', '2026/01/30', 'hier', '2026-02-30', '2026-13-01', '2026-04-31',
    '2026-05-03T25:00', '2026-05-03T10:61', '0050-01-01', 'Invalid Date', 'NaN', true]) bad(v);
});

test('secondes SPSS (depuis le 14/10/1582) converties : SvyDate du zip MIARO réel', () => {
  const r = ok(13989110400);
  assert.equal(r.date.toISOString(), '2026-01-30T00:00:00.000Z');
  assert.equal(r.month, '2026-01-01');
  assert.equal(ok('13985328309').date.toISOString(), '2025-12-17T05:25:09.000Z'); // @_submission_time GD
});

test('série Excel, secondes et millisecondes Unix : fenêtres 2000–2100 disjointes', () => {
  assert.equal(ok(46052).date.toISOString(), '2026-01-30T00:00:00.000Z');          // série Excel
  assert.equal(ok(46052.5).date.toISOString(), '2026-01-30T12:00:00.000Z');
  assert.equal(ok(1769731200).date.toISOString(), '2026-01-30T00:00:00.000Z');     // secondes Unix
  assert.equal(ok(1769731200000).date.toISOString(), '2026-01-30T00:00:00.000Z');  // millisecondes
  for (const v of [0, 42, 1999, 30000, 5e8, 5e10, 9e15, -1, Infinity]) bad(v);     // hors de toute fenêtre
});

test('objet Date : valide accepté, « Invalid Date » refusé', () => {
  assert.equal(ok(new Date('2026-03-15T10:00:00Z')).month, '2026-03-01');
  bad(new Date('nimporte'));
});
