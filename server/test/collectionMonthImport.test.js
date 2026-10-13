/**
 * Mois de collecte À L'IMPORT (retour n° 35) : les deux dates sont lues (date
 * d'enquête et date de réception), period_month suit collectionMonth, et la
 * lecture stricte des dates reste celle d'avant (aucun fichier qui s'importait
 * n'est refusé ; une date illisible qui rend le mois indécidable → 400).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  parseSubmissions, submissionsFromObjects, analyzeSubmissions, collectionColumns, applySurveyDate, dateSummary,
} = require('../src/modules/monitoring/submissionsImport');

const refused = (status, pattern) => (err) => {
  assert.equal(err.statusCode, status);
  assert.match(err.message, pattern);
  return true;
};

test('CSV Kobo : SvyDate fixe le mois, _submission_time reste le mois de réception', async () => {
  const csv = [
    '_uuid,SvyDate,_submission_time,q1',
    'u1,2026-01-28,2026-02-03T08:00:00,a', // enquête fin janvier, reçue début février
    'u2,2026-02-10,2026-02-11T08:00:00,b', // même mois
    'u3,2024-03-13,2026-04-02T08:36:05,c', // horloge de tablette en 2024 : réception
    'u4,,2026-05-05T08:00:00,d',           // pas de date d'enquête : réception
  ].join('\n');
  const { submissions: s } = await parseSubmissions(Buffer.from(csv));
  assert.deepEqual(s.map((x) => x.periodMonth), ['2026-01-01', '2026-02-01', '2026-04-01', '2026-05-01']);
  assert.deepEqual(s.map((x) => x.uploadMonth), ['2026-02-01', '2026-02-01', '2026-04-01', '2026-05-01']);
  assert.deepEqual(s.map((x) => x.dateSource), ['survey', 'survey', 'upload', 'upload']);
  assert.deepEqual(s.map((x) => x.dateIssue), [null, null, 'survey_too_old', null]);
  assert.equal(s[0].submittedAt.toISOString(), '2026-01-28T00:00:00.000Z'); // submitted_at = date d'enquête retenue
  assert.deepEqual(dateSummary(s), { fromSurvey: 2, fromUpload: 2, monthDiffers: 1, surveyUnreadable: 0, surveyTooOld: 1, surveyAfterUpload: 0 });
});

test('date d\'enquête illisible AVEC une date de réception : importée au mois de réception, comptée', async () => {
  const csv = '_uuid,SvyDate,_submission_time\nu1,30/01/2026,2026-02-03T08:00:00\nu2,2026-02-01,2026-02-03T08:00:00\n';
  const { submissions: s } = await parseSubmissions(Buffer.from(csv));
  assert.equal(s.length, 2);
  assert.equal(s[0].periodMonth, '2026-02-01');
  assert.equal(s[0].dateIssue, 'survey_unreadable');
  const a = analyzeSubmissions(s, ['_uuid', 'SvyDate', '_submission_time']);
  assert.equal(a.dates.surveyUnreadable, 1);
  assert.equal(a.recognized.survey_date, 'SvyDate');
  assert.equal(a.recognized.submitted_at, '_submission_time');
});

test('lecture stricte conservée : enquête illisible SANS réception, ou réception illisible → 400', async () => {
  await assert.rejects(parseSubmissions(Buffer.from('_uuid,SvyDate\nu1,2026-05-03\nu2,30/01/2026\n')),
    refused(400, /ligne 3, colonne « SvyDate » : « 30\/01\/2026 »/));
  // La date de réception illisible est signalée sur SA colonne, même si l'enquête est lisible.
  await assert.rejects(parseSubmissions(Buffer.from('_uuid,SvyDate,_submission_time\nu1,2026-05-03,03/05/2026\n')),
    refused(400, /ligne 2, colonne « _submission_time » : « 03\/05\/2026 »/));
});

test('chemin SPSS / API : secondes SPSS des deux dates (valeurs réelles GD et Nutrition)', () => {
  const subs = submissionsFromObjects([
    { '@_uuid': 'g1', SvyDate: 13985222400, '@_submission_time': 13985328309 }, // GD : enquête la veille
    { '@_uuid': 'n1', SvyDate: 13929667200, '@_submission_time': 13994498165 }, // Nutrition : 2024 → réception
    { '@_uuid': 'm1', SvyDate: 13989110400 },                                   // MIARO sans réception : l'enquête
  ], 'sav');
  assert.deepEqual(subs.map((x) => x.periodMonth), ['2025-12-01', '2026-04-01', '2026-01-01']);
  assert.deepEqual(subs.map((x) => x.uploadMonth), ['2025-12-01', '2026-04-01', null]);
  assert.deepEqual(subs.map((x) => x.dateSource), ['survey', 'upload', 'survey']);
});

test('export Excel « avec les groupes » : SvyDate sous un groupe reconnue', async () => {
  const csv = '_uuid,Technical_module/TechnicalBasic_submodule/SvyDate,_submission_time,SvyDate_DSM\n'
    + 'r1,2026-07-13,2026-08-02T10:28:40,2026-01-01\n';
  const { submissions: [s] } = await parseSubmissions(Buffer.from(csv));
  assert.equal(s.periodMonth, '2026-07-01'); // et pas SvyDate_DSM (date d'un autre module)
  assert.equal(s.uploadMonth, '2026-08-01');
});

test('collectionColumns : automatique, colonne choisie (et ses variantes de casse), « aucune »', () => {
  const keys = ['_uuid', 'end', 'SvyDate', 'today', '@_submission_time', 'DateVisite', 'datevisite'];
  assert.deepEqual(collectionColumns(keys), { surveyCols: ['SvyDate', 'today', 'end'], uploadCols: ['@_submission_time'] });
  assert.deepEqual(collectionColumns(keys, 'DateVisite').surveyCols, ['DateVisite', 'datevisite']);
  assert.deepEqual(collectionColumns(keys, '').surveyCols, []);
  assert.deepEqual(collectionColumns(keys, null).surveyCols, []);
  assert.deepEqual(collectionColumns([], undefined), { surveyCols: [], uploadCols: [] });
});

test('applySurveyDate : colonne choisie à la main appliquée avec la même règle', async () => {
  const csv = '_uuid,SvyDate,DateVisite,_submission_time\nu1,2026-02-01,2026-01-20,2026-02-03T08:00:00\n';
  const { submissions: [s] } = await parseSubmissions(Buffer.from(csv));
  assert.equal(s.periodMonth, '2026-02-01'); // automatique : SvyDate
  assert.equal(applySurveyDate(s, s.data.DateVisite), false);
  assert.equal(s.periodMonth, '2026-01-01');
  assert.equal(s.uploadMonth, '2026-02-01');
  assert.equal(s.dateSource, 'survey');
  // « Aucune » : mois de réception.
  assert.equal(applySurveyDate(s, undefined), false);
  assert.equal(s.periodMonth, '2026-02-01');
  assert.equal(s.dateSource, 'upload');
  // Illisible : mois de réception, signalé.
  assert.equal(applySurveyDate(s, 'le 3 mai'), true);
  assert.equal(s.periodMonth, '2026-02-01');
  assert.equal(s.dateIssue, 'survey_unreadable');
});

test('applySurveyDate : illisible et sans réception → la lecture de l\'import est gardée', async () => {
  const { submissions: [s] } = await parseSubmissions(Buffer.from('_uuid,SvyDate,Autre\nu1,2026-03-04,n/a\n'));
  assert.equal(s.periodMonth, '2026-03-01');
  assert.equal(applySurveyDate(s, s.data.Autre), true);
  assert.equal(s.periodMonth, '2026-03-01');
  assert.equal(s.dateIssue, 'survey_unreadable');
});

// ---- Exports réels (facultatif) ------------------------------------------------------------
// MEMS_REAL_EXPORTS = dossier contenant les exports Kobo réels (non versionnés). Mesure le
// nombre de soumissions dont le mois change (mois de collecte ≠ mois de réception = l'ancien
// mois) et celles restées au mois de réception parce que leur SvyDate a plus de 92 jours
// (horloges de tablette en 2024). Mois d'enquête ≠ mois de réception, sans la règle des 92 jours :
// SMP 503 = 350 + 153, Nutrition 360 = 203 + 157, GD 85 = 80 + 5.
const REAL = process.env.MEMS_REAL_EXPORTS;
const REAL_CASES = [
  // [fragment du nom de fichier, soumissions, mois changés, date d'enquête de plus de 92 jours]
  ['MDG_SMP_2025_2026_2026_08_27', 1290, 350, 153],
  ['NutritionAIM_2026_08_27', 871, 203, 157],
  ['GD_PREVMA_v2_2026_08_12', 331, 80, 5],
  ['MIARO_PROD_Janv2026_2026_06_15', 21, 5, 0],
];
test('exports réels : soumissions dont le mois change (si MEMS_REAL_EXPORTS est défini)', async (t) => {
  if (!REAL || !fs.existsSync(REAL)) { t.skip('MEMS_REAL_EXPORTS absent'); return; }
  const files = fs.readdirSync(REAL);
  for (const [frag, count, changed, tooOld] of REAL_CASES) {
    const name = files.find((f) => f.includes(frag) && f.endsWith('.zip'));
    if (!name) continue;
    const { submissions } = await parseSubmissions(fs.readFileSync(path.join(REAL, name)),
      { zipLimits: { maxBytes: 400 * 1024 * 1024, maxRatio: 1e9, ratioFloorBytes: 1 } });
    const d = dateSummary(submissions);
    assert.equal(submissions.length, count, name);
    assert.equal(d.monthDiffers, changed, name);
    assert.equal(d.surveyTooOld, tooOld, name);
    assert.equal(d.surveyAfterUpload, 0, name); // la date d'enquête ne suit jamais la réception
  }
});
