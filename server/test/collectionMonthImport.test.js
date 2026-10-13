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
  applyFieldOverrides, prepareImport, previewImport,
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
    'u3,2024-03-13,2026-04-02T08:36:05,c', // plus de 2 ans avant l'envoi : réception (à vérifier)
    'u4,,2026-05-05T08:00:00,d',           // pas de date d'enquête : réception
  ].join('\n');
  const { submissions: s } = await parseSubmissions(Buffer.from(csv));
  assert.deepEqual(s.map((x) => x.periodMonth), ['2026-01-01', '2026-02-01', '2026-04-01', '2026-05-01']);
  assert.deepEqual(s.map((x) => x.uploadMonth), ['2026-02-01', '2026-02-01', '2026-04-01', '2026-05-01']);
  assert.deepEqual(s.map((x) => x.dateSource), ['survey', 'survey', 'upload', 'upload']);
  assert.deepEqual(s.map((x) => x.dateIssue), [null, null, 'survey_too_old', null]);
  assert.equal(s[0].submittedAt.toISOString(), '2026-01-28T00:00:00.000Z'); // submitted_at = date d'enquête retenue
  assert.deepEqual(dateSummary(s), { fromSurvey: 2, fromUpload: 2, monthDiffers: 1, surveyUnreadable: 0, surveyTooOld: 1, surveyAfterUpload: 0, lateUpload: 0 });
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

test('régression : SvyDate (ou today) illisible mais end lisible, sans _submission_time → importé au mois de end', async () => {
  for (const head of ['_uuid,SvyDate,end', '_uuid,today,end']) {
    const { submissions: [s] } = await parseSubmissions(Buffer.from(`${head}\nu1,15/01/2026,2026-01-15T10:00:00\n`));
    assert.equal(s.periodMonth, '2026-01-01', head);
    assert.equal(s.dateSource, 'survey', head);
    assert.equal(s.dateIssue, null, head);
  }
  // start lisible après un SvyDate illisible : start (ordre de priorité SvyDate → today → start → end).
  const { submissions: [t] } = await parseSubmissions(Buffer.from('_uuid,SvyDate,start,end\nu1,15/01/2026,2026-02-03T08:00:00,2026-03-01\n'));
  assert.equal(t.periodMonth, '2026-02-01');
});

test('aucune date d\'enquête lisible ni date de réception : 400 sur la première colonne illisible', async () => {
  await assert.rejects(parseSubmissions(Buffer.from('_uuid,SvyDate,end\nu1,15/01/2026,\n')),
    refused(400, /ligne 2, colonne « SvyDate » : « 15\/01\/2026 »/));
  await assert.rejects(parseSubmissions(Buffer.from('_uuid,SvyDate,end\nu1,,le 3 mai\n')),
    refused(400, /ligne 2, colonne « end » : « le 3 mai »/));
  // Une date de réception lisible : jamais un refus (mois de réception, signalé).
  const { submissions: [s] } = await parseSubmissions(Buffer.from('_uuid,SvyDate,end,_submission_time\nu1,15/01/2026,hier,2026-02-03T08:00:00\n'));
  assert.equal(s.periodMonth, '2026-02-01');
  assert.equal(s.dateIssue, 'survey_unreadable');
});

test('envoi tardif (plus de 92 jours) : mois de l\'enquête, compté pour information', async () => {
  const csv = '_uuid,SvyDate,_submission_time\nu1,2025-09-15,2026-04-20T08:00:00\nu2,2026-04-01,2026-04-20T08:00:00\n';
  const { submissions: s } = await parseSubmissions(Buffer.from(csv));
  assert.deepEqual(s.map((x) => x.periodMonth), ['2025-09-01', '2026-04-01']);
  const d = dateSummary(s);
  assert.equal(d.lateUpload, 1);
  assert.equal(d.surveyTooOld, 0);
  assert.equal(d.monthDiffers, 1);
});

// Vérification avant import et import : même préparation (prepareImport), donc mêmes mois et comptes.
const MANUAL_CSV = [
  '_uuid,SvyDate,DateVisite,_submission_time,Bureau,q1',
  'u1,2026-02-01,2026-01-20,2026-02-03T08:00:00,Ambovombe,a',
  'u2,2026-02-10,2026-01-25,2026-02-11T08:00:00,Ihosy,b',
  'u2,2026-02-10,2026-01-25,2026-02-11T08:00:00,Ihosy,b', // doublon du fichier : une seule fois
  'u3,2026-03-02,,2026-03-04T08:00:00,,c',
].join('\n');
const HEADERS = ['_uuid', 'SvyDate', 'DateVisite', '_submission_time', 'Bureau', 'q1'];
const monthsOf = (list) => {
  const m = new Map();
  for (const x of list) if (x.periodMonth) m.set(x.periodMonth, (m.get(x.periodMonth) || 0) + 1);
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([month, n]) => ({ month, n }));
};
async function previewAndImport(overrides) {
  const analysis = previewImport((await parseSubmissions(Buffer.from(MANUAL_CSV))).submissions, HEADERS, { overrides });
  // Ce que l'import écrit : une autre lecture du même fichier, la même préparation.
  const { unique: written } = prepareImport((await parseSubmissions(Buffer.from(MANUAL_CSV))).submissions, { overrides });
  return { analysis, written };
}

test('vérification = import : date d\'enquête choisie dans « Mapping MEMS » (colonne puis « Aucune »)', async () => {
  // Automatique : SvyDate.
  let { analysis, written } = await previewAndImport([]);
  assert.deepEqual(analysis.months, [{ month: '2026-02-01', n: 2 }, { month: '2026-03-01', n: 1 }]);
  assert.deepEqual(analysis.months, monthsOf(written));
  assert.deepEqual(analysis.manual, []);
  // Colonne choisie : DateVisite (u3 sans DateVisite → mois de réception).
  ({ analysis, written } = await previewAndImport([{ dimension: 'survey_date', columnName: 'DateVisite' }]));
  assert.deepEqual(analysis.months, [{ month: '2026-01-01', n: 2 }, { month: '2026-03-01', n: 1 }]);
  assert.deepEqual(analysis.months, monthsOf(written));
  assert.deepEqual(analysis.dates, dateSummary(written));
  assert.equal(analysis.dates.monthDiffers, 2);
  assert.equal(analysis.recognized.survey_date, 'DateVisite');
  assert.deepEqual(analysis.manual, ['survey_date']);
  // « Aucune » : mois de réception partout.
  ({ analysis, written } = await previewAndImport([{ dimension: 'survey_date', columnName: '' }]));
  assert.deepEqual(analysis.months, [{ month: '2026-02-01', n: 2 }, { month: '2026-03-01', n: 1 }]);
  assert.deepEqual(analysis.months, monthsOf(written));
  assert.equal(analysis.dates.fromUpload, 3);
  assert.equal(analysis.dates.fromSurvey, 0);
  assert.equal(analysis.recognized.survey_date, null);
  // Comptes du fichier inchangés : 4 lignes, 1 doublon.
  assert.equal(analysis.count, 4);
  assert.equal(analysis.duplicatesInFile, 1);
});

test('previewImport : préparation sur des copies — soumissions lues intactes, colonnes reconnues sur les en-têtes du fichier', async () => {
  // Export Excel « avec les groupes » : le catalogue renomme « grp/Bureau » en « Bureau » à l'import.
  const csv = '_uuid,grp/SvyDate,grp/Bureau,_submission_time\nu1,2026-01-20,Ihosy,2026-02-03T08:00:00\n';
  const subs = (await parseSubmissions(Buffer.from(csv))).submissions;
  const before = JSON.stringify(subs);
  const headers = ['_uuid', 'grp/SvyDate', 'grp/Bureau', '_submission_time'];
  const a = previewImport(subs, headers, { catalogNames: ['SvyDate', 'Bureau'], overrides: [{ dimension: 'field_office', columnName: 'Bureau' }] });
  assert.equal(JSON.stringify(subs), before, 'les soumissions lues ne sont pas modifiées');
  assert.equal(a.recognized.survey_date, 'grp/SvyDate'); // lue sur l'en-tête du fichier
  assert.equal(a.recognized.field_office, 'Bureau');     // colonne choisie dans « Mapping MEMS »
  assert.deepEqual(a.manual, ['field_office']);
  assert.deepEqual(a.months, [{ month: '2026-01-01', n: 1 }]);
  // L'import, lui, écrit la valeur de la colonne choisie (clé renommée par le catalogue).
  const { unique: [w] } = prepareImport(subs, { catalogNames: ['SvyDate', 'Bureau'], overrides: [{ dimension: 'field_office', columnName: 'Bureau' }] });
  assert.equal(w.fieldOffice, 'Ihosy');
  assert.equal(w.data.Bureau, 'Ihosy');
});

test('applyFieldOverrides : valeur recopiée (variantes de casse, première non vide), « aucune » efface', () => {
  const s = { data: { bureau: ' ', BUREAU: ' Ihosy ', Commune: 'MG1' }, fieldOffice: 'x', admin3: 'auto', dateInputs: {} };
  applyFieldOverrides(s, [{ dimension: 'field_office', columnName: 'Bureau' }, { dimension: 'admin3', columnName: '' }, { dimension: 'inconnue', columnName: 'q' }]);
  assert.equal(s.fieldOffice, 'Ihosy');
  assert.equal(s.admin3, null);
  // Date d'enquête choisie : la première variante LISIBLE.
  const d = { data: { datevisite: '20/01/2026', DateVisite: '2026-01-20' }, periodMonth: '2026-02-01', dateInputs: { upload: '2026-02-03T08:00:00' } };
  applyFieldOverrides(d, [{ dimension: 'survey_date', columnName: 'DateVisite' }]);
  assert.equal(d.periodMonth, '2026-01-01');
  assert.equal(d.dateSource, 'survey');
});

// ---- Exports réels (facultatif) ------------------------------------------------------------
// MEMS_REAL_EXPORTS = dossier contenant les exports Kobo réels (non versionnés). Mesure le
// nombre de soumissions dont le mois change (mois de collecte ≠ mois de réception = l'ancien
// mois), celles restées au mois de l'envoi parce que leur SvyDate a plus de 2 ans (à vérifier)
// et les envois tardifs (plus de 92 jours après l'enquête, gardés au mois de l'enquête).
// Ancienne fenêtre de 92 jours → règle des 2 ans (mesuré le 13/10/2026) :
//  - SMP 350 → 503 mois changés : 153 envois tardifs (109 à 225 jours), dont 152 collectes de
//    septembre à décembre 2025 reçues en avril 2026 ; les 16 qui portent « start » l'ont dans
//    le mois de l'enquête. À vérifier : 153 → 0.
//  - Nutrition 203 → 359 : 156 envois tardifs (93 à 602 jours, SvyDate d'août 2024 à décembre
//    2025, reçus en avril 2026, sans « start » pour corroborer) ; à vérifier : 157 → 1 (mars 2024).
//  - GD 80 → 80 : 5 SvyDate en 2022, plus de 3 ans avant l'envoi (à vérifier), inchangées.
const REAL = process.env.MEMS_REAL_EXPORTS;
const REAL_CASES = [
  // [fragment du nom de fichier, soumissions, mois changés, plus de 2 ans (à vérifier), envois tardifs]
  ['MDG_SMP_2025_2026_2026_08_27', 1290, 503, 0, 153],
  ['NutritionAIM_2026_08_27', 871, 359, 1, 156],
  ['GD_PREVMA_v2_2026_08_12', 331, 80, 5, 0],
  ['MIARO_PROD_Janv2026_2026_06_15', 21, 5, 0, 0],
];
test('exports réels : soumissions dont le mois change (si MEMS_REAL_EXPORTS est défini)', async (t) => {
  if (!REAL || !fs.existsSync(REAL)) { t.skip('MEMS_REAL_EXPORTS absent'); return; }
  const files = fs.readdirSync(REAL);
  for (const [frag, count, changed, tooOld, late] of REAL_CASES) {
    const name = files.find((f) => f.includes(frag) && f.endsWith('.zip'));
    if (!name) continue;
    const { submissions } = await parseSubmissions(fs.readFileSync(path.join(REAL, name)),
      { zipLimits: { maxBytes: 400 * 1024 * 1024, maxRatio: 1e9, ratioFloorBytes: 1 } });
    const d = dateSummary(submissions);
    assert.equal(submissions.length, count, name);
    assert.equal(d.monthDiffers, changed, name);
    assert.equal(d.surveyTooOld, tooOld, name);
    assert.equal(d.lateUpload, late, name);
    assert.equal(d.surveyAfterUpload, 0, name); // la date d'enquête ne suit jamais la réception
  }
});
