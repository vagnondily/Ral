const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PAGE_KEYS, normalizePageAccess, canSeePage } = require('../src/modules/common/pageCatalog');

test('clés d\'écran attendues', () => {
  assert.deepEqual(PAGE_KEYS, ['contrats', 'tpm', 'processus', 'pdd', 'dashboard', 'reporting', 'alertes', 'parametrage']);
});

test('normalizePageAccess : null = aucune restriction ; filtre les clés inconnues ; dédoublonne', () => {
  assert.equal(normalizePageAccess(null), null);
  assert.equal(normalizePageAccess(undefined), null);
  assert.equal(normalizePageAccess('contrats'), null, 'non-tableau = aucune restriction');
  assert.deepEqual(normalizePageAccess(['contrats', 'tpm', 'contrats', 'inconnu']), ['contrats', 'tpm']);
  assert.deepEqual(normalizePageAccess([]), [], 'tableau vide = aucun écran visible');
});

test('canSeePage : null voit tout ; sinon la clé doit être listée', () => {
  assert.equal(canSeePage(null, 'contrats'), true);
  assert.equal(canSeePage(['contrats'], 'contrats'), true);
  assert.equal(canSeePage(['contrats'], 'tpm'), false);
  assert.equal(canSeePage([], 'contrats'), false);
});
