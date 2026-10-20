const test = require('node:test');
const assert = require('node:assert/strict');
const { sitePatchSql } = require('../src/modules/tpm/sitePatch');

test('site : un changement de risque seul ne touche ni l\'activité ni le fokontany', () => {
  const { sets, values } = sitePatchSql({ riskLevel: 'elevee' }, 3);
  assert.deepEqual(sets, ['risk_level = $3']);
  assert.deepEqual(values, ['elevee']);
});

test('site : critères seuls (écran RBM) → seulement ces colonnes', () => {
  const { sets } = sitePatchSql({ security: 3, fraud: 1, experiencedPartner: 2 }, 3);
  assert.deepEqual(sets, ['security_situation = $3', 'fraud_suspected = $4', 'experienced_partner = $5']);
});

test('site : null efface une colonne facultative, jamais une colonne obligatoire', () => {
  const { sets, values } = sitePatchSql({ activity: null, name: null, security: null, beneficiaryNumber: null }, 3);
  assert.deepEqual(sets, ['activity = $3', 'beneficiary_number = $4']);
  assert.deepEqual(values, [null, null]);
});

test('site : district et commune mettent aussi à jour adm2 / adm3', () => {
  const { sets, values } = sitePatchSql({ district: 'Bekily', commune: 'Ankaramena' }, 3);
  assert.deepEqual(sets.filter((x) => !x.includes('_pcode')), ['district = $3', 'adm2 = $4', 'commune = $5', 'adm3 = $6']);
  assert.deepEqual(values, ['Bekily', 'Bekily', 'Ankaramena', 'Ankaramena']);
});

test('site : patch vide → aucune clause ; champ inconnu ignoré', () => {
  assert.deepEqual(sitePatchSql({}, 3), { sets: [], values: [] });
  assert.deepEqual(sitePatchSql({ tenantId: 'x', id: 'y' }, 3), { sets: [], values: [] });
});

test('site : changer la commune efface le pcode de l\'ancienne commune, le garder ne le touche pas', () => {
  const { sets, values } = sitePatchSql({ commune: 'Belalanda' }, 3);
  assert.deepEqual(values, ['Belalanda', 'Belalanda']);
  assert.equal(sets[0], 'commune = $3');
  assert.equal(sets[1], 'adm3 = $4');
  // Comparé à l'ancienne valeur en base : même commune (casse/espaces) → pcode conservé.
  assert.equal(sets[2], 'adm3_pcode = CASE WHEN lower(btrim(commune)) IS NOT DISTINCT FROM lower(btrim($3::text)) THEN adm3_pcode ELSE NULL END');
  const d = sitePatchSql({ district: 'Toliara II' }, 3);
  assert.ok(d.sets.some((x) => x.startsWith('adm2_pcode = CASE WHEN lower(btrim(district))')));
  assert.ok(!sitePatchSql({ riskLevel: 'elevee' }, 3).sets.some((x) => x.includes('pcode')));
});

test('rattachements rejoués seulement si le nom, le lieu ou l\'activité change (jamais pour un critère RBM)', () => {
  const { patchAffectsLinks, LINK_FIELDS, SITE_PATCH_COLUMNS } = require('../src/modules/tpm/sitePatch');
  assert.equal(patchAffectsLinks({ riskLevel: 'elevee' }), false);
  assert.equal(patchAffectsLinks({ security: 3, synergies: 1, beneficiaryNumber: 250, lastVisitDate: '2026-01-02' }), false);
  for (const k of ['name', 'district', 'commune', 'fokontany', 'activity']) assert.equal(patchAffectsLinks({ [k]: 'x' }), true, k);
  assert.equal(patchAffectsLinks({ commune: undefined }), false, 'champ absent = inchangé');
  assert.equal(patchAffectsLinks({ activity: null }), true, 'effacer l\'activité change les formulaires reliés');
  assert.equal(patchAffectsLinks({}), false);
  // Toute colonne modifiable est classée : une nouvelle colonne oblige à décider si elle touche aux rattachements.
  const criteria = ['riskLevel', 'security', 'synergies', 'beneficiaryOver200', 'newPartner', 'issuesProcess', 'issuesPartnerReport',
    'issuesCFM', 'fraud', 'experiencedPartner', 'beneficiaryNumber', 'modalityType', 'poiSubtype', 'urbanArea', 'lastVisitDate'];
  assert.deepEqual(Object.keys(SITE_PATCH_COLUMNS).filter((k) => !LINK_FIELDS.includes(k)).sort(), criteria.sort());
});
