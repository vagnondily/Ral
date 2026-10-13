const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCollectionDate, collectionMonth, collectionUpdates, firstFilled } = require('../src/modules/monitoring/collectionDate');

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

// ---- Mois de collecte (retour n° 35) -------------------------------------------------------
const cm = (surveyDate, uploadDate, opts) => collectionMonth({ surveyDate, uploadDate, ...opts });

test('mois de collecte : la date d\'enquête l\'emporte quand elle précède la réception de 0 à 92 jours', () => {
  const r = cm('2026-01-28', '2026-02-03T08:00:00');
  assert.equal(r.month, '2026-01-01');
  assert.equal(r.source, 'survey');
  assert.equal(r.issue, null);
  assert.equal(r.uploadMonth, '2026-02-01');
  assert.equal(r.surveyMonth, '2026-01-01');
  assert.equal(r.lagDays, 6);
  assert.equal(r.date.toISOString(), '2026-01-28T00:00:00.000Z'); // submitted_at = date d'enquête
  // Même jour : écart 0.
  assert.equal(cm('2026-03-10', '2026-03-10T15:00:00').lagDays, 0);
  // Bornes : 92 jours gardent l'enquête, 93 basculent sur la réception.
  assert.equal(cm('2026-01-01', '2026-04-03').source, 'survey');       // 92 j
  const late = cm('2026-01-01', '2026-04-04');                          // 93 j
  assert.equal(late.source, 'upload');
  assert.equal(late.issue, 'survey_too_old');
  assert.equal(late.month, '2026-04-01');
  assert.equal(late.lagDays, 93);
});

test('mois de collecte : date d\'enquête future ou trop ancienne (horloge de tablette) → mois de réception', () => {
  const future = cm('2026-03-05', '2026-03-01T09:00:00');
  assert.equal(future.source, 'upload');
  assert.equal(future.issue, 'survey_after_upload');
  assert.equal(future.month, '2026-03-01');
  const nextMonth = cm('2026-05-02', '2026-04-29T10:00:00');
  assert.equal(nextMonth.month, '2026-04-01');
  assert.equal(nextMonth.issue, 'survey_after_upload');
  // Valeurs réelles (Nutrition, SPSS) : SvyDate en mars 2024, reçue en avril 2026.
  const nut = cm(13929667200, 13994498165);
  assert.equal(nut.month, '2026-04-01');
  assert.equal(nut.issue, 'survey_too_old');
  assert.equal(nut.surveyMonth, '2024-03-01');
  // Réglable : maxLagDays.
  assert.equal(cm('2026-01-01', '2026-01-20', { maxLagDays: 7 }).issue, 'survey_too_old');
});

test('mois de collecte : un jour de tolérance (réception UTC, enquête en heure locale)', () => {
  // Enquête le 1ᵉʳ février à 1 h (heure de Madagascar), reçue le 31 janvier 22 h 30 UTC : février.
  const r = cm('2026-02-01', '2026-01-31T22:30:00');
  assert.equal(r.month, '2026-02-01');
  assert.equal(r.source, 'survey');
  assert.equal(r.lagDays, -1);
  assert.equal(cm('2026-02-02', '2026-01-31T22:30:00').issue, 'survey_after_upload'); // −2 j : refusée
});

test('mois de collecte : une seule date connue → celle-là ; aucune → pas de mois', () => {
  const onlySurvey = cm('2026-06-15', undefined);
  assert.equal(onlySurvey.month, '2026-06-01');
  assert.equal(onlySurvey.source, 'survey');
  assert.equal(onlySurvey.uploadMonth, null);
  const onlyUpload = cm(null, '2026-06-15T10:00:00');
  assert.equal(onlyUpload.month, '2026-06-01');
  assert.equal(onlyUpload.source, 'upload');
  assert.equal(onlyUpload.issue, null);
  assert.equal(cm('  ', '').month, null);
  assert.equal(cm(undefined, undefined).source, null);
  assert.equal(cm(undefined, undefined).ok, true);
});

test('mois de collecte : date illisible — refus seulement quand le mois devient indécidable', () => {
  // Enquête illisible, réception lisible : mois de réception, signalé (pas de refus).
  const r = cm('30/01/2026', '2026-02-03T08:00:00');
  assert.equal(r.ok, true);
  assert.equal(r.month, '2026-02-01');
  assert.equal(r.issue, 'survey_unreadable');
  assert.equal(r.surveyMonth, null);
  // Enquête illisible sans réception : refus (400 à l'import), sur la date d'enquête.
  assert.deepEqual(cm('30/01/2026', undefined), { ok: false, field: 'survey' });
  // Réception illisible : refus, même si l'enquête est lisible.
  assert.deepEqual(cm('2026-01-30', '10/05/2026'), { ok: false, field: 'upload' });
});

test('mois de collecte : secondes SPSS réelles (GD : SvyDate et @_submission_time)', () => {
  const r = cm(13985222400, 13985328309);
  assert.equal(r.source, 'survey');
  assert.equal(r.month, '2025-12-01');
  assert.equal(r.lagDays, 1);
});

test('collectionUpdates : seules les lignes qui changent ; sans date ou illisible → gardées telles quelles', () => {
  const cols = { surveyCols: ['SvyDate', 'today'], uploadCols: ['_submission_time'] };
  const rows = [
    // Ancienne règle (mois de réception) → mois de l'enquête.
    { id: 'a', periodMonth: '2026-02-01', submittedAt: new Date('2026-02-03T05:00:00Z'), uploadMonth: null, dates: { SvyDate: '2026-01-28', _submission_time: '2026-02-03T05:00:00Z' } },
    // Déjà à jour.
    { id: 'b', periodMonth: '2026-03-01', submittedAt: '2026-03-10T00:00:00.000Z', uploadMonth: '2026-03-01', dates: { SvyDate: '2026-03-10', _submission_time: '2026-03-12T05:00:00Z' } },
    // Saisie sans date (données de démonstration) : jamais effacée.
    { id: 'c', periodMonth: '2026-05-01', submittedAt: null, uploadMonth: null, dates: null },
    // Réception illisible : laissée telle quelle, comptée.
    { id: 'd', periodMonth: '2026-04-01', submittedAt: null, uploadMonth: null, dates: { _submission_time: 'n\'importe' } },
    // SvyDate vide → today (ordre de priorité) ; même mois, mais mois de réception renseigné.
    { id: 'e', periodMonth: '2026-04-01', submittedAt: new Date('2026-04-02T00:00:00Z'), uploadMonth: null, dates: { SvyDate: ' ', today: '2026-04-01', _submission_time: '2026-04-02T00:00:00Z' } },
  ];
  const r = collectionUpdates(rows, cols);
  assert.deepEqual(r.updates.map((u) => u.id), ['a', 'e']);
  assert.deepEqual(r.updates[0], { id: 'a', periodMonth: '2026-01-01', submittedAt: '2026-01-28T00:00:00.000Z', uploadMonth: '2026-02-01' });
  assert.deepEqual(r.updates[1], { id: 'e', periodMonth: '2026-04-01', submittedAt: '2026-04-01T00:00:00.000Z', uploadMonth: '2026-04-01' });
  assert.deepEqual([r.total, r.unchanged, r.undated, r.unreadable, r.monthChanged, r.fromSurvey, r.fromUpload], [5, 1, 1, 1, 1, 3, 0]);
  // Idempotent : les changements appliqués, plus rien à faire.
  const applied = rows.map((row) => ({ ...row, ...(r.updates.find((u) => u.id === row.id) || {}) }));
  assert.equal(collectionUpdates(applied, cols).updates.length, 0);
});

test('firstFilled : première colonne renseignée, dans l\'ordre', () => {
  assert.equal(firstFilled({ a: '', b: '  ', c: 0, d: 'x' }, ['a', 'b', 'c', 'd']), 0);
  assert.equal(firstFilled({ a: null }, ['a', 'z']), undefined);
  assert.equal(firstFilled(null, ['a']), undefined);
  assert.equal(firstFilled({ toString: 'x' }, ['valueOf']), undefined); // pas de clé héritée
});
