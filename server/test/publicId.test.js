const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ALPHABET, PATTERN, isPublicId, normalizePublicId, randomPublicId } = require('../src/modules/common/publicId');

test('alphabet Crockford : 32 symboles, sans I, L, O, U', () => {
  assert.equal(ALPHABET.length, 32);
  assert.equal(new Set(ALPHABET).size, 32);
  for (const c of 'ILOU') assert.equal(ALPHABET.includes(c), false, c);
});

test('saisie tolérante → forme canonique', () => {
  assert.equal(normalizePublicId('S-7K3F-9Q2X'), 'S-7K3F-9Q2X');
  assert.equal(normalizePublicId(' s 7k3f 9q2x '), 'S-7K3F-9Q2X');
  assert.equal(normalizePublicId('S7K3F9Q2X'), 'S-7K3F-9Q2X');
  assert.equal(normalizePublicId('s-7k3f-oq2x'), 'S-7K3F-0Q2X'); // O → 0
  assert.equal(normalizePublicId('S-IL00-0000'), 'S-1100-0000'); // I, L → 1
  for (const bad of ['', null, 'PLAN-0001', 'L001', 'S-7K3F-9Q2', 'S-7K3F-9Q2XX', 'S-7K3F-9Q2U', 'X-7K3F-9Q2X']) {
    assert.equal(normalizePublicId(bad), null, String(bad));
  }
  assert.equal(isPublicId('S-7K3F-9Q2X'), true);
  assert.equal(isPublicId('s-7k3f-9q2x'), false);
});

test('tirage : forme valide, symboles répartis', () => {
  const seen = new Set();
  for (let i = 0; i < 2000; i += 1) { const id = randomPublicId(); assert.ok(PATTERN.test(id), id); seen.add(id); }
  assert.equal(seen.size, 2000);
});

test('même alphabet et même motif que la migration 073 (base = filet de sécurité)', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../src/db/migrations/073_site_public_id.sql'), 'utf8');
  assert.ok(sql.includes(`'${ALPHABET}'`), 'alphabet identique dans la fonction SQL');
  assert.ok(sql.includes(PATTERN.source.replace(/\\/g, '')), 'motif identique dans le CHECK');
});
