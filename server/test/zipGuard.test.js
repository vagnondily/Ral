const test = require('node:test');
const assert = require('node:assert/strict');
const { checkZipEntries, assertZipEntries, zipLimitsFromEnv, formatMo, DEFAULT_ZIP_LIMITS } = require('../src/modules/common/zipGuard');

// Tailles réelles de l'export SPSS de l'enquête CP (9,6 Mo reçus).
const CP_DATA_SAV = { name: 'data.sav', size: 215992459, compressedSize: 4313972 };

test('plafond par défaut : 150 Mo décompressés, taux 100', () => {
  assert.equal(DEFAULT_ZIP_LIMITS.maxBytes, 150e6);
  assert.equal(DEFAULT_ZIP_LIMITS.maxRatio, 100);
});

test('zip de l\'enquête CP : data.sav de 216 Mo refusé, message qui cite les tailles', () => {
  const v = checkZipEntries([CP_DATA_SAV], DEFAULT_ZIP_LIMITS, { archiveBytes: 9602565 });
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'size');
  assert.match(v.message, /« data\.sav » ferait 216 Mo/);
  assert.match(v.message, /fichier reçu : 9,6 Mo/);
  assert.match(v.message, /plafond de 150 Mo/);
});

test('exports réels acceptés (SAMS data.sav 17 Mo, classeur MIARO 9,8 Mo)', () => {
  assert.equal(checkZipEntries([{ name: 'data.sav', size: 16989271, compressedSize: 801286 }]).ok, true);
  const xlsx = [
    { name: 'xl/worksheets/sheet1.xml', size: 9600000, compressedSize: 1060000 },
    { name: 'xl/styles.xml', size: 20000, compressedSize: 1600 },
    { name: 'xl/', size: 0, compressedSize: 0, isDirectory: true },
  ];
  const v = checkZipEntries(xlsx);
  assert.equal(v.ok, true);
  assert.equal(v.totalBytes, 9620000);
});

test('taux de compression anormal refusé au-delà de 10 Mo, toléré en dessous', () => {
  const bomb = [{ name: 'x.sav', size: 50e6, compressedSize: 50e3 }]; // ×1000
  const v = checkZipEntries(bomb);
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'ratio');
  assert.match(v.message, /1000 fois/);
  assert.equal(checkZipEntries([{ name: 'petit.csv', size: 2e6, compressedSize: 2e3 }]).ok, true);
});

test('limites réglables par l\'environnement ; valeurs invalides ignorées', () => {
  assert.deepEqual(zipLimitsFromEnv({ IMPORT_MAX_UNZIPPED_MB: '300', IMPORT_MAX_ZIP_RATIO: '50' }),
    { maxBytes: 300e6, maxRatio: 50, ratioFloorBytes: 10e6 });
  assert.deepEqual(zipLimitsFromEnv({ IMPORT_MAX_UNZIPPED_MB: 'abc', IMPORT_MAX_ZIP_RATIO: '-3' }),
    { maxBytes: 150e6, maxRatio: 100, ratioFloorBytes: 10e6 });
  assert.deepEqual(zipLimitsFromEnv({}), { ...DEFAULT_ZIP_LIMITS });
  // Avec un plafond relevé à 300 Mo, data.sav (216 Mo, ×50) passe.
  assert.equal(checkZipEntries([CP_DATA_SAV], zipLimitsFromEnv({ IMPORT_MAX_UNZIPPED_MB: '300' })).ok, true);
});

test('assertZipEntries : 413 pour la taille, 400 pour le taux', () => {
  assert.throws(() => assertZipEntries([CP_DATA_SAV]), (e) => e.statusCode === 413 && /216 Mo/.test(e.message));
  assert.throws(() => assertZipEntries([{ name: 'x', size: 50e6, compressedSize: 1e3 }]), (e) => e.statusCode === 400);
  assert.equal(assertZipEntries([{ name: 'ok.sav', size: 1e6, compressedSize: 1e5 }]).ok, true);
});

test('tailles affichées à la française', () => {
  assert.equal(formatMo(9602565), '9,6 Mo');
  assert.equal(formatMo(215992459), '216 Mo');
  assert.equal(formatMo(1234e6), '1 234 Mo');
  assert.equal(formatMo(20000), '0,1 Mo');
  assert.equal(formatMo(0), '0 Mo');
});
