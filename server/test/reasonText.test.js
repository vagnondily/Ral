const test = require('node:test');
const assert = require('node:assert/strict');
const { checkReason, REASON_MIN, REASON_MAX } = require('../src/modules/common/reasonText');

test('raison : espaces rognés et fusionnés', () => {
  assert.deepEqual(checkReason('  Contrat   AINA\n échu  '), { ok: true, reason: 'Contrat AINA échu' });
});

test('raison vide : exigée → reason_required ; facultative → null', () => {
  assert.equal(checkReason('   ').code, 'reason_required');
  assert.equal(checkReason(undefined).code, 'reason_required');
  assert.equal(checkReason(42).code, 'reason_required');
  assert.deepEqual(checkReason('', { required: false }), { ok: true, reason: null });
});

test('raison : bornes 10..500 caractères (comme les CHECK de la migration 070)', () => {
  assert.equal(REASON_MIN, 10);
  assert.equal(REASON_MAX, 500);
  assert.equal(checkReason('Trop court').ok, true); // 10 caractères
  assert.equal(checkReason('Trop cour').code, 'reason_short'); // 9
  assert.equal(checkReason(`Raison ${'longue '.repeat(80)}`.slice(0, 501)).code, 'reason_long');
  assert.equal(checkReason(`Raison ${'longue '.repeat(80)}`.slice(0, 500)).ok, true);
});

test('raison sans contenu → reason_meaningless', () => {
  for (const s of ['..........', 'aaaaaaaaaa', '1234567890', 'ab ab ab ab ab', '-- ab -- 1 --']) {
    assert.equal(checkReason(s).code, 'reason_meaningless', s);
  }
});

test('raisons réelles acceptées (accents, chiffres)', () => {
  for (const s of ['Contrat AINA échu', 'Collecte confiée à YPA par le bureau', 'Accès / sécurité : piste coupée 2 semaines']) {
    assert.equal(checkReason(s).ok, true, s);
  }
});

test('message lisible pour chaque code', () => {
  const r = checkReason('court');
  assert.equal(r.ok, false);
  assert.match(r.message, /10 caractères/);
});
