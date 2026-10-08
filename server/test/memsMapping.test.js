const test = require('node:test');
const assert = require('node:assert/strict');
const { detectMapping, MAP, DIMENSIONS } = require('../src/modules/monitoring/memsMapping');

test('detectMapping maps well-known columns to MEMS dimensions (accent/case tolerant)', () => {
  const names = ['_submission_time', 'Region', 'District', 'commune', 'SiteName', 'ENUpartner', 'autre_champ'];
  const m = detectMapping(names);
  const by = Object.fromEntries(m.map((r) => [r.key, r.column]));
  assert.equal(by.submitted_at, '_submission_time');
  assert.equal(by.admin1, 'Region');            // insensible à la casse
  assert.equal(by.admin3, 'District');
  assert.equal(by.admin4, 'commune');
  assert.equal(by.site, 'SiteName');
  assert.equal(by.partner, 'ENUpartner');
  assert.equal(by.agent, null);                  // non présent → non mappé
});

test('detectMapping keeps the first original column name and returns every dimension', () => {
  const m = detectMapping(['admin1', 'admin1name']);
  const a1 = m.find((r) => r.key === 'admin1');
  assert.equal(a1.column, 'admin1name');         // 1ᵉʳ alias trouvé dans l'ordre des alias
  assert.equal(m.length, DIMENSIONS.length);     // une ligne par dimension, matchée ou non
});

test('MAP is the shared alias table and includes the dedup id plus every dimension', () => {
  assert.ok(Array.isArray(MAP.external_id));
  for (const d of DIMENSIONS) assert.deepEqual(MAP[d.key], d.aliases);
});
