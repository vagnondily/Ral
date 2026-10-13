const test = require('node:test');
const assert = require('node:assert/strict');
const { detectMapping, MAP, DIMENSIONS, DATE_KEYS, EDITABLE_KEYS } = require('../src/modules/monitoring/memsMapping');

test('detectMapping maps well-known columns to MEMS dimensions (accent/case tolerant)', () => {
  const names = ['_submission_time', 'Region', 'District', 'commune', 'SiteName', 'ENUpartner', 'autre_champ'];
  const m = detectMapping(names);
  const by = Object.fromEntries(m.map((r) => [r.key, r.column]));
  assert.equal(by.submitted_at, '_submission_time');
  assert.equal(by.admin1, 'Region');            // insensible à la casse
  assert.equal(by.admin2, 'District');          // niveaux alignés sur les Localités : 2 = district
  assert.equal(by.admin3, 'commune');           // 3 = commune (clé de liaison aux sites)
  assert.equal(by.admin4, null);
  assert.equal(by.site, 'SiteName');
  assert.equal(by.partner, 'ENUpartner');
  assert.equal(by.agent, null);                  // non présent → non mappé
});

test('detectMapping keeps the first original column name and returns every dimension', () => {
  const m = detectMapping(['admin1', 'admin1name']);
  const a1 = m.find((r) => r.key === 'admin1');
  assert.equal(a1.column, 'admin1');             // le code (pcode) passe avant le nom
  assert.equal(m.length, DIMENSIONS.length);     // une ligne par dimension, matchée ou non
});

test('dates : date d\'enquête (SvyDate d\'abord, choisie à la main possible) et date de réception (détectée seulement)', () => {
  const by = Object.fromEntries(detectMapping(['start', 'end', 'today', 'SvyDate', '@_submission_time']).map((r) => [r.key, r.column]));
  assert.equal(by.survey_date, 'SvyDate');                 // avant today / start / end
  assert.equal(by.submitted_at, '@_submission_time');      // horodatage serveur (export SPSS)
  assert.equal(detectMapping(['today', 'end']).find((r) => r.key === 'survey_date').column, 'today');
  assert.ok(EDITABLE_KEYS.includes(DATE_KEYS.survey));
  assert.ok(!EDITABLE_KEYS.includes(DATE_KEYS.upload));
  assert.equal(DIMENSIONS.find((d) => d.key === 'survey_date').label, 'Date de collecte');
});

test('MAP is the shared alias table and includes the dedup id plus every dimension', () => {
  assert.ok(Array.isArray(MAP.external_id));
  for (const d of DIMENSIONS) assert.deepEqual(MAP[d.key], d.aliases);
});
